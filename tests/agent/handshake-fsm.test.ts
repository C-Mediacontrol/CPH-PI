import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  Orchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";
import type { Skill } from "../../src/skills/skill-loader.ts";

/**
 * Mock ChatHub Client to inspect multi-turn prompt transitions in Handshake FSM
 */
class MockFsmChatClient implements IOrchestratorChatClient {
  public sentPrompts: string[] = [];
  public responses: Array<string | { text: string; reasoning?: string }> = [];
  public callCount = 0;

  constructor(responses: Array<string | { text: string; reasoning?: string }>) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    const resp = this.responses[this.callCount] || "FINAL_ANSWER: 默认完成响应。";
    this.callCount++;
    const text = typeof resp === "string" ? resp : resp.text;
    return { text };
  }
}

describe("CPH-PI Two-Turn Handshake FSM Unit & State Machine Tests", () => {
  let tempDir: string;
  let bridge: ToolBridge;

  const sampleSkills: Skill[] = [
    {
      name: "tdd",
      description: "红绿重构测试驱动开发模式",
      content: "【TDD 铁律】在修改业务代码前，必须先编写公共接口的失败测试用例。",
      filePath: "/skills/tdd/SKILL.md",
      source: "workspace",
    },
  ];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-handshake-fsm-"));
    bridge = new ToolBridge(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 测试用例 1: Turn 1 纯净基准探测握手（严禁泄漏 task 与 skills）
  // =========================================================================
  it("测试用例 1: Turn 1 严格不包含 task 和 skills，且包含【第一轮基准探测握手与 git status 探测要求", async () => {
    const mockResponses = [
      // Turn 1: Model issues required handshake probe action
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Turn 2: Model finishes after handshake
      "FINAL_ANSWER: 任务已在第二轮注入后圆满完成。",
    ];

    const client = new MockFsmChatClient(mockResponses);
    const orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      bridge,
      chatClient: client,
    });

    const userTask = "实现核心订单支付模块与账户扣款流程";

    await orchestrator.run({
      task: userTask,
      activeSkills: sampleSkills,
    });

    // Check Turn 1 Prompt (sentPrompts[0])
    expect(client.sentPrompts.length).toBe(2);
    const turn1Prompt = client.sentPrompts[0];

    // 1. Strictly NO task leakage
    expect(turn1Prompt).not.toContain(userTask);
    expect(turn1Prompt).not.toContain("实现核心订单支付模块");

    // 2. Strictly NO skillsSection leakage
    expect(turn1Prompt).not.toContain("【当前已激活的专业技能 (Skill)】");
    expect(turn1Prompt).not.toContain("红绿重构测试驱动开发模式");
    expect(turn1Prompt).not.toContain("【TDD 铁律】");

    // 3. Must contain Handshake Grounding headers and git status command instruction
    expect(turn1Prompt).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
    expect(turn1Prompt).toContain("command: git status");
    expect(turn1Prompt).toContain("【本地宿主机与工作区事实");
  });

  // =========================================================================
  // 测试用例 2: Turn 2 准确注入【环境握手完成、正式任务与技能
  // =========================================================================
  it("测试用例 2: 执行完探测动作后，Turn 2 包含【环境握手完成、用户的正式任务以及已激活的 Skill 手册", async () => {
    const mockResponses = [
      // Turn 1 probe
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Turn 2 complete
      "FINAL_ANSWER: 核心支付模块与单元测试已全量交付。",
    ];

    const client = new MockFsmChatClient(mockResponses);
    const orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      bridge,
      chatClient: client,
    });

    const userTask = "编写高并发订单幂等校验逻辑";

    const result = await orchestrator.run({
      task: userTask,
      activeSkills: sampleSkills,
    });

    expect(result.completed).toBe(true);
    expect(client.sentPrompts.length).toBe(2);

    // Check Turn 2 Prompt (sentPrompts[1])
    const turn2Prompt = client.sentPrompts[1];

    // 1. Contains tool result feedback
    expect(turn2Prompt).toContain("[TOOL_RESULT");

    // 2. Contains handshake completed banner
    expect(turn2Prompt).toContain("【环境握手完成：本地工具与工作区已就绪】");

    // 3. Contains official user task
    expect(turn2Prompt).toContain("【用户正式需求】");
    expect(turn2Prompt).toContain(userTask);

    // 4. Contains activated skills section and content
    expect(turn2Prompt).toContain("【当前已激活的专业技能 (Skill)】");
    expect(turn2Prompt).toContain("tdd");
    expect(turn2Prompt).toContain("【TDD 铁律】在修改业务代码前，必须先编写公共接口的失败测试用例。");
  });

  // =========================================================================
  // 测试用例 3: 同会话内后续继续发任务时，不重复触发握手 (Follow-up)
  // =========================================================================
  it("测试用例 3: 同会话内后续继续发任务时，不重复触发握手", async () => {
    const mockResponses = [
      // Run 1 - Turn 1 probe
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Run 1 - Turn 2 answer
      "FINAL_ANSWER: 第一阶段任务完成。",
      // Run 2 - Turn 1 direct answer for follow-up task (no handshake probe)
      "FINAL_ANSWER: 第二阶段追问任务完成，已直接基于具身心智解答。",
    ];

    const client = new MockFsmChatClient(mockResponses);
    const orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      bridge,
      chatClient: client,
    });

    // First task triggers handshake
    await orchestrator.run({
      task: "第一阶段：检查代码仓库健康度",
    });

    expect(orchestrator.getIsHandshakePending()).toBe(false);
    expect(client.sentPrompts.length).toBe(2);

    // Second task in the SAME session
    const followUpTask = "第二阶段：补齐未覆盖的边界测试";
    await orchestrator.run({
      task: followUpTask,
    });

    // Second run should have sent prompt #3
    expect(client.sentPrompts.length).toBe(3);
    const followUpPrompt = client.sentPrompts[2];

    // Must NOT contain Turn 1 handshake probe reminder
    expect(followUpPrompt).not.toContain("【第一轮基准探测握手");

    // Must directly contain the follow-up task
    expect(followUpPrompt).toContain("【当前用户任务】");
    expect(followUpPrompt).toContain(followUpTask);
  });

  // =========================================================================
  // 测试用例 4: 重置握手后，新任务再次触发纯净握手
  // =========================================================================
  it("测试用例 4: 重置握手后，新任务再次触发纯净握手", async () => {
    const mockResponses = [
      // Session 1 - Turn 1 probe
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Session 1 - Turn 2 answer
      "FINAL_ANSWER: 会话 1 完成。",
      // Session 2 - Turn 1 probe
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Session 2 - Turn 2 answer
      "FINAL_ANSWER: 会话 2 完成。",
    ];

    const client = new MockFsmChatClient(mockResponses);
    const orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      bridge,
      chatClient: client,
    });

    // Session 1
    await orchestrator.run({
      task: "会话 1 任务",
    });
    expect(orchestrator.getIsHandshakePending()).toBe(false);

    // Reset Handshake (simulating /new or /reset command)
    orchestrator.resetHandshake();
    expect(orchestrator.getIsHandshakePending()).toBe(true);

    // Session 2 (fresh task after reset)
    const session2Task = "会话 2 全新业务重构";
    await orchestrator.run({
      task: session2Task,
      activeSkills: sampleSkills,
    });

    expect(client.sentPrompts.length).toBe(4);

    // Turn 1 of Session 2 (sentPrompts[2]) must be clean handshake again
    const session2Turn1Prompt = client.sentPrompts[2];
    expect(session2Turn1Prompt).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
    expect(session2Turn1Prompt).toContain("command: git status");
    expect(session2Turn1Prompt).not.toContain(session2Task);
    expect(session2Turn1Prompt).not.toContain("【当前已激活的专业技能 (Skill)】");

    // Turn 2 of Session 2 (sentPrompts[3]) must inject session2Task and skills
    const session2Turn2Prompt = client.sentPrompts[3];
    expect(session2Turn2Prompt).toContain("【环境握手完成：本地工具与工作区已就绪】");
    expect(session2Turn2Prompt).toContain(session2Task);
    expect(session2Turn2Prompt).toContain("tdd");
  });

  // =========================================================================
  // 测试用例 5: 未调工具直接回复防护 (Anti-Chatter Guard)
  // =========================================================================
  it("测试用例 5: 若模型首轮未输出 action 试图直接解答，状态机拦截并要求先执行物理探测动作", async () => {
    const mockResponses = [
      // Turn 1: Model attempts to answer directly without tool calling
      "FINAL_ANSWER: 我可以直接为你解答该需求，无需使用任何工具。",
      // Turn 2: After interception guard, model outputs required probe action
      `\`\`\`action
tool: run_command
command: git status
\`\`\``,
      // Turn 3: Handshake completes, model answers
      "FINAL_ANSWER: 探测完成并正式交付。",
    ];

    const client = new MockFsmChatClient(mockResponses);
    const orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      bridge,
      chatClient: client,
    });

    const result = await orchestrator.run({
      task: "验证状态机拦截防护",
    });

    expect(result.completed).toBe(true);
    expect(client.sentPrompts.length).toBe(3);

    // Prompt 1: Initial pure handshake
    expect(client.sentPrompts[0]).toContain("【第一轮基准探测握手");

    // Prompt 2: Interception guard reminding to output action block
    expect(client.sentPrompts[1]).toContain("请先输出 action 块执行 git status 以验证本地物理工具连接");

    // Prompt 3: After tool executed, Turn 2 task prompt injected
    expect(client.sentPrompts[2]).toContain("【环境握手完成：本地工具与工作区已就绪】");
    expect(client.sentPrompts[2]).toContain("验证状态机拦截防护");
  });
});


