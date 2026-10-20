import { describe, it, expect, mock } from "bun:test";
import {
  createEnvelope,
  parseEnvelope,
  type WsEnvelope as BackendEnvelope,
} from "../../src/server/protocol-types.ts";
import {
  type WsEnvelope,
  type TurnState,
  type ToolCallState,
  type ApprovalRequest,
  type QuestionRequest,
  type AccountStatus,
  type SubagentState,
  type LedgerItem,
} from "../../web/src/types/protocol.ts";
import {
  resolveWebSocketUrl,
  extractToken,
  type AgentSocketOptions,
} from "../../web/src/hooks/useAgentSocket.ts";

describe("Frontend Protocol Types & Compatibility (Task 5)", () => {
  it("should verify backend createEnvelope is fully compatible with frontend WsEnvelope", () => {
    const payload = { text: "Hello agent", attachments: ["file1.txt"] };
    const backendEnv = createEnvelope("prompt:send", payload, "msg-001");

    // Assigning to frontend type WsEnvelope
    const frontendEnv: WsEnvelope<typeof payload> = backendEnv;

    expect(frontendEnv.id).toBe("msg-001");
    expect(frontendEnv.type).toBe("prompt:send");
    expect(frontendEnv.payload).toEqual(payload);
    expect(typeof frontendEnv.timestamp).toBe("number");
  });

  it("should round-trip serialize frontend actions and parse with backend parseEnvelope", () => {
    // 1. prompt:send
    const promptAction: WsEnvelope<{ text: string; attachments?: string[] }> = {
      id: "req-1",
      type: "prompt:send",
      payload: { text: "Refactor auth module", attachments: ["src/auth.ts"] },
      timestamp: Date.now(),
    };
    const parsedPrompt = parseEnvelope(JSON.stringify(promptAction));
    expect(parsedPrompt).not.toBeNull();
    expect(parsedPrompt?.type).toBe("prompt:send");
    expect(parsedPrompt?.payload.text).toBe("Refactor auth module");

    // 2. tool:approve
    const approveAction: WsEnvelope<{ approvalId: string }> = {
      id: "req-2",
      type: "tool:approve",
      payload: { approvalId: "appr-123" },
      timestamp: Date.now(),
    };
    const parsedApprove = parseEnvelope(JSON.stringify(approveAction));
    expect(parsedApprove?.type).toBe("tool:approve");
    expect(parsedApprove?.payload.approvalId).toBe("appr-123");

    // 3. tool:reject
    const rejectAction: WsEnvelope<{ approvalId: string; reason?: string }> = {
      id: "req-3",
      type: "tool:reject",
      payload: { approvalId: "appr-123", reason: "Unsafe directory access" },
      timestamp: Date.now(),
    };
    const parsedReject = parseEnvelope(JSON.stringify(rejectAction));
    expect(parsedReject?.type).toBe("tool:reject");
    expect(parsedReject?.payload.reason).toBe("Unsafe directory access");

    // 4. question:answer
    const answerAction: WsEnvelope<{ questionId: string; answers: any }> = {
      id: "req-4",
      type: "question:answer",
      payload: { questionId: "q-1", answers: ["Option A"] },
      timestamp: Date.now(),
    };
    const parsedAnswer = parseEnvelope(JSON.stringify(answerAction));
    expect(parsedAnswer?.type).toBe("question:answer");
    expect(parsedAnswer?.payload.answers).toEqual(["Option A"]);

    // 5. execution:interrupt
    const interruptAction: WsEnvelope<{ mode: "soft" | "hard" }> = {
      id: "req-5",
      type: "execution:interrupt",
      payload: { mode: "soft" },
      timestamp: Date.now(),
    };
    const parsedInterrupt = parseEnvelope(JSON.stringify(interruptAction));
    expect(parsedInterrupt?.type).toBe("execution:interrupt");
    expect(parsedInterrupt?.payload.mode).toBe("soft");

    // 6. session:sync-snapshot
    const syncAction: WsEnvelope<{ sessionId?: string; lastTurn?: number }> = {
      id: "req-6",
      type: "session:sync-snapshot",
      payload: { sessionId: "sess-abc", lastTurn: 5 },
      timestamp: Date.now(),
    };
    const parsedSync = parseEnvelope(JSON.stringify(syncAction));
    expect(parsedSync?.type).toBe("session:sync-snapshot");
    expect(parsedSync?.payload.sessionId).toBe("sess-abc");
    expect(parsedSync?.payload.lastTurn).toBe(5);
  });

  it("should validate structure of all frontend protocol models", () => {
    const turn: TurnState = {
      turn: 1,
      status: "running",
      reasoning: "Reviewing code layout...",
      content: "Let's check the files.",
      timestamp: Date.now(),
    };
    expect(turn.turn).toBe(1);

    const toolCall: ToolCallState = {
      id: "call-1",
      action: { tool: "read_file", path: "src/main.ts" },
      status: "running",
      timestamp: Date.now(),
    };
    expect(toolCall.status).toBe("running");

    const approval: ApprovalRequest = {
      id: "appr-1",
      approvalId: "appr-1",
      action: { tool: "run_command", command: "rm -rf tmp" },
      timestamp: Date.now(),
    };
    expect(approval.approvalId).toBe("appr-1");

    const question: QuestionRequest = {
      id: "q-1",
      questionId: "q-1",
      questions: [{ question: "Which framework?", options: ["React", "Vue"] }],
      timestamp: Date.now(),
    };
    expect(question.questions[0].options?.length).toBe(2);

    const account: AccountStatus = {
      email: "user@test.org",
      isAvailable: true,
      isThrottled: false,
      totalRequests: 42,
    };
    expect(account.email).toBe("user@test.org");

    const subagent: SubagentState = {
      id: "sub-1",
      role: "researcher",
      status: "running",
      turns: 2,
      hop: 1,
      timestamp: Date.now(),
    };
    expect(subagent.role).toBe("researcher");

    const ledger: LedgerItem = {
      stepIndex: 1,
      timestamp: Date.now(),
      role: "coder",
      sessionId: "sess-01",
      tool: "edit",
      target: "src/app.ts",
      status: "SUCCESS",
      briefSummary: "Modified line 10",
    };
    expect(ledger.status).toBe("SUCCESS");
  });
});

describe("WebSocket URL Generation & Token Extraction (Task 5)", () => {
  it("should extract token from query string", () => {
    expect(extractToken("?token=sec_abc123")).toBe("sec_abc123");
    expect(extractToken("?other=val&token=sec_xyz789&foo=bar")).toBe("sec_xyz789");
    expect(extractToken("token=sec_raw")).toBe("sec_raw");
    expect(extractToken("?no_token_here=1")).toBe("");
    expect(extractToken("", "fallback-token")).toBe("fallback-token");
    expect(extractToken(undefined, "fallback-token")).toBe("fallback-token");
  });

  it("should generate websocket URL from window.location mock with token", () => {
    const mockLocation = {
      protocol: "http:",
      host: "127.0.0.1:3080",
      search: "?token=test-token-12345",
    };

    const url = resolveWebSocketUrl({}, mockLocation);
    expect(url).toBe("ws://127.0.0.1:3080/ws?token=test-token-12345");
  });

  it("should use wss: for https: protocol", () => {
    const mockLocation = {
      protocol: "https:",
      host: "workbench.example.com",
      search: "?token=secure-token-999",
    };

    const url = resolveWebSocketUrl({}, mockLocation);
    expect(url).toBe("wss://workbench.example.com/ws?token=secure-token-999");
  });

  it("should override host, port, and token with options when provided", () => {
    const mockLocation = {
      protocol: "http:",
      host: "127.0.0.1:3080",
      search: "?token=old-token",
    };

    const options: AgentSocketOptions = {
      host: "custom-host:4000",
      token: "custom-override-token",
      path: "/custom-ws",
    };

    const url = resolveWebSocketUrl(options, mockLocation);
    expect(url).toBe("ws://custom-host:4000/custom-ws?token=custom-override-token");
  });

  it("should return explicit url option directly when supplied", () => {
    const directUrl = "ws://my-custom-endpoint:8080/agent?token=secret";
    const url = resolveWebSocketUrl({ url: directUrl });
    expect(url).toBe(directUrl);
  });
});
