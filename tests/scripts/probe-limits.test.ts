import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildShortPrompt,
  buildLongTextPrompt,
  buildLocalFilePrompt,
  buildCloudAttachmentPayload,
  evaluateTerminalCondition,
  parseCliArgs,
  saveProbeReport,
  generateMarkdownReport,
  ProbeLimitsRunner,
  type ProbeReport,
} from "../../scripts/probe-limits.ts";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("Probe Limits Engine & Suite Tests", () => {
  let mockServer: any = null;
  const testWorkspace = path.resolve(__dirname, "../../");
  const testReportsDir = path.join(testWorkspace, ".cph", "probe-reports-test");
  const testFilesDir = path.join(testWorkspace, ".cph", "probe-files-test");

  afterEach(() => {
    if (mockServer) {
      try {
        mockServer.stop(true);
      } catch {}
      mockServer = null;
    }
    // Clean up test directories
    if (fs.existsSync(testReportsDir)) {
      try {
        fs.rmSync(testReportsDir, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(testFilesDir)) {
      try {
        fs.rmSync(testFilesDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. Payload Generators & CLI Argument Parsing", () => {
    it("should build short prompt correctly for turn 1 and turn N", () => {
      const p1 = buildShortPrompt(1);
      expect(p1).toBe("我们正在进行基础连通性基准测试。请仅回答数字：1。");

      const p2 = buildShortPrompt(2);
      expect(p2).toBe("收到。请仅回答下一个数字：2。");

      const p45 = buildShortPrompt(45);
      expect(p45).toBe("收到。请仅回答下一个数字：45。");
    });

    it("should build long text prompt exceeding 3500 chars with code, logs and task", () => {
      const longPrompt = buildLongTextPrompt(7);
      expect(longPrompt.length).toBeGreaterThanOrEqual(3500);
      expect(longPrompt).toContain("Turn 7");
      expect(longPrompt).toContain("FastSignalRDecoder");
      expect(longPrompt).toContain("SlidingWindowBufferCompactor");
      expect(longPrompt).toContain("【分析任务】");
    });

    it("should build local file prompt and persist 10KB file to disk", () => {
      const result = buildLocalFilePrompt(3, testFilesDir);
      expect(fs.existsSync(result.filePath)).toBe(true);

      const stats = fs.statSync(result.filePath);
      expect(stats.size).toBe(10240); // 10KB

      expect(result.prompt).toContain("turn-3.log");
      expect(result.prompt).toContain("头部摘要");
      expect(result.prompt).toContain("尾部摘要");
      expect(result.prompt).toContain("10240 字节");
    });

    it("should build cloud attachment payload with AttachmentAnnotation metadata", () => {
      const payload = buildCloudAttachmentPayload(12);
      expect(payload.annotations.length).toBe(1);
      expect(payload.annotations[0].messageAnnotationType).toBe("File");
      expect(payload.annotations[0].messageAnnotationMetadata.fileName).toBe("handoff-turn-12.md");
      expect(payload.annotations[0].messageAnnotationMetadata.fileType).toBe("md");
      expect(payload.prompt).toContain("handoff-turn-12.md");
      expect(payload.prompt).toContain("Turn 12");
    });

    it("should parse CLI arguments accurately", () => {
      const args = parseCliArgs([
        "--mode",
        "long-text",
        "--max-turns",
        "30",
        "--agent",
        "custom-agent-123",
        "--output-dir",
        "/custom/reports",
        "--mock-port",
        "8899",
        "--pacing-ms",
        "500",
      ]);

      expect(args.mode).toBe("long-text");
      expect(args.maxTurns).toBe(30);
      expect(args.agentId).toBe("custom-agent-123");
      expect(args.outputDir).toBe("/custom/reports");
      expect(args.mockPort).toBe(8899);
      expect(args.pacingMs).toBe(500);
    });
  });

  describe("2. Terminal Condition Evaluation", () => {
    it("should return false for normal successful responses", () => {
      const evalRes = evaluateTerminalCondition(
        "Here is the code review output.",
        [{ text: "Here is the code review output.", author: "bot" }],
        [{ type: 2, item: { result: { value: "Success" } } }]
      );
      expect(evalRes.isTerminal).toBe(false);
    });

    it("should detect Disengaged in rawMessages", () => {
      const evalRes = evaluateTerminalCondition(
        "Conversation ended.",
        [{ messageType: "Disengaged", text: "已达到此对话的限制，请开启新主题。" }],
        [{ type: 2 }]
      );
      expect(evalRes.isTerminal).toBe(true);
      expect(evalRes.terminalCode).toBe("Disengaged");
      expect(evalRes.terminalSnippet).toContain("已达到此对话的限制");
      expect(evalRes.rawTerminalFrame.messageType).toBe("Disengaged");
    });

    it("should detect OffTopic in rawMessages", () => {
      const evalRes = evaluateTerminalCondition(
        "Off topic",
        [{ messageType: "OffTopic", text: "话题已偏离" }],
        [{ type: 2 }]
      );
      expect(evalRes.isTerminal).toBe(true);
      expect(evalRes.terminalCode).toBe("OffTopic");
    });

    it("should detect Throttled result in rawFrames", () => {
      const evalRes = evaluateTerminalCondition(
        "",
        [],
        [{ type: 2, item: { result: { value: "Throttled", message: "Rate limit exceeded" } } }]
      );
      expect(evalRes.isTerminal).toBe(true);
      expect(evalRes.terminalCode).toBe("Throttled");
      expect(evalRes.terminalSnippet).toBe("Rate limit exceeded");
    });

    it("should detect ConversationLimitReached text in model response", () => {
      const evalRes = evaluateTerminalCondition(
        "I'm sorry, you have reached the conversation limit. Please start a new topic.",
        [],
        []
      );
      expect(evalRes.isTerminal).toBe(true);
      expect(evalRes.terminalCode).toBe("ConversationLimitReached");
      expect(evalRes.terminalSnippet).toContain("reached the conversation limit");
    });

    it("should detect rateLimitDetected boolean flag", () => {
      const evalRes = evaluateTerminalCondition("Normal text", [], [], true);
      expect(evalRes.isTerminal).toBe(true);
      expect(evalRes.terminalCode).toBe("Throttled");
    });
  });

  describe("3. Mock WebSocket Duplex Multi-turn Normal Flow", () => {
    it("should complete multi-turn probe without hard-capping when normal", async () => {
      let turnCounter = 0;

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          message(ws, msg) {
            const raw = typeof msg === "string" ? msg : msg.toString();
            const frames = ChatHubClient.decodeSignalRFrames(raw);

            for (const f of frames) {
              if (f.protocol === "json") {
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                turnCounter++;
                // Stream reasoning
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [
                      {
                        messages: [
                          {
                            messageType: "Progress",
                            text: `Reasoning turn ${turnCounter}...`,
                          },
                        ],
                      },
                    ],
                  })
                );
                // Stream text response
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: `Answer ${turnCounter}` }],
                  })
                );
                // Complete turn
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 2,
                    item: { result: { value: "Success" } },
                  })
                );
              }
            }
          },
        },
      });

      const runner = new ProbeLimitsRunner({
        mode: "short",
        maxTurns: 3,
        pacingMs: 0,
        mockPort: mockServer.port,
        outputDir: testReportsDir,
      });

      const report = await runner.run();

      expect(report.mode).toBe("short");
      expect(report.maxTurnsAttempted).toBe(3);
      expect(report.actualCompletedTurns).toBe(3);
      expect(report.stoppedAtTurn).toBe(3);
      expect(report.isHardCapped).toBe(false);
      expect(report.terminalSignal).toBeUndefined();
      expect(report.turns.length).toBe(3);

      for (let i = 0; i < 3; i++) {
        const turn = report.turns[i];
        expect(turn.turn).toBe(i + 1);
        expect(turn.terminal).toBe(false);
        expect(turn.responseChars).toBeGreaterThan(0);
        expect(turn.reasoningChars).toBeGreaterThan(0);
        expect(turn.promptChars).toBeGreaterThan(0);
      }
    });
  });

  describe("4. Mock WebSocket Disengaged Interception at Turn 30", () => {
    it("should precisely capture Disengaged at turn 30 and record raw terminal frame", async () => {
      let turnCounter = 0;

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          message(ws, msg) {
            const raw = typeof msg === "string" ? msg : msg.toString();
            const frames = ChatHubClient.decodeSignalRFrames(raw);

            for (const f of frames) {
              if (f.protocol === "json") {
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                turnCounter++;
                if (turnCounter === 30) {
                  // Simulate Sydney Disengaged terminal frame on turn 30
                  ws.send(
                    ChatHubClient.encodeSignalR({
                      type: 1,
                      target: "update",
                      arguments: [
                        {
                          messages: [
                            {
                              author: "bot",
                              messageType: "Disengaged",
                              text: "抱歉，您已达到此对话的限制。请开启新主题继续。",
                            },
                          ],
                        },
                      ],
                    })
                  );
                  ws.send(
                    ChatHubClient.encodeSignalR({
                      type: 2,
                      item: { result: { value: "Disengaged" } },
                    })
                  );
                } else {
                  // Normal turn response
                  ws.send(
                    ChatHubClient.encodeSignalR({
                      type: 1,
                      target: "update",
                      arguments: [{ writeAtCursor: `Number ${turnCounter}` }],
                    })
                  );
                  ws.send(
                    ChatHubClient.encodeSignalR({
                      type: 2,
                      item: { result: { value: "Success" } },
                    })
                  );
                }
              }
            }
          },
        },
      });

      const runner = new ProbeLimitsRunner({
        mode: "short",
        maxTurns: 35,
        pacingMs: 0,
        mockPort: mockServer.port,
        outputDir: testReportsDir,
      });

      const report = await runner.run();

      expect(report.maxTurnsAttempted).toBe(30);
      expect(report.actualCompletedTurns).toBe(29);
      expect(report.stoppedAtTurn).toBe(30);
      expect(report.isHardCapped).toBe(true);
      expect(report.terminalSignal).toBe("Disengaged");
      expect(report.turns.length).toBe(30);

      // Verify turns 1..29 are normal
      for (let i = 0; i < 29; i++) {
        expect(report.turns[i].terminal).toBe(false);
      }

      // Verify turn 30 is captured as terminal
      const turn30 = report.turns[29];
      expect(turn30.turn).toBe(30);
      expect(turn30.terminal).toBe(true);
      expect(turn30.terminalCode).toBe("Disengaged");
      expect(turn30.terminalSnippet).toContain("已达到此对话的限制");
      expect(turn30.rawTerminalFrame).toBeDefined();
      expect(turn30.rawTerminalFrame.messageType).toBe("Disengaged");
    });
  });

  describe("5. Report Formatting and Disk Persistence", () => {
    it("should format markdown and save JSON & MD reports to target directory", () => {
      const mockReport: ProbeReport = {
        mode: "short",
        agentId: "test-agent-id",
        modelTone: "Gpt_61_Sol_Reasoning",
        conversationId: "test-conv-uuid",
        maxTurnsAttempted: 30,
        actualCompletedTurns: 29,
        stoppedAtTurn: 30,
        isHardCapped: true,
        terminalSignal: "Disengaged",
        turns: [
          {
            turn: 1,
            timestamp: new Date().toISOString(),
            promptChars: 30,
            responseChars: 5,
            reasoningChars: 15,
            latencyMs: 120,
            terminal: false,
          },
          {
            turn: 30,
            timestamp: new Date().toISOString(),
            promptChars: 30,
            responseChars: 25,
            reasoningChars: 0,
            latencyMs: 210,
            terminal: true,
            terminalCode: "Disengaged",
            terminalSnippet: "已达到此对话的限制",
            rawTerminalFrame: {
              author: "bot",
              messageType: "Disengaged",
              text: "已达到此对话的限制",
            },
          },
        ],
      };

      const md = generateMarkdownReport(mockReport);
      expect(md).toContain("# CPH-PI 云端会话轮数与上下文探测报告 (short)");
      expect(md).toContain("| **是否触发硬顶** | **是 (YES)** |");
      expect(md).toContain("`Disengaged`");
      expect(md).toContain("## 3. 原始终结帧 (Raw Terminal Frame)");
      expect(md).toContain('"messageType": "Disengaged"');

      const saved = saveProbeReport(mockReport, testReportsDir);
      expect(fs.existsSync(saved.jsonPath)).toBe(true);
      expect(fs.existsSync(saved.mdPath)).toBe(true);

      const jsonContent = JSON.parse(fs.readFileSync(saved.jsonPath, "utf-8"));
      expect(jsonContent.mode).toBe("short");
      expect(jsonContent.actualCompletedTurns).toBe(29);
      expect(jsonContent.stoppedAtTurn).toBe(30);
      expect(jsonContent.isHardCapped).toBe(true);
      expect(jsonContent.terminalSignal).toBe("Disengaged");
    });
  });
});
