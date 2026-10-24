import { describe, it, expect, beforeEach } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("Web RPC Auto-Handoff Lease, Turn Start, and PKCE Suite (Task 4)", () => {
  let mockWs: any;
  let sentPackets: Array<{ type: string; payload?: any; data?: any }>;
  let mockPool: any;
  let releasedLeases: string[];

  beforeEach(() => {
    sentPackets = [];
    releasedLeases = [];
    mockWs = {
      readyState: 1,
      send: (raw: string) => {
        try {
          sentPackets.push(JSON.parse(raw));
        } catch {}
      },
      on: () => {},
    };

    mockPool = {
      releaseSessionLease: (sessionId: string) => {
        releasedLeases.push(sessionId);
        return true;
      },
      getPoolStatus: () => [
        {
          email: "user1@tenant.onmicrosoft.com",
          isAvailable: true,
          isThrottled: false,
          isAllowed: true,
          cooldownUntil: 0,
          totalRequests: 5,
          throttledCount: 0,
          authExpired: false,
        },
      ],
      getAllowedAccounts: () => ["user1@tenant.onmicrosoft.com"],
      resetCooldown: (email: string) => true,
      startPkceAuth: (targetEmail?: string) => ({
        authSessionId: "pkce-sess-123",
        authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=state-abc&login_hint=${targetEmail || ""}`,
        state: "state-abc",
      }),
      completePkceAuth: async (redirectUrl: string, state?: string, expectedEmail?: string) => {
        if (redirectUrl.includes("error=access_denied")) {
          throw new Error("User cancelled the authentication flow");
        }
        return {
          success: true,
          email: expectedEmail || "user1@tenant.onmicrosoft.com",
          accountId: "user1@tenant.onmicrosoft.com",
          authSessionId: "pkce-sess-123",
          emailMismatch: false,
        };
      },
    };
  });

  it("should release predecessor lease, reset handshake, and broadcast turn:start on autonomous handoff", async () => {
    let handshakeResetCalled = false;
    let runCallCount = 0;
    const capturedPrompts: string[] = [];

    const mockOrchestrator: any = {
      setWorkspaceRoot: () => {},
      resetHandshake: () => {
        handshakeResetCalled = true;
      },
      run: async (opts: any) => {
        runCallCount++;
        capturedPrompts.push(opts.task);
        if (runCallCount === 1) {
          // First stage hands off
          opts.events?.onTurnStart?.(1);
          opts.events?.onHandoff?.("## Stage 1 Handoff Snapshot", "/tmp/handoff-1.md");
          return {
            handedOff: true,
            handoffSnapshot: "## Stage 1 Handoff Snapshot",
            handoffDocPath: "/tmp/handoff-1.md",
          };
        }
        // Second stage completes
        opts.events?.onTurnStart?.(2);
        opts.events?.onCompleted?.("Stage 2 completed successfully");
        return {
          completed: true,
          finalAnswer: "Stage 2 completed successfully",
        };
      },
      bridge: { setCwd: () => {} },
    };

    const tmpWs = path.join(os.tmpdir(), `cph-web-test-handoff-${Date.now()}`);
    fs.mkdirSync(tmpWs, { recursive: true });

    try {
      const handler = new RpcHandler(mockWs, {
        workspaceRoot: tmpWs,
        orchestrator: mockOrchestrator,
        pool: mockPool,
        maxAutonomousHandoffHops: 2,
      });

      // Submit user prompt
      await handler.handleUserSubmit({ text: "Implement feature X across stages" });

      // 1. Predecessor lease must be released
      expect(releasedLeases.length).toBeGreaterThanOrEqual(1);

      // 2. resetHandshake must be called to prevent conversationId reuse (Fix F4)
      expect(handshakeResetCalled).toBe(true);

      // 3. turn:start must be broadcast to the client
      const turnStartPacket = sentPackets.find((p) => p.type === "turn:start");
      expect(turnStartPacket).toBeDefined();
      const turnStartData = turnStartPacket!.payload || turnStartPacket!.data;
      expect(turnStartData.generation).toBe(2);
      expect(turnStartData.activeSessionId).toBeDefined();
      expect(turnStartData.turn).toBeDefined();

      // 4. Clean positive guidance: no negative prohibition words in prompt
      const nextPrompt = capturedPrompts[1] || "";
      expect(nextPrompt).not.toContain("严禁");
      expect(nextPrompt).not.toContain("切勿");
      expect(nextPrompt).not.toContain("不要");
      expect(nextPrompt).toContain("【接力行动准则】");
    } finally {
      try {
        fs.rmSync(tmpWs, { recursive: true, force: true });
      } catch {}
    }
  });

  it("should handle account:pkce_start and broadcast account:pkce_started", async () => {
    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });

    // Send account:pkce_start
    (handler as any).handleMessage(
      JSON.stringify({
        type: "account:pkce_start",
        payload: { email: "user1@tenant.onmicrosoft.com" },
      })
    );

    const startedPacket = sentPackets.find((p) => p.type === "account:pkce_started");
    expect(startedPacket).toBeDefined();
    const data = startedPacket!.payload || startedPacket!.data;
    const innerData = data.data || data;
    expect(innerData.authSessionId).toBe("pkce-sess-123");
    expect(innerData.authUrl).toContain("login.microsoftonline.com");
    expect(innerData.state).toBe("state-abc");
    expect(innerData.targetEmail).toBe("user1@tenant.onmicrosoft.com");
  });

  it("should handle auth:start-pkce compatibility alias", async () => {
    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });

    (handler as any).handleMessage(
      JSON.stringify({
        type: "auth:start-pkce",
        payload: { email: "alias@tenant.onmicrosoft.com" },
      })
    );

    const startedPacket = sentPackets.find((p) => p.type === "account:pkce_started");
    expect(startedPacket).toBeDefined();
    const data = startedPacket!.payload || startedPacket!.data;
    const innerData = data.data || data;
    expect(innerData.authSessionId).toBe("pkce-sess-123");
  });

  it("should handle account:pkce_complete and broadcast accounts:update + account:pkce_completed", async () => {
    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });

    await (handler as any).handleMessage(
      JSON.stringify({
        type: "account:pkce_complete",
        payload: {
          redirectUrl: "https://login.microsoftonline.com/common/oauth2/nativeclient?code=mock_code&state=state-abc",
          state: "state-abc",
          expectedEmail: "user1@tenant.onmicrosoft.com",
        },
      })
    );

    // Verify accounts:update was broadcast
    const accountsUpdate = sentPackets.find((p) => p.type === "accounts:update");
    expect(accountsUpdate).toBeDefined();

    // Verify account:pkce_completed
    const completedPacket = sentPackets.find((p) => p.type === "account:pkce_completed");
    expect(completedPacket).toBeDefined();
    const data = completedPacket!.payload || completedPacket!.data;
    const innerData = data.data || data;
    expect(innerData.success).toBe(true);
    expect(innerData.email).toBe("user1@tenant.onmicrosoft.com");
  });

  it("should handle account:pkce_error when pkce exchange fails", async () => {
    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });

    await (handler as any).handleMessage(
      JSON.stringify({
        type: "account:pkce_complete",
        payload: {
          redirectUrl: "https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied",
          state: "state-abc",
        },
      })
    );

    const errorPacket = sentPackets.find((p) => p.type === "account:pkce_error");
    expect(errorPacket).toBeDefined();
    const data = errorPacket!.payload || errorPacket!.data;
    const innerData = data.data || data;
    expect(innerData.message).toContain("User cancelled");
  });

  it("should handle account:reset-cooldown and reset cooldown on AccountPool", async () => {
    let resetEmailTarget = "";
    mockPool.resetCooldown = (email: string) => {
      resetEmailTarget = email;
      return true;
    };

    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });

    (handler as any).handleMessage(
      JSON.stringify({
        type: "accounts:reset-cooldown",
        payload: { email: "user1@tenant.onmicrosoft.com" },
      })
    );

    expect(resetEmailTarget).toBe("user1@tenant.onmicrosoft.com");
    const accountsUpdate = sentPackets.find((p) => p.type === "accounts:update");
    expect(accountsUpdate).toBeDefined();
  });

  it("should release active session lease when user interrupts or completes", async () => {
    const handler = new RpcHandler(mockWs, {
      pool: mockPool,
    });
    (handler as any).activeSessionId = "ses-interrupt-target";

    handler.handleUserInterrupt();

    expect(releasedLeases).toContain("ses-interrupt-target");
  });
});
