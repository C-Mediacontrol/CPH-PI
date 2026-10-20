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
    return <Layers className="w-3.5 h-3.5 text-deepseek-400" />;
  };

  const getStatusBadge = (status: SubagentState["status"]) => {
    switch (status) {
      case "completed":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Completed
          </span>
        );
      case "failed":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-2.5 h-2.5" />
            Failed
          </span>
        );
      case "running":
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-deepseek-500/20 text-deepseek-400 border border-deepseek-500/40 animate-pulse">
            <RotateCw className="w-2.5 h-2.5 animate-spin" />
            Running
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-[#232326] text-neutral-300 border border-[#2c2c2e]">
            Started
          </span>
        );
    }
  };

  return (
    <div className={`flex flex-col h-full text-neutral-300 ${className}`}>
      {/* Header bar */}
      <div className="px-3 py-2 border-b border-[#2c2c2e] bg-[#151517] flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-medium text-neutral-200">
          <Activity className="w-3.5 h-3.5 text-deepseek-400" />
          <span>Subagent Topology</span>
          <span className="font-mono font-tabular text-[10px] text-neutral-400 px-1.5 py-0.2 rounded-full bg-[#232326] border border-[#2c2c2e]">
            {subagents.length}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-mono font-tabular">
          {runningCount > 0 && (
            <span className="text-deepseek-400">{runningCount} active</span>
          )}
          <span className="text-emerald-400">{completedCount} done</span>
          {failedCount > 0 && <span className="text-rose-400">{failedCount} err</span>}
        </div>
      </div>

      {/* Subagent Swimlanes */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {subagents.length === 0 ? (
          <div className="py-12 text-center text-neutral-500 text-xs">
            No subagents spawned in current session
          </div>
        ) : (
          subagents.map((s) => {
            const isSelected = selectedSubagentId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSubagent?.(s)}
                className={`p-3 rounded-xl border text-xs transition cursor-pointer space-y-2 ${
                  isSelected
                    ? "bg-deepseek-500/15 border-deepseek-500/60 shadow-sm"
                    : "bg-[#1b1b1c] border-[#2c2c2e] hover:bg-[#232326] hover:border-neutral-700"
                }`}
              >
                {/* Header: Role & Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-lg bg-[#151517] border border-[#2c2c2e]">
                      {getRoleIcon(s.role)}
                    </div>
                    <div>
                      <span className="font-semibold text-neutral-200 capitalize">
                        {s.role}
                      </span>
                      {s.hop !== undefined && (
                        <span className="ml-1.5 text-[10px] font-mono font-tabular text-neutral-400">
                          Hop #{s.hop}
                        </span>
                      )}
                    </div>
                  </div>
                  {getStatusBadge(s.status)}
                </div>

                {/* Subagent Meta Details */}
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono font-tabular text-neutral-400 bg-[#151517] p-2 rounded-lg border border-[#2c2c2e]">
                  <div className="truncate">
                    <span className="text-neutral-500">ID: </span>
                    <span className="text-neutral-300">{s.id.slice(0, 10)}</span>
                  </div>
                  {s.turns !== undefined && (
                    <div className="flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5 text-amber-400" />
                      <span className="text-neutral-500">Turns: </span>
                      <span className="text-neutral-300">{s.turns}</span>
                    </div>
                  )}
                  {s.account && (
                    <div className="truncate col-span-2">
                      <span className="text-neutral-500">Account: </span>
                      <span className="text-neutral-300">{maskEmail(s.account)}</span>
                    </div>
                  )}
                  {s.durationMs !== undefined && (
                    <div className="flex items-center gap-1 col-span-2">
                      <Clock className="w-2.5 h-2.5 text-neutral-500" />
                      <span className="text-neutral-500">Duration: </span>
                      <span className="text-neutral-300">
                        {formatDuration(s.durationMs)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Streaming delta / progress preview */}
                {s.delta && (
                  <div className="p-2 bg-[#0f1115] rounded-lg border border-[#2c2c2e] font-mono text-[10px] text-neutral-300 max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed">
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
