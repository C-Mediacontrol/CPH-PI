/**
 * Chat and Diff Helpers for CPH-PI Node Web GUI
 */

export type DiffLineType = "header" | "hunk" | "add" | "delete" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  raw: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface ParsedDiff {
  header?: string;
  lines: DiffLine[];
  addedCount: number;
  deletedCount: number;
}

/**
 * Detects whether a string contains unified diff format content.
 */
export function isDiffContent(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Typical unified diff markers
  if (
    trimmed.startsWith("@@ ") ||
    trimmed.includes("\n@@ ") ||
    trimmed.startsWith("--- ") ||
    trimmed.includes("\n--- ") ||
    trimmed.startsWith("diff --git") ||
    trimmed.includes("\ndiff --git")
  ) {
    return true;
  }

  // Also check if multiple lines start with + or -
  const lines = trimmed.split(/\r?\n/);
  const diffLineCount = lines.filter((l) => /^[+-]/.test(l)).length;
  return diffLineCount >= 2 && lines.some((l) => /^@@\s*-\d+/.test(l));
}

const HUNK_REGEX = /^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/;

/**
 * Parses unified diff string into categorized lines with line numbers and counts.
 */
export function parseUnifiedDiff(diffText?: string | null): ParsedDiff {
  if (!diffText || typeof diffText !== "string") {
    return { lines: [], addedCount: 0, deletedCount: 0 };
  }

  const rawLines = diffText.split(/\r?\n/);
  // Remove trailing empty line if string ended with newline
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  if (rawLines.length === 0) {
    return { lines: [], addedCount: 0, deletedCount: 0 };
  }

  const lines: DiffLine[] = [];
  let addedCount = 0;
  let deletedCount = 0;
  let curOldLine = 1;
  let curNewLine = 1;
  let inHunk = false;

  for (const line of rawLines) {
    // Check for file header lines
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ")
    ) {
      lines.push({
        type: "header",
        content: line,
        raw: line,
      });
      continue;
    }

    // Check for hunk headers: @@ -10,5 +10,6 @@
    const hunkMatch = line.match(HUNK_REGEX);
    if (hunkMatch) {
      inHunk = true;
      curOldLine = parseInt(hunkMatch[1], 10);
      curNewLine = parseInt(hunkMatch[3], 10);
      lines.push({
        type: "hunk",
        content: line,
        raw: line,
      });
      continue;
    }

    if (!inHunk) {
      // If we haven't seen a hunk yet, but encounter a line
      lines.push({
        type: "header",
        content: line,
        raw: line,
      });
      continue;
    }

    if (line.startsWith("+")) {
      addedCount++;
      lines.push({
        type: "add",
        content: line.slice(1),
        raw: line,
        newLineNumber: curNewLine++,
      });
    } else if (line.startsWith("-")) {
      deletedCount++;
      lines.push({
        type: "delete",
        content: line.slice(1),
        raw: line,
        oldLineNumber: curOldLine++,
      });
    } else {
      // Context line
      const content = line.startsWith(" ") ? line.slice(1) : line;
      lines.push({
        type: "context",
        content,
        raw: line,
        oldLineNumber: curOldLine++,
        newLineNumber: curNewLine++,
      });
    }
  }

  return {
    lines,
    addedCount,
    deletedCount,
  };
}

export interface SlashCommandItem {
  command: string;
  description: string;
  usage?: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandItem[] = [
  { command: "/plan", description: "Enter interactive step-by-step planning mode", usage: "/plan [goal]" },
  { command: "/goal", description: "Run autonomous goal-seeking mode until completed", usage: "/goal [objective]" },
  { command: "/compact", description: "Compact conversation context and history", usage: "/compact" },
  { command: "/clear", description: "Clear message view and reset turn", usage: "/clear" },
  { command: "/status", description: "Show account pool and agent status", usage: "/status" },
  { command: "/abort", description: "Force abort current execution", usage: "/abort" },
];

/**
 * Filters slash commands matching the user's input prefix.
 */
export function filterSlashCommands(
  query: string,
  commands: SlashCommandItem[] = DEFAULT_SLASH_COMMANDS
): SlashCommandItem[] {
  if (!query || typeof query !== "string" || !query.startsWith("/")) {
    return [];
  }

  const q = query.trim().toLowerCase();
  if (q === "/") {
    return commands;
  }

  return commands.filter(
    (c) =>
      c.command.toLowerCase().startsWith(q) ||
      c.command.toLowerCase().includes(q)
  );
}

/**
 * Formats a duration in milliseconds to human-readable string.
 * e.g. 450 -> "450ms", 8200 -> "8.2s", 65000 -> "1m 5s"
 */
export function formatDuration(ms?: number | null): string {
  if (typeof ms !== "number" || isNaN(ms) || ms <= 0) {
    return "0ms";
  }

  if (ms < 1000) {
    return `${Math.floor(ms)}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
