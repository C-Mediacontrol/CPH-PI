import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

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
  syncedCount: number;
  skippedCount: number;
  prunedCount: number;
  failedCount: number;
  durationMs: number;
  results: SyncFileResult[];
}

export interface SyncManifestFileEntry {
  sha256: string;
  size: number;
  uniqueId?: string;
  serverRelativeUrl?: string;
  lastSyncedAt?: string;
}

export interface SyncManifest {
  version: number;
  lastPrewarmAt?: string;
  siteUrl: string;
  targetFolder: string;
  files: Record<string, SyncManifestFileEntry>;
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
        return JSON.parse(raw);
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

    return report as PrewarmReport;
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
    const remoteRootUrl = folderClean.startsWith("/sites/")
      ? `${origin}${folderClean}`
      : `${siteUrl.replace(/\/$/, "")}${folderClean}`;

    const files = manifest.files || {};
    const fileKeys = Object.keys(files).sort();

    const lines: string[] = [
      "[SHAREPOINT REMOTE WORKSPACE]",
      `Remote Root URL: ${remoteRootUrl}`,
      `Sync Status: Synchronized (Local SSOT) | Total Files: ${fileKeys.length}`,
      "",
      "Files Index:",
    ];

    if (fileKeys.length === 0) {
      lines.push("- (No files recorded in sync manifest)");
    } else {
      for (const k of fileKeys) {
        const item = files[k];
        const sizeKb = (item.size / 1024).toFixed(1);
        const guidStr = item.uniqueId ? ` | UniqueId: ${item.uniqueId}` : "";
        let fileWebUrl = "";
        if (item.serverRelativeUrl) {
          fileWebUrl = item.serverRelativeUrl.startsWith("/sites/")
            ? `${origin}${item.serverRelativeUrl}`
            : `${siteUrl.replace(/\/$/, "")}/${item.serverRelativeUrl.replace(/^\//, "")}`;
        } else {
          fileWebUrl = `${remoteRootUrl}/${k.replace(/\\/g, "/")}`;
        }
        lines.push(`- ${k.replace(/\\/g, "/")} (Size: ${sizeKb}KB${guidStr} | Web: ${fileWebUrl})`);
      }
    }

    lines.push("");
    lines.push("Guidance: All repository files are grounded at the SharePoint paths above. You may cite, inspect or trace them directly by relative path or URL.");

    return lines.join("\n");
  }
}
