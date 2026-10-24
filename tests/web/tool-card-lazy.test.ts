import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import React from "../../web/node_modules/react";
import { renderToString } from "../../web/node_modules/react-dom/server";
import type { ToolCall } from "../../web/src/types/protocol";

describe("2. ToolCard Lazy Rendering Strategy (Task 2)", () => {
  const root = path.resolve(__dirname, "../../");

  it("should integrate LazyTextCollapse in ToolCard and optimize default expanded state", () => {
    const cardPath = path.join(root, "web/src/components/chat/ToolCard.tsx");
    expect(fs.existsSync(cardPath)).toBe(true);
    const content = fs.readFileSync(cardPath, "utf8");
    expect(content).toContain("LazyTextCollapse");
    // Completed status should not blindly default expand every output
    expect(content).not.toMatch(
      /defaultExpanded\s*:\s*tool\.status\s*===\s*'running'\s*\|\|\s*Boolean\(tool\.output\s*\|\|\s*tool\.diff\)/
    );
    expect(content).toContain("tool.status === 'running' || tool.status === 'failed'");
  });

  it("should configure LazyTextCollapse with maxLines 35 and maxChars 1800 for tool.output", () => {
    const cardPath = path.join(root, "web/src/components/chat/ToolCard.tsx");
    const content = fs.readFileSync(cardPath, "utf8");
    expect(content).toContain("maxLines={35}");
    expect(content).toContain("maxChars={1800}");
  });

  it("should dynamically import ToolCard and verify export", async () => {
    const mod = await import("../../web/src/components/chat/ToolCard");
    expect(typeof mod.ToolCard).toBe("function");
  });

  it("should expand by default when tool status is running", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const runningTool: ToolCall = {
      id: "tool-run-1",
      name: "run_command",
      args: { command: "cargo build" },
      status: "running",
      output: "Compiling crates...",
    };

    const html = renderToString(React.createElement(ToolCard, { tool: runningTool }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Compiling crates...");
  });

  it("should expand by default when tool status is failed", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const failedTool: ToolCall = {
      id: "tool-fail-1",
      name: "run_command",
      args: { command: "npm test" },
      status: "failed",
      output: "Error: Process exited with status 1",
    };

    const html = renderToString(React.createElement(ToolCard, { tool: failedTool }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Error: Process exited with status 1");
  });

  it("should remain collapsed by default when tool status is completed to protect viewport performance", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const completedTool: ToolCall = {
      id: "tool-done-1",
      name: "run_command",
      args: { command: "git status" },
      status: "completed",
      output: "On branch main\nnothing to commit",
    };

    const html = renderToString(React.createElement(ToolCard, { tool: completedTool }));
    expect(html).toContain('aria-expanded="false"');
    // Content should not be rendered into DOM when collapsed
    expect(html).not.toContain("nothing to commit");
  });

  it("should respect explicit defaultExpanded override prop regardless of status", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const completedTool: ToolCall = {
      id: "tool-override-1",
      name: "read_file",
      args: { path: "src/main.rs" },
      status: "completed",
      output: "fn main() { println!(\"hello\"); }",
    };

    const html = renderToString(
      React.createElement(ToolCard, { tool: completedTool, defaultExpanded: true })
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("fn main()");
  });

  it("should truncate long output exceeding 35 lines with LazyTextCollapse", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const longLines = Array.from({ length: 60 }, (_, i) => `Output line ${i + 1}`);
    const toolWithLongOutput: ToolCall = {
      id: "tool-long-1",
      name: "run_command",
      args: { command: "cat long.log" },
      status: "running",
      output: longLines.join("\n"),
    };

    const html = renderToString(React.createElement(ToolCard, { tool: toolWithLongOutput }));
    expect(html).toContain("Output line 1");
    expect(html).toContain("Output line 35");
    expect(html).not.toContain("Output line 36");
    expect(html).toContain("▼ 展开全部输出 (剩余 25 行)");
  });

  it("should truncate long diff exceeding 40 lines with LazyTextCollapse", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const diffLines = Array.from({ length: 60 }, (_, i) => `+added line ${i + 1}`);
    const toolWithLongDiff: ToolCall = {
      id: "tool-diff-1",
      name: "edit_file",
      args: { path: "src/large.ts" },
      status: "running",
      diff: diffLines.join("\n"),
    };

    const html = renderToString(React.createElement(ToolCard, { tool: toolWithLongDiff }));
    expect(html).toContain("+added line 1");
    expect(html).toContain("+added line 40");
    expect(html).not.toContain("+added line 41");
    expect(html).toContain("▼ 展开全部输出 (剩余 20 行)");
  });

  it("should render short diff directly without truncation when lines <= 40", async () => {
    const { ToolCard } = await import("../../web/src/components/chat/ToolCard");
    const diffLines = [
      "@@ -1,3 +1,3 @@",
      "-old line",
      "+new line",
      " context line",
    ];
    const toolWithShortDiff: ToolCall = {
      id: "tool-diff-short",
      name: "edit_file",
      args: { path: "src/short.ts" },
      status: "running",
      diff: diffLines.join("\n"),
    };

    const html = renderToString(React.createElement(ToolCard, { tool: toolWithShortDiff }));
    expect(html).toContain("-old line");
    expect(html).toContain("+new line");
    expect(html).not.toContain("展开全部输出");
  });
});
