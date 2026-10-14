import { describe, it, expect } from "bun:test";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";

describe("TuiRenderer - Virtualization Banners", () => {
  it("should format Main Virtualization Banner with snapshot path", () => {
    const renderer = new TuiRenderer();
    const banner = renderer.formatMainVirtualizationBanner(
      "main_ses_1",
      ".cph/handoffs/main-plan-main_ses_1.md"
    );
    expect(banner).toContain("主控会话已虚拟化归档");
    expect(banner).toContain("main_ses_1");
    expect(banner).toContain(".cph/handoffs/main-plan-main_ses_1.md");
  });

  it("should format Successor Awakening Banner with generation", () => {
    const renderer = new TuiRenderer();
    const banner = renderer.formatSuccessorAwakeningBanner("main_ses_1_gen2", 2);
    expect(banner).toContain("第 2 代主控会话已唤醒");
    expect(banner).toContain("接手 1 次");
    expect(banner).toContain("main_ses_1_gen2");
    expect(banner).toContain("30 轮");
  });
});
