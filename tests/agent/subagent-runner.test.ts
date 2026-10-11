import { describe, it, expect } from "bun:test";
import { SubagentRunner, type SubagentRunnerOptions } from "../../src/agent/subagent-runner.ts";
import type { SubagentTaskSpec } from "../../src/protocol/tool-bridge.ts";

describe("SubagentRunner", () => {
  it("should execute multiple subagent tasks concurrently and aggregate reports", async () => {
    const executedTasks: Array<{ role: string; customAgentId: string; prompt: string }> = [];

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        executedTasks.push({
          role: opts.subagentRole,
          customAgentId: opts.customAgentId,
          prompt: runOpts.task,
        });
        return {
          finalAnswer: `Subagent [${opts.subagentRole}] 完成交付: ${runOpts.task}`,
          turnsCount: 2,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-session-test",
      coderAgentId: "coder-id-123",
      researcherAgentId: "researcher-id-456",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "researcher", description: "调研接口", prompt: "调研接口: 检查 account-pool 导出" },
      { role: "coder", description: "修复测试", prompt: "修复 auth 模块测试" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(2);
    expect(reports[0].role).toBe("researcher");
    expect(reports[0].success).toBe(true);
    expect(reports[0].finalAnswer).toContain("调研接口");
    expect(reports[1].role).toBe("coder");
    expect(reports[1].success).toBe(true);

    expect(executedTasks.length).toBe(2);
    expect(executedTasks[0].customAgentId).toBe("researcher-id-456");
    expect(executedTasks[1].customAgentId).toBe("coder-id-123");

    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("子代理多会话并发执行报告");
    expect(summary).toContain("researcher");
    expect(summary).toContain("coder");
  });
});
