import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { Turn } from "../../web/src/types/protocol";

describe("3. ChatView Lazy Integration & Streaming Invariant (Task 3)", () => {
  const root = path.resolve(__dirname, "../../");
  const chatViewPath = path.join(root, "web/src/components/chat/ChatView.tsx");
  const chatViewCssPath = path.join(root, "web/src/components/chat/ChatView.module.css");

  it("should import LazyViewportItem and LazyTextCollapse in ChatView.tsx", () => {
    expect(fs.existsSync(chatViewPath)).toBe(true);
    const content = fs.readFileSync(chatViewPath, "utf8");

    expect(content).toContain("import { LazyViewportItem } from '../common/LazyViewportItem';");
    expect(content).toContain("import { LazyTextCollapse } from '../common/LazyTextCollapse';");
  });

  it("should wrap turns inside LazyViewportItem with forceActive and fallbackHeight", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    // Must map turns with index to determine latest turn
    expect(content).toMatch(/turns\.map\(\s*\(\s*turn\s*,\s*index\s*\)\s*=>/);

    // Invariant: isLatest, isStreaming, forceActive
    expect(content).toContain("const isLatest = index === turns.length - 1;");
    expect(content).toContain("const isStreaming =");
    expect(content).toContain("turn.status === 'streaming'");
    expect(content).toContain("turn.reasoning?.isStreaming");
    expect(content).toContain("const forceActive = isLatest || isStreaming;");

    // Must wrap in LazyViewportItem
    expect(content).toContain("<LazyViewportItem");
    expect(content).toContain("fallbackHeight={fallbackHeight}");
    expect(content).toContain("forceActive={forceActive}");
  });

  it("should calculate correct fallbackHeight based on tools or assistantText length", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    // Fallback height rule: tools present or assistantText > 800 chars -> 320, else 120
    expect(content).toContain("fallbackHeight =");
    expect(content).toContain("800");
    expect(content).toMatch(/320\s*:\s*120/);
  });

  it("should uphold forceActive and fallbackHeight logic invariants across synthetic turn scenarios", () => {
    // Pure invariant helper matching ChatView specification
    const computeTurnLazyProps = (turn: Partial<Turn>, index: number, totalTurns: number) => {
      const isLatest = index === totalTurns - 1;
      const isStreaming = turn.status === "streaming" || Boolean(turn.reasoning?.isStreaming);
      const forceActive = isLatest || isStreaming;
      const fallbackHeight =
        (turn.tools && turn.tools.length > 0) ||
        (turn.assistantText && turn.assistantText.length > 800)
          ? 320
          : 120;
      return { forceActive, fallbackHeight };
    };

    // Scenario 1: Historical turn, completed, short text -> inactive, 120px fallback
    const histShort = computeTurnLazyProps(
      { status: "completed", assistantText: "Short response" },
      0,
      3
    );
    expect(histShort.forceActive).toBe(false);
    expect(histShort.fallbackHeight).toBe(120);

    // Scenario 2: Historical turn, completed, long text (> 800 chars) -> inactive, 320px fallback
    const histLong = computeTurnLazyProps(
      { status: "completed", assistantText: "A".repeat(850) },
      0,
      3
    );
    expect(histLong.forceActive).toBe(false);
    expect(histLong.fallbackHeight).toBe(320);

    // Scenario 3: Historical turn with tools -> inactive, 320px fallback
    const histTools = computeTurnLazyProps(
      {
        status: "completed",
        tools: [
          {
            id: "t1",
            name: "read_file",
            args: {},
            status: "completed",
          },
        ],
      },
      1,
      3
    );
    expect(histTools.forceActive).toBe(false);
    expect(histTools.fallbackHeight).toBe(320);

    // Scenario 4: Middle turn actively streaming reasoning -> forceActive=true
    const middleStreamingReasoning = computeTurnLazyProps(
      { status: "completed", reasoning: { text: "thinking", isStreaming: true } },
      1,
      3
    );
    expect(middleStreamingReasoning.forceActive).toBe(true);

    // Scenario 5: Middle turn actively streaming message -> forceActive=true
    const middleStreaming = computeTurnLazyProps(
      { status: "streaming", assistantText: "chunk" },
      1,
      3
    );
    expect(middleStreaming.forceActive).toBe(true);

    // Scenario 6: Latest turn regardless of status -> forceActive=true
    const latestTurn = computeTurnLazyProps(
      { status: "completed", assistantText: "All done" },
      2,
      3
    );
    expect(latestTurn.forceActive).toBe(true);
  });

  it("should wrap subagent actions inside LazyViewportItem with fallbackHeight 90", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    expect(content).toContain("focusedSub.actions");
    expect(content).toContain("<LazyViewportItem key={aIdx} fallbackHeight={90}>");
  });

  it("should integrate LazyTextCollapse for subagent action.output with maxLines 30 and maxChars 1500", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    expect(content).toContain("<LazyTextCollapse");
    expect(content).toContain("text={act.output}");
    expect(content).toContain("maxLines={30}");
    expect(content).toContain("maxChars={1500}");
    expect(content).toContain("preClassName={css.actionOutputPre}");
  });

  it("should wrap deliverable report preview card in LazyViewportItem with fallbackHeight 300", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    expect(content).toContain("focusedSub.report");
    expect(content).toContain("<LazyViewportItem fallbackHeight={300}>");
  });

  it("should enhance .scrollArea with smooth scrolling and overscroll behavior in ChatView.module.css", () => {
    expect(fs.existsSync(chatViewCssPath)).toBe(true);
    const content = fs.readFileSync(chatViewCssPath, "utf8");

    expect(content).toContain(".scrollArea");
    expect(content).toContain("scroll-behavior: smooth");
    expect(content).toContain("overscroll-behavior-y: contain");
  });

  it("should preserve smooth auto-scroll to scrollBottomRef on turns or focusedSubagentId changes", () => {
    const content = fs.readFileSync(chatViewPath, "utf8");

    expect(content).toContain("scrollBottomRef.current.scrollIntoView({ behavior: 'smooth' });");
    expect(content).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?scrollIntoView[\s\S]*?\}\s*,\s*\[turns,\s*focusedSubagentId\]\);/);
  });

  it("should dynamically import ChatView module without syntax or type errors", async () => {
    const mod = await import("../../web/src/components/chat/ChatView");
    expect(typeof mod.ChatView).toBe("function");
    expect(typeof mod.default).toBe("function");
  });
});
