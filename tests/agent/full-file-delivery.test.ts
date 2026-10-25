import { describe, it, expect, afterEach, spyOn } from "bun:test";
import { CopilotOrchestrator, type IOrchestratorChatClient } from "../../src/agent/orchestrator";
import { SubstrateUploader } from "../../src/transport/substrate-uploader";
import type { ToolBridgeResult } from "../../src/protocol/tool-bridge";

describe("Aggressive Cloud Attachment Policy & Lossless Attachment Pipeline", () => {
  let uploadSpy: any = null;

  afterEach(() => {
    if (uploadSpy) {
      uploadSpy.mockRestore();
      uploadSpy = null;
    }
  });

  it("should default cloud attachment thresholds to 12000 chars / 200 lines (optimized anti-blindness)", () => {
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      enableWorkspaceCatalog: false,
    });
    const thresholds = orchestrator.getCloudAttachmentThresholds();

    expect(thresholds.chars).toBe(12000);
    expect(thresholds.lines).toBe(200);
  });

  describe("Aggressive Upload Execution Checks", () => {
    it("1. should upload non-empty tool output directly to OneDrive and attach annotation", async () => {
      const codeLines = Array.from(
        { length: 50 },
        (_, i) => `function sample_${i}() { return ${i}; }`
      ).join("\n");

      uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockResolvedValue({
        driveItemId: "item-50-lines",
        webUrl: "https://example.com/item-50.txt",
        fileName: "tool-result-read_file-50.txt",
        driveId: "b!drive123",
        annotation: {
          id: "item-50-lines",
          messageAnnotationType: "File",
          messageAnnotationMetadata: {
            "@type": "File",
            annotationType: "File",
            fileName: "tool-result-read_file-50.txt",
            webUrl: "https://example.com/item-50.txt",
            driveId: "b!drive123",
            fileType: "txt",
          },
        },
      });

      const mockBridge: any = {
        executeAction: async () => {
          return {
            actionName: "read_file",
            piToolName: "read",
            target: "src/sample.ts",
            success: true,
            output: codeLines,
            rawOutput: codeLines,
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
              text: '```action\ntool: read_file\npath: src/sample.ts\n```',
            };
          }

          return {
            text: 'FINAL_ANSWER: Successfully received and analyzed attachment.',
          };
        },
      };

      let onAttachmentUploadedCalled = false;
      let uploadedAttachmentData: any = null;

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: process.cwd(),
        enableWorkspaceCatalog: false,
        bridge: mockBridge,
        chatClient: mockClient,
        customAgentId: "T_test_agent",
        graphTokenProvider: async () => "mock-graph-token",
        cloudAttachmentThresholdChars: 0,
        cloudAttachmentThresholdLines: 0,
      });

      const runResult = await orchestrator.run({
        task: "Read src/sample.ts",
        events: {
          onAttachmentUploaded: (attachment, toolName) => {
            onAttachmentUploadedCalled = true;
            uploadedAttachmentData = { attachment, toolName };
          },
        },
      });

      expect(runResult.completed).toBe(true);

      // Verify upload was triggered with full raw content
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const [tokenArg, contentArg] = uploadSpy.mock.calls[0];
      expect(tokenArg).toBe("mock-graph-token");
      expect(contentArg).toBe(codeLines);

      // Verify events.onAttachmentUploaded was triggered
      expect(onAttachmentUploadedCalled).toBe(true);
      expect(uploadedAttachmentData.toolName).toBe("read_file");
      expect(uploadedAttachmentData.attachment.driveItemId).toBe("item-50-lines");

      // Verify Turn 2 contains attachment annotations and attached prompt with head-tail fact fingerprint
      expect(sentMessages.length).toBe(2);
      const turn2Message = sentMessages[1];
      expect(turn2Message.annotations).toBeDefined();
      expect(turn2Message.annotations!.length).toBe(1);
      expect(turn2Message.annotations![0].id).toBe("item-50-lines");

      expect(turn2Message.text).toContain("[TOOL_RESULT for read_file - SUCCESS (ATTACHED)]");
      expect(turn2Message.text).toContain("50 行");
      expect(turn2Message.text).toContain("【物理执行指纹摘要 (Head-Tail Fingerprint)】");
      expect(turn2Message.text).toContain("function sample_0");

      // History retains full original content
      expect(runResult.history[0].toolOutput).toBe(codeLines);
    });

    it("2. should allow overriding custom thresholds if explicitly configured in options", async () => {
      const shortOutput = "clean status";

      const mockBridge: any = {
        executeAction: async () => {
          return {
            actionName: "run_command",
            piToolName: "bash",
            target: "git status",
            success: true,
            output: shortOutput,
            rawOutput: shortOutput,
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
            text: 'FINAL_ANSWER: Done.',
          };
        },
      };

      let uploadedCalled = false;

      // Custom thresholds configured: only upload if > 500 chars or > 20 lines
      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: process.cwd(),
        enableWorkspaceCatalog: false,
        bridge: mockBridge,
        chatClient: mockClient,
        customAgentId: "T_test_agent",
        graphTokenProvider: async () => {
          uploadedCalled = true;
          return "mock-token";
        },
        cloudAttachmentThresholdChars: 500,
        cloudAttachmentThresholdLines: 20,
      });

      const runResult = await orchestrator.run({
        task: "Check git status",
      });

      expect(runResult.completed).toBe(true);
      expect(uploadedCalled).toBe(false);

      // Sent inline because it is below the explicitly set custom thresholds
      const turn2Message = sentMessages[1];
      expect(turn2Message.annotations).toBeUndefined();
      expect(turn2Message.text).toContain("clean status");
    });
  });
});

