# CPH-PI 专属智能体纯 WebSocket 直连与 GPT-6.1 Sol 锁定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CPH-PI 极简基座上，基于现场抓包协议契约，落地微软专属 Agent（`CPH-Dev`）纯 WebSocket 直连、锁死 `Gpt_61_Sol_Reasoning` 模型，并实现直通与两轮握手双轨自适应调度、CLI 交互与工作区配置持久化。

**Architecture:** 
1. 传输层 (`ChatHubClient`)：将默认模型修正为 `Gpt_61_Sol_Reasoning`，并在 WebSocket 握手 Query (`gptId=...%40MOS3`) 与 SignalR 帧 (`threadLevelGptId`, `gpts`) 中注入专属 Agent 协议；
2. 调度层 (`Orchestrator` & `PromptBuilder`)：双轨自适应状态机，若配置 Agent 则走极简直通模式（零冗余规则，直接下发任务），否则平滑兜底为纯净两轮握手基准探测；
3. 交互与配置层 (`CphPiCli`)：支持 `--agent <id|url>` 启动参数（自动剥离纯 ID）、交互式 `/agent` 与 `/model` 指令、工作区 `.cph/config.json` 自动记忆、状态栏智能体徽章透视。

**Tech Stack:** TypeScript, Bun Test, WebSocket (Native SignalR JSON protocol), ANSI Terminal Rendering.

**Reference Design:** [`CPH-PI/.docs/specs/2026-10-10-cph-pi-custom-agent-and-gpt61-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-10-cph-pi-custom-agent-and-gpt61-design.md)

## Global Constraints
- 遵循工作区铁律：所有代码、测试与配置文件严格位于 `CPH-PI/` 目录下，严禁在根目录写任何非白名单文件；
- 继承 Pi 原生框架与 4 大工具链（read 100 行切片限制、patch 局部替换、write 全量覆盖、bash 执行）；
- 严格遵循 TDD：测试先行，主会话统一审计并提交 Git；
- 确保全部存量测试（237 项）持续 100% 通过无退化。

---

### Task 1: 传输层增强 (ChatHubClient 模型锁定与 customAgentId 协议注入)

**Files:**
- Modify: `CPH-PI/src/transport/types.ts`
- Modify: `CPH-PI/src/transport/chathub-client.ts`
- Create: `CPH-PI/tests/transport/custom-agent-transport.test.ts`

**Interfaces:**
- Consumes: 抓包实证参数 (`Gpt_61_Sol_Reasoning`, `gptId`, `threadLevelGptId`, `gpts`)
- Produces: 
  - `ChatHubOptions.customAgentId?: string`
  - `ChatHubOptions.modelTone` 默认 `"Gpt_61_Sol_Reasoning"`
  - `ChatHubClient.normalizeAgentId(input?: string): string | undefined`
  - 自动向 `buildWsUrl` 注入 `gptId=${id}@MOS3&agent=Agent&agentHost=Bizchat.FullScreen`
  - 自动向 `sendMessage` 注入 `threadLevelGptId` 与 `gpts`

- [x] **Step 1: 编写传输层专属 Agent 协议单元测试**

```typescript
// CPH-PI/tests/transport/custom-agent-transport.test.ts
import { describe, it, expect } from "bun:test";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("Custom Agent Transport & GPT-6.1 Sol Locking", () => {
  const dummyToken = {
    accessToken: "mock_jwt_token",
    expiresOn: Date.now() + 3600000,
    oid: "mock_oid",
    tid: "mock_tid",
  };

  it("should normalize agent id from full web url or raw string", () => {
    const rawId = "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";
    const fullUrl = `https://m365.cloud.microsoft/chat/agent/${rawId}?es=Click`;
    
    expect(ChatHubClient.normalizeAgentId(rawId)).toBe(rawId);
    expect(ChatHubClient.normalizeAgentId(fullUrl)).toBe(rawId);
    expect(ChatHubClient.normalizeAgentId(undefined)).toBeUndefined();
    expect(ChatHubClient.normalizeAgentId("   ")).toBeUndefined();
  });

  it("should append gptId and agent query parameters to wsUrl when customAgentId is configured", () => {
    const agentId = "T_test_agent_123";
    const client = new ChatHubClient(dummyToken, {
      customAgentId: agentId,
      modelTone: "Gpt_61_Sol_Reasoning",
    });

    const url = client.buildWsUrl("conv_1", "ses_1", "req_1");
    expect(url).toContain(`gptId=${encodeURIComponent(agentId + "@MOS3")}`);
    expect(url).toContain("agent=Agent");
    expect(url).toContain("agentHost=Bizchat.FullScreen");
  });

  it("should default modelTone to Gpt_61_Sol_Reasoning when omitted", () => {
    const client = new ChatHubClient(dummyToken);
    expect((client as any).options.modelTone).toBe("Gpt_61_Sol_Reasoning");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/transport/custom-agent-transport.test.ts`  
Expected: FAIL (normalizeAgentId not implemented or default modelTone is "magic")

- [x] **Step 3: 实现 ChatHubClient 增强与模型锁定**

在 `CPH-PI/src/transport/types.ts` 中：
- `ChatHubOptions` 增加 `customAgentId?: string`。
在 `CPH-PI/src/transport/chathub-client.ts` 中：
1. 默认 `modelTone: "Gpt_61_Sol_Reasoning"`；
2. 实现 `ChatHubClient.normalizeAgentId(input?: string): string | undefined`；
3. `buildWsUrl()` 中，若 `this.options.customAgentId` 存在，追加 `gptId`, `agent`, `agentHost`；
4. `sendMessage()` 中组装 `chatArguments` 时，若 `customAgentId` 存在，挂载 `threadLevelGptId` 与 `gpts`。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/transport/custom-agent-transport.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/transport/ CPH-PI/tests/transport/custom-agent-transport.test.ts
git commit -m "feat(transport): lock default tone to Gpt_61_Sol_Reasoning and inject custom agent websocket protocol"
```

---

### Task 2: 双轨状态机与极简提示词构建 (PromptBuilder & Orchestrator)

**Files:**
- Modify: `CPH-PI/src/protocol/prompt-builder.ts`
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Create: `CPH-PI/tests/agent/dual-mode-orchestrator.test.ts`

**Interfaces:**
- Consumes: `ChatHubClient` (带 `customAgentId`), `PromptBuilder`
- Produces:
  - `PromptBuilder.buildDirectAgentPrompt(workspaceRoot, task, activeSkillsSection)`
  - `CopilotOrchestratorOptions.customAgentId?: string`
  - `CopilotOrchestrator`:
    - 若 `customAgentId` 存在，进入直通模式（`isHandshakePending = false`，Turn 1 直接包含用户业务任务）；
    - 若未配置，维持现有通用两轮握手模式。

- [x] **Step 1: 编写双轨状态机单元测试**

```typescript
// CPH-PI/tests/agent/dual-mode-orchestrator.test.ts
import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

describe("Dual-Mode Orchestrator (Custom Agent vs Handshake)", () => {
  it("should build direct prompt for custom agent without verbose tool rules", () => {
    const prompt = PromptBuilder.buildDirectAgentPrompt("E:/test", "修复 index.ts 的 bug");
    expect(prompt).toContain("修复 index.ts 的 bug");
    expect(prompt).toContain("E:/test");
    expect(prompt).not.toContain("【第一轮基准探测握手");
    // 不重复灌入大段 PROTOCOL_REMINDER 避免浪费 Token
    expect(prompt).not.toContain("【交接协议铁律 (Turn Protocol Contract)】");
  });

  it("should bypass handshake and send business task on Turn 1 when customAgentId is present", async () => {
    let capturedPrompt = "";
    const mockClient = {
      sendMessage: async (params: { text: string }) => {
        capturedPrompt = params.text;
        return { text: "FINAL_ANSWER: 已完成修复" };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      customAgentId: "T_custom_agent_id",
      chatClient: mockClient as any,
    });

    const result = await orchestrator.run({ task: "直接开发任务" });
    expect(result.completed).toBe(true);
    expect(capturedPrompt).toContain("直接开发任务");
    expect(capturedPrompt).not.toContain("【第一轮基准探测握手");
  });

  it("should enforce pure Turn 1 handshake when customAgentId is absent", async () => {
    let turn1Prompt = "";
    const mockClient = {
      sendMessage: async (params: { text: string }) => {
        turn1Prompt = params.text;
        return { text: "```action\ntool: run_command\ncommand: git status\n```" };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      chatClient: mockClient as any,
    });

    // 运行首轮探测
    const promise = orchestrator.run({ task: "通用模式任务" });
    // mock 终止
    expect(orchestrator["isHandshakePending"]).toBe(true);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/agent/dual-mode-orchestrator.test.ts`  
Expected: FAIL (buildDirectAgentPrompt not defined, customAgentId bypass not implemented)

- [x] **Step 3: 实现 PromptBuilder 与 Orchestrator 双轨流转**

1. 在 `CPH-PI/src/protocol/prompt-builder.ts` 中：
   实现 `buildDirectAgentPrompt(workspaceRoot: string, task: string, activeSkillsSection = ""): string`。仅包含工作区事实、激活技能与用户正式任务。
2. 在 `CPH-PI/src/agent/orchestrator.ts` 中：
   - 增加 `customAgentId?: string` 选项并保存；
   - 构造 `ChatHubClient` 时透传 `customAgentId`，并默认 `modelTone = "Gpt_61_Sol_Reasoning"`；
   - 若 `this.customAgentId` 存在：
     - 初始化时将 `isHandshakePending = false`；
     - 首轮调用 `PromptBuilder.buildDirectAgentPrompt`；
   - 若无 `this.customAgentId`：
     - 保持现有的 `isHandshakePending = true` 两轮握手状态迁移。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/agent/dual-mode-orchestrator.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/protocol/prompt-builder.ts CPH-PI/src/agent/orchestrator.ts CPH-PI/tests/agent/dual-mode-orchestrator.test.ts
git commit -m "feat(agent): implement dual-mode orchestrator for direct custom agent execution and fallback handshake"
```

---

### Task 3: CLI 交互、命令体系与工作区配置持久化 (CphPiCli & Config Persistence)

**Files:**
- Modify: `CPH-PI/src/ui/tui-renderer.ts`
- Modify: `CPH-PI/src/cli.ts`
- Create: `CPH-PI/tests/cli/custom-agent-cli.test.ts`

**Interfaces:**
- Consumes: `ChatHubClient.normalizeAgentId`, `CopilotOrchestrator`, `<workspace>/.cph/config.json`
- Produces:
  - CLI 参数：`--agent <id|url>`, `-a <id|url>`, `--model <tone>`, `-m <tone>`
  - 斜杠命令：`/agent [id|url]`, `/agent clear`, `/model [tone]`
  - `<workspace>/.cph/config.json` 自动落盘与优先加载
  - 状态栏智能体徽章渲染 (`renderStatusBar`)

- [x] **Step 1: 编写 CLI 专属 Agent 命令与配置持久化测试**

```typescript
// CPH-PI/tests/cli/custom-agent-cli.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCliArgs, CphPiCli } from "../../src/cli.ts";

describe("CLI Custom Agent Flags, Commands & Config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should parse --agent / -a flag and normalize raw url", () => {
    const rawId = "T_agent_999";
    const resUrl = parseCliArgs(["--agent", `https://m365.cloud.microsoft/chat/agent/${rawId}`]);
    expect(resUrl.customAgentId).toBe(rawId);

    const resShort = parseCliArgs(["-a", rawId]);
    expect(resShort.customAgentId).toBe(rawId);
  });

  it("should persist and load customAgentId from .cph/config.json", () => {
    const configPath = path.join(tmpDir, ".cph", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ customAgentId: "T_saved_agent" }), "utf-8");

    const cli = new CphPiCli({ workspace: tmpDir });
    expect((cli as any).customAgentId).toBe("T_saved_agent");
  });

  it("should handle /agent command to switch or clear agent", async () => {
    const cli = new CphPiCli({ workspace: tmpDir });
    (cli as any).handleAgentCommand("T_new_agent_123");
    expect((cli as any).customAgentId).toBe("T_new_agent_123");

    // 检查落盘
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, ".cph", "config.json"), "utf-8"));
    expect(config.customAgentId).toBe("T_new_agent_123");

    (cli as any).handleAgentCommand("clear");
    expect((cli as any).customAgentId).toBeUndefined();
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/cli/custom-agent-cli.test.ts`  
Expected: FAIL (customAgentId not parsed, config.json logic missing)

- [x] **Step 3: 实现 CLI 智能体管理与配置落盘**

1. 在 `CPH-PI/src/ui/tui-renderer.ts` 中：
   `SessionStatusInfo` 扩展 `agentName?: string`；
   `renderStatusBar` 增加 `智能体: <agentName>` 高亮渲染。
2. 在 `CPH-PI/src/cli.ts` 中：
   - `parseCliArgs`：支持 `--agent` / `-a`，调用 `ChatHubClient.normalizeAgentId`；默认 `modelTone = "Gpt_61_Sol_Reasoning"`；
   - 增加工作区配置加载与保存：`<workspace>/.cph/config.json`（读取/保存 `customAgentId`, `modelTone`）；
   - 交互指令增强：实现 `/agent [id|url|clear]` 与 `/model [tone]`；
   - 实例化 `CopilotOrchestrator` 时传入 `customAgentId` 与 `modelTone`；
   - 状态栏传入 `agentName: this.customAgentId ? (this.customAgentId.slice(0, 12) + "...") : "通用握手模式"`。

- [x] **Step 4: 运行测试验证通过**

Run: `bun test tests/cli/custom-agent-cli.test.ts`  
Expected: PASS

- [x] **Step 5: 提交代码**

```bash
git add CPH-PI/src/ui/tui-renderer.ts CPH-PI/src/cli.ts CPH-PI/tests/cli/custom-agent-cli.test.ts
git commit -m "feat(cli): add --agent flag, /agent command, config persistence and status bar badge"
```

---

### Task 4: 端到端集成测试与使用文档更新 (E2E & README)

**Files:**
- Create: `CPH-PI/tests/e2e/custom-agent-e2e.test.ts`
- Modify: `CPH-PI/README.md`

**Interfaces:**
- Consumes: 全链路组件 (Transport, Orchestrator, CLI, TuiRenderer)
- Produces: 
  - 全链路专属 Agent 调度集成测试
  - 完善的 README 专属 Agent 直连指南与参数速查

- [x] **Step 1: 编写全链路端到端集成测试**

```typescript
// CPH-PI/tests/e2e/custom-agent-e2e.test.ts
import { describe, it, expect } from "bun:test";
import { CphPiCli } from "../../src/cli.ts";

describe("E2E Custom Agent Full Lifecycle", () => {
  it("should initialize CLI with custom agent and maintain agent badge in status bar", () => {
    const rawId = "T_9feac605-583d-c37d-cb38-831efe727253";
    const cli = new CphPiCli({
      customAgentId: rawId,
    });

    const status = cli.getDiagnosticCard();
    expect(status).toContain(rawId);
    expect(status).toContain("Gpt_61_Sol_Reasoning");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

Run: `bun test tests/e2e/custom-agent-e2e.test.ts`  
Expected: FAIL

- [x] **Step 3: 完善诊断卡与 README 使用文档**

1. 确保 `CphPiCli.getDiagnosticCard()` 打印当前绑定的专属 Agent ID；
2. 更新 `CPH-PI/README.md`：
   - 增加第五章节《专属自建智能体 (Custom Agent) 纯 WebSocket 直连》：
     - 说明如何将发布好的 M365 Agent URL/ID 接入 CPH-PI；
     - 说明专属 Agent 直通模式带来的 0 废话、永久心智与节省 80% Token 优势；
     - 详细说明 `--agent` 参数、`/agent` 指令与 `.cph/config.json` 自动配置记忆；
     - 更新 CLI 命令行参数速查表与交互命令表。

- [x] **Step 4: 运行全量测试套件验证 100% 绿灯**

Run: `bun test`  
Expected: ALL PASS (245+ tests, 0 failures, 0 regressions)

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/tests/e2e/custom-agent-e2e.test.ts CPH-PI/README.md
git commit -m "docs(readme): add custom agent websocket direct connect guide and complete e2e test suite"
```

