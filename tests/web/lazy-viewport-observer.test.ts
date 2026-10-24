import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import React from "../../web/node_modules/react";
import { renderToString } from "../../web/node_modules/react-dom/server";

describe("1. useIntersectionObserver & LazyViewportItem (Task 1)", () => {
  const root = path.resolve(__dirname, "../../");

  it("should export useIntersectionObserver hook with disabled and rootMargin options", () => {
    const hookPath = path.join(root, "web/src/hooks/useIntersectionObserver.ts");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf8");
    expect(content).toContain("useIntersectionObserver");
    expect(content).toContain("UseIntersectionObserverOptions");
    expect(content).toContain("rootMargin");
    expect(content).toContain("disabled");
    expect(content).toContain("IntersectionObserver");
    expect(content).toContain("disconnect");
  });

  it("should export LazyViewportItem component with fallbackHeight and forceActive props", () => {
    const compPath = path.join(root, "web/src/components/common/LazyViewportItem.tsx");
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, "utf8");
    expect(content).toContain("LazyViewportItem");
    expect(content).toContain("LazyViewportItemProps");
    expect(content).toContain("fallbackHeight");
    expect(content).toContain("forceActive");
    expect(content).toContain("contentVisibility");
    expect(content).toContain("containIntrinsicSize");
  });

  it("should define LazyViewportItem.module.css with lazyItem and lazyPlaceholder classes", () => {
    const cssModulePath = path.join(root, "web/src/components/common/LazyViewportItem.module.css");
    expect(fs.existsSync(cssModulePath)).toBe(true);
    const content = fs.readFileSync(cssModulePath, "utf8");
    expect(content).toContain(".lazyItem");
    expect(content).toContain("content-visibility: auto");
    expect(content).toContain(".lazyPlaceholder");
  });

  it("should declare content-visibility utility rules in base.css", () => {
    const cssPath = path.join(root, "web/src/styles/base.css");
    const content = fs.readFileSync(cssPath, "utf8");
    expect(content).toContain(".contentVisibilityAuto");
    expect(content).toContain("content-visibility: auto");
    expect(content).toContain("contain-intrinsic-size: auto 120px");
  });

  it("should dynamically import useIntersectionObserver module and verify function signature", async () => {
    const mod = await import("../../web/src/hooks/useIntersectionObserver");
    expect(typeof mod.useIntersectionObserver).toBe("function");
  });

  it("should dynamically import LazyViewportItem module and verify component export", async () => {
    const mod = await import("../../web/src/components/common/LazyViewportItem");
    expect(typeof mod.LazyViewportItem).toBe("function");
  });

  it("should render active children when forceActive is true or in SSR fallback mode", async () => {
    const { LazyViewportItem } = await import("../../web/src/components/common/LazyViewportItem");
    const html = renderToString(
      React.createElement(LazyViewportItem, { forceActive: true }, "Test Child Content")
    );
    expect(html).toContain("Test Child Content");
    expect(html).toContain("content-visibility:auto");
    expect(html).toContain("contain-intrinsic-size:auto 120px");
  });

  it("should format numeric fallbackHeight with px and preserve string height units", async () => {
    const { LazyViewportItem } = await import("../../web/src/components/common/LazyViewportItem");
    const htmlNum = renderToString(
      React.createElement(LazyViewportItem, { forceActive: true, fallbackHeight: 280 }, "Height Number")
    );
    expect(htmlNum).toContain("contain-intrinsic-size:auto 280px");

    const htmlStr = renderToString(
      React.createElement(LazyViewportItem, { forceActive: true, fallbackHeight: "15rem" }, "Height String")
    );
    expect(htmlStr).toContain("contain-intrinsic-size:auto 15rem");
  });

  it("should render placeholder skeleton when offscreen and IntersectionObserver is available", async () => {
    const originalWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = {
        IntersectionObserver: class MockIntersectionObserver {
          constructor() {}
          observe() {}
          disconnect() {}
        },
      };

      const { LazyViewportItem } = await import("../../web/src/components/common/LazyViewportItem");
      const html = renderToString(
        React.createElement(
          LazyViewportItem,
          { forceActive: false, fallbackHeight: 180 },
          "Hidden Offscreen Content"
        )
      );

      expect(html).not.toContain("Hidden Offscreen Content");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("height:180px");
      expect(html).toContain("contain-intrinsic-size:auto 180px");
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
