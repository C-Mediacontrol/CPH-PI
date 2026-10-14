import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("SubagentRunner - Logger & Handoff Hop Integration", () => {
  const tmpDir = path.join(os.tmpdir(), `cph-sub-log-test-${Date.now()}`);

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should auto-initialize loggerTree and write detailed turns, tools, and finished banners to subagent log", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const mainSessionId = "main-sess-001";
    const lineageTracker = new SessionLineageTracker();

    // Mock createOrchestratorFn that triggers onTurnStart, onToolStart, onToolEnd, and onDelta
    const mockOrchestrator = {
      run: async (opts: any) => {
        opts.events?.onTurnStart?.(1);
        opts.events?.onDelta?.("Thinking about researching...\n");
        opts.events?.onToolStart?.({ tool: "read_file", path: "src/index.ts" });
        opts.events?.onToolEnd?.({ toolName: "read_file", success: true, output: "file content" });
        return {
          completed: true,
          turnsCount: 1,
          finalAnswer: "Research successfully concluded.",
        };
      },
    };

    const runner = new SubagentRunner({
      workspaceRoot: tmpDir,
      mainSessionId,
      lineageTracker,
      createOrchestratorFn: () => mockOrchestrator,
    });

    const reports = await runner.executeBatch([
      {
        description: "Analyze project dependencies",
        prompt: "Please inspect src/index.ts and summarize imports.",
      },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].hopCount).toBe(1);
    expect(reports[0].handoffCount).toBe(0);

    // Verify subagent log file exists and contains detailed execution trace
    const subLogPath = path.join(tmpDir, ".cph", "logs", mainSessionId, "subagents", `${reports[0].id}-${reports[0].role}.log`);
    expect(fs.existsSync(subLogPath)).toBe(true);

    const logContent = fs.readFileSync(subLogPath, "utf8");
    expect(logContent).toContain("任务目标与初始提示词");
    expect(logContent).toContain("Please inspect src/index.ts");
    expect(logContent).toContain("[Hop 1] Turn 1");
    expect(logContent).toContain("Thinking about researching...");
    expect(logContent).toContain("[Tool Start] read_file src/index.ts");
    expect(logContent).toContain("[Tool End] read_file");
    expect(logContent).toContain(`=== [Subagent ${reports[0].id} Finished: SUCCESS]`);
    expect(logContent).toContain("接手: 0 次");

    // Verify timeline.jsonl contains subagent lifecycle events
    const timelinePath = path.join(tmpDir, ".cph", "logs", mainSessionId, "timeline.jsonl");
    expect(fs.existsSync(timelinePath)).toBe(true);
    const timelineContent = fs.readFileSync(timelinePath, "utf8");
    expect(timelineContent).toContain("SUBAGENT_QUEUE_SCHEDULED");
    expect(timelineContent).toContain("SUBAGENT_STARTED");
    expect(timelineContent).toContain("SUBAGENT_FINISHED");

    // Verify summary formatting includes handoff info
    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("接手 0 次");
  });

  it("should record autonomous handoff hop banners and update handoffCount", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const mainSessionId = "main-sess-hop-test";
    const lineageTracker = new SessionLineageTracker();
    let currentHop = 0;

    const mockOrchestrator = {
      run: async (opts: any) => {
        currentHop++;
        if (currentHop === 1) {
          opts.events?.onTurnStart?.(1);
          const handoffFile = path.join(tmpDir, "handoff-step1.md");
          fs.writeFileSync(handoffFile, "## Handoff 1\nNeed further compilation.", "utf8");
          return {
            completed: false,
            handedOff: true,
            handoffDocPath: handoffFile,
            turnsCount: 30,
            finalAnswer: "Handing off to hop 2",
          };
        } else {
          opts.events?.onTurnStart?.(1);
          return {
            completed: true,
            turnsCount: 5,
            finalAnswer: "All tasks completed in hop 2.",
          };
        }
      },
    };

    const runner = new SubagentRunner({
      workspaceRoot: tmpDir,
      mainSessionId,
      lineageTracker,
      maxAutonomousHops: 3,
      createOrchestratorFn: () => mockOrchestrator,
    });

    const reports = await runner.executeBatch([
      {
        description: "Large complex task",
        prompt: "Do extensive refactoring.",
      },
    ]);

    expect(reports.length).toBe(1);
    expect(reports[0].success).toBe(true);
    expect(reports[0].hopCount).toBe(2);
    expect(reports[0].handoffCount).toBe(1);

    const subLogPath = path.join(tmpDir, ".cph", "logs", mainSessionId, "subagents", `${reports[0].id}-${reports[0].role}.log`);
    const logContent = fs.readFileSync(subLogPath, "utf8");
    expect(logContent).toContain("跨会话自主接力 Hop 1 -> 2");
    expect(logContent).toContain("接手: 1 次");

    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("经 1 次接力");
    expect(summary).toContain("接手 1 次");
  });
});
