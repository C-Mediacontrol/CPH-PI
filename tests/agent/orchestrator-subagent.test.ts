import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Orchestrator - Subagent Dispatch", () => {
  it("should intercept invoke_subagent and feed back structured reports", async () => {
    let subagentExecuted = false;

    const mockSubagentRunner = {
      executeBatch: async (tasks: any[]) => {
        subagentExecuted = true;
        return [
          {
            id: "sub-1",
            role: "researcher",
            description: "探查架构",
            success: true,
            finalAnswer: "发现三处需要重构的模块",
            turnsCount: 2,
            durationMs: 1200,
          },
        ];
      },
      formatReportSummary: (reports: any[]) => "### 🎯 子代理多会话并发执行报告: 发现三处需要重构的模块",
    };

    let turnsSent = 0;
    const mockChatClient = {
      sendMessage: async (params: any) => {
        turnsSent++;
        if (turnsSent === 1) {
          return {
            text: `THOUGHT: 派发调研子代理
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查架构
    prompt: 深入探查模块
\`\`\``,
          };
        }
        expect(params.text).toContain("子代理多会话并发执行报告");
        return {
          text: `FINAL_ANSWER: 根据子代理调研结果，已完成架构评估。`,
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      chatClient: mockChatClient as any,
      subagentRunner: mockSubagentRunner as any,
      customAgentId: "main-agent-id",
    });

    const result = await orchestrator.run({
      task: "评估当前系统架构",
    });

    expect(subagentExecuted).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("已完成架构评估");
  });
});
