import React, { useState, useMemo } from "react";
import type { LedgerItem } from "../../types/protocol.ts";
import { filterLedger } from "../../utils/panelHelpers.ts";
import {
  FileText,
  Search,
  CheckCircle2,
  XCircle,
  Database,
  Terminal,
  Code,
  FileCode,
  Layers,
  ArrowUpDown,
} from "lucide-react";

export interface LedgerWALViewerProps {
  ledger: LedgerItem[];
  onSelectItem?: (item: LedgerItem) => void;
  selectedItem?: LedgerItem | null;
  className?: string;
}

export function LedgerWALViewer({
  ledger = [],
  onSelectItem,
  selectedItem,
  className = "",
}: LedgerWALViewerProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [isReverse, setIsReverse] = useState(false);

  const filteredItems = useMemo(() => {
    const list = filterLedger(ledger, filterQuery);
    return isReverse ? [...list].reverse() : list;
  }, [ledger, filterQuery, isReverse]);

  const successCount = ledger.filter((i) => i.status === "SUCCESS").length;
  const failureCount = ledger.filter((i) => i.status === "FAILURE").length;

  const formatTime = (ts: number) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return String(ts);
    }
  };

  const getRoleBadge = (role: string) => {
    const r = role.toLowerCase();
    switch (r) {
      case "main":
        return "bg-deepseek-500/20 text-deepseek-400 border-deepseek-500/40";
      case "coder":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "researcher":
        return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      default:
        return "bg-[#232326] text-neutral-300 border-[#2c2c2e]";
    }
  };

  return (
    <div className={`flex flex-col h-full text-neutral-300 ${className}`}>
      {/* Header and Filter Controls */}
      <div className="p-2 border-b border-[#2c2c2e] flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-neutral-500" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Search tool, turn, target..."
            className="w-full bg-[#1b1b1c] border border-[#2c2c2e] rounded-lg pl-7 pr-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-deepseek-500 font-mono"
          />
        </div>
        <button
          onClick={() => setIsReverse((prev) => !prev)}
          title={isReverse ? "Newest First" : "Oldest First"}
          className="p-1.5 rounded hover:bg-[#232326] text-neutral-400 hover:text-neutral-200 border border-[#2c2c2e] transition"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stats bar */}
      <div className="px-3 py-1 bg-[#151517] border-b border-[#2c2c2e] text-[10px] text-neutral-400 flex items-center justify-between font-mono font-tabular">
        <div className="flex items-center gap-1.5">
          <Database className="w-3 h-3 text-deepseek-400" />
          <span>WAL Ledger: {ledger.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">{successCount} OK</span>
          {failureCount > 0 && <span className="text-rose-400">{failureCount} ERR</span>}
        </div>
      </div>

      {/* Ledger Items List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredItems.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-xs">
            {ledger.length === 0 ? "No ledger entries recorded" : "No entries match filter"}
          </div>
        ) : (
          filteredItems.map((item, idx) => {
            const isSelected = selectedItem === item;
            const isSuccess = item.status === "SUCCESS";

            return (
              <div
                key={`${item.sessionId}_${item.stepIndex}_${idx}`}
                onClick={() => onSelectItem?.(item)}
                className={`p-2.5 rounded-lg border text-xs transition cursor-pointer space-y-1.5 ${
                  isSelected
                    ? "bg-deepseek-500/20 border-deepseek-500/60 shadow-sm"
                    : "bg-[#1b1b1c] border-[#2c2c2e] hover:bg-[#232326] hover:border-neutral-700"
                }`}
              >
                {/* Header: Step, Tool, Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold font-tabular bg-[#232326] text-neutral-300 border border-[#2c2c2e]">
                      #{item.stepIndex}
                    </span>
                    <span className="font-semibold text-deepseek-400">{item.tool}</span>
                    <span
                      className={`text-[9px] uppercase px-1 rounded border font-semibold ${getRoleBadge(
                        item.role
                      )}`}
                    >
                      {item.role}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] font-mono font-tabular">
                    <span className="text-neutral-500">{formatTime(item.timestamp)}</span>
                    <span
                      className={`flex items-center gap-0.5 px-1 py-0.2 rounded font-bold uppercase text-[9px] ${
                        isSuccess
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {isSuccess ? (
                        <CheckCircle2 className="w-2.5 h-2.5" />
                      ) : (
                        <XCircle className="w-2.5 h-2.5" />
                      )}
                      {item.statusBadge || item.status}
                    </span>
                  </div>
                </div>

                {/* Target / File / Command */}
                {item.target && (
                  <div className="text-[11px] font-mono text-neutral-400 truncate bg-[#151517] px-1.5 py-0.5 rounded border border-[#2c2c2e]">
                    {item.target}
                  </div>
                )}

                {/* Brief Summary */}
                {item.briefSummary && (
                  <p className="text-[11px] text-neutral-300 leading-tight">
                    {item.briefSummary}
                  </p>
                )}

                {/* Modified Files Tag */}
                {item.modifiedFiles && item.modifiedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {item.modifiedFiles.map((f) => (
                      <span
                        key={f}
                        className="px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 truncate max-w-xs"
                      >
                        + {f}
                      </span>
                    ))}
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
export default LedgerWALViewer;
