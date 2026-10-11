import { describe, it, expect, afterEach } from "bun:test";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";
import type { ActiveSessionToken } from "../../src/auth/token-manager.ts";

describe("Custom Agent Transport & GPT-6.1 Sol Locking", () => {
  let mockServer: any = null;

  afterEach(() => {
    if (mockServer) {
      try {
        mockServer.stop(true);
      } catch {}
      mockServer = null;
    }
  });

  const dummyToken: ActiveSessionToken = {
    email: "test.copilot@contoso.com",
    accessToken: "mock_jwt_token",
    expiresAt: Date.now() + 3600000,
    oid: "mock_oid",
    tid: "mock_tid",
  };

  describe("1. Agent ID Normalization", () => {
    it("should normalize agent id from full web url or raw string", () => {
      const rawId = "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";
      const fullUrl = `https://m365.cloud.microsoft/chat/agent/${rawId}?es=Click`;

      expect(ChatHubClient.normalizeAgentId(rawId)).toBe(rawId);
      expect(ChatHubClient.normalizeAgentId(fullUrl)).toBe(rawId);
      expect(ChatHubClient.normalizeAgentId(undefined)).toBeUndefined();
      expect(ChatHubClient.normalizeAgentId("   ")).toBeUndefined();
      expect(ChatHubClient.normalizeAgentId("")).toBeUndefined();
    });

    it("should decode URL-encoded agent id in url", () => {
      const encodedId = "T_agent%20custom%2F123";
      const fullUrl = `https://m365.cloud.microsoft/chat/agent/${encodedId}#section`;
      expect(ChatHubClient.normalizeAgentId(fullUrl)).toBe("T_agent custom/123");
    });
  });

  describe("2. WebSocket URL Construction & Query Injection", () => {
    it("should append gptId and agent query parameters to wsUrl when customAgentId is configured", () => {
      const agentId = "T_test_agent_123";
      const client = new ChatHubClient(dummyToken, {
        customAgentId: agentId,
        modelTone: "Gpt_61_Sol_Reasoning",
      });

      const url = client.buildWsUrl("conv_1", "ses_1", "req_1");
      expect(url).toContain(`gptId=${encodeURIComponent(agentId + "@MOS3")}`);
      expect(url).toContain("agent=Agent");
      expect(url).toContain("agentHost=Bizchat.FullScreen");
    });

    it("should not append gptId and should use agent=web when customAgentId is not configured", () => {
      const client = new ChatHubClient(dummyToken);
      const url = client.buildWsUrl("conv_1", "ses_1", "req_1");
      expect(url).not.toContain("gptId=");
      expect(url).toContain("agent=web");
    });
  });

  describe("3. Model Tone Default Locking", () => {
    it("should default modelTone to Gpt_61_Sol_Reasoning when omitted", () => {
      const client = new ChatHubClient(dummyToken);
      expect((client as any).options.modelTone).toBe("Gpt_61_Sol_Reasoning");
    });

    it("should allow overriding modelTone if explicitly specified", () => {
      const client = new ChatHubClient(dummyToken, {
        modelTone: "Precise",
      });
      expect((client as any).options.modelTone).toBe("Precise");
    });
  });

  describe("4. SignalR Frame Injection in sendMessage", () => {
    it("should inject threadLevelGptId and gpts into chat frame when customAgentId is set", async () => {
      const agentId = "T_9feac605_custom_agent";
      let capturedChatArgs: any = null;

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          open() {},
          message(ws, msg) {
            const raw = typeof msg === "string" ? msg : msg.toString();
            const frames = ChatHubClient.decodeSignalRFrames(raw);

            for (const f of frames) {
              if (f.protocol === "json") {
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                capturedChatArgs = f.arguments?.[0];
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }
            }
          },
        },
      });

      const client = new ChatHubClient(dummyToken, {
        customAgentId: agentId,
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      await client.sendMessage({
        text: "hello custom agent",
        conversationId: "conv-1",
        sessionId: "sess-1",
        requestId: "req-1",
      });

      expect(capturedChatArgs).not.toBeNull();
      expect(capturedChatArgs.threadLevelGptId).toEqual({
        id: agentId,
        source: "MOS3",
      });
      expect(capturedChatArgs.gpts).toEqual([
        {
          id: agentId,
          source: "MOS3",
          version: "1.0.0",
        },
      ]);
      expect(capturedChatArgs.tone).toBe("Gpt_61_Sol_Reasoning");
    });

    it("should not inject threadLevelGptId or gpts when customAgentId is absent", async () => {
      let capturedChatArgs: any = null;

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          open() {},
          message(ws, msg) {
            const raw = typeof msg === "string" ? msg : msg.toString();
            const frames = ChatHubClient.decodeSignalRFrames(raw);

            for (const f of frames) {
              if (f.protocol === "json") {
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                capturedChatArgs = f.arguments?.[0];
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }
            }
          },
        },
      });

      const client = new ChatHubClient(dummyToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      await client.sendMessage({
        text: "hello generic agent",
        conversationId: "conv-2",
        sessionId: "sess-2",
        requestId: "req-2",
      });

      expect(capturedChatArgs).not.toBeNull();
      expect(capturedChatArgs.threadLevelGptId).toBeUndefined();
      expect(capturedChatArgs.gpts).toBeUndefined();
      expect(capturedChatArgs.tone).toBe("Gpt_61_Sol_Reasoning");
    });
  });
});
