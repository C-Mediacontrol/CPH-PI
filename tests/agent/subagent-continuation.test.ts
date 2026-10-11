import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SubagentRunner - Autonomous Continuation Loop", () => {
  it("should transparently continue subagent across hops until completion", async () => {
    let callCount = 0;
    const lineageTracker = new SessionLineageTracker();

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        callCount++;
        if (callCount === 1) {
          // 第一代 Coder-1 在第 29 轮发生交接
          return {
            finalAnswer: "正在交接...",
            turnsCount: 29,
            completed: false,
            handedOff: true,
            handoffDocPath: ".cph/handoffs/handoff-sub1.md",
            history: [],
          };
        }
        // 第二代 Coder-2 成功完成任务
        expect(runOpts.task).toContain("交接文档");
        return {
          finalAnswer: "Hop-2 成功解决所有问题！",
          turnsCount: 5,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_test_sess",
      lineageTracker,
      maxAutonomousHops: 3,
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const reports = await runner.executeBatch([
      { role: "coder", description: "重构网络层", prompt: "重构 chathub" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].finalAnswer).toContain("Hop-2 成功解决所有问题！");
    expect(callCount).toBe(2);
  });

  it("should register predecessor-successor lineage and read handoff doc from disk", async () => {
    const lineageTracker = new SessionLineageTracker();
    const testDir = path.join(process.cwd(), ".cph", "test-handoffs");
    fs.mkdirSync(testDir, { recursive: true });
    const handoffFile = path.join(testDir, "test-handoff-doc.md");
    fs.writeFileSync(
      handoffFile,
      "## 接力第一优先级待办事项\n完成协议转换与单元测试。\n\n## 任务目标\n重构网络层",
      "utf8"
    );

    let hopTasks: string[] = [];
    let orchestratorOptsList: any[] = [];

    try {
      const mockOrchestratorFactory = (opts: any) => {
        orchestratorOptsList.push(opts);
        return {
          run: async (runOpts: any) => {
            hopTasks.push(runOpts.task);
            if (hopTasks.length === 1) {
              return {
                finalAnswer: "等待接力",
                turnsCount: 29,
                completed: false,
                handedOff: true,
                handoffDocPath: handoffFile,
                history: [],
              };
            }
            return {
              finalAnswer: "最终完成交付！",
              turnsCount: 6,
              completed: true,
              history: [],
            };
          },
        };
      };

      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "main_session_lineage_test",
        lineageTracker,
        maxAutonomousHops: 3,
        createOrchestratorFn: mockOrchestratorFactory,
      });

      const reports = await runner.executeBatch([
        { role: "coder", description: "网络层重构", prompt: "重构网络通信协议" },
      ]);

      expect(reports.length).toBe(1);
      expect(reports[0].success).toBe(true);
      expect(reports[0].turnsCount).toBe(35); // 29 + 6
      expect(hopTasks.length).toBe(2);
      expect(hopTasks[0]).toBe("重构网络通信协议");
      expect(hopTasks[1]).toContain("【跨会话自主接力任务】");
      expect(hopTasks[1]).toContain("完成协议转换与单元测试。");

      // 验证技能挂载选项包含 handoff 且不包含 subagent
      expect(orchestratorOptsList[0].skills).toContain("handoff");
      expect(orchestratorOptsList[0].skills).not.toContain("subagent");

      // 验证 lineageTracker 是否正确记录了会话血缘
      const hop1SessionId = orchestratorOptsList[0].sessionId;
      const hop2SessionId = orchestratorOptsList[1].sessionId;
      const hop1Lineage = lineageTracker.getLineage(hop1SessionId);
      expect(hop1Lineage).toBeDefined();
      expect(hop1Lineage?.successorId).toBe(hop2SessionId);
      expect(hop1Lineage?.status).toBe("handed_off");
    } finally {
      if (fs.existsSync(handoffFile)) {
        fs.unlinkSync(handoffFile);
      }
    }
  });

  it("should stop and report status when max autonomous hops is reached without completion", async () => {
    let callCount = 0;
    const mockOrchestratorFactory = () => ({
      run: async () => {
        callCount++;
        return {
          finalAnswer: `Hop-${callCount} 轮数耗尽，继续交接`,
          turnsCount: 30,
          completed: false,
          handedOff: true,
          handoffDocPath: `.cph/handoffs/mock-hop-${callCount}.md`,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_max_hop_test",
      maxAutonomousHops: 2,
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const reports = await runner.executeBatch([
      { role: "researcher", description: "深度调研", prompt: "超长链路调研" },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(false);
    expect(callCount).toBe(2);
    expect(reports[0].turnsCount).toBe(60); // 30 * 2
    expect(reports[0].finalAnswer).toContain("达到最大自主接力代数上限");
  });
});
