import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Orchestrator } from "../../src/agent/orchestrator.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import type { ToolBridgeResult } from "../../src/protocol/tool-bridge.ts";

describe("Cloud Document Attachment & Pure HTTP Upload Orchestrator Integration", () => {
  let tmpDir: string;
  let mockGraphServer: any = null;
  let uploadedRequests: Array<{ url: string; body: string; headers: Headers }> = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cloud-attach-test-"));
    uploadedRequests = [];
  });

  afterEach(() => {
    if (mockGraphServer) {
      mockGraphServer.stop(true);
      mockGraphServer = null;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. should upload large tool output to OneDrive via Graph PUT and attach annotations to next sendMessage", async () => {
    // 1. Setup mock Graph HTTP server
    mockGraphServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        uploadedRequests.push({
          url: req.url,
          body,
          headers: req.headers,
        });
        return new Response(
          JSON.stringify({
            id: "onedrive-item-auto-123",
            name: "tool-result-run_command-auto.txt",
            webUrl: "https://cma-cgm.sharepoint.com/personal/vfu2/tool-result.txt",
            parentReference: {
              driveId: "b!mockDriveId456",
            },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const originalDefaultGraphUrl = SubstrateUploader.DEFAULT_GRAPH_URL;
    SubstrateUploader.DEFAULT_GRAPH_URL = `http://127.0.0.1:${mockGraphServer.port}/drive/root:/CopilotContext`;

    try {
      // 2. Prepare mock ToolBridge that returns a large output (60 lines, 3000 chars)
      const largeLines = Array.from({ length: 60 }, (_, i) => `Log line ${i + 1}: processed batch record data`);
      const largeOutput = largeLines.join("\n");

      const mockBridge: any = {
        executeAction: async () => {
          return {
            actionName: "run_command",
            piToolName: "bash",
            target: "powershell Get-ChildItem",
            success: true,
            output: largeOutput,
            formatted: "formatted",
          } as ToolBridgeResult;
        },
      };

      // 3. Track calls to client.sendMessage
      const sentMessages: Array<{ text: string; annotations?: any[] }> = [];

      const mockClient: IOrchestratorChatClient = {
        async sendMessage(params) {
          sentMessages.push({
            text: params.text,
            annotations: params.annotations,
          });

          // Turn 1: Model requests action
          if (sentMessages.length === 1) {
            return {
              text: '【Thought】正在查询工程文件\n```action\ntool: run_command\ncommand: Get-ChildItem -Recurse\n```',
            };
          }

          // Turn 2: Model finishes task
          return {
            text: 'FINAL_ANSWER: 已基于挂载的文件附件成功分析全量代码清单。',
          };
        },
      };

      let uploadedEventAttachment: any = null;

      // 4. Instantiate Orchestrator with cloud attachment enabled
      const orchestrator = new Orchestrator({
        workspaceRoot: tmpDir,
        bridge: mockBridge,
        chatClient: mockClient,
        customAgentId: "T_test_dev_agent", // Direct agent mode
        graphTokenProvider: async () => "mock-graph-jwt-token",
        cloudAttachmentThresholdChars: 500,
        cloudAttachmentThresholdLines: 15,
      });

      const runResult = await orchestrator.run({
        task: "请分析工程文件",
        events: {
          onAttachmentUploaded: (att) => {
            uploadedEventAttachment = att;
          },
        },
      });

      // 5. Verifications
      expect(runResult.completed).toBe(true);
      expect(runResult.finalAnswer).toContain("已基于挂载的文件附件成功分析全量代码清单");

      // Verify Graph HTTP PUT request was made
      expect(uploadedRequests.length).toBe(1);
      expect(uploadedRequests[0].headers.get("authorization")).toBe("Bearer mock-graph-jwt-token");
      expect(uploadedRequests[0].body).toBe(largeOutput);

      // Verify onAttachmentUploaded event was triggered
      expect(uploadedEventAttachment).toBeDefined();
      expect(uploadedEventAttachment.driveItemId).toBe("onedrive-item-auto-123");

      // Verify Turn 2 sendMessage parameters
      expect(sentMessages.length).toBe(2);
      const turn2Message = sentMessages[1];

      // Annotations must be attached
      expect(turn2Message.annotations).toBeDefined();
      expect(turn2Message.annotations!.length).toBe(1);
      expect(turn2Message.annotations![0].id).toBe("onedrive-item-auto-123");
      expect(turn2Message.annotations![0].messageAnnotationType).toBe("LocalFile");
      expect(turn2Message.annotations![0].messageAnnotationMetadata?.fileName).toBe(
        "tool-result-run_command-auto.txt"
      );
      expect(turn2Message.annotations![0].messageAnnotationMetadata.driveId).toBe("b!mockDriveId456");

      // Prompt text must be clean & lightweight: MUST NOT contain the 3000 chars of output!
      expect(turn2Message.text).not.toContain("Log line 1: processed batch record data");
      expect(turn2Message.text).not.toContain("Log line 30: processed batch record data");
      expect(turn2Message.text).toContain("[TOOL_RESULT for run_command - SUCCESS (ATTACHED)]");
      expect(turn2Message.text).toContain("完整执行结果已作为文件附件");
      expect(turn2Message.text).toContain("云端文档引擎已对该附件进行全量原生解析");

      // 6. History must preserve 100% full original execution output for auditing & handover
      expect(runResult.history[0].toolOutput).toBe(largeOutput);
    } finally {
      SubstrateUploader.DEFAULT_GRAPH_URL = originalDefaultGraphUrl;
    }
  });

  it("2. should NOT upload to cloud if tool output is short (preserves fast inline delivery)", async () => {
    const mockBridge: any = {
      executeAction: async () => {
        return {
          actionName: "run_command",
          piToolName: "bash",
          target: "git status",
          success: true,
          output: "On branch main\nnothing to commit, working tree clean",
          formatted: "formatted",
        } as ToolBridgeResult;
      },
    };

    const sentMessages: Array<{ text: string; annotations?: any[] }> = [];

    const mockClient: IOrchestratorChatClient = {
      async sendMessage(params) {
        sentMessages.push({
          text: params.text,
          annotations: params.annotations,
        });

        if (sentMessages.length === 1) {
          return {
            text: '```action\ntool: run_command\ncommand: git status\n```',
          };
        }

        return {
          text: 'FINAL_ANSWER: Git 状态干净。',
        };
      },
    };

    let uploadedCalled = false;

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      bridge: mockBridge,
      chatClient: mockClient,
      customAgentId: "T_test_dev_agent",
      graphTokenProvider: async () => {
        uploadedCalled = true;
        return "mock-token";
      },
      cloudAttachmentThresholdChars: 500,
      cloudAttachmentThresholdLines: 15,
    });

    const runResult = await orchestrator.run({
      task: "检查 git 状态",
    });

    expect(runResult.completed).toBe(true);
    expect(uploadedCalled).toBe(false);
    expect(uploadedRequests.length).toBe(0);

    const turn2Message = sentMessages[1];
    expect(turn2Message.annotations).toBeUndefined();
    expect(turn2Message.text).toContain("On branch main");
  });

  it("3. should gracefully fallback to inline prompt if graph token provider fails or throws", async () => {
    const largeOutput = "A".repeat(1000);

    const mockBridge: any = {
      executeAction: async () => {
        return {
          actionName: "run_command",
          piToolName: "bash",
          target: "run",
          success: true,
          output: largeOutput,
          formatted: "formatted",
        } as ToolBridgeResult;
      },
    };

    const sentMessages: Array<{ text: string; annotations?: any[] }> = [];

    const mockClient: IOrchestratorChatClient = {
      async sendMessage(params) {
        sentMessages.push({
          text: params.text,
          annotations: params.annotations,
        });

        if (sentMessages.length === 1) {
          return {
            text: '```action\ntool: run_command\ncommand: run\n```',
          };
        }

        return {
          text: 'FINAL_ANSWER: 降级执行完成。',
        };
      },
    };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      bridge: mockBridge,
      chatClient: mockClient,
      customAgentId: "T_test_dev_agent",
      graphTokenProvider: async () => {
        throw new Error("Network offline or Graph disabled");
      },
      cloudAttachmentThresholdChars: 500,
    });

    const runResult = await orchestrator.run({
      task: "测试异常降级",
    });

    expect(runResult.completed).toBe(true);
    expect(sentMessages.length).toBe(2);
    // Should fallback to normal tool result prompt without throwing
    expect(sentMessages[1].text).toContain("[TOOL_RESULT for run_command - SUCCESS]");
  });
});

