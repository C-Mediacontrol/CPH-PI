import { describe, test, expect } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler";

describe("Web RPC Handoff Continuity Suite", () => {
  test("should capture onHandoff, broadcast session:handoff, and retain pendingHandoffSnapshot", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});
    (handler as any).activeSessionId = "ses_main_gen1";

    (handler as any).handleHandoffOccurred("## 交接备忘录: 阶段成果", "/path/to/handoff-1.md");

    const handoffPacket = packets.find((p) => p.type === "session:handoff");
    expect(handoffPacket).toBeDefined();
    expect(handoffPacket.payload.predecessorSessionId).toBe("ses_main_gen1");
    expect(handoffPacket.payload.successorSessionId).toBe("ses_main_gen1");
    expect(handoffPacket.payload.handoffDocPath).toBe("/path/to/handoff-1.md");
    expect(handoffPacket.payload.memoSnippet).toContain("阶段成果");
    expect(handoffPacket.payload.generation).toBe(1);
    expect((handler as any).pendingHandoffSnapshot).toContain("阶段成果");
  });

  test("should capture onSuccessorAwakened and transition activeSessionId", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});
    (handler as any).activeSessionId = "ses_main_gen1";

    (handler as any).handleSuccessorAwakened("ses_main_gen2", 2);

    expect((handler as any).activeSessionId).toBe("ses_main_gen2");
    const handoffPacket = packets.find((p) => p.type === "session:handoff");
    expect(handoffPacket).toBeDefined();
    expect(handoffPacket.payload.predecessorSessionId).toBe("ses_main_gen1");
    expect(handoffPacket.payload.successorSessionId).toBe("ses_main_gen2");
    expect(handoffPacket.payload.generation).toBe(2);

    const snapshotPacket = packets.findLast((p) => p.type === "session:snapshot");
    expect(snapshotPacket).toBeDefined();
    expect(snapshotPacket!.payload.activeSessionId).toBe("ses_main_gen2");
  });

  test("should prepend pendingHandoffSnapshot into executionTask on subsequent prompt submit", async () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };

    let capturedTask = "";
    const mockOrchestrator: any = {
      run: async (opts: any) => {
        capturedTask = opts.task;
        opts.events?.onTurnStart?.(1);
        opts.events?.onDelta?.("已开始接力执行");
        opts.events?.onCompleted?.("已完成接力任务");
        return { completed: true, finalAnswer: "已完成接力任务" };
      },
    };

    const handler = new RpcHandler(mockWs, {
      orchestrator: mockOrchestrator,
    });
    (handler as any).activeSessionId = "ses_main_gen2";
    (handler as any).pendingHandoffSnapshot = "### 阶段1完成\n已落盘第一阶段成果代码";

    await handler.handleUserSubmit({ text: "请开始第二阶段测试编写" });

    expect(capturedTask).toContain("【前序会话成果与交接备忘录】");
    expect(capturedTask).toContain("### 阶段1完成\n已落盘第一阶段成果代码");
    expect(capturedTask).toContain("【接力任务目标】\n请开始第二阶段测试编写");
    expect((handler as any).pendingHandoffSnapshot).toBeNull();
  });

  test("should wire orchestrator onHandoff and onSuccessorAwakened callbacks correctly", async () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };

    const mockOrchestrator: any = {
      run: async (opts: any) => {
        // Trigger handoff during execution
        opts.events?.onHandoff?.("## 任务接力备忘录", "/tmp/handoff-turn-1.md");
        // Trigger successor awakened
        opts.events?.onSuccessorAwakened?.("ses_orch_gen2", 2);
        opts.events?.onCompleted?.("代际接力完成");
        return { completed: true, finalAnswer: "代际接力完成" };
      },
    };

    const handler = new RpcHandler(mockWs, {
      orchestrator: mockOrchestrator,
    });
    (handler as any).activeSessionId = "ses_orch_gen1";

    await handler.handleUserSubmit({ text: "长任务开始" });

    const handoffPackets = packets.filter((p) => p.type === "session:handoff");
    expect(handoffPackets.length).toBeGreaterThanOrEqual(2);

    // First handoff from onHandoff
    expect(handoffPackets[0].payload.predecessorSessionId).toBe("ses_orch_gen1");
    expect(handoffPackets[0].payload.handoffDocPath).toBe("/tmp/handoff-turn-1.md");

    // Second handoff from onSuccessorAwakened
    expect(handoffPackets[1].payload.successorSessionId).toBe("ses_orch_gen2");
    expect(handoffPackets[1].payload.generation).toBe(2);

    expect((handler as any).activeSessionId).toBe("ses_orch_gen2");
  });
});
