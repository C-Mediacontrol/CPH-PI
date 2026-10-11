import { describe, it, expect } from "bun:test";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("Subagent Deliverable Dynamic Rerouting", () => {
  it("should dynamically resolve active head when main session migrates mid-flight", async () => {
    const lineageTracker = new SessionLineageTracker();
    lineageTracker.register({ sessionId: "main_original", role: "main", status: "active" });

    const timelineEvents: any[] = [];
    const mockLoggerTree: any = {
      logTimelineEvent: (e: any) => timelineEvents.push(e),
      createSubagentLogStream: () => ({ write: () => {}, end: () => {} }),
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_original",
      lineageTracker,
      loggerTree: mockLoggerTree,
      createOrchestratorFn: () => ({
        run: async () => {
          // 模拟子代理异步执行期间，主会话发生 429 容灾交接至 main_successor
          lineageTracker.register({
            sessionId: "main_successor",
            role: "main",
            status: "active",
            predecessorId: "main_original",
          });
          lineageTracker.linkSuccessor("main_original", "main_successor");

          return {
            finalAnswer: "子任务执行完毕",
            completed: true,
            turnsCount: 2,
            history: [],
          };
        },
      }),
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "模块迁移", prompt: "迁移代码" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].targetSessionId).toBe("main_successor");

    // 确认通过追踪器能够精确获取目标主端点为 main_successor
    const activeHead = lineageTracker.resolveActiveHead("main_original");
    expect(activeHead).toBe("main_successor");

    // 确认已记录 SUBAGENT_REROUTED_TO_SUCCESSOR 时间线事件
    const rerouteEvent = timelineEvents.find((e) => e.type === "SUBAGENT_REROUTED_TO_SUCCESSOR");
    expect(rerouteEvent).toBeDefined();
    expect(rerouteEvent.activeMainSessionId).toBe("main_successor");
    expect(rerouteEvent.originalMainSessionId).toBe("main_original");
  });

  it("should register main session in lineage tracker on orchestrator run and link succession", async () => {
    const lineageTracker = new SessionLineageTracker();
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      sessionId: "main_primary_sess",
      lineageTracker,
      customAgentId: "test-agent",
      chatClient: {
        sendMessage: async () => {
          return { text: "FINAL_ANSWER: Done" };
        },
      },
    });

    expect(orchestrator.getLineageTracker()).toBe(lineageTracker);

    await orchestrator.run({
      task: "测试主会话血缘注册",
    });

    const mainLineage = lineageTracker.getLineage("main_primary_sess");
    expect(mainLineage).toBeDefined();
    expect(mainLineage?.role).toBe("main");
    expect(mainLineage?.status).toBe("active");

    // 测试 succession 链接
    orchestrator.linkSuccessor("main_primary_sess", "main_successor_sess");
    expect(lineageTracker.resolveActiveHead("main_primary_sess")).toBe("main_successor_sess");
  });

  it("should link arbitrator successor in lineageTracker when disaster recovery triggers", async () => {
    const lineageTracker = new SessionLineageTracker();
    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: process.cwd(),
      sessionId: "main_victim_sess",
      lineageTracker,
      customAgentId: "test-agent",
      chatClient: {
        sendMessage: async () => {
          const err = new Error("429 Too Many Requests");
          (err as any).statusCode = 429;
          throw err;
        },
      },
      arbitratorChatClient: {
        sendMessage: async () => {
          return { text: "FINAL_ANSWER: Disaster handoff generated" };
        },
      },
    });

    const res = await orchestrator.run({
      task: "容灾测试",
    });

    expect(res.disasterRecovered).toBe(true);
    expect(res.arbitratorSessionId).toBeDefined();
    // 确认 lineageTracker 已将 main_victim_sess 链接至 arbitratorSessionId
    const activeHead = lineageTracker.resolveActiveHead("main_victim_sess");
    expect(activeHead).toBe(res.arbitratorSessionId!);
  });
});
