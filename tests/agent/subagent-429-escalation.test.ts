import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Subagent 429 Escalation", () => {
  it("should report ALL_ACCOUNTS_THROTTLED when all accounts in pool are exhausted", async () => {
    const mockOrchestratorFactory = () => ({
      run: async () => {
        const err = new Error("All accounts in pool are currently throttled (429)");
        (err as any).code = "ALL_ACCOUNTS_THROTTLED";
        throw err;
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_test",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "高并发测试", prompt: "运行压力测试" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(false);
    expect(reports[0].error).toContain("ALL_ACCOUNTS_THROTTLED");
    expect(reports[0].finalAnswer).toContain("账号池枯竭");
  });
});
