import { describe, it, expect, mock } from "bun:test";
import {
  WebUiBridge,
  type PendingApproval,
  type PendingQuestion,
  type WebUiDispatchHandlers,
} from "../../src/server/web-ui-bridge.ts";
import type { CopilotAction, ToolBridgeResult } from "../../src/protocol/tool-bridge.ts";

describe("WebUiBridge", () => {
  describe("Client Management & Broadcasting", () => {
    it("should manage connected clients (add, remove, count)", () => {
      const bridge = new WebUiBridge();
      expect(bridge.getClientCount()).toBe(0);

      const client1 = { readyState: 1, send: () => {} };
      const client2 = { readyState: 1, send: () => {} };

      bridge.addClient(client1);
      bridge.addClient(client2);
      expect(bridge.getClientCount()).toBe(2);

      bridge.removeClient(client1);
      expect(bridge.getClientCount()).toBe(1);

      bridge.removeClient(client2);
      expect(bridge.getClientCount()).toBe(0);
    });

    it("should broadcast to only open clients (readyState === 1)", () => {
      const bridge = new WebUiBridge();
      const sentMessages1: string[] = [];
      const sentMessages2: string[] = [];

      const openClient = {
        readyState: 1,
        send: (msg: string) => sentMessages1.push(msg),
      };
      const closedClient = {
        readyState: 3, // CLOSED
        send: (msg: string) => sentMessages2.push(msg),
      };

      bridge.addClient(openClient);
      bridge.addClient(closedClient);

      bridge.broadcast("custom:event", { foo: "bar" });

      expect(sentMessages1.length).toBe(1);
      expect(sentMessages2.length).toBe(0);

      const parsed = JSON.parse(sentMessages1[0]);
      expect(parsed.type).toBe("custom:event");
      expect(parsed.payload).toEqual({ foo: "bar" });
      expect(typeof parsed.id).toBe("string");
      expect(typeof parsed.timestamp).toBe("number");
    });
  });

  describe("OrchestratorEvents broadcasting", () => {
    it("should broadcast turn:delta on onDelta", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onDelta?.("Hello stream");

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("turn:delta");
      expect(parsed.payload.chunk).toBe("Hello stream");
    });

    it("should broadcast turn:reasoning on onReasoning", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onReasoning?.("Thinking through step 1...");

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("turn:reasoning");
      expect(parsed.payload.chunk).toBe("Thinking through step 1...");
    });

    it("should broadcast turn:start on onTurnStart", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onTurnStart?.(2);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("turn:start");
      expect(parsed.payload.turn).toBe(2);
    });

    it("should broadcast turn:end on onTurnEnd", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onTurnEnd?.(2, "Turn 2 complete response");

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("turn:end");
      expect(parsed.payload).toEqual({ turn: 2, response: "Turn 2 complete response" });
    });

    it("should broadcast tool:start on onToolStart", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      const action: CopilotAction = {
        tool: "read_file",
        path: "src/index.ts",
      };

      bridge.onToolStart?.(action);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("tool:start");
      expect(parsed.payload.action).toEqual(action);
    });

    it("should broadcast tool:end on onToolEnd", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      const result: ToolBridgeResult = {
        actionName: "read_file",
        piToolName: "read",
        target: "src/index.ts",
        success: true,
        output: "file contents",
        formatted: "read successfully",
      };

      bridge.onToolEnd?.(result);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("tool:end");
      expect(parsed.payload.result).toEqual(result);
    });

    it("should broadcast subagent:lifecycle on onSubagentStart", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onSubagentStart?.("sub-1", "coder", { task: "fix" }, 1, "test@example.com");

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("subagent:lifecycle");
      expect(parsed.payload.id).toBe("sub-1");
      expect(parsed.payload.role).toBe("coder");
      expect(parsed.payload.hop).toBe(1);
      expect(parsed.payload.account).toBe("test@example.com");
      expect(parsed.payload.status).toBe("started");
    });

    it("should broadcast subagent:lifecycle on onSubagentEnd with separate arguments", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onSubagentEnd?.("sub-1", "coder", "completed task", 1500);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("subagent:lifecycle");
      expect(parsed.payload.id).toBe("sub-1");
      expect(parsed.payload.role).toBe("coder");
      expect(parsed.payload.result).toBe("completed task");
      expect(parsed.payload.durationMs).toBe(1500);
      expect(parsed.payload.status).toBe("completed");
    });

    it("should broadcast subagent:lifecycle on onSubagentEnd with report object", () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      bridge.addClient({ readyState: 1, send: (m: string) => sent.push(m) });

      bridge.onSubagentEnd?.({
        id: "sub-2",
        role: "researcher",
        success: true,
        finalAnswer: "found answer",
        durationMs: 2300,
        turnsCount: 3,
        handoffCount: 0,
        hopCount: 1,
      });

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("subagent:lifecycle");
      expect(parsed.payload.id).toBe("sub-2");
      expect(parsed.payload.role).toBe("researcher");
      expect(parsed.payload.result).toBe("found answer");
      expect(parsed.payload.durationMs).toBe(2300);
      expect(parsed.payload.status).toBe("completed");
    });
  });

  describe("Human-in-the-Loop Flows", () => {
    it("should handle approval flow when client approves", async () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      const mockWs = { readyState: 1, send: (m: string) => sent.push(m) };
      bridge.addClient(mockWs);

      const action: CopilotAction = {
        tool: "run_command",
        command: "npm install",
      };

      const approvalPromise = bridge.requestApproval(action);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("tool:approval-required");
      expect(parsed.payload.action).toEqual(action);
      const approvalId = parsed.payload.approvalId;
      expect(approvalId).toBeDefined();

      const pending = bridge.getPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(approvalId);

      // Client sends approve
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "client-msg-1",
          type: "tool:approve",
          payload: { approvalId },
          timestamp: Date.now(),
        })
      );

      const approved = await approvalPromise;
      expect(approved).toBe(true);
      expect(bridge.getPendingApprovals().length).toBe(0);
    });

    it("should handle approval flow when client rejects", async () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      const mockWs = { readyState: 1, send: (m: string) => sent.push(m) };
      bridge.addClient(mockWs);

      const action: CopilotAction = {
        tool: "run_command",
        command: "dangerous command",
      };

      const approvalPromise = bridge.requestApproval(action);
      const pending = bridge.getPendingApprovals();
      expect(pending.length).toBe(1);

      // Client sends reject
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "client-msg-2",
          type: "tool:reject",
          payload: { approvalId: pending[0].id, reason: "Too risky" },
          timestamp: Date.now(),
        })
      );

      const approved = await approvalPromise;
      expect(approved).toBe(false);
      expect(bridge.getPendingApprovals().length).toBe(0);
    });

    it("should handle question answering flow", async () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      const mockWs = { readyState: 1, send: (m: string) => sent.push(m) };
      bridge.addClient(mockWs);

      const questions = [
        {
          question: "Which database would you prefer?",
          options: ["PostgreSQL", "SQLite"],
        },
      ];

      const questionPromise = bridge.requestQuestionAnswer("q-123", questions);

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("question:ask");
      expect(parsed.payload.questionId).toBe("q-123");
      expect(parsed.payload.questions).toEqual(questions);

      // Client sends answer
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "client-msg-3",
          type: "question:answer",
          payload: {
            questionId: "q-123",
            answers: { "0": "SQLite" },
          },
          timestamp: Date.now(),
        })
      );

      const answer = await questionPromise;
      expect(answer).toEqual({ "0": "SQLite" });
    });
  });

  describe("Client Message Dispatching", () => {
    it("should dispatch prompt:send to onPrompt handler", async () => {
      const bridge = new WebUiBridge();
      let receivedText = "";
      let receivedAttachments: string[] | undefined;

      bridge.setDispatchHandlers({
        onPrompt: (text, attachments) => {
          receivedText = text;
          receivedAttachments = attachments;
        },
      });

      const mockWs = { readyState: 1, send: () => {} };
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "prompt-1",
          type: "prompt:send",
          payload: {
            text: "Hello assistant",
            attachments: ["file:///foo.txt"],
          },
          timestamp: Date.now(),
        })
      );

      expect(receivedText).toBe("Hello assistant");
      expect(receivedAttachments).toEqual(["file:///foo.txt"]);
    });

    it("should dispatch execution:interrupt to onInterrupt handler", () => {
      const bridge = new WebUiBridge();
      let interruptedMode: string | undefined;

      bridge.setDispatchHandlers({
        onInterrupt: (mode) => {
          interruptedMode = mode;
        },
      });

      const mockWs = { readyState: 1, send: () => {} };

      // Default mode
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "int-1",
          type: "execution:interrupt",
          payload: {},
          timestamp: Date.now(),
        })
      );
      expect(interruptedMode).toBe("soft");

      // Explicit hard mode
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "int-2",
          type: "execution:interrupt",
          payload: { mode: "hard" },
          timestamp: Date.now(),
        })
      );
      expect(interruptedMode).toBe("hard");
    });

    it("should dispatch session:switch to onSwitchSession handler", () => {
      const bridge = new WebUiBridge();
      let switchedSessionId: string | undefined;

      bridge.setDispatchHandlers({
        onSwitchSession: (sessionId) => {
          switchedSessionId = sessionId;
        },
      });

      const mockWs = { readyState: 1, send: () => {} };
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "sw-1",
          type: "session:switch",
          payload: { sessionId: "sess-abc" },
          timestamp: Date.now(),
        })
      );

      expect(switchedSessionId).toBe("sess-abc");
    });

    it("should handle session:sync-snapshot and reply with snapshot response", async () => {
      const bridge = new WebUiBridge();
      const sent: string[] = [];
      const mockWs = { readyState: 1, send: (m: string) => sent.push(m) };

      bridge.setDispatchHandlers({
        onSyncSnapshot: async (sessionId, lastTurn) => {
          return { sessionId, lastTurn, history: ["turn 1"] };
        },
      });

      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "req-sync-1",
          type: "session:sync-snapshot",
          payload: { sessionId: "sess-abc", lastTurn: 1 },
          timestamp: Date.now(),
        })
      );

      // Wait a microtick for promise to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("session:snapshot-response");
      expect(parsed.payload).toEqual({
        sessionId: "sess-abc",
        lastTurn: 1,
        history: ["turn 1"],
      });
      expect(parsed.id).toBe("req-sync-1");
    });

    it("should safely ignore malformed client messages", () => {
      const bridge = new WebUiBridge();
      const mockWs = { readyState: 1, send: () => {} };

      expect(() => bridge.onClientMessage(mockWs, "not json")).not.toThrow();
      expect(() => bridge.onClientMessage(mockWs, JSON.stringify({ invalid: true }))).not.toThrow();
      expect(() => bridge.onClientMessage(mockWs, "")).not.toThrow();
    });
  });
});
