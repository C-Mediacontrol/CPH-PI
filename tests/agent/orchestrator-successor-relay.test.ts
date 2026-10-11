import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("Orchestrator - Generational Successor Relay", () => {
  it("should awaken successor main session with fresh turns and Turn 1 injected prompt", async () => {
    let turns = 0;
    const tracker = new SessionLineageTracker();
    let successorFired = false;
    let successorIdSeen = "";

    const mockChatClient = {
      sendMessage: async (params: any) => {
        turns++;
        if (turns === 1) {
          return {
            text: `THOUGHT: 派发编码子任务
\`\`\`action
tool: invoke_subagent
subagents:
  - role: coder
    description: 编写核心模块
    prompt: 编写模块
\`\`\``,
          };
        }
        // Turn 2 is Turn 1 of successor!
        expect(params.text).toContain("【主控接力与成果审阅】");
        expect(params.text).toContain("模块编写完成并通过测试");
        return {
          text: "FINAL_ANSWER: 全部子任务验证通过，系统交付完成。",
        };
      },
    };

    const mockRunner = {
      executeBatch: async () => [
        {
          id: "sub-1",
          role: "coder",
          description: "编写核心模块",
          success: true,
          finalAnswer: "模块编写完成并通过测试",
          turnsCount: 2,
          durationMs: 800,
        },
      ],
      formatReportSummary: () => "### 🎯 子代理多会话并发执行报告: 模块编写完成并通过测试",
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      chatClient: mockChatClient as any,
      subagentRunner: mockRunner as any,
      lineageTracker: tracker,
    });

    const result = await orchestrator.run({
      task: "实现新功能",
      sessionId: "main_root_ses",
      events: {
        onSuccessorAwakened: (newSesId, gen) => {
          successorFired = true;
          successorIdSeen = newSesId;
        },
      },
    });

    expect(successorFired).toBe(true);
    expect(successorIdSeen).toContain("main_root_ses_gen");
    expect(tracker.resolveActiveHead("main_root_ses")).toBe(successorIdSeen);
    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("全部子任务验证通过");
  });
});
