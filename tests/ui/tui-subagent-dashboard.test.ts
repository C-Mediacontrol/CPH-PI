import { describe, it, expect } from "bun:test";
import { TuiRenderer, type ActiveSubagentState } from "../../src/ui/tui-renderer.ts";

describe("TuiRenderer - Subagent Dashboard", () => {
  it("should format multi-agent live matrix card", () => {
    const renderer = new TuiRenderer({ colorLevel: 0 }); // 无色便于断言
    const states: ActiveSubagentState[] = [
      {
        id: "sub-1",
        role: "researcher",
        description: "探查接口",
        status: "running",
        currentTurn: 2,
        durationMs: 5000,
        lastAction: "read_file: src/auth.ts",
        hopCount: 1,
        handoffCount: 0,
      },
      {
        id: "sub-2",
        role: "coder",
        description: "修复错误",
        status: "completed",
        currentTurn: 3,
        durationMs: 8200,
        hopCount: 2,
        handoffCount: 1,
      },
    ];

    const card = renderer.formatSubagentMatrix(states);
    expect(card).toContain("[Sub-1]");
    expect(card).toContain("researcher");
    expect(card).toContain("[Hop 1 (接手 0 次)]");
    expect(card).toContain("探查接口");
    expect(card).toContain("[Sub-2]");
    expect(card).toContain("coder");
    expect(card).toContain("[Hop 2 (接手 1 次)]");
    expect(card).toContain("已完成");
  });

  it("should display account badge when account is specified in subagent state", () => {
    const renderer = new TuiRenderer({ colorLevel: 0 });
    const states: ActiveSubagentState[] = [
      {
        id: "sub-1",
        role: "coder",
        account: "user1@contoso.com",
        description: "编写单元测试",
        status: "running",
        currentTurn: 1,
        durationMs: 2000,
      },
    ];

    const card = renderer.formatSubagentMatrix(states);
    expect(card).toContain("[user1@contoso.com]");

    const event = renderer.formatSubagentMatrixEvent(states[0]);
    expect(event).toContain("[user1@contoso.com]");
  });
});

