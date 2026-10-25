import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("No-progress guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-no-progress-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("skips a third identical failing action and steers the model to finalize", async () => {
    const failingAction = "【Thought】retry\n```action\ntool: run_command\ncommand: ls missing-dir\n```";
    const prompts: string[] = [];
    let call = 0;

    const mockClient: any = {
      async sendMessage(params: any) {
        prompts.push(params.text);
        call++;
        if (call <= 3) return { text: failingAction };
        return { text: "FINAL_ANSWER: 已说明阻塞点并结束。" };
      },
    };

    let bridgeCalls = 0;
    const bridge: any = {
      executeAction: async () => {
        bridgeCalls++;
        return {
          actionName: "run_command",
          piToolName: "bash",
          target: "ls missing-dir",
          success: false,
          output: "ENOENT",
          formatted: "ENOENT",
        };
      },
    };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "probe" });

    expect(result.completed).toBe(true);
    // First two identical failures execute; the third is skipped by the guard.
    expect(bridgeCalls).toBe(2);
    expect(prompts.length).toBe(4);
    expect(prompts[2]).toContain("该动作已连续失败");
  });

  it("does not skip a corrected retry whose edit anchors changed", async () => {
    const actions = [
      '```action\ntool: edit\npath: src/a.ts\nold_string: broken-A\nnew_string: fixed-A\n```',
      '```action\ntool: edit\npath: src/a.ts\nold_string: broken-B\nnew_string: fixed-B\n```',
      '```action\ntool: edit\npath: src/a.ts\nold_string: broken-C\nnew_string: fixed-C\n```',
    ];
    let call = 0;
    const mockClient: any = {
      async sendMessage() {
        call++;
        return { text: call <= 3 ? actions[call - 1] : "FINAL_ANSWER: 完成" };
      },
    };
    let bridgeCalls = 0;
    const bridge: any = {
      executeAction: async () => {
        bridgeCalls++;
        return {
          actionName: "edit",
          piToolName: "edit",
          target: "src/a.ts",
          success: false,
          output: "anchor not found",
          formatted: "anchor not found",
        };
      },
    };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "fix file" });
    expect(result.completed).toBe(true);
    // Different anchors mean different fingerprints: all three retries execute.
    expect(bridgeCalls).toBe(3);
  });
});
