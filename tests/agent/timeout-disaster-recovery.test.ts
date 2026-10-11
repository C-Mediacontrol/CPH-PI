import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import fs from "fs";
import {
  CopilotOrchestrator,
  Orchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";

describe("Orchestrator Timeout & Disaster Recovery (TDD)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-timeout-recovery-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("isRecoverableTransportError", () => {
    it("should classify timeout, network drop, and rate limit errors as recoverable transport errors", () => {
      const orchestrator = new CopilotOrchestrator({ workspaceRoot: tempDir });

      // Timeout variants
      expect(
        orchestrator.isRecoverableTransportError(
          new Error("ChatHub request timed out after 120s without completion")
        )
      ).toBe(true);
      expect(
        orchestrator.isRecoverableTransportError(
          new Error("ChatHub connection idle timeout: no data received")
        )
      ).toBe(true);

      // Network drop variants
      expect(
        orchestrator.isRecoverableTransportError(new Error("read ECONNRESET"))
      ).toBe(true);
      expect(
        orchestrator.isRecoverableTransportError(new Error("socket hang up"))
      ).toBe(true);
      expect(
        orchestrator.isRecoverableTransportError(new Error("ETIMEDOUT"))
      ).toBe(true);

      // Rate limit variants
      expect(
        orchestrator.isRecoverableTransportError(
          new Error("HTTP 429 Too Many Requests")
        )
      ).toBe(true);
      expect(
        orchestrator.isRecoverableTransportError(
          new Error("Rate limit quota exceeded")
        )
      ).toBe(true);

      // Non-recoverable errors
      expect(
        orchestrator.isRecoverableTransportError(new Error("Generic Syntax Error"))
      ).toBe(false);
      expect(
        orchestrator.isRecoverableTransportError(new SyntaxError("Unexpected token <"))
      ).toBe(false);
      expect(
        orchestrator.isRecoverableTransportError(new Error("File not found: /path/to/file"))
      ).toBe(false);
      expect(orchestrator.isRecoverableTransportError(null)).toBe(false);
      expect(orchestrator.isRecoverableTransportError(undefined)).toBe(false);
    });
  });

  describe("orchestrator.run timeout disaster recovery arbitration", () => {
    it("should trigger disaster recovery arbitration when client.sendMessage throws a timeout error", async () => {
      const mockClient: IOrchestratorChatClient = {
        sendMessage: async () => {
          throw new Error("ChatHub request timed out after 120s without completion");
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        client: mockClient as any,
      });

      const result = await orchestrator.run({
        task: "深度代码审查任务",
      });

      expect(result.completed).toBe(false);
      expect(result.handedOff).toBe(true);
      expect(result.disasterRecovered).toBe(true);
      expect(result.disasterBlackbox).toBeDefined();
      expect(result.disasterBlackbox).toContain("ChatHub request timed out after 120s without completion");
      expect(result.handoffDocPath).toBeDefined();
      expect(fs.existsSync(result.handoffDocPath!)).toBe(true);
    });

    it("should preserve partial reasoning and response text when timeout occurs mid-stream", async () => {
      const mockClient: IOrchestratorChatClient = {
        sendMessage: async (_params, callbacks) => {
          // Stream partial reasoning
          callbacks?.onDelta?.({
            type: "reasoning",
            content: "正在分析项目结构与潜在风险点...",
          });
          // Stream partial response text
          callbacks?.onDelta?.({
            type: "text",
            content: "已审查文件清单如下：\n- src/core.ts: 正常\n- src/agent.ts: ",
          });
          // Timeout occurs mid-stream
          throw new Error("ChatHub connection idle timeout: no data received");
        },
      };

      let disasterBlackboxReceived = "";
      let lastErrorReceived = "";

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        client: mockClient as any,
      });

      const result = await orchestrator.run({
        task: "长任务审查与分析",
        events: {
          onDisasterOccurred: (bb, err) => {
            disasterBlackboxReceived = bb;
            lastErrorReceived = err;
          },
        },
      });

      expect(result.completed).toBe(false);
      expect(result.handedOff).toBe(true);
      expect(result.disasterRecovered).toBe(true);
      expect(result.disasterBlackbox).toBeDefined();
      expect(result.disasterBlackbox).toContain("ChatHub connection idle timeout");
      expect(disasterBlackboxReceived).toContain("ChatHub connection idle timeout");
      expect(lastErrorReceived).toContain("ChatHub connection idle timeout");

      // Verify partial output is preserved
      expect(result.lastPartialOutput).toBeDefined();
      expect(result.lastPartialOutput?.reasoning).toContain("正在分析项目结构与潜在风险点...");
      expect(result.lastPartialOutput?.response).toContain("已审查文件清单如下：");
    });
  });
});
