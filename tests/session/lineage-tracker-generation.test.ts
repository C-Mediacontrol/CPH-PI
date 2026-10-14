import { describe, it, expect } from "bun:test";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SessionLineageTracker - Generation and Handoff Count", () => {
  it("should return generation 1 and handoffCount 0 for initial root session", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({
      sessionId: "main-session-root",
      role: "main",
      status: "active",
    });

    const info = tracker.getGenerationInfo("main-session-root");
    expect(info.generation).toBe(1);
    expect(info.handoffCount).toBe(0);
    expect(info.predecessorIds).toEqual([]);
    expect(tracker.getHandoffCount("main-session-root")).toBe(0);
  });

  it("should accurately compute generations and handoff counts along successive handoffs", () => {
    const tracker = new SessionLineageTracker();
    const ses1 = "session-alpha";
    const ses2 = "session-alpha_gen2";
    const ses3 = "session-alpha_gen3";

    tracker.register({ sessionId: ses1, role: "main", status: "active" });
    tracker.register({ sessionId: ses2, role: "main", status: "active", predecessorId: ses1 });
    tracker.linkSuccessor(ses1, ses2);

    tracker.register({ sessionId: ses3, role: "main", status: "active", predecessorId: ses2 });
    tracker.linkSuccessor(ses2, ses3);

    // Gen 1
    const info1 = tracker.getGenerationInfo(ses1);
    expect(info1.generation).toBe(1);
    expect(info1.handoffCount).toBe(0);

    // Gen 2 (Handed off 1 time)
    const info2 = tracker.getGenerationInfo(ses2);
    expect(info2.generation).toBe(2);
    expect(info2.handoffCount).toBe(1);
    expect(info2.predecessorIds).toEqual([ses1]);
    expect(tracker.getHandoffCount(ses2)).toBe(1);

    // Gen 3 (Handed off 2 times)
    const info3 = tracker.getGenerationInfo(ses3);
    expect(info3.generation).toBe(3);
    expect(info3.handoffCount).toBe(2);
    expect(info3.predecessorIds).toEqual([ses2, ses1]);
    expect(tracker.getHandoffCount(ses3)).toBe(2);
  });

  it("should accurately compute subagent autonomous hops and handoffs", () => {
    const tracker = new SessionLineageTracker();
    const main = "main-1";
    const subHop1 = "main-1_sub-1_coder";
    const subHop2 = "main-1_sub-1_coder_hop2";
    const subHop3 = "main-1_sub-1_coder_hop3";

    tracker.register({ sessionId: main, role: "main", status: "active" });
    tracker.register({ sessionId: subHop1, role: "coder", status: "active", parentSessionId: main });
    tracker.linkSubagent(main, subHop1);

    tracker.register({ sessionId: subHop2, role: "coder", status: "active", predecessorId: subHop1, parentSessionId: main });
    tracker.linkSuccessor(subHop1, subHop2);

    tracker.register({ sessionId: subHop3, role: "coder", status: "active", predecessorId: subHop2, parentSessionId: main });
    tracker.linkSuccessor(subHop2, subHop3);

    expect(tracker.getGenerationInfo(subHop1).generation).toBe(1);
    expect(tracker.getHandoffCount(subHop1)).toBe(0);

    expect(tracker.getGenerationInfo(subHop2).generation).toBe(2);
    expect(tracker.getHandoffCount(subHop2)).toBe(1);

    expect(tracker.getGenerationInfo(subHop3).generation).toBe(3);
    expect(tracker.getHandoffCount(subHop3)).toBe(2);
  });

  it("should prevent infinite loop in cyclic references and fallback safely", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({ sessionId: "node-a", role: "main", status: "active", predecessorId: "node-b" });
    tracker.register({ sessionId: "node-b", role: "main", status: "active", predecessorId: "node-a" });

    const info = tracker.getGenerationInfo("node-a");
    expect(info.generation).toBeGreaterThanOrEqual(1);
    expect(info.handoffCount).toBe(info.generation - 1);
  });
});

