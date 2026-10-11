import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";
import { SessionLineageTracker } from "../../src/session/lineage-tracker.ts";

describe("End-to-End Virtualization & Adaptive Queue Integration", () => {
  const tmpDir = path.join(os.tmpdir(), "cph-virt-e2e-" + Date.now());

  it("should complete full autonomous pipeline: Main-1 -> snapshot -> serial subagents -> Main-2 review -> final answer", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    const tracker = new SessionLineageTracker();
    const mockPool = {
      getPoolStatus: () => [{ email: "user@corp.com", active: true, isThrottled: false }],
    };

    let chatTurns = 0;
    const mockChatClient = {
      sendMessage: async (params: any) => {
        chatTurns++;
        if (chatTurns === 1) {
          // Main-1 Turn 1
          return {
            text: `THOUGHT: 需要先调研再编写单元测试
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 探查接口定义
    prompt: 检查接口
  - role: coder
    description: 编写单元测试
    prompt: 补充测试
\`\`\``,
          };
        }
        // Main-2 Turn 1
        expect(params.text).toContain("【主控接力与成果审阅】");
        expect(params.text).toContain("检查接口完成");
        expect(params.text).toContain("补充测试完成");
        return {
          text: "FINAL_ANSWER: 经主控交叉审阅，所有子任务交付达标，端到端验证通过。",
        };
      },
    };

    const runner = new SubagentRunner({
      workspaceRoot: tmpDir,
      mainSessionId: "main_e2e_root",
      pool: mockPool as any,
      lineageTracker: tracker,
      createOrchestratorFn: (opts: any) => ({
        run: async () => ({
          completed: true,
          finalAnswer: opts.task.includes("检查") ? "检查接口完成" : "补充测试完成",
        }),
      }),
    });

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockChatClient as any,
      subagentRunner: runner,
      lineageTracker: tracker,
      pool: mockPool as any,
    });

    const result = await orchestrator.run({
      task: "端到端系统功能增强",
      sessionId: "main_e2e_root",
    });

    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("端到端验证通过");

    // Check lineage
    const activeHead = tracker.resolveActiveHead("main_e2e_root");
    expect(activeHead).toContain("main_e2e_root_gen2");

    // Check snapshot file was created
    const snapshotPath = path.join(tmpDir, ".cph", "handoffs", "main-plan-main_e2e_root.md");
    expect(fs.existsSync(snapshotPath)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
