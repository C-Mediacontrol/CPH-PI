import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";
const POWERSHELL_EXE = "powershell.exe";
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "sp-sync-engine.ps1");
const PNP_SESSION_MODULE = path.join(REPO_ROOT, "scripts", "lib", "PnPSession.psm1");

function runPowerShell(args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(POWERSHELL_EXE, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

describe("SharePoint Physical Sync Engine Suite (sp-sync-engine.ps1)", () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "sp-sync-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Environment & Parameter Assertions", () => {
    it("should succeed running under Windows PowerShell 5.1", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      // Running -Action SyncWorkspace with empty workspace in Mock mode should execute without PS version error
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-MockTransport",
      ]);
      expect(res.status).toBe(0);
      expect(res.stderr).not.toContain("FATAL: sp-sync-engine.ps1 必须使用 powershell.exe");
    });

    it("should assert and throw fatal error if PSVersion is not 5.1 (e.g. executed with pwsh / PS7+)", () => {
      const pwshCheck = spawnSync("where.exe", ["pwsh"], { encoding: "utf8" });
      if (pwshCheck.status === 0 && pwshCheck.stdout.trim().length > 0) {
        const res = spawnSync("pwsh.exe", [
          "-NoProfile",
          "-File", SCRIPT_PATH,
          "-Action", "SyncWorkspace",
          "-WorkspaceRoot", tmpWorkspace,
          "-MockTransport",
        ], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        });
        expect(res.status).not.toBe(0);
        const combined = (res.stdout || "") + (res.stderr || "");
        expect(combined).toContain("FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+).");
      } else {
        const scriptContent = fs.readFileSync(SCRIPT_PATH, "utf8");
        expect(scriptContent).toContain("if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1)");
        expect(scriptContent).toContain("FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+).");
      }
    });

    it("should reject invalid Action with ValidateSet error", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "InvalidActionName",
        "-WorkspaceRoot", tmpWorkspace,
        "-MockTransport",
      ]);
      expect(res.status).not.toBe(0);
    });
  });

  describe("2. PnPSession Windows ACL Isolation", () => {
    it("should protect access rules and restrict ACL to current user on Windows", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const testCacheFile = path.join(tmpWorkspace, ".cph", "test-pnp-session.json");
      const psScript = `
        Import-Module '${PNP_SESSION_MODULE.replace(/'/g, "''")}' -Force
        $cookies = @(
          [PSCustomObject]@{ Name = 'FedAuth'; Value = 'test-token'; Domain = 'sharepoint.com'; Path = '/' }
        )
        Write-DpsSessionCache -SiteUrl 'https://tenant.sharepoint.com/sites/test' -Cookies $cookies -CacheFile '${testCacheFile.replace(/'/g, "''")}'
        
        $acl = Get-Acl '${testCacheFile.replace(/'/g, "''")}'
        Write-Output "AreAccessRulesProtected=$($acl.AreAccessRulesProtected)"
        Write-Output "AccessCount=$($acl.Access.Count)"
      `;
      const res = runPowerShell(["-Command", psScript]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AreAccessRulesProtected=True");
      expect(fs.existsSync(testCacheFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(testCacheFile, "utf8"));
      expect(content.SiteUrl).toBe("https://tenant.sharepoint.com/sites/test");
      expect(content.Cookies.length).toBe(1);
      expect(content.Cookies[0].Name).toBe("FedAuth");
    });
  });

  describe("3. Incremental State Manifest Management", () => {
    it("should sync files on initial run and populate sync-manifest.json", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      // Create test files in tmpWorkspace
      const file1 = path.join(tmpWorkspace, "src", "index.ts");
      const file2 = path.join(tmpWorkspace, "README.md");
      fs.mkdirSync(path.dirname(file1), { recursive: true });
      fs.writeFileSync(file1, "console.log('hello');\n");
      fs.writeFileSync(file2, "# Test Workspace\n");

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[SYNCED] src/index.ts");
      expect(res.stdout).toContain("[SYNCED] README.md");

      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.version).toBe(2);
      expect(manifest.files["src/index.ts"]).toBeDefined();
      expect(manifest.files["src/index.ts"].sha256).toBeDefined();
      expect(manifest.files["README.md"]).toBeDefined();
      expect(manifest.files["README.md"].sha256).toBeDefined();
    });

    it("should skip unchanged files on second run and only sync modified files", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const file1 = path.join(tmpWorkspace, "src", "app.ts");
      const file2 = path.join(tmpWorkspace, "docs", "guide.md");
      fs.mkdirSync(path.dirname(file1), { recursive: true });
      fs.mkdirSync(path.dirname(file2), { recursive: true });
      fs.writeFileSync(file1, "export const app = 1;\n");
      fs.writeFileSync(file2, "# Guide\n");

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      // Initial run
      runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      // Second run: no changes
      const res2 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res2.status).toBe(0);
      expect(res2.stdout).toContain("[SKIP] src/app.ts");
      expect(res2.stdout).toContain("[SKIP] docs/guide.md");
      expect(res2.stdout).not.toContain("[SYNCED]");

      // Modify only file1
      fs.writeFileSync(file1, "export const app = 2; // updated\n");

      // Third run: only file1 should sync
      const res3 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res3.status).toBe(0);
      expect(res3.stdout).toContain("[SYNCED] src/app.ts");
      expect(res3.stdout).toContain("[SKIP] docs/guide.md");

      // Verify manifest was updated with new sha256 for file1
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.files["src/app.ts"].sha256).toBeDefined();
    });

    it("should handle SyncSingleFile accurately", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const singleFile = path.join(tmpWorkspace, "config.json");
      fs.writeFileSync(singleFile, '{"port": 8080}\n');

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      // Sync single file first time
      const res1 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncSingleFile",
        "-SourceFile", "config.json",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res1.status).toBe(0);
      expect(res1.stdout).toContain("[SYNCED] config.json");

      // Sync single file second time without change
      const res2 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncSingleFile",
        "-SourceFile", "config.json",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res2.status).toBe(0);
      expect(res2.stdout).toContain("[SKIP] config.json");
    });
  });

  describe("4. Failure Handling & Dirty Sync Logging", () => {
    it("should retry up to 3 times and append failure to dirty-sync.jsonl without fatal crash", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const goodFile = path.join(tmpWorkspace, "good.txt");
      const badFile = path.join(tmpWorkspace, "bad.txt");
      fs.writeFileSync(goodFile, "good content\n");
      fs.writeFileSync(badFile, "bad content\n");

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      const dirtyLogPath = path.join(tmpWorkspace, ".cph", "state", "dirty-sync.jsonl");

      // Configure mock failure for bad.txt
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-DirtyLogPath", dirtyLogPath,
        "-MockTransport",
      ], {
        SP_SYNC_MOCK_FAIL_FILE: "*bad.txt*",
      });

      // Script should exit cleanly (not throw fatal terminating error)
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[SYNCED] good.txt");
      expect(res.stdout).toContain("[ERROR] Failed to sync bad.txt after 3 attempts");

      // Verify dirty log was written
      expect(fs.existsSync(dirtyLogPath)).toBe(true);
      const lines = fs.readFileSync(dirtyLogPath, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const parsedLog = JSON.parse(lines[0]);
      expect(parsedLog.file).toBe("bad.txt");
      expect(parsedLog.attempts).toBe(3);
      expect(parsedLog.error).toBeDefined();
      expect(parsedLog.timestamp).toBeDefined();
    });
  });

  describe("5. Folder Dual-Track & EnsureFolder Action (Task 1)", () => {
    it("should support -Action EnsureFolder in Mock mode and register into manifest", () => {
      if (!IS_WINDOWS) return;
      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "EnsureFolder",
        "-SourceFolder", "src/empty-dir",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[FOLDER-SYNCED] src/empty-dir");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.version).toBe(2);
      expect(manifest.folders["src/empty-dir"]).toBeDefined();
      expect(manifest.folders["src/empty-dir"].lastSyncedAt).toBeDefined();
    });

    it("should extract local folders excluding internal and git-ignored directories via Get-LocalFolders", () => {
      if (!IS_WINDOWS) return;
      fs.mkdirSync(path.join(tmpWorkspace, "src", "empty-dir"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "docs", "specs"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, ".git", "objects"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, ".cph", "state"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "node_modules", "pkg"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "Library", "docs"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "dist", "bin"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "ignored-dir"), { recursive: true });

      spawnSync("git", ["init"], { cwd: tmpWorkspace });
      fs.writeFileSync(path.join(tmpWorkspace, ".gitignore"), "ignored-dir/\nLibrary/\n");

      const psScript = `
        . '${SCRIPT_PATH.replace(/'/g, "''")}' -Action 'EnsureFolder' -SourceFolder 'init' -WorkspaceRoot '${tmpWorkspace.replace(/'/g, "''")}' -MockTransport | Out-Null
        $localFolders = Get-LocalFolders -WorkspaceRoot '${tmpWorkspace.replace(/'/g, "''")}'
        $localFolders.Keys | ForEach-Object { Write-Output "[LOCAL-FOLDER] $_" }
      `;
      const res = runPowerShell(["-Command", psScript]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[LOCAL-FOLDER] src");
      expect(res.stdout).toContain("[LOCAL-FOLDER] src/empty-dir");
      expect(res.stdout).toContain("[LOCAL-FOLDER] docs");
      expect(res.stdout).toContain("[LOCAL-FOLDER] docs/specs");
      expect(res.stdout).toContain("[LOCAL-FOLDER] Library");
      expect(res.stdout).toContain("[LOCAL-FOLDER] Library/docs");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] .git");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] .cph");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] node_modules");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] dist");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] ignored-dir");
    });

    it("should upgrade manifest from version 1 to 2 seamlessly when EnsureFolder executes", () => {
      if (!IS_WINDOWS) return;
      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          version: 1,
          files: {
            "existing.ts": { sha256: "hash123", size: 42, uniqueId: "u-1" },
          },
        })
      );

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "EnsureFolder",
        "-SourceFolder", "packages/core",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[FOLDER-SYNCED] packages/core");
      const upgraded = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(upgraded.version).toBe(2);
      expect(upgraded.files["existing.ts"]).toBeDefined();
      expect(upgraded.files["existing.ts"].sha256).toBe("hash123");
      expect(upgraded.folders["packages/core"]).toBeDefined();
      expect(upgraded.folders["packages/core"].lastSyncedAt).toBeDefined();
    });
  });

  describe("6. Three-Phase Dual-Track Sync Pipeline (Task 2)", () => {
    it("should actively sync local empty folders during Prewarm/SyncWorkspace", () => {
      if (!IS_WINDOWS) return;
      const emptySub = path.join(tmpWorkspace, "components", "empty-box");
      fs.mkdirSync(emptySub, { recursive: true });

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[FOLDER-SYNCED] components/empty-box");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.folders["components/empty-box"]).toBeDefined();
    });

    it("DEFENSE INVARIANT: should retain local empty folders when other files are pruned", () => {
      if (!IS_WINDOWS) return;
      const emptySub = path.join(tmpWorkspace, "preserved-empty");
      fs.mkdirSync(emptySub, { recursive: true });

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      // 初始运行：写入 emptySub
      runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      // 人工在 manifest 中模拟一个孤儿文件，触发 prunedCount > 0
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.files["orphan.txt"] = { sha256: "fake", size: 10, uniqueId: "g1" };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

      // 第二次运行，触发 pruning
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[PRUNED] orphan.txt");
      // 验证核心不变性：本地存在的空目录绝对安全保留
      expect(res.stdout).not.toContain("[FOLDER-RECYCLED] preserved-empty");
      const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(updated.folders["preserved-empty"]).toBeDefined();
    });

    it("should recycle true orphan folders bottom-up (deepest first)", () => {
      if (!IS_WINDOWS) return;
      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      // 模拟云端历史清单存在 a/b/c 嵌套目录，但在本地该目录已被完全删除
      const manifest = {
        version: 2,
        files: {},
        folders: {
          "nested/sub/leaf": { lastSyncedAt: new Date().toISOString() },
          "nested/sub": { lastSyncedAt: new Date().toISOString() },
          "nested": { lastSyncedAt: new Date().toISOString() },
        },
      };
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      // 验证回收日志包含所有孤儿目录，且从清单中抹除
      expect(res.stdout).toContain("[FOLDER-RECYCLED] nested/sub/leaf");
      expect(res.stdout).toContain("[FOLDER-RECYCLED] nested/sub");
      expect(res.stdout).toContain("[FOLDER-RECYCLED] nested");

      const recycledLines = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("[FOLDER-RECYCLED]"));
      expect(recycledLines).toEqual([
        "[FOLDER-RECYCLED] nested/sub/leaf",
        "[FOLDER-RECYCLED] nested/sub",
        "[FOLDER-RECYCLED] nested",
      ]);

      const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(updated.folders["nested/sub/leaf"]).toBeUndefined();
      expect(updated.folders["nested/sub"]).toBeUndefined();
      expect(updated.folders["nested"]).toBeUndefined();
    });
  });

  describe("7. Library Inclusion, Binary Filtering & Real Metadata Extraction (Task 2B)", () => {
    it("should sync indexable files in git-ignored Library/ while filtering out non-indexable binary/archive extensions", () => {
      if (!IS_WINDOWS) return;
      spawnSync("git", ["init"], { cwd: tmpWorkspace });
      fs.writeFileSync(path.join(tmpWorkspace, ".gitignore"), "Library/\n");

      // Create indexable files inside Library/
      const refMd = path.join(tmpWorkspace, "Library", "docs", "ref.md");
      const helperTs = path.join(tmpWorkspace, "Library", "helpers", "util.ts");
      fs.mkdirSync(path.dirname(refMd), { recursive: true });
      fs.mkdirSync(path.dirname(helperTs), { recursive: true });
      fs.writeFileSync(refMd, "# API Reference Doc\n");
      fs.writeFileSync(helperTs, "export const helper = true;\n");

      // Create non-indexable binary/archive extensions inside Library/
      const binDir = path.join(tmpWorkspace, "Library", "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const binaryFiles = [
        "native.dylib",
        "archive.zip",
        "model.onnx",
        "lib.dll",
      ];
      for (const bf of binaryFiles) {
        fs.writeFileSync(path.join(binDir, bf), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      }

      // Create standard workspace file
      const appTs = path.join(tmpWorkspace, "src", "index.ts");
      fs.mkdirSync(path.dirname(appTs), { recursive: true });
      fs.writeFileSync(appTs, "console.log('main');\n");

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);

      expect(res.status).toBe(0);
      // Indexable files inside git-ignored Library/ must be synced
      expect(res.stdout).toContain("[SYNCED] Library/docs/ref.md");
      expect(res.stdout).toContain("[SYNCED] Library/helpers/util.ts");
      expect(res.stdout).toContain("[SYNCED] src/index.ts");

      // Binary and archive files must be filtered out
      expect(res.stdout).not.toContain("native.dylib");
      expect(res.stdout).not.toContain("archive.zip");
      expect(res.stdout).not.toContain("model.onnx");
      expect(res.stdout).not.toContain("lib.dll");

      // Verify sync-manifest.json state
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.files["Library/docs/ref.md"]).toBeDefined();
      expect(manifest.files["Library/helpers/util.ts"]).toBeDefined();
      expect(manifest.files["src/index.ts"]).toBeDefined();

      expect(manifest.files["Library/bin/native.dylib"]).toBeUndefined();
      expect(manifest.files["Library/bin/archive.zip"]).toBeUndefined();
      expect(manifest.files["Library/bin/model.onnx"]).toBeUndefined();
      expect(manifest.files["Library/bin/lib.dll"]).toBeUndefined();
    });

    it("should record valid 36-char GUID uniqueId, serverRelativeUrl, and firstCreatedAt in sync-manifest.json during SyncWorkspace, and preserve firstCreatedAt on update", async () => {
      if (!IS_WINDOWS) return;
      const testFile = path.join(tmpWorkspace, "src", "service.ts");
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, "export class Service {}\n");

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      // Initial SyncWorkspace
      const res1 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res1.status).toBe(0);
      expect(res1.stdout).toContain("[SYNCED] src/service.ts");

      const manifest1 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const entry1 = manifest1.files["src/service.ts"];
      expect(entry1).toBeDefined();

      const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      expect(entry1.uniqueId).toMatch(guidRegex);
      expect(entry1.uniqueId.length).toBe(36);
      expect(entry1.serverRelativeUrl).toBeDefined();
      expect(entry1.serverRelativeUrl).toContain("src/service.ts");
      expect(entry1.firstCreatedAt).toBeDefined();
      expect(new Date(entry1.firstCreatedAt).toString()).not.toBe("Invalid Date");

      const initialCreatedAt = entry1.firstCreatedAt;

      // Wait 1.1s so clock passes 1-second boundary for lastSyncedAt
      await new Promise((r) => setTimeout(r, 1100));

      // Modify the file and re-sync
      fs.writeFileSync(testFile, "export class Service { run() { return 42; } }\n");

      const res2 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncWorkspace",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res2.status).toBe(0);
      expect(res2.stdout).toContain("[SYNCED] src/service.ts");

      const manifest2 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const entry2 = manifest2.files["src/service.ts"];
      expect(entry2).toBeDefined();
      expect(entry2.firstCreatedAt).toBe(initialCreatedAt);
      expect(entry2.uniqueId).toMatch(guidRegex);
      expect(entry2.uniqueId.length).toBe(36);
      expect(entry2.serverRelativeUrl).toContain("src/service.ts");
      expect(entry2.sha256).not.toBe(entry1.sha256);
      expect(new Date(entry2.lastSyncedAt).getTime()).toBeGreaterThanOrEqual(new Date(initialCreatedAt).getTime());
    });

    it("should record valid 36-char GUID uniqueId, serverRelativeUrl, and firstCreatedAt in sync-manifest.json during SyncSingleFile, and preserve firstCreatedAt on update", async () => {
      if (!IS_WINDOWS) return;
      const testFile = path.join(tmpWorkspace, "config", "settings.json");
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, '{"debug": true}\n');

      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

      // Initial SyncSingleFile
      const res1 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncSingleFile",
        "-SourceFile", "config/settings.json",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res1.status).toBe(0);
      expect(res1.stdout).toContain("[SYNCED] config/settings.json");

      const manifest1 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const entry1 = manifest1.files["config/settings.json"];
      expect(entry1).toBeDefined();

      const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      expect(entry1.uniqueId).toMatch(guidRegex);
      expect(entry1.uniqueId.length).toBe(36);
      expect(entry1.serverRelativeUrl).toBeDefined();
      expect(entry1.serverRelativeUrl).toContain("config/settings.json");
      expect(entry1.firstCreatedAt).toBeDefined();
      expect(new Date(entry1.firstCreatedAt).toString()).not.toBe("Invalid Date");

      const initialCreatedAt = entry1.firstCreatedAt;

      // Wait 1.1s so clock passes 1-second boundary for lastSyncedAt
      await new Promise((r) => setTimeout(r, 1100));

      // Modify the file and re-sync
      fs.writeFileSync(testFile, '{"debug": false, "version": 2}\n');

      const res2 = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "SyncSingleFile",
        "-SourceFile", "config/settings.json",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-MockTransport",
      ]);
      expect(res2.status).toBe(0);
      expect(res2.stdout).toContain("[SYNCED] config/settings.json");

      const manifest2 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const entry2 = manifest2.files["config/settings.json"];
      expect(entry2).toBeDefined();
      expect(entry2.firstCreatedAt).toBe(initialCreatedAt);
      expect(entry2.uniqueId).toMatch(guidRegex);
      expect(entry2.uniqueId.length).toBe(36);
      expect(entry2.serverRelativeUrl).toContain("config/settings.json");
      expect(entry2.sha256).not.toBe(entry1.sha256);
      expect(new Date(entry2.lastSyncedAt).getTime()).toBeGreaterThanOrEqual(new Date(initialCreatedAt).getTime());
    });
  });

  describe("ReconcileUrls action", () => {
    it("rewrites stale serverRelativeUrl to the current target folder", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 2,
            siteUrl: "https://tenant.sharepoint.com/sites/test",
            targetFolder: "AFRASIA/WorkSpace/test_workspace",
            files: {
              "Library/a.ps1": {
                sha256: "abc",
                size: 1,
                serverRelativeUrl:
                  "/sites/test/AFRASIA/WorkSpace/test/Library/a.ps1",
              },
            },
            folders: {},
          },
          null,
          2
        ),
        "utf8"
      );

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "ReconcileUrls",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-SiteUrl", "https://tenant.sharepoint.com/sites/test",
        "-TargetFolder", "AFRASIA/WorkSpace/test_workspace",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("[RECONCILE] updated=1 total=1");
      expect(res.stdout).toContain("[RECONCILE-DIFF]");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.files["Library/a.ps1"].serverRelativeUrl).toBe(
        "/sites/test/AFRASIA/WorkSpace/test_workspace/Library/a.ps1"
      );
    });

    it("refuses to run without an explicit TargetFolder (protects manifest)", () => {
      if (!IS_WINDOWS) {
        expect(true).toBe(true);
        return;
      }
      const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      const before = JSON.stringify({
        version: 2,
        siteUrl: "https://tenant.sharepoint.com/sites/test",
        targetFolder: "AFRASIA/WorkSpace/test_workspace",
        files: {
          "Library/a.ps1": {
            sha256: "abc",
            size: 1,
            serverRelativeUrl: "/sites/test/AFRASIA/WorkSpace/test_workspace/Library/a.ps1",
          },
        },
        folders: {},
      });
      fs.writeFileSync(manifestPath, before, "utf8");

      const res = runPowerShell([
        "-File", SCRIPT_PATH,
        "-Action", "ReconcileUrls",
        "-WorkspaceRoot", tmpWorkspace,
        "-ManifestPath", manifestPath,
        "-SiteUrl", "https://tenant.sharepoint.com/sites/test",
      ]);

      expect(res.status).not.toBe(0);
      expect(res.stderr + res.stdout).toContain("explicit -TargetFolder");
      // Manifest must stay byte-identical.
      expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    });
  });
});
