/**
 * Helper utilities for left/right inspection panels:
 * - Account status formatting and countdowns
 * - Workspace tree hierarchy generation
 * - Ledger / WAL filtering
 * - Tool call file activity tracking
 */

import type { LedgerItem, ToolCallState } from "../types/protocol.ts";

/**
 * Mask an email address for privacy display.
 * E.g. "admin@domain.com" -> "ad***@domain.com"
 *      "user1234@company.org" -> "us***@company.org"
 */
export function maskEmail(email?: string | null): string {
  if (!email || typeof email !== "string") return "";
  const trimmed = email.trim();
  if (!trimmed) return "";

  const parts = trimmed.split("@");
  if (parts.length === 1) {
    const visible = parts[0].slice(0, 2);
    return `${visible}***`;
  }

  const [username, domain] = parts;
  const visible = username.slice(0, 2);
  return `${visible}***@${domain}`;
}

export interface ThrottleCountdown {
  isThrottled: boolean;
  remainingSeconds: number;
  formatted: string;
}

/**
 * Calculate throttle remaining countdown.
 * If cooldownUntil is in the future, returns remaining seconds (e.g. "34s").
 * If expired or undefined, returns isThrottled: false.
 */
export function calculateThrottleCountdown(
  cooldownUntil?: number,
  now?: number
): ThrottleCountdown {
  const current = now ?? Date.now();
  if (!cooldownUntil || cooldownUntil <= current) {
    return {
      isThrottled: false,
      remainingSeconds: 0,
      formatted: "",
    };
  }

  const diffMs = cooldownUntil - current;
  const remainingSeconds = Math.ceil(diffMs / 1000);

  return {
    isThrottled: true,
    remainingSeconds,
    formatted: `${remainingSeconds}s`,
  };
}

export type FileNodeStatus = "modified" | "read" | "normal";

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: WorkspaceTreeNode[];
  status?: FileNodeStatus;
}

export interface BuildWorkspaceTreeOptions {
  modifiedPaths?: string[];
  readPaths?: string[];
}

/**
 * Build a nested directory tree from a flat list of file paths.
 * Directories are sorted before files, and alphabetically within their group.
 */
export function buildWorkspaceTree(
  paths: string[],
  options: BuildWorkspaceTreeOptions = {}
): WorkspaceTreeNode[] {
  const modifiedSet = new Set((options.modifiedPaths || []).map(normalizePath));
  const readSet = new Set((options.readPaths || []).map(normalizePath));

  interface TempDirNode {
    name: string;
    path: string;
    subdirs: Map<string, TempDirNode>;
    files: Map<string, WorkspaceTreeNode>;
  }

  const root: TempDirNode = {
    name: "",
    path: "",
    subdirs: new Map(),
    files: new Map(),
  };

  for (const rawPath of paths) {
    if (!rawPath || typeof rawPath !== "string") continue;
    const cleanPath = normalizePath(rawPath);
    if (!cleanPath) continue;

    const segments = cleanPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let currentDir = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const curPath = segments.slice(0, i + 1).join("/");
      if (!currentDir.subdirs.has(seg)) {
        currentDir.subdirs.set(seg, {
          name: seg,
          path: curPath,
          subdirs: new Map(),
          files: new Map(),
        });
      }
      currentDir = currentDir.subdirs.get(seg)!;
    }

    const fileName = segments[segments.length - 1];
    const filePath = segments.join("/");
    let status: FileNodeStatus = "normal";
    if (modifiedSet.has(filePath)) {
      status = "modified";
    } else if (readSet.has(filePath)) {
      status = "read";
    }

    currentDir.files.set(fileName, {
      name: fileName,
      path: filePath,
      isDirectory: false,
      status,
    });
  }

  function convertTempDirToNodes(dir: TempDirNode): WorkspaceTreeNode[] {
    const dirNodes: WorkspaceTreeNode[] = [];
    for (const [name, sub] of dir.subdirs.entries()) {
      const children = convertTempDirToNodes(sub);
      const hasModifiedChild = children.some(
        (c) => c.status === "modified" || (c.isDirectory && c.status === "modified")
      );
      const hasReadChild = children.some(
        (c) => c.status === "read" || (c.isDirectory && c.status === "read")
      );
      const dirStatus: FileNodeStatus = hasModifiedChild
        ? "modified"
        : hasReadChild
        ? "read"
        : "normal";

      dirNodes.push({
        name,
        path: sub.path,
        isDirectory: true,
        children,
        status: dirStatus,
      });
    }

    dirNodes.sort((a, b) => a.name.localeCompare(b.name));

    const fileNodes = Array.from(dir.files.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return [...dirNodes, ...fileNodes];
  }

  return convertTempDirToNodes(root);
}

/**
 * Filter ledger items by query matching tool name, turn/stepIndex, role, or brief summary.
 */
export function filterLedger(items: LedgerItem[], query: string): LedgerItem[] {
  if (!items || !Array.isArray(items)) return [];
  if (!query || !query.trim()) return items;

  const q = query.trim().toLowerCase();

  return items.filter((item) => {
    if (!item) return false;
    const tool = (item.tool || "").toLowerCase();
    const target = (item.target || "").toLowerCase();
    const summary = (item.briefSummary || "").toLowerCase();
    const role = (item.role || "").toLowerCase();
    const status = (item.status || "").toLowerCase();
    const badge = (item.statusBadge || "").toLowerCase();
    const stepStr = String(item.stepIndex ?? "");

    if (tool.includes(q)) return true;
    if (target.includes(q)) return true;
    if (summary.includes(q)) return true;
    if (role.includes(q)) return true;
    if (status.includes(q)) return true;
    if (badge.includes(q)) return true;
    if (stepStr === q || `turn #${stepStr}`.includes(q) || `step #${stepStr}`.includes(q)) return true;

    return false;
  });
}

/**
 * Extract lists of modified and read file paths from tool executions and ledger items.
 */
export function extractModifiedAndReadFiles(
  toolCalls: ToolCallState[] = [],
  ledger: LedgerItem[] = []
): { modifiedFiles: string[]; readFiles: string[] } {
  const modifiedSet = new Set<string>();
  const readSet = new Set<string>();

  // Process tool calls
  for (const tc of toolCalls) {
    const act = tc.action || {};
    const toolName = (act.tool || act.name || act.action || "").toLowerCase();
    const path = act.path || act.filePath || act.file;

    if (path && typeof path === "string") {
      const norm = normalizePath(path);
      if (
        toolName.includes("write") ||
        toolName.includes("patch") ||
        toolName.includes("edit") ||
        toolName.includes("replace")
      ) {
        modifiedSet.add(norm);
      } else if (toolName.includes("read") || toolName.includes("view")) {
        readSet.add(norm);
      }
    }
  }

  // Process ledger items
  for (const item of ledger) {
    if (item.modifiedFiles && Array.isArray(item.modifiedFiles)) {
      for (const f of item.modifiedFiles) {
        if (f) modifiedSet.add(normalizePath(f));
      }
    }
    const tool = (item.tool || "").toLowerCase();
    if (item.target) {
      const norm = normalizePath(item.target);
      if (
        tool.includes("write") ||
        tool.includes("patch") ||
        tool.includes("edit") ||
        tool.includes("replace")
      ) {
        modifiedSet.add(norm);
      } else if (tool.includes("read") || tool.includes("view")) {
        readSet.add(norm);
      }
    }
  }

  return {
    modifiedFiles: Array.from(modifiedSet),
    readFiles: Array.from(readSet).filter((p) => !modifiedSet.has(p)),
  };
}

/**
 * Helper to normalize Windows and Unix path separators.
 */
export function normalizePath(path: string): string {
  if (!path || typeof path !== "string") return "";
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
