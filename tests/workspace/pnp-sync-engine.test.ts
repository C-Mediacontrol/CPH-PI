import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PnPWorkspaceSyncEngine, type SyncManifest } from "../../src/workspace/pnp-sync-engine.ts";

describe("PnPWorkspaceSyncEngine Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pnp-sync-unit-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should calculate correct SHA256 hash", () => {
    const testFile = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(testFile, "Hello Antigravity PnP", "utf8");
    const hash = PnPWorkspaceSyncEngine.getFileSha256(testFile);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
  });

  it("should load and save sync-manifest.json idempotently", () => {
    const manifestPath = path.join(tmpDir, ".cph", "state", "sync-manifest.json");
    const initial = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    expect(initial).toBeNull();

    const sampleManifest: SyncManifest = {
      version: 1,
      lastPrewarmAt: new Date().toISOString(),
      siteUrl: PnPWorkspaceSyncEngine.DEFAULT_SITE_URL,
      targetFolder: PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER,
      files: {
        "src/calc.py": {
          sha256: "abc1234567890",
          size: 250,
          uniqueId: "guid-1111",
          lastSyncedAt: new Date().toISOString(),
        },
      },
    };

    PnPWorkspaceSyncEngine.saveManifest(manifestPath, sampleManifest);
    const loaded = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(2);
    expect(loaded?.folders).toEqual({});
    expect(loaded?.files["src/calc.py"].uniqueId).toBe("guid-1111");

    // Backward compatibility: load legacy version 1 manifest and ensure auto-upgrade to version 2
    const legacyPath = path.join(tmpDir, ".cph", "state", "legacy-manifest.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        version: 1,
        files: { "legacy.txt": { sha256: "123", size: 50 } },
      }),
      "utf8"
    );
    const upgraded = PnPWorkspaceSyncEngine.loadManifest(legacyPath);
    expect(upgraded?.version).toBe(2);
    expect(upgraded?.folders).toEqual({});
    expect(upgraded?.files["legacy.txt"]).toBeDefined();
  });

  it("should generate clean Virtual Repo Map Markdown", () => {
    const sampleManifest: SyncManifest = {
      version: 1,
      siteUrl: "https://example.sharepoint.com/sites/TestSite",
      targetFolder: "/sites/TestSite/Shared Documents/WorkSpace",
      files: {
        "main.py": {
          sha256: "hash1",
          size: 2048,
          uniqueId: "guid-main",
        },
        "utils/math.py": {
          sha256: "hash2",
          size: 1024,
          uniqueId: "guid-math",
        },
      },
    };

    const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(
      sampleManifest,
      sampleManifest.siteUrl,
      sampleManifest.targetFolder
    );

    expect(map).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(map).toContain("Total Files: 2");
    expect(map).toContain("main.py (Size: 2.0KB | UniqueId: guid-main");
    expect(map).toContain("utils/math.py (Size: 1.0KB | UniqueId: guid-math");
    expect(map).toContain("Guidance: All repository files are grounded at the SharePoint paths above.");
  });

  it("should execute Mock Prewarm, skip on second run, and prune orphans", async () => {
    const file1 = path.join(tmpDir, "fileA.txt");
    const subDir = path.join(tmpDir, "nested");
    fs.mkdirSync(subDir, { recursive: true });
    const file2 = path.join(subDir, "fileB.txt");

    fs.writeFileSync(file1, "Content A", "utf8");
    fs.writeFileSync(file2, "Content B", "utf8");

    const engine = new PnPWorkspaceSyncEngine();

    // 1. First Prewarm: 2 files synced and 1 folder synced
    const rep1 = await engine.prewarm({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(rep1.totalLocal).toBe(2);
    expect(rep1.syncedCount).toBe(2);
    expect(rep1.skippedCount).toBe(0);
    expect(rep1.prunedCount).toBe(0);
    expect(rep1.totalLocalFolders).toBe(1);
    expect(rep1.syncedFoldersCount).toBe(1);
    expect(rep1.prunedFoldersCount).toBe(0);
    expect(rep1.folderResults).toBeDefined();

    // Verify virtual-repo-map.md was written
    const mapPath = path.join(tmpDir, ".cph", "state", "virtual-repo-map.md");
    expect(fs.existsSync(mapPath)).toBe(true);
    const mapText = fs.readFileSync(mapPath, "utf8");
    expect(mapText).toContain("fileA.txt");
    expect(mapText).toContain("nested/fileB.txt");
    expect(mapText).toContain("### [DIRECTORIES / EMPTY FOLDERS]");
    expect(mapText).toContain("nested");

    // 2. Second Prewarm: unchanged files and folders should be skipped
    const rep2 = await engine.prewarm({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(rep2.totalLocal).toBe(2);
    expect(rep2.syncedCount).toBe(0);
    expect(rep2.skippedCount).toBe(2);
    expect(rep2.prunedCount).toBe(0);
    expect(rep2.syncedFoldersCount).toBe(0);
    expect(rep2.prunedFoldersCount).toBe(0);

    // 3. Inject orphan file and orphan folder into manifest and verify pruning
    const manifestPath = path.join(tmpDir, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath)!;
    manifest.files["orphan_ghost.txt"] = {
      sha256: "fakehash",
      size: 999,
      uniqueId: "ghost-guid",
    };
    manifest.folders!["ghost_folder"] = {
      lastSyncedAt: new Date().toISOString(),
    };
    PnPWorkspaceSyncEngine.saveManifest(manifestPath, manifest);

    const rep3 = await engine.prewarm({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(rep3.prunedCount).toBe(1);
    expect(rep3.prunedFoldersCount).toBe(1);
    const updatedManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath)!;
    expect(updatedManifest.files["orphan_ghost.txt"]).toBeUndefined();
    expect(updatedManifest.folders?.["ghost_folder"]).toBeUndefined();
  }, 30000);

  it("should support syncFolder for standalone directory in mock mode", async () => {
    const engine = new PnPWorkspaceSyncEngine();
    const res = await engine.syncFolder(tmpDir, "src/components/empty-widget", undefined, {
      mockTransport: true,
    });

    expect(res.status).toBe("synced");
    expect(res.relativePath).toBe("src/components/empty-widget");

    const manifestPath = path.join(tmpDir, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
    expect(manifest?.folders?.["src/components/empty-widget"]).toBeDefined();
  }, 30000);

  it("should generate virtual repo map containing empty directories", () => {
    const manifest: SyncManifest = {
      version: 2,
      files: {
        "README.md": { sha256: "h1", size: 100, uniqueId: "g1" },
      },
      folders: {
        "src/empty-box": { lastSyncedAt: new Date().toISOString() },
      },
    };
    const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(
      manifest,
      "https://site",
      "/target"
    );
    expect(map).toContain("src/empty-box");
    expect(map).toContain("### [DIRECTORIES / EMPTY FOLDERS]");
  });

  it("should sync a single file and pull a file in mock transport mode", async () => {
    const singleFile = path.join(tmpDir, "single.txt");
    fs.writeFileSync(singleFile, "Single Content", "utf8");

    const engine = new PnPWorkspaceSyncEngine();

    const syncRes = await engine.syncFile(tmpDir, "single.txt", undefined, {
      mockTransport: true,
    });

    expect(syncRes.status).toBe("synced");
    expect(syncRes.uniqueId).toBeDefined();

    const pullRes = await engine.pullFile(tmpDir, "downloaded.txt", undefined, {
      mockTransport: true,
    });

    expect(pullRes.status).toBe("synced");
    const pulledPath = path.join(tmpDir, "downloaded.txt");
    expect(fs.existsSync(pulledPath)).toBe(true);
    expect(fs.readFileSync(pulledPath, "utf8")).toBe("MOCK PULL CONTENT");
  }, 30000);
});

