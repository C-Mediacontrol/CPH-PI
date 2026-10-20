import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Square,
  Command,
  AlertOctagon,
} from "lucide-react";
import {
  filterSlashCommands,
  DEFAULT_SLASH_COMMANDS,
  type SlashCommandItem,
} from "../../utils/chatHelpers.ts";

export interface ActionDockProps {
  onSend: (text: string) => void;
  onInterrupt?: (abort?: boolean) => void;
  isRunning?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export const ActionDock: React.FC<ActionDockProps> = ({
  onSend,
  onInterrupt,
  isRunning = false,
  disabled = false,
  placeholder = "Message Copilot Agent... Type '/' for slash commands",
  className = "",
}) => {
  const [text, setText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // Compute filtered commands whenever text changes
  const filteredCommands: SlashCommandItem[] = text.startsWith("/")
    ? filterSlashCommands(text)
    : [];

  useEffect(() => {
    if (text.startsWith("/") && filteredCommands.length > 0) {
      setShowSuggestions(true);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  }, [text, filteredCommands.length]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 180);
    el.style.height = `${nextHeight}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isRunning) return;
    onSend(trimmed);
    setText("");
    setShowSuggestions(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, disabled, isRunning, onSend]);

  const selectSlashCommand = (cmd: SlashCommandItem) => {
    setText(`${cmd.command} `);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSlashCommand(filteredCommands[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Two-stage interrupt handler:
   * - Shift+Click: immediately triggers hard abort (abort = true)
   * - Double-Click within 350ms: triggers hard abort (abort = true)
   * - Single-Click: triggers soft interrupt (abort = false)
   */
  const handleInterruptClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!onInterrupt) return;

    if (e.shiftKey) {
      // Immediate hard abort on Shift+Click
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      setClickCount(0);
      onInterrupt(true);
      return;
    }

    if (clickCount === 1) {
      // Second click in quick succession -> Hard Abort
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      setClickCount(0);
      onInterrupt(true);
    } else {
      // First click -> wait to see if a second click arrives
      setClickCount(1);
      clickTimerRef.current = setTimeout(() => {
        onInterrupt(false); // Soft interrupt
        setClickCount(0);
      }, 350);
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      {/* Slash command suggestions menu */}
      {showSuggestions && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border-base bg-surface-panel/95 backdrop-blur-md shadow-2xl overflow-hidden z-30 max-h-64 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-400 bg-surface-base border-b border-border-base flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Command className="w-3.5 h-3.5 text-deepseek-400" />
              Slash Commands
            </span>
            <span className="text-neutral-500 text-[10px]">↑↓ to navigate · Enter to select</span>
          </div>
          <div className="p-1 divide-y divide-border-base/40">
            {filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.command}
                  type="button"
                  onClick={() => selectSlashCommand(cmd)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-deepseek-500/20 text-deepseek-300 border border-deepseek-500/40"
                      : "text-neutral-300 hover:bg-surface-hover border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold text-deepseek-400">
                      {cmd.command}
                    </span>
                    <span className="text-xs text-neutral-300">
                      {cmd.description}
                    </span>
                  </div>
                  {cmd.usage && (
                    <span className="text-[10px] font-mono text-neutral-500 hidden sm:inline">
                      {cmd.usage}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Input Dock */}
      <div className="relative rounded-2xl border border-border-base bg-surface-card/95 shadow-2xl focus-within:border-deepseek-500/60 focus-within:ring-1 focus-within:ring-deepseek-500/30 transition-all">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent px-4 pt-3.5 pb-12 text-sm text-neutral-100 placeholder-neutral-500 resize-none focus:outline-none max-h-48 font-sans leading-relaxed"
        />

        {/* Bottom Control Bar inside the Dock */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between select-none pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 pointer-events-auto">
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-panel border border-border-base font-mono text-[10px] text-neutral-400">
                Enter
              </kbd>
              <span>to send</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-panel border border-border-base font-mono text-[10px] text-neutral-400">
                Shift+Enter
              </kbd>
              <span>for newline</span>
            </span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {isRunning ? (
              /* Two-stage interrupt button */
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInterruptClick}
                  title="Click: soft interrupt | Double-Click / Shift+Click: hard abort"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-950/50 transition-all active:scale-95 animate-pulse cursor-pointer"
                >
                  {clickCount === 1 ? (
                    <>
                      <AlertOctagon className="w-3.5 h-3.5" />
                      <span>Hard Abort?</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              /* Send Prompt Button with DeepSeek Blue */
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || !text.trim()}
                className={`flex items-center justify-center p-2.5 rounded-xl text-white transition-all cursor-pointer ${
                  !text.trim() || disabled
                    ? "bg-surface-panel text-neutral-500 border border-border-base cursor-not-allowed"
                    : "bg-deepseek-500 hover:bg-deepseek-400 active:scale-95 shadow-lg shadow-deepseek-900/50"
                }`}
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionDock;
