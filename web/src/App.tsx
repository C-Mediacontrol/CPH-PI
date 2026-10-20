import React, { useState, useMemo, useCallback } from "react";
import {
  useAgentSocket,
  type UseAgentSocketReturn,
} from "./hooks/useAgentSocket.ts";
import { MessageStream } from "./components/chat/MessageStream.tsx";
import { ActionDock } from "./components/interaction/ActionDock.tsx";
import { Sidebar, type SessionItem } from "./components/layout/Sidebar.tsx";
import { ContextInspector } from "./components/layout/ContextInspector.tsx";
import { extractModifiedAndReadFiles } from "./utils/panelHelpers.ts";
import {
  Cpu,
  Power,
  RefreshCw,
  Trash2,
  Square,
  Zap,
  X,
  FileCode,
  FileText,
} from "lucide-react";

export function App() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>("default-session");
  const [sessions, setSessions] = useState<SessionItem[]>([
    {
      id: "default-session",
      title: "Main Copilot Session",
      turnCount: 0,
      active: true,
    },
  ]);

  const handleFileContent = useCallback((content: string) => {
    setFileContent(content);
  }, []);

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
    switchSession,
    readFile,
    reconnect,
    disconnect,
    clearMessages,
  }: UseAgentSocketReturn = useAgentSocket({
    onFileContent: handleFileContent,
  });

  // Extract all modified and read file paths from real-time telemetry
  const { modifiedFiles, readFiles } = useMemo(
    () => extractModifiedAndReadFiles(toolCalls, ledger),
    [toolCalls, ledger]
  );

  // Combine unique known files in workspace from modified, read, and tool calls
  const allWorkspaceFiles = useMemo(() => {
    const fileSet = new Set<string>();
    for (const f of modifiedFiles) fileSet.add(f);
    for (const f of readFiles) fileSet.add(f);

    for (const tc of toolCalls) {
      const p = tc.action?.path || tc.action?.filePath || tc.action?.file;
      if (p && typeof p === "string") {
        fileSet.add(p.replace(/\\/g, "/").replace(/^\/+/, ""));
      }
    }

    for (const item of ledger) {
      if (item.target && !item.target.includes(" ")) {
        fileSet.add(item.target.replace(/\\/g, "/").replace(/^\/+/, ""));
      }
    }

    // Include standard default project files if list is small
    if (fileSet.size === 0) {
      fileSet.add("package.json");
      fileSet.add("README.md");
      fileSet.add("src/App.tsx");
      fileSet.add("src/index.ts");
    }

    return Array.from(fileSet).sort();
  }, [modifiedFiles, readFiles, toolCalls, ledger]);

  // Handle file click in WorkspaceTree
  const handleSelectFile = (path: string) => {
    setSelectedFile(path);
    setFileContent(null);
    readFile(path);
  };

  // Handle switching sessions
  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setSessions((prev) =>
      prev.map((s) => ({ ...s, active: s.id === sessionId }))
    );
    switchSession(sessionId);
  };

  // Handle creating a new session
  const handleNewSession = () => {
    const newId = `session_${Date.now().toString(36)}`;
    const newSession: SessionItem = {
      id: newId,
      title: `Session #${sessions.length + 1}`,
      turnCount: 0,
      active: true,
    };
    setSessions((prev) => [
      ...prev.map((s) => ({ ...s, active: false })),
      newSession,
    ]);
    setCurrentSessionId(newId);
    clearMessages();
    syncSnapshot(newId);
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
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. Left Inspection Panel: Sidebar (260px - 280px) */}
      <Sidebar
        status={status}
        mode="Web"
        sessions={sessions}
        currentSessionId={currentSessionId}
        accounts={accounts}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
      />

      {/* 2. Center Main Stage: Header + MessageStream + ActionDock */}
      <div className="flex flex-col flex-1 min-w-0 bg-slate-950 overflow-hidden relative">
        {/* Top Header Bar */}
        <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 bg-sky-500/10 rounded-lg border border-sky-500/20 text-sky-400 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="truncate">
              <h1 className="text-xs font-semibold tracking-wide text-slate-100 flex items-center gap-2">
                <span>CPH-PI Agent Workbench</span>
                <span className="px-1.5 py-0.2 text-[9px] font-mono bg-sky-950/80 text-sky-300 border border-sky-800/60 rounded">
                  Copilot Autonomous
                </span>
              </h1>
              <p
                className="text-[10px] text-slate-500 truncate max-w-sm font-mono"
                title={url}
              >
                {url || "Connecting to WebSocket..."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Active Turn Counter */}
            {turnState.turn > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Turn #{turnState.turn}</span>
                {turnState.status === "running" && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                )}
              </div>
            )}

            {/* Connection badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/80 text-xs">
              <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
              <span className="capitalize font-mono text-[11px] text-slate-300">
                {status}
              </span>
            </div>

            {/* Reconnect / Disconnect */}
            {isConnected ? (
              <button
                onClick={disconnect}
                title="Disconnect WebSocket"
                className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={reconnect}
                title="Reconnect"
                className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Clear chat history */}
            <button
              onClick={clearMessages}
              title="Clear Messages"
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Interrupt controls */}
            <button
              onClick={() => interrupt("soft")}
              title="Interrupt Softly (Stop at next turn)"
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-950/40 text-amber-300 border border-amber-800/60 hover:bg-amber-900/40 transition"
            >
              <Square className="w-2.5 h-2.5 fill-amber-300" />
              <span>Interrupt</span>
            </button>
          </div>
        </header>

        {/* Scrollable Message History */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
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

          {/* Optional File Preview Drawer */}
          {selectedFile && (
            <div className="absolute inset-x-0 bottom-0 max-h-72 bg-slate-900/95 border-t border-slate-700/80 backdrop-blur-md shadow-2xl z-20 flex flex-col animate-in slide-in-from-bottom duration-200">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs">
                <div className="flex items-center gap-1.5 text-sky-400 font-mono">
                  <FileCode className="w-3.5 h-3.5" />
                  <span className="font-semibold text-slate-200">{selectedFile}</span>
                </div>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setFileContent(null);
                  }}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3 font-mono text-[11px] text-slate-300 bg-slate-950/70">
                {fileContent !== null ? (
                  <pre className="whitespace-pre-wrap leading-relaxed">{fileContent}</pre>
                ) : (
                  <div className="py-6 text-center text-slate-500">
                    Loading file contents from workspace...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Dock with Slash Commands & Two-Stage Interrupt */}
        <div className="p-3.5 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm z-10">
          <ActionDock
            onSend={sendPrompt}
            onInterrupt={(abort) => interrupt(abort ? "hard" : "soft")}
            isRunning={turnState.status === "running"}
            disabled={!isConnected}
          />
        </div>
      </div>

      {/* 3. Right Inspection Panel: ContextInspector (320px - 360px, collapsible) */}
      <ContextInspector
        subagents={subagents}
        ledger={ledger}
        files={allWorkspaceFiles}
        modifiedFiles={modifiedFiles}
        readFiles={readFiles}
        selectedFile={selectedFile}
        onSelectFile={handleSelectFile}
        isCollapsed={isInspectorCollapsed}
        onToggleCollapse={() => setIsInspectorCollapsed((prev) => !prev)}
      />
    </div>
  );
}

export default App;
