import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SessionManager,
  type SessionRecord,
  type SessionTurnRecord,
  type SessionIndexItem,
} from "../../src/session/session-manager.ts";

describe("SessionManager Persistence & Lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-session-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Session Creation & Disk Persistence", () => {
    it("should create and persist a new session record with default properties", () => {
      const manager = new SessionManager(tmpDir);
      const session = manager.createSession({
        title: "测试初始化任务",
        modelTone: "Creative",
      });

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^ses_\d{8}_\d{4}_[a-z0-9]+$/);
      expect(session.title).toBe("测试初始化任务");
      expect(session.workspaceRoot).toBe(path.resolve(tmpDir));
      expect(session.status).toBe("active");
      expect(session.turnCount).toBe(0);
      expect(session.maxTurns).toBe(25);
      expect(session.modelTone).toBe("Creative");
      expect(session.turns).toEqual([]);
      expect(new Date(session.createdAt).getTime()).not.toBeNaN();
      expect(new Date(session.updatedAt).getTime()).not.toBeNaN();

      // Check session file on disk
      const sessionFile = path.join(tmpDir, ".cph", "sessions", `${session.id}.json`);
      expect(fs.existsSync(sessionFile)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(sessionFile, "utf-8")) as SessionRecord;
      expect(parsed.id).toBe(session.id);
      expect(parsed.title).toBe("测试初始化任务");
      expect(parsed.turnCount).toBe(0);
      expect(parsed.status).toBe("active");
    });

    it("should allow custom options when creating a session", () => {
      const manager = new SessionManager(tmpDir);
      const session = manager.createSession({
        id: "ses_custom_001",
        title: "自定义ID任务",
        modelTone: "Precise",
        maxTurns: 30,
        currentAccount: "user@m365.corp",
      });

      expect(session.id).toBe("ses_custom_001");
      expect(session.modelTone).toBe("Precise");
      expect(session.maxTurns).toBe(30);
      expect(session.currentAccount).toBe("user@m365.corp");

      const sessionFile = path.join(tmpDir, ".cph", "sessions", "ses_custom_001.json");
      expect(fs.existsSync(sessionFile)).toBe(true);
    });

    it("should fallback title to default if not provided", () => {
      const manager = new SessionManager(tmpDir);
      const session = manager.createSession();
      expect(session.title).toBe("新会话");
    });
  });

  describe("2. index.json Synchronization & Maintenance", () => {
    it("should create index.json automatically on session creation", () => {
      const manager = new SessionManager(tmpDir);
      const session = manager.createSession({ title: "任务 A" });

      const indexFile = path.join(tmpDir, ".cph", "sessions", "index.json");
      expect(fs.existsSync(indexFile)).toBe(true);

      const indexData = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as SessionIndexItem[];
      expect(Array.isArray(indexData)).toBe(true);
      expect(indexData.length).toBe(1);
      expect(indexData[0].id).toBe(session.id);
      expect(indexData[0].title).toBe("任务 A");
      expect(indexData[0].turnCount).toBe(0);
      expect(indexData[0].status).toBe("active");
    });

    it("should keep index.json synchronized when multiple sessions are created and updated", async () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "任务 1" });
      await new Promise((r) => setTimeout(r, 10));
      const s2 = manager.createSession({ title: "任务 2" });

      const indexFile = path.join(tmpDir, ".cph", "sessions", "index.json");
      let indexData = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as SessionIndexItem[];
      expect(indexData.length).toBe(2);
      expect(indexData.map((s) => s.id)).toContain(s1.id);
      expect(indexData.map((s) => s.id)).toContain(s2.id);

      // Mutate s1 turns and status, then save
      s1.turns.push({
        turnNumber: 1,
        timestamp: new Date().toISOString(),
        userInput: "帮我实现一个加法函数",
        modelResponse: "已完成实现",
        toolCalls: [
          {
            tool: "run_command",
            args: { command: "git status" },
            output: "clean",
            success: true,
          },
        ],
      });
      s1.status = "completed";
      s1.title = "已更新任务 1";
      manager.saveSession(s1);

      indexData = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as SessionIndexItem[];
      const indexedS1 = indexData.find((x) => x.id === s1.id);
      expect(indexedS1).toBeDefined();
      expect(indexedS1?.title).toBe("已更新任务 1");
      expect(indexedS1?.turnCount).toBe(1);
      expect(indexedS1?.status).toBe("completed");
    });

    it("should reconstruct index.json if it is missing or corrupted", () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "任务 1" });
      const s2 = manager.createSession({ title: "任务 2" });

      const indexFile = path.join(tmpDir, ".cph", "sessions", "index.json");
      expect(fs.existsSync(indexFile)).toBe(true);

      // Corrupt index.json
      fs.writeFileSync(indexFile, "{ bad json", "utf-8");

      // listSessions should self-heal and rebuild index.json
      const sessions = manager.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.map((s) => s.id)).toContain(s1.id);
      expect(sessions.map((s) => s.id)).toContain(s2.id);

      // Verify repaired index.json
      const repairedIndex = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as SessionIndexItem[];
      expect(repairedIndex.length).toBe(2);
    });
  });

  describe("3. listSessions Sorting & Retrieval", () => {
    it("should sort sessions in descending order by updatedAt", async () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "任务 1" });
      await new Promise((r) => setTimeout(r, 20));
      const s2 = manager.createSession({ title: "任务 2" });
      await new Promise((r) => setTimeout(r, 20));
      const s3 = manager.createSession({ title: "任务 3" });

      let list = manager.listSessions();
      expect(list.length).toBe(3);
      expect(list[0].id).toBe(s3.id);
      expect(list[1].id).toBe(s2.id);
      expect(list[2].id).toBe(s1.id);

      // Now touch/update s1
      await new Promise((r) => setTimeout(r, 20));
      s1.title = "任务 1 被更新";
      manager.saveSession(s1);

      list = manager.listSessions();
      expect(list[0].id).toBe(s1.id); // s1 is now most recently updated
      expect(list[0].title).toBe("任务 1 被更新");
    });

    it("should return empty list when no sessions exist", () => {
      const manager = new SessionManager(tmpDir);
      const list = manager.listSessions();
      expect(list).toEqual([]);
    });
  });

  describe("4. loadSession Field Integrity & Fault Tolerance", () => {
    it("should load a saved session preserving all fields and turns", () => {
      const manager = new SessionManager(tmpDir);
      const s = manager.createSession({
        title: "复杂任务",
        modelTone: "Creative",
        currentAccount: "acc1@copilot.ms",
      });

      const turn1: SessionTurnRecord = {
        turnNumber: 1,
        timestamp: new Date().toISOString(),
        userInput: "请探测代码库",
        modelReasoning: "先执行 git status 建立物理连接",
        modelResponse: "探测完毕",
        toolCalls: [
          {
            tool: "run_command",
            args: { command: "git status" },
            output: "On branch main",
            success: true,
          },
        ],
      };
      s.turns.push(turn1);
      s.turnCount = 1;
      manager.saveSession(s);

      const loaded = manager.loadSession(s.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(s.id);
      expect(loaded?.title).toBe("复杂任务");
      expect(loaded?.modelTone).toBe("Creative");
      expect(loaded?.currentAccount).toBe("acc1@copilot.ms");
      expect(loaded?.turnCount).toBe(1);
      expect(loaded?.turns.length).toBe(1);
      expect(loaded?.turns[0].turnNumber).toBe(1);
      expect(loaded?.turns[0].userInput).toBe("请探测代码库");
      expect(loaded?.turns[0].modelReasoning).toBe("先执行 git status 建立物理连接");
      expect(loaded?.turns[0].toolCalls?.[0].tool).toBe("run_command");
      expect(loaded?.turns[0].toolCalls?.[0].success).toBe(true);
    });

    it("should return null when loading non-existent session", () => {
      const manager = new SessionManager(tmpDir);
      const loaded = manager.loadSession("ses_non_existent");
      expect(loaded).toBeNull();
    });

    it("should return null and handle gracefully if session file is corrupted", () => {
      const manager = new SessionManager(tmpDir);
      const s = manager.createSession({ title: "坏文件测试" });
      const sessionFile = path.join(tmpDir, ".cph", "sessions", `${s.id}.json`);
      fs.writeFileSync(sessionFile, "INVALID JSON CONTENT", "utf-8");

      const loaded = manager.loadSession(s.id);
      expect(loaded).toBeNull();
    });

    it("should prevent directory traversal in loadSession", () => {
      const manager = new SessionManager(tmpDir);
      const loaded = manager.loadSession("../../../etc/passwd");
      expect(loaded).toBeNull();
    });
  });

  describe("5. getLatestActiveSession Accurate Selection", () => {
    it("should accurately return the most recent active session", async () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "会话 1" });
      await new Promise((r) => setTimeout(r, 20));
      const s2 = manager.createSession({ title: "会话 2" });

      const latest = manager.getLatestActiveSession();
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(s2.id);
    });

    it("should skip completed and handed_off sessions to pick active one", async () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "老活跃会话" });

      await new Promise((r) => setTimeout(r, 20));
      const s2 = manager.createSession({ title: "已完成会话" });
      s2.status = "completed";
      manager.saveSession(s2);

      await new Promise((r) => setTimeout(r, 20));
      const s3 = manager.createSession({ title: "已接力会话" });
      s3.status = "handed_off";
      manager.saveSession(s3);

      const latest = manager.getLatestActiveSession();
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(s1.id);
      expect(latest?.status).toBe("active");
    });

    it("should return null if all sessions are completed or handed_off", () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "已完成 1" });
      s1.status = "completed";
      manager.saveSession(s1);

      const s2 = manager.createSession({ title: "已接力 2" });
      s2.status = "handed_off";
      manager.saveSession(s2);

      const latest = manager.getLatestActiveSession();
      expect(latest).toBeNull();
    });

    it("should return null if no sessions exist", () => {
      const manager = new SessionManager(tmpDir);
      expect(manager.getLatestActiveSession()).toBeNull();
    });
  });

  describe("6. Session Deletion & Boundary Isolation", () => {
    it("should delete session file and remove entry from index.json", () => {
      const manager = new SessionManager(tmpDir);
      const s1 = manager.createSession({ title: "待删除 1" });
      const s2 = manager.createSession({ title: "保留 2" });

      const s1File = path.join(tmpDir, ".cph", "sessions", `${s1.id}.json`);
      expect(fs.existsSync(s1File)).toBe(true);

      const deleted = manager.deleteSession(s1.id);
      expect(deleted).toBe(true);
      expect(fs.existsSync(s1File)).toBe(false);

      const list = manager.listSessions();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(s2.id);

      const loaded = manager.loadSession(s1.id);
      expect(loaded).toBeNull();
    });

    it("should return false when deleting non-existent session without throwing", () => {
      const manager = new SessionManager(tmpDir);
      const result = manager.deleteSession("ses_not_exist");
      expect(result).toBe(false);
    });

    it("should guard against directory traversal in deleteSession", () => {
      const manager = new SessionManager(tmpDir);
      const result = manager.deleteSession("../../some_file");
      expect(result).toBe(false);
    });
  });
});
