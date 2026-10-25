import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

describe("Remote Workspace Catalog & Prompt Streamlining", () => {
  describe("1. PnPWorkspaceSyncEngine Catalog Generation & Read", () => {
    it("should generate standardized remote-workspace-catalog.md from manifest and persist to disk", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-catalog-test-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });

        const manifest = {
          version: 2,
          siteUrl: "https://cmacgmgroup.sharepoint.com/sites/demo",
          targetFolder: "/sites/demo/Shared Documents/live test",
          files: {
            "src/index.ts": {
              sha256: "abc1234",
              size: 1536,
              serverRelativeUrl: "/sites/demo/Shared Documents/live test/src/index.ts",
              lastSyncedAt: "2026-10-25T12:00:00Z",
              firstCreatedAt: "2026-10-25T11:00:00Z",
            },
            "src/utils/math.ts": {
              sha256: "def5678",
              size: 2048,
              serverRelativeUrl: "/sites/demo/Shared Documents/live test/src/utils/math.ts",
              lastSyncedAt: "2026-10-25T12:00:00Z",
              firstCreatedAt: "2026-10-25T11:00:00Z",
            },
            "docs/README.md": {
              sha256: "ghi9012",
              size: 512,
              lastSyncedAt: "2026-10-25T12:00:00Z",
              firstCreatedAt: "2026-10-25T11:00:00Z",
            },
          },
        };

        fs.writeFileSync(
          path.join(stateDir, "sync-manifest.json"),
          JSON.stringify(manifest, null, 2),
          "utf8"
        );

        const catalogMd = PnPWorkspaceSyncEngine.generateCatalogMarkdown(tmpDir, {
          siteUrl: manifest.siteUrl,
          targetFolder: manifest.targetFolder,
        });

        // 1. Structure verification
        expect(catalogMd).toContain("# Remote Workspace Catalog (云端工作区全量目录映射表)");
        expect(catalogMd).toContain("- **Remote Root URL**:");
        expect(catalogMd).toContain("- **Local SSOT**:");
        expect(catalogMd).toContain("- **Total Files**: 3");
        expect(catalogMd).toContain("## 文件映射清单 (File Mapping Index)");
        expect(catalogMd).toContain("| 本地相对路径 | 云端 SharePoint WebUrl | 体积 | 状态 |");
        expect(catalogMd).toContain("|---|---|---|---|");

        // 2. Row verification
        expect(catalogMd).toContain("| `src/index.ts` | https://cmacgmgroup.sharepoint.com/sites/demo/Shared%20Documents/live%20test/src/index.ts | 1.5KB | [CLOUD-READY] |");
        expect(catalogMd).toContain("| `src/utils/math.ts` | https://cmacgmgroup.sharepoint.com/sites/demo/Shared%20Documents/live%20test/src/utils/math.ts | 2.0KB | [CLOUD-READY] |");
        expect(catalogMd).toContain("| `docs/README.md` | https://cmacgmgroup.sharepoint.com/sites/demo/Shared%20Documents/live%20test/docs/README.md | 0.5KB | [CLOUD-READY] |");

        // 3. Disk persistence verification (.cph/state/remote-workspace-catalog.md)
        const catalogPath = path.join(stateDir, "remote-workspace-catalog.md");
        expect(fs.existsSync(catalogPath)).toBe(true);
        expect(fs.readFileSync(catalogPath, "utf8")).toBe(catalogMd);

        // 4. Backward compatibility: virtual-repo-map.md also written
        const legacyMapPath = path.join(stateDir, "virtual-repo-map.md");
        expect(fs.existsSync(legacyMapPath)).toBe(true);

        // 5. readCatalogMarkdown
        const readContent = PnPWorkspaceSyncEngine.readCatalogMarkdown(tmpDir);
        expect(readContent).toBe(catalogMd);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should return undefined for readCatalogMarkdown if file missing or empty", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-empty-catalog-"));
      try {
        expect(PnPWorkspaceSyncEngine.readCatalogMarkdown(tmpDir)).toBeUndefined();
        expect(PnPWorkspaceSyncEngine.readCatalogMarkdown(undefined)).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("2. PromptBuilder Zero-Inline Directory Dumping", () => {
    const HINT_SUBSTRING = "【云端工作区受控目录】已挂载云端附件: remote-workspace-catalog.md（包含全量本地相对路径与云端 SharePoint WebUrl 映射索引，支持两级自主读取决策）";

    it("should inject single-line catalog attachment fingerprint in buildTurn1Prompt without multiline dump", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-prompt-turn1-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(path.join(stateDir, "remote-workspace-catalog.md"), "# Catalog Content\n| a | b |\n", "utf8");

        const prompt = PromptBuilder.buildTurn1Prompt({
          workspaceRoot: tmpDir,
          task: "Audit project architecture",
        });

        // Must contain the single-line attachment hint
        expect(prompt).toContain(HINT_SUBSTRING);

        // Must NOT contain old multi-line repo map table or dumped text
        expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).not.toContain("| a | b |");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should inject single-line catalog attachment fingerprint in buildDirectAgentPrompt without multiline dump", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-prompt-direct-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(path.join(stateDir, "remote-workspace-catalog.md"), "# Catalog Content\n| table | data |\n", "utf8");

        const prompt = PromptBuilder.buildDirectAgentPrompt(
          tmpDir,
          "Implement zero-inline attachment",
          "Skill A",
          "- src/\n  - index.ts"
        );

        // Must contain single-line attachment hint
        expect(prompt).toContain(HINT_SUBSTRING);

        // Must NOT dump full repo map or catalog markdown table
        expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).not.toContain("| table | data |");

        // Order check: skeleton before hint, hint before task
        const skeletonIdx = prompt.indexOf("【工作区受控目录骨架 (2-Level Skeleton)】");
        const hintIdx = prompt.indexOf(HINT_SUBSTRING);
        const taskIdx = prompt.indexOf("【用户正式需求】");

        expect(skeletonIdx).toBeGreaterThanOrEqual(0);
        expect(hintIdx).toBeGreaterThan(skeletonIdx);
        expect(taskIdx).toBeGreaterThan(hintIdx);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should inject single-line catalog attachment fingerprint in buildReGroundingPrompt without multiline dump", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-prompt-reground-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(path.join(stateDir, "virtual-repo-map.md"), "[SHAREPOINT REMOTE WORKSPACE]\n- file1.ts", "utf8");

        const prompt = PromptBuilder.buildReGroundingPrompt({
          workspaceRoot: tmpDir,
          currentTask: "Continue migration",
        });

        // Must contain single-line attachment hint when repo map or catalog is on disk
        expect(prompt).toContain(HINT_SUBSTRING);

        // Must NOT inline multiline repo map
        expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).not.toContain("- file1.ts");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
