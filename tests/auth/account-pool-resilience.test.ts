import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { encryptToken } from "../../src/auth/crypto.ts";
import { TokenManager, type StoredAccount, type ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { ChatHubClient } from "../../src/transport/chathub-client.ts";

describe("AccountPool Resilience & Agent-Aware Disaster Recovery Tests", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let manager: TokenManager;
  let pool: AccountPool;
  let mockServer: any = null;

  const CPH_DEV_AGENT = "T_9feac605-583d-c37d-cb38-831efe727253";
  const OTHER_AGENT = "T_other_agent_9999";

  const ACCOUNT_EMAILS = [
    "GSC.VFU2@cma-cgm.com",
    "GSC.DDAI@cma-cgm.com",
    "GSC.LISLIU@cma-cgm.com",
    "GSC.MLU@cma-cgm.com",
    "GSC.CYLI@cma-cgm.com",
    "GSC.MIYMAO@cma-cgm.com",
    "GSC.BACKUP@cma-cgm.com",
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-resilience-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");

    manager = new TokenManager(tempConfigPath);
    const stored: StoredAccount[] = ACCOUNT_EMAILS.map((email, idx) => ({
      email,
      refreshToken: encryptToken(`rt_${idx + 1}`),
    }));
    manager.saveAccounts(stored);

    // Pre-cache active tokens for each account
    ACCOUNT_EMAILS.forEach((email, idx) => {
      manager.setCachedToken(email, {
        email,
        accessToken: `token_${idx + 1}`,
        refreshToken: `rt_${idx + 1}`,
        expiresAt: Date.now() + 3600_000,
        oid: `oid-${idx + 1}`,
        tid: `tid-${idx + 1}`,
      });
    });

    pool = new AccountPool(manager, { maxAccounts: 7, defaultCooldownMs: 60_000 });
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

  describe("1. Agent Eligibility & Capability Marking", () => {
    it("should report all accounts as eligible by default", () => {
      for (const email of ACCOUNT_EMAILS) {
        expect(pool.isAgentEligible(email, CPH_DEV_AGENT)).toBe(true);
        expect(pool.isAgentEligible(email)).toBe(true);
      }
    });

    it("should mark account ineligible for a specific agent with reason", () => {
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT, "GptAccessForbidden");

      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
      // Other agents should remain eligible
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT)).toBe(true);
      // Other accounts should remain eligible for CPH_DEV_AGENT
      expect(pool.isAgentEligible("GSC.VFU2@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
    });

    it("should normalize email case-insensitively and agent URLs", () => {
      const fullAgentUrl = `https://m365.cloud.microsoft/chat/agent/${CPH_DEV_AGENT}?es=Click`;
      pool.markAgentIneligible("gsc.lisliu@cma-cgm.com", fullAgentUrl, "GptAccessForbidden");

      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
      expect(pool.isAgentEligible("GSC.LISLIU@CMA-CGM.COM", fullAgentUrl)).toBe(false);
    });

    it("should clear ineligibility for specific agent and account", () => {
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT);
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT)).toBe(false);

      pool.clearAgentIneligibility("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT)).toBe(false);
    });

    it("should clear all ineligibilities for a specific account when agent is omitted", () => {
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT);
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT);

      pool.clearAgentIneligibility("GSC.LISLIU@cma-cgm.com");
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", OTHER_AGENT)).toBe(true);
    });

    it("should clear specific agent ineligibility across all accounts", () => {
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT);
      pool.markAgentIneligible("GSC.MLU@cma-cgm.com", CPH_DEV_AGENT);

      pool.clearAgentIneligibility(undefined, CPH_DEV_AGENT);
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
      expect(pool.isAgentEligible("GSC.MLU@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
    });

    it("should clear all ineligibilities when called with no arguments", () => {
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT);
      pool.markAgentIneligible("GSC.MLU@cma-cgm.com", OTHER_AGENT);

      pool.clearAgentIneligibility();
      expect(pool.isAgentEligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT)).toBe(true);
      expect(pool.isAgentEligible("GSC.MLU@cma-cgm.com", OTHER_AGENT)).toBe(true);
    });
  });

  describe("2. Agent-Aware Token Scheduling & Dynamic Round-Robin", () => {
    beforeEach(() => {
      // Configure realistic environment:
      // VFU2 & DDAI are eligible for CPH-Dev;
      // LISLIU, MLU, CYLI, MIYMAO, BACKUP are marked ineligible for CPH-Dev.
      pool.markAgentIneligible("GSC.LISLIU@cma-cgm.com", CPH_DEV_AGENT, "GptAccessForbidden");
      pool.markAgentIneligible("GSC.MLU@cma-cgm.com", CPH_DEV_AGENT, "GptNotAvailable");
      pool.markAgentIneligible("GSC.CYLI@cma-cgm.com", CPH_DEV_AGENT, "GptNotAvailable");
      pool.markAgentIneligible("GSC.MIYMAO@cma-cgm.com", CPH_DEV_AGENT, "GptNotAvailable");
      pool.markAgentIneligible("GSC.BACKUP@cma-cgm.com", CPH_DEV_AGENT, "GptNotAvailable");
    });

    it("should schedule only between eligible accounts (VFU2 & DDAI) in Round-Robin order", async () => {
      const tokens: string[] = [];
      for (let i = 0; i < 4; i++) {
        const t = await pool.getNextAvailableToken(CPH_DEV_AGENT);
        tokens.push(t.email);
      }

      expect(tokens[0]).toBe("GSC.VFU2@cma-cgm.com");
      expect(tokens[1]).toBe("GSC.DDAI@cma-cgm.com");
      expect(tokens[2]).toBe("GSC.VFU2@cma-cgm.com");
      expect(tokens[3]).toBe("GSC.DDAI@cma-cgm.com");
    });

    it("should accept { forAgentId } options object parameter", async () => {
      const t1 = await pool.getNextAvailableToken({ forAgentId: CPH_DEV_AGENT });
      const t2 = await pool.getNextAvailableToken({ forAgentId: CPH_DEV_AGENT });

      expect(t1.email).toBe("GSC.VFU2@cma-cgm.com");
      expect(t2.email).toBe("GSC.DDAI@cma-cgm.com");
    });

    it("should seamlessly route to next eligible account when one is 429 throttled", async () => {
      // Mark VFU2 throttled
      pool.markThrottled("GSC.VFU2@cma-cgm.com", 60_000);

      // Next call for CPH_DEV_AGENT should skip VFU2 and ineligible accounts, picking DDAI
      const token = await pool.getNextAvailableToken(CPH_DEV_AGENT);
      expect(token.email).toBe("GSC.DDAI@cma-cgm.com");
    });

    it("should throw clear wait time exception when all eligible accounts are throttled", async () => {
      pool.markThrottled("GSC.VFU2@cma-cgm.com", 30_000);
      pool.markThrottled("GSC.DDAI@cma-cgm.com", 45_000);

      await expect(pool.getNextAvailableToken(CPH_DEV_AGENT)).rejects.toThrow(
        /All 2 eligible account\(s\) for agent .* in the pool are currently rate-limited/
      );
    });

    it("should throw informative error when no accounts are eligible for the agent", async () => {
      pool.markAgentIneligible("GSC.VFU2@cma-cgm.com", CPH_DEV_AGENT);
      pool.markAgentIneligible("GSC.DDAI@cma-cgm.com", CPH_DEV_AGENT);

      await expect(pool.getNextAvailableToken(CPH_DEV_AGENT)).rejects.toThrow(
        /No eligible accounts found in pool for agent/
      );
    });

    it("should preserve original all-accounts round-robin when forAgentId is omitted", async () => {
      const token = await pool.getNextAvailableToken();
      expect(token.email).toBe("GSC.VFU2@cma-cgm.com");
    });
  });

  describe("3. Automated Disaster Recovery & Relay (executeWithRelay)", () => {
    it("should rotate account on 429 rate limit and mark account throttled", async () => {
      let callCount = 0;
      const callers: string[] = [];

      const res = await pool.executeWithRelay(async (token) => {
        callCount++;
        callers.push(token.email);
        if (callCount === 1) {
          throw new Error("HTTP 429 Too Many Requests: quota exceeded");
        }
        return `OK_${token.email}`;
      });

      expect(callCount).toBe(2);
      expect(callers[0]).toBe("GSC.VFU2@cma-cgm.com");
      expect(callers[1]).toBe("GSC.DDAI@cma-cgm.com");
      expect(res).toBe("OK_GSC.DDAI@cma-cgm.com");

      // Verify VFU2 was marked throttled
      const status = pool.getPoolStatus();
      expect(status.find((s) => s.email === "GSC.VFU2@cma-cgm.com")?.isThrottled).toBe(true);
    });

    it("should mark account ineligible and rotate to next account on GptAccessForbidden", async () => {
      let callCount = 0;
      const callers: string[] = [];

      const res = await pool.executeWithRelay(
        async (token) => {
          callCount++;
          callers.push(token.email);
          if (token.email === "GSC.VFU2@cma-cgm.com") {
            const err: any = new Error("[GptAccessForbidden] Need tenant admin approval");
            err.errorCode = "GptAccessForbidden";
            err.agentId = CPH_DEV_AGENT;
            throw err;
          }
          return `OK_${token.email}`;
        },
        { forAgentId: CPH_DEV_AGENT }
      );

      expect(callCount).toBe(2);
      expect(callers[0]).toBe("GSC.VFU2@cma-cgm.com");
      expect(callers[1]).toBe("GSC.DDAI@cma-cgm.com");
      expect(res).toBe("OK_GSC.DDAI@cma-cgm.com");

      // Verify VFU2 was marked ineligible for CPH_DEV_AGENT, but NOT throttled
      expect(pool.isAgentEligible("GSC.VFU2@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
      const status = pool.getPoolStatus();
      expect(status.find((s) => s.email === "GSC.VFU2@cma-cgm.com")?.isThrottled).toBe(false);
    });

    it("should mark account ineligible and rotate to next account on GptNotAvailable", async () => {
      let callCount = 0;
      const callers: string[] = [];

      const res = await pool.executeWithRelay(
        async (token) => {
          callCount++;
          callers.push(token.email);
          if (token.email === "GSC.VFU2@cma-cgm.com") {
            throw new Error("[GptNotAvailable] Agent not published for this account");
          }
          return `OK_${token.email}`;
        },
        { forAgentId: CPH_DEV_AGENT }
      );

      expect(callCount).toBe(2);
      expect(callers[0]).toBe("GSC.VFU2@cma-cgm.com");
      expect(callers[1]).toBe("GSC.DDAI@cma-cgm.com");
      expect(res).toBe("OK_GSC.DDAI@cma-cgm.com");

      expect(pool.isAgentEligible("GSC.VFU2@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
    });

    it("should handle multi-hop dual disaster recovery (GptAccessForbidden -> 429 -> Success)", async () => {
      let callCount = 0;
      const callers: string[] = [];

      const res = await pool.executeWithRelay(
        async (token) => {
          callCount++;
          callers.push(token.email);
          if (token.email === "GSC.VFU2@cma-cgm.com") {
            // Hop 1: VFU2 lacks permission
            throw new Error("[GptAccessForbidden] Access Denied");
          }
          if (token.email === "GSC.DDAI@cma-cgm.com") {
            // Hop 2: DDAI is rate-limited
            throw new Error("429 Too Many Requests");
          }
          // Hop 3: LISLIU succeeds
          return `SUCCESS_${token.email}`;
        },
        { forAgentId: CPH_DEV_AGENT }
      );

      expect(callCount).toBe(3);
      expect(callers[0]).toBe("GSC.VFU2@cma-cgm.com");
      expect(callers[1]).toBe("GSC.DDAI@cma-cgm.com");
      expect(callers[2]).toBe("GSC.LISLIU@cma-cgm.com");
      expect(res).toBe("SUCCESS_GSC.LISLIU@cma-cgm.com");

      // Verify VFU2 is marked ineligible, DDAI is throttled, LISLIU is clean
      expect(pool.isAgentEligible("GSC.VFU2@cma-cgm.com", CPH_DEV_AGENT)).toBe(false);
      const stDdai = pool.getPoolStatus().find((s) => s.email === "GSC.DDAI@cma-cgm.com");
      expect(stDdai?.isThrottled).toBe(true);
    });

    it("should immediately rethrow non-retriable business errors", async () => {
      let callCount = 0;
      await expect(
        pool.executeWithRelay(
          async () => {
            callCount++;
            throw new Error("TypeError: Cannot read property of undefined");
          },
          { forAgentId: CPH_DEV_AGENT }
        )
      ).rejects.toThrow("TypeError: Cannot read property of undefined");

      expect(callCount).toBe(1);
    });
  });

  describe("4. ChatHubClient Agent Unavailable Handling", () => {
    it("should trigger onAgentUnavailable callback and reject on GptAccessForbidden type 2 frame", async () => {
      let callbackFired = false;
      let reportedEmail = "";
      let reportedAgent = "";
      let reportedCode = "";
      let reportedMsg = "";

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
                // Return type 2 completion frame with GptAccessForbidden
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 2,
                    invocationId: "0",
                    result: {
                      value: "Error",
                      errorCode: "GptAccessForbidden",
                      message: "The requested agent requires administrator permissions",
                    },
                  })
                );
              }
            }
          },
        },
      });

      const client = new ChatHubClient(
        {
          email: "GSC.LISLIU@cma-cgm.com",
          accessToken: "token_mock",
          expiresAt: Date.now() + 3600000,
        },
        {
          customAgentId: CPH_DEV_AGENT,
          wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
          timeoutMs: 3000,
        }
      );

      await expect(
        client.sendMessage(
          {
            text: "Hello",
            conversationId: "conv-forbidden",
            sessionId: "sess-forbidden",
            requestId: "req-forbidden",
            isStartOfSession: true,
          },
          {
            onAgentUnavailable: (email, agentId, errorCode, message) => {
              callbackFired = true;
              reportedEmail = email;
              reportedAgent = agentId;
              reportedCode = errorCode;
              reportedMsg = message;
            },
          }
        )
      ).rejects.toThrow("[GptAccessForbidden]");

      expect(callbackFired).toBe(true);
      expect(reportedEmail).toBe("GSC.LISLIU@cma-cgm.com");
      expect(reportedAgent).toBe(CPH_DEV_AGENT);
      expect(reportedCode).toBe("GptAccessForbidden");
      expect(reportedMsg).toContain("administrator permissions");
    });

    it("should trigger onAgentUnavailable callback and reject on GptNotAvailable type 2 frame", async () => {
      let callbackFired = false;
      let reportedCode = "";

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
                // Return type 2 completion frame with GptNotAvailable
                ws.send(
                  ChatHubClient.encodeSignalR({
                    type: 2,
                    invocationId: "0",
                    result: {
                      value: "Error",
                      errorCode: "GptNotAvailable",
                      message: "Custom agent not available for current license",
                    },
                  })
                );
              }
            }
          },
        },
      });

      const client = new ChatHubClient(
        {
          email: "GSC.MLU@cma-cgm.com",
          accessToken: "token_mock",
          expiresAt: Date.now() + 3600000,
        },
        {
          customAgentId: CPH_DEV_AGENT,
          wsBaseUrl: `ws://127.0.0.1:${mockServer.port}/chathub`,
          timeoutMs: 3000,
        }
      );

      await expect(
        client.sendMessage(
          {
            text: "Hello",
            conversationId: "conv-notavailable",
            sessionId: "sess-notavailable",
            requestId: "req-notavailable",
            isStartOfSession: true,
          },
          {
            onAgentUnavailable: (email, agentId, errorCode) => {
              callbackFired = true;
              reportedCode = errorCode;
            },
          }
        )
      ).rejects.toThrow("[GptNotAvailable]");

      expect(callbackFired).toBe(true);
      expect(reportedCode).toBe("GptNotAvailable");
    });
  });
});
