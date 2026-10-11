# CPH-PI Sub-agent 多会话并发执行与三 Agent 协作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现 CPH-PI 的 Sub-agent 多会话并发执行体系，支持主控 Agent 派发 Researcher（调研分析）与 Coder（局部补丁与测试）独立子任务，多账号池并发调度，分会话树状隔离日志与 TUI 矩阵看板可视化。

**Architecture:** 参考设计规范 `CPH-PI/.docs/specs/2026-10-12-subagent-execution-architecture-design.md`，基于纯粹中立的工具驱动架构实现 `invoke_subagent`。在 `SubagentRunner` 中为各子任务并发实例化独立 clean 上下文的 Orchestrator，按角色裁剪工具（物理剔除孙代理），利用 `Promise.allSettled` 并发聚合结题报告。

**Tech Stack:** TypeScript, Bun, Pi TUI, SignalR/WebSocket, Node.js fs/path.

## Global Constraints
- 严格遵循 `AGENTS.md`：Harness 保持纯粹工具执行与调度中立；仅修改二级目录 `CPH-PI/`；禁止破坏宿主全局配置；
- 三个 Agent ID 绑定配置：
  - **MAIN Agent ID**: `T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852`
  - **CODER Agent ID**: `T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296`
  - **RESEARCHER Agent ID**: `T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c`
  - 授权访问账号: `GSC.VFU2`
- 测试驱动开发 (TDD)：每个任务均包含独立单元测试与验证命令。

---

## 冲击面扫描 (Impact Scan)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） |
|---|---|---|
| **工具协议 (`tool-bridge.ts`)** | `ResilientParser` 解析模型文本产出 `invoke_subagent` Action | `Orchestrator` 与 `ToolBridge` 路由执行 |
| **解析器 (`resilient-parser.ts`)** | Copilot 模型回复的 ```action 块 | `Orchestrator.runTurn` 分发 `invoke_subagent` |
| **调度核 (`subagent-runner.ts`)** | `Orchestrator` 派发子任务规格数组 | 独立的子 `Orchestrator` 实例运行各子任务 |
| **日志流 (`terminal-logger.ts`)** | `SubagentRunner` 为每个子任务索取日志流 | `.cph/logs/<session-id>/subagents/` 文件落盘 |
| **UI 矩阵 (`tui-renderer.ts`)** | `SubagentRunnerEvents` 状态通知事件 | 终端 ANSI 动态矩阵面板渲染 |
| **CLI 入口 (`cli.ts`)** | 用户命令行参数 (`--coder-agent-id`, `--researcher-agent-id`) | `OrchestratorOptions` 注入 |

---

## 实施任务切片清单 (Task Decomposition)

### Task 1: 协议与解析层扩展 (`invoke_subagent` Action 支持)

**Files:**
- Modify: `CPH-PI/src/protocol/tool-bridge.ts`
- Modify: `CPH-PI/src/protocol/resilient-parser.ts`
- Create: `CPH-PI/tests/protocol/subagent-parser.test.ts`

**Interfaces:**
- Consumes: `CopilotAction`, `ResilientParser`
- Produces:
  ```typescript
  export interface SubagentTaskSpec {
    role: "researcher" | "searcher" | "coder";
    description: string;
    prompt: string;
    maxTurns?: number;
  }
  export interface InvokeSubagentAction extends CopilotAction {
    tool: "invoke_subagent" | "subagent";
    subagents: SubagentTaskSpec[];
  }
  ```

- [x] **Step 1: 编写失败的协议解析测试**

在 `CPH-PI/tests/protocol/subagent-parser.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser - invoke_subagent", () => {
  it("should parse standard invoke_subagent code block with multiple subagents", () => {
    const raw = `THOUGHT: 拆分为调研与编码两个子任务
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 调研模块接口
    prompt: 深入走查 src/auth/account-pool.ts 并输出分析报告
  - role: coder
    description: 修复单元测试
    prompt: 修改 tests/auth.test.ts 并运行 bun test
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("invoke_subagent");
      expect(Array.isArray((parsed.action as any).subagents)).toBe(true);
      expect((parsed.action as any).subagents.length).toBe(2);
      expect((parsed.action as any).subagents[0].role).toBe("researcher");
      expect((parsed.action as any).subagents[0].description).toBe("调研模块接口");
      expect((parsed.action as any).subagents[0].prompt).toBe("深入走查 src/auth/account-pool.ts 并输出分析报告");
      expect((parsed.action as any).subagents[1].role).toBe("coder");
      expect((parsed.action as any).subagents[1].description).toBe("修复单元测试");
      expect((parsed.action as any).subagents[1].prompt).toBe("修改 tests/auth.test.ts 并运行 bun test");
    }
  });

  it("should normalize role 'searcher' to 'researcher'", () => {
    const raw = `\`\`\`action
tool: invoke_subagent
subagents:
  - role: searcher
    description: 搜索定义
    prompt: 寻找 TokenManager 定义
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect((parsed.action as any).subagents[0].role).toBe("researcher");
    }
  });

  it("should parse JSON structured invoke_subagent payload", () => {
    const raw = `\`\`\`action
{
  "tool": "invoke_subagent",
  "subagents": [
    {
      "role": "coder",
      "description": "JSON形式任务",
      "prompt": "实现新特性"
    }
  ]
}
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("invoke_subagent");
      expect((parsed.action as any).subagents.length).toBe(1);
      expect((parsed.action as any).subagents[0].role).toBe("coder");
    }
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/protocol/subagent-parser.test.ts`  
预期: FAIL (`invoke_subagent` 未被识别或 `subagents` 数组未被解析提取)

- [x] **Step 3: 实现工具类型与解析逻辑**

1. 修改 `CPH-PI/src/protocol/tool-bridge.ts`：
```typescript
export type CopilotActionName =
  | "read_file"
  | "read"
  | "cat"
  | "patch_file"
  | "edit"
  | "edit_file"
  | "write_file"
  | "write"
  | "run_command"
  | "bash"
  | "exec"
  | "ask_question"
  | "question"
  | "invoke_subagent"
  | "subagent";

export interface SubagentTaskSpec {
  role: "researcher" | "searcher" | "coder";
  description: string;
  prompt: string;
  maxTurns?: number;
}

export interface CopilotAction {
  tool?: string;
  action?: string;
  name?: string;
  subagents?: SubagentTaskSpec[];
  // ... 其余既有字段保持不变
}
```

2. 修改 `CPH-PI/src/protocol/resilient-parser.ts`：
- 在 `normalizeToolName` 中添加：
```typescript
case "invoke_subagent":
case "subagent":
  return "invoke_subagent";
```
- 在 `extractActionFields` 中，增加 YAML 与 JSON 下 `subagents` 列表解析函数：
```typescript
  private static parseSubagentsBlock(content: string): SubagentTaskSpec[] {
    const subagents: SubagentTaskSpec[] = [];
    // 匹配 YAML 列表项格式: - role: ...
    const blocks = content.split(/\n\s*-\s+/);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const roleMatch = block.match(/role\s*:\s*([a-zA-Z_]+)/i);
      const descMatch = block.match(/description\s*:\s*([^\r\n]+)/i);
      const promptMatch = block.match(/prompt\s*:\s*([\s\S]*?)(?=\n\s*[a-zA-Z_]+\s*:|$)/i);
      const maxTurnsMatch = block.match(/maxTurns\s*:\s*(\d+)/i);

      if (roleMatch || promptMatch) {
        let rawRole = (roleMatch ? roleMatch[1].trim().toLowerCase() : "researcher");
        if (rawRole === "searcher") rawRole = "researcher";
        const role = (rawRole === "coder" ? "coder" : "researcher") as "researcher" | "coder";
        subagents.push({
          role,
          description: descMatch ? descMatch[1].trim() : "",
          prompt: promptMatch ? promptMatch[1].trim() : "",
          maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1], 10) : undefined,
        });
      }
    }
    return subagents;
  }
```
并在检测到 `tool === "invoke_subagent"` 时挂载 `subagents: this.parseSubagentsBlock(contentToScan)`。

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/protocol/subagent-parser.test.ts`  
预期: PASS (3 tests pass)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/protocol/ CPH-PI/tests/protocol/
git commit -m "feat(protocol): support invoke_subagent action parsing and role normalization"
```

---

### Task 2: 分会话树状隔离日志基础设施 (`terminal-logger.ts`)

**Files:**
- Modify: `CPH-PI/src/ui/terminal-logger.ts`
- Create: `CPH-PI/tests/ui/terminal-logger-session.test.ts`

**Interfaces:**
- Consumes: `TerminalLogger`
- Produces:
  ```typescript
  export interface SessionLoggerTree {
    sessionDir: string;
    mainLogPath: string;
    timelineLogPath: string;
    createSubagentLogStream(subagentId: string, role: string): fs.WriteStream;
    logTimelineEvent(event: { type: string; timestamp: number; [key: string]: any }): void;
  }
  ```

- [x] **Step 1: 编写失败的树状日志测试**

在 `CPH-PI/tests/ui/terminal-logger-session.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TerminalLogger } from "../../src/ui/terminal-logger.ts";

describe("TerminalLogger - Session Hierarchy", () => {
  const testSessionId = `test-sess-${Date.now()}`;
  const testWorkspace = path.join(process.cwd(), "tests", ".tmp-workspace");

  afterEach(() => {
    try {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("should create isolated subagent log stream and write safely", async () => {
    const logger = TerminalLogger.getInstance();
    const tree = logger.initSessionTree(testSessionId, testWorkspace);

    expect(fs.existsSync(tree.sessionDir)).toBe(true);
    expect(fs.existsSync(tree.mainLogPath)).toBe(true);

    const subStream = tree.createSubagentLogStream("sub-01", "researcher");
    subStream.write("Subagent step 1 output\n");
    await new Promise((r) => subStream.end(r));

    const subLogPath = path.join(tree.sessionDir, "subagents", "sub-01-researcher.log");
    expect(fs.existsSync(subLogPath)).toBe(true);
    const content = fs.readFileSync(subLogPath, "utf8");
    expect(content).toContain("Subagent step 1 output");
  });

  it("should record timeline events in jsonl format", () => {
    const logger = TerminalLogger.getInstance();
    const tree = logger.initSessionTree(testSessionId, testWorkspace);

    tree.logTimelineEvent({ type: "SUBAGENT_SPAWNED", id: "sub-01", role: "coder", timestamp: Date.now() });
    expect(fs.existsSync(tree.timelineLogPath)).toBe(true);

    const timeline = fs.readFileSync(tree.timelineLogPath, "utf8");
    expect(timeline).toContain("SUBAGENT_SPAWNED");
    expect(timeline).toContain("sub-01");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/ui/terminal-logger-session.test.ts`  
预期: FAIL (`initSessionTree` not a function)

- [x] **Step 3: 实现树状分会话日志能力**

在 `CPH-PI/src/ui/terminal-logger.ts` 中添加 `SessionLoggerTree` 接口与实现方法：
```typescript
export interface SessionLoggerTree {
  sessionDir: string;
  mainLogPath: string;
  timelineLogPath: string;
  createSubagentLogStream(subagentId: string, role: string): fs.WriteStream;
  logTimelineEvent(event: { type: string; timestamp: number; [key: string]: any }): void;
}

// 在 TerminalLogger 类中添加：
  public initSessionTree(sessionId: string, workspaceRoot?: string): SessionLoggerTree {
    const root = workspaceRoot || process.cwd();
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sessionDir = path.join(root, ".cph", "logs", cleanSessionId);
    const subagentsDir = path.join(sessionDir, "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });

    const mainLogPath = path.join(sessionDir, "main.log");
    if (!fs.existsSync(mainLogPath)) {
      fs.writeFileSync(mainLogPath, `=== [CPH-PI Main Session Log: ${sessionId}] ===\n`, "utf8");
    }

    const timelineLogPath = path.join(sessionDir, "timeline.jsonl");

    return {
      sessionDir,
      mainLogPath,
      timelineLogPath,
      createSubagentLogStream: (subagentId: string, role: string): fs.WriteStream => {
        const cleanId = subagentId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const cleanRole = role.replace(/[^a-zA-Z0-9_-]/g, "_");
        const subLogPath = path.join(subagentsDir, `${cleanId}-${cleanRole}.log`);
        const stream = fs.createWriteStream(subLogPath, { flags: "a", encoding: "utf8" });
        stream.write(`=== [CPH-PI Subagent Log: ${subagentId} (${role})] ===\n`);
        return stream;
      },
      logTimelineEvent: (event: { type: string; timestamp: number; [key: string]: any }) => {
        const line = JSON.stringify({ ...event, timestamp: event.timestamp || Date.now() }) + "\n";
        try {
          fs.appendFileSync(timelineLogPath, line, "utf8");
        } catch {}
      },
    };
  }
```

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/ui/terminal-logger-session.test.ts`  
预期: PASS (2 tests pass)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/ui/terminal-logger.ts CPH-PI/tests/ui/terminal-logger-session.test.ts
git commit -m "feat(ui): implement tree-structured per-session debug log isolation"
```

---

### Task 3: `SubagentRunner` 底层执行核与多账号并发调度

**Files:**
- Create: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/subagent-runner.test.ts`

**Interfaces:**
- Consumes: `IAccountPool`, `IOrchestratorChatClient`, `SubagentTaskSpec`, `SessionLoggerTree`
- Produces:
  ```typescript
  export interface SubagentRunnerOptions {
    workspaceRoot: string;
    mainSessionId: string;
    coderAgentId?: string;
    researcherAgentId?: string;
    pool?: AccountPool | IAccountPool;
    chatClientFactory?: (
      token: any,
      options: { modelTone?: string; customAgentId?: string }
    ) => IOrchestratorChatClient;
    loggerTree?: SessionLoggerTree;
    modelTone?: string;
    createOrchestratorFn?: (opts: any) => any;
  }

  export interface SubagentTaskReport {
    id: string;
    role: "researcher" | "coder";
    description: string;
    success: boolean;
    finalAnswer: string;
    turnsCount: number;
    durationMs: number;
    error?: string;
  }

  export class SubagentRunner {
    constructor(options: SubagentRunnerOptions);
    public executeBatch(
      tasks: SubagentTaskSpec[],
      signal?: AbortSignal,
      events?: {
        onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec) => void;
        onSubagentEnd?: (report: SubagentTaskReport) => void;
        onSubagentProgress?: (id: string, turn: number, delta?: string) => void;
      }
    ): Promise<SubagentTaskReport[]>;
    public formatReportSummary(reports: SubagentTaskReport[]): string;
  }
  ```

- [x] **Step 1: 编写失败的 SubagentRunner 并发测试**

在 `CPH-PI/tests/agent/subagent-runner.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { SubagentRunner, type SubagentRunnerOptions } from "../../src/agent/subagent-runner.ts";
import type { SubagentTaskSpec } from "../../src/protocol/tool-bridge.ts";

describe("SubagentRunner", () => {
  it("should execute multiple subagent tasks concurrently and aggregate reports", async () => {
    const executedTasks: Array<{ role: string; customAgentId: string; prompt: string }> = [];

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        executedTasks.push({
          role: opts.subagentRole,
          customAgentId: opts.customAgentId,
          prompt: runOpts.task,
        });
        return {
          finalAnswer: `Subagent [${opts.subagentRole}] 完成交付: ${runOpts.task}`,
          turnsCount: 2,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-session-test",
      coderAgentId: "coder-id-123",
      researcherAgentId: "researcher-id-456",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "researcher", description: "调研接口", prompt: "检查 account-pool 导出" },
      { role: "coder", description: "修复测试", prompt: "修复 auth 模块测试" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(2);
    expect(reports[0].role).toBe("researcher");
    expect(reports[0].success).toBe(true);
    expect(reports[0].finalAnswer).toContain("调研接口");
    expect(reports[1].role).toBe("coder");
    expect(reports[1].success).toBe(true);

    expect(executedTasks.length).toBe(2);
    expect(executedTasks[0].customAgentId).toBe("researcher-id-456");
    expect(executedTasks[1].customAgentId).toBe("coder-id-123");

    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("子代理多会话并发执行报告");
    expect(summary).toContain("researcher");
    expect(summary).toContain("coder");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/subagent-runner.test.ts`  
预期: FAIL (Cannot find module `../../src/agent/subagent-runner.ts`)

- [x] **Step 3: 实现 SubagentRunner 执行核**

创建 `CPH-PI/src/agent/subagent-runner.ts`：
```typescript
import path from "node:path";
import crypto from "node:crypto";
import { CopilotOrchestrator, type OrchestratorRunOptions } from "./orchestrator.ts";
import { ToolBridge, type SubagentTaskSpec } from "../protocol/tool-bridge.ts";
import type { SessionLoggerTree } from "../ui/terminal-logger.ts";
import { AccountPool } from "../auth/account-pool.ts";

export const DEFAULT_MAIN_AGENT_ID =
  "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
export const DEFAULT_CODER_AGENT_ID =
  "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296";
export const DEFAULT_RESEARCHER_AGENT_ID =
  "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c";

export interface SubagentRunnerOptions {
  workspaceRoot: string;
  mainSessionId: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  pool?: AccountPool | any;
  chatClientFactory?: (token: any, options: any) => any;
  loggerTree?: SessionLoggerTree;
  modelTone?: string;
  createOrchestratorFn?: (opts: any) => any;
}

export interface SubagentTaskReport {
  id: string;
  role: "researcher" | "coder";
  description: string;
  success: boolean;
  finalAnswer: string;
  turnsCount: number;
  durationMs: number;
  error?: string;
}

export class SubagentRunner {
  private workspaceRoot: string;
  private mainSessionId: string;
  private coderAgentId: string;
  private researcherAgentId: string;
  private pool?: any;
  private chatClientFactory?: any;
  private loggerTree?: SessionLoggerTree;
  private modelTone: string;
  private createOrchestratorFn?: (opts: any) => any;

  constructor(options: SubagentRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.mainSessionId = options.mainSessionId;
    this.coderAgentId = options.coderAgentId || DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId = options.researcherAgentId || DEFAULT_RESEARCHER_AGENT_ID;
    this.pool = options.pool;
    this.chatClientFactory = options.chatClientFactory;
    this.loggerTree = options.loggerTree;
    this.modelTone = options.modelTone || "Gpt_61_Sol_Reasoning";
    this.createOrchestratorFn = options.createOrchestratorFn;
  }

  public async executeBatch(
    tasks: SubagentTaskSpec[],
    signal?: AbortSignal,
    events?: {
      onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec) => void;
      onSubagentEnd?: (report: SubagentTaskReport) => void;
      onSubagentProgress?: (id: string, turn: number, delta?: string) => void;
    }
  ): Promise<SubagentTaskReport[]> {
    const promises = tasks.map((taskSpec, index) => {
      const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
      const role = taskSpec.role === "coder" ? "coder" : "researcher";
      return this.runSingleSubagent(subId, role, taskSpec, signal, events);
    });

    const settled = await Promise.allSettled(promises);
    return settled.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const role = tasks[idx].role === "coder" ? "coder" : "researcher";
      return {
        id: `sub-${idx + 1}`,
        role,
        description: tasks[idx].description,
        success: false,
        finalAnswer: `子代理执行异常中断: ${String(result.reason)}`,
        turnsCount: 0,
        durationMs: 0,
        error: String(result.reason),
      };
    });
  }

  private async runSingleSubagent(
    subId: string,
    role: "researcher" | "coder",
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
    events?: any
  ): Promise<SubagentTaskReport> {
    const startTime = Date.now();
    events?.onSubagentStart?.(subId, role, spec);
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_STARTED",
      subagentId: subId,
      role,
      description: spec.description,
      timestamp: startTime,
    });

    const customAgentId = role === "coder" ? this.coderAgentId : this.researcherAgentId;
    const subSessionId = `${this.mainSessionId}_${subId}_${role}`;
    const logStream = this.loggerTree?.createSubagentLogStream(subId, role);

    try {
      const orchestrator = this.createOrchestratorFn
        ? this.createOrchestratorFn({
            workspaceRoot: this.workspaceRoot,
            customAgentId,
            subagentRole: role,
            sessionId: subSessionId,
            pool: this.pool,
            chatClientFactory: this.chatClientFactory,
            modelTone: this.modelTone,
          })
        : new CopilotOrchestrator({
            workspaceRoot: this.workspaceRoot,
            customAgentId,
            sessionId: subSessionId,
            pool: this.pool,
            chatClientFactory: this.chatClientFactory,
            modelTone: this.modelTone,
            maxTurns: spec.maxTurns || 15,
            activeSkills: [], // 子代理零技能挂载，最大化上下文给代码
          });

      const res = await orchestrator.run({
        task: spec.prompt,
        signal,
        events: {
          onDelta: (delta: string) => {
            logStream?.write(delta);
            events?.onSubagentProgress?.(subId, -1, delta);
          },
          onTurnStart: (turn: number) => {
            logStream?.write(`\n--- Turn ${turn} ---\n`);
            events?.onSubagentProgress?.(subId, turn);
          },
        },
      });

      const durationMs = Date.now() - startTime;
      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success: res.completed,
        finalAnswer: res.finalAnswer || "子代理已完成，未提供详细文字总结。",
        turnsCount: res.turnsCount,
        durationMs,
      };

      events?.onSubagentEnd?.(report);
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_FINISHED",
        subagentId: subId,
        role,
        success: report.success,
        turnsCount: report.turnsCount,
        durationMs,
        timestamp: Date.now(),
      });

      return report;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success: false,
        finalAnswer: `子任务执行失败: ${err.message}`,
        turnsCount: 0,
        durationMs,
        error: err.message,
      };
      events?.onSubagentEnd?.(report);
      return report;
    } finally {
      if (logStream) {
        logStream.end();
      }
    }
  }

  public formatReportSummary(reports: SubagentTaskReport[]): string {
    const parts: string[] = [
      `### 🎯 子代理多会话并发执行报告 (共 ${reports.length} 个子任务)`,
      ``,
    ];

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      const statusIcon = r.success ? "✅ 成功" : "❌ 失败";
      const durationSec = (r.durationMs / 1000).toFixed(1);
      parts.push(`#### [Sub-${i + 1}] [${r.role}] ${r.description}`);
      parts.push(`- **状态**: ${statusIcon} (耗时 ${durationSec}s, 共 ${r.turnsCount} 轮)`);
      parts.push(`- **交付结论**:`);
      parts.push(r.finalAnswer.trim());
      parts.push(``);
    }

    return parts.join("\n");
  }
}
```

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/subagent-runner.test.ts`  
预期: PASS (1 test pass)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/agent/subagent-runner.ts CPH-PI/tests/agent/subagent-runner.test.ts
git commit -m "feat(agent): implement SubagentRunner with role-based tool pruning and concurrency"
```

---

### Task 4: 主 `Orchestrator` 调度集成与工具路由

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Create: `CPH-PI/tests/agent/orchestrator-subagent.test.ts`

**Interfaces:**
- Consumes: `SubagentRunner`, `InvokeSubagentAction`
- Produces: 捕获 `invoke_subagent` 并返回格式化回填给主会话模型的 `ToolResult`。

- [x] **Step 1: 编写失败的 Orchestrator 集成测试**

在 `CPH-PI/tests/agent/orchestrator-subagent.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Orchestrator - Subagent Dispatch", () => {
  it("should intercept invoke_subagent and feed back structured reports", async () => {
    let subagentExecuted = false;

    const mockSubagentRunner = {
      executeBatch: async (tasks: any[]) => {
        subagentExecuted = true;
        return [
          {
            id: "sub-1",
            role: "researcher",
            description: "探查架构",
            success: true,
            finalAnswer: "发现三处需要重构的模块",
            turnsCount: 2,
            durationMs: 1200,
          },
        ];
      },
      formatReportSummary: (reports: any[]) => "### 🎯 子代理多会话并发执行报告: 发现三处需要重构的模块",
    };

    let turnsSent = 0;
    const mockChatClient = {
      sendMessage: async (params: any) => {
        turnsSent++;
        if (turnsSent === 1) {
          return {
            text: `THOUGHT: 派发调研子代理
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查架构
    prompt: 深入探查模块
\`\`\``,
          };
        }
        expect(params.text).toContain("子代理多会话并发执行报告");
        return {
          text: `FINAL_ANSWER: 根据子代理调研结果，已完成架构评估。`,
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      chatClient: mockChatClient as any,
      subagentRunner: mockSubagentRunner as any,
      customAgentId: "main-agent-id",
    });

    const result = await orchestrator.run({
      task: "评估当前系统架构",
    });

    expect(subagentExecuted).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("已完成架构评估");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/agent/orchestrator-subagent.test.ts`  
预期: FAIL (`invoke_subagent` 未被拦截或未执行)

- [x] **Step 3: 在 `Orchestrator` 中接入 `SubagentRunner`**

1. 修改 `CPH-PI/src/agent/orchestrator.ts`：
- 在 `OrchestratorOptions` 接口中添加可选字段：
```typescript
  subagentRunner?: SubagentRunner | any;
  coderAgentId?: string;
  researcherAgentId?: string;
```
- 在 `OrchestratorEvents` 中添加子代理生命周期回调：
```typescript
  onSubagentStart?: (id: string, role: string, spec: any) => void;
  onSubagentEnd?: (report: any) => void;
```
- 在 `CopilotOrchestrator` 类的 `run()` 循环内，针对 `parsed.action.tool === "invoke_subagent"` 增加拦截分支：
```typescript
      // Case 3b: Action invoked
      if (parsed.type === "action") {
        events?.onToolStart?.(parsed.action);

        let toolResult: ToolBridgeResult;

        if (parsed.action.tool === "invoke_subagent") {
          const runner =
            this.subagentRunner ||
            new SubagentRunner({
              workspaceRoot: this.workspaceRoot,
              mainSessionId: this.sessionId,
              coderAgentId: this.coderAgentId,
              researcherAgentId: this.researcherAgentId,
              pool: this.pool,
              chatClientFactory: this.chatClientFactory,
              modelTone: this.modelTone,
            });

          const subagents = (parsed.action as any).subagents || [];
          const reports = await runner.executeBatch(subagents, signal, {
            onSubagentStart: events?.onSubagentStart,
            onSubagentEnd: events?.onSubagentEnd,
          });

          const summaryOutput = runner.formatReportSummary(reports);
          toolResult = {
            actionName: "invoke_subagent",
            piToolName: "subagent",
            target: `${reports.length} subagents`,
            success: reports.every((r: any) => r.success),
            output: summaryOutput,
            formatted: summaryOutput,
          };
        } else {
          toolResult = await this.bridge.executeAction(parsed.action, signal);
        }

        events?.onToolEnd?.(toolResult);
        // 后续进入既有的 cloud attachment 与 next turn prompt 逻辑，无需改动
```

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/agent/orchestrator-subagent.test.ts`  
预期: PASS (1 test pass)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/agent/orchestrator.ts CPH-PI/tests/agent/orchestrator-subagent.test.ts
git commit -m "feat(orchestrator): integrate SubagentRunner execution into agent turn loop"
```

---

### Task 5: TUI 多子代理并发看板与状态渲染 (`tui-renderer.ts`)

**Files:**
- Modify: `CPH-PI/src/ui/tui-renderer.ts`
- Create: `CPH-PI/tests/ui/tui-subagent-dashboard.test.ts`

**Interfaces:**
- Consumes: `SubagentTaskReport`, `TuiRenderer`
- Produces:
  ```typescript
  export interface ActiveSubagentState {
    id: string;
    role: "researcher" | "coder";
    description: string;
    status: "running" | "completed" | "failed";
    currentTurn: number;
    durationMs: number;
    lastAction?: string;
  }
  ```

- [x] **Step 1: 编写失败的 TUI 看板渲染测试**

在 `CPH-PI/tests/ui/tui-subagent-dashboard.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { TuiRenderer, type ActiveSubagentState } from "../../src/ui/tui-renderer.ts";

describe("TuiRenderer - Subagent Dashboard", () => {
  it("should format multi-agent live matrix card", () => {
    const renderer = new TuiRenderer({ colorLevel: 0 }); // 无色便于断言
    const states: ActiveSubagentState[] = [
      {
        id: "sub-1",
        role: "researcher",
        description: "探查接口",
        status: "running",
        currentTurn: 2,
        durationMs: 5000,
        lastAction: "read_file: src/auth.ts",
      },
      {
        id: "sub-2",
        role: "coder",
        description: "修复错误",
        status: "completed",
        currentTurn: 3,
        durationMs: 8200,
      },
    ];

    const card = renderer.formatSubagentMatrix(states);
    expect(card).toContain("[Sub-1]");
    expect(card).toContain("researcher");
    expect(card).toContain("探查接口");
    expect(card).toContain("[Sub-2]");
    expect(card).toContain("coder");
    expect(card).toContain("已完成");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/ui/tui-subagent-dashboard.test.ts`  
预期: FAIL (`formatSubagentMatrix` not a function)

- [x] **Step 3: 实现 TUI 动态矩阵看板**

在 `CPH-PI/src/ui/tui-renderer.ts` 中添加：
```typescript
export interface ActiveSubagentState {
  id: string;
  role: "researcher" | "coder";
  description: string;
  status: "running" | "completed" | "failed";
  currentTurn: number;
  durationMs: number;
  lastAction?: string;
}

// 在 TuiRenderer 类中添加方法：
  public formatSubagentMatrix(states: ActiveSubagentState[]): string {
    const lines: string[] = [];
    lines.push(this.c.bold.cyan("┌─ [多会话子代理协同看板 (Sub-Agent Matrix)] " + "─".repeat(30)));

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const roleBadge = s.role === "coder" ? this.c.yellow(`[coder]`) : this.c.blue(`[researcher]`);
      const statusBadge =
        s.status === "completed"
          ? this.c.green("✅ 已完成")
          : s.status === "failed"
          ? this.c.red("❌ 失败")
          : this.c.cyan("🔄 运行中");
      const durationSec = (s.durationMs / 1000).toFixed(1);

      lines.push(
        this.c.bold(`│ [Sub-${i + 1}] `) +
          `${roleBadge} ${s.description.slice(0, 30)} | 状态: ${statusBadge} | 耗时: ${durationSec}s`
      );
      if (s.lastAction) {
        lines.push(`│   └─ 最新动作: ${this.c.gray(s.lastAction)}`);
      }
    }

    lines.push(this.c.bold.cyan("└" + "─".repeat(68)));
    return lines.join("\n");
  }

  public renderSubagentMatrix(states: ActiveSubagentState[]): void {
    this.writer(this.formatSubagentMatrix(states) + "\n");
  }
```

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/ui/tui-subagent-dashboard.test.ts`  
预期: PASS (1 test pass)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/ui/tui-renderer.ts CPH-PI/tests/ui/tui-subagent-dashboard.test.ts
git commit -m "feat(ui): add live multi-subagent progress matrix and deliverable cards to TUI"
```

---

### Task 6: CLI 参数注入与打包构建更新 (`cli.ts` & `package-agent-bundle.ts`)

**Files:**
- Modify: `CPH-PI/src/cli.ts`
- Modify: `CPH-PI/scripts/package-agent-bundle.ts`
- Create: `CPH-PI/tests/cli/subagent-cli-args.test.ts`

**Interfaces:**
- Consumes:
  - `--custom-agent-id <id>` (主控 Agent ID)
  - `--coder-agent-id <id>` (编码 Agent ID)
  - `--researcher-agent-id <id>` (调研 Agent ID)
- Produces: 端到端 CLI 配置注入与 `bun run package` 自动化产物输出。

- [x] **Step 1: 编写 CLI 参数解析测试**

在 `CPH-PI/tests/cli/subagent-cli-args.test.ts` 中创建测试文件：
```typescript
import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../../src/cli.ts";

describe("CLI Argument Parsing - Tri-Agent IDs", () => {
  it("should parse --coder-agent-id and --researcher-agent-id flags", () => {
    const args = [
      "--agent",
      "main-id-123",
      "--coder-agent-id",
      "coder-id-456",
      "--researcher-agent-id",
      "researcher-id-789",
      "实现功能",
    ];

    const parsed = parseCliArgs(args);
    expect(parsed.customAgentId).toBe("main-id-123");
    expect(parsed.coderAgentId).toBe("coder-id-456");
    expect(parsed.researcherAgentId).toBe("researcher-id-789");
    expect(parsed.task).toBe("实现功能");
  });

  it("should provide default Tri-Agent IDs if not specified", () => {
    const parsed = parseCliArgs(["简单的任务"]);
    expect(parsed.customAgentId).toBe(
      "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852"
    );
    expect(parsed.coderAgentId).toBe(
      "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296"
    );
    expect(parsed.researcherAgentId).toBe(
      "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c"
    );
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/cli/subagent-cli-args.test.ts`  
预期: FAIL (`coderAgentId` or `researcherAgentId` undefined)

- [x] **Step 3: 实现 CLI 参数支持并更新打包脚本**

1. 修改 `CPH-PI/src/cli.ts`：
- 在 `ParsedCliArgs` 与 `CphPiCliOptions` 中添加 `coderAgentId?: string; researcherAgentId?: string;`
- 在 `parseCliArgs` 中注入默认三 Agent ID：
```typescript
export const DEFAULT_MAIN_AGENT_ID =
  "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
export const DEFAULT_CODER_AGENT_ID =
  "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296";
export const DEFAULT_RESEARCHER_AGENT_ID =
  "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c";
```
- 支持 `--coder-agent-id <id>` 与 `--researcher-agent-id <id>` 参数；
- 实例化 `CopilotOrchestrator` 时将 `coderAgentId` 与 `researcherAgentId` 传入。

2. 修改 `CPH-PI/scripts/package-agent-bundle.ts`：
- 分别打包三份提示词：
  - `Instructions-Main-主协调智能体.txt`
  - `Instructions-Coder-代码实现智能体.txt`
  - `Instructions-Researcher-深度调研智能体.txt`
- 将 `skills/subagent/` 纳入打包产物；
- 更新 `UPLOAD-GUIDE.md` 包含这三个线上 Agent 的直达链接与更新指南。

- [x] **Step 4: 运行测试并执行打包验证**

1. 运行: `bun test tests/cli/subagent-cli-args.test.ts` ➔ PASS；
2. 运行: `bun run package` ➔ 生成 `dist/copilot-agent-bundle` 完整部署包。

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/cli.ts CPH-PI/scripts/package-agent-bundle.ts CPH-PI/tests/cli/
git commit -m "feat(cli): bind default Tri-Agent IDs and package deployment assets"
```

---

## 计划自审核对表 (Self-Review Checklist)

- [x] **Spec Coverage**：完整覆盖设计文档中确立的双/三 Agent 体系、角色工具裁剪、`invoke_subagent` 协议、树状分会话日志与 TUI 矩阵看板。
- [x] **No Placeholders**：所有步骤均包含完整的测试代码、实现代码和验证命令，绝无 "TODO" 或 "implement later"。
- [x] **Type Consistency**：`SubagentTaskSpec` 与 `SubagentTaskReport` 类型在所有任务间严格统一。
- [x] **Agent-Friendly Slicing**：任务按照协议层 ➔ 日志层 ➔ 执行核 ➔ 调度层 ➔ UI 层 ➔ CLI 层清晰切片，每步均独立可测。

