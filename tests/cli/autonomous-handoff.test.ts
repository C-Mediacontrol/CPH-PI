import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CphPiCli, parseCliArgs, getHelpText } from "../../src/cli.ts";
import { SessionManager } from "../../src/session/session-manager.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { InterruptController } from "../../src/agent/interrupt-controller.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

class MockChatClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public callCount = 0;
  public capturedPrompts: string[] = [];
  public capturedMessages: any[] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    this.capturedPrompts.push(params.text);
    this.capturedMessages.push(params);
    const resp = this.responses[this.callCount] || "FINAL_ANSWER: 任务接力推进圆满完成";
    this.callCount++;
    return { text: resp };
  }
}

describe("Autonomous Continuation Loop (Task 4)", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;
  let tuiOutput: string[];
  let renderer: TuiRenderer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-auto-handoff-"));
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

  describe("1. Single Session Handoff Relay Closed-Loop (单会话脱困接力闭环)", () => {
    it("should automatically hand off to a new session with stage 2 prompt and complete without user input", async () => {
      // Session 1: maxTurns=1, runs 1 action and hits limit -> handedOff: true
      // Session 2: responds with FINAL_ANSWER -> completed: true
      const responses = [
        // Session 1 Turn 1
        "```action\ntool: run_command\ncommand: echo init\n```",
        // Session 2 Turn 1
        "FINAL_ANSWER: 第二阶段成功完成审查并交付报告",
      ];
      const mockClient = new MockChatClient(responses);

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        maxTurns: 1,
        maxAutonomousHandoffHops: 3,
        customAgentId: "test-agent",
      });

      await cli.executeTask("审查 CNNJI QUERY 核心模块并输出报告");

      // Verify Session 1
      const sessions = sessionManager.listSessions();
      expect(sessions.length).toBe(2);

      const session1Summary = sessions.find((s) => s.status === "handed_off");
      expect(session1Summary).toBeDefined();

      const session1 = sessionManager.loadSession(session1Summary!.id)!;
      expect(session1.status).toBe("handed_off");
      expect(session1.handoffSnapshot).toBeDefined();
      expect(session1.handoffSnapshot).toContain("【任务目标与原始需求】");
      expect(session1.handoffDocPath).toBeDefined();
      expect(fs.existsSync(session1.handoffDocPath!)).toBe(true);

      // Verify Session 2
      const session2Summary = sessions.find((s) => s.status === "completed");
      expect(session2Summary).toBeDefined();
      const session2 = sessionManager.loadSession(session2Summary!.id)!;
      expect(session2.status).toBe("completed");
      expect(session2.title).toContain("(接力 1)");

      // Verify CLI current session is the completed new session
      expect(cli.getCurrentSession()?.id).toBe(session2.id);
      expect(cli.getCurrentSession()?.status).toBe("completed");

      // Verify the continuation prompt structure sent to Session 2
      expect(mockClient.callCount).toBe(2);
      const stage2Prompt = mockClient.capturedPrompts[1];
      expect(stage2Prompt).toContain("【自主接力延续任务 - 阶段 2】");
      expect(stage2Prompt).toContain("终极目标: 审查 CNNJI QUERY 核心模块并输出报告");
      expect(stage2Prompt).toContain("物理账本: .cph/state/execution-ledger.md");
      expect(stage2Prompt).toContain("【接力行动准则】");
      expect(stage2Prompt).not.toContain("【已验证客观事实与阶段性成果】");
      expect(stage2Prompt.length).toBeLessThan(800);

      // Verify Banner output
      const combinedOutput = tuiOutput.join("");
      expect(combinedOutput).toContain("[Auto-Handoff]");
      expect(combinedOutput).toContain("自主换会话接力跃迁");
      expect(combinedOutput).toContain(session2.id);
    });

    it("should upload handoff snapshot to OneDrive when graphTokenProvider is provided and pass attachment as initialAnnotations to stage 2", async () => {
      const responses = [
        "```action\ntool: run_command\ncommand: echo init\n```",
        "FINAL_ANSWER: 第二阶段完成",
      ];
      const mockClient = new MockChatClient(responses);

      const dummyAnnotation = {
        id: "mock-handoff-doc-id",
        text: "handoff-doc.md",
        url: "https://onedrive.example.com/handoff-doc.md",
        messageAnnotationType: "LocalFile",
        messageAnnotationMetadata: {
          "@type": "File",
          annotationType: "File",
          fileName: "handoff-doc.md",
          webUrl: "https://onedrive.example.com/handoff-doc.md",
        },
      };

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockResolvedValue({
        driveItemId: "mock-handoff-doc-id",
        webUrl: "https://onedrive.example.com/handoff-doc.md",
        fileName: "handoff-doc.md",
        annotation: dummyAnnotation as any,
      });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        maxTurns: 1,
        maxAutonomousHandoffHops: 3,
        customAgentId: "test-agent",
        graphTokenProvider: async () => "mock-graph-token-123",
      });

      try {
        await cli.executeTask("验证附件接力任务");

        // Verify SubstrateUploader.uploadDocumentToOneDrive was called
        expect(uploadSpy).toHaveBeenCalled();
        const callArgs = uploadSpy.mock.calls[0];
        expect(callArgs[0]).toBe("mock-graph-token-123");

        // Verify Session 2 first message received annotations
        expect(mockClient.callCount).toBe(2);
        const stage2Params = mockClient.capturedMessages[1];
        expect(stage2Params.annotations).toBeDefined();
        expect(stage2Params.annotations?.length).toBe(1);
        expect(stage2Params.annotations?.[0].id).toBe("mock-handoff-doc-id");

        // Verify stage 2 prompt references attachment and minimal fingerprint header
        const stage2Prompt = mockClient.capturedPrompts[1];
        expect(stage2Prompt).toContain("【自主接力延续任务 - 阶段 2】");
        expect(stage2Prompt).toContain("终极目标: 验证附件接力任务");
        expect(stage2Prompt).toContain("附件中的交接文档");
        expect(stage2Prompt).toContain("物理账本: .cph/state/execution-ledger.md");
        expect(stage2Prompt).not.toContain("【已验证客观事实与阶段性成果】");
        expect(stage2Prompt.length).toBeLessThan(800);
      } finally {
        uploadSpy.mockRestore();
      }
    });
  });

  describe("2. Continuous Multi-Hop Handoff & Upper Bound Protection (连续接力与上限保护)", () => {
    it("should support multiple sequential hops until completion", async () => {
      // 3 hops:
      // Session 1: handed off
      // Session 2: handed off
      // Session 3: completed
      const responses = [
        "```action\ntool: run_command\ncommand: echo hop1\n```",
        "```action\ntool: run_command\ncommand: echo hop2\n```",
        "FINAL_ANSWER: 三阶段全链路推进完成！",
      ];
      const mockClient = new MockChatClient(responses);

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        maxTurns: 1,
        maxAutonomousHandoffHops: 3,
        customAgentId: "test-agent",
      });

      await cli.executeTask("超长复杂跨工程重构任务");

      const sessions = sessionManager.listSessions();
      expect(sessions.length).toBe(3);

      const handedOffSessions = sessions.filter((s) => s.status === "handed_off");
      expect(handedOffSessions.length).toBe(2);

      const completedSessions = sessions.filter((s) => s.status === "completed");
      expect(completedSessions.length).toBe(1);

      expect(mockClient.capturedPrompts[1]).toContain("【自主接力延续任务 - 阶段 2】");
      expect(mockClient.capturedPrompts[2]).toContain("【自主接力延续任务 - 阶段 3】");
    });

    it("should safely suspend and warn user when reaching maxAutonomousHandoffHops limit", async () => {
      // maxAutonomousHandoffHops = 2
      // Session 1: handed off -> hop 1 (Session 2 created)
      // Session 2: handed off -> hop 2 (Session 3 created)
      // Session 3: handed off -> reaches maxAutonomousHandoffHops (2), suspends!
      const responses = [
        "```action\ntool: run_command\ncommand: echo turn1\n```",
        "```action\ntool: run_command\ncommand: echo turn2\n```",
        "```action\ntool: run_command\ncommand: echo turn3\n```",
        "FINAL_ANSWER: 不应该被调用",
      ];
      const mockClient = new MockChatClient(responses);

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        chatClient: mockClient,
        maxTurns: 1,
        maxAutonomousHandoffHops: 2,
        customAgentId: "test-agent",
      });

      let stdoutOutput = "";
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutOutput += String(chunk);
        return true;
      }) as any;

      try {
        await cli.executeTask("无限循环任务");
      } finally {
        process.stdout.write = origWrite;
      }

      // Should have run exactly 3 sessions (1 initial + 2 hops)
      expect(mockClient.callCount).toBe(3);

      const sessions = sessionManager.listSessions();
      expect(sessions.length).toBe(3);

      // All 3 sessions should be handed_off
      for (const s of sessions) {
        expect(s.status).toBe("handed_off");
      }

      // Suspension notice should be rendered to terminal
      expect(stdoutOutput).toContain("已达到连续自主接力跃迁上限 (2 次接力)");
      expect(stdoutOutput).toContain("任务已安全挂起并保留当前全部进度");

      // pendingHandoffSnapshot should be saved for manual continuation
      expect(cli.getPendingHandoffSnapshot()).toBeDefined();
    });
  });

  describe("3. Cancellation & Interrupt Safety (取消中断安全性)", () => {
    it("should safely stop continuation when AbortController triggers mid-run", async () => {
      const interruptController = new InterruptController();
      let hasAborted = false;

      // Mock chat client that triggers Ctrl+C interrupt during first hop
      const mockClient: IOrchestratorChatClient = {
        async sendMessage() {
          if (!hasAborted) {
            hasAborted = true;
            // First run hands off
            return {
              text: "```action\ntool: run_command\ncommand: echo hop1\n```",
            };
          } else {
            // Second run: simulate SIGINT / abort before completion
            interruptController.handleSigint();
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            throw err;
          }
        },
      };

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        renderer,
        interruptController,
        chatClient: mockClient,
        maxTurns: 1,
        maxAutonomousHandoffHops: 3,
        customAgentId: "test-agent",
      });

      await cli.executeTask("执行可中断的长任务");

      const combinedOutput = tuiOutput.join("");
      expect(combinedOutput).toContain("已拦截 Ctrl+C");
      expect(combinedOutput).toContain("安全中止");

      // Interrupt controller should return to idle
      expect(interruptController.isBusy()).toBe(false);
    });
  });

  describe("4. CLI Flags & TuiRenderer Banner", () => {
    it("should parse --max-hops flag correctly", () => {
      const res1 = parseCliArgs(["--max-hops", "5"]);
      expect(res1.maxAutonomousHandoffHops).toBe(5);

      const res2 = parseCliArgs(["--max-hops=4"]);
      expect(res2.maxAutonomousHandoffHops).toBe(4);
    });

    it("should include --max-hops in help text", () => {
      const help = getHelpText();
      expect(help).toContain("--max-hops");
    });

    it("should format and render autonomous handoff banner with doc path in TuiRenderer", () => {
      const docPath = path.join(tmpDir, ".cph", "handoffs", "handoff-ses_123.md");
      renderer.renderAutonomousHandoffBanner("ses_new_456", 2, 3, docPath);

      const output = tuiOutput.join("");
      expect(output).toContain("[Auto-Handoff]");
      expect(output).toContain("ses_new_456");
      expect(output).toContain("2/3");
      expect(output).toContain(docPath);
    });
  });
});
