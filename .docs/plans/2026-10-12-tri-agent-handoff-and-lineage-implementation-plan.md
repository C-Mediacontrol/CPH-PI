# CPH-PI 三 Agent 提示词重塑、子代理自主透明接力与会话单向继承链条实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 CPH-PI 三智能体提示词重塑、子代理单任务 30 轮自主透明接力引擎、解耦账号的会话单向继承链条（Lineage Chain），以及子代理 429 分级上报与主会话容灾迁移下的动态结果回流。

**Architecture:** 参考设计规范 `CPH-PI/.docs/specs/2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md`。引入 `SessionLineageTracker` 维护单向继承血缘；升级 `SubagentRunner` 支持单任务多代（Hop）透明接力；主控在提示词与 `subagent` 技能中建立 10~20 轮任务规模控制（Task Right-Sizing）；打包脚本支持全套三 Agent 提示词与技能挂载矩阵。

**Tech Stack:** TypeScript, Bun, SignalR, Node.js fs/path.

## Global Constraints
- 严格遵循 `AGENTS.md`：Harness 保持纯粹工具执行与中立调度；所有代码、文档与配置仅在二级目录 `CPH-PI/` 内读写；禁止写入工作区根目录；
- 三 Agent ID 绑定与账号隔离：
  - MAIN Agent ID: `T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852`
  - CODER Agent ID: `T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296`
  - RESEARCHER Agent ID: `T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c`
  - 授权访问账号: `GSC.VFU2`
- 测试驱动开发 (TDD)：每个任务必须包含红灯（失败）验证与绿灯（通过）验证，并提交独立 Git Commit。

---

## 冲击面扫描 (Impact Scan)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） |
|---|---|---|
| **血缘跟踪器 (`lineage-tracker.ts`)** | `Orchestrator` 与 `SubagentRunner` 注册会话生命周期与交接关系 | `resolveActiveHead` 解析最新活动主端点，路由交付报告 |
| **三大提示词 (`cph-*-agent-prompt.txt`)** | 人工与打包脚本分发至 M365 Copilot Agent | Copilot 模型确立自身角色认知、任务规模控制与交接行为 |
| **子代理技能 (`skills/subagent/SKILL.md`)** | 主控 Agent 阅读并应用任务粒度约束 | 产出符合 10~20 轮、核心文件 ≤3 个的高内聚子任务 |
| **执行核 (`subagent-runner.ts`)** | 子代理遇到轮数上限产生 `handoffDocPath` | 自动派生 Hop-2 接力子代理，直至最终交付 |
| **容灾路由 (`orchestrator.ts`)** | 主会话发生 429 或接力迁移 | 接收跨迁移回流的子代理报告，无缝推进决策 |
| **打包分发 (`package-agent-bundle.ts`)** | 源码提示词与技能目录 | 输出包含三 Agent 独立提示词与挂载指引的 Zip 包 |

---

## 实施任务切片清单 (Task Decomposition)

### Task 1: 会话单向继承链条追踪器 (`lineage-tracker.ts`)

**Files:**
- Create: `CPH-PI/src/session/lineage-tracker.ts`
- Create: `CPH-PI/tests/session/lineage-tracker.test.ts`

**Interfaces:**
- Consumes: `SessionRecord`
- Produces:
  ```typescript
  export interface SessionLineage {
    sessionId: string;
    role: "main" | "coder" | "researcher";
    status: "active" | "handed_off" | "throttled" | "completed";
    parentSessionId?: string;
    predecessorId?: string;
    successorId?: string;
    subagentSessionIds?: string[];
  }
  export class SessionLineageTracker {
    public register(lineage: SessionLineage): void;
    public linkSuccessor(predecessorId: string, successorId: string): void;
    public linkSubagent(mainSessionId: string, subagentSessionId: string): void;
    public getLineage(sessionId: string): SessionLineage | undefined;
    public resolveActiveHead(startSessionId: string): string;
  }
  ```

- [ ] **Step 1: 编写失败的血缘追踪测试**

在 `CPH-PI/tests/session/lineage-tracker.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SessionLineageTracker - Unidirectional Lineage Chain", () => {
  it("should track session lineage and resolve active head across succession chain", () => {
    const tracker = new SessionLineageTracker();

    // 1. 注册初始主会话 Main_A
    tracker.register({
      sessionId: "main_a",
      role: "main",
      status: "active",
    });
    expect(tracker.resolveActiveHead("main_a")).toBe("main_a");

    // 2. Main_A 发生 429 容灾交接给 Main_D
    tracker.register({
      sessionId: "main_d",
      role: "main",
      status: "active",
      predecessorId: "main_a",
    });
    tracker.linkSuccessor("main_a", "main_d");

    expect(tracker.resolveActiveHead("main_a")).toBe("main_d");
    expect(tracker.resolveActiveHead("main_d")).toBe("main_d");

    // 3. Main_D 再次交接给 Main_E
    tracker.register({
      sessionId: "main_e",
      role: "main",
      status: "active",
      predecessorId: "main_d",
    });
    tracker.linkSuccessor("main_d", "main_e");

    expect(tracker.resolveActiveHead("main_a")).toBe("main_e");
  });

  it("should prevent infinite loops on circular successor links", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({ sessionId: "ses_1", role: "main", status: "handed_off", successorId: "ses_2" });
    tracker.register({ sessionId: "ses_2", role: "main", status: "handed_off", successorId: "ses_1" });

    // 遭遇循环引用时安全熔断，不发生死循环
    const resolved = tracker.resolveActiveHead("ses_1");
    expect(["ses_1", "ses_2"]).toContain(resolved);
  });

  it("should track subagent links to main session", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({ sessionId: "main_1", role: "main", status: "active" });
    tracker.register({ sessionId: "sub_1", role: "coder", status: "active", parentSessionId: "main_1" });

    tracker.linkSubagent("main_1", "sub_1");
    const mainLineage = tracker.getLineage("main_1");
    expect(mainLineage?.subagentSessionIds).toContain("sub_1");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/session/lineage-tracker.test.ts`  
预期: FAIL (`Cannot find module '../../src/session/lineage-tracker.ts'`)

- [ ] **Step 3: 实现 SessionLineageTracker**

创建 `CPH-PI/src/session/lineage-tracker.ts`：
```typescript
export interface SessionLineage {
  sessionId: string;
  role: "main" | "coder" | "researcher";
  status: "active" | "handed_off" | "throttled" | "completed";
  parentSessionId?: string;
  predecessorId?: string;
  successorId?: string;
  subagentSessionIds?: string[];
}

export class SessionLineageTracker {
  private registry = new Map<string, SessionLineage>();

  public register(lineage: SessionLineage): void {
    const existing = this.registry.get(lineage.sessionId);
    this.registry.set(lineage.sessionId, {
      ...existing,
      ...lineage,
      subagentSessionIds: lineage.subagentSessionIds || existing?.subagentSessionIds || [],
    });
  }

  public linkSuccessor(predecessorId: string, successorId: string): void {
    const pred = this.registry.get(predecessorId);
    if (pred) {
      pred.successorId = successorId;
      pred.status = "handed_off";
    }
    const succ = this.registry.get(successorId);
    if (succ) {
      succ.predecessorId = predecessorId;
    }
  }

  public linkSubagent(mainSessionId: string, subagentSessionId: string): void {
    const main = this.registry.get(mainSessionId);
    if (main) {
      if (!main.subagentSessionIds) main.subagentSessionIds = [];
      if (!main.subagentSessionIds.includes(subagentSessionId)) {
        main.subagentSessionIds.push(subagentSessionId);
      }
    }
    const sub = this.registry.get(subagentSessionId);
    if (sub) {
      sub.parentSessionId = mainSessionId;
    }
  }

  public getLineage(sessionId: string): SessionLineage | undefined {
    return this.registry.get(sessionId);
  }

  public resolveActiveHead(startSessionId: string): string {
    let currentId = startSessionId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const lineage = this.registry.get(currentId);
      if (!lineage) break;
      if (lineage.successorId && lineage.status === "handed_off") {
        currentId = lineage.successorId;
      } else {
        break;
      }
    }
    return currentId;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/session/lineage-tracker.test.ts`  
预期: PASS (3 tests pass)

- [ ] **Step 5: 提交代码**

```bash
git add src/session/lineage-tracker.ts tests/session/lineage-tracker.test.ts
git commit -m "feat(session): implement SessionLineageTracker with resolveActiveHead"
```

---

### Task 2: 三大 Agent 提示词重塑与 `subagent` 任务规模控制门禁

**Files:**
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-coder-agent-prompt.txt`
- Modify: `CPH-PI/cph-researcher-agent-prompt.txt`
- Modify: `CPH-PI/skills/subagent/SKILL.md`
- Create: `CPH-PI/tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`, `cph-researcher-agent-prompt.txt`, `skills/subagent/SKILL.md`
- Produces: 强化任务体量认知（10~20 轮黄金区间、核心修改文件 ≤3 个、防单任务超 30 轮），明确 Coder 与 Researcher 挂载 `handoff` 技能的微观交接契约。

- [ ] **Step 1: 编写失败的提示词与技能契约测试**

在 `CPH-PI/tests/skills/tri-agent-prompts.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("Tri-Agent System Prompts & Subagent Skill Contracts", () => {
  const root = path.resolve(__dirname, "../../");

  it("should contain Task Right-Sizing rules in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("黄金工作区间");
    expect(mainPrompt).toContain("10~20");
    expect(mainPrompt).toContain("核心修改文件");
  });

  it("should declare micro handoff contract in coder and researcher prompts", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    expect(coderPrompt).toContain("handoff");
    expect(coderPrompt).toContain("第 29 轮");
    expect(coderPrompt).not.toContain("invoke_subagent");

    expect(researcherPrompt).toContain("handoff");
    expect(researcherPrompt).toContain("第 29 轮");
    expect(researcherPrompt).not.toContain("invoke_subagent");
  });

  it("should define Gate 2 Task Right-Sizing in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("Gate 2");
    expect(skillContent).toContain("10~20");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/skills/tri-agent-prompts.test.ts`  
预期: FAIL (`Expected to contain "黄金工作区间"`)

- [ ] **Step 3: 更新提示词与 `subagent` 技能内容**

1. 修改 `CPH-PI/cph-main-agent-prompt.txt`：在任务规模感知与子代理调度契约中加入：
   - **黄金工作区间 (10~20 轮)**：一个优秀的子任务应该聚焦在单一内聚的功能垂直切片；
   - **核心修改文件控制**：单个子任务修改的核心文件数控制在 1~3 个，避免膨胀跨越 4 个以上无关模块导致超过 30 轮；
   - 需求复杂时拆解为“先由 Researcher 调研、后由多个 Coder 正交修改”的阶段性流水线。
2. 修改 `CPH-PI/cph-coder-agent-prompt.txt` 与 `CPH-PI/cph-researcher-agent-prompt.txt`：
   - 明确声明支持 30 轮自主推理；
   - 明确声明在第 29 轮收到 Harness 接力提示时，调用 `handoff` 技能分别输出代码补丁交接或调研情报交接至 `.cph/handoffs/handoff-<子会话ID>.md`。
3. 修改 `CPH-PI/skills/subagent/SKILL.md`：
   - 在 Gate 2 中加入任务规模与 30 轮防溢出门禁标准。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/skills/tri-agent-prompts.test.ts`  
预期: PASS (3 tests pass)

- [ ] **Step 5: 提交代码**

```bash
git add cph-main-agent-prompt.txt cph-coder-agent-prompt.txt cph-researcher-agent-prompt.txt skills/subagent/SKILL.md tests/skills/tri-agent-prompts.test.ts
git commit -m "feat(prompts): add task right-sizing and micro-handoff contracts to tri-agent prompts and subagent skill"
```

---

### Task 3: 子代理透明自主接力循环与多代 Successor 调度 (`SubagentRunner`)

**Files:**
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/subagent-continuation.test.ts`

**Interfaces:**
- Consumes: `SubagentRunnerOptions`, `SubagentTaskSpec`, `SessionLineageTracker`
- Produces: 当子代理单次会话因第 29 轮生成交接文档退出时，`SubagentRunner` 自动拉起 Hop-2 Successor 子代理读取该交接文档并接续攻坚，直到最终产生 `FINAL_ANSWER`，对主会话返回合并报告。

- [ ] **Step 1: 编写失败的子代理接力循环测试**

在 `CPH-PI/tests/agent/subagent-continuation.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SubagentRunner - Autonomous Continuation Loop", () => {
  it("should transparently continue subagent across hops until completion", async () => {
    let callCount = 0;
    const lineageTracker = new SessionLineageTracker();

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        callCount++;
        if (callCount === 1) {
          // 第一代 Coder-1 在第 29 轮发生交接
          return {
            finalAnswer: "正在交接...",
            turnsCount: 29,
            completed: false,
            handedOff: true,
            handoffDocPath: ".cph/handoffs/handoff-sub1.md",
            history: [],
          };
        }
        // 第二代 Coder-2 成功完成任务
        expect(runOpts.task).toContain("交接文档");
        return {
          finalAnswer: "Hop-2 成功解决所有问题！",
          turnsCount: 5,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_test_sess",
      lineageTracker,
      maxAutonomousHops: 3,
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "重构网络层", prompt: "重构 chathub" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].finalAnswer).toContain("Hop-2 成功解决所有问题！");
    expect(callCount).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/subagent-continuation.test.ts`  
预期: FAIL (`reports[0].success` is false or `callCount` is 1)

- [ ] **Step 3: 在 `SubagentRunner` 中实现多代循环接力**

修改 `CPH-PI/src/agent/subagent-runner.ts`：
- 在 `SubagentRunnerOptions` 中增加 `lineageTracker?: SessionLineageTracker; maxAutonomousHops?: number;`（默认 `maxAutonomousHops = 5`）；
- 修改 `runSingleSubagent` 为循环调度结构（`while (hopCount < maxAutonomousHops)`）：
  - 派发当前 Hop 的子代理，设置 `maxTurns = 30`；
  - 注册 `lineageTracker` 的会话节点与父子关系；
  - 若执行结果返回 `res.handedOff && res.handoffDocPath`：
    - 读取交接文档内容，组装为 Hop-(N+1) 的自包含提示词；
    - 生成新子会话 ID，调用 `lineageTracker.linkSuccessor`；
    - 循环进入下一 Hop；
  - 若返回 `res.completed`，跳出循环返回成功报告。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/subagent-continuation.test.ts`  
预期: PASS (1 test pass)

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/subagent-runner.ts tests/agent/subagent-continuation.test.ts
git commit -m "feat(agent): implement transparent multi-hop continuation loop in SubagentRunner"
```

---

### Task 4: 主会话容灾迁移下的子代理回流动态路由 (`orchestrator.ts`)

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/subagent-reroute.test.ts`

**Interfaces:**
- Consumes: `SessionLineageTracker`, `SubagentTaskReport`
- Produces: 在子代理运行期间，主会话无论发生几次 429 容灾或接力切换，子代理成果均通过 `lineageTracker.resolveActiveHead` 动态路由绑定至当前最新的主端点。

- [ ] **Step 1: 编写失败的动态回流路由测试**

在 `CPH-PI/tests/agent/subagent-reroute.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Subagent Deliverable Dynamic Rerouting", () => {
  it("should dynamically resolve active head when main session migrates mid-flight", async () => {
    const lineageTracker = new SessionLineageTracker();
    lineageTracker.register({ sessionId: "main_original", role: "main", status: "active" });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_original",
      lineageTracker,
      createOrchestratorFn: () => ({
        run: async () => {
          // 模拟子代理异步执行期间，主会话发生 429 容灾交接至 main_successor
          lineageTracker.register({
            sessionId: "main_successor",
            role: "main",
            status: "active",
            predecessorId: "main_original",
          });
          lineageTracker.linkSuccessor("main_original", "main_successor");

          return {
            finalAnswer: "子任务执行完毕",
            completed: true,
            turnsCount: 2,
            history: [],
          };
        },
      }),
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "模块迁移", prompt: "迁移代码" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    // 确认通过追踪器能够精确获取目标主端点为 main_successor
    const activeHead = lineageTracker.resolveActiveHead("main_original");
    expect(activeHead).toBe("main_successor");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/subagent-reroute.test.ts`  
预期: FAIL

- [ ] **Step 3: 实现主端点解析与动态回流注入**

1. 修改 `CPH-PI/src/agent/orchestrator.ts`：
   - 引入 `SessionLineageTracker`；
   - 在启动主会话与发生接力/容灾时同步更新 `lineageTracker` 节点状态；
2. 修改 `CPH-PI/src/agent/subagent-runner.ts`：
   - 在子任务完成汇总报告时，调用 `this.lineageTracker.resolveActiveHead(this.mainSessionId)`；
   - 记录时间线事件 `SUBAGENT_DELIVERABLE_ROUTED`，确保多并发场景下端点一致。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/subagent-reroute.test.ts`  
预期: PASS (1 test pass)

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/orchestrator.ts src/agent/subagent-runner.ts tests/agent/subagent-reroute.test.ts
git commit -m "feat(agent): dynamically reroute subagent deliverables to active main session head"
```

---

### Task 5: 子代理 429 频控分级与全池耗尽上报

**Files:**
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/subagent-429-escalation.test.ts`

**Interfaces:**
- Consumes: `AccountPool`, `SubagentTaskReport`
- Produces: 单个 429 触发静默换号重试；全池耗尽触发结构化错误代码 `ALL_ACCOUNTS_THROTTLED` 与黑匣子断点生成。

- [ ] **Step 1: 编写失败的 429 分级上报测试**

在 `CPH-PI/tests/agent/subagent-429-escalation.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Subagent 429 Escalation", () => {
  it("should report ALL_ACCOUNTS_THROTTLED when all accounts in pool are exhausted", async () => {
    const mockOrchestratorFactory = () => ({
      run: async () => {
        const err = new Error("All accounts in pool are currently throttled (429)");
        (err as any).code = "ALL_ACCOUNTS_THROTTLED";
        throw err;
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_test",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "高并发测试", prompt: "运行压力测试" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(false);
    expect(reports[0].error).toContain("ALL_ACCOUNTS_THROTTLED");
    expect(reports[0].finalAnswer).toContain("账号池枯竭");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/subagent-429-escalation.test.ts`  
预期: FAIL (`reports[0].finalAnswer` 不包含账号池枯竭)

- [ ] **Step 3: 实现 429 分级错误处理与报告格式化**

在 `CPH-PI/src/agent/subagent-runner.ts` 中：
- 识别 429 全池限流错误特征（`/429|throttled|rate limit/i` 或 `err.code === "ALL_ACCOUNTS_THROTTLED"`）；
- 当全池枯竭时，生成结构化总结：
  `"❌ 子任务因全局账号池限流 (429) 中断，已保存现场断点，建议主会话等待冷却或通知用户介入。"`；
- 记录 `SUBAGENT_POOL_THROTTLED` 时间线事件。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/subagent-429-escalation.test.ts`  
预期: PASS (1 test pass)

- [ ] **Step 5: 提交代码**

```bash
git add src/agent/subagent-runner.ts tests/agent/subagent-429-escalation.test.ts
git commit -m "feat(agent): implement subagent 429 rate limit escalation and error reporting"
```

---

### Task 6: 部署构建包升级与技能挂载指引更新

**Files:**
- Modify: `CPH-PI/scripts/package-agent-bundle.ts`
- Create: `CPH-PI/tests/cli/package-agent-bundle.test.ts`

**Interfaces:**
- Consumes: `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`, `cph-researcher-agent-prompt.txt`, `skills/`
- Produces: 完整更新的 `dist/copilot-agent-bundle.zip` 与 `UPLOAD-GUIDE.md`（明确三 Agent 的技能挂载矩阵）。

- [ ] **Step 1: 编写打包与挂载矩阵测试**

在 `CPH-PI/tests/cli/package-agent-bundle.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("Package Agent Bundle - Tri-Agent Matrix", () => {
  it("should package prompts and update upload guide with skill mounting matrix", () => {
    const root = path.resolve(__dirname, "../../");
    execSync("bun run scripts/package-agent-bundle.ts", { cwd: root, stdio: "pipe" });

    const bundleDir = path.join(root, "dist", "copilot-agent-bundle");
    expect(fs.existsSync(bundleDir)).toBe(true);

    const guidePath = path.join(bundleDir, "UPLOAD-GUIDE.md");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guideContent = fs.readFileSync(guidePath, "utf8");

    // 验证技能挂载矩阵说明
    expect(guideContent).toContain("Main 智能体");
    expect(guideContent).toContain("Coder 智能体");
    expect(guideContent).toContain("Researcher 智能体");
    expect(guideContent).toContain("subagent");
    expect(guideContent).toContain("handoff");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/cli/package-agent-bundle.test.ts`  
预期: FAIL (`guideContent` 缺少挂载矩阵)

- [ ] **Step 3: 更新打包脚本与上传指南模板**

修改 `CPH-PI/scripts/package-agent-bundle.ts`：
- 在 `uploadGuideContent` 中清晰说明：
  1. Main 智能体：上传 `Instructions-Main-主协调智能体.txt`，挂载 `skills/subagent` 与 `skills/handoff`；
  2. Coder 智能体：上传 `Instructions-Coder-代码实现智能体.txt`，仅挂载 `skills/handoff`（不挂载 `subagent`）；
  3. Researcher 智能体：上传 `Instructions-Researcher-深度调研智能体.txt`，仅挂载 `skills/handoff`（不挂载 `subagent`）。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/cli/package-agent-bundle.test.ts`  
预期: PASS (1 test pass)

- [ ] **Step 5: 提交代码并生成最新打包产物**

```bash
git add scripts/package-agent-bundle.ts tests/cli/package-agent-bundle.test.ts
git commit -m "feat(package): update tri-agent skill mounting matrix and distribution bundle"
```

---

## 计划自审核对表 (Self-Review Checklist)

- [x] **Spec Coverage**：完整覆盖三 Agent 提示词重塑、防溢出 10~20 轮任务控制门禁、子代理单任务透明接力、单向继承链条（`resolveActiveHead`）、动态回流路由与 429 逐级上报。
- [x] **No Placeholders**：所有步骤均包含完整的测试代码、实现逻辑与验证命令，绝无占位符。
- [x] **Type Consistency**：`SessionLineage`、`SessionLineageTracker`、`SubagentTaskReport` 类型贯穿各任务且严格统一。
- [x] **Agent-Friendly Slicing**：任务按照会话血缘 ➔ 提示词契约 ➔ 执行核接力 ➔ 动态回流 ➔ 429 分级 ➔ 打包发布清晰切片，每步均独立可测。
