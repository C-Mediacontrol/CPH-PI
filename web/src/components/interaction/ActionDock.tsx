import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Square,
  Sparkles,
  Command,
  CornerDownLeft,
  AlertOctagon,
  Pause,
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
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-30 max-h-64 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Command className="w-3.5 h-3.5 text-sky-400" />
              Slash Commands
            </span>
            <span className="text-slate-500 text-[10px]">↑↓ to navigate · Enter to select</span>
          </div>
          <div className="p-1 divide-y divide-slate-800/40">
            {filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.command}
                  type="button"
                  onClick={() => selectSlashCommand(cmd)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                    isSelected
                      ? "bg-sky-500/15 text-sky-200 border border-sky-500/30"
                      : "text-slate-300 hover:bg-slate-800/60 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold text-sky-400">
                      {cmd.command}
                    </span>
                    <span className="text-xs text-slate-300">
                      {cmd.description}
                    </span>
                  </div>
                  {cmd.usage && (
                    <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
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
      <div className="relative rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/30 transition-all">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent px-4 pt-3.5 pb-12 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none max-h-48 font-sans leading-relaxed"
        />

        {/* Bottom Control Bar inside the Dock */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between select-none pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] text-slate-500 pointer-events-auto">
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-400">
                Enter
              </kbd>
              <span>to send</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-400">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-950/50 transition-all active:scale-95 animate-pulse"
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
              /* Send Prompt Button */
              <button
                type="button"
                onClick={handleSend}
                disabled={disabled || !text.trim()}
                className={`flex items-center justify-center p-2 rounded-xl text-white shadow transition-all ${
                  !text.trim() || disabled
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-sky-600 hover:bg-sky-500 active:scale-95 shadow-sky-950/50"
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
