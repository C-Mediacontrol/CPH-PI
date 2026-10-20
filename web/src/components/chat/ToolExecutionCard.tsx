import React from "react";
import type { ToolCallState } from "../../types/protocol.ts";
import { isDiffContent, parseUnifiedDiff } from "../../utils/chatHelpers.ts";
import { ToolRow } from "./ToolRow.tsx";

export interface ToolExecutionCardProps {
  toolCall: ToolCallState;
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * Adapter component bridging ToolCallState to the DeepSeek 24px ToolRow.
 */
export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({
  toolCall,
  className = "",
  defaultExpanded = true,
}) => {
  const action = toolCall.action || {};
  const toolName = action.tool || action.action || action.name || "tool";
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

  const command = action.command || action.cmd;
  const filePath = action.path || action.filePath || action.file;

  const isCommand =
    Boolean(command) ||
    toolName.includes("command") ||
    toolName.includes("terminal") ||
    toolName.includes("exec") ||
    toolName.includes("bash") ||
    toolName.includes("shell");

  const isDiff =
    toolName.includes("patch") ||
    toolName.includes("diff") ||
    isDiffContent(rawOutput) ||
    (typeof action.content === "string" && isDiffContent(action.content));

  const diffText = isDiffContent(rawOutput)
    ? rawOutput
    : typeof action.content === "string" && isDiffContent(action.content)
    ? action.content
    : isDiff
    ? rawOutput
    : null;

  const parsedDiff = isDiff && diffText ? parseUnifiedDiff(diffText) : null;
  const diffStat = parsedDiff && (parsedDiff.addedCount > 0 || parsedDiff.deletedCount > 0)
    ? { added: parsedDiff.addedCount, removed: parsedDiff.deletedCount }
    : null;

  // Infer or use exitCode
  const exitCode =
    result?.exitCode !== undefined
      ? result.exitCode
      : isCommand
      ? status === "completed"
        ? 0
        : status === "failed"
        ? 1
        : undefined
      : undefined;

  const terminal = isCommand
    ? {
        command: command || target,
        output: rawOutput,
        exitCode,
        running: status === "running",
      }
    : null;

  return (
    <ToolRow
      toolName={toolName}
      target={target}
      command={command}
      filePath={filePath}
      diff={parsedDiff || diffText}
      diffStat={diffStat}
      terminal={terminal}
      exitCode={exitCode}
      inputRaw={action}
      output={rawOutput}
      state={status}
      persistedFile={result?.persistedFile}
      defaultExpanded={defaultExpanded}
      className={className}
    />
  );
};

export default ToolExecutionCard;
