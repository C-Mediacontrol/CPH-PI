import React, { useState } from "react";
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  Terminal,
  FileCode,
} from "lucide-react";
import type { ApprovalRequest, QuestionRequest } from "../../types/protocol.ts";
import { AskQuestionCard } from "./AskQuestionCard.tsx";

export interface HumanInteractionCardProps {
  pendingApproval?: ApprovalRequest | null;
  pendingQuestion?: QuestionRequest | null;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string, reason?: string) => void;
  onAnswerQuestion?: (questionId: string, answers: Record<string, any>) => void;
  className?: string;
}

export const HumanInteractionCard: React.FC<HumanInteractionCardProps> = ({
  pendingApproval,
  pendingQuestion,
  onApprove,
  onReject,
  onAnswerQuestion,
  className = "",
}) => {
  // Reject reason state
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  if (!pendingApproval && !pendingQuestion) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Tool Approval Gate styled with DeepSeek surface cards */}
      {pendingApproval && (
        <div className="rounded-xl border border-border-base bg-surface-card p-4 shadow-xl text-neutral-200">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-amber-300 text-sm tracking-wide">
                  Human Approval Required
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-panel text-amber-300 border border-border-base">
                  {pendingApproval.action.tool || pendingApproval.action.action || "tool"}
                </span>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed">
                The agent is requesting permission to execute an action on your system. Review the parameters carefully before proceeding.
              </p>

              {/* Action Preview */}
              <div className="rounded-lg bg-surface-panel border border-border-base p-3 font-mono text-xs space-y-1.5 overflow-x-auto">
                {pendingApproval.action.command && (
                  <div className="flex items-start gap-2 text-neutral-200">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-emerald-400 select-none">$</span>
                    <span className="break-all">{pendingApproval.action.command}</span>
                  </div>
                )}
                {pendingApproval.action.path && (
                  <div className="flex items-start gap-2 text-neutral-300">
                    <FileCode className="w-3.5 h-3.5 text-deepseek-400 mt-0.5 shrink-0" />
                    <span className="text-neutral-500">Path:</span>
                    <span className="break-all">{pendingApproval.action.path}</span>
                  </div>
                )}
                {!pendingApproval.action.command && !pendingApproval.action.path && (
                  <pre className="text-neutral-300 text-[11px]">
                    {JSON.stringify(pendingApproval.action, null, 2)}
                  </pre>
                )}
              </div>

              {/* Reject Reason input if triggered */}
              {isRejecting && (
                <div className="pt-1">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter rejection reason or guidance for the agent..."
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-panel border border-rose-500/40 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    autoFocus
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onApprove?.(pendingApproval.approvalId)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow transition-colors cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Approve Execution
                </button>

                {isRejecting ? (
                  <button
                    type="button"
                    onClick={() => {
                      onReject?.(pendingApproval.approvalId, rejectReason.trim() || undefined);
                      setIsRejecting(false);
                      setRejectReason("");
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Confirm Rejection
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsRejecting(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-surface-hover hover:bg-rose-950/60 hover:text-rose-300 border border-border-base text-neutral-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    Reject
                  </button>
                )}

                {isRejecting && (
                  <button
                    type="button"
                    onClick={() => setIsRejecting(false)}
                    className="text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. AskQuestionCard Delegation */}
      {pendingQuestion && (
        <AskQuestionCard
          questionId={pendingQuestion.questionId}
          questions={pendingQuestion.questions}
          onSubmit={(answers) => onAnswerQuestion?.(pendingQuestion.questionId, answers)}
        />
      )}
    </div>
  );
};

export default HumanInteractionCard;
