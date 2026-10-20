import React from "react";

export interface ExitCodeBadgeProps {
  exitCode?: number | string | null;
  label?: string;
  className?: string;
}

/**
 * Render a standard DeepSeek-Harness status capsule with indicator dot and exit status.
 *
 * Success (exit code 0): emerald / green indicator dot & text
 * Non-zero / error: rose / red indicator dot & text
 */
export const ExitCodeBadge: React.FC<ExitCodeBadgeProps> = ({
  exitCode,
  label,
  className = "",
}) => {
  const isSuccess = exitCode === 0 || exitCode === "0";
  const displayText = label || (exitCode !== undefined && exitCode !== null ? `Exit ${exitCode}` : "Exit");

  const badgeStyle = isSuccess
    ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400"
    : "bg-rose-500/10 border border-rose-500/25 text-rose-400";

  const dotStyle = isSuccess ? "bg-emerald-400" : "bg-rose-400";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs inline-flex items-center gap-1.5 font-mono leading-none select-none transition-colors ${badgeStyle} ${className}`}
      data-testid="exit-code-badge"
      data-exit-code={exitCode ?? undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-none ${dotStyle}`} aria-hidden="true" />
      <span>{displayText}</span>
    </span>
  );
};

export default ExitCodeBadge;
