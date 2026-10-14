import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ExecutionLedger } from "../../src/session/ledger/execution-ledger.ts";
import type { LedgerEntry } from "../../src/session/ledger/ledger-entry.ts";

describe("ExecutionLedger Unit Tests", () => {
  let tmpDir: string;
  let ledger: ExecutionLedger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ledger-test-"));
    ledger = new ExecutionLedger(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should record step and persist to jsonl and md correctly", () => {
    const entry = ledger.recordStep({
      role: "main",
      sessionId: "sess_main_001",
      tool: "read_file",
      target: "src/cli.ts",
      status: "SUCCESS",
      briefSummary: "Read 800 lines successfully",
    });

    expect(entry.stepIndex).toBe(1);
    expect(entry.timestamp).toBeGreaterThan(0);

    const { jsonlPath, mdPath } = ledger.getPaths();
    expect(fs.existsSync(jsonlPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const jsonlContent = fs.readFileSync(jsonlPath, "utf8").trim();
    const parsed = JSON.parse(jsonlContent) as LedgerEntry;
    expect(parsed.stepIndex).toBe(1);
    expect(parsed.tool).toBe("read_file");
    expect(parsed.target).toBe("src/cli.ts");
    expect(parsed.status).toBe("SUCCESS");

    const mdContent = fs.readFileSync(mdPath, "utf8");
    expect(mdContent).toContain("# CPH 物理执行账本 (Execution Ledger)");
    expect(mdContent).toContain("| 1 | main | read_file | src/cli.ts | SUCCESS |");
  });

  it("should maintain monotonic step index across multiple steps and roles", () => {
    ledger.recordStep({
      role: "main",
      sessionId: "sess_main_001",
      tool: "invoke_subagent",
      target: "coder (fix pointer)",
      status: "SUCCESS",
      briefSummary: "Dispatched sub-1",
    });

    ledger.recordStep({
      role: "coder",
      sessionId: "sub_1",
      tool: "patch_file",
      target: "src/auth/account-pool.ts",
      status: "SUCCESS",
      modifiedFiles: ["src/auth/account-pool.ts"],
      briefSummary: "Patched token pointer logic",
    });

    ledger.recordStep({
      role: "coder",
      sessionId: "sub_1",
      tool: "run_command",
      target: "bun test",
      status: "SUCCESS",
      statusBadge: "PASS 476/476",
      briefSummary: "All tests green",
    });

    const entries = ledger.getLatestEntries();
    expect(entries.length).toBe(3);
    expect(entries[0].stepIndex).toBe(1);
    expect(entries[1].stepIndex).toBe(2);
    expect(entries[2].stepIndex).toBe(3);
    expect(entries[2].statusBadge).toBe("PASS 476/476");
  });

  it("should generate a compact pass-by-reference mount header within token constraints", () => {
    ledger.recordStep({
      role: "coder",
      sessionId: "sub_1",
      tool: "patch_file",
      target: "src/cli.ts",
      status: "SUCCESS",
      modifiedFiles: ["src/cli.ts"],
      briefSummary: "Patched cli",
    });

    ledger.recordStep({
      role: "coder",
      sessionId: "sub_1",
      tool: "run_command",
      target: "bun test",
      status: "SUCCESS",
      statusBadge: "PASS (476/476)",
      briefSummary: "All green",
    });

    const header = ledger.formatMountHeader();
    expect(header).toContain("【系统物理执行账本已挂载】");
    expect(header).toContain(".cph/state/execution-ledger.md");
    expect(header).toContain("累计物理操作: 2 步");
    expect(header).toContain("src/cli.ts");
    expect(header).toContain("PASS (476/476)");

    // 约束验证：行数 <= 10 行，字符数 <= 500（远小于 150 tokens）
    const lines = header.split("\n");
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(header.length).toBeLessThanOrEqual(500);
  });

  it("should gracefully handle empty ledger when formatting mount header", () => {
    const header = ledger.formatMountHeader();
    expect(header).toContain("【系统物理执行账本已挂载】");
    expect(header).toContain("累计物理操作: 0 步");
  });
});

