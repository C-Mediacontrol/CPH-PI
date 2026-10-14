import { describe, it, expect } from "bun:test";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("SubagentRunner Capacity Calculation - Zero Available Accounts (CR-2)", () => {
  it("should not evaluate effectiveCapacity to full pool size when all accounts are throttled", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;
    const executionOrder: string[] = [];

    // Pool status where all accounts are throttled (activeAllowedAccounts.length === 0)
    const mockPool = {
      getPoolStatus: () => [
        { email: "user1@corp.com", isAllowed: true, isThrottled: true },
        { email: "user2@corp.com", isAllowed: true, isThrottled: true },
        { email: "user3@corp.com", isAllowed: true, isThrottled: true },
      ],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_zero_cap_1",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          executionOrder.push(opts.sessionId);
          await new Promise((r) => setTimeout(r, 25));
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
    // When all accounts are throttled, effectiveCapacity must be 1 (degraded serial mode),
    // NEVER jumping up to 3 (the full poolStatus.length) due to `0 || poolStatus.length`!
    expect(maxObservedActive).toBe(1);
    expect(reports.every((r) => r.success)).toBe(true);
  });

  it("should calculate correct capacity when some accounts are available", async () => {
    let activeCount = 0;
    let maxObservedActive = 0;

    const mockPool = {
      getPoolStatus: () => [
        { email: "user1@corp.com", isAllowed: true, isThrottled: false },
        { email: "user2@corp.com", isAllowed: true, isThrottled: false },
        { email: "user3@corp.com", isAllowed: true, isThrottled: true }, // throttled
      ],
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main_partial_cap",
      pool: mockPool as any,
      createOrchestratorFn: (opts: any) => ({
        run: async () => {
          activeCount++;
          if (activeCount > maxObservedActive) {
            maxObservedActive = activeCount;
          }
          await new Promise((r) => setTimeout(r, 30));
          activeCount--;
          return { completed: true, finalAnswer: "Done: " + opts.sessionId };
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
    // Exactly 2 active allowed accounts -> max concurrency should be 2
    expect(maxObservedActive).toBe(2);
    expect(reports.every((r) => r.success)).toBe(true);
  });
});
