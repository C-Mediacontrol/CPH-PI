import { describe, expect, test } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser Precedence & File Porter Safety", () => {
  test("FINAL_ANSWER with code blocks Containing 'tool:' or 'path:' is parsed as final_answer, not action", () => {
    const response = `FINAL_ANSWER:
【交付文件与落盘指引 / Deliverables】
- \`test/report.md\` <- [report.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-1/views/original/report.md)

# 代码审查结论
我们在配置中看到了如下片段：
\`\`\`yaml
tool: read_file
path: src/index.ts
\`\`\`
全部审查已完成。`;

    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("final_answer");
  });

  test("write_file action with url field is parsed with downloadUrl and path", () => {
    const response = `THOUGHT: 我已生成脚本文件，现在通过 write_file 落盘。
\`\`\`json:action
{
  "tool": "write_file",
  "path": "src/generated/helper.ts",
  "url": "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/helper.ts"
}
\`\`\``;

    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("write_file");
      expect(parsed.action.path).toBe("src/generated/helper.ts");
      expect(parsed.action.downloadUrl).toBe(
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/helper.ts"
      );
      expect(parsed.action.autoExecute).toBe(false);
    }
  });

  test("plain markdown https link in conversational text is NOT hijacked into auto-executing file_porter", () => {
    const response = `请参考 [deploy.py](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/deploy.py)`;
    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("invalid_chatter");
  });
});
