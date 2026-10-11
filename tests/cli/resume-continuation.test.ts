import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CliApp, CphPiCli, parseCliArgs, getHelpText } from "../../src/cli.ts";
import { SessionManager } from "../../src/session/session-manager.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";

class MockChatClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public callCount = 0;
  public capturedPrompts: string[] = [];

  constructor(responses: string[] = []) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    this.capturedPrompts.push(params.text);
    const resp = this.responses[this.callCount] || "FINAL_ANSWER: 任务接力推进圆满完成";
    this.callCount++;
    return { text: resp };
  }
}

describe("10-Hop Autonomous Relay Limit & Auto-Continuation (Task 5)", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;
  let tuiOutput: string[];
  let renderer: TuiRenderer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-resume-test-"));
    sessionManager = new SessionManager(tmpDir);
    tuiOutput = [];
    renderer = new TuiRenderer({
      writer: (text: string) => {
        tuiOutput.push(text);
      },
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. Default Hops Limit & CLI Flags Override", () => {
    it("should default maxAutonomousHandoffHops to 10 in CliApp", () => {
      const app = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
      });
      expect(app.getMaxAutonomousHandoffHops()).toBe(10);
    });

    it("should support option override for maxAutonomousHandoffHops", () => {
      const app = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        maxAutonomousHandoffHops: 5,
      });
      expect(app.getMaxAutonomousHandoffHops()).toBe(5);
    });

    it("should parse --max-hops and --hops flags correctly in parseCliArgs", () => {
      const res1 = parseCliArgs(["--max-hops", "15"]);
      expect(res1.maxAutonomousHandoffHops).toBe(15);

      const res2 = parseCliArgs(["--hops", "8"]);
      expect(res2.maxAutonomousHandoffHops).toBe(8);

      const res3 = parseCliArgs(["--hops=12"]);
      expect(res3.maxAutonomousHandoffHops).toBe(12);

      const res4 = parseCliArgs(["--max-hops=7"]);
      expect(res4.maxAutonomousHandoffHops).toBe(7);
    });

    it("should document --hops and updated default 10 in getHelpText", () => {
      const help = getHelpText();
      expect(help).toContain("--max-hops");
      expect(help).toContain("--hops");
      expect(help).toContain("10");
    });
  });

  describe("2. /resume <id> Smart Auto-Continuation", () => {
    it("should automatically continue task when resuming a handed-off session with snapshot", async () => {
      const mockClient = new MockChatClient([
        "FINAL_ANSWER: 已根据脱困成果快照成功接力完成剩余工作",
      ]);

      const handedOffSession = sessionManager.createSession({
        title: "复杂重构长任务",
        status: "handed_off",
        handoffSnapshot: "【阶段性成果】CNNJI 模块已完成 50% 重构，待办: 修复 JsygtBatch 重试",
      });
      handedOffSession.turns.push({
        turnNumber: 1,
        timestamp: new Date().toISOString(),
        userInput: "开始重构",
        modelResponse: "阶段 1 完成",
      });
      sessionManager.saveSession(handedOffSession);

      const cli = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        customAgentId: "test-agent",
      });

      // Execute /resume command
      await cli.handleCommand(`/resume ${handedOffSession.id}`);

      // Verify active session is switched
      expect(cli.getCurrentSession()?.id).toBe(handedOffSession.id);
      expect(cli.getCurrentSession()?.status).toBe("completed");

      // Verify task execution was triggered automatically
      expect(mockClient.callCount).toBe(1);
      const promptSent = mockClient.capturedPrompts[0];
      expect(promptSent).toContain("【前序会话脱困成果快照】");
      expect(promptSent).toContain("CNNJI 模块已完成 50% 重构");
      expect(promptSent).toContain("请根据前序会话成果快照继续推进剩余需求");
    });

    it("should support custom prompt override with /resume <id> <custom instructions>", async () => {
      const mockClient = new MockChatClient([
        "FINAL_ANSWER: 针对性修复已完成",
      ]);

      const handedOffSession = sessionManager.createSession({
        title: "待修复任务",
        status: "handed_off",
        handoffSnapshot: "【阶段性成果】发现了 2 个边界漏洞",
      });
      sessionManager.saveSession(handedOffSession);

      const cli = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        customAgentId: "test-agent",
      });

      await cli.handleCommand(`/resume ${handedOffSession.id} 优先修复第二项边界漏洞`);

      expect(mockClient.callCount).toBe(1);
      const promptSent = mockClient.capturedPrompts[0];
      expect(promptSent).toContain("【前序会话脱困成果快照】");
      expect(promptSent).toContain("优先修复第二项边界漏洞");
    });

    it("should NOT trigger auto-continuation when resuming normal active session without handoff snapshot", async () => {
      const mockClient = new MockChatClient();

      const normalSession = sessionManager.createSession({
        title: "普通普通会话",
        status: "active",
      });
      normalSession.turns.push({
        turnNumber: 1,
        timestamp: new Date().toISOString(),
        userInput: "你好",
        modelResponse: "你好！有什么我可以帮你的？",
      });
      sessionManager.saveSession(normalSession);

      const cli = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        customAgentId: "test-agent",
      });

      await cli.handleCommand(`/resume ${normalSession.id}`);

      // Session switched but no continuation prompt executed
      expect(cli.getCurrentSession()?.id).toBe(normalSession.id);
      expect(mockClient.callCount).toBe(0);
    });
  });

  describe("3. /continue and /relay Command Continuation", () => {
    it("should recognize /continue and /relay in handleInputLine without unknown command error", async () => {
      const mockClient = new MockChatClient([
        "FINAL_ANSWER: 续跑成功",
      ]);

      const handedOffSession = sessionManager.createSession({
        title: "待续跑任务",
        status: "handed_off",
        handoffSnapshot: "【成果】已梳理架构图",
      });
      sessionManager.saveSession(handedOffSession);

      let stdoutOutput = "";
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutOutput += String(chunk);
        return true;
      }) as any;

      try {
        const cli = new CliApp({
          workspaceRoot: tmpDir,
          sessionManager,
          renderer,
          chatClient: mockClient,
        customAgentId: "test-agent",
        });

        await cli.handleInputLine("/continue");
        expect(stdoutOutput).not.toContain("未知命令或技能");
        expect(mockClient.callCount).toBe(1);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    it("should automatically find latest handed-off session and resume with /continue", async () => {
      const mockClient = new MockChatClient([
        "FINAL_ANSWER: 接力完成",
      ]);

      const s1 = sessionManager.createSession({
        title: "历史普通会话",
        status: "completed",
      });
      sessionManager.saveSession(s1);

      const s2 = sessionManager.createSession({
        title: "挂起的长任务",
        status: "handed_off",
        handoffSnapshot: "【快照】已完成前 3 阶段，第 4 阶段待继续",
      });
      sessionManager.saveSession(s2);

      const cli = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        customAgentId: "test-agent",
      });

      await cli.handleCommand("/continue");

      expect(cli.getCurrentSession()?.id).toBe(s2.id);
      expect(mockClient.callCount).toBe(1);
      const promptSent = mockClient.capturedPrompts[0];
      expect(promptSent).toContain("【前序会话脱困成果快照】");
      expect(promptSent).toContain("已完成前 3 阶段");
    });

    it("should support /relay as an alias with custom task instructions", async () => {
      const mockClient = new MockChatClient([
        "FINAL_ANSWER: 接力执行自定义指令完成",
      ]);

      const s = sessionManager.createSession({
        title: "接力任务",
        status: "handed_off",
        handoffSnapshot: "【快照】核心依赖已注入",
      });
      sessionManager.saveSession(s);

      const cli = new CliApp({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        customAgentId: "test-agent",
      });

      await cli.handleCommand("/relay 推进端到端集成测试");

      expect(cli.getCurrentSession()?.id).toBe(s.id);
      expect(mockClient.callCount).toBe(1);
      const promptSent = mockClient.capturedPrompts[0];
      expect(promptSent).toContain("推进端到端集成测试");
      expect(promptSent).toContain("核心依赖已注入");
    });
  });
});
