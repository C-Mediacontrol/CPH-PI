import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RpcHandler } from "../../src/web/rpc-handler";
import { SessionManager } from "../../src/session/session-manager";

describe("Web RPC Session Persistence Tests", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-persist-test-"));
    sessionManager = new SessionManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should persist turns to physical session JSON via saveSession on turn completion", async () => {
    const session = sessionManager.createSession({ title: "持久化测试" });
    const mockWs: any = { readyState: 1, send: () => {}, on: () => {} };
    const handler = new RpcHandler(mockWs, {
      workspaceRoot: tmpDir,
      sessionManager,
    });

    (handler as any).activeSessionId = session.id;
    (handler as any).turns = [
      {
        id: "turn-1",
        turnNumber: 1,
        userMessage: { text: "你好" },
        assistantText: "你好！有什么我可以帮你的？",
        status: "completed",
        tools: [],
      },
    ];

    await (handler as any).persistActiveSession();

    const loaded = sessionManager.loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.turns?.length).toBe(1);
    expect(loaded!.turns?.[0].userInput).toBe("你好");
    expect(loaded!.turns?.[0].modelResponse).toBe("你好！有什么我可以帮你的？");
  });

  test("should save subagent record in isolated .cph/subagents/<mainId>/ and not pollute rebuildIndex", async () => {
    const mainSession = sessionManager.createSession({ title: "主任务" });
    const mockWs: any = { readyState: 1, send: () => {}, on: () => {} };
    const handler = new RpcHandler(mockWs, {
      workspaceRoot: tmpDir,
      sessionManager,
    });
    (handler as any).activeSessionId = mainSession.id;

    (handler as any).persistSubagentRecord("sub-1", {
      id: "sub-1",
      role: "researcher",
      finalAnswer: "探查完毕",
      turnsCount: 2,
    });

    const subDir = path.join(tmpDir, ".cph", "subagents", mainSession.id);
    expect(fs.existsSync(path.join(subDir, "sub-1.json"))).toBe(true);

    const indexed = sessionManager.listSessions();
    expect(indexed.length).toBe(1);
    expect(indexed[0].id).toBe(mainSession.id);
  });

  test("should automatically persist session when orchestrator run finishes", async () => {
    const session = sessionManager.createSession({ title: "自动持久化测试" });
    const mockWs: any = { readyState: 1, send: () => {}, on: () => {} };
    const mockOrchestrator: any = {
      run: async (opts: any) => {
        opts.events?.onTurnStart?.(1);
        opts.events?.onDelta?.("这是回答");
        opts.events?.onCompleted?.("这是回答");
        return { completed: true, finalAnswer: "这是回答" };
      },
    };
    const handler = new RpcHandler(mockWs, {
      workspaceRoot: tmpDir,
      sessionManager,
      orchestrator: mockOrchestrator,
    });
    (handler as any).activeSessionId = session.id;

    await handler.handleUserSubmit({ text: "测试提问" });

    const loaded = sessionManager.loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.turns?.length).toBe(1);
    expect(loaded!.turns?.[0].userInput).toBe("测试提问");
    expect(loaded!.turns?.[0].modelResponse).toBe("这是回答");
  });
});
