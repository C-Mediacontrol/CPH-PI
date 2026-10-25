import { describe, it, expect } from "bun:test";
import {
  DeliverablesParser,
  type DeliverableItem,
} from "../../src/protocol/resilient-parser.ts";

describe("DeliverablesParser", () => {
  describe("1. Standard Arrow Syntax Parsing", () => {
    it("should parse standard arrow syntax with backticks and target label", () => {
      const text = `
FINAL_ANSWER: 任务执行完毕。

【交付文件与落盘指引 / Deliverables】
- [详细审查文档.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/doc123) -> 目标落盘路径: \`test/CNNJI-QUERY-review-2026-10-25.md\`
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0]).toEqual({
        name: "详细审查文档.md",
        url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/doc123",
        destinationPath: "test/CNNJI-QUERY-review-2026-10-25.md",
        isZip: false,
      });
    });

    it("should support arrow variants (—>, -->, =>, →, ➔) and unquoted paths", () => {
      const text = `
- [doc1.md](https://example.com/doc1) —> 目标落盘路径: test/doc1.md
- [doc2.md](https://example.com/doc2) --> 目标落盘路径: "test/doc2.md"
- [doc3.md](https://example.com/doc3) => 目标落盘路径: 'test/doc3.md'
- [doc4.md](https://example.com/doc4) → 目标落盘路径: test/doc4.md
- [doc5.md](https://example.com/doc5) ➔ 目标落盘路径: test/doc5.md
- [doc6.md](https://example.com/doc6) -> test/doc6.md
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(6);
      expect(deliverables.map((d) => d.destinationPath)).toEqual([
        "test/doc1.md",
        "test/doc2.md",
        "test/doc3.md",
        "test/doc4.md",
        "test/doc5.md",
        "test/doc6.md",
      ]);
    });
  });

  describe("2. Colon Syntax and Windows Backslash Normalization", () => {
    it("should parse colon syntax and normalize Windows backslashes to POSIX slashes", () => {
      const text = `
- [代码审查.md](https://example.com/file1) 目标落盘路径: test\\sub\\review.md
- [架构图.png](https://example.com/file2) 目标落盘路径：test\\images\\arch.png
- [配置.json](https://example.com/file3): test\\config\\dev.json
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(3);
      expect(deliverables[0].destinationPath).toBe("test/sub/review.md");
      expect(deliverables[1].destinationPath).toBe("test/images/arch.png");
      expect(deliverables[2].destinationPath).toBe("test/config/dev.json");
    });

    it("should resolve absolute path against workspaceRoot into relative POSIX path", () => {
      const workspaceRoot = "E:/copilot-web proxy/CPH-PI";
      const text = `
- [测试报告.md](https://example.com/rep) -> 目标落盘路径: \`E:\\copilot-web proxy\\CPH-PI\\test\\reports\\rep.md\`
`;

      const deliverables = DeliverablesParser.parse(text, workspaceRoot);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/reports/rep.md");
    });
  });

  describe("3. Stripping Trailing Explanations and Zip Handling", () => {
    it("should strip trailing (ZIP 自动解压) and mark isZip as true", () => {
      const text = `
- [完整交付包.zip](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/pkg1) -> 目标落盘路径: \`test/\` (ZIP 自动解压)
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0]).toEqual({
        name: "完整交付包.zip",
        url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/pkg1",
        destinationPath: "test/",
        isZip: true,
      });
    });

    it("should recognize zip files by extension even without explicit ZIP comment", () => {
      const text = `
- [package.zip](https://example.com/pkg.zip) -> 目标落盘路径: \`test/packages/release.zip\`
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].isZip).toBe(true);
      expect(deliverables[0].destinationPath).toBe("test/packages/release.zip");
    });

    it("should strip other bracketed explanations at end of line", () => {
      const text = `
- [说明.md](https://example.com/readme) -> 目标落盘路径: \`test/README.md\` （必须包含测试证据）
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/README.md");
      expect(deliverables[0].isZip).toBe(false);
    });
  });

  describe("4. Fallback Inference for asyncgw Links Without Path", () => {
    it("should auto-infer filename and fallback to test/ subdirectory for asyncgw links", () => {
      const text = `
我已为你生成好了审查总结文档，请查阅：
[CNNJI-QUERY-review.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/abc-123)

交付已经完成。
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0]).toEqual({
        name: "CNNJI-QUERY-review.md",
        url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/abc-123",
        destinationPath: "test/CNNJI-QUERY-review.md",
        isZip: false,
      });
    });

    it("should infer zip file and set isZip=true when asyncgw link references a zip archive", () => {
      const text = `
生成的压缩包已就绪：[audit-deliverables.zip](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/bundle999)
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0]).toEqual({
        name: "audit-deliverables.zip",
        url: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/bundle999",
        destinationPath: "test/audit-deliverables.zip",
        isZip: true,
      });
    });

    it("should extract filename from URL query params if anchor text has no extension", () => {
      const text = `
请下载：[点击获取分析文档](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/xyz?filename=performance-analysis.docx)
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].name).toBe("点击获取分析文档");
      expect(deliverables[0].destinationPath).toBe("test/performance-analysis.docx");
      expect(deliverables[0].isZip).toBe(false);
    });

    it("should provide safe default .md extension if anchor text and URL have no extension", () => {
      const text = `
报告已完成：[终局审查报告](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/rawdata123)
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/终局审查报告.md");
      expect(deliverables[0].isZip).toBe(false);
    });

    it("should not duplicate deliverables when already matched by standard syntax", () => {
      const text = `
【交付文件与落盘指引 / Deliverables】
- [报告.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/111) -> 目标落盘路径: \`test/custom-report.md\`

下面是正文：
您可以随时通过 [报告.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/111) 查阅详细内容。
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/custom-report.md");
    });
  });

  describe("5. Safety Constraints & Edge Cases", () => {
    it("should enforce AGENTS.md Rule 1: naked filename without dir is relocated to test/ subdirectory", () => {
      const text = `
- [root_attempt.md](https://example.com/root.md) -> 目标落盘路径: \`root_attempt.md\`
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/root_attempt.md");
    });

    it("should sanitize path traversal attempts to prevent escaping workspace root", () => {
      const text = `
- [hack.md](https://example.com/hack.md) -> 目标落盘路径: \`../../etc/evil.md\`
`;

      const deliverables = DeliverablesParser.parse(text);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].destinationPath).toBe("test/etc/evil.md");
    });

    it("should return empty array for empty, whitespace, or chat text without links", () => {
      expect(DeliverablesParser.parse("")).toEqual([]);
      expect(DeliverablesParser.parse("   \n\t  ")).toEqual([]);
      expect(DeliverablesParser.parse("Hello, how can I assist you today?")).toEqual([]);
      expect(DeliverablesParser.parse("Check out [Google](https://google.com) for more info")).toEqual([]);
    });
  });
});
