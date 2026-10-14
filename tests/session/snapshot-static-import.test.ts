import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMainPlanSnapshot,
  formatSuccessorTurn1Prompt,
} from "../../src/session/main-plan-snapshot.ts";
import { ExecutionLedger } from "../../src/session/ledger/execution-ledger.ts";

describe("MainPlanSnapshot - Static Import in pure ESM Environment", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-esm-snapshot-" + Date.now());

  it("should mount ledger fingerprints via static import without calling dynamic require", () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Initialize an actual ledger in tmpDir
    const ledger = new ExecutionLedger(tmpDir);
    ledger.recordStep({
      role: "main",
      sessionId: "main-001",
      tool: "write_file",
      target: "src/index.ts",
      status: "SUCCESS",
      briefSummary: "Created entry point",
    });

    const snapshot = createMainPlanSnapshot({
      originalSessionId: "main-001",
      originalTask: "实现微服务架构",
      thought: "规划完毕",
      workspaceRoot: tmpDir,
      plannedSubagents: [],
    });

    // In a pure ESM environment where require might throw or be undefined,
    // formatSuccessorTurn1Prompt must succeed because it uses static import
    const prompt = formatSuccessorTurn1Prompt(snapshot, "子任务完成交付");

    expect(prompt).toContain("【主控接力与成果审阅】");
    expect(prompt).toContain("### 2. 物理执行账本挂载 (Pass-by-Reference)");
    expect(prompt).toContain(".cph/state/execution-ledger.md");
    expect(prompt).toContain("子任务完成交付");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
