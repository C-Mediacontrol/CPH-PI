import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("SubagentRunner - Adaptive Account Queue", () => {
  it("should execute subagents serially when account pool has only 1 account", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;
    const executionOrder: string[] = [];

    const mockPool = {
      getPoolStatus: () => [{ email: "test@corp.com", active: true, isThrottled: false }],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_queue_1",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          executionOrder.push(opts.sessionId);
          await new Promise((r) => setTimeout(r, 20));
          activeCount--;
          return { completed: true, finalAnswer: "Task done: " + opts.sessionId };
        },
      }),
    });

    const tasks = [
      { role: "coder" as const, description: "Task 1", prompt: "p1" },
      { role: "coder" as const, description: "Task 2", prompt: "p2" },
      { role: "coder" as const, description: "Task 3", prompt: "p3" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(maxObservedActive).toBe(1); // Enforced strict sequential!
    expect(reports.every((r) => r.success)).toBe(true);
  });

  it("should allow parallel execution when account pool has multiple accounts", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;

    const mockPool = {
      getPoolStatus: () => [
        { email: "user1@corp.com", active: true, isThrottled: false },
        { email: "user2@corp.com", active: true, isThrottled: false },
        { email: "user3@corp.com", active: true, isThrottled: false },
      ],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_queue_2",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          await new Promise((r) => setTimeout(r, 30));
          activeCount--;
          return { completed: true, finalAnswer: "Parallel done" };
        },
      }),
    });

    const tasks = [
      { role: "coder" as const, description: "Task 1", prompt: "p1" },
      { role: "coder" as const, description: "Task 2", prompt: "p2" },
      { role: "coder" as const, description: "Task 3", prompt: "p3" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(3);
    expect(maxObservedActive).toBeGreaterThan(1); // Parallel allowed!
  });

  it("should enforce sliding window concurrency bound equal to active pool capacity", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;

    const mockPool = {
      getPoolStatus: () => [
        { email: "user1@corp.com", active: true, isThrottled: false },
        { email: "user2@corp.com", active: true, isThrottled: false },
      ],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_queue_3",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          await new Promise((r) => setTimeout(r, 25));
          activeCount--;
          return { completed: true, finalAnswer: "Sliding window done" };
        },
      }),
    });

    const tasks = [
      { role: "coder" as const, description: "Task 1", prompt: "p1" },
      { role: "coder" as const, description: "Task 2", prompt: "p2" },
      { role: "coder" as const, description: "Task 3", prompt: "p3" },
      { role: "coder" as const, description: "Task 4", prompt: "p4" },
      { role: "coder" as const, description: "Task 5", prompt: "p5" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(5);
    expect(maxObservedActive).toBe(2); // Strict sliding window bound!
    expect(reports.every((r) => r.success)).toBe(true);
  });
});
