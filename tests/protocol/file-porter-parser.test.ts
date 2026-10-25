import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser - File Porter & Native File Generation", () => {
  it("should extract file_porter action from HTML anchor with download attribute", () => {
    const rawOutput = `
已推理 1秒
正在编码和执行

已生成可执行 Python 脚本文件：

<a role="link" class="fui-Link fai-bebop" href="blob:https://m365.cloud.microsoft/58146e9c-4414-461b-85fb-fa56ebb140a2" download="test_porter.py" target="_blank">下载 test_porter.py</a>

该脚本会计算并打印斐波那契数列前 10 项。
`;

    const parsed = ResilientParser.parse(rawOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("file_porter");
      expect(parsed.action.fileName).toBe("test_porter.py");
      expect(parsed.action.downloadUrl).toBe(
        "blob:https://m365.cloud.microsoft/58146e9c-4414-461b-85fb-fa56ebb140a2"
      );
      expect(parsed.action.autoExecute).toBe(false);
    }
  });

  it("should extract file_porter action from Markdown download link with blob: URL", () => {
    const rawOutput = `
我已经为你生成了自动化诊断脚本：

[下载 inspect_env.py](blob:https://m365.cloud.microsoft/abc-123-xyz)

请运行该脚本收集诊断数据。
`;

    const parsed = ResilientParser.parse(rawOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("file_porter");
      expect(parsed.action.fileName).toBe("inspect_env.py");
      expect(parsed.action.downloadUrl).toBe("blob:https://m365.cloud.microsoft/abc-123-xyz");
      expect(parsed.action.autoExecute).toBe(false);
    }
  });

  it("should parse explicit action block with file_porter tool", () => {
    const rawOutput = `
\`\`\`action
tool: file_porter
file: test_script.py
url: blob:https://m365.cloud.microsoft/test-uuid
auto_execute: true
\`\`\`
`;

    const parsed = ResilientParser.parse(rawOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("file_porter");
      expect(parsed.action.fileName).toBe("test_script.py");
      expect(parsed.action.downloadUrl).toBe("blob:https://m365.cloud.microsoft/test-uuid");
      expect(parsed.action.autoExecute).toBe(true);
    }
  });

  it("should identify non-executable files like .md with autoExecute false", () => {
    const rawOutput = `
已生成完整的架构重构设计文档：
<a href="blob:https://m365.cloud.microsoft/doc-uuid" download="architecture_review.md">下载 architecture_review.md</a>
`;

    const parsed = ResilientParser.parse(rawOutput);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("file_porter");
      expect(parsed.action.fileName).toBe("architecture_review.md");
      expect(parsed.action.autoExecute).toBe(false);
    }
  });

  it("should still prioritize FINAL_ANSWER if present along with file link", () => {
    const rawOutput = `
已生成最终报告：
<a href="blob:https://m365.cloud.microsoft/doc-uuid" download="summary.md">下载 summary.md</a>

FINAL_ANSWER: 全部任务已完成，最终交付报告已生成。
`;

    const parsed = ResilientParser.parse(rawOutput);
    expect(parsed.type).toBe("final_answer");
  });
});

