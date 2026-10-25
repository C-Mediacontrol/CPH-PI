import { describe, expect, test } from "bun:test";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";

describe("DeliverablesParser", () => {
  test("extracts deliverables with <- and -> separators, markdown links, and zip semantics", () => {
    const text = `FINAL_ANSWER:
【交付文件与落盘指引 / Deliverables】
- \`test/CNNJI-QUERY-review-2026-10-25.md\` <- [下载审查报告](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-123/views/original/CNNJI-QUERY-review-2026-10-25.md)
- \`test/package.zip\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/CNNJI-QUERY-review-package-2026-10-25.zip
- \`test/extracted/\` -> [下载压缩包](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/pkg.zip)

# 审查报告正文
普通参考链接: [参考文档](https://cmacgmgroup.sharepoint.com/sites/test/doc.md)
- 普通冒号说明: https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/should-not-match/views/original/ignore.md
`;

    const items = DeliverablesParser.extractDeliverables(text, "E:/test");
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      targetPath: "test/CNNJI-QUERY-review-2026-10-25.md",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-123/views/original/CNNJI-QUERY-review-2026-10-25.md",
      isDirectory: false,
      isZip: false,
    });

    // Target path ends with .zip -> isDirectory: false, isZip: true
    expect(items[1]).toEqual({
      targetPath: "test/package.zip",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/CNNJI-QUERY-review-package-2026-10-25.zip",
      isDirectory: false,
      isZip: true,
    });

    // Target path ends with / -> isDirectory: true, isZip: true
    expect(items[2]).toEqual({
      targetPath: "test/extracted/",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/pkg.zip",
      isDirectory: true,
      isZip: true,
    });
  });

  test("rejects path traversal and absolute paths outside workspace", () => {
    const text = `【交付文件与落盘指引 / Deliverables】
- \`../outside/evil.sh\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/1/views/original/evil.sh
- \`C:/Windows/System32/cmd.exe\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/2/views/original/cmd.exe
- \`valid/report.md\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/3/views/original/report.md
- \`./stripped/relative.md\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/4/views/original/relative.md
`;
    const items = DeliverablesParser.extractDeliverables(text, "E:/test");
    expect(items).toHaveLength(2);
    expect(items[0].targetPath).toBe("valid/report.md");
    expect(items[1].targetPath).toBe("stripped/relative.md");
  });
});
