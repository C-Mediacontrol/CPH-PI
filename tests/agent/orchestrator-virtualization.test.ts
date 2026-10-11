import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";

describe("Orchestrator - Main Session Virtualization Snapshot & Disconnect", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-orch-virt-" + Date.now());

  it("should create snapshot and emit onMainSessionVirtualized when invoke_subagent is called", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    let virtualizedEventFired = false;
    let snapshotPathFired = "";
    let clientDisconnected = false;

    const mockChatClient = {
      sendMessage: async () => {
        return {
          text: `THOUGHT: 需要调研并实施
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查配置
    prompt: 检查配置
\`\`\``,
        };
      },
      close: () => {
        clientDisconnected = true;
      },
    };

    const mockRunner = {
      executeBatch: async () => [
        {
          id: "sub-1",
          role: "researcher",
          description: "探查配置",
          success: true,
          finalAnswer: "配置无误",
          turnsCount: 1,
          durationMs: 500,
        },
      ],
      formatReportSummary: () => "子代理报告：配置无误",
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockChatClient as any,
      subagentRunner: mockRunner as any,
    });

    const result = await orchestrator.run({
      task: "优化配置系统",
      sessionId: "main_virt_test",
      events: {
        onMainSessionVirtualized: (snapshot, path) => {
          virtualizedEventFired = true;
          snapshotPathFired = path;
        },
      },
    });

    expect(virtualizedEventFired).toBe(true);
    expect(snapshotPathFired).toContain("main-plan-main_virt_test");
    expect(fs.existsSync(snapshotPathFired)).toBe(true);
    expect(clientDisconnected).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
