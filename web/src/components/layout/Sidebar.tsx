import React from "react";
import type { ConnectionStatus, AccountStatus } from "../../types/protocol.ts";
import { AccountPoolCard } from "../monitor/AccountPoolCard.tsx";
import {
  Cpu,
  Plus,
  MessageSquare,
  Zap,
  Globe,
  Radio,
  Clock,
  ChevronRight,
} from "lucide-react";

export interface SessionItem {
  id: string;
  title?: string;
  turnCount?: number;
  lastActive?: number;
  active?: boolean;
}

export interface SidebarProps {
  status: ConnectionStatus;
  mode?: "Web" | "Companion";
  sessions?: SessionItem[];
  currentSessionId?: string;
  accounts?: AccountStatus[];
  currentAccount?: string;
  onNewSession?: () => void;
  onSelectSession?: (id: string) => void;
  onSelectAccount?: (email: string) => void;
  className?: string;
}

export function Sidebar({
  status,
  mode = "Web",
  sessions = [],
  currentSessionId,
  accounts = [],
  currentAccount,
  onNewSession,
  onSelectSession,
  onSelectAccount,
  className = "",
}: SidebarProps) {
  const getStatusDot = () => {
    switch (status) {
      case "connected":
        return "bg-emerald-400 ring-2 ring-emerald-500/20";
      case "connecting":
        return "bg-amber-400 ring-2 ring-amber-500/20 animate-pulse";
      case "error":
        return "bg-rose-400 ring-2 ring-rose-500/20";
      default:
        return "bg-slate-500";
    }
  };

  return (
    <aside
      className={`w-64 md:w-72 flex flex-col h-full bg-[#151517] border-r border-[#2c2c2e] text-neutral-200 select-none ${className}`}
    >
      {/* Top Header */}
      <div className="p-3.5 border-b border-[#2c2c2e] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-deepseek-500/10 border border-deepseek-500/30 text-deepseek-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white">CPH-PI</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold tracking-wide uppercase bg-deepseek-500/15 text-deepseek-400 border border-deepseek-500/30 flex items-center gap-1">
                {mode === "Web" ? <Globe className="w-2.5 h-2.5" /> : <Radio className="w-2.5 h-2.5" />}
                {mode}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot()}`} />
              <span className="capitalize">{status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* New Session Action */}
      <div className="p-3 border-b border-[#2c2c2e]">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#1b1b1c] hover:bg-[#232326] border border-[#2c2c2e] hover:border-neutral-700 text-neutral-200 hover:text-white text-xs font-medium transition shadow-sm"
        >
          <Plus className="w-4 h-4 text-deepseek-400" />
          <span>New Session</span>
        </button>
      </div>

      {/* Sessions Navigation List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-neutral-400">
          <span>Active Sessions</span>
          <span className="font-mono">{sessions.length}</span>
        </div>

        {sessions.length === 0 ? (
          <div className="py-6 text-center text-neutral-500 text-xs">
            No session history
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === currentSessionId || s.active;
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession?.(s.id)}
                className={`w-full text-left p-2.5 rounded-xl text-xs transition border flex items-center justify-between group ${
                  isActive
                    ? "bg-[#232326] border-deepseek-500/50 text-white shadow-sm"
                    : "bg-[#151517] border-transparent hover:bg-[#1b1b1c] text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? "text-deepseek-400" : "text-neutral-500 group-hover:text-neutral-300"
                    }`}
                  />
                  <div className="truncate">
                    <div className="font-medium truncate">
                      {s.title || `Session ${s.id.slice(0, 8)}`}
                    </div>
                    {s.turnCount !== undefined && (
                      <div className="text-[10px] text-neutral-400 flex items-center gap-1 font-mono font-tabular">
                        <Zap className="w-2.5 h-2.5 text-amber-400" />
                        <span>{s.turnCount} turns</span>
                      </div>
                    )}
                  </div>
                </div>

                <ChevronRight
                  className={`w-3.5 h-3.5 text-neutral-500 transition-transform ${
                    isActive ? "rotate-90 text-deepseek-400" : "group-hover:translate-x-0.5"
                  }`}
                />
              </button>
            );
          })
        )}
      </div>

      {/* Embedded Account Pool Card at Bottom */}
      <div className="p-3 border-t border-[#2c2c2e] bg-[#151517]">
        <AccountPoolCard
          accounts={accounts}
          currentAccount={currentAccount}
          onSelectAccount={onSelectAccount}
        />
      </div>
    </aside>
  );
}
export default Sidebar;
