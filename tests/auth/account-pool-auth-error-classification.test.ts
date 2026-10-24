import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { encryptToken } from "../../src/auth/crypto.ts";
import { TokenManager, type StoredAccount, type ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { AccountPool, type AccountStatus } from "../../src/auth/account-pool.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("AccountPool Auth Error Classification & Health Hard Gate (Task 2)", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let manager: TokenManager;
  let pool: AccountPool;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-auth-gate-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");
    manager = new TokenManager(tempConfigPath);

    const testAccounts: StoredAccount[] = [
      { email: "acc1@contoso.com", refreshToken: encryptToken("rt_1") },
      { email: "acc2@contoso.com", refreshToken: encryptToken("rt_2") },
      { email: "acc3@contoso.com", refreshToken: encryptToken("rt_3") },
    ];
    manager.saveAccounts(testAccounts);

    for (let i = 1; i <= 3; i++) {
      manager.setCachedToken(`acc${i}@contoso.com`, {
        email: `acc${i}@contoso.com`,
        accessToken: `at_${i}`,
        refreshToken: `rt_${i}`,
        expiresAt: Date.now() + 3600_000,
        oid: `oid-${i}`,
        tid: `tid-${i}`,
      });
    }

    pool = new AccountPool(manager, { maxAccounts: 3, defaultCooldownMs: 60_000 });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. isFatalAuthGrantError Classification", () => {
    it("should classify invalid_grant and interaction_required as fatal auth grant errors", () => {
      expect(AccountPool.isFatalAuthGrantError(new Error("AADSTS70000: The provided value for the input parameter 'refresh_token' is invalid. (invalid_grant)"))).toBe(true);
      expect(AccountPool.isFatalAuthGrantError(new Error("error: interaction_required - User interaction is required."))).toBe(true);
      expect(AccountPool.isFatalAuthGrantError("INVALID_GRANT: Token expired or revoked")).toBe(true);
      expect(pool.isFatalAuthGrantError({ message: "Interaction_Required: MFA challenge pending" })).toBe(true);
    });

    it("should classify Azure AD interactive re-auth error codes as fatal", () => {
      const fatalAadCodes = [
        "AADSTS700082: The refresh token has expired due to inactivity.",
        "AADSTS70008: The refresh token has expired.",
        "AADSTS50173: The provided grant has expired or was revoked.",
        "AADSTS50076: Due to a configuration change made by your administrator, or because you moved to a new location, you must use multi-factor authentication.",
        "AADSTS50079: Due to a configuration change made by your administrator, you must enroll in multi-factor authentication.",
        "AADSTS50058: A silent sign-in request was sent but no user is signed in.",
        "AADSTS70000: Transmission error or invalid grant parameter.",
      ];

      for (const msg of fatalAadCodes) {
        expect(AccountPool.isFatalAuthGrantError(new Error(msg))).toBe(true);
        expect(pool.isFatalAuthGrantError(msg)).toBe(true);
      }
    });

    it("should NOT classify transient 429 rate limit or network errors as fatal auth errors", () => {
      const nonFatalErrors = [
        new Error("429 Too Many Requests"),
        new Error("Rate limit exceeded for user"),
        new Error("socket hang up"),
        new Error("fetch failed: ECONNRESET"),
        new Error("Daily message quota exceeded for today"),
        "Unknown network failure",
      ];

      for (const err of nonFatalErrors) {
        expect(AccountPool.isFatalAuthGrantError(err)).toBe(false);
        expect(pool.isFatalAuthGrantError(err)).toBe(false);
      }
    });
  });

  describe("2. markAuthExpired State Transition & Lease Eviction", () => {
    it("should transition account to authExpired: true and clear throttled cooldown counters", () => {
      // First throttle acc1 to verify markAuthExpired clears cooldown counters
      pool.markThrottled("acc1@contoso.com", 60_000, "burst");
      let st = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")!;
      expect(st.isThrottled).toBe(true);
      expect(st.cooldownUntil).toBeGreaterThan(0);

      // Now mark auth expired
      pool.markAuthExpired("acc1@contoso.com", "AADSTS700082: Refresh token expired");

      st = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")!;
      expect(st.authExpired).toBe(true);
      expect(st.authErrorReason).toContain("AADSTS700082");
      expect(st.isAvailable).toBe(false);
      expect(st.isThrottled).toBe(false);
      expect(st.cooldownUntil).toBe(0);
      expect(st.throttleReason).toBe("auth_error");
    });

    it("should evict active session leases held by the expired account", async () => {
      // Session 1 leases acc1
      const token = await pool.acquireSessionLease("sess-abc-123");
      expect(token.email).toBe("acc1@contoso.com");
      expect(pool.getSessionLease("sess-abc-123")).toBe("acc1@contoso.com");

      // Mark acc1 auth expired
      pool.markAuthExpired("acc1@contoso.com", "invalid_grant");

      // Session lease must be immediately evicted
      expect(pool.getSessionLease("sess-abc-123")).toBeUndefined();
    });
  });

  describe("3. Hard Gate Entrance Controls (F1 Anti-Spin Hard Gate)", () => {
    it("getAvailableCapacity should filter out authExpired and unavailable accounts", () => {
      expect(pool.getAvailableCapacity()).toBe(3);

      pool.markAuthExpired("acc1@contoso.com", "AADSTS50173");
      expect(pool.getAvailableCapacity()).toBe(2);

      pool.markThrottled("acc2@contoso.com", 60_000);
      expect(pool.getAvailableCapacity()).toBe(1);

      pool.markAuthExpired("acc3@contoso.com", "invalid_grant");
      expect(pool.getAvailableCapacity()).toBe(0);
    });

    it("getNextAvailableToken should 100% bypass authExpired accounts without retrying them", async () => {
      pool.markAuthExpired("acc1@contoso.com", "AADSTS700082");

      // Next calls should skip acc1 completely and rotate acc2, acc3, acc2, acc3...
      const t1 = await pool.getNextAvailableToken();
      expect(t1.email).toBe("acc2@contoso.com");

      const t2 = await pool.getNextAvailableToken();
      expect(t2.email).toBe("acc3@contoso.com");

      const t3 = await pool.getNextAvailableToken();
      expect(t3.email).toBe("acc2@contoso.com");
    });

    it("acquireSessionLease should skip authExpired accounts and evict invalid existing leases", async () => {
      // Lease acc1
      await pool.acquireSessionLease("sess-1");
      expect(pool.getSessionLease("sess-1")).toBe("acc1@contoso.com");

      // Invalidate acc1
      pool.markAuthExpired("acc1@contoso.com", "AADSTS50173");

      // Re-acquiring with same sessionId should not return acc1, but rotate to next healthy account (acc2)
      const token2 = await pool.acquireSessionLease("sess-1");
      expect(token2.email).toBe("acc2@contoso.com");
      expect(pool.getSessionLease("sess-1")).toBe("acc2@contoso.com");
    });

    it("should accurately classify fatal auth error during getAccessToken inside getNextAvailableToken", async () => {
      // Force manager.getAccessToken to throw fatal error for acc1
      const originalGetAccessToken = manager.getAccessToken.bind(manager);
      manager.getAccessToken = async (email: string) => {
        if (email === "acc1@contoso.com") {
          throw new Error("AADSTS700082: The refresh token has expired due to inactivity.");
        }
        return originalGetAccessToken(email);
      };

      // Calling getNextAvailableToken: acc1 encounters fatal error, should be marked authExpired, and automatically fallback to acc2
      const token = await pool.getNextAvailableToken();
      expect(token.email).toBe("acc2@contoso.com");

      const st1 = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")!;
      expect(st1.authExpired).toBe(true);
      expect(st1.isThrottled).toBe(false);
      expect(st1.cooldownUntil).toBe(0);
    });

    it("getGraphAccessToken should bypass authExpired and throttled accounts to pick healthy one", async () => {
      pool.markAuthExpired("acc1@contoso.com", "invalid_grant");
      pool.markThrottled("acc2@contoso.com", 60_000);

      // Should automatically pick acc3
      const mockGraphToken = "graph_token_for_acc3";
      manager.getGraphAccessToken = async (email: string) => {
        if (email === "acc3@contoso.com") return mockGraphToken;
        throw new Error(`Unexpected call for ${email}`);
      };

      const token = await pool.getGraphAccessToken();
      expect(token).toBe(mockGraphToken);
    });
  });

  describe("4. resetCooldown (F6 Web RPC Fix)", () => {
    it("should return false when trying to reset cooldown for an authExpired account (defense against accidental unthrottle)", () => {
      pool.markAuthExpired("acc1@contoso.com", "invalid_grant");

      const success = pool.resetCooldown("acc1@contoso.com");
      expect(success).toBe(false);

      const st = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")!;
      expect(st.authExpired).toBe(true);
      expect(st.isAvailable).toBe(false);
    });

    it("should return true and successfully unthrottle an account when in normal 429 cooldown", () => {
      pool.markThrottled("acc2@contoso.com", 120_000, "burst");
      let st = pool.getPoolStatus().find((s) => s.email === "acc2@contoso.com")!;
      expect(st.isThrottled).toBe(true);

      const success = pool.resetCooldown("acc2@contoso.com");
      expect(success).toBe(true);

      st = pool.getPoolStatus().find((s) => s.email === "acc2@contoso.com")!;
      expect(st.isThrottled).toBe(false);
      expect(st.cooldownUntil).toBe(0);
    });

    it("should return false for unknown account", () => {
      expect(pool.resetCooldown("unknown@contoso.com")).toBe(false);
    });
  });

  describe("5. PKCE Integration on AccountPool", () => {
    it("startPkceAuth should delegate to OAuthPkceService and return session details", () => {
      const session = pool.startPkceAuth("acc1@contoso.com");
      expect(session.authSessionId).toBeDefined();
      expect(session.authUrl).toContain("login.microsoftonline.com");
      expect(session.authUrl).toContain("login_hint=acc1%40contoso.com");
      expect(session.state).toBeDefined();
    });

    it("completePkceAuth should clear authExpired, restore isAvailable, and detect email mismatch", async () => {
      // Mark acc1 as expired
      pool.markAuthExpired("acc1@contoso.com", "invalid_grant");
      expect(pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")?.authExpired).toBe(true);

      // Start auth session for acc1
      const session = pool.startPkceAuth("acc1@contoso.com");

      // Mock pkce service exchangeCode
      const pkceService = pool.getPkceService();
      pkceService.exchangeCode = async (sessionId, redirectUrl, expectedEmail) => {
        return {
          success: true,
          email: "acc1@contoso.com",
          expectedEmail: "acc1@contoso.com",
          emailMismatch: false,
          accessToken: "new_at_1",
          userId: "oid-1",
          tenantId: "tid-1",
        };
      };

      const result = await pool.completePkceAuth(
        `https://login.microsoftonline.com/common/oauth2/nativeclient?code=code_123&state=${session.state}`,
        session.state,
        "acc1@contoso.com"
      );

      expect(result.success).toBe(true);
      expect(result.emailMismatch).toBe(false);

      const st = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com")!;
      expect(st.authExpired).toBe(false);
      expect(st.authErrorReason).toBeUndefined();
      expect(st.isAvailable).toBe(true);
      expect(st.isThrottled).toBe(false);
    });
  });

  describe("6. SubagentRunner active account filtering", () => {
    it("should filter out authExpired accounts when calculating activeAllowedAccounts", async () => {
      pool.markAuthExpired("acc1@contoso.com", "invalid_grant");
      pool.markThrottled("acc2@contoso.com", 60_000);

      // Only acc3 is active, unthrottled, and not authExpired
      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "test-main-session",
        pool,
        createOrchestratorFn: () => ({
          run: async () => ({
            finalAnswer: "ok",
            turnsCount: 1,
            completed: true,
            history: [],
          }),
        }),
      });

      const reports = await runner.executeBatch([
        { role: "researcher", description: "task 1", prompt: "task 1" },
      ]);
      expect(reports.length).toBe(1);
    });
  });
});
