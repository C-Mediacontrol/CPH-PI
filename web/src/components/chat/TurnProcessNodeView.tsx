import React, { useState, useEffect, memo } from "react";
import { ChevronDown } from "lucide-react";
import { formatDuration } from "../../utils/chatHelpers.ts";

export interface TurnProcessNodeViewProps {
  reasoning?: string;
  content?: string;
  isStreaming?: boolean;
  durationMs?: number;
  status?: "running" | "completed" | "stopped" | "failed" | "error";
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  className?: string;
  turn?: number;
  messageCount?: number;
  toolCallCount?: number;
  subagentCount?: number;
}

/**
 * DeepSeek-Harness authentic TurnProcessNodeView.
 * Renders a 33px hairline header with tabular duration and collapsible reasoning stream.
 */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  reasoning,
  content,
  isStreaming = false,
  durationMs,
  status,
  defaultExpanded = false,
  isExpanded,
  onToggleExpand,
  className = "",
  turn,
  messageCount,
  toolCallCount,
  subagentCount,
}: TurnProcessNodeViewProps) {
  const displayReasoning = reasoning ?? content ?? "";
  const [internalOpen, setInternalOpen] = useState<boolean>(defaultExpanded || isStreaming);
  const isOpen = isExpanded !== undefined ? isExpanded : internalOpen;
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(durationMs || 0);

  // Auto-expand when streaming
  useEffect(() => {
    if (isStreaming) {
      setInternalOpen(true);
    }
  }, [isStreaming]);

  // Live elapsed counter
  useEffect(() => {
    if (!isStreaming) {
      if (durationMs !== undefined) {
        setLiveElapsedMs(durationMs);
      }
      return;
    }
    const start = Date.now() - (durationMs || 0);
    const interval = setInterval(() => {
      setLiveElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [isStreaming, durationMs]);

  const toggleOpen = () => {
    const next = !isOpen;
    if (onToggleExpand) {
      onToggleExpand(next);
    }
    setInternalOpen(next);
  };

  const isStopped = status === "stopped";
  const isFailed = status === "failed" || status === "error";

  const durationText = isStreaming
    ? formatDuration(liveElapsedMs)
    : durationMs !== undefined
    ? formatDuration(durationMs)
    : "0.0s";

  const announcement = isStopped
    ? "Stopped"
    : isFailed
    ? "Failed"
    : isStreaming
    ? "Thinking..."
    : `Thought for ${durationText}`;

  return (
    <div className={`w-full ${className}`}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      {/* 33px hairline header matching DeepSeek design */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        data-open={isOpen || undefined}
        data-turn-process={turn}
        data-turn-process-messages={messageCount}
        data-turn-process-tool-calls={toolCallCount}
        data-turn-process-subagents={subagentCount}
        className="w-full flex items-center justify-between h-[33px] min-h-[33px] px-0 py-0 border-b border-white/5 border-border-subtle/50 text-neutral-400 hover:text-neutral-200 transition-colors select-none text-left bg-transparent group cursor-pointer"
      >
        <div className="flex items-center gap-1.5 text-xs truncate">
          {isStopped ? (
            <span className="text-neutral-400">Stopped</span>
          ) : isFailed ? (
            <span className="text-rose-400">Failed</span>
          ) : isStreaming ? (
            <>
              <span className="text-neutral-400 group-hover:text-neutral-200 font-medium">
                Thinking...
              </span>
              <span className="font-tabular font-mono text-neutral-400 text-[11px] ml-1">
                {durationText}
              </span>
            </>
          ) : (
            <>
              <span className="text-neutral-400 group-hover:text-neutral-200">
                Thought for
              </span>
              <span className="font-tabular font-mono text-neutral-300 text-[11px]">
                {durationText}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center ml-2 shrink-0">
          <ChevronDown
            className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ease-out ${
              isOpen ? "transform rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {/* Collapsible reasoning body with clean dark styling */}
      {isOpen && (
        <div className="mt-2 pl-3 pr-2 py-2 text-xs font-mono text-neutral-300/90 whitespace-pre-wrap select-text leading-relaxed border-l border-white/10 bg-surface-card/40 rounded-r-lg max-h-96 overflow-y-auto">
          {displayReasoning || (
            <span className="italic text-neutral-500">
              {isStreaming ? "Thinking..." : "No reasoning recorded."}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default TurnProcessNodeView;
