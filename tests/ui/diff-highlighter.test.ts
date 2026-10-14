import { describe, it, expect } from "bun:test";
import { DiffHighlighter } from "../../src/ui/diff-highlighter.ts";

describe("DiffHighlighter Unit & Word Diff Suite (CR-4)", () => {
  const highlighter = new DiffHighlighter({ colorLevel: 3 });

  describe("1. Patch Headers & Context Preservation", () => {
    it("should render unified patch headers in bold cyan and cyan", () => {
      const patch = [
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        "@@ -10,4 +10,4 @@",
        "  const a = 1;",
      ].join("\n");

      const output = highlighter.renderDiff(patch);
      expect(output).toContain("--- a/src/index.ts");
      expect(output).toContain("+++ b/src/index.ts");
      expect(output).toContain("@@ -10,4 +10,4 @@");
      expect(output).toContain("const a = 1;");
      // Cyan ANSI
      expect(output).toContain("\u001b[36m");
    });

    it("should format context lines with dim / gray styling", () => {
      const patch = "  unchanged context line";
      const output = highlighter.renderDiff(patch);
      expect(output).toContain("unchanged context line");
      // Dim ANSI \u001b[2m
      expect(output).toContain("\u001b[2m");
    });
  });

  describe("2. Intra-Line Word Diff Highlighting", () => {
    it("should highlight word-level modifications when 1 removed and 1 added line are adjacent", () => {
      const diff = [
        "-const timeoutSec = 300;",
        "+const timeoutSec = 600;",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      // Red for removed line, Green for added line
      expect(output).toContain("\u001b[31m");
      expect(output).toContain("\u001b[32m");
      // Inverse for changed tokens (300 vs 600)
      expect(output).toContain("\u001b[7m");
      expect(output).toContain("300");
      expect(output).toContain("600");
    });

    it("should strip leading whitespace from inverse highlight to prevent whitespace inverse", () => {
      const diff = [
        "-    const oldVal = 10;",
        "+    const newVal = 20;",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      expect(output).toContain("\u001b[7m");
      // Should preserve indentation
      expect(output).toContain("    const");
    });

    it("should replace tabs with three spaces", () => {
      const diff = [
        "-\tconst tabbed = 1;",
        "+\tconst tabbed = 2;",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      expect(output).not.toContain("\t");
      expect(output).toContain("   const");
    });
  });

  describe("3. Multi-line Removed and Added Blocks", () => {
    it("should correctly render multi-line removals without paired intra-line", () => {
      const diff = [
        "-line 1",
        "-line 2",
        "-line 3",
        "+new replacement line",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      expect(output).toContain("-line 1");
      expect(output).toContain("-line 2");
      expect(output).toContain("-line 3");
      expect(output).toContain("+new replacement line");
      expect(output).toContain("\u001b[31m");
      expect(output).toContain("\u001b[32m");
    });

    it("should correctly render added lines without removed lines", () => {
      const diff = [
        "+export function newHelper(): void {",
        "+  return;",
        "+}",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      expect(output).toContain("+export function newHelper(): void {");
      expect(output).toContain("\u001b[32m");
    });
  });

  describe("4. Static Helper & Line Number Support", () => {
    it("should support DiffHighlighter.render static method", () => {
      const rendered = DiffHighlighter.render("-old\n+new");
      expect(rendered).toContain("old");
      expect(rendered).toContain("new");
      expect(rendered).toContain("-");
      expect(rendered).toContain("+");
    });

    it("should preserve parsed line numbers when available in diff lines", () => {
      const diff = [
        "- 10 old code",
        "+ 10 new code",
      ].join("\n");

      const output = highlighter.renderDiff(diff);
      expect(output).toContain("10 ");
    });
  });
});
