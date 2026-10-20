import React, { useState } from "react";
import {
  ShieldAlert,
  HelpCircle,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Send,
  Terminal,
  FileCode,
  CornerDownRight,
} from "lucide-react";
import type { ApprovalRequest, QuestionRequest } from "../../types/protocol.ts";

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

  // Question answers state: { [qIndex]: string | string[] }
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, any>>({});
  const [writeIns, setWriteIns] = useState<Record<string, string>>({});

  if (!pendingApproval && !pendingQuestion) {
    return null;
  }

  // Handle single / multi select for question items
  const handleOptionToggle = (
    qIndex: number,
    option: string,
    isMultiSelect?: boolean
  ) => {
    const key = `q_${qIndex}`;
    setQuestionAnswers((prev) => {
      if (isMultiSelect) {
        const currentList: string[] = Array.isArray(prev[key]) ? prev[key] : [];
        const exists = currentList.includes(option);
        const updated = exists
          ? currentList.filter((item) => item !== option)
          : [...currentList, option];
        return { ...prev, [key]: updated };
      } else {
        return { ...prev, [key]: option };
      }
    });
  };

  const handleWriteInChange = (qIndex: number, text: string) => {
    setWriteIns((prev) => ({ ...prev, [`q_${qIndex}`]: text }));
  };

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingQuestion || !onAnswerQuestion) return;

    // Combine option answers and write-ins
    const finalAnswers: Record<string, any> = {};
    (pendingQuestion.questions || []).forEach((q, idx) => {
      const key = `q_${idx}`;
      const selected = questionAnswers[key];
      const writeIn = writeIns[key]?.trim();

      finalAnswers[q.question || `question_${idx}`] = {
        selected: selected !== undefined ? selected : null,
        writeIn: writeIn || null,
      };
    });

    onAnswerQuestion(pendingQuestion.questionId, finalAnswers);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Tool Approval Gate */}
      {pendingApproval && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 backdrop-blur-sm p-4 shadow-lg text-slate-100">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 flex-shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-amber-300 text-sm tracking-wide">
                  Human Approval Required
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {pendingApproval.action.tool || pendingApproval.action.action || "tool"}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                The agent is requesting permission to execute an action on your system. Review the parameters carefully before proceeding.
              </p>

              {/* Action Preview */}
              <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 font-mono text-xs space-y-1.5 overflow-x-auto">
                {pendingApproval.action.command && (
                  <div className="flex items-start gap-2 text-slate-200">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-emerald-400 select-none">$</span>
                    <span className="break-all">{pendingApproval.action.command}</span>
                  </div>
                )}
                {pendingApproval.action.path && (
                  <div className="flex items-start gap-2 text-slate-300">
                    <FileCode className="w-3.5 h-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                    <span className="text-slate-500">Path:</span>
                    <span className="break-all">{pendingApproval.action.path}</span>
                  </div>
                )}
                {!pendingApproval.action.command && !pendingApproval.action.path && (
                  <pre className="text-slate-300 text-[11px]">
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
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-rose-500/40 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    autoFocus
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onApprove?.(pendingApproval.approvalId)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow transition-colors"
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
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Confirm Rejection
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsRejecting(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 border border-slate-700 hover:border-rose-800 text-slate-300 text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    Reject
                  </button>
                )}

                {isRejecting && (
                  <button
                    type="button"
                    onClick={() => setIsRejecting(false)}
                    className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. ask_question Card */}
      {pendingQuestion && (
        <form
          onSubmit={submitQuestion}
          className="rounded-xl border border-sky-500/40 bg-sky-950/20 backdrop-blur-sm p-4 shadow-lg text-slate-100 space-y-4"
        >
          <div className="flex items-center gap-2.5 text-sky-300">
            <div className="p-1.5 rounded-lg bg-sky-500/20 border border-sky-500/30 text-sky-400">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <span className="font-semibold text-sm">Agent Inquiries</span>
              <p className="text-xs text-sky-200/70">
                Please provide input or select choices to guide next steps.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {(pendingQuestion.questions || []).map((q, idx) => {
              const key = `q_${idx}`;
              const selectedValue = questionAnswers[key];
              const isMulti = !!q.isMultiSelect;

              return (
                <div
                  key={idx}
                  className="rounded-lg bg-slate-900/80 border border-slate-800 p-3.5 space-y-2.5"
                >
                  <div className="text-xs font-medium text-slate-200 flex items-start gap-2">
                    <span className="text-sky-400 font-bold">{idx + 1}.</span>
                    <span>{q.question}</span>
                  </div>

                  {/* Options */}
                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5 pl-4">
                      {q.options.map((opt, optIdx) => {
                        const isChecked = isMulti
                          ? Array.isArray(selectedValue) && selectedValue.includes(opt)
                          : selectedValue === opt;

                        return (
                          <label
                            key={optIdx}
                            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer border transition-colors ${
                              isChecked
                                ? "bg-sky-500/15 border-sky-500/40 text-sky-200 font-medium"
                                : "bg-slate-950/40 border-slate-800/80 text-slate-300 hover:bg-slate-800/50"
                            }`}
                          >
                            <input
                              type={isMulti ? "checkbox" : "radio"}
                              name={`question_${idx}`}
                              checked={isChecked}
                              onChange={() => handleOptionToggle(idx, opt, isMulti)}
                              className="accent-sky-500 rounded"
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Write-in Response Box */}
                  <div className="pl-4 pt-1">
                    <input
                      type="text"
                      value={writeIns[key] || ""}
                      onChange={(e) => handleWriteInChange(idx, e.target.value)}
                      placeholder="Custom / additional notes (optional)..."
                      className="w-full px-3 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-md transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              Submit Answers
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default HumanInteractionCard;
