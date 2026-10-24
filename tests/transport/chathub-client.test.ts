import { describe, it, expect, afterEach } from "bun:test";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";
import { RECORD_SEPARATOR, type StreamDelta } from "../../src/transport/types.ts";
import type { ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

describe("ChatHub Transport Layer Unit Tests", () => {
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

  describe("1. SignalR Frame Serialization & URL Construction", () => {
    it("should encode object to SignalR frame with RECORD_SEPARATOR", () => {
      const obj = { protocol: "json", version: 1 };
      const frame = ChatHubClient.encodeSignalR(obj);
      expect(frame).toBe(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    });

    it("should decode multiple frames delimited by RECORD_SEPARATOR", () => {
      const raw = `{"type":6}${RECORD_SEPARATOR}{"target":"update","type":1}${RECORD_SEPARATOR}`;
      const decoded = ChatHubClient.decodeSignalRFrames(raw);
      expect(decoded.length).toBe(2);
      expect(decoded[0].type).toBe(6);
      expect(decoded[1].target).toBe("update");
    });

    it("should construct default Sydney WebSocket URL with query parameters", () => {
      const client = new ChatHubClient(mockToken, {
        agentHost: "Bizchat.FullScreen",
        scenario: "OfficeWebIncludedCopilot",
      });
      const url = client.buildWsUrl("conv-123", "sess-456", "req-789");
      expect(url.startsWith("wss://substrate.office.com/m365Copilot/Chathub/")).toBe(true);
      expect(url).toContain("ConversationId=conv-123");
      expect(url).toContain("X-SessionId=sess-456");
      expect(url).toContain("chatsessionid=req-789");
      expect(url).toContain("access_token=mock.jwt.token");
    });

    it("should respect custom wsBaseUrl when configured", () => {
      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: "ws://localhost:9999/customHub",
      });
      const url = client.buildWsUrl("c1", "s1", "r1");
      expect(url.startsWith("ws://localhost:9999/customHub/")).toBe(true);
    });
  });

  describe("2. Mock WebSocket Duplex Connection & Streaming Deltas", () => {
    it("should complete SignalR handshake and receive streaming deltas", async () => {
      const deltas: StreamDelta[] = [];
      const reasoningEvents: string[] = [];
      let heartbeatReceived = false;

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          open(ws) {
            // Wait for client's handshake
          },
          message(ws, msg) {
            const raw = typeof msg === "string" ? msg : msg.toString();
            const frames = ChatHubClient.decodeSignalRFrames(raw);

            for (const f of frames) {
              if (f.protocol === "json") {
                // Step 1: Handshake ack
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                // Step 2: Stream back reasoning and text deltas
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [
                      {
                        messages: [
                          {
                            messageType: "Progress",
                            text: "Analyzing project files...",
                          },
                        ],
                      },
                    ],
                  })
                );

                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: "Hello " }],
                  })
                );

                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: "from Copilot!" }],
                  })
                );

                // Step 3: Trigger a heartbeat ping
                ws.send(ChatHubClient.encodeSignalR({ type: 6 }));
              } else if (f.type === 6) {
                // Received heartbeat pong from client, now complete
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      const response = await client.sendMessage(
        {
          text: "Hi",
          conversationId: "conv-1",
          sessionId: "sess-1",
          requestId: "req-1",
          isStartOfSession: true,
        },
        {
          onDelta: (d) => {
            deltas.push(d);
          },
          onReasoning: (r) => {
            reasoningEvents.push(r);
          },
          onHeartbeat: () => {
            heartbeatReceived = true;
          },
        }
      );

      expect(response.text).toBe("Hello from Copilot!");
      expect(response.reasoning).toContain("Analyzing project files...");
      expect(deltas.length).toBe(3);
      expect(deltas[0].type).toBe("reasoning");
      expect(deltas[1].content).toBe("Hello ");
      expect(deltas[2].content).toBe("from Copilot!");
      expect(reasoningEvents).toContain("Analyzing project files...");
      expect(heartbeatReceived).toBe(true);
    });

    it("should accept authoritative m.text from bot message over partial writeAtCursor tokens", async () => {
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
                // Step 1: Stream partial typing tokens from model without fences (writeAtCursor)
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [
                      {
                        writeAtCursor: "正在调查...action\ntool: run_command\n cd /e/test",
                      },
                    ],
                  })
                );

                // Step 2: Sydney gateway delivers complete authoritative m.text with standard markdown fences
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [
                      {
                        messages: [
                          {
                            author: "bot",
                            text: "正在调查...\n```action\ntool: run_command\ncommand: cd /e/test\n```",
                          },
                        ],
                      },
                    ],
                  })
                );

                // Step 3: Complete
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      const response = await client.sendMessage({
        text: "Run script",
        conversationId: "conv-authoritative",
        sessionId: "sess-authoritative",
        requestId: "req-authoritative",
      });

      // Must receive the authoritative m.text with markdown block
      expect(response.text).toBe(
        "正在调查...\n```action\ntool: run_command\ncommand: cd /e/test\n```"
      );
      expect(response.text).toContain("```action");
      expect(response.text).toContain("command: cd /e/test");
    });

    it("should detect rate limit in streaming message and trigger onRateLimitDetected", async () => {
      let detectedEmail = "";

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
                // Send bot message indicating rate limit
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [
                      {
                        messages: [
                          {
                            author: "bot",
                            text: "抱歉，您的每日配额已达上限，请稍后再试。",
                          },
                        ],
                      },
                    ],
                  })
                );
                ws.send(ChatHubClient.encodeSignalR({ type: 2 }));
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      await client.sendMessage(
        {
          text: "Generate code",
          conversationId: "c2",
          sessionId: "s2",
          requestId: "r2",
          isStartOfSession: false,
        },
        {
          onRateLimitDetected: (email) => {
            detectedEmail = email;
          },
        }
      );

      expect(detectedEmail).toBe(mockToken.email);
    });

    it("should NOT trigger onRateLimitDetected when WebSocket closes prematurely with code 1006 (network drop)", async () => {
      let detectedEmail = "";

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          open(ws) {
            // Immediately close with 1006 (abnormal close) before chat is sent
            ws.close(1006, "Abnormal closure");
          },
          message() {},
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      try {
        await client.sendMessage(
          {
            text: "Hello",
            conversationId: "c_1006",
            sessionId: "s_1006",
            requestId: "r_1006",
          },
          {
            onRateLimitDetected: (email) => {
              detectedEmail = email;
            },
          }
        );
      } catch {}

      // Code 1006 must NOT falsely mark account as throttled
      expect(detectedEmail).toBe("");
    });

    it("should trigger onRateLimitDetected when WebSocket closes prematurely with code 1008 (policy violation)", async () => {
      let detectedEmail = "";

      mockServer = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
          open(ws) {
            // Close with 1008 (policy violation / rate limit)
            ws.close(1008, "Policy Violation");
          },
          message() {},
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      try {
        await client.sendMessage(
          {
            text: "Hello",
            conversationId: "c_1008",
            sessionId: "s_1008",
            requestId: "r_1008",
          },
          {
            onRateLimitDetected: (email) => {
              detectedEmail = email;
            },
          }
        );
      } catch {}

      // Code 1008 must trigger rate limit detection
      expect(detectedEmail).toBe(mockToken.email);
    });
  });

  describe("3. AbortSignal Handling & Cancellation", () => {
    it("should reject immediately if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const client = new ChatHubClient(mockToken, { timeoutMs: 5000 });
      let caughtErr: any;

      try {
        await client.sendMessage({
          text: "Aborted call",
          conversationId: "c3",
          sessionId: "s3",
          requestId: "r3",
          isStartOfSession: false,
          signal: controller.signal,
        });
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.name).toBe("AbortError");
    });

    it("should abort ongoing stream when signal fires mid-stream", async () => {
      const controller = new AbortController();

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
                // Send partial delta and stay open without sending type 2
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 1,
                    target: "update",
                    arguments: [{ writeAtCursor: "Starting large computation..." }],
                  })
                );
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 10_000,
      });

      let deltaReceived = false;
      const promise = client.sendMessage(
        {
          text: "Heavy work",
          conversationId: "c4",
          sessionId: "s4",
          requestId: "r4",
          isStartOfSession: false,
          signal: controller.signal,
        },
        {
          onDelta: () => {
            deltaReceived = true;
            // Abort as soon as first delta arrives
            controller.abort();
          },
        }
      );

      let caughtErr: any;
      try {
        await promise;
      } catch (err: any) {
        caughtErr = err;
      }

      expect(deltaReceived).toBe(true);
      expect(caughtErr).toBeDefined();
      expect(caughtErr.name).toBe("AbortError");
    });
  });

  describe("4. Substrate Attachment Uploader", () => {
    let mockHttpServer: any = null;

    afterEach(() => {
      if (mockHttpServer) {
        mockHttpServer.stop(true);
        mockHttpServer = null;
      }
    });

    it("should successfully upload image to Substrate and return AttachmentAnnotation", async () => {
      mockHttpServer = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.text();
          expect(body).toContain("scenario=UploadImage");
          expect(body).toContain("conversationId=conv-test");
          return new Response(
            JSON.stringify({
              docId: "substrate-doc-12345",
              fileName: "diagram.png",
              fileType: "png",
              result: { value: "Success" },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        },
      });

      const fakeImage = Buffer.from("fake_png_binary_data");
      const annotation = await SubstrateUploader.uploadImage(
        "mock_access_token",
        fakeImage,
        {
          fileName: "diagram.png",
          conversationId: "conv-test",
          uploadUrl: `http://127.0.0.1:${mockHttpServer.port}/UploadFile`,
        }
      );

      expect(annotation.id).toBe("substrate-doc-12345");
      expect(annotation.messageAnnotationType).toBe("ImageFile");
      expect(annotation.messageAnnotationMetadata.fileName).toBe("diagram.png");
    });

    it("should upload document bundle to OneDrive via Graph API", async () => {
      mockHttpServer = Bun.serve({
        port: 0,
        async fetch(req) {
          if (req.method === "GET") {
            return new Response(
              JSON.stringify({
                id: "list-123",
                parentReference: { siteId: "contoso.sharepoint.com,site-abc,web-def" },
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
          const content = await req.text();
          expect(content).toBe("console.log('hello world');");
          return new Response(
            JSON.stringify({
              id: "onedrive-item-987",
              webUrl: "https://contoso.sharepoint.com/doc.ts",
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        },
      });

      const res = await SubstrateUploader.uploadDocumentToOneDrive(
        "graph_token",
        "console.log('hello world');",
        "code_bundle.ts",
        `http://127.0.0.1:${mockHttpServer.port}`
      );

      expect(res.driveItemId).toBe("onedrive-item-987");
      expect(res.webUrl).toBe("https://contoso.sharepoint.com/doc.ts");
      expect(res.annotation).toBeDefined();
      expect(res.annotation.id).toContain("onedrive-item-987");
      expect(res.annotation.messageAnnotationType).toBe("LocalFile");
      expect(res.annotation.text).toBe("code_bundle.ts");
      expect(res.annotation.url).toBe("https://contoso.sharepoint.com/doc.ts");
      expect(res.annotation.messageAnnotationMetadata?.fileName).toBe("code_bundle.ts");
      expect(res.annotation.messageAnnotationMetadata?.webUrl).toBe("https://contoso.sharepoint.com/doc.ts");
    });
  });

  describe("SharePoint Enterprise Search optionsSets & isStartOfSession", () => {
    it("should include 'cwc_flux_v3' in default optionsSets and default isStartOfSession to false in buildInvocationPayload", () => {
      const client = new ChatHubClient(mockToken);
      const payload = client.buildInvocationPayload({
        text: "hello search",
        conversationId: "conv-cwc-1",
      });

      expect(payload.type).toBe(4);
      expect(payload.target).toBe("chat");
      const args = payload.arguments[0];
      expect(args.optionsSets).toContain("cwc_flux_v3");
      const updateIdx = args.optionsSets.indexOf("update_textdoc_response_after_streaming");
      const fluxIdx = args.optionsSets.indexOf("cwc_flux_v3");
      expect(updateIdx).toBeGreaterThanOrEqual(0);
      expect(fluxIdx).toBe(updateIdx + 1);
      expect(args.isStartOfSession).toBe(false);
    });

    it("should set isStartOfSession to true when explicitly provided in buildInvocationPayload", () => {
      const client = new ChatHubClient(mockToken);
      const payload = client.buildInvocationPayload({
        text: "first turn message",
        conversationId: "conv-cwc-2",
        isStartOfSession: true,
      });

      const args = payload.arguments[0];
      expect(args.isStartOfSession).toBe(true);
      expect(args.optionsSets).toContain("cwc_flux_v3");
    });

    it("should transmit 'cwc_flux_v3' and isStartOfSession in SignalR frame via sendMessage", async () => {
      let receivedChatFrame: any = null;

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
                receivedChatFrame = f;
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 2,
                    item: { result: { value: "Success" } },
                  })
                );
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}`,
      });

      await client.sendMessage({
        text: "turn 1 prompt",
        conversationId: "conv-turn-1",
        isStartOfSession: true,
      });

      expect(receivedChatFrame).toBeDefined();
      expect(receivedChatFrame.arguments[0].optionsSets).toContain("cwc_flux_v3");
      expect(receivedChatFrame.arguments[0].isStartOfSession).toBe(true);
    });

    it("should default isStartOfSession to false in SignalR frame via sendMessage when omitted", async () => {
      let receivedChatFrame: any = null;

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
                receivedChatFrame = f;
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 2,
                    item: { result: { value: "Success" } },
                  })
                );
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}`,
      });

      await client.sendMessage({
        text: "turn 2 prompt",
        conversationId: "conv-turn-2",
      });

      expect(receivedChatFrame).toBeDefined();
      expect(receivedChatFrame.arguments[0].optionsSets).toContain("cwc_flux_v3");
      expect(receivedChatFrame.arguments[0].isStartOfSession).toBe(false);
    });
  });
});

