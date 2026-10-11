import { describe, it, expect } from "bun:test";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SessionLineageTracker - Unidirectional Lineage Chain", () => {
  it("should track session lineage and resolve active head across succession chain", () => {
    const tracker = new SessionLineageTracker();

    // 1. 注册初始主会话 Main_A
    tracker.register({
      sessionId: "main_a",
      role: "main",
      status: "active",
    });
    expect(tracker.resolveActiveHead("main_a")).toBe("main_a");

    // 2. Main_A 发生 429 容灾交接给 Main_D
    tracker.register({
      sessionId: "main_d",
      role: "main",
      status: "active",
      predecessorId: "main_a",
    });
    tracker.linkSuccessor("main_a", "main_d");

    expect(tracker.resolveActiveHead("main_a")).toBe("main_d");
    expect(tracker.resolveActiveHead("main_d")).toBe("main_d");

    // 3. Main_D 再次交接给 Main_E
    tracker.register({
      sessionId: "main_e",
      role: "main",
      status: "active",
      predecessorId: "main_d",
    });
    tracker.linkSuccessor("main_d", "main_e");

    expect(tracker.resolveActiveHead("main_a")).toBe("main_e");
  });

  it("should prevent infinite loops on circular successor links", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({ sessionId: "ses_1", role: "main", status: "handed_off", successorId: "ses_2" });
    tracker.register({ sessionId: "ses_2", role: "main", status: "handed_off", successorId: "ses_1" });

    // 遭遇循环引用时安全熔断，不发生死循环
    const resolved = tracker.resolveActiveHead("ses_1");
    expect(["ses_1", "ses_2"]).toContain(resolved);
  });

  it("should track subagent links to main session", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({ sessionId: "main_1", role: "main", status: "active" });
    tracker.register({ sessionId: "sub_1", role: "coder", status: "active", parentSessionId: "main_1" });

    tracker.linkSubagent("main_1", "sub_1");
    const mainLineage = tracker.getLineage("main_1");
    expect(mainLineage?.subagentSessionIds).toContain("sub_1");
  });
});
