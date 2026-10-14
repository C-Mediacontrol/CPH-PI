import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { SessionManager, type SessionRecord } from "../../src/session/session-manager.ts";

describe("SessionManager Rebuild Index Metadata Preservation (CR-2)", () => {
  let tempDir: string;
  let sessionManager: SessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-session-rebuild-test-"));
    sessionManager = new SessionManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should preserve generation and handoffCount when index.json is rebuilt from session files", () => {
    const sessionsDir = path.join(tempDir, ".cph", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Session 1: Handoff generation 3 with handoffCount 2
    const sessionWithHandoff: SessionRecord = {
      id: "ses_generation_3_handoff_2",
      title: "Handoff Generation 3 Session",
      workspaceRoot: tempDir,
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T11:00:00.000Z",
      turnCount: 5,
      maxTurns: 25,
      modelTone: "Gpt_61_Sol_Reasoning",
      status: "active",
      turns: [],
      generation: 3,
      handoffCount: 2,
    };

    // Session 2: Legacy session without generation or handoffCount
    const legacySession: SessionRecord = {
      id: "ses_legacy_initial",
      title: "Legacy Initial Session",
      workspaceRoot: tempDir,
      createdAt: "2026-10-14T08:00:00.000Z",
      updatedAt: "2026-10-14T09:00:00.000Z",
      turnCount: 2,
      maxTurns: 25,
      modelTone: "Creative",
      status: "completed",
      turns: [],
    };

    // Directly write session JSON files to disk without creating index.json
    fs.writeFileSync(
      path.join(sessionsDir, `${sessionWithHandoff.id}.json`),
      JSON.stringify(sessionWithHandoff, null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(sessionsDir, `${legacySession.id}.json`),
      JSON.stringify(legacySession, null, 2),
      "utf-8"
    );

    // Call rebuildIndex (or listSessions which triggers rebuildIndex when index.json is missing)
    const rebuiltItems = (sessionManager as any).rebuildIndex();

    expect(rebuiltItems.length).toBe(2);

    const handoffItem = rebuiltItems.find((it: any) => it.id === "ses_generation_3_handoff_2");
    expect(handoffItem).toBeDefined();
    expect(handoffItem?.generation).toBe(3);
    expect(handoffItem?.handoffCount).toBe(2);

    const legacyItem = rebuiltItems.find((it: any) => it.id === "ses_legacy_initial");
    expect(legacyItem).toBeDefined();
    expect(legacyItem?.generation).toBe(1);
    expect(legacyItem?.handoffCount).toBe(0);

    // Verify index.json written to disk contains generation and handoffCount
    const indexFilePath = path.join(sessionsDir, "index.json");
    expect(fs.existsSync(indexFilePath)).toBe(true);

    const diskIndex = JSON.parse(fs.readFileSync(indexFilePath, "utf-8"));
    const diskHandoff = diskIndex.find((it: any) => it.id === "ses_generation_3_handoff_2");
    expect(diskHandoff.generation).toBe(3);
    expect(diskHandoff.handoffCount).toBe(2);

    const diskLegacy = diskIndex.find((it: any) => it.id === "ses_legacy_initial");
    expect(diskLegacy.generation).toBe(1);
    expect(diskLegacy.handoffCount).toBe(0);
  });
});
