import React from "react";
import type { SubagentState } from "../../types/protocol.ts";
import { maskEmail } from "../../utils/panelHelpers.ts";
import { formatDuration } from "../../utils/chatHelpers.ts";
import {
  Layers,
  Terminal,
  Search,
  Code,
  Cpu,
  Clock,
  ArrowRight,
  Zap,
  Activity,
  CheckCircle2,
  XCircle,
  RotateCw,
} from "lucide-react";

export interface SubagentGraphProps {
  subagents: SubagentState[];
  onSelectSubagent?: (subagent: SubagentState) => void;
  selectedSubagentId?: string | null;
  className?: string;
}

export function SubagentGraph({
  subagents = [],
  onSelectSubagent,
  selectedSubagentId,
  className = "",
}: SubagentGraphProps) {
  const runningCount = subagents.filter(
    (s) => s.status === "running" || s.status === "started"
  ).length;
  const completedCount = subagents.filter((s) => s.status === "completed").length;
  const failedCount = subagents.filter((s) => s.status === "failed").length;

  const getRoleIcon = (role: string) => {
    const r = role.toLowerCase();
    if (r.includes("research")) return <Search className="w-3.5 h-3.5 text-purple-400" />;
    if (r.includes("code") || r.includes("implement"))
      return <Code className="w-3.5 h-3.5 text-emerald-400" />;
    if (r.includes("audit") || r.includes("review"))
      return <Terminal className="w-3.5 h-3.5 text-amber-400" />;
    return <Layers className="w-3.5 h-3.5 text-sky-400" />;
  };

  const getStatusBadge = (status: SubagentState["status"]) => {
    switch (status) {
      case "completed":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Completed
          </span>
        );
      case "failed":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-800/80">
            <XCircle className="w-2.5 h-2.5" />
            Failed
          </span>
        );
      case "running":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/80 animate-pulse">
            <RotateCw className="w-2.5 h-2.5 animate-spin" />
            Running
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Started
          </span>
        );
    }
  };

  return (
    <div className={`flex flex-col h-full text-slate-300 ${className}`}>
      {/* Header bar */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-medium text-slate-200">
          <Activity className="w-3.5 h-3.5 text-sky-400" />
          <span>Subagent Topology</span>
          <span className="font-mono text-[10px] text-slate-400 px-1.5 py-0.2 rounded-full bg-slate-800">
            {subagents.length}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-mono">
          {runningCount > 0 && (
            <span className="text-sky-400">{runningCount} active</span>
          )}
          <span className="text-emerald-400">{completedCount} done</span>
          {failedCount > 0 && <span className="text-rose-400">{failedCount} err</span>}
        </div>
      </div>

      {/* Subagent Swimlanes */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {subagents.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No subagents spawned in current session
          </div>
        ) : (
          subagents.map((s) => {
            const isSelected = selectedSubagentId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSubagent?.(s)}
                className={`p-3 rounded-lg border text-xs transition cursor-pointer space-y-2 ${
                  isSelected
                    ? "bg-slate-900 border-sky-500 shadow-sm"
                    : "bg-slate-950/70 border-slate-800/80 hover:bg-slate-900/60 hover:border-slate-700"
                }`}
              >
                {/* Header: Role & Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-slate-900 border border-slate-800">
                      {getRoleIcon(s.role)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-200 capitalize">
                        {s.role}
                      </span>
                      {s.hop !== undefined && (
                        <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                          Hop #{s.hop}
                        </span>
                      )}
                    </div>
                  </div>
                  {getStatusBadge(s.status)}
                </div>

                {/* Subagent Meta Details */}
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/60">
                  <div className="truncate">
                    <span className="text-slate-500">ID: </span>
                    <span className="text-slate-300">{s.id.slice(0, 10)}</span>
                  </div>
                  {s.turns !== undefined && (
                    <div className="flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5 text-amber-400" />
                      <span className="text-slate-500">Turns: </span>
                      <span className="text-slate-300">{s.turns}</span>
                    </div>
                  )}
                  {s.account && (
                    <div className="truncate col-span-2">
                      <span className="text-slate-500">Account: </span>
                      <span className="text-slate-300">{maskEmail(s.account)}</span>
                    </div>
                  )}
                  {s.durationMs !== undefined && (
                    <div className="flex items-center gap-1 col-span-2">
                      <Clock className="w-2.5 h-2.5 text-slate-500" />
                      <span className="text-slate-500">Duration: </span>
                      <span className="text-slate-300">
                        {formatDuration(s.durationMs)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Streaming delta / progress preview */}
                {s.delta && (
                  <div className="p-2 bg-slate-950 rounded border border-slate-800/80 font-mono text-[10px] text-slate-300 max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {s.delta}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
export default SubagentGraph;
