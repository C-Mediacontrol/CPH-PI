import { describe, it, expect } from "bun:test";
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

    it("should build failed tool result prompt with error message", () => {
      const prompt = PromptBuilder.buildToolResultPrompt(
        "edit",
        false,
        "No replacement occurred",
        "Unique match not found"
      );

      expect(prompt).toContain("[TOOL_RESULT for edit - FAILED]");
      expect(prompt).toContain("Error: Unique match not found");
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
  });
});


