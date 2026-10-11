# CPH-PI 主会话虚拟化与单账号并发保护实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底解决单账号测试与运行中云端会话被淘汰的问题，实现主会话派发后自动本地原子快照与云端脱钩、子代理单账号自适应排队（并发度=1）、以及后继主会话（30 轮满额配额）代际自动接棒闭环。

**Architecture:** 
1. `src/session/main-plan-snapshot.ts`：负责序列化/反序列化 `MainPlanSnapshot` 并格式化后继主会话 Turn 1 提示词；
2. `src/agent/subagent-runner.ts`：自适应账号容量，单账号环境强制串行排队（并发度=1），多账号环境并发，保障微软 2~3 条会话红线不被触碰；
3. `src/agent/orchestrator.ts`：拦截 `invoke_subagent` 时自动落盘快照，释放旧主会话网络句柄；子代理交付后自动代际接棒（重置 conversationId/turn 为 1，挂载 lineage），闭环驱动交叉验证；
4. `src/ui/tui-renderer.ts` & `src/cli.ts`：渲染主会话虚拟化封存与后继主控唤起状态卡片。

**Tech Stack:** TypeScript, Bun Test, Sydney ChatHub WebSocket, Copilot M365 Agent Protocol.

## Global Constraints

- **工作区隔离**：AI 严禁在工作区根目录写任何文件，所有代码必须位于 `CPH-PI/` 下。
- **Harness 中立性**：Harness 只做客观调度、快照持久化与事件传递，不修改模型认知。
- **正向引导铁律**：所有提示词与技能使用建设性引导，杜绝使用负面禁止词。
- **严格 TDD**：每个任务必须先写失败测试，验证红灯后再实施代码，最终绿灯提交。

---

### Task 1: 主会话无损快照持久化与恢复引擎 (main-plan-snapshot.ts)

**Files:**
- Create: `CPH-PI/src/session/main-plan-snapshot.ts`
- Test: `CPH-PI/tests/session/main-plan-snapshot.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface MainPlanSnapshot {
    snapshotId: string;
    originalSessionId: string;
    originalTask: string;
    thought: string;
    workspaceRoot: string;
    gitBaseline: string;
    plannedSubagents: any[];
    createdAt: number;
  }
  export function createMainPlanSnapshot(params: {
    originalSessionId: string;
    originalTask: string;
    thought?: string;
    workspaceRoot: string;
    gitBaseline?: string;
    plannedSubagents: any[];
  }): MainPlanSnapshot;
  export function saveMainPlanSnapshot(snapshot: MainPlanSnapshot, workspaceRoot: string): { jsonPath: string; mdPath: string };
  export function loadMainPlanSnapshot(sessionId: string, workspaceRoot: string): MainPlanSnapshot | null;
  export function formatSuccessorTurn1Prompt(snapshot: MainPlanSnapshot, reportsSummary: string): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `CPH-PI/tests/session/main-plan-snapshot.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMainPlanSnapshot,
  saveMainPlanSnapshot,
  loadMainPlanSnapshot,
  formatSuccessorTurn1Prompt,
} from "../../src/session/main-plan-snapshot.ts";

describe("MainPlanSnapshot Engine", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-snapshot-test-" + Date.now());

  it("should create, save and load a lossless main plan snapshot", () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_123",
      originalTask: "重构账户池认证机制",
      thought: "由于涉及底层网络与并发锁，需拆分为调研与实现两步",
      workspaceRoot: tmpDir,
      gitBaseline: "abc1234",
      plannedSubagents: [
        { role: "researcher", description: "调研锁机制", prompt: "探查锁状态" },
        { role: "coder", description: "编写补丁", prompt: "修改代码" },
      ],
    });

    expect(snapshot.snapshotId).toStartWith("snap_");
    expect(snapshot.originalSessionId).toBe("main_ses_123");

    const { jsonPath, mdPath } = saveMainPlanSnapshot(snapshot, tmpDir);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const loaded = loadMainPlanSnapshot("main_ses_123", tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.originalTask).toBe("重构账户池认证机制");
    expect(loaded?.plannedSubagents.length).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should format a high-fidelity Turn 1 prompt for successor main session", () => {
    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main_ses_456",
      originalTask: "优化会话管理",
      thought: "先查架构再动手",
      workspaceRoot: tmpDir,
      plannedSubagents: [
        { role: "researcher", description: "查结构", prompt: "看文件" },
      ],
    });

    const prompt = formatSuccessorTurn1Prompt(
      snapshot,
      "### 🎯 子代理多会话并发执行报告: 发现并修复 1 处死锁问题"
    );

    expect(prompt).toContain("【主控接力与成果审阅】");
    expect(prompt).toContain("优化会话管理");
    expect(prompt).toContain("先查架构再动手");
    expect(prompt).toContain("子代理多会话并发执行报告");
    expect(prompt).toContain("FINAL_ANSWER");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/main-plan-snapshot.test.ts`
Expected: FAIL with module or function not found.

- [ ] **Step 3: Write minimal implementation**

Create `CPH-PI/src/session/main-plan-snapshot.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";

export interface MainPlanSnapshot {
  snapshotId: string;
  originalSessionId: string;
  originalTask: string;
  thought: string;
  workspaceRoot: string;
  gitBaseline: string;
  plannedSubagents: any[];
  createdAt: number;
}

export function createMainPlanSnapshot(params: {
  originalSessionId: string;
  originalTask: string;
  thought?: string;
  workspaceRoot: string;
  gitBaseline?: string;
  plannedSubagents: any[];
}): MainPlanSnapshot {
  return {
    snapshotId: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    originalSessionId: params.originalSessionId,
    originalTask: params.originalTask,
    thought: params.thought || "",
    workspaceRoot: params.workspaceRoot,
    gitBaseline: params.gitBaseline || "HEAD",
    plannedSubagents: params.plannedSubagents || [],
    createdAt: Date.now(),
  };
}

export function saveMainPlanSnapshot(
  snapshot: MainPlanSnapshot,
  workspaceRoot: string
): { jsonPath: string; mdPath: string } {
  const handoffsDir = path.join(workspaceRoot, ".cph", "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });

  const cleanId = snapshot.originalSessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jsonPath = path.join(handoffsDir, `main-plan-${cleanId}.json`);
  const mdPath = path.join(handoffsDir, `main-plan-${cleanId}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");

  const mdContent = `# 主控规划快照: ${snapshot.snapshotId}

- **前序会话**: ${snapshot.originalSessionId}
- **生成时间**: ${new Date(snapshot.createdAt).toISOString()}
- **Git 基准**: ${snapshot.gitBaseline}

## 1. 原始工程任务
${snapshot.originalTask}

## 2. 前序主控推演与架构思考
${snapshot.thought || "（无额外思考推演）"}

## 3. 本次派发的专项子任务 (${snapshot.plannedSubagents.length} 个)
${snapshot.plannedSubagents
  .map(
    (sub, idx) => `### 子任务 ${idx + 1}: [${sub.role || "unknown"}] ${sub.description || ""}
- **Prompt**:
\`\`\`text
${sub.prompt || ""}
\`\`\`
`
  )
  .join("\n")}
`;

  fs.writeFileSync(mdPath, mdContent, "utf8");

  return { jsonPath, mdPath };
}

export function loadMainPlanSnapshot(
  sessionId: string,
  workspaceRoot: string
): MainPlanSnapshot | null {
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jsonPath = path.join(workspaceRoot, ".cph", "handoffs", `main-plan-${cleanId}.json`);
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(jsonPath, "utf8");
    return JSON.parse(raw) as MainPlanSnapshot;
  } catch {
    return null;
  }
}

export function formatSuccessorTurn1Prompt(
  snapshot: MainPlanSnapshot,
  reportsSummary: string
): string {
  return `【主控接力与成果审阅】
前序主控会话已完成工程规划并调度专项子代理完成了攻坚。系统已在本地持久化前序规划快照。以下为前序规划蓝图与各子代理的交付成果：

### 1. 原始工程目标与规划思路
- **原始目标**:
${snapshot.originalTask}

- **前序推演与架构思绪**:
${snapshot.thought || "按既定规范开展模块化调研与修改。"}

### 2. 子任务攻坚结题成果
${reportsSummary}

---
请你作为后继主控智能体，以当前全新满额的推理配额，综合审阅上述交付物，执行交叉验证与必要测试。
若全部达成目标且验证充分，请直接输出 FINAL_ANSWER 完成结题；
若评估后需要第二阶段专项攻坚，可继续派发 invoke_subagent。`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/session/main-plan-snapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/main-plan-snapshot.ts tests/session/main-plan-snapshot.test.ts
git commit -m "feat(session): implement MainPlanSnapshot serialization and recovery engine"
```

---

### Task 2: 账号感知自适应队列调度核 (subagent-runner.ts)

**Files:**
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Test: `CPH-PI/tests/agent/subagent-queue.test.ts`

**Interfaces:**
- Consumes: `AccountPool.getPoolStatus()`, `SubagentTaskSpec`
- Produces: `SubagentRunner.executeBatch` supporting concurrency limiting:
  - If pool accounts count <= 1: concurrency = 1 (serial queue).
  - If pool accounts count > 1: concurrency = pool count (parallel).
  - Emits timeline log `SUBAGENT_QUEUE_SCHEDULED`.

- [ ] **Step 1: Write the failing test**

Create `CPH-PI/tests/agent/subagent-queue.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("SubagentRunner - Adaptive Account Queue", () => {
  it("should execute subagents serially when account pool has only 1 account", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;
    const executionOrder: string[] = [];

    const mockPool = {
      getPoolStatus: () => [{ email: "test@corp.com", active: true, isThrottled: false }],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_queue_1",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          executionOrder.push(opts.sessionId);
          await new Promise((r) => setTimeout(r, 20));
          activeCount--;
          return { completed: true, finalAnswer: "Task done: " + opts.sessionId };
        },
      }),
    });

    const tasks = [
      { role: "coder" as const, description: "Task 1", prompt: "p1" },
      { role: "coder" as const, description: "Task 2", prompt: "p2" },
      { role: "coder" as const, description: "Task 3", prompt: "p3" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(maxObservedActive).toBe(1); // Enforced strict sequential!
    expect(reports.every((r) => r.success)).toBe(true);
  });

  it("should allow parallel execution when account pool has multiple accounts", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;

    const mockPool = {
      getPoolStatus: () => [
        { email: "user1@corp.com", active: true, isThrottled: false },
        { email: "user2@corp.com", active: true, isThrottled: false },
        { email: "user3@corp.com", active: true, isThrottled: false },
      ],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_queue_2",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          await new Promise((r) => setTimeout(r, 30));
          activeCount--;
          return { completed: true, finalAnswer: "Parallel done" };
        },
      }),
    });

    const tasks = [
      { role: "coder" as const, description: "Task 1", prompt: "p1" },
      { role: "coder" as const, description: "Task 2", prompt: "p2" },
      { role: "coder" as const, description: "Task 3", prompt: "p3" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(maxObservedActive).toBeGreaterThan(1); // Parallel allowed!
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent/subagent-queue.test.ts`
Expected: FAIL (`maxObservedActive` will be 3 instead of 1 for test 1).

- [ ] **Step 3: Write minimal implementation**

In `CPH-PI/src/agent/subagent-runner.ts`, update `executeBatch`:
```typescript
  public async executeBatch(
    tasks: SubagentTaskSpec[],
    signal?: AbortSignal,
    events?: {
      onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec) => void;
      onSubagentEnd?: (report: SubagentTaskReport) => void;
      onSubagentProgress?: (id: string, turn: number, delta?: string) => void;
    }
  ): Promise<SubagentTaskReport[]> {
    const poolStatus = this.pool?.getPoolStatus?.() || [];
    const maxConcurrency = poolStatus.length <= 1 ? 1 : Math.min(poolStatus.length, tasks.length);

    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_QUEUE_SCHEDULED",
      totalTasks: tasks.length,
      maxConcurrency,
      poolSize: poolStatus.length,
      timestamp: Date.now(),
    });

    const settled: PromiseSettledResult<SubagentTaskReport>[] = new Array(tasks.length);

    if (maxConcurrency <= 1) {
      // Strict serial queue execution for single account protection
      for (let index = 0; index < tasks.length; index++) {
        if (signal?.aborted) {
          settled[index] = {
            status: "rejected",
            reason: new Error("Subagent execution aborted"),
          };
          continue;
        }
        const taskSpec = tasks[index];
        const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
        const role = taskSpec.role === "coder" ? "coder" : "researcher";
        try {
          const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
          settled[index] = { status: "fulfilled", value: report };
        } catch (err) {
          settled[index] = { status: "rejected", reason: err };
        }
      }
    } else {
      // Chunked or concurrent execution across multiple accounts
      const executing = tasks.map(async (taskSpec, index) => {
        const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
        const role = taskSpec.role === "coder" ? "coder" : "researcher";
        return this.runSingleSubagent(subId, role, taskSpec, signal, events);
      });
      const results = await Promise.allSettled(executing);
      for (let i = 0; i < results.length; i++) {
        settled[i] = results[i];
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agent/subagent-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/subagent-runner.ts tests/agent/subagent-queue.test.ts
git commit -m "feat(agent): implement account-aware adaptive concurrency queue in SubagentRunner"
```

---

### Task 3: 主会话拦截快照与云端连接主动脱钩 (orchestrator.ts)

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Test: `CPH-PI/tests/agent/orchestrator-virtualization.test.ts`

**Interfaces:**
- Consumes: `createMainPlanSnapshot`, `saveMainPlanSnapshot`
- Produces: `onMainSessionVirtualized` event callback, snapshot creation on `invoke_subagent`, release/disconnect of Sydney WebSocket client during subagent run.

- [ ] **Step 1: Write the failing test**

Create `CPH-PI/tests/agent/orchestrator-virtualization.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("Orchestrator - Main Session Virtualization Snapshot & Disconnect", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-orch-virt-" + Date.now());

  it("should create snapshot and emit onMainSessionVirtualized when invoke_subagent is called", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    let virtualizedEventFired = false;
    let snapshotPathFired = "";
    let clientDisconnected = false;

    const mockChatClient = {
      sendMessage: async () => {
        return {
          text: `THOUGHT: 需要调研并实施
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查配置
    prompt: 检查配置
\`\`\``,
        };
      },
      close: () => {
        clientDisconnected = true;
      },
    };

    const mockRunner = {
      executeBatch: async () => [
        {
          id: "sub-1",
          role: "researcher",
          description: "探查配置",
          success: true,
          finalAnswer: "配置无误",
          turnsCount: 1,
          durationMs: 500,
        },
      ],
      formatReportSummary: () => "子代理报告：配置无误",
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockChatClient as any,
      subagentRunner: mockRunner as any,
    });

    const result = await orchestrator.run({
      task: "优化配置系统",
      sessionId: "main_virt_test",
      events: {
        onMainSessionVirtualized: (snapshot, path) => {
          virtualizedEventFired = true;
          snapshotPathFired = path;
        },
      },
    });

    expect(virtualizedEventFired).toBe(true);
    expect(snapshotPathFired).toContain("main-plan-main_virt_test");
    expect(fs.existsSync(snapshotPathFired)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent/orchestrator-virtualization.test.ts`
Expected: FAIL (`virtualizedEventFired` is false).

- [ ] **Step 3: Write minimal implementation**

In `CPH-PI/src/agent/orchestrator.ts`:
1. Import `createMainPlanSnapshot, saveMainPlanSnapshot` from `../session/main-plan-snapshot.ts`.
2. Add to `OrchestratorEvents`:
   ```typescript
   onMainSessionVirtualized?: (snapshot: any, mdPath: string) => void;
   ```
3. When `parsed.action.tool === "invoke_subagent"`:
   ```typescript
   const thought = parsed.thought || (parsed as any).action?.thought || "";
   const subagents = (parsed.action as any).subagents || [];
   const snapshot = createMainPlanSnapshot({
     originalSessionId: this.sessionId,
     originalTask: task,
     thought,
     workspaceRoot: this.workspaceRoot,
     plannedSubagents: subagents,
   });
   const { mdPath } = saveMainPlanSnapshot(snapshot, this.workspaceRoot);
   events?.onMainSessionVirtualized?.(snapshot, mdPath);

   // Safely disconnect client WebSocket if close method exists to free cloud account
   try {
     (this.client as any)?.close?.();
   } catch {}
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agent/orchestrator-virtualization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-virtualization.test.ts
git commit -m "feat(orchestrator): capture lossless snapshot and release cloud connection on subagent dispatch"
```

---

### Task 4: 后继主会话代际自动接棒与成果注入循环 (orchestrator.ts)

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Test: `CPH-PI/tests/agent/orchestrator-successor-relay.test.ts`

**Interfaces:**
- Consumes: `formatSuccessorTurn1Prompt`, `SessionLineageTracker.linkSuccessor`
- Produces: `onSuccessorAwakened` event, automatic reset to successor generation with 30-turn budget and prompt injection.

- [ ] **Step 1: Write the failing test**

Create `CPH-PI/tests/agent/orchestrator-successor-relay.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("Orchestrator - Generational Successor Relay", () => {
  it("should awaken successor main session with fresh turns and Turn 1 injected prompt", async () => {
    let turns = 0;
    const tracker = new SessionLineageTracker();
    let successorFired = false;
    let successorIdSeen = "";

    const mockChatClient = {
      sendMessage: async (params: any) => {
        turns++;
        if (turns === 1) {
          return {
            text: `THOUGHT: 派发编码子任务
\`\`\`action
tool: invoke_subagent
subagents:
  - role: coder
    description: 编写核心模块
    prompt: 编写模块
\`\`\``,
          };
        }
        // Turn 2 is Turn 1 of successor!
        expect(params.text).toContain("【主控接力与成果审阅】");
        expect(params.text).toContain("模块编写完成并通过测试");
        return {
          text: "FINAL_ANSWER: 全部子任务验证通过，系统交付完成。",
        };
      },
    };

    const mockRunner = {
      executeBatch: async () => [
        {
          id: "sub-1",
          role: "coder",
          description: "编写核心模块",
          success: true,
          finalAnswer: "模块编写完成并通过测试",
          turnsCount: 2,
          durationMs: 800,
        },
      ],
      formatReportSummary: () => "### 🎯 子代理多会话并发执行报告: 模块编写完成并通过测试",
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      chatClient: mockChatClient as any,
      subagentRunner: mockRunner as any,
      lineageTracker: tracker,
    });

    const result = await orchestrator.run({
      task: "实现新功能",
      sessionId: "main_root_ses",
      events: {
        onSuccessorAwakened: (newSesId, gen) => {
          successorFired = true;
          successorIdSeen = newSesId;
        },
      },
    });

    expect(successorFired).toBe(true);
    expect(successorIdSeen).toContain("main_root_ses_gen");
    expect(tracker.resolveActiveHead("main_root_ses")).toBe(successorIdSeen);
    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("全部子任务验证通过");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent/orchestrator-successor-relay.test.ts`
Expected: FAIL (`successorFired` is false or prompt mismatch).

- [ ] **Step 3: Write minimal implementation**

In `CPH-PI/src/agent/orchestrator.ts`:
1. Add `onSuccessorAwakened?: (newSessionId: string, generation: number) => void;` to `OrchestratorEvents`.
2. Add private `generation: number = 1;`
3. After `runner.executeBatch` completes:
   ```typescript
   const summaryOutput = runner.formatReportSummary(reports);
   
   // Generational transition to Successor Main Session
   const prevSessionId = this.sessionId;
   this.generation++;
   const nextSessionId = `${this.sessionId.replace(/_gen\d+$/, "")}_gen${this.generation}`;
   this.sessionId = nextSessionId;
   this.conversationId = crypto.randomUUID(); // Fresh Sydney Conversation!
   this.lineageTracker?.linkSuccessor(prevSessionId, nextSessionId);

   events?.onSuccessorAwakened?.(nextSessionId, this.generation);

   // Prepare Turn 1 prompt for successor
   const turn1Prompt = formatSuccessorTurn1Prompt(snapshot, summaryOutput);
   turn = 0; // Reset turn counter for fresh 30 turns budget!
   nextPrompt = turn1Prompt;
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agent/orchestrator-successor-relay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator-successor-relay.test.ts
git commit -m "feat(orchestrator): implement generational successor main session relay and prompt injection"
```

---

### Task 5: TUI 虚拟化状态指示与生命周期横幅渲染 (tui-renderer.ts & cli.ts)

**Files:**
- Modify: `CPH-PI/src/ui/tui-renderer.ts`
- Modify: `CPH-PI/src/cli.ts`
- Test: `CPH-PI/tests/ui/tui-virtualization-banner.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface TuiRenderer {
    formatMainVirtualizationBanner(sessionId: string, snapshotPath: string): string;
    renderMainVirtualizationBanner(sessionId: string, snapshotPath: string): void;
    formatSuccessorAwakeningBanner(sessionId: string, generation: number): string;
    renderSuccessorAwakeningBanner(sessionId: string, generation: number): void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `CPH-PI/tests/ui/tui-virtualization-banner.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";

describe("TuiRenderer - Virtualization Banners", () => {
  it("should format Main Virtualization Banner with snapshot path", () => {
    const renderer = new TuiRenderer();
    const banner = renderer.formatMainVirtualizationBanner(
      "main_ses_1",
      ".cph/handoffs/main-plan-main_ses_1.md"
    );
    expect(banner).toContain("主控会话已虚拟化归档");
    expect(banner).toContain("main_ses_1");
    expect(banner).toContain(".cph/handoffs/main-plan-main_ses_1.md");
  });

  it("should format Successor Awakening Banner with generation", () => {
    const renderer = new TuiRenderer();
    const banner = renderer.formatSuccessorAwakeningBanner("main_ses_1_gen2", 2);
    expect(banner).toContain("第 2 代主控会话已唤醒");
    expect(banner).toContain("main_ses_1_gen2");
    expect(banner).toContain("30 轮");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/tui-virtualization-banner.test.ts`
Expected: FAIL (`formatMainVirtualizationBanner` is not a function).

- [ ] **Step 3: Write minimal implementation**

In `CPH-PI/src/ui/tui-renderer.ts`:
```typescript
  public formatMainVirtualizationBanner(sessionId: string, snapshotPath: string): string {
    const border = "─".repeat(60);
    return [
      chalk.cyan(`┌${border}┐`),
      chalk.cyan(`│ 📌 [主控会话已虚拟化归档] ${sessionId.padEnd(35)} │`),
      chalk.cyan(`│ 宏观规划快照已落盘: ${snapshotPath.padEnd(40)} │`),
      chalk.cyan(`│ 云端连接已安全释放，子任务开始受限排队攻坚...             │`),
      chalk.cyan(`└${border}┘`),
    ].join("\n");
  }

  public renderMainVirtualizationBanner(sessionId: string, snapshotPath: string): void {
    process.stdout.write("\n" + this.formatMainVirtualizationBanner(sessionId, snapshotPath) + "\n\n");
  }

  public formatSuccessorAwakeningBanner(sessionId: string, generation: number): string {
    const border = "─".repeat(60);
    return [
      chalk.green(`┌${border}┐`),
      chalk.green(`│ 🚀 [第 ${generation} 代主控会话已唤醒] ${sessionId.padEnd(33)} │`),
      chalk.green(`│ 注入前序架构快照与子任务结题成果，重置满额 30 轮推理预算   │`),
      chalk.green(`│ 进入系统交叉验证与交付审阅阶段...                        │`),
      chalk.green(`└${border}┘`),
    ].join("\n");
  }

  public renderSuccessorAwakeningBanner(sessionId: string, generation: number): void {
    process.stdout.write("\n" + this.formatSuccessorAwakeningBanner(sessionId, generation) + "\n\n");
  }
```

In `CPH-PI/src/cli.ts`:
Wire `onMainSessionVirtualized` and `onSuccessorAwakened` to call renderer's banners.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ui/tui-virtualization-banner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/tui-renderer.ts src/cli.ts tests/ui/tui-virtualization-banner.test.ts
git commit -m "feat(ui): add virtualization archival and successor awakening banners to TUI"
```

---

### Task 6: 全链路虚拟化与自适应排队集成回归测试

**Files:**
- Create: `CPH-PI/tests/integration/virtualization-relay-e2e.test.ts`

- [ ] **Step 1: Write integration test**

Create `CPH-PI/tests/integration/virtualization-relay-e2e.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("End-to-End Virtualization & Adaptive Queue Integration", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-virt-e2e-" + Date.now());

  it("should complete full autonomous pipeline: Main-1 -> snapshot -> serial subagents -> Main-2 review -> final answer", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    const tracker = new SessionLineageTracker();
    const mockPool = {
      getPoolStatus: () => [{ email: "user@corp.com", active: true, isThrottled: false }],
    };

    let chatTurns = 0;
    const mockChatClient = {
      sendMessage: async (params: any) => {
        chatTurns++;
        if (chatTurns === 1) {
          // Main-1 Turn 1
          return {
            text: `THOUGHT: 需要先调研再编写单元测试
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查接口定义
    prompt: 检查接口
  - role: coder
    description: 编写单元测试
    prompt: 补充测试
\`\`\``,
          };
        }
        // Main-2 Turn 1
        expect(params.text).toContain("【主控接力与成果审阅】");
        expect(params.text).toContain("检查接口完成");
        expect(params.text).toContain("补充测试完成");
        return {
          text: "FINAL_ANSWER: 经主控交叉审阅，所有子任务交付达标，端到端验证通过。",
        };
      },
    };

    const runner = new SubagentRunner({
      workspaceRoot: tmpDir,
      mainSessionId: "main_e2e_root",
      pool: mockPool as any,
      lineageTracker: tracker,
      createOrchestratorFn: (opts: any) => ({
        run: async () => ({
          completed: true,
          finalAnswer: opts.task.includes("检查") ? "检查接口完成" : "补充测试完成",
        }),
      }),
    });

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockChatClient as any,
      subagentRunner: runner,
      lineageTracker: tracker,
      pool: mockPool as any,
    });

    const result = await orchestrator.run({
      task: "端到端系统功能增强",
      sessionId: "main_e2e_root",
    });

    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("端到端验证通过");

    // Check lineage
    const activeHead = tracker.resolveActiveHead("main_e2e_root");
    expect(activeHead).toContain("main_e2e_root_gen2");

    // Check snapshot file was created
    const snapshotPath = path.join(tmpDir, ".cph", "handoffs", "main-plan-main_e2e_root.md");
    expect(fs.existsSync(snapshotPath)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `bun test tests/integration/virtualization-relay-e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Run full regression test suite**

Run: `bun test`
Expected: ALL PASS across all 55+ test files!

- [ ] **Step 4: Commit**

```bash
git add tests/integration/virtualization-relay-e2e.test.ts
git commit -m "test(integration): verify end-to-end main session virtualization and adaptive queue relay"
```
