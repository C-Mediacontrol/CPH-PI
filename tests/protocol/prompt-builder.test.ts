import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

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

  describe("6. Bounded Remote Workspace Map Attendance in Turn 1", () => {
    function seedWorkspace(tmpDir: string, files: string[]) {
      const stateDir = path.join(tmpDir, ".cph", "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const entries: Record<string, any> = {};
      for (const rel of files) {
        const abs = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "// content\n", "utf8");
        entries[rel] = {
          sha256: "abc",
          size: 10,
          serverRelativeUrl: `/sites/test/AFRASIA/WorkSpace/test_workspace/${rel}`,
        };
      }
      fs.writeFileSync(
        path.join(stateDir, "sync-manifest.json"),
        JSON.stringify(
          {
            version: 2,
            siteUrl: "https://tenant.sharepoint.com/sites/test",
            targetFolder: "AFRASIA/WorkSpace/test_workspace",
            files: entries,
            folders: {},
          },
          null,
          2
        ),
        "utf8"
      );
    }

    it("should inline the bounded [SHAREPOINT REMOTE WORKSPACE] map into buildTurn1Prompt", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-turn1-"));
      try {
        seedWorkspace(tmpDir, ["main.py"]);

        const prompt = PromptBuilder.buildTurn1Prompt({
          workspaceRoot: tmpDir,
          task: "Review codebase",
        });

        expect(prompt).toContain("【本地宿主机与工作区事实 (Grounding Facts)】");
        expect(prompt).toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).toContain("main.py");
        expect(prompt).toContain("[CLOUD-READY]");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should inline the bounded map into buildDirectAgentPrompt and honor explicit map overrides", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-direct-"));
      try {
        seedWorkspace(tmpDir, ["src/app.ts"]);

        const prompt1 = PromptBuilder.buildDirectAgentPrompt(
          tmpDir,
          "Direct task",
          "",
          "- src/\n  - app.ts"
        );
        expect(prompt1).toContain("【工作区受控目录骨架 (2-Level Skeleton)】");
        expect(prompt1).toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt1).toContain("src/app.ts");
        const mapIdx = prompt1.indexOf("[SHAREPOINT REMOTE WORKSPACE]");
        const skeletonIdx = prompt1.indexOf("【工作区受控目录骨架 (2-Level Skeleton)】");
        const taskIdx = prompt1.indexOf("【用户正式需求】");
        expect(mapIdx).toBeLessThan(skeletonIdx);
        expect(skeletonIdx).toBeLessThan(taskIdx);

        const customMap = "[SHAREPOINT REMOTE WORKSPACE]\n- custom.ts";
        const prompt2 = PromptBuilder.buildDirectAgentPrompt(
          tmpDir,
          "Direct task",
          "",
          "",
          undefined,
          customMap
        );
        expect(prompt2).toContain(customMap);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should inline the bounded map into buildReGroundingPrompt", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pb-reground-"));
      try {
        seedWorkspace(tmpDir, ["index.ts"]);

        const prompt = PromptBuilder.buildReGroundingPrompt({
          workspaceRoot: tmpDir,
          currentTask: "Continue migration",
        });

        expect(prompt).toContain("【本地宿主机与工作区事实 (Session Re-grounding)】");
        expect(prompt).toContain("[SHAREPOINT REMOTE WORKSPACE]");
        expect(prompt).toContain("index.ts");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});



