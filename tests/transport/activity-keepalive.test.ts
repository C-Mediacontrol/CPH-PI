import { describe, it, expect, afterEach } from "bun:test";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";
import type { ActiveSessionToken } from "../../src/auth/token-manager.ts";

describe("ChatHubClient Activity Keepalive & Dual-Track Timeout", () => {
  let mockServer: any = null;

  afterEach(() => {
    if (mockServer) {
      try {
        mockServer.stop(true);
      } catch {}
      mockServer = null;
    }
  });

  const mockToken: ActiveSessionToken = {
    email: "test.copilot@contoso.com",
    accessToken: "mock.jwt.token",
    refreshToken: "mock_rt",
    expiresAt: Date.now() + 3600_000,
    oid: "00000000-0000-0000-0000-000000000001",
    tid: "72f988bf-86f1-41af-91ab-2d7cd011db47",
  };

  it("should default timeoutMs to 600,000ms (10 minutes) and idleTimeoutMs to 90,000ms", () => {
    const client = new ChatHubClient(mockToken);
    expect((client as any).options.timeoutMs).toBe(600_000);
    expect((client as any).options.idleTimeoutMs).toBe(90_000);
  });

  it("should respect custom timeoutMs and idleTimeoutMs override", () => {
    const client = new ChatHubClient(mockToken, {
      timeoutMs: 300_000,
      idleTimeoutMs: 45_000,
    });
    expect((client as any).options.timeoutMs).toBe(300_000);
    expect((client as any).options.idleTimeoutMs).toBe(45_000);
  });

  it("should reset idle timer on incoming frames (deltas and heartbeats) allowing long-running streams to stay alive", async () => {
    // Total stream duration will be ~250ms, while idleTimeoutMs is 120ms.
    // If keepalive doesn't reset idle timer on frames, it would fail after 120ms.
    mockServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        message(ws, msg) {
          const raw = typeof msg === "string" ? msg : msg.toString();
          const frames = ChatHubClient.decodeSignalRFrames(raw);

          for (const f of frames) {
            if (f.protocol === "json") {
              ws.send(ChatHubClient.encodeSignalR({}));
            } else if (f.target === "chat") {
              // Send delta after 70ms
              setTimeout(() => {
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: "Step 1... " }],
                  })
                );
              }, 70);

              // Send heartbeat after 140ms
              setTimeout(() => {
                ws.send(ChatHubClient.encodeSignalR({ type: 6 }));
              }, 140);

              // Send final completion after 210ms
              setTimeout(() => {
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: "Done!" }],
                  })
                );
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }, 210);
            }
          }
        },
      },
    });

    const client = new ChatHubClient(mockToken, {
      wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
      timeoutMs: 10_000,
      idleTimeoutMs: 120, // Shorter than total 210ms, but longer than interval 70ms
    });

    const deltas: string[] = [];
    const response = await client.sendMessage(
      {
        text: "Long running task",
        conversationId: "conv-keepalive",
        sessionId: "sess-keepalive",
        requestId: "req-keepalive",
        isStartOfSession: false,
      },
      {
        onDelta: (d) => {
          deltas.push(d.content);
        },
      }
    );

    expect(response.text).toBe("Step 1... Done!");
    expect(deltas).toEqual(["Step 1... ", "Done!"]);
  });

  it("should trigger idle timeout when no data is received within idleTimeoutMs", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        message(ws, msg) {
          const raw = typeof msg === "string" ? msg : msg.toString();
          const frames = ChatHubClient.decodeSignalRFrames(raw);

          for (const f of frames) {
            if (f.protocol === "json") {
              ws.send(ChatHubClient.encodeSignalR({}));
            } else if (f.target === "chat") {
              // Send nothing, simulate silent freeze
            }
          }
        },
      },
    });

    const client = new ChatHubClient(mockToken, {
      wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
      timeoutMs: 10_000,
      idleTimeoutMs: 80,
    });

    let error: any = null;
    try {
      await client.sendMessage({
        text: "Silent freeze",
        conversationId: "conv-silent",
        sessionId: "sess-silent",
        requestId: "req-silent",
        isStartOfSession: false,
      });
    } catch (err: any) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain("ChatHub connection idle timeout");
  });
});
