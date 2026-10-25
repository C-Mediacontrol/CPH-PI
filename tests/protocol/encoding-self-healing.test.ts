import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  ToolBridge,
  smartDecodeBuffer,
  createEncodingSelfHealingBashOperations,
  sanitizeOutput,
} from "../../src/protocol/tool-bridge.ts";
import type { BashOperations } from "../../src/tools/index.ts";

describe("Windows Console Smart Encoding Self-Healing Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "encoding-healing-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. smartDecodeBuffer(buffer: Buffer): string", () => {
    it("should decode pure ASCII string without loss", () => {
      const asciiText = "=== WORKSPACE ROOT ===";
      const buf = Buffer.from(asciiText, "ascii");
      const decoded = smartDecodeBuffer(buf);

      expect(decoded).toBe(asciiText);
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should decode valid UTF-8 Chinese string without loss", () => {
      const utf8Text = "项目初始化完成";
      const buf = Buffer.from(utf8Text, "utf-8");
      const decoded = smartDecodeBuffer(buf);

      expect(decoded).toBe(utf8Text);
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should decode standard Windows CP936/GBK bytes '找不到' without replacement character", () => {
      // 0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd is '找不到' in CP936 / GBK
      const gbkBuf = Buffer.from([0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd]);
      const decoded = smartDecodeBuffer(gbkBuf);

      expect(decoded).toBe("找不到");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should decode PowerShell typical CP936 error '所在位置 行:1 字符: 315' 100% correctly", () => {
      const psErrorGbk = Buffer.from([
        0xcb, 0xf9, 0xd4, 0xda, 0xce, 0xbb, 0xd6, 0xc3, 0x20, 0xd0, 0xd0, 0x3a,
        0x31, 0x20, 0xd7, 0xd6, 0xb7, 0xfb, 0x3a, 0x20, 0x33, 0x31, 0x35,
      ]);
      const decoded = smartDecodeBuffer(psErrorGbk);

      expect(decoded).toBe("所在位置 行:1 字符: 315");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should decode PowerShell typical CP936 error '找不到类型 [System.IO.Path]' 100% correctly", () => {
      const psTypeErrorGbk = Buffer.from([
        0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd, 0xc0, 0xe0, 0xd0, 0xcd, 0x20, 0x5b,
        0x53, 0x79, 0x73, 0x74, 0x65, 0x6d, 0x2e, 0x49, 0x4f, 0x2e, 0x50, 0x61,
        0x74, 0x68, 0x5d,
      ]);
      const decoded = smartDecodeBuffer(psTypeErrorGbk);

      expect(decoded).toBe("找不到类型 [System.IO.Path]");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should decode mixed stream with ASCII header and GBK error content into clean Chinese", () => {
      const header = Buffer.from("=== WORKSPACE ERROR ===\n", "ascii");
      const gbkError = Buffer.from([0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd]);
      const mixed = Buffer.concat([header, gbkError]);
      const decoded = smartDecodeBuffer(mixed);

      expect(decoded).toBe("=== WORKSPACE ERROR ===\n找不到");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should handle empty or null buffer gracefully", () => {
      expect(smartDecodeBuffer(Buffer.alloc(0))).toBe("");
      expect(smartDecodeBuffer(null as any)).toBe("");
      expect(smartDecodeBuffer(undefined as any)).toBe("");
    });
  });

  describe("2. createEncodingSelfHealingBashOperations(options?, baseOps?)", () => {
    it("should intercept GBK bytes from mock baseOps and emit valid UTF-8 Buffer to onData", async () => {
      const mockBaseOps: BashOperations = {
        exec: async (_command, _cwd, { onData }) => {
          // Emit CP936 bytes for "找不到"
          onData(Buffer.from([0xd5, 0xd2, 0xb2, 0xbb, 0xb5, 0xbd]));
          return { exitCode: 0 };
        },
      };

      const healingOps = createEncodingSelfHealingBashOperations(undefined, mockBaseOps);
      const receivedChunks: Buffer[] = [];

      await healingOps.exec("dummy_command", tempDir, {
        onData: (chunk) => receivedChunks.push(chunk),
      });

      expect(receivedChunks.length).toBeGreaterThan(0);
      const combined = Buffer.concat(receivedChunks);
      const decoded = combined.toString("utf-8");

      expect(decoded).toBe("找不到");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should heal split GBK stream across chunk boundaries", async () => {
      const mockSplitOps: BashOperations = {
        exec: async (_command, _cwd, { onData }) => {
          // Split "找不到" (6 bytes) across 2 chunks: 5 bytes + 1 byte
          onData(Buffer.from([0xd5, 0xd2, 0xb2, 0xbb, 0xb5])); // split at 5th byte
          onData(Buffer.from([0xbd])); // 6th byte
          return { exitCode: 0 };
        },
      };

      const healingOps = createEncodingSelfHealingBashOperations(undefined, mockSplitOps);
      const receivedChunks: Buffer[] = [];

      await healingOps.exec("dummy_command", tempDir, {
        onData: (chunk) => receivedChunks.push(chunk),
      });

      const combined = Buffer.concat(receivedChunks);
      const decoded = combined.toString("utf-8");

      expect(decoded).toBe("找不到");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });

    it("should pass through valid UTF-8 stream seamlessly", async () => {
      const mockUtf8Ops: BashOperations = {
        exec: async (_command, _cwd, { onData }) => {
          onData(Buffer.from("项目初始化完成\n", "utf-8"));
          return { exitCode: 0 };
        },
      };

      const healingOps = createEncodingSelfHealingBashOperations(undefined, mockUtf8Ops);
      const receivedChunks: Buffer[] = [];

      await healingOps.exec("dummy_command", tempDir, {
        onData: (chunk) => receivedChunks.push(chunk),
      });

      const combined = Buffer.concat(receivedChunks);
      const decoded = combined.toString("utf-8");

      expect(decoded).toBe("项目初始化完成\n");
      expect(decoded.includes("\uFFFD")).toBe(false);
    });
  });

  describe("3. ToolBridge Integration with Self-Healing Bash Operations", () => {
    it("should automatically integrate self-healing operations when no custom tools are passed", () => {
      const bridge = new ToolBridge(tempDir);
      const bashOps = bridge.getBashOperations();

      expect(bashOps).toBeDefined();
      expect((bashOps as any)?.isEncodingSelfHealing).toBe(true);
    });

    it("should cleanse residual replacement characters from executeAction output", async () => {
      const bridge = new ToolBridge(tempDir);

      // Verify sanitizeOutput removes residual \uFFFD characters
      const dirty = "Command output \uFFFD\uFFFD with diamond question mark";
      const cleaned = sanitizeOutput(dirty);
      expect(cleaned).toBe("Command output  with diamond question mark");
      expect(cleaned.includes("\uFFFD")).toBe(false);

      // Verify executeAction on mock tool returning residual \uFFFD
      const mockTool = {
        name: "bash",
        description: "Mock bash tool",
        parameters: {} as any,
        execute: async () => ({
          content: [{ type: "text", text: "Error: \uFFFD\uFFFD\uFFFD file missing" }],
          isError: true,
        }),
      };

      const bridgeWithMock = new ToolBridge({
        cwd: tempDir,
        tools: [mockTool as any],
      });

      const result = await bridgeWithMock.executeAction({
        tool: "bash",
        command: "ls invalid",
      });

      expect(result.output.includes("\uFFFD")).toBe(false);
      expect(result.output).toBe("Error:  file missing");
    });
  });
});
