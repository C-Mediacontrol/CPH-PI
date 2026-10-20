import React from "react";
import { TurnProcessNodeView } from "./TurnProcessNodeView.tsx";

export interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
  durationMs?: number;
  defaultExpanded?: boolean;
  className?: string;
  status?: "running" | "completed" | "stopped" | "failed" | "error";
  turn?: number;
}

/**
 * Backward-compatible wrapper delegating to DeepSeek TurnProcessNodeView.
 */
export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
  reasoning,
  isStreaming = false,
  durationMs,
  defaultExpanded = false,
  className = "",
  status,
  turn,
}) => {
  return (
    <TurnProcessNodeView
      reasoning={reasoning}
      isStreaming={isStreaming}
      durationMs={durationMs}
      defaultExpanded={defaultExpanded}
      className={className}
      status={status}
      turn={turn}
    />
  );
};

export default ReasoningBlock;
