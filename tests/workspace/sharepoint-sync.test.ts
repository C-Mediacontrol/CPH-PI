import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SharePointSyncEngine } from "../../src/workspace/sharepoint-sync.ts";

describe("SharePointSyncEngine Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-sync-unit-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should calculate correct SHA256 hash", () => {
    const testFile = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(testFile, "Hello World", "utf8");
    const hash = SharePointSyncEngine.getFileSha256(testFile);
    expect(hash).toBe("a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e");
  });

  it("should parse target folder correctly", () => {
    const parsed1 = SharePointSyncEngine.parseTargetFolder("AFRASIA/01 Team/WorkSpace/test");
    expect(parsed1.libraryName).toBe("AFRASIA");
    expect(parsed1.folderSubpath).toBe("01 Team/WorkSpace/test");

    const parsed2 = SharePointSyncEngine.parseTargetFolder("/Shared Documents/folder1/sub2");
    expect(parsed2.libraryName).toBe("Shared Documents");
    expect(parsed2.folderSubpath).toBe("folder1/sub2");

    const parsed3 = SharePointSyncEngine.parseTargetFolder("AFRASIA");
    expect(parsed3.libraryName).toBe("AFRASIA");
    expect(parsed3.folderSubpath).toBe("");
  });

  it("should load, update and save sync-manifest.json idempotently", () => {
    const manifestPath = path.join(tmpDir, ".cph", "state", "sync-manifest.json");
    const m1 = SharePointSyncEngine.loadManifest(manifestPath);
    expect(m1.version).toBe(1);
    expect(Object.keys(m1.files).length).toBe(0);

    m1.files["test.txt"] = { sha256: "abc123", lastSyncedAt: new Date().toISOString(), size: 100 };
    SharePointSyncEngine.saveManifest(manifestPath, m1);

    const m2 = SharePointSyncEngine.loadManifest(manifestPath);
    expect(m2.files["test.txt"].sha256).toBe("abc123");
    expect(m2.files["test.txt"].size).toBe(100);
  });

  it("should append failure items to dirty-sync.jsonl", () => {
    const dirtyPath = path.join(tmpDir, ".cph", "state", "dirty-sync.jsonl");
    SharePointSyncEngine.appendDirtyLog(dirtyPath, "broken.ts", "Simulated network timeout", 3);
    expect(fs.existsSync(dirtyPath)).toBe(true);

    const content = fs.readFileSync(dirtyPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.file).toBe("broken.ts");
    expect(parsed.error).toBe("Simulated network timeout");
    expect(parsed.attempts).toBe(3);
  });

  it("should execute mock transport sync and skip unchanged files on second run", async () => {
    const file1 = path.join(tmpDir, "file1.txt");
    const file2 = path.join(tmpDir, "sub", "file2.txt");
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    fs.writeFileSync(file1, "Content 1", "utf8");
    fs.writeFileSync(file2, "Content 2", "utf8");

    const engine = new SharePointSyncEngine();

    // First run: 2 synced
    const rep1 = await engine.syncWorkspace({
      workspaceRoot: tmpDir,
      targetFolder: "AFRASIA/WorkSpace/test",
      mockTransport: true,
      mode: "all",
    });

    expect(rep1.totalFound).toBe(2);
    expect(rep1.syncedCount).toBe(2);
    expect(rep1.skippedCount).toBe(0);

    // Second run: 2 skipped
    const rep2 = await engine.syncWorkspace({
      workspaceRoot: tmpDir,
      targetFolder: "AFRASIA/WorkSpace/test",
      mockTransport: true,
      mode: "all",
    });

    expect(rep2.totalFound).toBe(2);
    expect(rep2.syncedCount).toBe(0);
    expect(rep2.skippedCount).toBe(2);

    // Modify file1: 1 synced, 1 skipped
    fs.writeFileSync(file1, "Content 1 modified", "utf8");
    const rep3 = await engine.syncWorkspace({
      workspaceRoot: tmpDir,
      targetFolder: "AFRASIA/WorkSpace/test",
      mockTransport: true,
      mode: "all",
    });

    expect(rep3.syncedCount).toBe(1);
    expect(rep3.skippedCount).toBe(1);
  });
});

