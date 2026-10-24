import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PnPWorkspaceSyncEngine, encodeUrlPathSegments, type SyncManifest } from "../../src/workspace/pnp-sync-engine.ts";

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

  it("should URL-encode path segments containing spaces in Virtual Repo Map", () => {
    expect(encodeUrlPathSegments("Library/CNNJI QUERY/01 Team/query.sql")).toBe(
      "Library/CNNJI%20QUERY/01%20Team/query.sql"
    );
    expect(encodeUrlPathSegments("Library\\CNNJI QUERY\\01 Team\\query.sql")).toBe(
      "Library/CNNJI%20QUERY/01%20Team/query.sql"
    );

    const manifest: SyncManifest = {
      version: 2,
      siteUrl: "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN",
      targetFolder: "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/WorkSpace/live test",
      files: {
        "Library/CNNJI QUERY/01 Team/query.sql": {
          sha256: "hash123",
          size: 4096,
          uniqueId: "guid-query-1",
        },
      },
    };

    const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(
      manifest,
      manifest.siteUrl!,
      manifest.targetFolder!
    );

    expect(map).toContain("Remote Root URL: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/WorkSpace/live%20test");
    expect(map).toContain("Web: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/WorkSpace/live%20test/Library/CNNJI%20QUERY/01%20Team/query.sql");
    expect(map).toContain("- Library/CNNJI QUERY/01 Team/query.sql (Size: 4.0KB | UniqueId: guid-query-1");
  });

  it("should compute [LOCAL-NEW: use read_file] vs [CLOUD-READY] status tags based on firstCreatedAt and lastSyncedAt", () => {
    const nowIso = new Date().toISOString();
    const oldIso = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
    const epochNow = Date.now();

    const manifest: SyncManifest = {
      version: 2,
      siteUrl: "https://example.sharepoint.com/sites/TestSite",
      targetFolder: "/sites/TestSite/Shared Documents",
      files: {
        "recent_new.py": {
          sha256: "h1",
          size: 1024,
          firstCreatedAt: nowIso,
          lastSyncedAt: nowIso,
        },
        "recent_epoch_new.ts": {
          sha256: "h2",
          size: 2048,
          firstCreatedAt: epochNow,
          lastSyncedAt: epochNow,
        },
        "old_file.md": {
          sha256: "h3",
          size: 512,
          firstCreatedAt: oldIso,
          lastSyncedAt: oldIso,
        },
        "re_synced.py": {
          sha256: "h4",
          size: 1024,
          firstCreatedAt: oldIso,
          lastSyncedAt: nowIso,
        },
        "legacy_file.txt": {
          sha256: "h5",
          size: 256,
        },
      },
    };

    const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(
      manifest,
      manifest.siteUrl!,
      manifest.targetFolder!
    );

    expect(map).toContain("recent_new.py (Size: 1.0KB | Web: https://example.sharepoint.com/sites/TestSite/Shared%20Documents/recent_new.py | Status: [LOCAL-NEW: use read_file])");
    expect(map).toContain("recent_epoch_new.ts (Size: 2.0KB | Web: https://example.sharepoint.com/sites/TestSite/Shared%20Documents/recent_epoch_new.ts | Status: [LOCAL-NEW: use read_file])");
    expect(map).toContain("old_file.md (Size: 0.5KB | Web: https://example.sharepoint.com/sites/TestSite/Shared%20Documents/old_file.md | Status: [CLOUD-READY])");
    expect(map).toContain("re_synced.py (Size: 1.0KB | Web: https://example.sharepoint.com/sites/TestSite/Shared%20Documents/re_synced.py | Status: [CLOUD-READY])");
    expect(map).toContain("legacy_file.txt (Size: 0.3KB | Web: https://example.sharepoint.com/sites/TestSite/Shared%20Documents/legacy_file.txt | Status: [CLOUD-READY])");
  });

  it("should filter non-indexable binary extensions, cap at 120 files, and support readVirtualRepoMap", () => {
    const files: Record<string, any> = {};

    // Add 130 normal text/code files
    for (let i = 1; i <= 130; i++) {
      const pad = String(i).padStart(3, "0");
      files[`src/module_${pad}.ts`] = {
        sha256: `hash_${pad}`,
        size: 1024,
      };
    }

    // Add non-indexable binary files
    files["native.dll"] = { sha256: "bin1", size: 50000 };
    files["archive.zip"] = { sha256: "bin2", size: 60000 };
    files["model.onnx"] = { sha256: "bin3", size: 70000 };
    files["asset.Up2Date"] = { sha256: "bin4", size: 80000 };
    files["cache.bin"] = { sha256: "bin5", size: 90000 };

    const manifest: SyncManifest = {
      version: 2,
      siteUrl: "https://example.sharepoint.com/sites/TestSite",
      targetFolder: "/sites/TestSite/Shared Documents",
      files,
    };

    const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(
      manifest,
      manifest.siteUrl!,
      manifest.targetFolder!
    );

    // Total Files should only count indexable files (130)
    expect(map).toContain("Total Files: 130");

    // Non-indexable files should be filtered out
    expect(map).not.toContain("native.dll");
    expect(map).not.toContain("archive.zip");
    expect(map).not.toContain("model.onnx");
    expect(map).not.toContain("asset.Up2Date");
    expect(map).not.toContain("cache.bin");

    // First 120 files should be included
    expect(map).toContain("src/module_001.ts");
    expect(map).toContain("src/module_120.ts");

    // 121st file should NOT be individually rendered
    expect(map).not.toContain("src/module_121.ts");

    // Budget cap notice with remaining count
    expect(map).toContain("- ... (10 more files synchronized at https://example.sharepoint.com/sites/TestSite/Shared%20Documents)");

    // Test PnPWorkspaceSyncEngine.readVirtualRepoMap
    expect(PnPWorkspaceSyncEngine.readVirtualRepoMap(undefined)).toBeUndefined();
    expect(PnPWorkspaceSyncEngine.readVirtualRepoMap(tmpDir)).toBeUndefined();

    const stateDir = path.join(tmpDir, ".cph", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const mapPath = path.join(stateDir, "virtual-repo-map.md");

    // Empty file returns undefined
    fs.writeFileSync(mapPath, "   \n\t  ", "utf8");
    expect(PnPWorkspaceSyncEngine.readVirtualRepoMap(tmpDir)).toBeUndefined();

    // Non-empty file returns trimmed content
    fs.writeFileSync(mapPath, map, "utf8");
    const read = PnPWorkspaceSyncEngine.readVirtualRepoMap(tmpDir);
    expect(read).toBeDefined();
    expect(read).toBe(map.trim());
  });
});

