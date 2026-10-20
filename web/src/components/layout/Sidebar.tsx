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
      className={`w-64 md:w-72 flex flex-col h-full bg-slate-900/95 border-r border-slate-800 text-slate-200 select-none ${className}`}
    >
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-slate-100">CPH-PI</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold tracking-wide uppercase bg-sky-950 text-sky-300 border border-sky-800/60 flex items-center gap-1">
                {mode === "Web" ? <Globe className="w-2.5 h-2.5" /> : <Radio className="w-2.5 h-2.5" />}
                {mode}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot()}`} />
              <span className="capitalize">{status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* New Session Action */}
      <div className="p-3 border-b border-slate-800/60">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-200 hover:text-sky-100 text-xs font-medium transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Session</span>
        </button>
      </div>

      {/* Sessions Navigation List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
          <span>Active Sessions</span>
          <span className="font-mono">{sessions.length}</span>
        </div>

        {sessions.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-xs">
            No session history
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === currentSessionId || s.active;
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession?.(s.id)}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition border flex items-center justify-between group ${
                  isActive
                    ? "bg-slate-800/90 border-sky-500/50 text-sky-100 shadow-sm"
                    : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/40 text-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? "text-sky-400" : "text-slate-500 group-hover:text-slate-300"
                    }`}
                  />
                  <div className="truncate">
                    <div className="font-medium truncate">
                      {s.title || `Session ${s.id.slice(0, 8)}`}
                    </div>
                    {s.turnCount !== undefined && (
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-amber-400" />
                        <span>{s.turnCount} turns</span>
                      </div>
                    )}
                  </div>
                </div>

                <ChevronRight
                  className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                    isActive ? "rotate-90 text-sky-400" : "group-hover:translate-x-0.5"
                  }`}
                />
              </button>
            );
          })
        )}
      </div>

      {/* Embedded Account Pool Card at Bottom */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
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
