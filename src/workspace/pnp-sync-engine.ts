import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawn } from "node:child_process";

export interface PrewarmOptions {
  workspaceRoot: string;
  targetFolder?: string;
  siteUrl?: string;
  hardReset?: boolean;
  mockTransport?: boolean;
  manifestPath?: string;
  dirtyLogPath?: string;
  signal?: AbortSignal;
}

export interface SyncFileOptions {
  siteUrl?: string;
  mockTransport?: boolean;
  manifestPath?: string;
  dirtyLogPath?: string;
  signal?: AbortSignal;
}

export interface SyncFileResult {
  relativePath: string;
  status: "synced" | "skipped" | "pruned" | "recycled" | "failed";
  size?: number;
  sha256?: string;
  uniqueId?: string;
  serverRelativeUrl?: string;
  error?: string;
}

export interface CatalogStats {
  totalFiles: number;
  syncedIndexable: number;
  localOnly: number;
  unindexable: number;
}

export interface FolderManifestEntry {
  lastSyncedAt: string;
  uniqueId?: string;
}

export interface SyncFolderResult {
  relativePath: string;
  status: "synced" | "skipped" | "pruned" | "failed";
  uniqueId?: string;
  error?: string;
}

export interface MirrorVerifyResult {
  valid: boolean;
  reason: string;
  cloudFileCount: number;
  overlapCount: number;
  hasMirrorFile: boolean;
  targetFolder: string;
  workspaceRoot: string;
}

export interface VerifyMirrorOptions {
  workspaceRoot: string;
  targetFolder?: string;
  siteUrl?: string;
  mockTransport?: boolean;
  signal?: AbortSignal;
}

export interface SyncCloudWorkspaceOptions extends PrewarmOptions {
  skipVerify?: boolean;
}

export interface PrewarmReport {
  workspaceRoot: string;
  targetFolder: string;
  totalLocal: number;
  totalLocalFolders?: number;
  syncedCount: number;
  skippedCount: number;
  prunedCount: number;
  failedCount: number;
  syncedFoldersCount?: number;
  prunedFoldersCount?: number;
  durationMs: number;
  results: SyncFileResult[];
  folderResults?: SyncFolderResult[];
}

export interface SyncManifestFileEntry {
  sha256: string;
  size: number;
  uniqueId?: string;
  serverRelativeUrl?: string;
  lastSyncedAt?: string;
  firstCreatedAt?: string | number;
}

export interface SyncManifest {
  version: number;
  lastFullSync?: string;
  lastPrewarmAt?: string;
  siteUrl?: string;
  targetFolder?: string;
  files: Record<string, SyncManifestFileEntry>;
  folders?: Record<string, FolderManifestEntry>;
}

export function encodeUrlPathSegments(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join("/");
}

const NON_INDEXABLE_EXTENSIONS = new Set([
  ".dll",
  ".dylib",
  ".so",
  ".exe",
  ".pdb",
  ".lib",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".aar",
  ".jar",
  ".onnx",
  ".bin",
  ".cache",
  ".up2date",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".tif",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
]);

function isNonIndexableBinary(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of NON_INDEXABLE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export class PnPWorkspaceSyncEngine {
  public static DEFAULT_SITE_URL = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";
  public static DEFAULT_TARGET_FOLDER =
    "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test";

  private scriptPath: string;

  constructor(customScriptPath?: string) {
    if (customScriptPath) {
      this.scriptPath = customScriptPath;
    } else {
      // Default to scripts/sp-sync-engine.ps1 relative to current module
      this.scriptPath = path.resolve(__dirname, "../../scripts/sp-sync-engine.ps1");
    }
  }

  /**
   * Compute SHA256 of a local file
   */
  public static getFileSha256(filePath: string): string {
    const hash = crypto.createHash("sha256");
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest("hex");
  }

  /**
   * Load or initialize the sync manifest
   */
  public static loadManifest(manifestPath: string): SyncManifest | null {
    if (fs.existsSync(manifestPath)) {
      try {
        let raw = fs.readFileSync(manifestPath, "utf8");
        if (raw.charCodeAt(0) === 0xfeff) {
          raw = raw.slice(1);
        }
        const parsed = JSON.parse(raw);
        if (parsed) {
          if (!parsed.version || parsed.version < 2) {
            parsed.version = 2;
          }
          if (!parsed.folders) {
            parsed.folders = {};
          }
          return parsed as SyncManifest;
        }
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Save manifest with atomic write
   */
  public static saveManifest(manifestPath: string, manifest: SyncManifest): void {
    const dir = path.dirname(manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!manifest.version || manifest.version < 2) {
      manifest.version = 2;
    }
    manifest.folders = manifest.folders || {};
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  /**
   * Execute sp-sync-engine.ps1 in powershell.exe (Windows PowerShell 5.1)
   */
  private async executePowerShell(args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string; report: any }> {
    return new Promise((resolve, reject) => {
      const psArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.scriptPath,
        ...args,
      ];

      const child = spawn("powershell.exe", psArgs, {
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      if (signal) {
        if (signal.aborted) {
          child.kill();
          return reject(new Error("Operation aborted"));
        }
        signal.addEventListener("abort", () => {
          child.kill();
          reject(new Error("Operation aborted"));
        });
      }

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn powershell.exe: ${err.message}`));
      });

      child.on("close", (code) => {
        // Extract JSON between markers
        const startMarker = "###REPORT_JSON_START###";
        const endMarker = "###REPORT_JSON_END###";
        const startIndex = stdout.indexOf(startMarker);
        const endIndex = stdout.indexOf(endMarker);

        let report: any = null;
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
          const jsonStr = stdout.substring(startIndex + startMarker.length, endIndex).trim();
          try {
            report = JSON.parse(jsonStr);
          } catch (e: any) {
            // failed to parse json
          }
        }

        if (code !== 0) {
          return reject(
            new Error(
              `sp-sync-engine.ps1 exited with code ${code}.\nSTDERR: ${stderr.trim()}\nSTDOUT: ${stdout.trim()}`
            )
          );
        }

        if (!report) {
          return reject(
            new Error(
              `Failed to parse report JSON from sp-sync-engine.ps1 output.\nSTDOUT: ${stdout.trim()}`
            )
          );
        }

        resolve({ stdout, stderr, report });
      });
    });
  }

  /**
   * Trigger Prewarm and Orphan Pruning
   */
  public async prewarm(options: PrewarmOptions): Promise<PrewarmReport> {
    const siteUrl = options.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = options.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options.manifestPath || path.join(options.workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options.dirtyLogPath || path.join(options.workspaceRoot, ".cph", "state", "dirty-sync.jsonl");

    const args = [
      "-Action", "Prewarm",
      "-WorkspaceRoot", options.workspaceRoot,
      "-TargetFolder", targetFolder,
      "-SiteUrl", siteUrl,
      "-ManifestPath", manifestPath,
      "-DirtyLogPath", dirtyLogPath,
    ];

    if (options.hardReset) {
      args.push("-HardReset");
    }
    if (options.mockTransport) {
      args.push("-MockTransport");
    }

    const { report } = await this.executePowerShell(args, options.signal);

    // After prewarm, update Virtual Repo Map in .cph/state/virtual-repo-map.md
    try {
      const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
      if (manifest) {
        const mapContent = PnPWorkspaceSyncEngine.generateVirtualRepoMap(manifest, siteUrl, targetFolder);
        const mapPath = path.join(options.workspaceRoot, ".cph", "state", "virtual-repo-map.md");
        fs.mkdirSync(path.dirname(mapPath), { recursive: true });
        fs.writeFileSync(mapPath, mapContent, "utf8");
      }
    } catch {
      // Non-fatal if map writing fails
    }

    const folderResults: SyncFolderResult[] | undefined = Array.isArray(report.folderResults)
      ? report.folderResults.map((f: any) => ({
          relativePath: f.relativePath || f.relativeFolder,
          status: (f.status === "recycled" ? "pruned" : f.status) as ("synced" | "skipped" | "pruned" | "failed"),
          uniqueId: f.uniqueId,
          error: f.error,
        }))
      : undefined;

    return {
      workspaceRoot: report.workspaceRoot,
      targetFolder: report.targetFolder,
      totalLocal: report.totalLocal,
      totalLocalFolders: report.totalLocalFolders,
      syncedCount: report.syncedCount,
      skippedCount: report.skippedCount,
      prunedCount: report.prunedCount,
      failedCount: report.failedCount,
      syncedFoldersCount: report.syncedFoldersCount,
      prunedFoldersCount: report.prunedFoldersCount,
      durationMs: report.durationMs,
      results: (report.results || []) as SyncFileResult[],
      folderResults,
    };
  }

  /**
   * Hot-sync a single file to SharePoint
   */
  public async syncFile(
    workspaceRoot: string,
    relativePath: string,
    targetFolder?: string,
    options?: SyncFileOptions
  ): Promise<SyncFileResult> {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options?.manifestPath || path.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options?.dirtyLogPath || path.join(workspaceRoot, ".cph", "state", "dirty-sync.jsonl");

    const args = [
      "-Action", "SyncSingleFile",
      "-WorkspaceRoot", workspaceRoot,
      "-FilePath", relativePath,
      "-TargetFolder", folder,
      "-SiteUrl", siteUrl,
      "-ManifestPath", manifestPath,
      "-DirtyLogPath", dirtyLogPath,
    ];

    if (options?.mockTransport) {
      args.push("-MockTransport");
    }

    const { report } = await this.executePowerShell(args, options?.signal);
    const result = report.results?.[0] || {
      relativePath,
      status: "failed",
      error: "No result returned",
    };

    return result as SyncFileResult;
  }

  /**
   * Ensure or sync a directory exists in SharePoint
   */
  public async syncFolder(
    workspaceRoot: string,
    relativeFolderPath: string,
    targetFolder?: string,
    options?: SyncFileOptions
  ): Promise<SyncFolderResult> {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;
    const manifestPath = options?.manifestPath || path.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = options?.dirtyLogPath || path.join(workspaceRoot, ".cph", "state", "dirty-sync.jsonl");

    const args = [
      "-Action", "EnsureFolder",
      "-WorkspaceRoot", workspaceRoot,
      "-SourceFolder", relativeFolderPath,
      "-TargetFolder", folder,
      "-SiteUrl", siteUrl,
      "-ManifestPath", manifestPath,
      "-DirtyLogPath", dirtyLogPath,
    ];

    if (options?.mockTransport) {
      args.push("-MockTransport");
    }

    const { report } = await this.executePowerShell(args, options?.signal);
    const rawResult = report?.results?.[0];
    const result: SyncFolderResult = rawResult
      ? {
          relativePath: rawResult.relativePath || rawResult.relativeFolder || relativeFolderPath,
          status: (rawResult.status === "recycled" ? "pruned" : rawResult.status) || "synced",
          uniqueId: rawResult.uniqueId,
          error: rawResult.error,
        }
      : {
          relativePath: relativeFolderPath,
          status: "failed",
          error: "No result returned",
        };

    return result;
  }

  /**
   * Pull single file from SharePoint to local workspace
   */
  public async pullFile(
    workspaceRoot: string,
    relativePath: string,
    targetFolder?: string,
    options?: SyncFileOptions
  ): Promise<SyncFileResult> {
    const siteUrl = options?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const folder = targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

    const args = [
      "-Action", "PullFile",
      "-WorkspaceRoot", workspaceRoot,
      "-FilePath", relativePath,
      "-TargetFolder", folder,
      "-SiteUrl", siteUrl,
    ];

    if (options?.mockTransport) {
      args.push("-MockTransport");
    }

    const { report } = await this.executePowerShell(args, options?.signal);
    const result = report.results?.[0] || {
      relativePath,
      status: "failed",
      error: "No result returned",
    };

    return result as SyncFileResult;
  }

  /**
   * Verify cloud mirror safety and integrity before sync
   */
  public async verifyCloudMirror(options: VerifyMirrorOptions): Promise<MirrorVerifyResult> {
    const siteUrl = options.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = options.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

    const args = [
      "-Action", "VerifyMirror",
      "-WorkspaceRoot", options.workspaceRoot,
      "-TargetFolder", targetFolder,
      "-SiteUrl", siteUrl,
    ];

    if (options.mockTransport) {
      args.push("-MockTransport");
    }

    const { report } = await this.executePowerShell(args, options.signal);
    return report as MirrorVerifyResult;
  }

  /**
   * Alias for verifyCloudMirror
   */
  public async verifyMirror(options: VerifyMirrorOptions): Promise<MirrorVerifyResult> {
    return this.verifyCloudMirror(options);
  }

  /**
   * Safe cloud workspace synchronization guarded by mirror verification
   */
  public async syncCloudWorkspace(options: SyncCloudWorkspaceOptions): Promise<PrewarmReport> {
    if (!options.skipVerify) {
      const verifyResult = await this.verifyCloudMirror({
        workspaceRoot: options.workspaceRoot,
        targetFolder: options.targetFolder,
        siteUrl: options.siteUrl,
        mockTransport: options.mockTransport,
        signal: options.signal,
      });

      if (!verifyResult.valid) {
        throw new Error(verifyResult.reason);
      }
    }

    return this.prewarm(options);
  }

  /**
   * Reads .cph/state/virtual-repo-map.md from workspaceRoot if present and non-empty
   */
  public static readVirtualRepoMap(workspaceRoot?: string): string | undefined {
    if (!workspaceRoot) {
      return undefined;
    }
    const mapPath = path.join(workspaceRoot, ".cph", "state", "virtual-repo-map.md");
    if (!fs.existsSync(mapPath)) {
      return undefined;
    }
    try {
      const content = fs.readFileSync(mapPath, "utf8").trim();
      return content.length > 0 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Generate compact Virtual Repo Map Markdown
   */
  public static generateVirtualRepoMap(
    manifest: SyncManifest,
    siteUrl: string,
    targetFolder: string
  ): string {
    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    const folderClean = targetFolder.startsWith("/") ? targetFolder : `/${targetFolder}`;
    const encodedFolder = encodeUrlPathSegments(folderClean);
    const remoteRootUrl = folderClean.startsWith("/sites/")
      ? `${origin}${encodedFolder ? `/${encodedFolder}` : ""}`
      : `${siteUrl.replace(/\/$/, "")}${encodedFolder ? `/${encodedFolder}` : ""}`;

    const files = manifest.files || {};
    const allKeys = Object.keys(files).sort();
    const fileKeys = allKeys.filter((k) => !isNonIndexableBinary(k));

    const lines: string[] = [
      "[SHAREPOINT REMOTE WORKSPACE]",
      `Remote Root URL: ${remoteRootUrl}`,
      `Sync Status: Synchronized (Local SSOT) | Total Files: ${fileKeys.length}`,
      "",
      "Files Index:",
    ];

    const MAX_MAP_FILES = 120;
    if (fileKeys.length === 0) {
      lines.push("- (No files recorded in sync manifest)");
    } else {
      const displayKeys = fileKeys.slice(0, MAX_MAP_FILES);
      for (const k of displayKeys) {
        const item = files[k];
        const sizeKb = (item.size / 1024).toFixed(1);
        const guidStr = item.uniqueId ? ` | UniqueId: ${item.uniqueId}` : "";
        let fileWebUrl = "";
        if (item.serverRelativeUrl) {
          const encodedServerUrl = encodeUrlPathSegments(item.serverRelativeUrl);
          fileWebUrl = item.serverRelativeUrl.startsWith("/sites/")
            ? `${origin}${encodedServerUrl ? `/${encodedServerUrl}` : ""}`
            : `${siteUrl.replace(/\/$/, "")}${encodedServerUrl ? `/${encodedServerUrl}` : ""}`;
        } else {
          const encodedRelPath = encodeUrlPathSegments(k);
          fileWebUrl = `${remoteRootUrl}/${encodedRelPath}`;
        }

        let statusTag = "[CLOUD-READY]";
        if (
          item.firstCreatedAt !== undefined &&
          item.firstCreatedAt !== null &&
          item.lastSyncedAt !== undefined &&
          item.lastSyncedAt !== null
        ) {
          if (String(item.firstCreatedAt) === String(item.lastSyncedAt)) {
            const createdTime =
              typeof item.firstCreatedAt === "number"
                ? item.firstCreatedAt
                : !Number.isNaN(Number(item.firstCreatedAt))
                ? Number(item.firstCreatedAt)
                : new Date(item.firstCreatedAt).getTime();
            if (!Number.isNaN(createdTime) && Date.now() - createdTime < 60_000) {
              statusTag = "[LOCAL-NEW: use read_file]";
            }
          }
        }

        lines.push(`- ${k.replace(/\\/g, "/")} (Size: ${sizeKb}KB${guidStr} | Web: ${fileWebUrl} | Status: ${statusTag})`);
      }

      if (fileKeys.length > MAX_MAP_FILES) {
        lines.push(`- ... (${fileKeys.length - MAX_MAP_FILES} more files synchronized at ${remoteRootUrl})`);
      }
    }

    if (manifest.folders && Object.keys(manifest.folders).length > 0) {
      const folderKeys = Object.keys(manifest.folders).sort();
      lines.push("");
      lines.push("### [DIRECTORIES / EMPTY FOLDERS]");
      for (const fk of folderKeys) {
        const fEntry = manifest.folders[fk];
        const lastSyncedStr = fEntry?.lastSyncedAt ? ` (LastSynced: ${fEntry.lastSyncedAt})` : "";
        lines.push(`- ${fk.replace(/\\/g, "/")}${lastSyncedStr}`);
      }
    }

    lines.push("");
    lines.push("Guidance: All repository files are grounded at the SharePoint paths above. You may cite, inspect or trace them directly by relative path or URL.");

    return lines.join("\n");
  }

  /**
   * Generates the workspace catalog attachment.
   *
   * File list comes from the filesystem (git tracked + untracked + Library/),
   * while the sync manifest is used only for status and URL columns. This keeps
   * the catalog truthful after workspace relocation or local-only files appear.
   */
  public static generateCatalogMarkdown(
    workspaceRoot: string,
    opts?: { manifestPath?: string }
  ): { markdown: string; stats: CatalogStats } {
    const manifestPath =
      opts?.manifestPath || path.join(workspaceRoot, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    const siteUrl = manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    let sitePath = "";
    try {
      sitePath = new URL(siteUrl).pathname.replace(/\/$/, "");
    } catch {
      sitePath = "";
    }

    const folderClean = targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const prefix = folderClean.startsWith("sites/")
      ? `/${folderClean}`
      : `${sitePath}/${folderClean}`;
    const normalizedPrefix = prefix.replace(/\/+/g, "/").replace(/\/$/, "");
    const encodedPrefix = encodeUrlPathSegments(normalizedPrefix);
    const remoteRootUrl = `${origin}${encodedPrefix ? `/${encodedPrefix}` : ""}`;

    const relativeFiles = PnPWorkspaceSyncEngine.listWorkspaceFilesForCatalog(workspaceRoot);
    const manifestFiles = manifest?.files || {};

    const rows: Array<{ rel: string; size: number; status: string; url: string }> = [];
    let syncedIndexable = 0;
    let localOnly = 0;
    let unindexable = 0;

    for (const rel of relativeFiles) {
      let size = 0;
      try {
        size = fs.statSync(path.join(workspaceRoot, rel)).size;
      } catch {}

      if (isNonIndexableBinary(rel)) {
        unindexable++;
        rows.push({ rel, size, status: "CLOUD-UNINDEXABLE", url: "" });
        continue;
      }

      const entry = manifestFiles[rel];
      if (entry) {
        // Always surface the URL for the CURRENT target folder; a stale manifest
        // URL is a status signal, not something the model should fetch. CLOUD-STALE
        // therefore gets no URL at all (read it locally instead).
        const underCurrent = Boolean(
          entry.serverRelativeUrl &&
            entry.serverRelativeUrl.replace(/\\/g, "/").startsWith(`${normalizedPrefix}/`)
        );
        const url = underCurrent ? `${remoteRootUrl}/${encodeUrlPathSegments(rel)}` : "";
        rows.push({ rel, size, status: underCurrent ? "CLOUD-READY" : "CLOUD-STALE", url });
        if (underCurrent) syncedIndexable++;
        else localOnly++;
      } else {
        rows.push({ rel, size, status: "LOCAL-ONLY", url: "" });
        localOnly++;
      }
    }

    // 2-level directory skeleton with per-directory file counts.
    const dirCounts = new Map<string, number>();
    for (const rel of relativeFiles) {
      const parts = rel.split("/");
      if (parts.length > 1) {
        const top = parts[0];
        dirCounts.set(top, (dirCounts.get(top) || 0) + 1);
        if (parts.length > 2) {
          const second = `${parts[0]}/${parts[1]}`;
          dirCounts.set(second, (dirCounts.get(second) || 0) + 1);
        }
      }
    }

    const skeletonLines: string[] = [];
    const topDirs = [...dirCounts.keys()]
      .filter((dir) => !dir.includes("/"))
      .sort();
    for (const top of topDirs) {
      skeletonLines.push(`- ${top}/ (${dirCounts.get(top)} files)`);
      const children = [...dirCounts.keys()]
        .filter((dir) => dir.startsWith(`${top}/`) && dir.split("/").length === 2)
        .sort();
      for (const child of children) {
        skeletonLines.push(`  - ${child.slice(top.length + 1)}/ (${dirCounts.get(child)} files)`);
      }
    }
    if (skeletonLines.length === 0) {
      skeletonLines.push("- (workspace has no sub-directories; files sit at the root)");
    }

    const MAX_ROWS = 2000;
    const displayRows = rows.slice(0, MAX_ROWS);
    const rowLines = displayRows.map((row) => {
      const sizeKb = (row.size / 1024).toFixed(1);
      const urlPart = row.url ? ` | ${row.url}` : "";
      return `- \`${row.rel}\` (${sizeKb}KB | [${row.status}]${urlPart})`;
    });
    if (rows.length > MAX_ROWS) {
      rowLines.push(
        `- ...（其余 ${rows.length - MAX_ROWS} 个文件未内联，可通过本地 read_file 或同步状态台账查询）`
      );
    }

    const markdown = [
      "# Remote Workspace Catalog ([SHAREPOINT REMOTE WORKSPACE] 完整清单)",
      "",
      `- 工作区绝对路径: ${workspaceRoot.replace(/\\/g, "/")}`,
      `- 云端工作区根直链: ${remoteRootUrl}`,
      `- 统计: 工作区文件 ${rows.length} | 已同步可索引 ${syncedIndexable} | 本地独有 ${localOnly} | 不可索引 ${unindexable}`,
      `- 生成时间: ${new Date().toISOString()}`,
      "",
      "## 1. 工作区目录结构 (Directory Skeleton)",
      skeletonLines.join("\n"),
      "",
      "## 2. 文件映射清单 (File Mapping Index)",
      rowLines.join("\n"),
      "",
      "Guidance: CLOUD-READY 文件可通过其 WebUrl 直接云端检索；LOCAL-ONLY/CLOUD-UNINDEXABLE 文件按需用 read_file 读取。",
    ].join("\n");

    return {
      markdown,
      stats: {
        totalFiles: rows.length,
        syncedIndexable,
        localOnly,
        unindexable,
      },
    };
  }

  /**
   * Builds a bounded inline [SHAREPOINT REMOTE WORKSPACE] map for the Turn-1 prompt.
   *
   * The inline map keeps the reading path deterministic (the model can see file
   * paths and WebUrls immediately), while a hard character budget guarantees the
   * first prompt stays under Copilot's input limit. Files outside the task scope
   * are ordered after scoped files, and the overflow points at the catalog
   * attachment instead of silently disappearing.
   */
  public static buildBoundedRepoMap(opts: {
    workspaceRoot: string;
    task?: string;
    maxChars?: number;
  }): string {
    const maxChars =
      opts.maxChars ??
      (Number(process.env.CPH_TURN1_INDEX_MAX_CHARS) > 0
        ? Number(process.env.CPH_TURN1_INDEX_MAX_CHARS)
        : 24000);

    const manifestPath = path.join(opts.workspaceRoot, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    const siteUrl = manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder = manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      origin = siteUrl.replace(/\/$/, "");
    }
    let sitePath = "";
    try {
      sitePath = new URL(siteUrl).pathname.replace(/\/$/, "");
    } catch {
      sitePath = "";
    }
    const folderClean = targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const prefix = folderClean.startsWith("sites/")
      ? `/${folderClean}`
      : `${sitePath}/${folderClean}`;
    const normalizedPrefix = prefix.replace(/\/+/g, "/").replace(/\/$/, "");
    const encodedPrefix = encodeUrlPathSegments(normalizedPrefix);
    const remoteRootUrl = `${origin}${encodedPrefix ? `/${encodedPrefix}` : ""}`;

    const files = PnPWorkspaceSyncEngine.listWorkspaceFilesForCatalog(opts.workspaceRoot);
    const manifestFiles = manifest?.files || {};
    const scopePrefix = PnPWorkspaceSyncEngine.deriveTaskScopePrefix(
      opts.task || "",
      targetFolder,
      opts.workspaceRoot
    );

    const sourceExtensions = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".ps1", ".psm1", ".psd1",
      ".cs", ".csproj", ".sln", ".go", ".rs", ".java", ".kt", ".sql", ".json", ".yaml",
      ".yml", ".toml", ".sh", ".bat", ".md", ".html", ".css", ".vue", ".xml",
    ]);

    type Row = { rel: string; size: number; status: string; url: string; inScope: boolean; isSource: boolean; mtime: number };
    const rows: Row[] = [];
    for (const rel of files) {
      let size = 0;
      let mtime = 0;
      try {
        const stat = fs.statSync(path.join(opts.workspaceRoot, rel));
        size = stat.size;
        mtime = stat.mtimeMs;
      } catch {}

      if (isNonIndexableBinary(rel)) {
        rows.push({ rel, size, status: "CLOUD-UNINDEXABLE", url: "", inScope: false, isSource: false, mtime });
        continue;
      }

      const entry = manifestFiles[rel];
      const underCurrent = Boolean(
        entry?.serverRelativeUrl &&
          entry.serverRelativeUrl.replace(/\\/g, "/").startsWith(`${normalizedPrefix}/`)
      );
      const status = entry ? (underCurrent ? "CLOUD-READY" : "CLOUD-STALE") : "LOCAL-ONLY";
      const url =
        status === "CLOUD-READY"
          ? `${remoteRootUrl}/${encodeUrlPathSegments(rel)}`
          : "";
      const inScope = Boolean(scopePrefix && (rel === scopePrefix || rel.startsWith(`${scopePrefix}/`)));
      const ext = path.extname(rel).toLowerCase();
      rows.push({ rel, size, status, url, inScope, isSource: sourceExtensions.has(ext), mtime });
    }

    rows.sort((a, b) => {
      if (a.inScope !== b.inScope) return a.inScope ? -1 : 1;
      const aUp = a.status === "CLOUD-READY" || a.status === "LOCAL-ONLY";
      const bUp = b.status === "CLOUD-READY" || b.status === "LOCAL-ONLY";
      if (aUp !== bUp) return aUp ? -1 : 1;
      if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      return a.rel.localeCompare(b.rel);
    });

    const header = [
      "[SHAREPOINT REMOTE WORKSPACE]",
      `Remote Root URL: ${remoteRootUrl}`,
      `Files: ${rows.length} | Inline budget: ${maxChars} chars${scopePrefix ? ` | Task scope: ${scopePrefix}` : ""}`,
      "",
      "Files Index:",
    ].join("\n");

    const lines: string[] = [];
    let used = header.length + 1;
    let inlineCount = 0;
    for (const row of rows) {
      const sizeKb = (row.size / 1024).toFixed(1);
      const urlPart = row.url ? ` | Web: ${row.url}` : "";
      const line = `- ${row.rel} (Size: ${sizeKb}KB | [${row.status}]${urlPart})`;
      // +1 for the newline
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
      inlineCount++;
    }

    if (inlineCount < rows.length) {
      lines.push(
        `- ... (其余 ${rows.length - inlineCount} 个文件见附件 remote-workspace-catalog.md，或按需 read_file 读取)`
      );
    }

    return `${header}\n${lines.join("\n")}\n`;
  }

  /**
   * Derives a workspace-relative scope prefix from a task containing a
   * SharePoint URL (AllItems?id=...) or an existing workspace path.
   */
  public static deriveTaskScopePrefix(
    task: string,
    targetFolder: string,
    workspaceRoot?: string
  ): string | undefined {
    if (!task) return undefined;
    const folderName = targetFolder.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";

    const urlMatch = task.match(/https?:\/\/[^\s)>"']+/i);
    if (urlMatch) {
      let decodedPath = "";
      try {
        const parsed = new URL(urlMatch[0]);
        const idParam = parsed.searchParams.get("id");
        decodedPath = decodeURIComponent(idParam || parsed.pathname);
      } catch {
        decodedPath = urlMatch[0];
      }
      const workSpaceIdx = decodedPath.toLowerCase().indexOf("/workspace/");
      if (workSpaceIdx >= 0) {
        const after = decodedPath
          .slice(workSpaceIdx + "/workspace/".length)
          .split("/")
          .filter(Boolean);
        // The first segment is the cloud folder name when present; otherwise the
        // whole remainder is already workspace-relative.
        const rest = folderName && after[0] === folderName ? after.slice(1) : after;
        if (rest.length > 0) return rest.join("/");
      }
      const decodedParts = decodedPath.split("/").filter(Boolean);
      if (folderName) {
        const idx = decodedParts.indexOf(folderName);
        if (idx >= 0 && idx + 1 < decodedParts.length) {
          return decodedParts.slice(idx + 1).join("/");
        }
      }
    }

    const pathMatch = task.match(/(?:^|[\s`"'（(])([A-Za-z0-9_.\- ]+\/[A-Za-z0-9_.\-/ ]+)/);
    if (pathMatch) {
      const candidate = pathMatch[1].trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (workspaceRoot) {
        try {
          if (!fs.statSync(path.join(workspaceRoot, candidate)).isDirectory()) return undefined;
        } catch {
          return undefined;
        }
      }
      return candidate;
    }
    return undefined;
  }

  /** Enumerates workspace files for catalog generation without relying on the sync manifest. */  private static listWorkspaceFilesForCatalog(workspaceRoot: string): string[] {
    const files = new Set<string>();
    let gitSucceeded = false;

    try {
      const gitOut = execSync("git ls-files --cached --others --exclude-standard", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      gitSucceeded = true;
      for (const line of gitOut.split(/\r?\n/)) {
        const rel = line.trim().replace(/\\/g, "/");
        if (rel) files.add(rel);
      }
    } catch {
      // Non-git workspaces fall back to the recursive walk below.
    }

    const ignoredDirs = new Set([".git", ".cph", "node_modules", "dist", "package"]);
    const walk = (dir: string, relPrefix: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue;
          walk(path.join(dir, entry.name), rel);
        } else if (entry.isFile()) {
          files.add(rel.replace(/\\/g, "/"));
        }
      }
    };

    if (!gitSucceeded) {
      walk(workspaceRoot, "");
    }

    const libraryDir = path.join(workspaceRoot, "Library");
    if (fs.existsSync(libraryDir)) {
      walk(libraryDir, "Library");
    }

    return [...files]
      .filter((rel) => {
        if (/(^|\/)(\.git|\.cph|node_modules|dist|package)(\/|$)/.test(rel)) return false;
        try {
          return fs.statSync(path.join(workspaceRoot, rel)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  }
}
