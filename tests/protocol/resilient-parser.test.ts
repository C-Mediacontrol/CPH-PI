import { describe, it, expect } from "bun:test";
import {
  ResilientParser,
  type ParsedTurn,
} from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser Unit Tests", () => {
  describe("1. Action Block Extraction", () => {
    it("should parse standard ```action block with YAML-like fields", () => {
      const text = `
THOUGHT: Let's read the configuration file.
\`\`\`action
tool: read_file
path: src/config.json
start_line: 1
end_line: 40
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.thought).toBe("Let's read the configuration file.");
        expect(result.action.tool).toBe("read_file");
        expect(result.action.path).toBe("src/config.json");
        expect(result.action.start_line).toBe(1);
        expect(result.action.end_line).toBe(40);
      }
    });

    it("should parse ```json action block", () => {
      const text = `
I need to update the entrypoint.
\`\`\`json
{
  "tool": "edit",
  "path": "src/index.ts",
  "old_string": "const port = 3000;",
  "new_string": "const port = 8080;"
}
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.thought).toBe("I need to update the entrypoint.");
        expect(result.action.tool).toBe("edit");
        expect(result.action.path).toBe("src/index.ts");
        expect(result.action.old_string).toBe("const port = 3000;");
        expect(result.action.new_string).toBe("const port = 8080;");
      }
    });

    it("should parse json block using 'action' instead of 'tool'", () => {
      const text = `
\`\`\`json
{
  "action": "run_command",
  "command": "bun test"
}
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("run_command");
        expect(result.action.command).toBe("bun test");
      }
    });

    it("should parse generic code block containing tool: fields", () => {
      const text = `
\`\`\`
tool: bash
command: git status
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("run_command");
        expect(result.action.command).toBe("git status");
      }
    });

    it("should parse unfenced action when streaming without backticks", () => {
      const text = `
正在检查分支状态...
tool: run_command
command: git branch -a
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.thought).toBe("正在检查分支状态...");
        expect(result.action.tool).toBe("run_command");
        expect(result.action.command).toBe("git branch -a");
      }
    });

    it("should parse ACTION: prefix without backticks", () => {
      const text = `
ACTION: read_file
path: package.json
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("read_file");
        expect(result.action.path).toBe("package.json");
      }
    });

    it("should parse tool_call> syntax", () => {
      const text = `
tool_call>
tool: write_file
path: test.txt
content: Hello world
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("write_file");
        expect(result.action.path).toBe("test.txt");
        expect(result.action.content).toBe("Hello world");
      }
    });

    it("should parse shorthand tool syntax: read_file <path>", () => {
      const text = `
\`\`\`action
read_file src/app.ts
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("read_file");
        expect(result.action.path).toBe("src/app.ts");
      }
    });

    it("should parse shorthand tool syntax: run_command <command>", () => {
      const text = `
\`\`\`action
run_command bun test tests/agent
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("run_command");
        expect(result.action.command).toBe("bun test tests/agent");
      }
    });

    it("should parse ask_question with options", () => {
      const text = `
\`\`\`action
tool: ask_question
question: Do you want to run tests now?
options: Yes | No
\`\`\`
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("action");
      if (result.type === "action") {
        expect(result.action.tool).toBe("ask_question");
        expect(result.action.question).toBe("Do you want to run tests now?");
        expect(result.action.options).toBe("Yes | No");
      }
    });
  });

  describe("2. Final Answer Recognition", () => {
    it("should parse FINAL_ANSWER: with summary and thought", () => {
      const text = `
THOUGHT: All 5 tasks are successfully verified and tests pass.
FINAL_ANSWER:
已成功完成任务 5 的开发与测试，状态机流转正常。
`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("final_answer");
      if (result.type === "final_answer") {
        expect(result.thought).toBe("All 5 tasks are successfully verified and tests pass.");
        expect(result.answer.summary).toContain("已成功完成任务 5");
      }
    });

    it("should parse FINALANSWER: without underscore", () => {
      const text = `FINALANSWER: Everything looks good.`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("final_answer");
      if (result.type === "final_answer") {
        expect(result.answer.summary).toBe("Everything looks good.");
      }
    });

    it("should recognize ALL_TASKS_COMPLETED marker", () => {
      const text = `Task done.\nALL_TASKS_COMPLETED`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("final_answer");
    });

    it("should recognize 【已完成交付】 marker", () => {
      const text = `全部文件已生成并测试验证通过。\n【已完成交付】`;
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("final_answer");
    });
  });

  describe("3. Invalid Chatter and Fallback", () => {
    it("should flag conversational chatter as invalid_chatter with guidance warning", () => {
      const text = "你好！今天我能为你做些什么呢？";
      const result = ResilientParser.parse(text);
      expect(result.type).toBe("invalid_chatter");
      if (result.type === "invalid_chatter") {
        expect(result.thought).toBe("你好！今天我能为你做些什么呢？");
        expect(result.warning).toContain("请按协议约定操作");
      }
    });
  });
});
