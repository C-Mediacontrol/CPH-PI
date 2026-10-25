import fs from "node:fs";
import path from "node:path";

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  status?: "modified" | "added" | "deleted" | "untracked" | "clean";
  children?: WorkspaceFile[];
}

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cph",
  ".cache",
  ".turbo",
  ".next",
  "build",
  "coverage",
]);

/**
 * Recursively scans directory structure up to maxDepth
 */
export function scanWorkspaceFiles(
  rootDir: string,
  currentRel = "",
  depth = 0,
  maxDepth = 3
): WorkspaceFile[] {
  const currentAbs = currentRel ? path.join(rootDir, currentRel) : rootDir;
  if (!fs.existsSync(currentAbs)) {
    return [];
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(currentAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const result: WorkspaceFile[] = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) {
      continue;
    }

    const relPath = currentRel ? path.join(currentRel, entry.name).replace(/\\/g, "/") : entry.name;
    const isDir = entry.isDirectory();
    const id = `f-${relPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    if (isDir) {
      const children =
        depth < maxDepth
          ? scanWorkspaceFiles(rootDir, relPath, depth + 1, maxDepth)
          : undefined;

      result.push({
        id,
        name: entry.name,
        path: relPath,
        type: "directory",
        children,
      });
    } else {
      result.push({
        id,
        name: entry.name,
        path: relPath,
        type: "file",
        status: "clean",
      });
    }
  }

  return result;
}

