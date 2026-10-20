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
  Trash2,
} from "lucide-react";
import { MessageStream } from "./components/chat/MessageStream.tsx";
import { ActionDock } from "./components/interaction/ActionDock.tsx";


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

  const [activeTab, setActiveTab] = useState<"subagents" | "tools" | "accounts" | "ledger">("subagents");

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

          {/* Clear chat history */}
          <button
            onClick={clearMessages}
            title="Clear Chat History"
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>

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
        <div className="flex flex-col flex-1 border-r border-slate-800 relative bg-slate-950 overflow-hidden">
          {/* Scrollable Message History with Deep Thinking, Unified Diffs, Tool Cards, and HITL */}
          <MessageStream
            messages={messages}
            currentReasoning={currentReasoning}
            currentDelta={currentDelta}
            turnState={turnState}
            toolCalls={toolCalls}
            pendingApproval={pendingApproval}
            pendingQuestion={pendingQuestion}
            onApprove={approveTool}
            onReject={rejectTool}
            onAnswerQuestion={answerQuestion}
          />

          {/* Bottom Action Dock with Slash Commands & Two-Stage Interrupt */}
          <div className="p-3.5 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm">
            <ActionDock
              onSend={sendPrompt}
              onInterrupt={(abort) => interrupt(abort ? "hard" : "soft")}
              isRunning={turnState.status === "running"}
              disabled={!isConnected}
            />
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
