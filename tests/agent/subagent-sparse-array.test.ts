import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import type { SubagentTaskReport, SubagentTaskSpec } from "../../src/protocol/tool-bridge.ts";

describe("SubagentRunner Sparse Array & Circuit Breaker Guard (CR-1)", () => {
  it("should format report summary safely even when reports array contains undefined holes", () => {
    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "test_main_session",
    });

    // Simulating a sparse reports array with holes caused by circuit breaker / early return
    const sparseReports: any[] = new Array(3);
    sparseReports[0] = {
      id: "sub-1",
      role: "researcher",
      description: "Task 1 completed",
      success: true,
      finalAnswer: "All good",
      turnsCount: 5,
      durationMs: 1200,
    };
    // index 1 and 2 are empty/undefined holes

    expect(() => {
      const summary = runner.formatReportSummary(sparseReports);
      expect(typeof summary).toBe("string");
      expect(summary).toContain("Task 1 completed");
    }).not.toThrow();
  });

  it("should not crash when reports has undefined elements or failed tasks", () => {
    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "test_main_session",
    });

    const reportsWithUndefined: any[] = [
      {
        id: "sub-1",
        role: "coder",
        description: "Task 1",
        success: false,
        finalAnswer: "Failed reason",
        turnsCount: 1,
        durationMs: 500,
        error: "STAGE_CIRCUIT_BREAKER",
      },
      undefined,
    ];

    expect(() => {
      const summary = runner.formatReportSummary(reportsWithUndefined);
      expect(summary).toContain("Task 1");
    }).not.toThrow();
  });
});

