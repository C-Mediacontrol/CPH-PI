import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  User,
  Copy,
  Check,
} from "lucide-react";
import type {
  AgentMessage,
  TurnState,
  ToolCallState,
  ApprovalRequest,
  QuestionRequest,
} from "../../types/protocol.ts";
import { ReasoningBlock } from "./ReasoningBlock.tsx";
import { ToolExecutionCard } from "./ToolExecutionCard.tsx";
import { HumanInteractionCard } from "../interaction/HumanInteractionCard.tsx";

export interface MessageStreamProps {
  messages: AgentMessage[];
  currentReasoning?: string;
  currentDelta?: string;
  turnState?: TurnState | null;
  toolCalls?: ToolCallState[];
  pendingApproval?: ApprovalRequest | null;
  pendingQuestion?: QuestionRequest | null;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string, reason?: string) => void;
  onAnswerQuestion?: (questionId: string, answers: Record<string, any>) => void;
  className?: string;
}

/**
 * Lightweight helper to render markdown code blocks and paragraphs cleanly
 */
const FormattedMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Split content by code blocks: ```lang\ncode```
  const parts = content.split(/(```[\s\S]*?```)/g);

  const copyCode = (code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="space-y-2 text-sm leading-relaxed select-text font-sans break-words">
      {parts.map((part, idx) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const match = part.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)```$/);
          const lang = match ? match[1] : "";
          const code = match ? match[2] : part.slice(3, -3);

          return (
            <div
              key={idx}
              className="my-2.5 rounded-lg border border-border-base bg-surface-panel overflow-hidden shadow-inner font-mono text-xs"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-surface-card border-b border-border-base select-none text-neutral-400">
                <span className="text-[11px] font-medium text-neutral-300">
                  {lang || "code"}
                </span>
                <button
                  type="button"
                  onClick={() => copyCode(code, idx)}
                  className="flex items-center gap-1 hover:text-neutral-200 transition-colors text-[11px] cursor-pointer"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 text-[11.5px] text-neutral-200 overflow-x-auto leading-relaxed">
                {code}
              </pre>
            </div>
          );
        }

        return (
          <div key={idx} className="whitespace-pre-wrap">
            {part}
          </div>
        );
      })}
    </div>
  );
};

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  currentReasoning,
  currentDelta,
  turnState,
  toolCalls = [],
  pendingApproval,
  pendingQuestion,
  onApprove,
  onReject,
  onAnswerQuestion,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll stick to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    messages,
    currentDelta,
    currentReasoning,
    toolCalls.length,
    pendingApproval,
    pendingQuestion,
  ]);

  const isStreaming = turnState?.status === "running";

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-5 scroll-smooth ${className}`}
    >
      {/* Empty State */}
      {messages.length === 0 && !currentDelta && !currentReasoning && toolCalls.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-neutral-500 py-16">
          <div className="p-3 rounded-2xl bg-deepseek-500/10 border border-deepseek-500/30 text-deepseek-400 mb-3 shadow-inner">
            <Bot className="w-8 h-8" />
          </div>
          <p className="text-sm font-semibold text-neutral-300">Ready for your prompt</p>
          <p className="text-xs text-neutral-500 mt-1 max-w-sm text-center">
            Ask questions, run bash commands, edit code, or launch multi-turn reasoning workflows.
          </p>
        </div>
      )}

      {/* Message History */}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${
            msg.role === "user"
              ? "justify-end"
              : msg.role === "system"
              ? "justify-center"
              : "justify-start"
          }`}
        >
          {msg.role === "assistant" && (
            <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-base flex items-center justify-center shrink-0 text-deepseek-400 mt-1 shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
          )}

          <div
            className={`max-w-[85%] md:max-w-[78%] rounded-2xl px-4 py-3 shadow-md space-y-2.5 ${
              msg.role === "user"
                ? "bg-deepseek-500 text-white rounded-br-none shadow-deepseek-900/30"
                : msg.role === "system"
                ? "bg-surface-panel text-neutral-400 border border-border-base text-xs text-center"
                : "bg-surface-card border border-border-base text-neutral-200 rounded-bl-none"
            }`}
          >
            {/* Embedded Reasoning Block if this message has reasoning */}
            {msg.reasoning && (
              <ReasoningBlock
                reasoning={msg.reasoning}
                isStreaming={false}
                defaultExpanded={false}
                turn={msg.turn}
              />
            )}

            {/* Message Body */}
            {msg.role === "user" ? (
              <div className="whitespace-pre-wrap font-sans text-sm">{msg.content}</div>
            ) : (
              <FormattedMarkdown content={msg.content} />
            )}

            {/* Metadata Footer */}
            {msg.turn !== undefined && (
              <div className="text-[10px] font-mono text-neutral-500 text-right pt-0.5">
                Turn #{msg.turn}
              </div>
            )}
          </div>

          {msg.role === "user" && (
            <div className="w-7 h-7 rounded-lg bg-deepseek-500 flex items-center justify-center shrink-0 text-white mt-1 shadow shadow-deepseek-900/40">
              <User className="w-4 h-4" />
            </div>
          )}
        </div>
      ))}

      {/* Streaming Reasoning Block */}
      {currentReasoning && (
        <div className="flex gap-3 justify-start">
          <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-base flex items-center justify-center shrink-0 text-deepseek-400 mt-1 shadow-sm">
            <Bot className="w-4 h-4 animate-pulse" />
          </div>
          <div className="max-w-[85%] md:max-w-[78%] w-full bg-surface-card border border-border-base rounded-2xl p-3 shadow-md">
            <ReasoningBlock
              reasoning={currentReasoning}
              isStreaming={isStreaming}
              defaultExpanded={true}
            />
          </div>
        </div>
      )}

      {/* Streaming Delta Content */}
      {currentDelta && (
        <div className="flex gap-3 justify-start">
          <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-base flex items-center justify-center shrink-0 text-deepseek-400 mt-1 shadow-sm">
            <Bot className="w-4 h-4 animate-pulse" />
          </div>
          <div className="max-w-[85%] md:max-w-[78%] rounded-2xl px-4 py-3 bg-surface-card border border-border-base text-neutral-100 rounded-bl-none shadow-md">
            <FormattedMarkdown content={currentDelta} />
            <span className="inline-block w-2 h-4 bg-deepseek-400 ml-1.5 animate-pulse align-middle" />
          </div>
        </div>
      )}

      {/* Active & Recent Tool Calls */}
      {toolCalls.length > 0 && (
        <div className="space-y-2 pt-1 max-w-[85%] md:max-w-[78%] ml-10">
          {toolCalls.map((tc) => (
            <ToolExecutionCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* Human Interaction Gate Card (Approval / Inquiries) */}
      {(pendingApproval || pendingQuestion) && (
        <div className="max-w-[85%] md:max-w-[78%] ml-10 pt-2 animate-in fade-in slide-in-from-bottom-2">
          <HumanInteractionCard
            pendingApproval={pendingApproval}
            pendingQuestion={pendingQuestion}
            onApprove={onApprove}
            onReject={onReject}
            onAnswerQuestion={onAnswerQuestion}
          />
        </div>
      )}

      {/* Stick-to-bottom sentinel */}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
};

export default MessageStream;
