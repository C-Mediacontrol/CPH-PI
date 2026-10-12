import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import type { SubagentTaskSpec } from "../../src/protocol/tool-bridge.ts";

describe("SubagentRunner - Stage Barrier & Causality Guard", () => {
  it("should strictly execute tasks by stage order and enforce stage barrier", async () => {
    const executionTimeline: Array<{ task: string; stage?: number; start: number; end: number }> = [];

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        const start = Date.now();
        // 模拟 Stage 1 中 Task A 耗时长，Task B 耗时短
        let delayMs = 10;
        if (runOpts.task.includes("Task A")) {
          delayMs = 60;
        } else if (runOpts.task.includes("Task B")) {
          delayMs = 10;
        } else if (runOpts.task.includes("Task C")) {
          delayMs = 20;
        }
        await new Promise((r) => setTimeout(r, delayMs));
        const end = Date.now();
        executionTimeline.push({
          task: runOpts.task,
          start,
          end,
        });

        return {
          finalAnswer: `Done: ${runOpts.task}`,
          turnsCount: 1,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "stage-barrier-test",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { stage: 1, role: "coder", description: "Task A (长耗时基座)", prompt: "Task A" },
      { stage: 1, role: "coder", description: "Task B (短耗时独立)", prompt: "Task B" },
      { stage: 2, role: "coder", description: "Task C (依赖基座)", prompt: "Task C" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(reports.every((r) => r.success)).toBe(true);

    const taskA = executionTimeline.find((t) => t.task === "Task A")!;
    const taskB = executionTimeline.find((t) => t.task === "Task B")!;
    const taskC = executionTimeline.find((t) => t.task === "Task C")!;

    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();
    expect(taskC).toBeDefined();

    // 核心屏障验证：Task C 的启动时间必须 >= Task A 和 Task B 的完成时间
    expect(taskC.start).toBeGreaterThanOrEqual(taskA.end - 5);
    expect(taskC.start).toBeGreaterThanOrEqual(taskB.end - 5);
  });

  it("should trigger stage circuit breaker and cancel stage 2 when stage 1 fails", async () => {
    let taskCExecuted = false;

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        if (runOpts.task === "Task B (Fail)") {
          return {
            finalAnswer: "Error occurred",
            turnsCount: 1,
            completed: false, // 失败
            history: [],
          };
        }
        if (runOpts.task === "Task C") {
          taskCExecuted = true;
        }
        return {
          finalAnswer: `Success: ${runOpts.task}`,
          turnsCount: 1,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "stage-breaker-test",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { stage: 1, role: "coder", description: "Task A", prompt: "Task A" },
      { stage: 1, role: "coder", description: "Task B (Fail)", prompt: "Task B (Fail)" },
      { stage: 2, role: "coder", description: "Task C", prompt: "Task C" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(reports[0].success).toBe(true);
    expect(reports[1].success).toBe(false);

    // 熔断验证：Task C 未被执行，且状态为取消
    expect(taskCExecuted).toBe(false);
    expect(reports[2].success).toBe(false);
    expect(reports[2].error).toContain("STAGE_CIRCUIT_BREAKER");
  });

  it("should default to stage 1 when stage field is omitted", async () => {
    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => ({
        finalAnswer: `Done: ${runOpts.task}`,
        turnsCount: 1,
        completed: true,
        history: [],
      }),
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "stage-default-test",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "researcher", description: "Default Stage", prompt: "Prompt 1" },
      { role: "coder", description: "Default Stage 2", prompt: "Prompt 2" },
    ];

    const reports = await runner.executeBatch(tasks);
    expect(reports.length).toBe(2);
    expect(reports.every((r) => r.success)).toBe(true);
  });
});
