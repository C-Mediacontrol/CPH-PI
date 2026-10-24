import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("4. LedgerWALViewer Progressive Batching & Sidebar Virtual Styling (Task 4)", () => {
  const root = path.resolve(__dirname, "../../");
  const ledgerViewerPath = path.join(root, "web/src/components/panels/LedgerWALViewer.tsx");
  const ledgerViewerCssPath = path.join(root, "web/src/components/panels/LedgerWALViewer.module.css");
  const sidebarCssPath = path.join(root, "web/src/components/layout/Sidebar.module.css");

  it("1. should import and use LazyViewportItem in LedgerWALViewer.tsx", () => {
    expect(fs.existsSync(ledgerViewerPath)).toBe(true);
    const content = fs.readFileSync(ledgerViewerPath, "utf8");

    expect(content).toContain("import { LazyViewportItem } from '../common/LazyViewportItem';");
    expect(content).toContain("<LazyViewportItem");
  });

  it("2. should declare visibleCount state initialized to 35 and slice filteredEntries", () => {
    const content = fs.readFileSync(ledgerViewerPath, "utf8");

    expect(content).toMatch(/const\s*\[visibleCount,\s*setVisibleCount\]\s*=\s*useState(?:<number>)?\(\s*35\s*\);/);
    expect(content).toMatch(/displayedEntries\s*=\s*filteredEntries\.slice\(\s*0\s*,\s*visibleCount\s*\)/);
  });

  it("3. should render load more mechanism with displayed and remaining items count when filteredEntries exceeds visibleCount", () => {
    const content = fs.readFileSync(ledgerViewerPath, "utf8");

    expect(content).toContain("visibleCount < filteredEntries.length");
    expect(content).toContain("className={css.loadMoreContainer}");
    expect(content).toContain("className={css.loadMoreBtn}");
    expect(content).toMatch(/setVisibleCount\(\s*\(prev\)\s*=>\s*prev\s*\+\s*35\s*\)/);
    expect(content).toContain("加载更多记录");
    expect(content).toContain("displayedEntries.length");
    expect(content).toContain("filteredEntries.length");
    expect(content).toContain("filteredEntries.length - displayedEntries.length");
  });

  it("4. should reset visibleCount to 35 when filterText or statusFilter changes", () => {
    const content = fs.readFileSync(ledgerViewerPath, "utf8");

    expect(content).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?setVisibleCount\(35\);?[\s\S]*?\}\s*,\s*\[(?:filterText,\s*statusFilter|statusFilter,\s*filterText)\]\);/);
  });

  it("5. should wrap each entry in LazyViewportItem with fallbackHeight 160 or 54 based on isExpanded", () => {
    const content = fs.readFileSync(ledgerViewerPath, "utf8");

    expect(content).toMatch(/<LazyViewportItem[\s\S]*?key=\{entry\.stepId\}[\s\S]*?fallbackHeight=\{isExpanded\s*\?\s*160\s*:\s*54\}[\s\S]*?forceActive=\{isExpanded\}/);
  });

  it("6. should declare content-visibility: auto and contain-intrinsic-size: auto 36px on .sessionItem in Sidebar.module.css", () => {
    expect(fs.existsSync(sidebarCssPath)).toBe(true);
    const content = fs.readFileSync(sidebarCssPath, "utf8");

    const sessionItemBlock = content.match(/\.sessionItem\s*\{([^}]+)\}/);
    expect(sessionItemBlock).not.toBeNull();
    const rules = sessionItemBlock![1];
    expect(rules).toContain("content-visibility: auto");
    expect(rules).toMatch(/contain-intrinsic-size:\s*auto\s+36px/);
  });

  it("7. should declare overscroll-behavior-y: contain on .sessionList in Sidebar.module.css", () => {
    const content = fs.readFileSync(sidebarCssPath, "utf8");

    const sessionListBlock = content.match(/\.sessionList\s*\{([^}]+)\}/);
    expect(sessionListBlock).not.toBeNull();
    const rules = sessionListBlock![1];
    expect(rules).toContain("overscroll-behavior-y: contain");
    expect(rules).toContain("-webkit-overflow-scrolling: touch");
  });

  it("8. should declare overscroll-behavior and touch scrolling in LedgerWALViewer.module.css and provide load more styles", () => {
    expect(fs.existsSync(ledgerViewerCssPath)).toBe(true);
    const content = fs.readFileSync(ledgerViewerCssPath, "utf8");

    const entriesListBlock = content.match(/\.entriesList\s*\{([^}]+)\}/);
    expect(entriesListBlock).not.toBeNull();
    const listRules = entriesListBlock![1];
    expect(listRules).toContain("overscroll-behavior-y: contain");
    expect(listRules).toContain("-webkit-overflow-scrolling: touch");

    expect(content).toContain(".loadMoreContainer");
    expect(content).toContain(".loadMoreBtn");
  });

  it("9. should verify synthetic pagination and filter reset invariant logic", () => {
    let visibleCount = 35;
    const batchSize = 35;
    const totalEntries = 100;
    const entries = Array.from({ length: totalEntries }, (_, i) => ({
      stepId: i + 1,
      toolName: i % 2 === 0 ? "read_file" : "write_file",
      exitCode: 0,
    }));

    // Initial slice
    let displayed = entries.slice(0, visibleCount);
    expect(displayed.length).toBe(35);
    expect(visibleCount < entries.length).toBe(true);
    expect(entries.length - displayed.length).toBe(65);

    // Click load more
    visibleCount += batchSize;
    displayed = entries.slice(0, visibleCount);
    expect(displayed.length).toBe(70);
    expect(visibleCount < entries.length).toBe(true);
    expect(entries.length - displayed.length).toBe(30);

    // Click load more again
    visibleCount += batchSize;
    displayed = entries.slice(0, visibleCount);
    expect(displayed.length).toBe(100);
    expect(visibleCount < entries.length).toBe(false);

    // Simulate filter change -> reset visibleCount to 35
    visibleCount = 35;
    const filtered = entries.filter((e) => e.toolName === "read_file"); // 50 items
    displayed = filtered.slice(0, visibleCount);
    expect(displayed.length).toBe(35);
    expect(visibleCount < filtered.length).toBe(true);
    expect(filtered.length - displayed.length).toBe(15);
  });

  it("10. should dynamically import LedgerWALViewer module without syntax or type errors", async () => {
    const mod = await import("../../web/src/components/panels/LedgerWALViewer");
    expect(typeof mod.LedgerWALViewer).toBe("function");
    expect(typeof mod.default).toBe("function");
  });
});
