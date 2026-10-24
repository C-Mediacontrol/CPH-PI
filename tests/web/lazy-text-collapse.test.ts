import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import React from "../../web/node_modules/react";
import { renderToString } from "../../web/node_modules/react-dom/server";

describe("2. LazyTextCollapse Component (Task 2)", () => {
  const root = path.resolve(__dirname, "../../");

  it("should export LazyTextCollapse component and LazyTextCollapseProps interface", () => {
    const compPath = path.join(root, "web/src/components/common/LazyTextCollapse.tsx");
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, "utf8");
    expect(content).toContain("LazyTextCollapse");
    expect(content).toContain("LazyTextCollapseProps");
    expect(content).toContain("maxLines");
    expect(content).toContain("maxChars");
    expect(content).toContain("className");
    expect(content).toContain("preClassName");
    expect(content).toContain("copyable");
    expect(content).toContain("navigator.clipboard");
  });

  it("should define LazyTextCollapse.module.css with necessary styling classes", () => {
    const cssPath = path.join(root, "web/src/components/common/LazyTextCollapse.module.css");
    expect(fs.existsSync(cssPath)).toBe(true);
    const content = fs.readFileSync(cssPath, "utf8");
    expect(content).toContain(".container");
    expect(content).toContain(".pre");
    expect(content).toContain(".actionBar");
    expect(content).toContain(".toggleBtn");
    expect(content).toContain(".copyBtn");
  });

  it("should dynamically import LazyTextCollapse and verify export", async () => {
    const mod = await import("../../web/src/components/common/LazyTextCollapse");
    expect(typeof mod.LazyTextCollapse).toBe("function");
  });

  it("should render empty output when text is falsy or empty", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const htmlEmpty = renderToString(React.createElement(LazyTextCollapse, { text: "" }));
    expect(htmlEmpty).toBe("");
  });

  it("should render full text directly without toggle bar when content is within thresholds", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const shortText = "Line 1: Hello World\nLine 2: Everything fits nicely\nLine 3: Finished";
    const html = renderToString(
      React.createElement(LazyTextCollapse, { text: shortText, maxLines: 10, maxChars: 500 })
    );

    expect(html).toContain("Line 1: Hello World");
    expect(html).toContain("Line 2: Everything fits nicely");
    expect(html).toContain("Line 3: Finished");
    expect(html).not.toContain("展开全部输出");
    expect(html).not.toContain("收起完整输出");
  });

  it("should truncate lines exceeding maxLines and render toggle bar with remaining count and copy button", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const lines = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}: detailed output`);
    const longText = lines.join("\n");

    const html = renderToString(
      React.createElement(LazyTextCollapse, {
        text: longText,
        maxLines: 35,
        maxChars: 5000,
      })
    );

    // Shows first 35 lines
    expect(html).toContain("Log line 1: detailed output");
    expect(html).toContain("Log line 35: detailed output");
    // Does not include line 36 in collapsed render
    expect(html).not.toContain("Log line 36: detailed output");
    // Remaining lines: 50 - 35 = 15
    expect(html).toContain("▼ 展开全部输出 (剩余 15 行)");
    expect(html).toContain("📄 复制全部");
  });

  it("should truncate text exceeding maxChars even if lines count is within maxLines", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const giantLine = "A".repeat(2500);
    const html = renderToString(
      React.createElement(LazyTextCollapse, {
        text: giantLine,
        maxLines: 10,
        maxChars: 1800,
      })
    );

    expect(html).toContain("▼ 展开全部输出");
    expect(html).toContain("📄 复制全部");
  });

  it("should render full content and collapse button when defaultExpanded is true", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const lines = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}: detailed output`);
    const longText = lines.join("\n");

    const html = renderToString(
      React.createElement(LazyTextCollapse, {
        text: longText,
        maxLines: 35,
        defaultExpanded: true,
      })
    );

    expect(html).toContain("Log line 1: detailed output");
    expect(html).toContain("Log line 50: detailed output");
    expect(html).toContain("▲ 收起完整输出");
  });

  it("should omit copy button when copyable is explicitly set to false", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const lines = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}: detailed output`);
    const longText = lines.join("\n");

    const html = renderToString(
      React.createElement(LazyTextCollapse, {
        text: longText,
        maxLines: 35,
        copyable: false,
      })
    );

    expect(html).toContain("▼ 展开全部输出 (剩余 15 行)");
    expect(html).not.toContain("复制全部");
  });

  it("should support custom children render function with sliced text and expanded state", async () => {
    const { LazyTextCollapse } = await import("../../web/src/components/common/LazyTextCollapse");
    const lines = Array.from({ length: 50 }, (_, i) => `Custom ${i + 1}`);
    const longText = lines.join("\n");

    const html = renderToString(
      React.createElement(
        LazyTextCollapse,
        {
          text: longText,
          maxLines: 10,
        },
        (displayText: string, isExpanded: boolean) =>
          React.createElement(
            "div",
            { className: "custom-diff-wrapper" },
            `Count: ${displayText.split("\n").length}, Expanded: ${isExpanded}`
          )
      )
    );

    expect(html).toContain("custom-diff-wrapper");
    expect(html).toContain("Count: 10, Expanded: false");
    expect(html).toContain("▼ 展开全部输出 (剩余 40 行)");
  });
});
