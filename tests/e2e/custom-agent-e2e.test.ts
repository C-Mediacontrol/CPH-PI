import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CphPiCli, parseCliArgs } from "../../src/cli.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";

/**
 * Mock ChatHub Client for capturing prompts and simulating Sydney WebSocket responses
 */
class MockAgentChatClient implements IOrchestratorChatClient {
  public sentPrompts: string[] = [];
  public responseGenerator: (prompt: string, turn: number) => { text: string };
  private turnCounter = 0;

  constructor(generator?: (prompt: string, turn: number) => { text: string }) {
    this.responseGenerator =
      generator ||
      ((prompt: string) => {
        if (prompt.includes("【第一轮基准探测握手")) {
          return {
            text: "```action\ntool: run_command\ncommand: git status\n```",
          };
        }
        return {
          text: "FINAL_ANSWER: Mock agent completed task successfully.",
        };
      });
  }

  async sendMessage(
    params: { text: string; [key: string]: any },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      [key: string]: any;
    }
  ): Promise<{ text: string }> {
    this.turnCounter++;
    this.sentPrompts.push(params.text);
    const result = this.responseGenerator(params.text, this.turnCounter);

    if (callbacks?.onDelta) {
      callbacks.onDelta({ type: "text", content: result.text });
    }

    return result;
  }

  public reset(): void {
    this.sentPrompts = [];
    this.turnCounter = 0;
  }
}

describe("E2E Custom Agent Full Lifecycle & Direct Execution", () => {
  let tmpDir: string;
  let cliOutputBuffer: string[];
  let renderer: TuiRenderer;
  const originalEnvAgent = process.env.CPH_COPILOT_AGENT_ID;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pi-agent-e2e-"));
    cliOutputBuffer = [];
    renderer = new TuiRenderer({
      writer: (chunk: string) => cliOutputBuffer.push(chunk),
    });
    delete process.env.CPH_COPILOT_AGENT_ID;
  });

  afterEach(() => {
    if (originalEnvAgent !== undefined) {
      process.env.CPH_COPILOT_AGENT_ID = originalEnvAgent;
    } else {
      delete process.env.CPH_COPILOT_AGENT_ID;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const getCombinedOutput = () => cliOutputBuffer.join("");

  // =========================================================================
  // 1. CLI Startup with --agent <url>, pure ID extraction, and diagnostic card
  // =========================================================================
  describe("1. CLI Startup with --agent <url> & Diagnostics", () => {
    it("should parse full web URL, extract pure agent ID and show Gpt_61_Sol_Reasoning in diagnostic card", () => {
      const rawAgentId =
        "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";
      const fullAgentUrl = `https://m365.cloud.microsoft/chat/agent/${rawAgentId}?es=Click`;

      const parsedArgs = parseCliArgs([
        "--workspace",
        tmpDir,
        "--agent",
        fullAgentUrl,
      ]);

      expect(parsedArgs.customAgentId).toBe(rawAgentId);
      expect(parsedArgs.modelTone).toBe("Gpt_61_Sol_Reasoning");

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        customAgentId: parsedArgs.customAgentId,
        renderer,
      });

      expect(cli.customAgentId).toBe(rawAgentId);

      // Verify diagnostic card
      const diagnosticCard = cli.getDiagnosticCard();
      expect(diagnosticCard).toContain("专属智能体:");
      expect(diagnosticCard).toContain(rawAgentId);
      expect(diagnosticCard).toContain("模型风格:");
      expect(diagnosticCard).toContain("Gpt_61_Sol_Reasoning");

      // Verify status bar renders agent badge
      cli.renderCurrentStatusBar();
      const output = getCombinedOutput();
      expect(output).toContain("智能体:");
      expect(output).toContain("T_9feac605-5...");
    });
  });

  // =========================================================================
  // 2. Straight-Through Mode in Custom Agent (Zero Redundant Handshake)
  // =========================================================================
  describe("2. Custom Agent Straight-Through Mode (Zero Handshake Bloat)", () => {
    it("should bypass Turn 1 handshake and directly deliver user business prompt on first turn", async () => {
      const rawAgentId = "T_custom_dev_agent_001";
      const mockClient = new MockAgentChatClient((prompt) => {
        return {
          text: "FINAL_ANSWER: 已直接完成用户业务需求，零废话交付。",
        };
      });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        customAgentId: rawAgentId,
        chatClient: mockClient,
        renderer,
      });

      // Verify orchestrator initialized in direct mode
      expect(cli.getOrchestrator().isHandshakePending).toBe(false);

      const businessTask = "为核心模块编写单元测试并消除警告";
      await cli.executeTask(businessTask);

      // Verify prompt sent on Turn 1
      expect(mockClient.sentPrompts.length).toBe(1);
      const turn1Prompt = mockClient.sentPrompts[0];

      // 必须包含用户真实业务需求
      expect(turn1Prompt).toContain(businessTask);
      expect(turn1Prompt).toContain("【用户正式需求】");
      expect(turn1Prompt).toContain("【本地宿主机工作区事实】");

      // 绝不包含通用模式的握手探测与冗余契约
      expect(turn1Prompt).not.toContain("【第一轮基准探测握手");
      expect(turn1Prompt).not.toContain("command: git status");
      expect(turn1Prompt).not.toContain("【交接协议铁律 (Turn Protocol Contract)】");
      expect(turn1Prompt).not.toContain("【可用工具格式 (Tool Calling)】");
    });
  });

  // =========================================================================
  // 3. Dynamic Switch: /agent clear Fallback to Generic Handshake & /agent Rebind
  // =========================================================================
  describe("3. Unbinding via /agent clear and Smooth Fallback to Generic Handshake", () => {
    it("should switch back to two-turn handshake when /agent clear is executed, and rebind smoothly", async () => {
      const rawAgentId = "T_switch_agent_888";
      const mockClient = new MockAgentChatClient((prompt, turn) => {
        if (prompt.includes("【第一轮基准探测握手")) {
          return {
            text: "```action\ntool: run_command\ncommand: git status\n```",
          };
        }
        return {
          text: "FINAL_ANSWER: 通用握手模式下已顺利完成任务交付。",
        };
      });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        customAgentId: rawAgentId,
        chatClient: mockClient,
        renderer,
      });

      expect(cli.customAgentId).toBe(rawAgentId);
      expect(cli.getOrchestrator().isHandshakePending).toBe(false);

      // 1. Clear agent binding via command
      await cli.handleCommand("/agent clear");

      expect(cli.customAgentId).toBeUndefined();
      expect(cli.getOrchestrator().getCustomAgentId()).toBeUndefined();
      expect(cli.getOrchestrator().isHandshakePending).toBe(true);

      // Verify .cph/config.json updated
      const config = cli.loadWorkspaceConfig();
      expect(config.customAgentId).toBeUndefined();

      // Verify diagnostic card and status bar reflect generic mode
      const diagCard = cli.getDiagnosticCard();
      expect(diagCard).toContain("无 (通用模式)");

      cliOutputBuffer = [];
      cli.renderCurrentStatusBar();
      expect(getCombinedOutput()).toContain("智能体:");
      expect(getCombinedOutput()).toContain("通用握手模式");

      // 2. Execute task under generic mode: must enforce Turn 1 handshake probing
      mockClient.reset();
      const genericTask = "排查生产环境死锁隐患";
      await cli.executeTask(genericTask);

      expect(mockClient.sentPrompts.length).toBe(2);

      // Round 1: Pure handshake probing, does NOT send user task
      const promptTurn1 = mockClient.sentPrompts[0];
      expect(promptTurn1).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
      expect(promptTurn1).toContain("command: git status");
      expect(promptTurn1).not.toContain(genericTask);

      // Round 2: After git status succeeds, user task and protocol are injected
      const promptTurn2 = mockClient.sentPrompts[1];
      expect(promptTurn2).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(promptTurn2).toContain(genericTask);
      expect(promptTurn2).toContain("【交接协议规范 (Turn Protocol Contract)】");

      // 3. Re-bind custom agent via /agent <url>
      const newAgentUrl = "https://m365.cloud.microsoft/chat/agent/T_rebound_agent_999?es=Click";
      await cli.handleCommand(`/agent ${newAgentUrl}`);

      expect(cli.customAgentId).toBe("T_rebound_agent_999");
      expect(cli.getOrchestrator().getCustomAgentId()).toBe("T_rebound_agent_999");
      expect(cli.getOrchestrator().isHandshakePending).toBe(false);

      // Re-executing next task directly goes straight-through
      mockClient.reset();
      await cli.executeTask("专属模式下的快速迭代");

      expect(mockClient.sentPrompts.length).toBe(1);
      expect(mockClient.sentPrompts[0]).toContain("专属模式下的快速迭代");
      expect(mockClient.sentPrompts[0]).not.toContain("【第一轮基准探测握手");
    });
  });

  // =========================================================================
  // 4. Status Bar Rendering and Workspace Config Persistence
  // =========================================================================
  describe("4. Status Bar Agent Badge & Automatic Config Persistence across Restarts", () => {
    it("should persist customAgentId into .cph/config.json and restore it across new CLI instances", async () => {
      const boundId = "T_persistent_agent_42";

      // Session A binds agent
      const cliA = new CphPiCli({ workspaceRoot: tmpDir });
      await cliA.handleCommand(`/agent ${boundId}`);
      expect(cliA.customAgentId).toBe(boundId);

      // Verify file persistence
      const configFile = path.join(tmpDir, ".cph", "config.json");
      expect(fs.existsSync(configFile)).toBe(true);
      const savedConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(savedConfig.customAgentId).toBe(boundId);

      // Session B boots with no CLI arguments in the same workspace
      const mockClientB = new MockAgentChatClient();
      const cliB = new CphPiCli({
        workspaceRoot: tmpDir,
        chatClient: mockClientB,
        renderer,
      });

      // Auto-restored from .cph/config.json
      expect(cliB.customAgentId).toBe(boundId);
      expect(cliB.getOrchestrator().getCustomAgentId()).toBe(boundId);
      expect(cliB.getOrchestrator().isHandshakePending).toBe(false);

      // Render status bar in Session B
      cliOutputBuffer = [];
      cliB.renderCurrentStatusBar();
      const barOutput = getCombinedOutput();
      expect(barOutput).toContain("智能体:");
      expect(barOutput).toContain("T_persistent...");

      // Verify direct execution out of the box in Session B
      await cliB.executeTask("新会话自动继承专属 Agent");
      expect(mockClientB.sentPrompts.length).toBe(1);
      expect(mockClientB.sentPrompts[0]).toContain("新会话自动继承专属 Agent");
      expect(mockClientB.sentPrompts[0]).not.toContain("【第一轮基准探测握手");
    });
  });
});
