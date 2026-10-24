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
      fs.mkdirSync(path.join(tmpWorkspace, "Library", "ref"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "dist", "bin"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorkspace, "ignored-dir"), { recursive: true });

      spawnSync("git", ["init"], { cwd: tmpWorkspace });
      fs.writeFileSync(path.join(tmpWorkspace, ".gitignore"), "ignored-dir/\n");

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
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] .git");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] .cph");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] node_modules");
      expect(res.stdout).not.toContain("[LOCAL-FOLDER] Library");
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
});
