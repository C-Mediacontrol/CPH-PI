import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ToolBridge,
  persistLargeOutputIfNeeded,
  MAX_INLINE_OUTPUT_CHARS,
  MAX_INLINE_OUTPUT_LINES,
  PREVIEW_HEAD_LINES,
  PREVIEW_TAIL_LINES,
  type ToolBridgeResult,
} from "../../src/protocol/tool-bridge.ts";

describe("Tool Large Output Persistence & Snapshot Bypass Unit Tests", () => {
  let tempDir: string;
  let bridge: ToolBridge;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "large-output-test-"));
    bridge = new ToolBridge(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. Threshold Boundaries & Short Output Preservation", () => {
    it("should export required constants with defined threshold values", () => {
      expect(MAX_INLINE_OUTPUT_CHARS).toBe(3000);
      expect(MAX_INLINE_OUTPUT_LINES).toBe(50);
      expect(PREVIEW_HEAD_LINES).toBe(20);
      expect(PREVIEW_TAIL_LINES).toBe(20);
    });

    it("should retain short output (< 3000 chars and <= 50 lines) without creating files", () => {
      const shortOutput = "Line 1: ok\nLine 2: done\nLine 3: success";
      const result = persistLargeOutputIfNeeded(shortOutput, tempDir, "test_tool");

      expect(result.displayOutput).toBe(shortOutput);
      expect(result.persistedFile).toBeUndefined();

      const artifactsDir = join(tempDir, ".cph", "artifacts");
      expect(existsSync(artifactsDir)).toBe(false);
    });

    it("should retain boundary output exactly at 3000 chars and 50 lines without persistence", () => {
      // 50 lines, total length exactly 3000 chars
      const lineLen = 59; // 59 chars + '\n' = 60 chars per line * 50 = 3000 chars
      const lines = Array.from({ length: 50 }, (_, i) =>
        `Line ${String(i + 1).padStart(2, "0")}: ${"x".repeat(lineLen - 9)}`
      );
      const exactBoundaryOutput = lines.join("\n");
      expect(exactBoundaryOutput.length).toBeLessThanOrEqual(3000);
      expect(exactBoundaryOutput.split("\n").length).toBe(50);

      const result = persistLargeOutputIfNeeded(exactBoundaryOutput, tempDir, "boundary_tool");
      expect(result.displayOutput).toBe(exactBoundaryOutput);
      expect(result.persistedFile).toBeUndefined();
    });
  });

  describe("2. Large Output Persistence (> 3000 chars or > 50 lines)", () => {
    it("should persist output exceeding 50 lines and return head/tail 20 lines preview", async () => {
      // 60 lines
      const originalLines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: detailed log entry`);
      const fullOutput = originalLines.join("\n");

      const result = persistLargeOutputIfNeeded(fullOutput, tempDir, "bash");

      expect(result.persistedFile).toBeDefined();
      expect(result.persistedFile).toMatch(/^\.cph\/artifacts\/tool-output-\d+-[a-f0-9]+\.log$/);

      // Verify file exists on disk and has 100% identical content
      const fullPath = join(tempDir, result.persistedFile!);
      expect(existsSync(fullPath)).toBe(true);
      const diskContent = await readFile(fullPath, "utf-8");
      expect(diskContent).toBe(fullOutput);

      // Verify head 20 lines and tail 20 lines preview in displayOutput
      const previewLines = result.displayOutput.split("\n");
      expect(result.displayOutput).toContain("Line 1: detailed log entry");
      expect(result.displayOutput).toContain("Line 20: detailed log entry");
      expect(result.displayOutput).toContain("Line 41: detailed log entry");
      expect(result.displayOutput).toContain("Line 60: detailed log entry");

      // Verify middle lines (21..40) are omitted from preview
      expect(result.displayOutput).not.toContain("Line 30: detailed log entry");

      // Verify truncation notice details
      expect(result.displayOutput).toContain(result.persistedFile!);
      expect(result.displayOutput).toContain("60 行");
      expect(result.displayOutput).toContain("本地审计归档");
      expect(result.displayOutput).not.toContain("请调用 tool: read_file");
    });

    it("should persist output exceeding 3000 characters (even if <= 50 lines)", async () => {
      // 10 lines, but 400 chars each = 4000 chars
      const longLines = Array.from({ length: 10 }, (_, i) =>
        `Line ${i + 1}: ${"ABCDEFGHIJ".repeat(40)}`
      );
      const fullOutput = longLines.join("\n");
      expect(fullOutput.length).toBeGreaterThan(3000);
      expect(longLines.length).toBeLessThanOrEqual(50);

      const result = persistLargeOutputIfNeeded(fullOutput, tempDir, "test_chars");

      expect(result.persistedFile).toBeDefined();
      const fullPath = join(tempDir, result.persistedFile!);
      const diskContent = await readFile(fullPath, "utf-8");
      expect(diskContent).toBe(fullOutput);

      expect(result.displayOutput).toContain(result.persistedFile!);
      expect(result.displayOutput).toContain("本地审计归档");
      expect(result.displayOutput).not.toContain("请调用 tool: read_file");
      expect(result.displayOutput).toContain(`${fullOutput.length} 字符`);
    });

    it("should allow Pi native read_file tool to read the persisted artifact file", async () => {
      // 80 lines of output
      const originalLines = Array.from({ length: 80 }, (_, i) => `Step ${i + 1}: audit pass`);
      const fullOutput = originalLines.join("\n");

      const persistRes = persistLargeOutputIfNeeded(fullOutput, tempDir, "audit");
      expect(persistRes.persistedFile).toBeDefined();

      // Execute Pi read_file via ToolBridge with relative path pointing to artifact
      const readResult = await bridge.executeAction({
        tool: "read_file",
        path: persistRes.persistedFile!,
        offset: 1,
        limit: 50,
      });

      expect(readResult.success).toBe(true);
      expect(readResult.output).toContain("Step 1: audit pass");
      expect(readResult.output).toContain("Step 50: audit pass");
    });
  });

  describe("3. ToolBridge.executeAction Integration & formatResult", () => {
    it("should integrate large output persistence seamlessly in executeAction for bash commands", async () => {
      // Execute command producing 70 lines
      const cmd = `node -e "for(let i=1;i<=70;i++) console.log('BashRow ' + i)"`;
      const result = await bridge.executeAction({
        tool: "run_command",
        command: cmd,
      });

      expect(result.success).toBe(true);
      expect(result.persistedFile).toBeDefined();
      expect(result.persistedFile).toMatch(/^\.cph\/artifacts\/tool-output-\d+-[a-f0-9]+\.log$/);

      // Verify full output was persisted
      const diskContent = await readFile(join(tempDir, result.persistedFile!), "utf-8");
      expect(diskContent).toContain("BashRow 1");
      expect(diskContent).toContain("BashRow 35");
      expect(diskContent).toContain("BashRow 70");

      // Verify returned result.output contains preview and relative file guidance
      expect(result.output).toContain("BashRow 1");
      expect(result.output).toContain("BashRow 20");
      expect(result.output).toContain("BashRow 70");
      expect(result.output).not.toContain("BashRow 35");
      expect(result.output).toContain(result.persistedFile!);
      expect(result.output).toContain("本地审计归档");
      expect(result.output).not.toContain("请调用 tool: read_file");

      // Verify formatResult wraps formatted model context with preview and file guidance
      expect(result.formatted).toContain("【TOOL_RESULT: run_command");
      expect(result.formatted).toContain(result.persistedFile!);
      expect(result.formatted).toContain("【END_TOOL_RESULT】");
    });

    it("should protect against oversized diffs in edit / patch_file action", async () => {
      // Create initial file with 80 lines
      const initialLines = Array.from({ length: 80 }, (_, i) => `const val_${i + 1} = ${i + 1};`);
      const testFile = "large-code.ts";
      await writeFile(join(tempDir, testFile), initialLines.join("\n"), "utf-8");

      // Edit 50 lines to produce a huge unified diff exceeding 50 lines
      const oldChunk = Array.from({ length: 50 }, (_, i) => `const val_${i + 1} = ${i + 1};`).join("\n");
      const newChunk = Array.from({ length: 50 }, (_, i) => `const val_${i + 1} = ${(i + 1) * 100};`).join("\n");

      const result = await bridge.executeAction({
        tool: "patch_file",
        path: testFile,
        old_string: oldChunk,
        new_string: newChunk,
      });

      expect(result.success).toBe(true);
      expect(result.persistedFile).toBeDefined();

      // Full diff and status are persisted to disk
      const persistedContent = await readFile(join(tempDir, result.persistedFile!), "utf-8");
      expect(persistedContent).toContain("Diff:\n");
      expect(persistedContent).toContain("const val_50 = 5000;");

      // Returned output for Copilot is trimmed
      expect(result.output).toContain(result.persistedFile!);
      expect(result.output).toContain("本地审计归档");
      expect(result.output).not.toContain("请调用 tool: read_file");

      // Disk target file was correctly modified
      const updatedCode = await readFile(join(tempDir, testFile), "utf-8");
      expect(updatedCode).toContain("const val_1 = 100;");
      expect(updatedCode).toContain("const val_50 = 5000;");
    });
  });

  describe("4. Path Isolation & Workspace Purity", () => {
    it("should write artifacts strictly inside the active workspace and not pollute parent or process.cwd()", async () => {
      const longOutput = Array.from({ length: 65 }, (_, i) => `Data entry #${i + 1}`).join("\n");

      const result = persistLargeOutputIfNeeded(longOutput, tempDir, "isolated_tool");
      expect(result.persistedFile).toBeDefined();

      // Check file only exists inside tempDir
      const inTemp = existsSync(join(tempDir, result.persistedFile!));
      expect(inTemp).toBe(true);

      // Check that host workspace process.cwd() does NOT have this file
      const inCwd = existsSync(join(process.cwd(), result.persistedFile!));
      expect(inCwd).toBe(false);
    });
  });
});
