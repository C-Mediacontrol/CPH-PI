import { describe, test, expect } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler";
import { PromptBuilder } from "../../src/protocol/prompt-builder";
import { ToolBridge, persistLargeOutputIfNeeded } from "../../src/protocol/tool-bridge";
import { SkillRegistry } from "../../src/skills/skill-registry";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("Web RPC & CLI Pipeline Alignment Regression Suite (CR-2026-10-22-01)", () => {
  test("RED 1: PromptBuilder.PROTOCOL_REMINDER should include invoke_subagent calling contract", () => {
    expect(PromptBuilder.PROTOCOL_REMINDER).toContain("invoke_subagent");
    expect(PromptBuilder.PROTOCOL_REMINDER).toContain("subagents");
  });

  test("RED 2: ToolBridge.persistLargeOutputIfNeeded must not output local truncation notice (AGENTS.md Rule 9)", () => {
    const line = "/e/test/Library/CNNJI QUERY/some/nested/file/path/here.cs\n";
    const repeatCount = Math.floor(10767 / line.length);
    const output = line.repeat(repeatCount);

    const tmpDir = path.join(os.tmpdir(), `cph-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = persistLargeOutputIfNeeded(output, tmpDir);
      // Under AGENTS.md Rule 9, artificial 3000-char truncation notice is abolished
      expect(result.displayOutput).not.toContain("工具输出过大已自动截断");
      expect(result.displayOutput).not.toContain("完整输出已备份保存至工作区本地文件");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("RED 3: RpcHandler must automatically continue multi-hop handoff loop without requiring user re-submission", async () => {
    let runCalls = 0;
    const recordedTasks: string[] = [];
    const recordedInitialAnnotations: any[] = [];
    const recordedRootUserPrompts: string[] = [];

    const mockOrchestrator = {
      setWorkspaceRoot: () => {},
      run: async (opts: any) => {
        runCalls++;
        recordedTasks.push(opts.task);
        if (opts.initialAnnotations) {
          recordedInitialAnnotations.push(opts.initialAnnotations);
        }
        if (opts.rootUserPrompt) {
          recordedRootUserPrompts.push(opts.rootUserPrompt);
        }

        if (runCalls === 1) {
          opts.events?.onHandoff?.("Stage 1 snapshot", "/path/to/handoff-1.md");
          return {
            completed: false,
            handedOff: true,
            handoffSnapshot: "Stage 1 snapshot",
            handoffDocPath: "/path/to/handoff-1.md",
          };
        }
        return { completed: true, finalAnswer: "Stage 2 final answer" };
      },
      bridge: { setCwd: () => {} },
    };

    const sentPackets: Array<{ type: string; payload: any }> = [];
    const mockWs = {
      send: (data: string) => {
        try {
          sentPackets.push(JSON.parse(data));
        } catch {}
      },
      readyState: 1,
    };

    const handler = new (RpcHandler as any)(mockWs, {
      orchestrator: mockOrchestrator,
      maxAutonomousHandoffHops: 3,
    });
    (handler as any).workspaceRoot = path.join(os.tmpdir(), `cph-ws-${Date.now()}`);

    await (handler as any).handleUserSubmit({ text: "Please review project" });

    // In current code, runCalls is 1 (stopped). In aligned code, runCalls must be 2 (hop continuation).
    expect(runCalls).toBe(2);
    // Root prompt must be preserved
    expect(recordedRootUserPrompts[0]).toBe("Please review project");
    expect(recordedRootUserPrompts[1]).toBe("Please review project");
  });

  test("RED 4: RpcHandler must merge targetSkill with mountedSkills (subagent, handoff) on slash commands", async () => {
    let receivedSkills: any[] = [];
    const mockOrchestrator = {
      setWorkspaceRoot: () => {},
      run: async (opts: any) => {
        receivedSkills = opts.activeSkills || [];
        return { completed: true, finalAnswer: "Done" };
      },
      bridge: { setCwd: () => {} },
    };

    const mockWs = { send: () => {}, readyState: 1 };
    const handler = new (RpcHandler as any)(mockWs, {
      orchestrator: mockOrchestrator,
    });
    (handler as any).workspaceRoot = path.join(os.tmpdir(), `cph-ws-${Date.now()}`);

    // Register thermo-nuclear skill
    const skillRegistry: SkillRegistry = (handler as any).skillRegistry;
    skillRegistry.registerSkill({
      name: "thermo-nuclear-code-quality-review",
      description: "Review skill",
      instructions: "Do review",
      triggers: ["/thermo-nuclear-code-quality-review"],
    });

    await (handler as any).handleUserSubmit({
      text: "/thermo-nuclear-code-quality-review Review now",
    });

    const skillNames = receivedSkills.map((s) => s.name);
    expect(skillNames).toContain("thermo-nuclear-code-quality-review");
    // Mounted skills must NOT be dropped!
    expect(skillNames).toContain("subagent");
    expect(skillNames).toContain("handoff");
  });

  test("RED 5: RpcHandler must pass onRefusalIntercepted and onCompacted events to orchestrator", async () => {
    let capturedEvents: any = null;
    const mockOrchestrator = {
      setWorkspaceRoot: () => {},
      run: async (opts: any) => {
        capturedEvents = opts.events;
        return { completed: true, finalAnswer: "Done" };
      },
      bridge: { setCwd: () => {} },
    };

    const mockWs = { send: () => {}, readyState: 1 };
    const handler = new (RpcHandler as any)(mockWs, { orchestrator: mockOrchestrator });
    (handler as any).workspaceRoot = path.join(os.tmpdir(), `cph-ws-${Date.now()}`);

    await (handler as any).handleUserSubmit({ text: "Hello" });

    expect(typeof capturedEvents?.onRefusalIntercepted).toBe("function");
    expect(typeof capturedEvents?.onCompacted).toBe("function");
  });

  test("RED 6: SessionRecord persistence must inherit modelTone and maxTurns rather than hardcoding Creative/25", async () => {
    const tmpWs = path.join(os.tmpdir(), `cph-ws-meta-${Date.now()}`);
    fs.mkdirSync(tmpWs, { recursive: true });

    try {
      const mockWs = { send: () => {}, readyState: 1 };
      const mockCliApp = {
        getModelTone: () => "Gpt_61_Sol_Reasoning",
        getMaxTurns: () => 35,
      };

      const handler = new (RpcHandler as any)(mockWs, {
        workspaceRoot: tmpWs,
        cliApp: mockCliApp,
      });

      await (handler as any).persistActiveSession();
      const sessionManager = (handler as any).sessionManager;
      const activeId = (handler as any).activeSessionId;
      const saved = sessionManager.loadSession(activeId);

      expect(saved.modelTone).toBe("Gpt_61_Sol_Reasoning");
      expect(saved.maxTurns).toBe(35);
    } finally {
      fs.rmSync(tmpWs, { recursive: true, force: true });
    }
  });
});

