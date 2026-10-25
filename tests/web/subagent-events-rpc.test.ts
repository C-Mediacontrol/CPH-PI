import { describe, test, expect } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler";

describe("Web RPC Subagent Events Suite", () => {
  test("should dispatch subagent:start with correct 5-arg alignment (hop as number, account as string)", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});

    // Set active tool id
    (handler as any).activeSubagentToolId = "tool-test-123";

    // Simulate callback
    (handler as any).handleSubagentStart(
      "sub-1",
      "researcher",
      { prompt: "分析架构" },
      3,
      "vincent@example.com"
    );

    const startPacket = packets.find((p) => p.type === "subagent:start");
    expect(startPacket).toBeDefined();
    expect(startPacket.payload.toolId).toBe("tool-test-123");
    expect(startPacket.payload.subagentId).toBe("sub-1");
    expect(startPacket.payload.role).toBe("researcher");
    expect(startPacket.payload.hopCount).toBe(3);
    expect(startPacket.payload.account).toBe("vincent@example.com");
  });

  test("should dispatch subagent:progress with turn, delta, action, hopCount, account", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});

    (handler as any).handleSubagentProgress(
      "sub-1",
      2,
      "正在检索代码...",
      { tool: "read_file", args: { file: "test.ts" } },
      3,
      "vincent@example.com"
    );

    const progPacket = packets.find((p) => p.type === "subagent:progress");
    expect(progPacket).toBeDefined();
    expect(progPacket.payload.subagentId).toBe("sub-1");
    expect(progPacket.payload.turn).toBe(2);
    expect(progPacket.payload.delta).toBe("正在检索代码...");
    expect(progPacket.payload.action).toEqual({ tool: "read_file", args: { file: "test.ts" } });
    expect(progPacket.payload.hopCount).toBe(3);
    expect(progPacket.payload.account).toBe("vincent@example.com");
  });

  test("should dispatch subagent:end and persist subagent record", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});

    let persistedId = "";
    let persistedReport: any = null;
    (handler as any).persistSubagentRecord = (id: string, data: any) => {
      persistedId = id;
      persistedReport = data;
    };

    const report = {
      id: "sub-1",
      role: "researcher",
      success: true,
      finalAnswer: "分析完成",
    };

    (handler as any).handleSubagentEnd(report);

    expect(persistedId).toBe("sub-1");
    expect(persistedReport).toEqual(report);

    const endPacket = packets.find((p) => p.type === "subagent:end");
    expect(endPacket).toBeDefined();
    expect(endPacket.payload.subagentId).toBe("sub-1");
    expect(endPacket.payload.report).toEqual(report);
  });

  test("should not filter out reasoning:chunk when debug is active", () => {
    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutData += String(chunk);
      return true;
    }) as any;

    try {
      const mockWs: any = { readyState: 1, send: () => {} };
      const handler = new RpcHandler(mockWs, { debug: true });
      handler.send("reasoning:chunk", { chunk: "思考中..." });

      expect(stdoutData).toContain("Web RPC ==> reasoning:chunk");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("should wire orchestrator callbacks and track activeSubagentToolId lifecycle", async () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const mockOrchestrator: any = {
      run: async (opts: any) => {
        // 1. Tool start for invoke_subagent
        opts.events?.onToolStart?.({ tool: "invoke_subagent", args: { prompt: "run scout" } });
        // 2. Subagent start
        opts.events?.onSubagentStart?.("sub-42", "scout", { prompt: "scout" }, 1, "test@test.com");
        // 3. Subagent progress
        opts.events?.onSubagentProgress?.("sub-42", 1, "thinking...", null, 1, "test@test.com");
        // 4. Subagent end
        opts.events?.onSubagentEnd?.({ id: "sub-42", success: true });
        // 5. Tool end for invoke_subagent
        opts.events?.onToolEnd?.({ success: true, output: "done" });
        return { completed: true, finalAnswer: "done" };
      },
    };

    const handler = new RpcHandler(mockWs, {
      orchestrator: mockOrchestrator,
    });
    (handler as any).activeSessionId = "ses-orch-test";

    await handler.handleUserSubmit({ text: "test subagent" });

    const startPacket = packets.find((p) => p.type === "subagent:start");
    expect(startPacket).toBeDefined();
    expect(startPacket.payload.toolId).toMatch(/^tool-/);
    expect(startPacket.payload.subagentId).toBe("sub-42");
    expect(startPacket.payload.role).toBe("scout");
    expect(startPacket.payload.hopCount).toBe(1);
    expect(startPacket.payload.account).toBe("test@test.com");

    const progPacket = packets.find((p) => p.type === "subagent:progress");
    expect(progPacket).toBeDefined();
    expect(progPacket.payload.subagentId).toBe("sub-42");
    expect(progPacket.payload.delta).toBe("thinking...");

    const endPacket = packets.find((p) => p.type === "subagent:end");
    expect(endPacket).toBeDefined();
    expect(endPacket.payload.subagentId).toBe("sub-42");

    // After tool end, activeSubagentToolId should be reset to null
    expect((handler as any).activeSubagentToolId).toBeNull();
  });
});
