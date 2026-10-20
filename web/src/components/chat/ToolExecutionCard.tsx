import React, { useState } from "react";
import {
  Wrench,
  Terminal,
  FileCode,
  FileText,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Code,
  Copy,
  Check,
} from "lucide-react";
import type { ToolCallState } from "../../types/protocol.ts";
import {
  isDiffContent,
  parseUnifiedDiff,
  formatDuration,
  type ParsedDiff,
} from "../../utils/chatHelpers.ts";

export interface ToolExecutionCardProps {
  toolCall: ToolCallState;
  className?: string;
  defaultExpanded?: boolean;
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({
  toolCall,
  className = "",
  defaultExpanded = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [showRawParams, setShowRawParams] = useState(false);
  const [copied, setCopied] = useState(false);

  const action = toolCall.action || {};
  const toolName =
    action.tool || action.action || action.name || "tool";
  const target =
    toolCall.result?.target ||
    action.path ||
    action.filePath ||
    action.file ||
    action.command ||
    action.cmd ||
    "";

  const status = toolCall.status;
  const result = toolCall.result;
  const rawOutput =
    result?.output ||
    result?.formatted ||
    result?.rawOutput ||
    (typeof result === "string" ? result : "");

  // Check if output or action contains unified diff
  const isDiff =
    toolName.includes("patch") ||
    toolName.includes("diff") ||
    isDiffContent(rawOutput) ||
    (typeof action.content === "string" && isDiffContent(action.content));

  const diffText = isDiffContent(rawOutput)
    ? rawOutput
    : typeof action.content === "string" && isDiffContent(action.content)
    ? action.content
    : rawOutput;

  const parsedDiff: ParsedDiff | null = isDiff ? parseUnifiedDiff(diffText) : null;
  const isCommand =
    toolName.includes("command") ||
    toolName.includes("terminal") ||
    toolName.includes("exec") ||
    toolName.includes("bash") ||
    toolName.includes("shell");

  const durationMs = result?.durationMs;

  const copyOutput = () => {
    if (!rawOutput) return;
    navigator.clipboard.writeText(rawOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Select tool icon
  const getToolIcon = () => {
    if (isCommand) return <Terminal className="w-4 h-4 text-emerald-400" />;
    if (toolName.includes("patch") || toolName.includes("edit"))
      return <FileCode className="w-4 h-4 text-sky-400" />;
    if (toolName.includes("read") || toolName.includes("write"))
      return <FileText className="w-4 h-4 text-amber-400" />;
    if (toolName.includes("search") || toolName.includes("grep") || toolName.includes("find"))
      return <Search className="w-4 h-4 text-indigo-400" />;
    return <Wrench className="w-4 h-4 text-cyan-400" />;
  };

  // Status Badge
  const renderStatusBadge = () => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
            <Loader2 className="w-3 h-3 animate-spin" />
            running
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            success
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3" />
            failed
          </span>
        );
      case "approval-required":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            pending approval
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
            {status}
          </span>
        );
    }
  };

  return (
    <div
      className={`rounded-lg border border-slate-800 bg-slate-900/60 text-slate-200 overflow-hidden shadow-sm transition-all ${className}`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 select-none">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 text-left flex-1 min-w-0 mr-2 group"
        >
          <div className="p-1 rounded bg-slate-800/80 border border-slate-700/50 group-hover:border-slate-600 transition-colors">
            {getToolIcon()}
          </div>
          <div className="flex items-center gap-2 min-w-0 truncate">
            <span className="font-mono text-xs font-semibold text-slate-200 tracking-tight">
              {toolName}
            </span>
            {target && (
              <span className="font-mono text-[11px] text-slate-400 truncate max-w-xs md:max-w-md bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
                {target}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {parsedDiff && (
            <div className="hidden sm:flex items-center gap-1 text-[11px] font-mono mr-1">
              <span className="text-emerald-400 font-medium">+{parsedDiff.addedCount}</span>
              <span className="text-rose-400 font-medium">-{parsedDiff.deletedCount}</span>
            </div>
          )}

          {durationMs !== undefined && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-slate-400 bg-slate-800/60 px-1.5 py-0.5 rounded border border-slate-700/40">
              <Clock className="w-3 h-3" />
              {formatDuration(durationMs)}
            </span>
          )}

          {renderStatusBadge()}

          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Toggle details"
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Card Content */}
      {isOpen && (
        <div className="p-3 space-y-3 bg-slate-950/40">
          {/* Quick Parameters View */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-medium">Action Details</span>
              <button
                type="button"
                onClick={() => setShowRawParams(!showRawParams)}
                className="hover:text-slate-200 underline decoration-slate-600 transition-colors"
              >
                {showRawParams ? "Hide Raw Params" : "View JSON"}
              </button>
            </div>

            {showRawParams ? (
              <pre className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-48">
                {JSON.stringify(action, null, 2)}
              </pre>
            ) : (
              <div className="grid grid-cols-1 gap-1 text-[11px] font-mono">
                {action.command && (
                  <div className="flex items-start gap-2 bg-slate-950/80 p-2 rounded border border-slate-800/80">
                    <span className="text-slate-500 select-none">$</span>
                    <span className="text-slate-200 break-all">{action.command}</span>
                  </div>
                )}
                {action.path && (
                  <div className="text-slate-400">
                    <span className="text-slate-500">path:</span> {action.path}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Diff Renderer if Diff Output */}
          {parsedDiff && parsedDiff.lines.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-sky-400" />
                  Unified Diff View
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-medium">+{parsedDiff.addedCount} lines</span>
                  <span className="text-rose-400 font-medium">-{parsedDiff.deletedCount} lines</span>
                  <button
                    type="button"
                    onClick={copyOutput}
                    className="p-1 hover:text-slate-200 transition-colors"
                    title="Copy diff"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-950 font-mono text-[11px] overflow-x-auto max-h-80 select-text divide-y divide-slate-900/50">
                {parsedDiff.lines.map((line, idx) => {
                  if (line.type === "header") {
                    return (
                      <div
                        key={idx}
                        className="px-3 py-0.5 text-slate-400 font-medium bg-slate-900/60"
                      >
                        {line.raw}
                      </div>
                    );
                  }
                  if (line.type === "hunk") {
                    return (
                      <div
                        key={idx}
                        className="px-3 py-1 text-sky-400/90 font-medium bg-sky-950/30"
                      >
                        {line.raw}
                      </div>
                    );
                  }
                  if (line.type === "add") {
                    return (
                      <div
                        key={idx}
                        className="flex items-stretch bg-emerald-950/35 text-emerald-200 border-l-2 border-emerald-500 hover:bg-emerald-950/50"
                      >
                        <span className="w-10 px-2 py-0.5 text-right select-none text-slate-600 bg-slate-950/30">
                          {line.newLineNumber ?? ""}
                        </span>
                        <span className="w-4 text-center select-none text-emerald-400 font-bold">
                          +
                        </span>
                        <span className="flex-1 px-1 py-0.5 whitespace-pre">
                          {line.content}
                        </span>
                      </div>
                    );
                  }
                  if (line.type === "delete") {
                    return (
                      <div
                        key={idx}
                        className="flex items-stretch bg-rose-950/35 text-rose-200 border-l-2 border-rose-500 hover:bg-rose-950/50"
                      >
                        <span className="w-10 px-2 py-0.5 text-right select-none text-slate-600 bg-slate-950/30">
                          {line.oldLineNumber ?? ""}
                        </span>
                        <span className="w-4 text-center select-none text-rose-400 font-bold">
                          -
                        </span>
                        <span className="flex-1 px-1 py-0.5 whitespace-pre">
                          {line.content}
                        </span>
                      </div>
                    );
                  }
                  // Context line
                  return (
                    <div
                      key={idx}
                      className="flex items-stretch text-slate-300 hover:bg-slate-900/40"
                    >
                      <span className="w-10 px-2 py-0.5 text-right select-none text-slate-600 bg-slate-950/20">
                        {line.newLineNumber ?? line.oldLineNumber ?? ""}
                      </span>
                      <span className="w-4 text-center select-none text-slate-600">
                        &nbsp;
                      </span>
                      <span className="flex-1 px-1 py-0.5 whitespace-pre">
                        {line.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isCommand ? (
            /* Terminal Window for Commands */
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Terminal Output
                </span>
                <button
                  type="button"
                  onClick={copyOutput}
                  className="p-1 hover:text-slate-200 transition-colors"
                  title="Copy output"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="rounded border border-slate-800 bg-black font-mono text-xs overflow-hidden shadow-inner">
                {/* Terminal titlebar */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  <span className="text-[10px] text-slate-400 ml-2 font-mono">
                    {action.command ? action.command.slice(0, 40) : "console"}
                  </span>
                </div>

                <div className="p-3 text-[11px] text-slate-200 overflow-x-auto max-h-72 select-text whitespace-pre-wrap leading-relaxed">
                  {rawOutput ? (
                    rawOutput
                  ) : status === "running" ? (
                    <span className="text-slate-500 italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Executing command in background...
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">No output produced.</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Standard Tool Output */
            rawOutput && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-medium text-slate-300">Execution Output</span>
                  <button
                    type="button"
                    onClick={copyOutput}
                    className="p-1 hover:text-slate-200 transition-colors"
                    title="Copy output"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto max-h-60 whitespace-pre-wrap select-text">
                  {rawOutput}
                </div>
              </div>
            )
          )}

          {/* Persisted File Reference (Zero Token Reference) */}
          {result?.persistedFile && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400 bg-cyan-950/20 border border-cyan-800/40 px-2.5 py-1.5 rounded">
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-slate-400">Persisted Artifact:</span>
              <span className="text-cyan-300 truncate">{result.persistedFile}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolExecutionCard;
