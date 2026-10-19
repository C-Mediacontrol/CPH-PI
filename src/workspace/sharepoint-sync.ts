import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { TokenManager } from "../auth/token-manager.ts";
import { SubstrateUploader } from "../transport/substrate-uploader.ts";

export interface SharePointSyncOptions {
  workspaceRoot: string;
  targetFolder: string; // e.g. "AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/test"
  siteUrl?: string;
  accountEmail?: string;
  mode?: "standard" | "all" | "source_and_library_clean";
  mockTransport?: boolean;
  signal?: AbortSignal;
}

export interface SyncFileResult {
  relativePath: string;
  status: "synced" | "skipped" | "failed";
  size: number;
  sha256: string;
  webUrl?: string;
  error?: string;
}

export interface SyncReport {
  workspaceRoot: string;
  targetFolder: string;
  totalFound: number;
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  totalBytes: number;
  results: SyncFileResult[];
}

export interface SyncManifest {
  version: number;
  lastFullSync: string;
  files: Record<string, { sha256: string; lastSyncedAt: string; size: number }>;
}

export class SharePointSyncEngine {
  public static DEFAULT_SITE_URL = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";

  private tokenManager: TokenManager;

  constructor(tokenManager?: TokenManager) {
    this.tokenManager = tokenManager || new TokenManager();
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
  public static loadManifest(manifestPath: string): SyncManifest {
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf8");
        return JSON.parse(raw);
      } catch {
        // Fall back to clean manifest on corrupted file
      }
    }
    return {
      version: 1,
      lastFullSync: "",
      files: {},
    };
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
   * Record failure into dirty-sync.jsonl
   */
  public static appendDirtyLog(dirtyLogPath: string, file: string, error: string, attempts = 3): void {
    const dir = path.dirname(dirtyLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const logObj = {
      file,
      timestamp: new Date().toISOString(),
      error,
      attempts,
    };
    fs.appendFileSync(dirtyLogPath, JSON.stringify(logObj) + "\n", "utf8");
  }

  /**
   * Discover files to synchronize according to selected mode
   */
  public static discoverFiles(workspaceRoot: string, mode: "standard" | "all" | "source_and_library_clean" = "standard"): string[] {
    const normRoot = path.resolve(workspaceRoot);

    if (mode === "standard") {
      // Standard: tracked + untracked files respecting .gitignore
      try {
        const gitOutput = execSync("git ls-files --cached --others --exclude-standard", {
          cwd: normRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const lines = gitOutput
          .split("\n")
          .map((l) => l.trim().replace(/\\/g, "/"))
          .filter(Boolean);
        if (lines.length > 0) {
          return lines;
        }
      } catch {
        // Fall back to manual traversal
      }
    }

    // Manual recursive traversal
    const results: string[] = [];
    function traverse(currentDir: string) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(normRoot, fullPath).replace(/\\/g, "/");

        // Exclude system dirs
        if (/^(\.git|\.cph|node_modules|dist|package)(\/|$)/.test(relPath)) {
          continue;
        }

        if (mode === "source_and_library_clean") {
          // Exclude binary compilation artifacts in Library
          if (/(^|\/)(bin|obj|runtimes)(\/|$)/i.test(relPath) || /\.(dll|lib|pdb|exe|cache)$/i.test(relPath)) {
            continue;
          }
        }

        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile()) {
          results.push(relPath);
        }
      }
    }

    traverse(normRoot);
    return results;
  }

  /**
   * Parse target folder into { libraryName, folderSubpath }
   * e.g. "AFRASIA/01 Team/.../WorkSpace/test" -> library: "AFRASIA", subpath: "01 Team/.../WorkSpace/test"
   */
  public static parseTargetFolder(targetFolder: string): { libraryName: string; folderSubpath: string } {
    const cleaned = targetFolder.replace(/^[\\/]+/, "").replace(/\\/g, "/");
    const firstSlash = cleaned.indexOf("/");
    if (firstSlash === -1) {
      return { libraryName: cleaned, folderSubpath: "" };
    }
    const libraryName = cleaned.slice(0, firstSlash);
    const folderSubpath = cleaned.slice(firstSlash + 1);
    return { libraryName, folderSubpath };
  }

  /**
   * Run synchronization
   */
  public async syncWorkspace(options: SharePointSyncOptions): Promise<SyncReport> {
    const normRoot = path.resolve(options.workspaceRoot);
    const siteUrl = options.siteUrl || SharePointSyncEngine.DEFAULT_SITE_URL;
    const mode = options.mode || "standard";
    const manifestPath = path.join(normRoot, ".cph", "state", "sync-manifest.json");
    const dirtyLogPath = path.join(normRoot, ".cph", "state", "dirty-sync.jsonl");

    const manifest = SharePointSyncEngine.loadManifest(manifestPath);
    const files = SharePointSyncEngine.discoverFiles(normRoot, mode);

    const report: SyncReport = {
      workspaceRoot: normRoot,
      targetFolder: options.targetFolder,
      totalFound: files.length,
      syncedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      totalBytes: 0,
      results: [],
    };

    if (files.length === 0) {
      return report;
    }

    if (options.mockTransport) {
      for (const rel of files) {
        const fullPath = path.join(normRoot, rel);
        const stat = fs.statSync(fullPath);
        const sha256 = SharePointSyncEngine.getFileSha256(fullPath);
        report.totalBytes += stat.size;

        if (manifest.files[rel]?.sha256 === sha256) {
          report.skippedCount++;
          report.results.push({ relativePath: rel, status: "skipped", size: stat.size, sha256 });
        } else {
          manifest.files[rel] = { sha256, lastSyncedAt: new Date().toISOString(), size: stat.size };
          report.syncedCount++;
          report.results.push({ relativePath: rel, status: "synced", size: stat.size, sha256 });
        }
      }
      manifest.lastFullSync = new Date().toISOString();
      SharePointSyncEngine.saveManifest(manifestPath, manifest);
      return report;
    }

    // Live sync via Microsoft Graph API
    const accounts = this.tokenManager.loadAccounts();
    const account = options.accountEmail
      ? accounts.find((a) => a.email.toLowerCase() === options.accountEmail!.toLowerCase())
      : accounts[0];

    if (!account) {
      throw new Error("No Microsoft 365 Copilot account available in accounts.json");
    }

    const graphToken = await this.tokenManager.getGraphAccessToken(account.email);
    const siteHostname = new URL(siteUrl).hostname;
    const siteRelativePath = new URL(siteUrl).pathname.replace(/\/$/, "");

    // 1. Resolve site ID
    const siteLookupUrl = `https://graph.microsoft.com/v1.0/sites/${siteHostname}:${siteRelativePath}`;
    const siteRes = await fetch(siteLookupUrl, {
      headers: { Authorization: `Bearer ${graphToken}` },
      signal: options.signal,
    });
    if (!siteRes.ok) {
      throw new Error(`Failed to resolve SharePoint site ${siteUrl}: ${siteRes.status} ${siteRes.statusText}`);
    }
    const siteData = (await siteRes.json()) as any;
    const siteId = siteData.id;

    // 2. Resolve target document library drive
    const { libraryName, folderSubpath } = SharePointSyncEngine.parseTargetFolder(options.targetFolder);
    const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drives`, {
      headers: { Authorization: `Bearer ${graphToken}` },
      signal: options.signal,
    });
    if (!drivesRes.ok) {
      throw new Error(`Failed to list document libraries in site: ${drivesRes.status}`);
    }
    const drivesData = (await drivesRes.json()) as any;
    const drive = (drivesData.value || []).find((d: any) => d.name.toLowerCase() === libraryName.toLowerCase());
    if (!drive) {
      throw new Error(`Document library '${libraryName}' not found in SharePoint site`);
    }
    const driveId = drive.id;

    // 3. Process each file
    for (const rel of files) {
      if (options.signal?.aborted) {
        throw new Error("Sync aborted");
      }

      const fullPath = path.join(normRoot, rel);
      if (!fs.existsSync(fullPath)) continue;

      const stat = fs.statSync(fullPath);
      report.totalBytes += stat.size;
      const sha256 = SharePointSyncEngine.getFileSha256(fullPath);

      // Check if unchanged
      const cached = manifest.files[rel];
      if (cached && cached.sha256 === sha256) {
        report.skippedCount++;
        report.results.push({ relativePath: rel, status: "skipped", size: stat.size, sha256 });
        continue;
      }

      // Upload with retry
      let attempt = 0;
      let uploaded = false;
      let lastError = "";
      let webUrl = "";

      const remoteRelativePath = folderSubpath ? `${folderSubpath}/${rel}` : rel;
      const encodedRemotePath = encodeURIComponent(remoteRelativePath).replace(/%2F/g, "/");

      while (attempt < 3 && !uploaded) {
        attempt++;
        try {
          const fileBuffer = fs.readFileSync(fullPath);

          if (fileBuffer.byteLength <= SubstrateUploader.CLIENT_SPLIT_THRESHOLD_HYPOTHESIS) {
            // Simple PUT
            const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedRemotePath}:/content`;
            const uploadRes = await fetch(uploadUrl, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${graphToken}`,
                "Content-Type": "application/octet-stream",
              },
              body: fileBuffer,
              signal: options.signal,
            });

            if (!uploadRes.ok) {
              const errText = await uploadRes.text();
              throw new Error(`Upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`);
            }

            const uploadData = (await uploadRes.json()) as any;
            webUrl = uploadData.webUrl || "";
            uploaded = true;
          } else {
            // Resumable upload for files > 4MB
            const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedRemotePath}:/createUploadSession`;
            const sessionRes = await fetch(sessionUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${graphToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                item: {
                  "@microsoft.graph.conflictBehavior": "replace",
                  name: path.basename(rel),
                },
              }),
              signal: options.signal,
            });

            if (!sessionRes.ok) {
              const errText = await sessionRes.text();
              throw new Error(`Create upload session failed (${sessionRes.status}): ${errText.slice(0, 200)}`);
            }

            const sessionData = (await sessionRes.json()) as any;
            const uploadUrl = sessionData.uploadUrl;

            // Stream chunks
            const chunkSize = SubstrateUploader.CHUNK_SIZE;
            const total = fileBuffer.byteLength;
            let offset = 0;
            let finalDriveItem: any = null;

            while (offset < total) {
              const end = Math.min(offset + chunkSize, total);
              const chunk = fileBuffer.subarray(offset, end);
              const chunkRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                  "Content-Length": `${chunk.byteLength}`,
                  "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
                },
                body: chunk,
                signal: options.signal,
              });

              if (chunkRes.status === 200 || chunkRes.status === 201) {
                finalDriveItem = await chunkRes.json();
                break;
              } else if (chunkRes.status === 202) {
                offset = end;
              } else {
                const errText = await chunkRes.text();
                throw new Error(`Chunk upload failed (${chunkRes.status}): ${errText.slice(0, 200)}`);
              }
            }

            webUrl = finalDriveItem?.webUrl || "";
            uploaded = true;
          }
        } catch (err: any) {
          lastError = err.message || "Unknown error";
          if (attempt < 3) {
            await SubstrateUploader.sleepInterruptible(1000 * attempt, options.signal);
          }
        }
      }

      if (uploaded) {
        manifest.files[rel] = {
          sha256,
          lastSyncedAt: new Date().toISOString(),
          size: stat.size,
        };
        SharePointSyncEngine.saveManifest(manifestPath, manifest);
        report.syncedCount++;
        report.results.push({ relativePath: rel, status: "synced", size: stat.size, sha256, webUrl });
      } else {
        SharePointSyncEngine.appendDirtyLog(dirtyLogPath, rel, lastError, attempt);
        report.failedCount++;
        report.results.push({ relativePath: rel, status: "failed", size: stat.size, sha256, error: lastError });
      }
    }

    manifest.lastFullSync = new Date().toISOString();
    SharePointSyncEngine.saveManifest(manifestPath, manifest);
    return report;
  }
}

