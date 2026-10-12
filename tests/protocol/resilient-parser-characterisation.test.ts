import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

describe("Characterisation Tests: CR-01 ResilientParser and Context Solidification", () => {
  describe("Test Case 1: Nested Markdown backticks inside write_file", () => {
    it("should completely extract content containing nested triple-backtick markdown blocks without premature truncation", () => {
      const nestedCode = "```ts\nfunction helloWorld(): string {\n  return 'hello';\n}\n```";
      const input = `THOUGHT: We need to write the file with markdown fenced code.
\`\`\`action
tool: write_file
path: src/example.ts
content:
${nestedCode}
\`\`\``;

      const parsed = ResilientParser.parse(input);
      expect(parsed.type).toBe("action");
      if (parsed.type === "action") {
        expect(parsed.action.tool).toBe("write_file");
        expect(parsed.action.path).toBe("src/example.ts");
        expect(parsed.action.content).toBe(nestedCode);
      }
    });

    it("should handle nested code fences with language tags and generic fences", () => {
      const nestedContent = "Here is some code:\n```json\n{\n  \"key\": \"value\"\n}\n```\nDone.";
      const input = `\`\`\`action
tool: write_file
path: test.md
content:
${nestedContent}
\`\`\``;

      const parsed = ResilientParser.parse(input);
      expect(parsed.type).toBe("action");
      if (parsed.type === "action") {
        expect(parsed.action.content).toBe(nestedContent);
      }
    });
  });

  describe("Test Case 2: edit operation with old_string containing \\npath:", () => {
    it("should not truncate old_string when it contains \\npath: in config or code", () => {
      const oldSnippet = `server:\n  host: 0.0.0.0\npath: /var/log/app\nport: 8080`;
      const newSnippet = `server:\n  host: 127.0.0.1\npath: /var/log/app\nport: 9090`;
      const input = `\`\`\`action
tool: edit
path: config.yaml
old_string:
${oldSnippet}
new_string:
${newSnippet}
\`\`\``;

      const parsed = ResilientParser.parse(input);
      expect(parsed.type).toBe("action");
      if (parsed.type === "action") {
        expect(parsed.action.tool).toBe("edit");
        expect(parsed.action.path).toBe("config.yaml");
        expect(parsed.action.old_string).toBe(oldSnippet);
        expect(parsed.action.new_string).toBe(newSnippet);
      }
    });
  });

  describe("Test Case 3: ALL_TASKS_COMPLETED discussed in prose without being a standalone marker", () => {
    it("should NOT treat prose/thought mentioning ALL_TASKS_COMPLETED as final_answer", () => {
      const discussionText = "我们在审计中发现代码里提及了 ALL_TASKS_COMPLETED 标记，需要评估其解析鲁棒性。";
      const parsed = ResilientParser.parse(discussionText);
      expect(parsed.type).not.toBe("final_answer");
      expect(parsed.type).toBe("invalid_chatter");
    });

    it("should NOT treat THOUGHT mentioning ALL_TASKS_COMPLETED as final_answer when followed by normal discussion", () => {
      const input = "THOUGHT: Analyzing the ALL_TASKS_COMPLETED token issue in test suite\nWe are currently investigating.";
      const parsed = ResilientParser.parse(input);
      expect(parsed.type).not.toBe("final_answer");
      expect(parsed.type).toBe("invalid_chatter");
    });

    it("should correctly identify ALL_TASKS_COMPLETED when used as standalone line marker or final answer", () => {
      const standalone = "ALL_TASKS_COMPLETED\n已完成所有代码修复与测试验证";
      const parsed = ResilientParser.parse(standalone);
      expect(parsed.type).toBe("final_answer");

      const withThought = "THOUGHT: 修复全部完成\nALL_TASKS_COMPLETED: 任务交付完毕";
      const parsed2 = ResilientParser.parse(withThought);
      expect(parsed2.type).toBe("final_answer");
    });
  });

  describe("Test Case 4: PromptBuilder.buildTurn2TaskPrompt with toolResult containing 'Skill'", () => {
    it("should not swap taskPrompt and toolResult when toolResult contains 'Skill'", () => {
      const task = "执行代码健康度审计";
      const toolOutput = "Running skill validation suite:\nPASS test-SkillLoader.test.ts\nAll Skill tests passed (100%)";

      // Testing positional argument style with skillsSection empty
      const promptPos = PromptBuilder.buildTurn2TaskPrompt(task, "", toolOutput, "run_command");
      expect(promptPos).toContain(`[TOOL_RESULT for run_command - SUCCESS]:\n${toolOutput}`);
      expect(promptPos).toContain(`【用户正式需求】\n${task}`);
      expect(promptPos).not.toContain(`【当前已激活的专业技能 (Skill)】\n${toolOutput}`);

      // Testing explicit options object style
      const promptObj = PromptBuilder.buildTurn2TaskPrompt({
        taskPrompt: task,
        toolResult: toolOutput,
        toolName: "run_command",
      });
      expect(promptObj).toContain(`[TOOL_RESULT for run_command - SUCCESS]:\n${toolOutput}`);
      expect(promptObj).toContain(`【用户正式需求】\n${task}`);
      expect(promptObj).not.toContain(`【当前已激活的专业技能 (Skill)】\n${toolOutput}`);

      // Testing 2-argument style (task, toolResult) where toolResult contains "Skill"
      const promptTwoArg = PromptBuilder.buildTurn2TaskPrompt(task, toolOutput);
      expect(promptTwoArg).toContain(`[TOOL_RESULT - SUCCESS]:\n${toolOutput}`);
      expect(promptTwoArg).toContain(`【用户正式需求】\n${task}`);
      expect(promptTwoArg).not.toContain(`【当前已激活的专业技能 (Skill)】`);

      // Testing with explicit skills section and toolResult containing "Skill"
      const promptWithSkills = PromptBuilder.buildTurn2TaskPrompt({
        taskPrompt: task,
        skillsSection: "#### [技能 1: tdd]",
        toolResult: toolOutput,
        toolName: "run_command",
      });
      expect(promptWithSkills).toContain(`[TOOL_RESULT for run_command - SUCCESS]:\n${toolOutput}`);
      expect(promptWithSkills).toContain("#### [技能 1: tdd]");
      expect(promptWithSkills).toContain(`【用户正式需求】\n${task}`);
    });
  });

  describe("Handoff Snapshot Sanitization", () => {
    it("should sanitize sessionId in generateHandoffSnapshot to prevent path traversal", async () => {
      const { mkdtemp, rm } = await import("fs/promises");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const { existsSync } = await import("fs");
      const { CopilotOrchestrator } = await import("../../src/agent/orchestrator.ts");

      const tempDir = await mkdtemp(join(tmpdir(), "cph-safe-session-test-"));
      try {
        const orchestrator = new CopilotOrchestrator({
          workspaceRoot: tempDir,
        });

        // Pass malicious path traversal sessionId
        const maliciousSessionId = "../../escape_test";
        const doc = orchestrator.generateHandoffSnapshot("测试任务", [], maliciousSessionId);
        expect(doc).toBeDefined();

        // Should NOT write outside .cph/handoffs
        expect(existsSync(join(tempDir, "..", "handoff-escape_test.md"))).toBe(false);
        // Should write inside .cph/handoffs with sanitized basename
        expect(existsSync(join(tempDir, ".cph", "handoffs", "handoff-escape_test.md"))).toBe(true);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
