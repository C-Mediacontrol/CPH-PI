import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";

describe("SharePoint Mirror Guard & Safe Deletion Suite", () => {
  let tmpDir: string;
  let engine: PnPWorkspaceSyncEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-guard-test-"));
    engine = new PnPWorkspaceSyncEngine();

    // Reset mock environment flags
    delete process.env.SP_SYNC_MOCK_CLOUD_EMPTY;
    delete process.env.SP_SYNC_MOCK_MIRROR_MATCH;
    delete process.env.SP_SYNC_MOCK_MIRROR_MISMATCH;
    delete process.env.SP_SYNC_MOCK_OVERLAP_ZERO;
    delete process.env.SP_SYNC_MOCK_OVERLAP_MATCH;
  });

  afterEach(() => {
    delete process.env.SP_SYNC_MOCK_CLOUD_EMPTY;
    delete process.env.SP_SYNC_MOCK_MIRROR_MATCH;
    delete process.env.SP_SYNC_MOCK_MIRROR_MISMATCH;
    delete process.env.SP_SYNC_MOCK_OVERLAP_ZERO;
    delete process.env.SP_SYNC_MOCK_OVERLAP_MATCH;

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("Test 1: Empty cloud folder passes verification", async () => {
    process.env.SP_SYNC_MOCK_CLOUD_EMPTY = "1";

    const result = await engine.verifyCloudMirror({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(result.valid).toBe(true);
    expect(result.cloudFileCount).toBe(0);
    expect(result.overlapCount).toBe(0);
    expect(result.hasMirrorFile).toBe(false);
    expect(result.reason).toContain("Cloud folder is empty");
  });

  it("Test 2: Matching .cph-mirror.json passes verification", async () => {
    process.env.SP_SYNC_MOCK_MIRROR_MATCH = "1";

    const result = await engine.verifyCloudMirror({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(result.valid).toBe(true);
    expect(result.hasMirrorFile).toBe(true);
    expect(result.reason).toContain("Mirror fingerprint matched");
  });

  it("Test 3: Mismatched .cph-mirror.json fails verification with MIRROR_MISMATCH", async () => {
    process.env.SP_SYNC_MOCK_MIRROR_MISMATCH = "1";

    const result = await engine.verifyCloudMirror({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(result.valid).toBe(false);
    expect(result.hasMirrorFile).toBe(true);
    expect(result.reason).toContain("MIRROR_MISMATCH");
  });

  it("Test 4: Non-empty folder with 0 overlap fails verification with UNMATCHED_CLOUD_FOLDER", async () => {
    process.env.SP_SYNC_MOCK_OVERLAP_ZERO = "1";

    const result = await engine.verifyCloudMirror({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(result.valid).toBe(false);
    expect(result.cloudFileCount).toBe(5);
    expect(result.overlapCount).toBe(0);
    expect(result.hasMirrorFile).toBe(false);
    expect(result.reason).toContain("UNMATCHED_CLOUD_FOLDER");
  });

  it("Test 5: Non-empty folder with overlap passes verification", async () => {
    process.env.SP_SYNC_MOCK_OVERLAP_MATCH = "1";

    const result = await engine.verifyCloudMirror({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(result.valid).toBe(true);
    expect(result.cloudFileCount).toBe(3);
    expect(result.overlapCount).toBe(2);
    expect(result.reason).toContain("Cloud files overlap with local workspace");
  });

  it("Test 6: syncCloudWorkspace throws when verification fails, and succeeds when valid", async () => {
    // 6.1 Should throw when mirror verification fails
    process.env.SP_SYNC_MOCK_OVERLAP_ZERO = "1";
    await expect(
      engine.syncCloudWorkspace({
        workspaceRoot: tmpDir,
        mockTransport: true,
      })
    ).rejects.toThrow("UNMATCHED_CLOUD_FOLDER");

    // 6.2 Should bypass error when skipVerify is true
    const bypassRep = await engine.syncCloudWorkspace({
      workspaceRoot: tmpDir,
      mockTransport: true,
      skipVerify: true,
    });
    expect(bypassRep).toBeDefined();
    expect(typeof bypassRep.totalLocal).toBe("number");

    // 6.3 Should succeed when mirror verification passes
    delete process.env.SP_SYNC_MOCK_OVERLAP_ZERO;
    process.env.SP_SYNC_MOCK_CLOUD_EMPTY = "1";

    const validRep = await engine.syncCloudWorkspace({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });
    expect(validRep).toBeDefined();
    expect(typeof validRep.durationMs).toBe("number");
  }, 15000);

  it("Test 7: Orphan pruning records recycled in report results and cleans from manifest", async () => {
    // Create initial local file
    const sampleFile = path.join(tmpDir, "active.txt");
    fs.writeFileSync(sampleFile, "Active content", "utf8");

    // Prewarm to populate manifest
    const rep1 = await engine.prewarm({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });
    expect(rep1.syncedCount).toBe(1);

    // Inject orphan file into sync-manifest.json
    const manifestPath = path.join(tmpDir, ".cph", "state", "sync-manifest.json");
    const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath)!;
    manifest.files["obsolete_orphan.txt"] = {
      sha256: "deadbeef00001111",
      size: 1234,
      uniqueId: "guid-obsolete",
      lastSyncedAt: new Date().toISOString(),
    };
    PnPWorkspaceSyncEngine.saveManifest(manifestPath, manifest);

    // Second prewarm should prune orphan and record recycled status
    const rep2 = await engine.prewarm({
      workspaceRoot: tmpDir,
      mockTransport: true,
    });

    expect(rep2.prunedCount).toBe(1);

    const recycledResult = rep2.results.find((r) => r.relativePath === "obsolete_orphan.txt");
    expect(recycledResult).toBeDefined();
    expect(recycledResult?.status).toBe("recycled");

    // Verify orphan was removed from manifest
    const updatedManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath)!;
    expect(updatedManifest.files["obsolete_orphan.txt"]).toBeUndefined();
  });
});
