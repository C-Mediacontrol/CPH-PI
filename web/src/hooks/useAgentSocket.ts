import { useState, useEffect, useRef, useCallback } from "react";
import type {
  WsEnvelope,
  ConnectionStatus,
  AgentMessage,
  TurnState,
  ToolCallState,
  ApprovalRequest,
  QuestionRequest,
  AccountStatus,
  SubagentState,
  LedgerItem,
  SnapshotResponse,
} from "../types/protocol.ts";

export interface AgentSocketOptions {
  url?: string;
  host?: string;
  port?: number;
  token?: string;
  path?: string;
  autoReconnect?: boolean;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  onSnapshot?: (snapshot: SnapshotResponse) => void;
  onFileContent?: (content: string) => void;
}

export interface UseAgentSocketReturn {
  status: ConnectionStatus;
  isConnected: boolean;
  url: string;
  messages: AgentMessage[];
  currentReasoning: string;
  currentDelta: string;
  turnState: TurnState;
  toolCalls: ToolCallState[];
  pendingApproval: ApprovalRequest | null;
  pendingQuestion: QuestionRequest | null;
  accounts: AccountStatus[];
  subagents: SubagentState[];
  ledger: LedgerItem[];
  sendPrompt: (text: string, attachments?: string[]) => void;
  approveTool: (approvalId: string) => void;
  rejectTool: (approvalId: string, reason?: string) => void;
  answerQuestion: (questionId: string, answers: any) => void;
  interrupt: (mode?: "soft" | "hard") => void;
  syncSnapshot: (sessionId?: string, lastTurn?: number) => void;
  switchSession: (sessionId: string) => void;
  readFile: (relativePath: string) => void;
  reconnect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}

/**
 * Extract security token from query string or fallback.
 */
export function extractToken(search?: string, fallback: string = ""): string {
  if (search === undefined) {
    if (typeof window !== "undefined" && window.location?.search) {
      search = window.location.search;
    } else {
      return fallback;
    }
  }
  if (!search) return fallback;

  const clean = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(clean);
  return params.get("token") || fallback;
}

/**
 * Resolve full WebSocket URL with token query param.
 */
export function resolveWebSocketUrl(
  options: AgentSocketOptions = {},
  loc?: { protocol?: string; host?: string; search?: string }
): string {
  if (options.url) {
    return options.url;
  }

  const activeLoc =
    loc ||
    (typeof window !== "undefined" && window.location
      ? window.location
      : { protocol: "http:", host: "127.0.0.1:3080", search: "" });

  const protocol = activeLoc.protocol === "https:" ? "wss:" : "ws:";
  const host = options.host || (options.port ? `127.0.0.1:${options.port}` : activeLoc.host || "127.0.0.1:3080");
  const token = options.token || extractToken(activeLoc.search);
  const path = options.path || "/ws";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${protocol}//${host}${cleanPath}${query}`;
}

/**
 * React hook managing WebSocket lifecycle, bidirectional streaming,
 * human-in-the-loop approvals, and subagent telemetry.
 */
export function useAgentSocket(options: AgentSocketOptions = {}): UseAgentSocketReturn {
  const optionsRef = useRef<AgentSocketOptions>(options);
  optionsRef.current = options;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [currentReasoning, setCurrentReasoning] = useState<string>("");
  const [currentDelta, setCurrentDelta] = useState<string>("");
  const [turnState, setTurnState] = useState<TurnState>({
    turn: 0,
    status: "idle",
    reasoning: "",
    content: "",
  });
  const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionRequest | null>(null);
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [subagents, setSubagents] = useState<SubagentState[]>([]);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const manualDisconnectRef = useRef<boolean>(false);
  const backoffDelayRef = useRef<number>(options.initialBackoffMs ?? 1000);
  const maxBackoffMs = options.maxBackoffMs ?? 16000;
  const autoReconnect = options.autoReconnect ?? true;

  // Refs for current streaming values in turn:end callback closure
  const deltaRef = useRef<string>("");
  const reasoningRef = useRef<string>("");
  deltaRef.current = currentDelta;
  reasoningRef.current = currentReasoning;

  const sendEnvelope = useCallback((type: string, payload: any, id?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    const env: WsEnvelope = {
      id: id || `cli_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      payload,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(env));
    return true;
  }, []);

  const connect = useCallback(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualDisconnectRef.current = false;
    const targetUrl = resolveWebSocketUrl(options);
    setResolvedUrl(targetUrl);
    setStatus("connecting");

    try {
      const ws = new WebSocket(targetUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        backoffDelayRef.current = options.initialBackoffMs ?? 1000;
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const env = JSON.parse(raw) as WsEnvelope;
          if (!env || typeof env !== "object" || !env.type) return;

          switch (env.type) {
            case "turn:start":
              setCurrentDelta("");
              setCurrentReasoning("");
              setTurnState({
                turn: env.payload?.turn ?? 0,
                status: "running",
                reasoning: "",
                content: "",
                timestamp: env.timestamp,
              });
              break;

            case "turn:delta":
              if (env.payload?.chunk) {
                setCurrentDelta((prev) => prev + env.payload.chunk);
              }
              break;

            case "turn:reasoning":
              if (env.payload?.chunk) {
                setCurrentReasoning((prev) => prev + env.payload.chunk);
              }
              break;

            case "turn:end": {
              const finalContent = env.payload?.response || deltaRef.current;
              const finalReasoning = reasoningRef.current;
              const turnNum = env.payload?.turn;

              setMessages((prev) => [
                ...prev,
                {
                  id: env.id || `msg_${Date.now()}`,
                  role: "assistant",
                  content: finalContent,
                  reasoning: finalReasoning || undefined,
                  timestamp: env.timestamp || Date.now(),
                  turn: turnNum,
                },
              ]);

              setTurnState({
                turn: turnNum ?? 0,
                status: "completed",
                reasoning: finalReasoning,
                content: finalContent,
                response: finalContent,
                timestamp: env.timestamp,
              });

              setCurrentDelta("");
              setCurrentReasoning("");
              break;
            }

            case "tool:start": {
              const action = env.payload?.action || {};
              setToolCalls((prev) => [
                ...prev,
                {
                  id: env.id,
                  action,
                  status: "running",
                  timestamp: env.timestamp || Date.now(),
                },
              ]);
              break;
            }

            case "tool:end": {
              const res = env.payload?.result;
              setToolCalls((prev) => {
                const targetName = res?.actionName || res?.piToolName;
                const idx = prev.findIndex(
                  (c) => c.status === "running" && (c.action?.tool === targetName || c.action?.name === targetName || c.id === env.id)
                );
                if (idx !== -1) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    status: res?.success ? "completed" : "failed",
                    result: res,
                  };
                  return updated;
                }
                return [
                  ...prev,
                  {
                    id: env.id,
                    action: { tool: targetName },
                    status: res?.success ? "completed" : "failed",
                    result: res,
                    timestamp: env.timestamp || Date.now(),
                  },
                ];
              });
              break;
            }

            case "tool:approval-required": {
              const req: ApprovalRequest = {
                id: env.payload?.id || env.id,
                approvalId: env.payload?.approvalId || env.id,
                action: env.payload?.action || {},
                timestamp: env.payload?.timestamp || env.timestamp || Date.now(),
              };
              setPendingApproval(req);
              setToolCalls((prev) => [
                ...prev,
                {
                  id: req.id,
                  approvalId: req.approvalId,
                  action: req.action,
                  status: "approval-required",
                  timestamp: req.timestamp,
                },
              ]);
              break;
            }

            case "question:ask": {
              const qReq: QuestionRequest = {
                id: env.payload?.id || env.id,
                questionId: env.payload?.questionId || env.id,
                questions: env.payload?.questions || [],
                timestamp: env.payload?.timestamp || env.timestamp || Date.now(),
              };
              setPendingQuestion(qReq);
              break;
            }

            case "subagent:lifecycle": {
              const p = env.payload || {};
              setSubagents((prev) => {
                const existingIdx = prev.findIndex((s) => s.id === p.id);
                const subagentItem: SubagentState = {
                  id: p.id,
                  role: p.role,
                  status: p.status,
                  spec: p.spec,
                  hop: p.hop,
                  account: p.account,
                  result: p.result,
                  durationMs: p.durationMs,
                  report: p.report,
                  timestamp: env.timestamp,
                };
                if (existingIdx !== -1) {
                  const next = [...prev];
                  next[existingIdx] = { ...next[existingIdx], ...subagentItem };
                  return next;
                }
                return [...prev, subagentItem];
              });
              break;
            }

            case "subagent:progress": {
              const p = env.payload || {};
              setSubagents((prev) => {
                const existingIdx = prev.findIndex((s) => s.id === p.id);
                if (existingIdx !== -1) {
                  const next = [...prev];
                  const cur = next[existingIdx];
                  next[existingIdx] = {
                    ...cur,
                    turns: p.turn,
                    delta: (cur.delta || "") + (p.delta || ""),
                    currentAction: p.action || cur.currentAction,
                    account: p.account || cur.account,
                    hop: p.hopCount ?? cur.hop,
                  };
                  return next;
                }
                return prev;
              });
              break;
            }

            case "account:switched": {
              const p = env.payload || {};
              setAccounts((prev) => {
                const updated = [...prev];
                const existing = updated.find((a) => a.email === p.newEmail);
                if (!existing) {
                  updated.push({
                    email: p.newEmail,
                    isAvailable: true,
                    isThrottled: false,
                    lastUsedAt: Date.now(),
                  });
                }
                return updated;
              });
              break;
            }

            case "session:compacted": {
              const p = env.payload || {};
              setMessages((prev) => [
                ...prev,
                {
                  id: env.id,
                  role: "system",
                  content: `Context Compacted: cleared ${p.clearedChars ?? 0} characters (ratio: ${p.ratio ?? 0})`,
                  timestamp: env.timestamp,
                },
              ]);
              break;
            }

            case "agent:refusal": {
              const p = env.payload || {};
              setMessages((prev) => [
                ...prev,
                {
                  id: env.id,
                  role: "system",
                  content: `Agent Refusal Intercepted (retry #${p.retryAttempt}): ${p.refusalText}`,
                  timestamp: env.timestamp,
                },
              ]);
              break;
            }

            case "agent:completed": {
              const p = env.payload || {};
              if (p.finalAnswer) {
                setMessages((prev) =>
                  prev.some((m) => m.content === p.finalAnswer)
                    ? prev
                    : [
                        ...prev,
                        {
                          id: env.id,
                          role: "assistant",
                          content: p.finalAnswer,
                          timestamp: env.timestamp,
                        },
                      ]
                );
              }
              break;
            }

            case "agent:error": {
              const p = env.payload || {};
              setMessages((prev) => [
                ...prev,
                {
                  id: env.id,
                  role: "system",
                  content: `Agent Error: ${p.message || "Unknown error"}`,
                  timestamp: env.timestamp,
                },
              ]);
              break;
            }

            case "session:snapshot-response": {
              const snapshot = env.payload;
              if (snapshot) {
                if (Array.isArray(snapshot.ledger)) {
                  setLedger(snapshot.ledger);
                }
                options.onSnapshot?.(snapshot);
              }
              break;
            }

            case "workspace:file-response": {
              options.onFileContent?.(env.payload);
              break;
            }
          }
        } catch {
          // Ignore invalid envelopes safely
        }
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;

        if (!manualDisconnectRef.current && autoReconnect) {
          const delay = backoffDelayRef.current;
          backoffDelayRef.current = Math.min(delay * 2, maxBackoffMs);
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch {
      setStatus("error");
    }
  }, [
    options.url,
    options.host,
    options.port,
    options.token,
    options.path,
    autoReconnect,
    maxBackoffMs,
  ]);

  useEffect(() => {
    connect();
    return () => {
      manualDisconnectRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Actions exposed to caller
  const sendPrompt = useCallback(
    (text: string, attachments?: string[]) => {
      const id = `prompt_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "user",
          content: text,
          attachments,
          timestamp: Date.now(),
        },
      ]);
      setCurrentDelta("");
      setCurrentReasoning("");
      sendEnvelope("prompt:send", { text, attachments }, id);
    },
    [sendEnvelope]
  );

  const approveTool = useCallback(
    (approvalId: string) => {
      sendEnvelope("tool:approve", { approvalId });
      setPendingApproval((cur) => (cur?.approvalId === approvalId ? null : cur));
      setToolCalls((prev) =>
        prev.map((c) => (c.approvalId === approvalId ? { ...c, status: "running" } : c))
      );
    },
    [sendEnvelope]
  );

  const rejectTool = useCallback(
    (approvalId: string, reason?: string) => {
      sendEnvelope("tool:reject", { approvalId, reason });
      setPendingApproval((cur) => (cur?.approvalId === approvalId ? null : cur));
      setToolCalls((prev) =>
        prev.map((c) => (c.approvalId === approvalId ? { ...c, status: "failed" } : c))
      );
    },
    [sendEnvelope]
  );

  const answerQuestion = useCallback(
    (questionId: string, answers: any) => {
      sendEnvelope("question:answer", { questionId, answers });
      setPendingQuestion((cur) => (cur?.questionId === questionId ? null : cur));
    },
    [sendEnvelope]
  );

  const interrupt = useCallback(
    (mode: "soft" | "hard" = "soft") => {
      sendEnvelope("execution:interrupt", { mode });
    },
    [sendEnvelope]
  );

  const syncSnapshot = useCallback(
    (sessionId?: string, lastTurn?: number) => {
      sendEnvelope("session:sync-snapshot", { sessionId, lastTurn });
    },
    [sendEnvelope]
  );

  const switchSession = useCallback(
    (sessionId: string) => {
      sendEnvelope("session:switch", { sessionId });
    },
    [sendEnvelope]
  );

  const readFile = useCallback(
    (relativePath: string) => {
      sendEnvelope("workspace:file-read", { relativePath });
    },
    [sendEnvelope]
  );

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentDelta("");
    setCurrentReasoning("");
  }, []);

  return {
    status,
    isConnected: status === "connected",
    url: resolvedUrl,
    messages,
    currentReasoning,
    currentDelta,
    turnState,
    toolCalls,
    pendingApproval,
    pendingQuestion,
    accounts,
    subagents,
    ledger,
    sendPrompt,
    approveTool,
    rejectTool,
    answerQuestion,
    interrupt,
    syncSnapshot,
    switchSession,
    readFile,
    reconnect,
    disconnect,
    clearMessages,
  };
}
