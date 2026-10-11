# CPH-PI 会话管理与两轮握手状态机实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `CPH-PI` 状态机中的两轮握手缺陷（确保 Turn 1 为纯净基准探测握手、Turn 2 才注入任务与技能），并构建工业级会话持久化与状态透视体系（`<workspace>/.cph/sessions/` 存储、`/new`、`/sessions`、`/resume`、`--continue` 以及 25 轮自动脱困接力）。

**Architecture:**
1. **纯净两轮握手状态机**：在 `CopilotOrchestrator` 中引入严格的 `isHandshakePending` 状态转换：Turn 1 仅调用 `buildHandshakePrompt` 要求模型执行 `git status` 探测；拿到工具结果后 Turn 2 调用 `buildTurn2TaskPrompt` 注入业务任务与技能；
2. **会话持久化与管理器**：创建 `SessionManager`，在目标工作区 `.cph/sessions/` 内持久化会话记录与全局索引 `index.json`；
3. **交互与状态栏增强**：TUI 顶部实时渲染会话状态栏，CLI 增加 `/new`、`/sessions`、`/resume` 命令支持与 `--continue` / `--resume` 启动参数；
4. **25 轮自动脱困接力**：轮次超限自动提取阶段性快照，无缝重接地开启新会话。

**Tech Stack:** TypeScript, Bun / Node.js, `@earendil-works/pi-tui`, Chalk.

**Reference Spec:** [`CPH-PI/.docs/specs/2026-10-10-cph-pi-session-management-and-handshake-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-10-cph-pi-session-management-and-handshake-design.md)

---

## 冲击面扫描清单 (Impact Analysis)

| 制品类型 | ⬆️ 上游生产方 | ⬇️ 下游消费方 | 风险与对策 |
| :--- | :--- | :--- | :--- |
| **Turn 1 提示词** | `PromptBuilder.buildHandshakePrompt` | Copilot Web 模型推理 | 必须纯净，绝不能带业务需求或技能，强制只跑 `git status` |
| **状态机迁移** | `CopilotOrchestrator.run()` | TUI 渲染与后续轮次 | 必须在收到第 1 轮工具结果后触发 Turn 2 需求注入，后续轮次不重复握手 |
| **会话持久化** | `SessionManager` | 本地文件系统 | 目录置于 `<workspace>/.cph/sessions/`，避免跨工作区写入 |
| **CLI 控制指令** | `CphPiCli` | Readline 事件流 | `/new`, `/sessions`, `/resume` 必须更新状态机与 TUI 状态栏 |

---

## 任务拆解与执行顺序

### Task 1: 纯净两轮握手状态机修复 (Pure Two-Turn Handshake FSM)

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Modify: `CPH-PI/src/protocol/prompt-builder.ts`
- Create: `CPH-PI/tests/agent/handshake-fsm.test.ts`

**Interfaces:**
- Consumes: `PromptBuilder.buildHandshakePrompt`, `PromptBuilder.buildTurn2TaskPrompt`
- Produces: 修复后的 `CopilotOrchestrator`，支持严格的 `isHandshakePending` 状态迁移

- [ ] **Step 1: 编写两轮握手状态机严格校验测试**

```typescript
// CPH-PI/tests/agent/handshake-fsm.test.ts
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("Two-Turn Handshake FSM", () => {
  it("should send strictly pure handshake prompt in Turn 1 without userTask or skills", async () => {
    const sentPrompts: string[] = [];
    const mockClient = {
      sendMessage: async (params: { text: string }) => {
        sentPrompts.push(params.text);
        if (sentPrompts.length === 1) {
          // Model obeys handshake by outputting run_command git status
          return { text: "```action\ntool: run_command\ncommand: git status\n```" };
        }
        return { text: "FINAL_ANSWER: 任务已完成" };
      },
    };

    const orchestrator = new CopilotOrchestrator({ chatClient: mockClient as any });
    await orchestrator.run({
      task: "重构数据库连接池",
      activeSkills: "### Skill: [tdd]\n遵循测试驱动",
    });

    // 验证 Turn 1 严格不包含业务任务与技能
    expect(sentPrompts[0]).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
    expect(sentPrompts[0]).toContain("command: git status");
    expect(sentPrompts[0]).not.toContain("重构数据库连接池");
    expect(sentPrompts[0]).not.toContain("### Skill: [tdd]");

    // 验证 Turn 2 包含环境就绪、技能与用户正式需求
    expect(sentPrompts[1]).toContain("【环境握手完成：本地工具与工作区已就绪】");
    expect(sentPrompts[1]).toContain("重构数据库连接池");
    expect(sentPrompts[1]).toContain("### Skill: [tdd]");
  });

  it("should not repeat handshake on follow-up tasks in same session", async () => {
    const sentPrompts: string[] = [];
    const mockClient = {
      sendMessage: async (params: { text: string }) => {
        sentPrompts.push(params.text);
        if (sentPrompts.length === 1) {
          return { text: "```action\ntool: run_command\ncommand: git status\n```" };
        }
        return { text: "FINAL_ANSWER: 已完成" };
      },
    };

    const orchestrator = new CopilotOrchestrator({ chatClient: mockClient as any });
    await orchestrator.run({ task: "任务1" });
    const turnsAfterTask1 = sentPrompts.length;

    // 后续在同会话中执行任务2
    await orchestrator.run({ task: "任务2" });
    const task2FirstPrompt = sentPrompts[turnsAfterTask1];
    expect(task2FirstPrompt).not.toContain("【第一轮基准探测握手");
    expect(task2FirstPrompt).toContain("任务2");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/agent/handshake-fsm.test.ts`  
Expected: FAIL (Turn 1 currently contains task)

- [x] **Step 3: 修复 CopilotOrchestrator 中的两轮握手迁移逻辑**

在 `CPH-PI/src/agent/orchestrator.ts` 中：
1. 维护 `isHandshakePending: boolean` 属性（新会话初始为 true）；
2. 若 `isHandshakePending`，Turn 1 严格仅构造 `buildHandshakePrompt`，将 `task` 与 `activeSkills` 保存至 `pendingTask` 与 `pendingSkills`；
3. 收到工具结果后，若 `isHandshakePending`，将标志置为 false，调用 `buildTurn2TaskPrompt` 注入真实结果、技能与需求进入 Turn 2；
4. 同一会话后续调用 `run()` 时，不再重复走握手。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/agent/handshake-fsm.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/agent/orchestrator.ts CPH-PI/tests/agent/handshake-fsm.test.ts
git commit -m "fix(agent): strictly enforce pure Turn 1 handshake and Turn 2 task injection"
```

---

### Task 2: 会话持久化与状态管理器实现 (SessionManager)

**Files:**
- Create: `CPH-PI/src/session/session-manager.ts`
- Test: `CPH-PI/tests/session/session-manager.test.ts`

**Interfaces:**
- Consumes: `<workspace>/.cph/sessions/` 文件读写
- Produces: `SessionManager`（支持 `createSession`, `saveSession`, `loadSession`, `listSessions`, `getLatestActiveSession`）

- [x] **Step 1: 编写 SessionManager 单元测试**

```typescript
// CPH-PI/tests/session/session-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionManager } from "../../src/session/session-manager.ts";

describe("SessionManager Persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-session-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create and persist a new session record with index.json", () => {
    const manager = new SessionManager(tmpDir);
    const session = manager.createSession({
      title: "测试初始化",
      modelTone: "Creative",
    });

    expect(session.id).toBeDefined();
    expect(session.status).toBe("active");

    const sessionFile = path.join(tmpDir, ".cph", "sessions", `${session.id}.json`);
    expect(fs.existsSync(sessionFile)).toBe(true);

    const indexFile = path.join(tmpDir, ".cph", "sessions", "index.json");
    expect(fs.existsSync(indexFile)).toBe(true);
  });

  it("should list sessions and support resume", () => {
    const manager = new SessionManager(tmpDir);
    const s1 = manager.createSession({ title: "任务A" });
    const s2 = manager.createSession({ title: "任务B" });

    const list = manager.listSessions();
    expect(list.length).toBe(2);

    const loaded = manager.loadSession(s1.id);
    expect(loaded?.title).toBe("任务A");
  });

  it("should find the latest active session for continue mode", () => {
    const manager = new SessionManager(tmpDir);
    const s1 = manager.createSession({ title: "任务A" });
    const latest = manager.getLatestActiveSession();
    expect(latest?.id).toBe(s1.id);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/session/session-manager.test.ts`  
Expected: FAIL (Cannot find module)

- [x] **Step 3: 编写 SessionManager 实现**

创建 `CPH-PI/src/session/session-manager.ts`：
实现 `SessionRecord` 契约，自动在 `<workspace>/.cph/sessions/` 创建目录与 `index.json`，支持增量存盘、更新轮次与按时间倒序读取历史列表。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/session/session-manager.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/session/session-manager.ts CPH-PI/tests/session/session-manager.test.ts
git commit -m "feat(session): implement SessionManager with disk persistence and indexing"
```

---

### Task 3: TUI 状态栏实时透视与交互指令增强 (`/new`, `/sessions`, `/resume`, `--continue`)

**Files:**
- Modify: `CPH-PI/src/ui/tui-renderer.ts`
- Modify: `CPH-PI/src/cli.ts`
- Create: `CPH-PI/tests/cli/session-commands.test.ts`

**Interfaces:**
- Consumes: `SessionManager`, `TuiRenderer`
- Produces: 带有 `/new`, `/sessions`, `/resume` 交互命令与状态栏渲染的 `CphPiCli`

- [x] **Step 1: 编写 CLI 会话交互测试**

```typescript
// CPH-PI/tests/cli/session-commands.test.ts
import { describe, it, expect } from "bun:test";
import { CphPiCli, parseCliArgs } from "../../src/cli.ts";

describe("CLI Session Commands & Flags", () => {
  it("should parse --continue and --resume flags", () => {
    const resContinue = parseCliArgs(["--continue"]);
    expect(resContinue.continueLast).toBe(true);

    const resResume = parseCliArgs(["--resume", "ses_123"]);
    expect(resResume.resumeSessionId).toBe("ses_123");
  });

  it("should handle /sessions command output", async () => {
    const cli = new CphPiCli();
    const output = cli.formatSessionsList();
    expect(output).toBeDefined();
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/cli/session-commands.test.ts`  
Expected: FAIL

- [x] **Step 3: 实现 TUI 状态栏与 CLI 会话控制**

1. 在 `TuiRenderer` 中增加 `renderStatusBar(info: SessionStatusInfo)` 方法：
   输出格式 `┌─ [ 会话: <id> | 轮次: <turn>/<max> | 上下文: ~<tokens> | 账号: <account> ]`；
2. 在 `CphPiCli` 中增加 `/new`（新建纯净会话）、`/sessions`（打印表格）、`/resume <id>`（恢复会话）；
3. 在启动逻辑中接入 `parseCliArgs` 的 `--continue` 与 `--resume` 参数。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/cli/session-commands.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/ui/tui-renderer.ts CPH-PI/src/cli.ts CPH-PI/tests/cli/session-commands.test.ts
git commit -m "feat(ui): add session status bar and /new, /sessions, /resume interactive commands"
```

---

### Task 4: 25 轮自动脱困接力与全链路端到端集成测试 (Auto-Handoff & E2E)

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Create: `CPH-PI/tests/e2e/session-flow.test.ts`
- Update: `CPH-PI/README.md`

- [x] **Step 1: 编写 25 轮自动脱困与会话流转测试**

```typescript
// CPH-PI/tests/e2e/session-flow.test.ts
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("E2E Session Flow & Auto-Handoff", () => {
  it("should auto-handoff when turn limit is reached and carry progress snapshot", async () => {
    let turnCount = 0;
    const mockClient = {
      sendMessage: async (params: { text: string }) => {
        turnCount++;
        if (params.text.includes("【第一轮基准探测握手")) {
          return { text: "```action\ntool: run_command\ncommand: git status\n```" };
        }
        return { text: "```action\ntool: read_file\npath: package.json\n```" };
      },
    };

    // 设定极低 maxTurns (如 3 轮) 模拟触发自动脱困
    const orchestrator = new CopilotOrchestrator({
      maxTurns: 3,
      chatClient: mockClient as any,
    });

    const result = await orchestrator.run({ task: "长任务测试" });
    expect(result.handedOff).toBe(true);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/e2e/session-flow.test.ts`  
Expected: FAIL

- [x] **Step 3: 落实自动脱困状态机分支与 README 文档更新**

在 `CPH-PI/src/agent/orchestrator.ts` 中检测到轮次接近上限时，自动提取工具操作成果快照并标记会话为 `handed_off`，触发换号重接地。同步更新 `CPH-PI/README.md` 中的会话使用说明。

- [x] **Step 4: 运行全量测试套件验证全绿**

Run: `bun test`  
Expected: All tests pass (0 failures)

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/agent/orchestrator.ts CPH-PI/tests/e2e/session-flow.test.ts CPH-PI/README.md
git commit -m "feat(agent): implement 25-turn auto-handoff and complete session management suite"
```

