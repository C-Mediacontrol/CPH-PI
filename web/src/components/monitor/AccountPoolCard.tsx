import React, { useState, useEffect } from "react";
import type { AccountStatus } from "../../types/protocol.ts";
import { maskEmail, calculateThrottleCountdown } from "../../utils/panelHelpers.ts";
import { Users, Shield, Clock, AlertTriangle, CheckCircle2, RotateCw } from "lucide-react";

export interface AccountPoolCardProps {
  accounts: AccountStatus[];
  currentAccount?: string;
  onSelectAccount?: (email: string) => void;
  className?: string;
}

export function AccountPoolCard({
  accounts = [],
  currentAccount,
  onSelectAccount,
  className = "",
}: AccountPoolCardProps) {
  const [now, setNow] = useState<number>(Date.now());

  // Periodically update current timestamp if there are throttled accounts
  useEffect(() => {
    const hasThrottled = accounts.some(
      (a) => a.cooldownUntil && a.cooldownUntil > Date.now()
    );
    if (!hasThrottled) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [accounts]);

  const throttledCount = accounts.filter(
    (a) => a.isThrottled || (a.cooldownUntil && a.cooldownUntil > now)
  ).length;

  return (
    <div
      className={`rounded-xl border border-[#2c2c2e] bg-[#1b1b1c] p-3 text-xs shadow-sm flex flex-col gap-2 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2c2c2e] pb-2">
        <div className="flex items-center gap-1.5 font-medium text-neutral-200">
          <Users className="w-3.5 h-3.5 text-deepseek-400" />
          <span>Copilot Accounts</span>
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-tabular bg-[#232326] text-neutral-400 border border-[#2c2c2e]">
            {accounts.length}
          </span>
        </div>

        {throttledCount > 0 ? (
          <span className="flex items-center gap-1 text-[10px] font-mono font-tabular text-rose-400 bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-2.5 h-2.5" />
            {throttledCount} throttled
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Healthy
          </span>
        )}
      </div>

      {/* Account List */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
        {accounts.length === 0 ? (
          <div className="py-3 text-center text-neutral-500 text-[11px]">
            No accounts in pool
          </div>
        ) : (
          accounts.map((acc) => {
            const countdown = calculateThrottleCountdown(acc.cooldownUntil, now);
            const isThrottled = acc.isThrottled || countdown.isThrottled;
            const isActive =
              acc.email === currentAccount ||
              (acc.isLeased && (!currentAccount || acc.leasedBy === currentAccount));

            return (
              <div
                key={acc.email}
                onClick={() => onSelectAccount?.(acc.email)}
                className={`group flex items-center justify-between p-2 rounded-lg transition border cursor-pointer ${
                  isActive
                    ? "bg-deepseek-500/15 border-deepseek-500/40 text-deepseek-300"
                    : "bg-[#151517] border-[#2c2c2e] hover:bg-[#232326] text-neutral-300"
                }`}
                title={acc.email}
              >
                {/* Email and Active Indicator */}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isActive
                        ? "bg-deepseek-400 ring-2 ring-deepseek-500/30"
                        : isThrottled
                        ? "bg-rose-500"
                        : "bg-emerald-500"
                    }`}
                  />
                  <div className="truncate">
                    <span className="font-mono text-[11px] font-medium tracking-tight">
                      {maskEmail(acc.email)}
                    </span>
                    {isActive && (
                      <span className="ml-1.5 px-1 py-0.2 rounded text-[9px] uppercase font-bold tracking-wider bg-deepseek-500/25 text-deepseek-300 border border-deepseek-500/40">
                        Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Status Badge & Countdown */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {isThrottled ? (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-tabular px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">
                      <Clock className="w-2.5 h-2.5 animate-spin" />
                      {countdown.formatted || "Throttled"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                      Ready
                    </span>
                  )}

                  {acc.totalRequests !== undefined && acc.totalRequests > 0 && (
                    <span className="text-[10px] font-mono font-tabular text-neutral-500 hidden group-hover:inline">
                      {acc.totalRequests} reqs
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
export default AccountPoolCard;
