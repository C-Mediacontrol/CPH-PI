import React, { useState, useEffect } from "react";
import { Sparkles, Brain, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { formatDuration } from "../../utils/chatHelpers.ts";

export interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
  durationMs?: number;
  defaultExpanded?: boolean;
  className?: string;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
  reasoning,
  isStreaming = false,
  durationMs,
  defaultExpanded = false,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(defaultExpanded || isStreaming);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(durationMs || 0);

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  // Live timer tick when streaming
  useEffect(() => {
    if (!isStreaming) return;
    const start = Date.now() - (durationMs || 0);
    const interval = setInterval(() => {
      setLiveElapsedMs(Date.now() - start);
    }, 200);
    return () => clearInterval(interval);
  }, [isStreaming, durationMs]);

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  const displayDuration = isStreaming
    ? formatDuration(liveElapsedMs)
    : durationMs
    ? formatDuration(durationMs)
    : null;

  return (
    <div
      className={`rounded-lg border border-purple-800/40 bg-purple-950/20 text-purple-200 text-xs transition-all duration-200 ${className}`}
    >
      {/* Header bar */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-left select-none hover:bg-purple-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <div className="relative flex items-center justify-center">
              <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-purple-400 opacity-60" />
              <Brain className="w-4 h-4 text-purple-400 relative z-10 animate-pulse" />
            </div>
          ) : (
            <Brain className="w-4 h-4 text-purple-400" />
          )}

          <span className="font-medium tracking-wide text-purple-300">
            {isStreaming ? "Deep Thinking / Reasoning..." : "Deep Thinking / Reasoning"}
          </span>

          {isStreaming && (
            <span className="relative flex h-2 w-2 ml-0.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 text-purple-400/80">
          {displayDuration && (
            <span className="flex items-center gap-1 font-mono text-[11px] bg-purple-900/50 px-2 py-0.5 rounded border border-purple-700/40">
              <Clock className="w-3 h-3 text-purple-400" />
              {displayDuration}
            </span>
          )}
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-purple-400 transition-transform duration-200" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-purple-400 transition-transform duration-200" />
          )}
        </div>
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="px-3.5 pb-3 pt-1 border-t border-purple-800/30">
          {reasoning ? (
            <div className="font-mono text-[11.5px] leading-relaxed text-purple-200/90 whitespace-pre-wrap select-text max-h-96 overflow-y-auto pr-1">
              {reasoning}
            </div>
          ) : (
            <div className="italic text-purple-400/60 font-mono text-xs py-1">
              {isStreaming ? "Analyzing workspace context..." : "No reasoning recorded."}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningBlock;
