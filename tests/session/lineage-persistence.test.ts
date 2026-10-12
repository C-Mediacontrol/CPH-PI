import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";
import { SessionManager, type SessionRecord } from "../../src/session/session-manager.ts";

describe("SessionLineageTracker - Disk Persistence & Recovery Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-lineage-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should serialize and deserialize session lineages accurately", () => {
    const tracker = new SessionLineageTracker();
    tracker.register({
      sessionId: "main_v1",
      role: "main",
      status: "handed_off",
      successorId: "main_v2",
      subagentSessionIds: ["sub_1", "sub_2"],
    });
    tracker.register({
      sessionId: "main_v2",
      role: "main",
      status: "active",
      predecessorId: "main_v1",
    });

    const serialized = tracker.serialize();
    expect(serialized).toBeDefined();
    expect(serialized["main_v1"]?.status).toBe("handed_off");
    expect(serialized["main_v1"]?.successorId).toBe("main_v2");
    expect(serialized["main_v1"]?.subagentSessionIds).toEqual(["sub_1", "sub_2"]);
    expect(serialized["main_v2"]?.status).toBe("active");

    // Fresh tracker restore
    const freshTracker = new SessionLineageTracker();
    freshTracker.deserialize(serialized);

    expect(freshTracker.resolveActiveHead("main_v1")).toBe("main_v2");
    expect(freshTracker.getLineage("main_v1")?.subagentSessionIds).toEqual(["sub_1", "sub_2"]);
  });

  it("should persist lineage to disk and restore across process lifecycles via SessionManager", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.createSession({
      title: "Lineage Persistence Task",
    });

    const tracker = new SessionLineageTracker();
    tracker.register({
      sessionId: session.id,
      role: "main",
      status: "active",
    });

    // Subagent spawned
    const subId = `${session.id}_sub1_coder`;
    tracker.register({
      sessionId: subId,
      role: "coder",
      status: "completed",
      parentSessionId: session.id,
    });
    tracker.linkSubagent(session.id, subId);

    // Main session hands off to successor
    const succId = `${session.id}_succ`;
    tracker.register({
      sessionId: succId,
      role: "main",
      status: "active",
      predecessorId: session.id,
    });
    tracker.linkSuccessor(session.id, succId);

    // Save session with lineage
    manager.saveSessionWithLineage(session, tracker);

    // Verify on-disk file content
    const diskPath = path.join(tempDir, ".cph", "sessions", `${session.id}.json`);
    expect(fs.existsSync(diskPath)).toBe(true);
    const rawDisk = JSON.parse(fs.readFileSync(diskPath, "utf-8")) as SessionRecord;
    expect(rawDisk.lineage).toBeDefined();
    expect(rawDisk.lineage![session.id]?.successorId).toBe(succId);

    // Simulate new process instance
    const freshManager = new SessionManager(tempDir);
    const freshTracker = new SessionLineageTracker();

    const loaded = freshManager.loadSession(session.id, freshTracker);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(session.id);

    // Verify reconstructed lineage network in fresh tracker
    expect(freshTracker.resolveActiveHead(session.id)).toBe(succId);
    expect(freshTracker.getLineage(session.id)?.subagentSessionIds).toContain(subId);
    expect(freshTracker.getLineage(subId)?.parentSessionId).toBe(session.id);
  });

  it("should support restoreSessionLineage helper and handle empty lineage gracefully", () => {
    const manager = new SessionManager(tempDir);
    const sessionWithoutLineage = manager.createSession({
      title: "No Lineage Session",
    });

    const tracker = new SessionLineageTracker();
    const restored = manager.restoreSessionLineage(sessionWithoutLineage.id, tracker);
    expect(restored).toBe(false);

    // Robust against null or invalid input
    tracker.deserialize(null);
    tracker.deserialize(undefined);
    tracker.deserialize("invalid string");
    expect(tracker.serialize()).toEqual({});
  });
});
