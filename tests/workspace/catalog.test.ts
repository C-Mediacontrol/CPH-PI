import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";

describe("generateCatalogMarkdown", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-catalog-"));
    fs.mkdirSync(path.join(root, ".cph", "state"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "Library", "proj"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, "Library", "proj", "b.ps1"), "Write-Output 1\n");
    fs.writeFileSync(path.join(root, "Library", "proj", "pic.png"), "binary");
    fs.writeFileSync(path.join(root, "README.md"), "# readme\n");

    const siteUrl = "https://tenant.sharepoint.com/sites/test";
    const targetFolder = "AFRASIA/WorkSpace/test_workspace";
    const fileEntry = (rel: string, serverRelativeUrl: string) => ({
      sha256: "abc",
      size: 10,
      serverRelativeUrl,
      lastSyncedAt: "2026-10-25T00:00:00Z",
    });
    const manifest = {
      version: 2,
      siteUrl,
      targetFolder,
      files: {
        "src/a.ts": fileEntry(
          "src/a.ts",
          "/sites/test/AFRASIA/WorkSpace/test_workspace/src/a.ts"
        ),
        "README.md": fileEntry("README.md", "/sites/test/AFRASIA/WorkSpace/test/README.md"),
      },
      folders: {},
    };
    fs.writeFileSync(
      path.join(root, ".cph", "state", "sync-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("builds a filesystem-truth catalog with statuses and current URLs", () => {
    const { markdown, stats } = PnPWorkspaceSyncEngine.generateCatalogMarkdown(root);

    expect(markdown).toContain("## 1. 工作区目录结构 (Directory Skeleton)");
    expect(markdown).toContain("## 2. 文件映射清单 (File Mapping Index)");
    expect(markdown).toContain("[SHAREPOINT REMOTE WORKSPACE]");

    expect(markdown).toContain("`src/a.ts` (");
    expect(markdown).toContain("[CLOUD-READY]");
    expect(markdown).toContain("https://tenant.sharepoint.com/sites/test/AFRASIA/WorkSpace/test_workspace/src/a.ts");

    expect(markdown).toContain("`README.md`");
    expect(markdown).toContain("[CLOUD-STALE]");

    expect(markdown).toContain("`Library/proj/b.ps1`");
    expect(markdown).toContain("[LOCAL-ONLY]");
    expect(markdown).toContain("`Library/proj/pic.png`");
    expect(markdown).toContain("[CLOUD-UNINDEXABLE]");

    expect(stats.totalFiles).toBe(4);
    expect(stats.syncedIndexable).toBe(1);
    expect(stats.localOnly).toBe(2);
    expect(stats.unindexable).toBe(1);
    expect(markdown).toContain("工作区文件 4 | 已同步可索引 1 | 本地独有 2 | 不可索引 1");
  });

  it("never emits stale directory URLs for manifest entries", () => {
    const { markdown } = PnPWorkspaceSyncEngine.generateCatalogMarkdown(root);
    // README is stale in the manifest; its shown URL must still be the current target folder.
    expect(markdown).not.toContain("/WorkSpace/test/README.md");
    // CLOUD-STALE rows carry no fetchable URL (read locally instead).
    const staleLine = markdown
      .split("\n")
      .find((line) => line.includes("`README.md`") && line.includes("[CLOUD-STALE]"));
    expect(staleLine).toBeDefined();
    expect(staleLine).not.toContain("http");
  });
});
