import { describe, expect, test } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser deliverables precedence", () => {
  test("FINAL_ANSWER with a markdown link stays a final answer", () => {
    const raw = [
      "FINAL_ANSWER: 完成审查",
      "",
      "【交付文件与落盘指引 / Deliverables】",
      "- `test/review.md` <- [review.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/original)",
      "",
      "# 报告",
      "正文",
    ].join("\n");

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("final_answer");
  });

  test("explicit download anchor still maps to file_porter", () => {
    const raw =
      '<a href="https://x.test/a.py" download="a.py">下载 a.py</a>';
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("file_porter");
    }
  });
});
