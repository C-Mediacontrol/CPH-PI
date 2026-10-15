import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FilePorter } from "../../src/transport/file-porter.ts";

describe("FilePorter Unit Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-file-porter-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should detect runtimes correctly based on file extensions", () => {
    const porter = new FilePorter({ cwd: tempDir });

    expect(porter.detectRuntime("test.py")).toBe("python");
    expect(porter.detectRuntime("test.js")).toBe("node");
    expect(porter.detectRuntime("test.ts")).toBe("bun");
    expect(porter.detectRuntime("test.ps1")).toBe("powershell");
    expect(porter.detectRuntime("test.sh")).toBe("bash");
    expect(porter.detectRuntime("test.md")).toBeUndefined();
    expect(porter.detectRuntime("test.json")).toBeUndefined();
  });

  it("should resolve scratch destination within .cph/scratch", () => {
    const porter = new FilePorter({ cwd: tempDir });
    const dest = porter.resolveDestination("test_script.py");

    expect(dest).toBe(path.join(tempDir, ".cph", "scratch", "test_script.py"));
    expect(fs.existsSync(path.dirname(dest))).toBe(true);
  });

  it("should save content directly and execute python script if python is available", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const scriptContent = `
print("Hello from File Porter!")
`;
    const result = await porter.saveAndExecute({
      fileName: "hello.py",
      content: scriptContent,
      autoExecute: true,
    });

    expect(result.downloaded).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.stdout).toContain("Hello from File Porter!");
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (hello.py) - SUCCESS】");
  });

  it("should save non-executable file without executing", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const docContent = `# Architecture Spec\nSome details...`;

    const result = await porter.saveAndExecute({
      fileName: "spec.md",
      content: docContent,
      autoExecute: false,
    });

    expect(result.downloaded).toBe(true);
    expect(result.executed).toBe(false);
    expect(fs.readFileSync(result.filePath, "utf-8")).toBe(docContent);
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (spec.md) - SUCCESS】");
  });

  it("should capture execution errors without throwing unhandled exceptions", async () => {
    const porter = new FilePorter({ cwd: tempDir });
    const badScript = `raise ValueError("Intentional script failure")`;

    const result = await porter.saveAndExecute({
      fileName: "fail.py",
      content: badScript,
      autoExecute: true,
    });

    expect(result.downloaded).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ValueError: Intentional script failure");
    expect(result.formattedOutput).toContain("【TOOL_RESULT: file_porter (fail.py) - FAILED】");
  });
});

