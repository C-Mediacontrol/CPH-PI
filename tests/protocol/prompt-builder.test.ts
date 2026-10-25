import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import { PnPWorkspaceSyncEngine, type SyncManifest } from "../../src/workspace/pnp-sync-engine.ts";
import { formatSuccessorTurn1Prompt, type MainPlanSnapshot } from "../../src/session/main-plan-snapshot.ts";

describe("PromptBuilder Unit Tests", () => {
  describe("1. Turn 1 Grounding Handshake Prompt", () => {
    it("should construct Turn 1 Grounding prompt with workspace, git facts, and dir tree", () => {
      const prompt = PromptBuilder.buildTurn1Prompt({
        workspaceRoot: "E:/test-repo",
        gitFacts: "Branch: main\nStatus: clean",
        dirTree: "src/\npackage.json",
        task: "Fix bug in parser",
      });

      expect(prompt).toContain("E:/test-repo");
      expect(prompt).toContain("Branch: main");
      expect(prompt).toContain("Fix bug in parser");
      expect(prompt).toContain("read_file");
      expect(prompt).toContain("edit");
      expect(prompt).toContain("write_file");
      expect(prompt).toContain("run_command");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should construct dedicated Turn 1 Handshake prompt", () => {
      const prompt = PromptBuilder.buildHandshakePrompt(
        "E:/test-repo",
        "Branch: feat/task5",
        "src/\ntests/"
      );

      expect(prompt).toContain("E:/test-repo");
      expect(prompt).toContain("feat/task5");
      expect(prompt).toContain("Turn 1");
      expect(prompt).toContain("action");
    });
  });

  describe("2. Tool Result and Turn Continuation", () => {
    it("should build success tool result prompt with PROTOCOL_REMINDER", () => {
      const prompt = PromptBuilder.buildToolResultPrompt(
        "read_file",
        true,
        "File content lines 1-10"
      );

      expect(prompt).toContain("[TOOL_RESULT for read_file - SUCCESS]");
      expect(prompt).toContain("File content lines 1-10");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should build failed tool result prompt with error message and maintain Harness neutrality", () => {
      const prompt = PromptBuilder.buildToolResultPrompt(
        "edit",
        false,
        "No replacement occurred",
        "Unique match not found"
      );

      expect(prompt).toContain("[TOOL_RESULT for edit - FAILED]");
      expect(prompt).toContain("Error: Unique match not found");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
      expect(prompt).not.toContain("请根据错误进行分析");
      expect(prompt).not.toContain("尝试排查修复");
    });

    it("should embed task invariant anchor in buildToolResultPrompt when provided", () => {
      const prompt = PromptBuilder.buildToolResultPrompt(
        "run_command",
        true,
        "find output: /e/test/Library/YardApi.psm1",
        undefined,
        "CNNJI QUERY 项目审查与重构"
      );

      expect(prompt).toContain("【当前推进战役北极星 (Task Invariant)】:");
      expect(prompt).toContain("CNNJI QUERY 项目审查与重构");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should embed task invariant anchor in buildAttachedToolResultPrompt when provided", () => {
      const prompt = PromptBuilder.buildAttachedToolResultPrompt(
        "read_file",
        "read-AGENTS.md-12345.txt",
        { lineCount: 68, charCount: 2500 },
        "Head line\n... (省略 10 行) ...\nTail line",
        "CNNJI QUERY 模块审查与重构"
      );

      expect(prompt).toContain("【当前推进战役北极星 (Task Invariant)】:");
      expect(prompt).toContain("CNNJI QUERY 模块审查与重构");
      expect(prompt).toContain("【物理执行指纹摘要 (Head-Tail Fingerprint)】:");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });
  });

  describe("3. User Response Prompt", () => {
    it("should build prompt with user answer to ask_question", () => {
      const prompt = PromptBuilder.buildUserResponsePrompt("Yes, proceed with tests.");
      expect(prompt).toContain("[USER_RESPONSE for ask_question]");
      expect(prompt).toContain("Yes, proceed with tests.");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should embed task invariant in buildUserResponsePrompt when provided", () => {
      const prompt = PromptBuilder.buildUserResponsePrompt(
        "确认按方案 A 执行",
        "CNNJI QUERY 项目审查"
      );
      expect(prompt).toContain("[USER_RESPONSE for ask_question]");
      expect(prompt).toContain("确认按方案 A 执行");
      expect(prompt).toContain("【当前推进战役北极星 (Task Invariant)】:");
      expect(prompt).toContain("CNNJI QUERY 项目审查");
    });
  });

  describe("4. Turn 2 Task Prompt Injection", () => {
    it("should build Turn 2 task prompt with tool result, active skills, and formal task", () => {
      const prompt = PromptBuilder.buildTurn2TaskPrompt(
        "实现支付接口",
        "On branch main\nnothing to commit",
        "【当前已激活的专业技能 (Skill)】\n#### [技能 1: tdd]",
        "run_command"
      );

      expect(prompt).toContain("[TOOL_RESULT for run_command - SUCCESS]:");
      expect(prompt).toContain("On branch main");
      expect(prompt).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(prompt).toContain("【当前已激活的专业技能 (Skill)】");
      expect(prompt).toContain("#### [技能 1: tdd]");
      expect(prompt).toContain("【用户正式需求】\n实现支付接口");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should build Turn 2 task prompt without skills and default header when toolName omitted", () => {
      const prompt = PromptBuilder.buildTurn2TaskPrompt(
        "重构解析器",
        "file1.ts\nfile2.ts"
      );

      expect(prompt).toContain("[TOOL_RESULT - SUCCESS]:");
      expect(prompt).toContain("file1.ts\nfile2.ts");
      expect(prompt).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(prompt).not.toContain("【当前已激活的专业技能 (Skill)】");
      expect(prompt).toContain("【用户正式需求】\n重构解析器");
    });
  });

  describe("5. Cloud File Attachment Tool Result Prompts", () => {
    it("should buildAttachedToolResultPrompt cleanly without dumping output and prohibit read_file", () => {
      const prompt = PromptBuilder.buildAttachedToolResultPrompt("run_command", "tool-result-123.txt", {
        lineCount: 150,
        charCount: 4200,
      });

      expect(prompt).toContain("[TOOL_RESULT for run_command - SUCCESS (ATTACHED)]");
      expect(prompt).toContain("共 150 行 / 4200 字符");
      expect(prompt).toContain("tool-result-123.txt");
      expect(prompt).toContain("云端文档引擎已对该附件进行全量原生解析");
      expect(prompt).not.toContain("tool-output-"); // no local log path
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should buildTurn2TaskPromptWithAttachment with clean attachment reference and formal task", () => {
      const prompt = PromptBuilder.buildTurn2TaskPromptWithAttachment(
        "构建微服务",
        "【当前已激活的专业技能 (Skill)】\n#### [技能 1: tdd]",
        "run_command",
        "probe-git-status.txt",
        { lineCount: 80, charCount: 2500 }
      );

      expect(prompt).toContain("[TOOL_RESULT for run_command - SUCCESS (ATTACHED)]");
      expect(prompt).toContain("probe-git-status.txt");
      expect(prompt).toContain("云端文档引擎已对该附件进行全量原生解析");
      expect(prompt).toContain("【用户正式需求】\n构建微服务");
      expect(prompt).toContain("#### [技能 1: tdd]");
      expect(prompt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });

    it("should inject concurrency cluster capacity into buildDirectAgentPrompt and buildTurn2TaskPrompt", () => {
      const directPrompt = PromptBuilder.buildDirectAgentPrompt(
        "E:/workspace",
        "全量重构",
        "",
        "",
        4
      );
      expect(directPrompt).toContain("- 并发集群容量: 4 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)");

      const turn2Prompt = PromptBuilder.buildTurn2TaskPrompt({
        task: "全量重构",
        toolResult: "OK",
        concurrencyWorkers: 4,
      });
      expect(turn2Prompt).toContain("- 并发集群容量: 4 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)");
    });
  });

  describe("6. Remote Workspace Catalog Pointer & Zero Inline Injection", () => {
    it("buildTurn1Prompt should reference remote-workspace-catalog.md and not inline virtual-repo-map.md or dirTree", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-turn1-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        const mapContent = "[SHAREPOINT REMOTE WORKSPACE]\nRemote Root URL: https://site/target\n- main.py (Size: 2KB)";
        fs.writeFileSync(path.join(stateDir, "virtual-repo-map.md"), mapContent, "utf8");

        const prompt = PromptBuilder.buildTurn1Prompt({
          workspaceRoot: tmpDir,
          task: "Review codebase",
          dirTree: "src/\n  app.ts",
        });

        expect(prompt).toContain("【本地宿主机与工作区事实 (Grounding Facts)】");
        expect(prompt).toContain(
          "- 工作区目录与云端文件索引: 已作为云端附件【remote-workspace-catalog.md】随本轮消息挂载（含 2 层目录树与 SharePoint 文件直链清单）"
        );
        expect(prompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).not.toContain("【核心目录结构预览】");
        expect(prompt).not.toContain("main.py (Size: 2KB)");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("buildDirectAgentPrompt and formatSuccessorTurn1Prompt do NOT inline dirSkeleton or virtualRepoMap, and reference remote-workspace-catalog.md", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-direct-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        const mapContent = "[SHAREPOINT REMOTE WORKSPACE]\nRemote Root URL: https://site/target\n- src/app.ts";
        fs.writeFileSync(path.join(stateDir, "virtual-repo-map.md"), mapContent, "utf8");

        // 1. buildDirectAgentPrompt should reference remote-workspace-catalog.md and strip inline skeleton/repoMap
        const prompt1 = PromptBuilder.buildDirectAgentPrompt(
          tmpDir,
          "Direct task",
          "",
          "- src/\n  - app.ts",
          undefined,
          mapContent
        );
        expect(prompt1).toContain(
          "- 工作区目录与云端文件索引: 已作为云端附件【remote-workspace-catalog.md】随本轮消息挂载（含 2 层目录树与 SharePoint 文件直链清单）"
        );
        expect(prompt1).not.toContain("【工作区受控目录骨架 (2-Level Skeleton)】");
        expect(prompt1).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt1).not.toContain("- src/app.ts");

        // 2. formatSuccessorTurn1Prompt should reference remote-workspace-catalog.md and strip inline facts
        const snapshot: MainPlanSnapshot = {
          snapshotId: "snap-123",
          originalSessionId: "session-1",
          originalTask: "Test task",
          thought: "Some thoughts",
          workspaceRoot: tmpDir,
          gitBaseline: "HEAD",
          plannedSubagents: [],
          createdAt: Date.now(),
        };

        const successorPrompt = formatSuccessorTurn1Prompt(
          snapshot,
          "Reports summary",
          undefined,
          4,
          "- src/\n  - app.ts"
        );
        expect(successorPrompt).not.toContain("【工作区受控目录骨架 (2-Level Skeleton)】");
        expect(successorPrompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(successorPrompt).toContain("remote-workspace-catalog.md");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("buildHandshakePrompt and buildReGroundingPrompt should reference remote-workspace-catalog.md without inlining dirTree or virtualRepoMap", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-reground-"));
      try {
        const stateDir = path.join(tmpDir, ".cph", "state");
        fs.mkdirSync(stateDir, { recursive: true });
        const mapContent = "[SHAREPOINT REMOTE WORKSPACE]\nRemote Root URL: https://site/target\n- index.ts";
        fs.writeFileSync(path.join(stateDir, "virtual-repo-map.md"), mapContent, "utf8");

        const handshakePrompt = PromptBuilder.buildHandshakePrompt(
          tmpDir,
          "Git status: clean",
          "src/\n  index.ts"
        );
        expect(handshakePrompt).toContain(
          "- 工作区目录与云端文件索引: 已作为云端附件【remote-workspace-catalog.md】随本轮消息挂载（含 2 层目录树与 SharePoint 文件直链清单）"
        );
        expect(handshakePrompt).not.toContain("【当前工作区精简目录树】");

        const reGroundPrompt = PromptBuilder.buildReGroundingPrompt({
          workspaceRoot: tmpDir,
          currentTask: "Continue migration",
        });
        expect(reGroundPrompt).toContain(
          "- 工作区目录与云端文件索引: 已作为云端附件【remote-workspace-catalog.md】随本轮消息挂载（含 2 层目录树与 SharePoint 文件直链清单）"
        );
        expect(reGroundPrompt).not.toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(reGroundPrompt).not.toContain("index.ts");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("7. SharePoint Web URL Deduplication & Normalization", () => {
    it("buildSharePointWebUrl should deduplicate site path prefix and encode spaces as %20", () => {
      const siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";

      // 1. targetFolder without /sites/ prefix
      const url1 = PnPWorkspaceSyncEngine.buildSharePointWebUrl(
        siteUrl,
        "AFRASIA/01 Team/live test",
        "src/my file.ts"
      );
      expect(url1).toBe(
        "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/live%20test/src/my%20file.ts"
      );
      expect(url1).not.toContain("CMA-GBSC_BKGDOMAIN/sites");

      // 2. targetFolder with /sites/CMA-GBSC_BKGDOMAIN/ prefix -> deduplicate
      const url2 = PnPWorkspaceSyncEngine.buildSharePointWebUrl(
        siteUrl,
        "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/live test",
        "src/my file.ts"
      );
      expect(url2).toBe(
        "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/live%20test/src/my%20file.ts"
      );

      // 3. serverRelativeUrl with /sites/ prefix -> uses origin and encodes
      const url3 = PnPWorkspaceSyncEngine.buildSharePointWebUrl(
        siteUrl,
        "unused",
        undefined,
        "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/doc with spaces.pdf"
      );
      expect(url3).toBe(
        "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/doc%20with%20spaces.pdf"
      );

      // 4. without relPath -> returns base folder URL
      const url4 = PnPWorkspaceSyncEngine.buildSharePointWebUrl(
        siteUrl,
        "AFRASIA/01 Team"
      );
      expect(url4).toBe(
        "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team"
      );
    });
  });

  describe("8. Cloud Target Resolution Guard", () => {
    it("resolveCloudTarget should return null when targetFolder is not configured (never falling back to personal default)", () => {
      const origEnv = process.env.CPH_SP_TARGET_FOLDER;
      const origSite = process.env.CPH_SP_SITE_URL;
      try {
        delete process.env.CPH_SP_TARGET_FOLDER;
        delete process.env.CPH_SP_SITE_URL;

        // 1. empty manifest -> returns null (never defaults to personal path)
        const res1 = PnPWorkspaceSyncEngine.resolveCloudTarget("E:/empty-ws", {
          version: 2,
          files: {},
        });
        expect(res1).toBeNull();

        // 2. manifest with targetFolder -> returns resolved target
        const res2 = PnPWorkspaceSyncEngine.resolveCloudTarget("E:/empty-ws", {
          version: 2,
          files: {},
          targetFolder: "Custom/Folder",
          siteUrl: "https://custom.sharepoint.com/sites/CustomSite",
        });
        expect(res2).toEqual({
          siteUrl: "https://custom.sharepoint.com/sites/CustomSite",
          targetFolder: "Custom/Folder",
        });

        // 3. environment variable provides targetFolder when manifest lacks it
        process.env.CPH_SP_TARGET_FOLDER = "Env/Target/Folder";
        const res3 = PnPWorkspaceSyncEngine.resolveCloudTarget("E:/empty-ws", null);
        expect(res3).toEqual({
          siteUrl: PnPWorkspaceSyncEngine.DEFAULT_SITE_URL,
          targetFolder: "Env/Target/Folder",
        });
      } finally {
        if (origEnv !== undefined) process.env.CPH_SP_TARGET_FOLDER = origEnv;
        else delete process.env.CPH_SP_TARGET_FOLDER;
        if (origSite !== undefined) process.env.CPH_SP_SITE_URL = origSite;
        else delete process.env.CPH_SP_SITE_URL;
      }
    });
  });

  describe("9. Pure Catalog Markdown Generation", () => {
    it("generateCatalogMarkdown produces 2-level directory skeleton and file mapping with [CLOUD-READY], [LOCAL-NEW], and [LOCAL-ONLY]", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-catalog-test-"));
      try {
        // Create directories
        fs.mkdirSync(path.join(tmpDir, "src", "nested"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });

        // Create files
        fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "const x = 1;");
        fs.writeFileSync(path.join(tmpDir, "src", "nested", "deep.ts"), "const deep = 2;");
        fs.writeFileSync(path.join(tmpDir, "docs", "readme.md"), "# Readme");
        fs.writeFileSync(path.join(tmpDir, "local-untracked.txt"), "Local only file");
        fs.writeFileSync(path.join(tmpDir, ".git", "config"), "git config");

        const now = Date.now();
        const manifest: SyncManifest = {
          version: 2,
          siteUrl: "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN",
          targetFolder: "AFRASIA/01 Team/live test",
          files: {
            "src/app.ts": {
              sha256: "hash-ready",
              size: 100,
              firstCreatedAt: now - 120_000, // 2 minutes ago
              lastSyncedAt: new Date(now - 60_000).toISOString(),
              uniqueId: "guid-app-ts",
            },
            "docs/readme.md": {
              sha256: "hash-new",
              size: 50,
              firstCreatedAt: now - 5_000, // 5 seconds ago
              lastSyncedAt: String(now - 5_000), // created == synced within 60s
              uniqueId: "guid-readme-md",
            },
          },
        };

        const catalog = PnPWorkspaceSyncEngine.generateCatalogMarkdown(
          tmpDir,
          manifest,
          manifest.siteUrl,
          manifest.targetFolder
        );

        // Section headers
        expect(catalog).toContain("## 1. 工作区目录结构 (Directory Skeleton)");
        expect(catalog).toContain("## 2. 文件映射清单 (File Mapping Index)");

        // Exclusions
        expect(catalog).not.toContain(".git");
        expect(catalog).not.toContain("node_modules");

        // Skeleton entries
        expect(catalog).toContain("- src/");
        expect(catalog).toContain("  - app.ts");
        expect(catalog).toContain("- docs/");

        // Status tags
        expect(catalog).toContain("[CLOUD-READY]");
        expect(catalog).toContain("[LOCAL-NEW: use read_file]");
        expect(catalog).toContain("[LOCAL-ONLY: local disk only]");

        // Check specific files
        expect(catalog).toContain("src/app.ts");
        expect(catalog).toContain("docs/readme.md");
        expect(catalog).toContain("local-untracked.txt");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("10. File Saved and Synced Receipt", () => {
    it("buildFileSavedAndSyncedReceipt emits synced web url when present and landed only when undefined", () => {
      const receipt = PromptBuilder.buildFileSavedAndSyncedReceipt({
        toolName: "write_file",
        landedFiles: [
          {
            relPath: "src/service.ts",
            cloudWebUrl: "https://cmacgmgroup.sharepoint.com/sites/site/src/service.ts",
          },
          {
            relPath: "dist/bundle.zip",
          },
        ],
        taskInvariant: "Payment module refactoring",
      });

      expect(receipt).toContain("[TOOL_RESULT for write_file - SUCCESS]:");
      expect(receipt).toContain("✔ 文件已落盘至本地: src/service.ts");
      expect(receipt).toContain("✔ 已同步至云端工作区: https://cmacgmgroup.sharepoint.com/sites/site/src/service.ts");
      expect(receipt).toContain("✔ 文件已落盘至本地: dist/bundle.zip");
      expect(receipt).not.toContain("✔ 已同步至云端工作区: undefined");
      expect(receipt).toContain("【当前推进战役北极星 (Task Invariant)】:");
      expect(receipt).toContain("Payment module refactoring");
      expect(receipt).toContain(PromptBuilder.PROTOCOL_REMINDER);
    });
  });
});



