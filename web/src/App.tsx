import React, { useState, useRef, useEffect } from "react";
import {
  useAgentSocket,
  type UseAgentSocketReturn,
} from "./hooks/useAgentSocket.ts";
import {
  Bot,
  User,
  ShieldAlert,
  HelpCircle,
  Cpu,
  Terminal,
  RefreshCw,
  Power,
  Square,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Zap,
  Activity,
  Layers,
  ChevronRight,
  Database,
} from "lucide-react";

export function App() {
  const {
    status,
    isConnected,
    url,
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
    reconnect,
    disconnect,
    clearMessages,
  }: UseAgentSocketReturn = useAgentSocket();

  const [inputPrompt, setInputPrompt] = useState("");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, any>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [activeTab, setActiveTab] = useState<"subagents" | "tools" | "accounts" | "ledger">("subagents");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new stream content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentDelta, currentReasoning]);

  const handleSendPrompt = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPrompt.trim()) return;
    sendPrompt(inputPrompt.trim());
    setInputPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "bg-emerald-500";
      case "connecting":
        return "bg-amber-500 animate-pulse";
      case "error":
        return "bg-rose-500";
      default:
        return "bg-slate-500";
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-sky-500/10 rounded-lg border border-sky-500/20 text-sky-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-slate-100 flex items-center gap-2">
              CPH-PI Agent Workbench
              <span className="px-2 py-0.5 text-[10px] font-medium bg-sky-950/80 text-sky-300 border border-sky-800/60 rounded-full">
                React 19 + WebSocket
              </span>
            </h1>
            <p className="text-[11px] text-slate-400 truncate max-w-md" title={url}>
              {url || "Resolving WebSocket endpoint..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Turn indicator */}
          {turnState.turn > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-slate-800 border border-slate-700 text-slate-300">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Turn #{turnState.turn}</span>
              {turnState.status === "running" && (
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
          )}

          {/* Connection badge */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-slate-800/80 border border-slate-700/80 text-xs">
            <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
            <span className="capitalize font-mono text-[11px] text-slate-300">{status}</span>
          </div>

          {/* Reconnect / Disconnect */}
          {isConnected ? (
            <button
              onClick={disconnect}
              title="Disconnect WebSocket"
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
            >
              <Power className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={reconnect}
              title="Reconnect"
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {/* Interrupt controls */}
          <button
            onClick={() => interrupt("soft")}
            title="Interrupt Softly (Stop at next turn)"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-950/40 text-amber-300 border border-amber-800/60 hover:bg-amber-900/40 transition"
          >
            <Square className="w-3 h-3 fill-amber-300" />
            <span>Interrupt</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Chat & Streaming View */}
        <div className="flex flex-col flex-1 border-r border-slate-800 relative bg-slate-950">
          {/* Scrollable Transcript */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !currentDelta && !currentReasoning && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 py-20">
                <Bot className="w-12 h-12 mb-3 stroke-slate-600" />
                <p className="text-sm font-medium">Ready for your prompt</p>
                <p className="text-xs text-slate-600 mt-1">
                  Connect to CPH-PI runtime, execute tools, and inspect subagents in real-time.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-sm ${
                  msg.role === "user"
                    ? "justify-end"
                    : msg.role === "system"
                    ? "justify-center"
                    : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center shrink-0 text-sky-400">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 leading-relaxed shadow-sm ${
                    msg.role === "user"
                      ? "bg-sky-600 text-white rounded-br-none"
                      : msg.role === "system"
                      ? "bg-slate-900/80 text-slate-400 border border-slate-800 text-xs text-center"
                      : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none"
                  }`}
                >
                  {/* Reasoning box if available */}
                  {msg.reasoning && (
                    <details className="mb-2.5 pb-2 border-b border-slate-800 text-xs text-slate-400 cursor-pointer">
                      <summary className="font-mono text-[11px] text-amber-400/90 select-none flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" />
                        <span>Reasoning Chain</span>
                      </summary>
                      <pre className="mt-2 p-2 bg-slate-950/70 rounded border border-slate-850 font-mono text-[11px] text-slate-400 whitespace-pre-wrap break-words">
                        {msg.reasoning}
                      </pre>
                    </details>
                  )}

                  <div className="whitespace-pre-wrap break-words font-sans">{msg.content}</div>

                  {msg.turn !== undefined && (
                    <div className="mt-1 text-[10px] text-slate-500 font-mono text-right">
                      Turn #{msg.turn}
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center shrink-0 text-white">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {/* In-flight streaming reasoning */}
            {currentReasoning && (
              <div className="flex gap-3 text-sm">
                <div className="w-7 h-7 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center shrink-0 text-amber-400">
                  <Activity className="w-4 h-4 animate-spin" />
                </div>
                <div className="max-w-[85%] rounded-lg px-3.5 py-2.5 bg-slate-900/90 border border-amber-900/40 text-amber-200/90 text-xs">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-400 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                    <span>Agent Reasoning...</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-400 max-h-48 overflow-y-auto">
                    {currentReasoning}
                  </pre>
                </div>
              </div>
            )}

            {/* In-flight streaming delta */}
            {currentDelta && (
              <div className="flex gap-3 text-sm">
                <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center shrink-0 text-sky-400">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="max-w-[85%] rounded-lg px-4 py-2.5 bg-slate-900 border border-sky-900/60 text-slate-200">
                  <div className="whitespace-pre-wrap break-words font-sans">
                    {currentDelta}
                    <span className="inline-block w-2 h-4 bg-sky-400 ml-1 animate-pulse" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* HITL Alerts Banners */}
          {/* 1. Pending Tool Approval */}
          {pendingApproval && (
            <div className="p-3 bg-amber-950/50 border-t border-amber-850/80 flex flex-col gap-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Approval Required for Tool Action:</span>
                  <code className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200 font-mono text-[11px]">
                    {pendingApproval.action.tool || pendingApproval.action.action || "command"}
                  </code>
                </div>
                <span className="text-[10px] text-amber-400/80 font-mono">
                  {new Date(pendingApproval.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {pendingApproval.action.command && (
                <pre className="p-2 bg-slate-950 rounded text-xs font-mono text-amber-200/90 overflow-x-auto">
                  $ {pendingApproval.action.command}
                </pre>
              )}
              {pendingApproval.action.path && (
                <div className="text-xs text-slate-300 font-mono">
                  Target: {pendingApproval.action.path}
                </div>
              )}

              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => approveTool(pendingApproval.approvalId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition shadow"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Execute</span>
                </button>
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (optional)..."
                    className="flex-1 px-2.5 py-1 text-xs bg-slate-900 border border-slate-750 rounded text-slate-300 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    onClick={() => {
                      rejectTool(pendingApproval.approvalId, rejectReason || "Rejected by user");
                      setRejectReason("");
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-600/80 hover:bg-rose-500 text-white transition shadow"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. Pending Question Request */}
          {pendingQuestion && (
            <div className="p-3 bg-indigo-950/50 border-t border-indigo-850/80 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold">
                <HelpCircle className="w-4 h-4" />
                <span>Agent Inquired Information:</span>
              </div>
              {pendingQuestion.questions.map((q, qIdx) => (
                <div key={qIdx} className="space-y-1.5">
                  <p className="text-xs text-slate-200">{q.question}</p>
                  {q.options && q.options.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((opt, oIdx) => (
                        <button
                          key={oIdx}
                          onClick={() =>
                            setSelectedAnswers((prev) => ({
                              ...prev,
                              [q.question]: opt,
                            }))
                          }
                          className={`px-2.5 py-1 text-xs rounded border transition ${
                            selectedAnswers[q.question] === opt
                              ? "bg-indigo-600 text-white border-indigo-500"
                              : "bg-slate-900 text-slate-300 border-slate-700 hover:border-indigo-500"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Type your answer..."
                      onChange={(e) =>
                        setSelectedAnswers((prev) => ({
                          ...prev,
                          [q.question]: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-750 rounded text-slate-300 focus:outline-none"
                    />
                  )}
                </div>
              ))}
              <div className="flex justify-end mt-1">
                <button
                  onClick={() => answerQuestion(pendingQuestion.questionId, selectedAnswers)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition"
                >
                  Submit Answer
                </button>
              </div>
            </div>
          )}

          {/* Bottom Prompt Input */}
          <div className="p-3 bg-slate-900 border-t border-slate-800">
            <form onSubmit={handleSendPrompt} className="flex gap-2">
              <textarea
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask CPH-PI Agent to code, refactor, or investigate (Enter to send, Shift+Enter for new line)..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 resize-none font-sans"
              />
              <div className="flex flex-col gap-1.5 justify-end">
                <button
                  type="submit"
                  disabled={!isConnected || !inputPrompt.trim()}
                  className="flex items-center justify-center p-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white transition shadow"
                  title="Send Prompt"
                >
                  <Send className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={clearMessages}
                  className="p-1.5 rounded text-slate-500 hover:text-slate-300 text-[10px] text-center"
                  title="Clear Chat History"
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Sidebar: Telemetry & Multi-pane Dashboard */}
        <div className="w-80 flex flex-col bg-slate-900/60 border-l border-slate-800">
          {/* Tabs */}
          <div className="flex border-b border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("subagents")}
              className={`flex-1 py-2 font-medium text-center border-b-2 transition ${
                activeTab === "subagents"
                  ? "border-sky-500 text-sky-400 bg-slate-800/40"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Subagents ({subagents.length})
            </button>
            <button
              onClick={() => setActiveTab("tools")}
              className={`flex-1 py-2 font-medium text-center border-b-2 transition ${
                activeTab === "tools"
                  ? "border-sky-500 text-sky-400 bg-slate-800/40"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Tools ({toolCalls.length})
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className={`flex-1 py-2 font-medium text-center border-b-2 transition ${
                activeTab === "accounts"
                  ? "border-sky-500 text-sky-400 bg-slate-800/40"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Accounts
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {activeTab === "subagents" && (
              <div className="space-y-2">
                {subagents.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    No active subagent processes.
                  </p>
                ) : (
                  subagents.map((s) => (
                    <div
                      key={s.id}
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 capitalize flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-sky-400" />
                          {s.role}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono ${
                            s.status === "completed"
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                              : s.status === "failed"
                              ? "bg-rose-950 text-rose-400 border border-rose-800"
                              : "bg-sky-950 text-sky-300 border border-sky-800 animate-pulse"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 space-y-0.5">
                        <div className="truncate">ID: {s.id}</div>
                        {s.turns !== undefined && <div>Turns: {s.turns}</div>}
                        {s.account && <div className="truncate">Account: {s.account}</div>}
                        {s.durationMs && <div>Duration: {(s.durationMs / 1000).toFixed(1)}s</div>}
                      </div>
                      {s.delta && (
                        <div className="p-1.5 bg-slate-900 rounded font-mono text-[10px] text-slate-300 max-h-20 overflow-y-auto whitespace-pre-wrap">
                          {s.delta}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "tools" && (
              <div className="space-y-2">
                {toolCalls.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    No tool invocations recorded.
                  </p>
                ) : (
                  toolCalls.map((tc) => (
                    <div
                      key={tc.id}
                      className="p-2 rounded bg-slate-950 border border-slate-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="text-sky-300 truncate font-semibold">
                          {tc.action.tool || tc.action.name || tc.action.action || "tool"}
                        </span>
                        <span
                          className={`text-[10px] px-1 rounded uppercase ${
                            tc.status === "completed"
                              ? "text-emerald-400"
                              : tc.status === "failed"
                              ? "text-rose-400"
                              : "text-amber-400"
                          }`}
                        >
                          {tc.status}
                        </span>
                      </div>
                      {tc.action.path && (
                        <div className="text-[10px] text-slate-400 truncate">
                          Path: {tc.action.path}
                        </div>
                      )}
                      {tc.action.command && (
                        <div className="text-[10px] text-slate-400 truncate font-mono">
                          $ {tc.action.command}
                        </div>
                      )}
                      {tc.result?.formatted && (
                        <pre className="text-[10px] text-slate-500 truncate max-h-12 overflow-hidden font-mono">
                          {tc.result.formatted}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "accounts" && (
              <div className="space-y-2">
                {accounts.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    No account telemetry received.
                  </p>
                ) : (
                  accounts.map((acc) => (
                    <div
                      key={acc.email}
                      className="p-2.5 rounded bg-slate-950 border border-slate-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 truncate">{acc.email}</span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            acc.isThrottled ? "bg-rose-500" : "bg-emerald-500"
                          }`}
                        />
                      </div>
                      <div className="text-[11px] text-slate-400 flex justify-between">
                        <span>Status: {acc.isThrottled ? "Throttled" : "Available"}</span>
                        {acc.totalRequests !== undefined && (
                          <span>Reqs: {acc.totalRequests}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
