import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import React from "../../web/node_modules/react";
import { renderToStaticMarkup } from "../../web/node_modules/react-dom/server";

describe("ToolRow & ExitCodeBadge Components (Task 3)", () => {
  const exitCodeBadgePath = path.resolve(__dirname, "../../web/src/components/chat/ExitCodeBadge.tsx");
  const toolRowPath = path.resolve(__dirname, "../../web/src/components/chat/ToolRow.tsx");
  const toolExecutionCardPath = path.resolve(__dirname, "../../web/src/components/chat/ToolExecutionCard.tsx");
  const indexPath = path.resolve(__dirname, "../../web/src/components/chat/index.ts");

  describe("File Structure & Exports", () => {
    it("should have ExitCodeBadge.tsx file created", () => {
      expect(fs.existsSync(exitCodeBadgePath)).toBe(true);
    });

    it("should have ToolRow.tsx file created", () => {
      expect(fs.existsSync(toolRowPath)).toBe(true);
    });

    it("should export ToolRow, ExitCodeBadge, and ToolExecutionCard from index.ts", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toContain("ToolRow");
      expect(content).toContain("ExitCodeBadge");
      expect(content).toContain("ToolExecutionCard");
    });
  });

  describe("ExitCodeBadge Component", () => {
    it("should render status capsule for exit code 0 with green dot and Exit 0 label", async () => {
      const { ExitCodeBadge } = await import("../../web/src/components/chat/ExitCodeBadge.tsx");
      const html = renderToStaticMarkup(React.createElement(ExitCodeBadge, { exitCode: 0 }));

      // Must be a capsule pill
      expect(html).toContain("rounded-full");
      expect(html).toContain("font-mono");
      expect(html).toContain("inline-flex");
      // Green indicator for success
      expect(html).toContain("bg-emerald");
      expect(html).toContain("text-emerald");
      expect(html).toContain("Exit 0");
    });

    it("should render status capsule for non-zero exit code with red dot and Exit code label", async () => {
      const { ExitCodeBadge } = await import("../../web/src/components/chat/ExitCodeBadge.tsx");
      const html = renderToStaticMarkup(React.createElement(ExitCodeBadge, { exitCode: 1 }));

      expect(html).toContain("rounded-full");
      expect(html).toContain("bg-rose");
      expect(html).toContain("text-rose");
      expect(html).toContain("Exit 1");
    });

    it("should render custom label when provided", async () => {
      const { ExitCodeBadge } = await import("../../web/src/components/chat/ExitCodeBadge.tsx");
      const html = renderToStaticMarkup(React.createElement(ExitCodeBadge, { label: "SIGTERM", exitCode: 143 }));

      expect(html).toContain("SIGTERM");
      expect(html).toContain("bg-rose");
    });
  });

  describe("ToolRow Component Specifications", () => {
    it("should satisfy 24px single line row specification and dot separator", async () => {
      expect(fs.existsSync(toolRowPath)).toBe(true);
      const content = fs.readFileSync(toolRowPath, "utf-8");
      // Height 24px (h-6 / min-h-[24px])
      expect(content).toMatch(/h-6|min-h-\[24px\]/);
      // 2x2 dot separator (w-1 h-1 rounded-full)
      expect(content).toMatch(/w-1\s+h-1\s+rounded-full/);
      // Dotted underline link for target path/command
      expect(content).toContain("decoration-dotted");
      expect(content).toContain("underline-offset-4");
      // Monospace tabular diff totals
      expect(content).toContain("font-tabular");
      expect(content).toContain("diffStat");
    });

    it("should render 24px header with tool name, target, and diff totals", async () => {
      const { ToolRow } = await import("../../web/src/components/chat/ToolRow.tsx");
      const html = renderToStaticMarkup(
        React.createElement(ToolRow, {
          toolName: "patch_file",
          target: "src/main.ts",
          diffStat: { added: 12, removed: 4 },
          isExpanded: false,
        })
      );

      expect(html).toContain("patch_file");
      expect(html).toContain("src/main.ts");
      expect(html).toContain("+12");
      expect(html).toContain("-4");
      expect(html).toContain("text-emerald");
      expect(html).toContain("text-rose");
    });

    it("should render expanded unified diff with line numbers and hunk blocks", async () => {
      const { ToolRow } = await import("../../web/src/components/chat/ToolRow.tsx");
      const diffContent = [
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,3 +1,4 @@",
        " line1",
        "-oldLine",
        "+newLine",
        "+extraLine",
      ].join("\n");

      const html = renderToStaticMarkup(
        React.createElement(ToolRow, {
          toolName: "patch_file",
          target: "src/file.ts",
          diff: diffContent,
          isExpanded: true,
        })
      );

      expect(html).toContain("bg-emerald-950/30");
      expect(html).toContain("bg-rose-950/30");
      expect(html).toContain("newLine");
      expect(html).toContain("oldLine");
      expect(html).toContain("@@ -1,3 +1,4 @@");
    });

    it("should render expanded terminal view with ExitCodeBadge and command output", async () => {
      const { ToolRow } = await import("../../web/src/components/chat/ToolRow.tsx");
      const html = renderToStaticMarkup(
        React.createElement(ToolRow, {
          toolName: "run_command",
          command: "npm test",
          target: "npm test",
          exitCode: 0,
          terminal: {
            command: "npm test",
            output: "All 10 tests passed successfully.",
            exitCode: 0,
          },
          isExpanded: true,
        })
      );

      expect(html).toContain("npm test");
      expect(html).toContain("All 10 tests passed successfully.");
      expect(html).toContain("Exit 0");
    });

    it("should render expanded generic IO card for other tools", async () => {
      const { ToolRow } = await import("../../web/src/components/chat/ToolRow.tsx");
      const html = renderToStaticMarkup(
        React.createElement(ToolRow, {
          toolName: "read_file",
          target: "README.md",
          inputRaw: JSON.stringify({ path: "README.md" }),
          output: "File contents here",
          isExpanded: true,
        })
      );

      expect(html).toContain("Input");
      expect(html).toContain("Output");
      expect(html).toContain("File contents here");
    });
  });

  describe("ToolExecutionCard Adapter & Delegation", () => {
    it("should utilize ToolRow inside ToolExecutionCard", () => {
      const content = fs.readFileSync(toolExecutionCardPath, "utf-8");
      expect(content).toContain("ToolRow");
      expect(content).toContain("<ToolRow");
    });

    it("should render ToolExecutionCard using ToolRow presentation", async () => {
      const { ToolExecutionCard } = await import("../../web/src/components/chat/ToolExecutionCard.tsx");
      const sampleToolCall = {
        id: "call-1",
        action: {
          tool: "run_command",
          command: "bun test",
        },
        status: "completed" as const,
        result: {
          success: true,
          output: "Test run ok",
          exitCode: 0,
        },
        timestamp: Date.now(),
      };

      const html = renderToStaticMarkup(
        React.createElement(ToolExecutionCard, { toolCall: sampleToolCall, defaultExpanded: true })
      );

      expect(html).toContain("run_command");
      expect(html).toContain("bun test");
      expect(html).toContain("Exit 0");
    });
  });
});
