import React, { useState, useMemo } from "react";
import { HelpCircle, Send } from "lucide-react";

export interface QuestionItemModel {
  id?: string;
  question: string;
  options?: string[];
  isMultiSelect?: boolean;
}

export interface AskQuestionCardProps {
  questionId?: string;
  question?: string;
  options?: string[];
  isMultiSelect?: boolean;
  questions?: QuestionItemModel[];
  onSubmit?: (answers: Record<string, any>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
  initialAnswers?: Record<string, any>;
  submitLabel?: string;
}

/**
 * DeepSeek-Harness AskQuestionCard.
 * Renders question prompt, capsule option pills, write-in field, and DeepSeek blue submit button.
 */
export const AskQuestionCard: React.FC<AskQuestionCardProps> = ({
  questionId,
  question,
  options,
  isMultiSelect,
  questions,
  onSubmit,
  onCancel,
  disabled = false,
  className = "",
  initialAnswers,
  submitLabel = "Submit",
}) => {
  // Normalize single question shortcut into items list
  const normalizedQuestions: QuestionItemModel[] = useMemo(() => {
    if (questions && questions.length > 0) {
      return questions;
    }
    if (question) {
      return [
        {
          id: questionId || "q_0",
          question,
          options: options || [],
          isMultiSelect: !!isMultiSelect,
        },
      ];
    }
    return [];
  }, [questions, question, options, isMultiSelect, questionId]);

  // Initialize selected values and write-ins from initialAnswers
  const [selectedMap, setSelectedMap] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    normalizedQuestions.forEach((q, idx) => {
      const key = `q_${idx}`;
      const qKey = q.question;
      const initial = initialAnswers?.[qKey] || initialAnswers?.[key];
      if (initial && initial.selected !== undefined) {
        init[key] = initial.selected;
      } else if (Array.isArray(initial)) {
        init[key] = initial;
      } else if (typeof initial === "string") {
        init[key] = initial;
      }
    });
    return init;
  });

  const [writeIns, setWriteIns] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    normalizedQuestions.forEach((q, idx) => {
      const key = `q_${idx}`;
      const qKey = q.question;
      const initial = initialAnswers?.[qKey] || initialAnswers?.[key];
      if (initial && typeof initial.writeIn === "string") {
        init[key] = initial.writeIn;
      }
    });
    return init;
  });

  const handleOptionClick = (qIndex: number, opt: string, multi?: boolean) => {
    if (disabled) return;
    const key = `q_${qIndex}`;
    setSelectedMap((prev) => {
      if (multi) {
        const list: string[] = Array.isArray(prev[key]) ? prev[key] : [];
        const exists = list.includes(opt);
        const next = exists ? list.filter((item) => item !== opt) : [...list, opt];
        return { ...prev, [key]: next };
      } else {
        return { ...prev, [key]: opt };
      }
    });
  };

  const handleWriteInChange = (qIndex: number, text: string) => {
    if (disabled) return;
    setWriteIns((prev) => ({ ...prev, [`q_${qIndex}`]: text }));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (disabled) return;

    const result: Record<string, any> = {};
    normalizedQuestions.forEach((q, idx) => {
      const key = `q_${idx}`;
      const qKey = q.question || q.id || `question_${idx}`;
      result[qKey] = {
        selected: selectedMap[key] ?? null,
        writeIn: writeIns[key]?.trim() || null,
      };
    });

    if (onSubmit) {
      onSubmit(result);
    }
  };

  if (normalizedQuestions.length === 0) {
    return null;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-xl border border-border-base bg-surface-card p-4 flex flex-col gap-3 shadow-xl ${className}`}
    >
      {/* Questions list */}
      <div className="flex flex-col gap-4">
        {normalizedQuestions.map((qItem, idx) => {
          const key = `q_${idx}`;
          const currentSelected = selectedMap[key];
          const isMulti = !!qItem.isMultiSelect;

          return (
            <div key={qItem.id || idx} className="flex flex-col gap-2.5">
              {/* Question Text */}
              <div className="flex items-start gap-2 text-xs font-medium text-neutral-200">
                <span className="text-deepseek-400 font-bold select-none">
                  {normalizedQuestions.length > 1 ? `${idx + 1}.` : "Q:"}
                </span>
                <span className="leading-relaxed whitespace-pre-wrap">{qItem.question}</span>
              </div>

              {/* Capsule Pill Options */}
              {qItem.options && qItem.options.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-4">
                  {qItem.options.map((opt, optIdx) => {
                    const isSelected = isMulti
                      ? Array.isArray(currentSelected) && currentSelected.includes(opt)
                      : currentSelected === opt;

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleOptionClick(idx, opt, isMulti)}
                        disabled={disabled}
                        className={`rounded-full px-3.5 py-1.5 text-xs border border-border-base transition-colors flex items-center gap-1.5 cursor-pointer select-none ${
                          isSelected
                            ? "bg-deepseek-500/20 border-deepseek-500 text-deepseek-400 font-medium"
                            : "bg-surface-card text-neutral-300 hover:border-neutral-500 hover:text-white"
                        }`}
                      >
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Write-in Input Box */}
              <div className="pl-4 pt-0.5">
                <input
                  type="text"
                  value={writeIns[key] || ""}
                  onChange={(e) => handleWriteInChange(idx, e.target.value)}
                  placeholder="Custom write-in / additional notes (optional)..."
                  disabled={disabled}
                  className="w-full rounded-lg bg-surface-panel border border-border-base px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-deepseek-500 focus:outline-none transition-colors"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-2.5 pt-1 border-t border-border-base/50">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="text-xs text-neutral-400 hover:text-neutral-200 px-3 py-1.5 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={disabled}
          className="bg-deepseek-500 hover:bg-deepseek-400 active:scale-95 text-white rounded-lg px-4 py-1.5 text-xs font-medium transition-all shadow-md shadow-deepseek-900/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{submitLabel}</span>
        </button>
      </div>
    </form>
  );
};

export default AskQuestionCard;
