import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ToolBridge, type CopilotAction } from "../../src/protocol/tool-bridge.ts";

describe("ToolBridge Unit Tests", () => {
  let tempDir: string;
  let bridge: ToolBridge;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tool-bridge-test-"));
    bridge = new ToolBridge(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. Action Alias Mapping Logic", () => {
    it("should map read_file, read, and cat to Pi read tool", () => {
      const a1 = bridge.mapAction({ tool: "read_file", path: "src/index.ts" });
      const a2 = bridge.mapAction({ tool: "read", path: "src/index.ts" });
      const a3 = bridge.mapAction({ tool: "cat", path: "src/index.ts" });
      const a4 = bridge.mapAction({ tool: "READ_FILE", path: "src/index.ts" });

      expect(a1.canonicalTool).toBe("read");
      expect(a2.canonicalTool).toBe("read");
      expect(a3.canonicalTool).toBe("read");
      expect(a4.canonicalTool).toBe("read");
    });

    it("should map patch_file, edit, and edit_file to Pi edit tool", () => {
      const a1 = bridge.mapAction({
        tool: "patch_file",
        path: "src/index.ts",
        old_string: "foo",
        new_string: "bar",
      });
      const a2 = bridge.mapAction({
        tool: "edit",
        path: "src/index.ts",
        old_string: "foo",
        new_string: "bar",
      });
      const a3 = bridge.mapAction({
        tool: "edit_file",
        path: "src/index.ts",
        old_string: "foo",
        new_string: "bar",
      });
      const a4 = bridge.mapAction({
        tool: "PATCH_FILE",
        path: "src/index.ts",
        old_string: "foo",
        new_string: "bar",
      });

      expect(a1.canonicalTool).toBe("edit");
      expect(a2.canonicalTool).toBe("edit");
      expect(a3.canonicalTool).toBe("edit");
      expect(a4.canonicalTool).toBe("edit");
    });

    it("should map write_file and write to Pi write tool", () => {
      const a1 = bridge.mapAction({ tool: "write_file", path: "foo.txt", content: "data" });
      const a2 = bridge.mapAction({ tool: "write", path: "foo.txt", content: "data" });
      const a3 = bridge.mapAction({ tool: "WRITE", path: "foo.txt", content: "data" });

      expect(a1.canonicalTool).toBe("write");
      expect(a2.canonicalTool).toBe("write");
      expect(a3.canonicalTool).toBe("write");
    });

    it("should map run_command, bash, and exec to Pi bash tool", () => {
      const a1 = bridge.mapAction({ tool: "run_command", command: "echo 1" });
      const a2 = bridge.mapAction({ tool: "bash", command: "echo 1" });
      const a3 = bridge.mapAction({ tool: "exec", command: "echo 1" });
      const a4 = bridge.mapAction({ tool: "RUN_COMMAND", command: "echo 1" });

      expect(a1.canonicalTool).toBe("bash");
      expect(a2.canonicalTool).toBe("bash");
      expect(a3.canonicalTool).toBe("bash");
      expect(a4.canonicalTool).toBe("bash");
    });

    it("should map ask_question and question to question action", () => {
      const a1 = bridge.mapAction({ tool: "ask_question", question: "Continue?" });
      const a2 = bridge.mapAction({ tool: "question", question: "Continue?" });
      const a3 = bridge.mapAction({ tool: "ASK_QUESTION", question: "Continue?" });

      expect(a1.canonicalTool).toBe("question");
      expect(a2.canonicalTool).toBe("question");
      expect(a3.canonicalTool).toBe("question");
    });

    it("should throw for unsupported tools", () => {
      expect(() => {
        bridge.mapAction({ tool: "unknown_magic_tool" });
      }).toThrow(/Unsupported Copilot action/);
    });

    it("should support action or name fields as alternative to tool", () => {
      const a1 = bridge.mapAction({ action: "read_file", path: "a.ts" });
      const a2 = bridge.mapAction({ name: "bash", command: "ls" });

      expect(a1.canonicalTool).toBe("read");
      expect(a2.canonicalTool).toBe("bash");
    });
  });

  describe("2. 100-Line Slice Protection Assertions", () => {
    it("should default to 100 lines when no end_line or limit is specified", () => {
      const mapped = bridge.mapAction({ tool: "read_file", path: "large.ts" });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.offset).toBe(1);
      expect(args.limit).toBe(100);
    });

    it("should enforce maximum 100 lines when requestedLines exceeds 100 via end_line", () => {
      const mapped = bridge.mapAction({
        tool: "read_file",
        path: "large.ts",
        start_line: 1,
        end_line: 500,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.offset).toBe(1);
      expect(args.limit).toBe(100);
    });

    it("should preserve requested lines when requestedLines <= 100 via end_line", () => {
      const mapped = bridge.mapAction({
        tool: "read_file",
        path: "small.ts",
        start_line: 10,
        end_line: 35,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.offset).toBe(10);
      expect(args.limit).toBe(26); // 35 - 10 + 1 = 26
    });

    it("should clamp explicit limit parameter to 100 if requested > 100", () => {
      const mapped = bridge.mapAction({
        tool: "read",
        path: "large.ts",
        limit: 250,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.limit).toBe(100);
    });

    it("should preserve explicit limit if <= 100", () => {
      const mapped = bridge.mapAction({
        tool: "read",
        path: "large.ts",
        limit: 42,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.limit).toBe(42);
    });

    it("should handle offset correctly with start_line", () => {
      const mapped = bridge.mapAction({
        tool: "cat",
        path: "mid.ts",
        start_line: 150,
        end_line: 300,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.offset).toBe(150);
      expect(args.limit).toBe(100); // 300 - 150 + 1 = 151 -> clamped to 100
    });

    it("should safely handle inverted end_line < start_line", () => {
      const mapped = bridge.mapAction({
        tool: "read",
        path: "safe.ts",
        start_line: 50,
        end_line: 40,
      });
      const args = mapped.args as { path: string; offset: number; limit: number };

      expect(args.offset).toBe(50);
      expect(args.limit).toBe(1);
    });
  });

  describe("3. Partial Edit & Parameter Normalization Assertions", () => {
    it("should normalize old_string and new_string to edits array", () => {
      const mapped = bridge.mapAction({
        tool: "patch_file",
        path: "src/foo.ts",
        old_string: "const x = 1;",
        new_string: "const x = 2;",
      });
      const args = mapped.args as { path: string; edits: Array<{ oldText: string; newText: string }> };

      expect(args.path).toBe("src/foo.ts");
      expect(args.edits).toEqual([{ oldText: "const x = 1;", newText: "const x = 2;" }]);
    });

    it("should normalize filePath and camelCase oldText/newText", () => {
      const mapped = bridge.mapAction({
        tool: "edit",
        filePath: "src/bar.ts",
        oldText: "foo()",
        newText: "bar()",
      });
      const args = mapped.args as { path: string; edits: Array<{ oldText: string; newText: string }> };

      expect(args.path).toBe("src/bar.ts");
      expect(args.edits).toEqual([{ oldText: "foo()", newText: "bar()" }]);
    });

    it("should normalize pre-existing edits array containing old_string/new_string", () => {
      const mapped = bridge.mapAction({
        tool: "edit_file",
        path: "src/baz.ts",
        edits: [
          { old_string: "one", new_string: "1" },
          { oldText: "two", newText: "2" },
        ],
      });
      const args = mapped.args as { path: string; edits: Array<{ oldText: string; newText: string }> };

      expect(args.path).toBe("src/baz.ts");
      expect(args.edits).toEqual([
        { oldText: "one", newText: "1" },
        { oldText: "two", newText: "2" },
      ]);
    });

    it("should normalize write parameters", () => {
      const mapped = bridge.mapAction({
        tool: "write_file",
        filePath: "new.ts",
        content: "export const x = 1;",
      });
      const args = mapped.args as { path: string; content: string };

      expect(args.path).toBe("new.ts");
      expect(args.content).toBe("export const x = 1;");
    });

    it("should normalize bash parameters with default 30s timeout", () => {
      const mapped1 = bridge.mapAction({
        tool: "run_command",
        command: "npm test",
      });
      const args1 = mapped1.args as { command: string; timeout: number };
      expect(args1.command).toBe("npm test");
      expect(args1.timeout).toBe(30);

      const mapped2 = bridge.mapAction({
        tool: "bash",
        cmd: "cargo build",
        timeout: 60,
      });
      const args2 = mapped2.args as { command: string; timeout: number };
      expect(args2.command).toBe("cargo build");
      expect(args2.timeout).toBe(60);
    });

    it("should normalize question parameters", () => {
      const mapped = bridge.mapAction({
        tool: "ask_question",
        prompt: "Choose an option:",
        options: ["A", "B"],
      });
      const args = mapped.args as { question: string; options?: string[] };
      expect(args.question).toBe("Choose an option:");
      expect(args.options).toEqual(["A", "B"]);
    });
  });

  describe("4. Real Pi Tool Execution on Temp Files", () => {
    it("should execute Pi native read tool on a real file with 100-line slice truncation", async () => {
      // Create a 150-line file
      const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\n");
      const testFile = "sample.txt";
      await writeFile(join(tempDir, testFile), lines, "utf-8");

      // Read without limit -> should get max 100 lines + continuation hint
      const result = await bridge.executeAction({
        tool: "read_file",
        path: testFile,
      });

      expect(result.success).toBe(true);
      expect(result.piToolName).toBe("read");
      expect(result.target).toBe(testFile);
      expect(result.output).toContain("line 1");
      expect(result.output).toContain("line 100");
      // Pi read appends continuation message when more lines exist
      expect(result.output).toContain("more lines in file");
      expect(result.formatted).toContain("【TOOL_RESULT: read_file (sample.txt) - SUCCESS】");
      expect(result.formatted).toContain("【END_TOOL_RESULT】");
    });

    it("should execute Pi native read tool with custom slice", async () => {
      const lines = ["aaa", "bbb", "ccc", "ddd", "eee"].join("\n");
      const testFile = "five.txt";
      await writeFile(join(tempDir, testFile), lines, "utf-8");

      const result = await bridge.executeAction({
        tool: "read",
        path: testFile,
        start_line: 2,
        end_line: 4,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("bbb");
      expect(result.output).toContain("ddd");
      expect(result.output).not.toContain("aaa\n");
    });

    it("should execute Pi native edit tool with unique replacement and diff generation", async () => {
      const initialContent = "function hello() {\n  return 'hello world';\n}\n";
      const testFile = "code.ts";
      await writeFile(join(tempDir, testFile), initialContent, "utf-8");

      const result = await bridge.executeAction({
        tool: "patch_file",
        path: testFile,
        old_string: "return 'hello world';",
        new_string: "return 'hello copilot';",
      });

      expect(result.success).toBe(true);
      expect(result.piToolName).toBe("edit");
      expect(result.formatted).toContain("【TOOL_RESULT: patch_file (code.ts) - SUCCESS】");

      // Verify file was actually modified on disk
      const updatedContent = await readFile(join(tempDir, testFile), "utf-8");
      expect(updatedContent).toContain("return 'hello copilot';");
      expect(updatedContent).not.toContain("return 'hello world';");
    });

    it("should fail Pi native edit tool when oldText is non-unique", async () => {
      const duplicateContent = "duplicate line\nduplicate line\n";
      const testFile = "dup.txt";
      await writeFile(join(tempDir, testFile), duplicateContent, "utf-8");

      const result = await bridge.executeAction({
        tool: "edit",
        path: testFile,
        old_string: "duplicate line",
        new_string: "unique line",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("Found 2 occurrences");
      expect(result.formatted).toContain("【TOOL_RESULT: edit (dup.txt) - FAILED】");
    });

    it("should fail Pi native edit tool when oldText is not found", async () => {
      const content = "first line\n";
      const testFile = "notfound.txt";
      await writeFile(join(tempDir, testFile), content, "utf-8");

      const result = await bridge.executeAction({
        tool: "edit",
        path: testFile,
        old_string: "missing text",
        new_string: "replaced text",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("Could not find the exact text");
      expect(result.formatted).toContain("【TOOL_RESULT: edit (notfound.txt) - FAILED】");
    });

    it("should execute Pi native write tool to create new files", async () => {
      const testFile = "subdir/created.txt";
      const result = await bridge.executeAction({
        tool: "write_file",
        path: testFile,
        content: "brand new content",
      });

      expect(result.success).toBe(true);
      expect(result.formatted).toContain("【TOOL_RESULT: write_file (subdir/created.txt) - SUCCESS】");

      const fileContent = await readFile(join(tempDir, testFile), "utf-8");
      expect(fileContent).toBe("brand new content");
    });

    it("should execute Pi native bash tool and capture stdout/failure", async () => {
      const okResult = await bridge.executeAction({
        tool: "run_command",
        command: "node -e \"console.log('pi_bash_ok')\"",
      });

      expect(okResult.success).toBe(true);
      expect(okResult.output).toContain("pi_bash_ok");
      expect(okResult.formatted).toContain("【TOOL_RESULT: run_command");
      expect(okResult.formatted).toContain("- SUCCESS】");

      const failResult = await bridge.executeAction({
        tool: "bash",
        command: "node -e \"process.exit(1)\"",
      });

      expect(failResult.success).toBe(false);
      expect(failResult.formatted).toContain("- FAILED】");
    });

    it("should handle question action with interactive handler", async () => {
      let calledWith: any = null;
      const interactiveBridge = new ToolBridge({
        cwd: tempDir,
        onQuestion: async (q) => {
          calledWith = q;
          return "User picked Option A";
        },
      });

      const result = await interactiveBridge.executeAction({
        tool: "ask_question",
        question: "Select approach:",
        options: ["Option A", "Option B"],
      });

      expect(result.success).toBe(true);
      expect(calledWith).toEqual({ question: "Select approach:", options: ["Option A", "Option B"] });
      expect(result.output).toBe("User picked Option A");
      expect(result.formatted).toContain("【TOOL_RESULT: ask_question (Select approach:) - SUCCESS】");
    });
  });

  describe("5. Formatting Output Boundary Assertions", () => {
    it("should match exact format 【TOOL_RESULT: <toolName> (<target>) - SUCCESS/FAILED】\\n<output>\\n【END_TOOL_RESULT】", () => {
      const formattedSuccess = bridge.formatResult({
        toolName: "read_file",
        target: "src/main.ts",
        success: true,
        output: "line 1\nline 2",
      });

      expect(formattedSuccess).toBe(
        "【TOOL_RESULT: read_file (src/main.ts) - SUCCESS】\nline 1\nline 2\n【END_TOOL_RESULT】"
      );

      const formattedFailure = bridge.formatResult({
        toolName: "patch_file",
        target: "src/main.ts",
        success: false,
        output: "Error: Uniqueness violation",
      });

      expect(formattedFailure).toBe(
        "【TOOL_RESULT: patch_file (src/main.ts) - FAILED】\nError: Uniqueness violation\n【END_TOOL_RESULT】"
      );
    });

    it("should handle empty output and multiline text cleanly", () => {
      const formattedEmpty = bridge.formatResult({
        toolName: "bash",
        target: "true",
        success: true,
        output: "",
      });

      expect(formattedEmpty).toBe("【TOOL_RESULT: bash (true) - SUCCESS】\n\n【END_TOOL_RESULT】");
    });
  });

  describe("6. Ledger Provenance Context Propagation", () => {
    it("should record custom role and sessionId when context is provided", () => {
      const recordedSteps: any[] = [];
      const mockLedger = {
        recordStep: (step: any) => recordedSteps.push(step),
      };

      const customBridge = new ToolBridge({
        cwd: tempDir,
        ledger: mockLedger,
      });

      customBridge.recordToLedger(
        "run_command",
        "bun test",
        "bash",
        true,
        "1 pass",
        { role: "coder", sessionId: "subagent-101" }
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].role).toBe("coder");
      expect(recordedSteps[0].sessionId).toBe("subagent-101");
      expect(recordedSteps[0].tool).toBe("run_command");
    });

    it("should fallback to 'main' when context is omitted", () => {
      const recordedSteps: any[] = [];
      const mockLedger = {
        recordStep: (step: any) => recordedSteps.push(step),
      };

      const defaultBridge = new ToolBridge({
        cwd: tempDir,
        ledger: mockLedger,
      });

      defaultBridge.recordToLedger(
        "write_file",
        "src/app.ts",
        "write",
        true,
        "written"
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].role).toBe("main");
      expect(recordedSteps[0].sessionId).toBe("main");
    });
  });
});
