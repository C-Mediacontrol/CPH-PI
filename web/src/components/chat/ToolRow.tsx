import React, { useState } from "react";
import {
  Wrench,
  Terminal,
  FileCode,
  FileText,
  Search,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { ExitCodeBadge } from "./ExitCodeBadge.tsx";
import {
  isDiffContent,
  parseUnifiedDiff,
  type ParsedDiff,
} from "../../utils/chatHelpers.ts";

export interface ToolRowDiffStat {
  added: number;
  removed: number;
}

export interface ToolRowTerminal {
  command?: string;
  output?: string;
  exitCode?: number | string | null;
  running?: boolean;
}

export interface ToolRowProps {
  toolName?: string;
  target?: string;
  icon?: React.ReactNode;
  summary?: string;
  filePath?: string;
  command?: string;
  diffStat?: ToolRowDiffStat | null;
  diff?: string | ParsedDiff | null;
  terminal?: ToolRowTerminal | null;
  exitCode?: number | string | null;
  inputRaw?: any;
  output?: string | null;
  state?: string;
  isExpanded?: boolean;
  defaultExpanded?: boolean;
  onToggleExpand?: () => void;
  onOpenFile?: (path: string) => void;
  persistedFile?: string | null;
  className?: string;
  children?: React.ReactNode;
}

/**
 * DeepSeek-Harness Official 24px ToolRow Component
 *
 * Implements the official Figma 122:9479 24px single-line collapsed specification:
 * [16px leading icon] [tool name] [2x2 dot] [dotted underline path/command] [+add -del tabular] [rotating chevron]
 * Collapsible expanded view supporting Unified Diff, Terminal Box, or generic IO Card.
 */
export const ToolRow: React.FC<ToolRowProps> = ({
  toolName = "tool",
  target = "",
  icon,
  filePath,
  command,
  diffStat,
  diff,
  terminal,
  exitCode,
  inputRaw,
  output,
  state = "completed",
  isExpanded,
  defaultExpanded = false,
  onToggleExpand,
  onOpenFile,
  persistedFile,
  className = "",
  children,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const open = isExpanded !== undefined ? isExpanded : internalExpanded;

  const toggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded(!open);
    }
  };

  const copyText = (text?: string | null) => {
    if (!text) return;
    try {
      navigator.clipboard?.writeText?.(text);
    } catch {
      // safe fallback
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isCommand =
    Boolean(terminal || command) ||
    toolName.includes("command") ||
    toolName.includes("terminal") ||
    toolName.includes("exec") ||
    toolName.includes("bash") ||
    toolName.includes("shell");

  const effectiveTarget = target || filePath || command || "";

  // Parse diff if provided as string or object
  const parsedDiff: ParsedDiff | null = (() => {
    if (!diff) return null;
    if (typeof diff === "object" && "lines" in diff) {
      return diff as ParsedDiff;
    }
    if (typeof diff === "string" && (isDiffContent(diff) || diff.includes("@@"))) {
      return parseUnifiedDiff(diff);
    }
    return null;
  })();

  // Calculate effective diffStat
  const effectiveDiffStat: ToolRowDiffStat | null =
    diffStat ||
    (parsedDiff && (parsedDiff.addedCount > 0 || parsedDiff.deletedCount > 0)
      ? { added: parsedDiff.addedCount, removed: parsedDiff.deletedCount }
      : null);

  const defaultIcon = (() => {
    if (isCommand) return <Terminal className="w-3.5 h-3.5 text-emerald-400" />;
    if (toolName.includes("patch") || toolName.includes("edit") || toolName.includes("diff"))
      return <FileCode className="w-3.5 h-3.5 text-sky-400" />;
    if (toolName.includes("read") || toolName.includes("write"))
      return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    if (toolName.includes("search") || toolName.includes("grep") || toolName.includes("find"))
      return <Search className="w-3.5 h-3.5 text-indigo-400" />;
    return <Wrench className="w-3.5 h-3.5 text-cyan-400" />;
  })();

  const effectiveIcon = icon || defaultIcon;

  // Format JSON input if object
  const formattedInput = (() => {
    if (!inputRaw) return null;
    if (typeof inputRaw === "string") return inputRaw;
    try {
      return JSON.stringify(inputRaw, null, 2);
    } catch {
      return String(inputRaw);
    }
  })();

  const terminalCmd = terminal?.command || command || effectiveTarget;
  const terminalOut = terminal?.output !== undefined ? terminal.output : output;
  const terminalExit = terminal?.exitCode !== undefined ? terminal.exitCode : exitCode;
  const isRunning = state === "running" || terminal?.running;

  const handleTargetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenFile && (filePath || effectiveTarget)) {
      onOpenFile(filePath || effectiveTarget);
    }
  };

  return (
    <div
      className={`rounded-lg border border-neutral-800 bg-[#151517] text-neutral-200 overflow-hidden transition-all text-xs ${className}`}
      data-testid="tool-row"
      data-tool={toolName}
      data-state={state}
    >
      {/* 24px Single Line Header (Figma 122:9479 Spec) */}
      <div
        className="h-6 min-h-[24px] flex items-center text-xs select-none cursor-pointer group hover:bg-[#232326] px-2.5 transition-colors"
        onClick={toggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpand();
          }
        }}
      >
        {/* Tool Icon (14-16px) */}
        <span className="flex-none mr-2 flex items-center justify-center transition-colors">
          {effectiveIcon}
        </span>

        {/* Tool Name */}
        <span className="font-mono text-xs font-medium text-neutral-200 flex-none tracking-tight">
          {toolName}
        </span>

        {/* 2x2 Dot Separator and Target */}
        {effectiveTarget && (
          <>
            <span
              className="w-1 h-1 rounded-full bg-neutral-600 mx-2 flex-none"
              aria-hidden="true"
            />
            {/* Target Path / Command with dotted underline */}
            <span
              className="fileLink underline decoration-dotted underline-offset-4 cursor-pointer text-neutral-300 hover:text-white truncate max-w-[280px] font-mono text-[11px]"
              title={effectiveTarget}
              onClick={handleTargetClick}
            >
              {effectiveTarget}
            </span>
          </>
        )}

        {/* ExitCodeBadge in Header if present */}
        {terminalExit !== undefined && terminalExit !== null && (
          <span className="ml-2 flex-none">
            <ExitCodeBadge exitCode={terminalExit} />
          </span>
        )}

        {/* Tabular monospace Diff totals */}
        {effectiveDiffStat && (effectiveDiffStat.added > 0 || effectiveDiffStat.removed > 0) && (
          <span className="diffStat font-mono text-[11px] font-tabular ml-2 flex-none select-none">
            <span className="text-emerald-400">+{effectiveDiffStat.added}</span>{" "}
            <span className="text-rose-400">-{effectiveDiffStat.removed}</span>
          </span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Expand/Collapse Chevron rotating 180° when expanded */}
        <span
          className={`text-neutral-500 group-hover:text-neutral-300 transition-transform duration-200 p-0.5 ml-1.5 flex-none transform ${
            open ? "rotate-180" : "rotate-0"
          }`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </span>
      </div>

      {/* Collapsible Expanded Body */}
      {open && (
        <div className="p-2.5 pt-1.5 bg-[#0f1115]/80 border-t border-neutral-800/80 space-y-2">
          {/* Custom children if provided */}
          {children}

          {/* 1. Unified Diff Line-by-Line View */}
          {parsedDiff && parsedDiff.lines.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5 text-sky-400" />
                  Unified Diff View
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-medium">+{parsedDiff.addedCount}</span>
                  <span className="text-rose-400 font-medium">-{parsedDiff.deletedCount}</span>
                  <button
                    type="button"
                    onClick={() => copyText(typeof diff === "string" ? diff : output)}
                    className="p-1 hover:text-white transition-colors"
                    title="Copy diff"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="rounded border border-neutral-800 bg-[#0f1115] font-mono text-[11px] overflow-x-auto max-h-80 select-text divide-y divide-neutral-900/60 my-1">
                {parsedDiff.lines.map((line, idx) => {
                  if (line.type === "header") {
                    return (
                      <div
                        key={idx}
                        className="px-3 py-0.5 text-neutral-400 font-medium bg-neutral-900/60"
                      >
                        {line.raw}
                      </div>
                    );
                  }
                  if (line.type === "hunk") {
                    return (
                      <div
                        key={idx}
                        className="px-3 py-1 bg-slate-900 text-blue-400 font-mono text-xs font-medium"
                      >
                        {line.raw}
                      </div>
                    );
                  }
                  if (line.type === "add") {
                    return (
                      <div
                        key={idx}
                        className="flex items-stretch bg-emerald-950/30 text-emerald-300 border-l-2 border-emerald-500 hover:bg-emerald-950/40"
                      >
                        <span className="w-10 px-2 py-0.5 text-right select-none text-neutral-500 bg-neutral-950/40">
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
                        className="flex items-stretch bg-rose-950/30 text-rose-300 border-l-2 border-rose-500 hover:bg-rose-950/40"
                      >
                        <span className="w-10 px-2 py-0.5 text-right select-none text-neutral-500 bg-neutral-950/40">
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
                  return (
                    <div
                      key={idx}
                      className="flex items-stretch text-neutral-300 hover:bg-neutral-900/30"
                    >
                      <span className="w-10 px-2 py-0.5 text-right select-none text-neutral-600 bg-neutral-950/20">
                        {line.newLineNumber ?? line.oldLineNumber ?? ""}
                      </span>
                      <span className="w-4 text-center select-none text-neutral-600">
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
          )}

          {/* 2. Terminal View for Commands */}
          {!parsedDiff && (isCommand || terminal) && (
            <div className="space-y-1">
              <div className="rounded border border-neutral-800 bg-black font-mono text-xs overflow-hidden shadow-inner my-1">
                {/* Terminal Header */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#151517] border-b border-neutral-800">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                    <span className="text-[10px] text-neutral-400 ml-2 font-mono truncate max-w-sm">
                      {terminalCmd || "console"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {terminalExit !== undefined && terminalExit !== null && (
                      <ExitCodeBadge exitCode={terminalExit} />
                    )}
                    <button
                      type="button"
                      onClick={() => copyText(terminalOut)}
                      className="p-1 hover:text-white text-neutral-400 transition-colors"
                      title="Copy output"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Terminal Monospace Output */}
                <div className="p-3 text-[11px] text-neutral-200 overflow-x-auto max-h-72 select-text whitespace-pre-wrap leading-relaxed">
                  {terminalOut ? (
                    terminalOut
                  ) : isRunning ? (
                    <span className="text-neutral-500 italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Executing command in background...
                    </span>
                  ) : (
                    <span className="text-neutral-500 italic">No output produced.</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. Generic Tool Input/Output Card */}
          {!parsedDiff && !isCommand && !terminal && (formattedInput || output) && (
            <div className="rounded border border-neutral-800 bg-[#151517] font-mono text-[11px] overflow-hidden my-1">
              {formattedInput && (
                <div className="p-2.5 border-b border-neutral-800/80">
                  <div className="flex items-center justify-between text-neutral-400 text-[10px] uppercase tracking-wider mb-1 font-semibold">
                    <span>Input</span>
                    <button
                      type="button"
                      onClick={() => copyText(formattedInput)}
                      className="p-0.5 hover:text-white transition-colors"
                      title="Copy input"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <pre className="text-neutral-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {formattedInput}
                  </pre>
                </div>
              )}

              {output && (
                <div className="p-2.5 bg-[#0f1115]">
                  <div className="flex items-center justify-between text-neutral-400 text-[10px] uppercase tracking-wider mb-1 font-semibold">
                    <span>Output</span>
                    <button
                      type="button"
                      onClick={() => copyText(output)}
                      className="p-0.5 hover:text-white transition-colors"
                      title="Copy output"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <pre className="text-neutral-200 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                    {output}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Persisted File Artifact Badge */}
          {persistedFile && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400 bg-cyan-950/20 border border-cyan-800/40 px-2.5 py-1.5 rounded my-1">
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-neutral-400">Persisted Artifact:</span>
              <span className="text-cyan-300 truncate">{persistedFile}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolRow;
