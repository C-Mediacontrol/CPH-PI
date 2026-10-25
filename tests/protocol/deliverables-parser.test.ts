import { describe, expect, test } from "bun:test";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";

const section = (body: string) =>
  `FINAL_ANSWER: 完成\n\n【交付文件与落盘指引 / Deliverables】\n${body}\n\n# 报告\n正文`;

describe("DeliverablesParser", () => {
  test("parses backtick path with left arrow", () => {
    const items = DeliverablesParser.parse(
      section("- `test/review.md` <- [review.md](https://x.test/a.md)")
    );
    expect(items).toHaveLength(1);
    expect(items[0].destinationPath).toBe("test/review.md");
    expect(items[0].url).toBe("https://x.test/a.md");
    expect(items[0].fileName).toBe("review.md");
    expect(items[0].isZipTarget).toBe(false);
  });

  test("parses directory target with right arrow", () => {
    const items = DeliverablesParser.parse(
      section("- `test/` -> [bundle.zip](https://x.test/b.zip)")
    );
    expect(items).toHaveLength(1);
    expect(items[0].destinationPath).toBe("test/");
    expect(items[0].isZipTarget).toBe(false);
  });

  test("marks .zip target", () => {
    const items = DeliverablesParser.parse(
      section("- `test/bundle.zip` <- [b.zip](https://x.test/b.zip)")
    );
    expect(items[0].isZipTarget).toBe(true);
  });

  test("accepts unicode arrows and backticks", () => {
    const items = DeliverablesParser.parse(
      section("- `test/报告.md` ← [报告](https://x.test/%E6%8A%A5%E5%91%8A.md)")
    );
    expect(items[0].destinationPath).toBe("test/报告.md");
    expect(items[0].url).toContain("%E6%8A%A5");
  });

  test("ignores non-deliverable markdown links outside the section", () => {
    const items = DeliverablesParser.parse("FINAL_ANSWER: 见 [文档](https://x.test/a.md)");
    expect(items).toHaveLength(0);
  });

  test("rejects path traversal and absolute paths", () => {
    expect(
      DeliverablesParser.parse(section("- `../evil.sh` <- [e](https://x.test/e.sh)"))
    ).toHaveLength(0);
    expect(
      DeliverablesParser.parse(section("- `/etc/passwd` <- [e](https://x.test/e.sh)"))
    ).toHaveLength(0);
  });

  test("deduplicates identical declarations", () => {
    const body =
      "- `test/a.md` <- [a](https://x.test/a.md)\n- `test/a.md` <- [a](https://x.test/a.md)";
    expect(DeliverablesParser.parse(section(body))).toHaveLength(1);
  });

  test("ignores non-http URLs", () => {
    expect(
      DeliverablesParser.parse(section("- `test/a.md` <- [a](file:///tmp/a.md)"))
    ).toHaveLength(0);
  });
});
