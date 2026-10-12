import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { TokenManager, type StoredAccount, type ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { encryptToken } from "../../src/auth/crypto.ts";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("CR-03: Concurrency Race & Transport Robustness Characterisation Tests", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let mockServer: any = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-concurrency-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");
  });

  afterEach(() => {
    if (mockServer) {
      try {
        mockServer.stop(true);
      } catch {}
      mockServer = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. AccountPool Concurrent Round-Robin Anti-Collision", () => {
    it("should allocate distinct accounts across concurrent getNextAvailableToken calls", async () => {
      // 构造含有 3 个健康账号的 AccountPool
      const accounts: StoredAccount[] = [
        { email: "user1@contoso.com", refreshToken: encryptToken("rt_1") },
        { email: "user2@contoso.com", refreshToken: encryptToken("rt_2") },
        { email: "user3@contoso.com", refreshToken: encryptToken("rt_3") },
      ];

      // 模拟异步获取 token 时有微小延迟，模拟真实 I/O 调度
      const manager = new TokenManager(tempConfigPath, {
        fetchFn: async (_url: string) => {
          await new Promise((r) => setTimeout(r, 20));
          const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
          const payload = Buffer.from(
            JSON.stringify({ oid: "oid", tid: "tid", exp: Math.floor(Date.now() / 1000) + 3600 })
          ).toString("base64url");
          return new Response(
            JSON.stringify({
              access_token: `${header}.${payload}.sig`,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        },
      });
      manager.saveAccounts(accounts);

      const pool = new AccountPool(manager, { maxAccounts: 3 });

      // 模拟 3 个并发调用 Promise.all([pool.getNextAvailableToken(), ...])
      const [token1, token2, token3] = await Promise.all([
        pool.getNextAvailableToken(),
        pool.getNextAvailableToken(),
        pool.getNextAvailableToken(),
      ]);

      const allocatedEmails = [token1.email, token2.email, token3.email];

      // 断言 3 个调用分别分配到不同的账号（轮询指针在进入异步获取前递增，杜绝碰撞在同一个账号）
      expect(new Set(allocatedEmails).size).toBe(3);
      expect(allocatedEmails).toEqual([
        "user1@contoso.com",
        "user2@contoso.com",
        "user3@contoso.com",
      ]);

      // 再次调用应该继续循环回第 1 个账号
      const token4 = await pool.getNextAvailableToken();
      expect(token4.email).toBe("user1@contoso.com");
    });
  });

  describe("2. TokenManager Single-Flight Request Deduplication", () => {
    it("should deduplicate concurrent refresh requests to a single fetchFn call", async () => {
      let fetchCallCount = 0;
      const targetEmail = "singleflight@contoso.com";

      const manager = new TokenManager(tempConfigPath, {
        fetchFn: async (_url: string) => {
          fetchCallCount++;
          // 模拟网络延迟
          await new Promise((r) => setTimeout(r, 30));
          const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
          const payload = Buffer.from(
            JSON.stringify({
              oid: "sf-oid",
              tid: "sf-tid",
              exp: Math.floor(Date.now() / 1000) + 3600,
            })
          ).toString("base64url");
          return new Response(
            JSON.stringify({
              access_token: `${header}.${payload}.sig`,
              refresh_token: "new_rotated_rt",
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        },
      });

      manager.saveAccounts([
        {
          email: targetEmail,
          refreshToken: encryptToken("initial_rt"),
        },
      ]);

      // 对同一个未缓存账号发起 5 个并发 tokenManager.getAccessToken(email) 请求
      const promises = [
        manager.getAccessToken(targetEmail),
        manager.getAccessToken(targetEmail),
        manager.getAccessToken(targetEmail),
        manager.getAccessToken(targetEmail),
        manager.getAccessToken(targetEmail),
      ];

      const results = await Promise.all(promises);

      // 断言底层的 fetchFn 仅被实际调用 1 次
      expect(fetchCallCount).toBe(1);
      expect(results.length).toBe(5);

      // 5 个 Promise 全部解析为相同的有效 Token
      const expectedAccessToken = results[0].accessToken;
      for (const res of results) {
        expect(res.accessToken).toBe(expectedAccessToken);
        expect(res.email).toBe(targetEmail);
      }
    });
  });

  describe("3. ChatHubClient Abnormal Disconnect Rejection", () => {
    const mockToken: ActiveSessionToken = {
      email: "chathub.test@contoso.com",
      accessToken: "mock.jwt.token",
      refreshToken: "mock_rt",
      expiresAt: Date.now() + 3600_000,
      oid: "00000000-0000-0000-0000-000000000001",
      tid: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    };

    it("should reject sendMessage and trigger onRateLimitDetected when closed with 1008 after Chat frame", async () => {
      let rateLimitDetectedEmail: string | null = null;

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
                // Handshake ack
                ws.send(ChatHubClient.encodeSignalR({}));
              } else if (f.target === "chat") {
                // 发送 Chat 帧后遭遇 1008 异常断连且 fullText 为空
                ws.close(1008, "Policy violation rate limited");
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      let rejectedError: any = null;
      let resolvedValue: any = null;

      try {
        resolvedValue = await client.sendMessage(
          {
            text: "Hello Copilot",
            conversationId: "conv-race-1",
            sessionId: "sess-race-1",
            requestId: "req-race-1",
            isStartOfSession: true,
          },
          {
            onRateLimitDetected: (email) => {
              rateLimitDetectedEmail = email;
            },
          }
        );
      } catch (err: any) {
        rejectedError = err;
      }

      // 断言 sendMessage 的 Promise 被 reject，绝不能调用 settleResolve({ text: "" }) 伪装成功
      expect(resolvedValue).toBeNull();
      expect(rejectedError).not.toBeNull();
      expect(rejectedError.message).toContain("1008");
      expect(rejectedError.message).toContain("WebSocket connection closed abnormally");

      // 并且触发 onRateLimitDetected
      expect(rateLimitDetectedEmail).toBe(mockToken.email);
    });

    it("should reject sendMessage and trigger onRateLimitDetected when closed with 1006 after Chat frame", async () => {
      let rateLimitDetectedEmail: string | null = null;

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
                // 强制 terminate 模拟底层网络断开 (code 1006)
                ws.terminate();
              }
            }
          },
        },
      });

      const client = new ChatHubClient(mockToken, {
        wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
        timeoutMs: 5000,
      });

      let rejectedError: any = null;
      let resolvedValue: any = null;

      try {
        resolvedValue = await client.sendMessage(
          {
            text: "Hello Copilot",
            conversationId: "conv-race-2",
            sessionId: "sess-race-2",
            requestId: "req-race-2",
            isStartOfSession: true,
          },
          {
            onRateLimitDetected: (email) => {
              rateLimitDetectedEmail = email;
            },
          }
        );
      } catch (err: any) {
        rejectedError = err;
      }

      // 断言 sendMessage 的 Promise 被 reject，绝不能伪装成功
      expect(resolvedValue).toBeNull();
      expect(rejectedError).not.toBeNull();
      expect(rejectedError.message).toContain("1006");
      expect(rejectedError.message).toContain("WebSocket connection closed abnormally");
      expect(rateLimitDetectedEmail).toBe(mockToken.email);
    });
  });
});

