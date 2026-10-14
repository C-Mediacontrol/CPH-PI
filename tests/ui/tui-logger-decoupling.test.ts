import { describe, it, expect } from "bun:test";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { TerminalLogger } from "../../src/ui/terminal-logger.ts";
import type { SubagentLiveState } from "../../src/ui/tui-renderer.ts";

describe("TUI Logger Decoupling & Matrix Throttling (CR-5)", () => {
  it("should not spam multi-line matrix boxes to file logger stream", () => {
    let capturedText = "";
    const mockWriter = (text: string) => {
      capturedText += text;
    };

    const renderer = new TuiRenderer({ writer: mockWriter });
    const dummyStates: SubagentLiveState[] = [
      {
        id: "sub-1",
        role: "researcher",
        description: "Task 1",
        status: "running",
        currentTurn: 1,
        durationMs: 1000,
        lastAction: "reading file",
      },
    ];

    // Testing formatSubagentMatrixCompactEvent
    const compactEvent = renderer.formatSubagentMatrixEvent(dummyStates[0]);
    expect(compactEvent).toContain("Sub-1");
    expect(compactEvent).toContain("reading file");
    expect(compactEvent.split("\n").length).toBeLessThan(3);
  });

  it("should cleanly filter out raw matrix redraw frames when writing to file logger", () => {
    const isFrame = TerminalLogger.isTuiMatrixRedrawFrame(
      "┌─ [多会话子代理协同看板 (Sub-Agent Matrix)] ──────────────────────────────\n│ [Sub-1] ...\n└─────────────────"
    );
    expect(isFrame).toBe(true);

    const isNormalText = TerminalLogger.isTuiMatrixRedrawFrame(
      "⚡ 正在执行 run_command: git status"
    );
    expect(isNormalText).toBe(false);
  });

  it("should support compact mode in renderSubagentMatrix", () => {
    let capturedText = "";
    const renderer = new TuiRenderer({ writer: (t) => (capturedText += t) });
    renderer.renderSubagentMatrix(
      [
        {
          id: "sub-1",
          role: "researcher",
          status: "running",
          currentTurn: 1,
          durationMs: 1000,
          lastAction: "reading file",
        },
      ],
      true
    );

    expect(capturedText).toContain("[Subagent Event]");
    expect(capturedText).toContain("Sub-1");
    expect(capturedText).not.toContain("┌─ [多会话子代理协同看板");
  });

  it("should compress and deduplicate matrix redraw frames in TerminalLogger disk output", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-decoupling-test-"));
    const logFile = path.join(tmpDir, "decoupled.log");
    const logger = TerminalLogger.getInstance();

    logger.start({ logFilePath: logFile, workspaceRoot: tmpDir });

    const rawFrame = [
      "┌─ [多会话子代理协同看板 (Sub-Agent Matrix)] ──────────────────────────────",
      "│ [Sub-1] [researcher] [Hop 1 (接手 0 次)] Task 1 | 状态: 🔄 运行中 | 耗时: 1.0s",
      "│   └─ 最新动作: reading file",
      "└────────────────────────────────────────────────────────────────────",
    ].join("\n");

    // Write frame multiple times (simulating 1000+ redraws)
    process.stdout.write(rawFrame + "\n");
    process.stdout.write(rawFrame + "\n");
    process.stdout.write(rawFrame + "\n");

    await new Promise((r) => setTimeout(r, 60));
    logger.stop();

    const logged = fs.readFileSync(logFile, "utf8");
    // Should NOT contain the massive ASCII border lines
    expect(logged).not.toContain("────────────────────────────────────────────────────────────────────");
    // Should contain the single-line compressed event
    expect(logged).toContain("[Subagent Matrix Sync]");
    expect(logged).toContain("[Sub-1]");
    expect(logged).toContain("最新动作: reading file");

    // Count occurrences of Subagent Matrix Sync: should be deduplicated to exactly 1
    const occurrences = (logged.match(/\[Subagent Matrix Sync\]/g) || []).length;
    expect(occurrences).toBe(1);

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});

