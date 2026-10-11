import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { encryptToken, decryptToken, deriveMasterKey, isEncryptedToken } from "../../src/auth/crypto.ts";
import { TokenManager, type StoredAccount, type ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";

describe("Auth Module & AccountPool Unit Tests", () => {
  let tempDir: string;
  let tempConfigPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-auth-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Crypto (AES-256-GCM & DPAPI Fallback)", () => {
    it("should derive deterministic master key", () => {
      const key1 = deriveMasterKey("test-master-pepper");
      const key2 = deriveMasterKey("test-master-pepper");
      expect(key1).toEqual(key2);
      expect(key1.length).toBe(32);
    });

    it("should encrypt plaintext token with enc:v1: prefix", () => {
      const plain = "m365_refresh_token_secret_12345";
      const encrypted = encryptToken(plain);
      expect(encrypted.startsWith("enc:v1:")).toBe(true);
      expect(isEncryptedToken(encrypted)).toBe(true);
      expect(encrypted).not.toBe(plain);
    });

    it("should decrypt enc:v1: ciphertext back to original plaintext", () => {
      const plain = "azure_ad_copilot_token_xyz_#987";
      const encrypted = encryptToken(plain);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(plain);
    });

    it("should be idempotent when encrypting already encrypted token", () => {
      const plain = "sample_token";
      const enc1 = encryptToken(plain);
      const enc2 = encryptToken(enc1);
      expect(enc2).toBe(enc1);
    });

    it("should return plaintext as-is when decrypting unencrypted string", () => {
      const plain = "not_encrypted_string";
      expect(decryptToken(plain)).toBe(plain);
    });

    it("should throw error when decrypting malformed base64 ciphertext", () => {
      expect(() => decryptToken("enc:v1:short")).toThrow("Ciphertext too short");
    });
  });

  describe("2. TokenManager (Validation & Storage)", () => {
    it("should validate valid accounts successfully", () => {
      const acc: StoredAccount = {
        email: "user1@contoso.com",
        refreshToken: encryptToken("valid_refresh_token"),
      };
      const res = TokenManager.validateAccount(acc);
      expect(res.valid).toBe(true);
    });

    it("should reject invalid email format", () => {
      const acc: StoredAccount = {
        email: "invalid-email",
        refreshToken: encryptToken("valid_refresh_token"),
      };
      const res = TokenManager.validateAccount(acc);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Invalid email format");
    });

    it("should reject empty refresh token", () => {
      const acc: Partial<StoredAccount> = {
        email: "user@contoso.com",
        refreshToken: "",
      };
      const res = TokenManager.validateAccount(acc as StoredAccount);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Missing refreshToken");
    });

    it("should validate cookie string formatting", () => {
      expect(TokenManager.validateCookie("M365Auth=abc; SessionId=123").valid).toBe(true);
      expect(TokenManager.validateCookie("").valid).toBe(false);
      expect(TokenManager.validateCookie("malformed_cookie_no_equals").valid).toBe(false);
    });

    it("should encrypt refresh tokens when saving accounts to disk", () => {
      const manager = new TokenManager(tempConfigPath);
      const rawAccounts: StoredAccount[] = [
        { email: "acc1@tenant.onmicrosoft.com", refreshToken: "plain_rt_1" },
        { email: "acc2@tenant.onmicrosoft.com", refreshToken: encryptToken("plain_rt_2") },
      ];
      manager.saveAccounts(rawAccounts);

      const diskRaw = JSON.parse(fs.readFileSync(tempConfigPath, "utf8"));
      expect(diskRaw.accounts.length).toBe(2);
      expect(diskRaw.accounts[0].refreshToken.startsWith("enc:v1:")).toBe(true);
      expect(diskRaw.accounts[1].refreshToken.startsWith("enc:v1:")).toBe(true);

      const loaded = manager.loadAccounts();
      expect(loaded.length).toBe(2);
      expect(decryptToken(loaded[0].refreshToken)).toBe("plain_rt_1");
    });

    it("should return cached token if not expired (>5m remaining)", async () => {
      const manager = new TokenManager(tempConfigPath);
      const fakeSession: ActiveSessionToken = {
        email: "cached@contoso.com",
        accessToken: "mock_access_token",
        refreshToken: "rt_mock",
        expiresAt: Date.now() + 600_000, // 10 minutes
        oid: "mock-oid",
        tid: "mock-tid",
      };
      manager.setCachedToken("cached@contoso.com", fakeSession);

      const token = await manager.getAccessToken("cached@contoso.com");
      expect(token.accessToken).toBe("mock_access_token");
      expect(token.oid).toBe("mock-oid");
    });

    it("should provide getActiveSessionToken accepting either account object or string email", async () => {
      const manager = new TokenManager(tempConfigPath);
      const fakeSession: ActiveSessionToken = {
        email: "cached@contoso.com",
        accessToken: "mock_access_token",
        refreshToken: "rt_mock",
        expiresAt: Date.now() + 600_000,
        oid: "mock-oid",
        tid: "mock-tid",
      };
      manager.setCachedToken("cached@contoso.com", fakeSession);

      const res1 = await manager.getActiveSessionToken({ email: "cached@contoso.com", refreshToken: "plain" });
      expect(res1.accessToken).toBe("mock_access_token");

      const res2 = await manager.getActiveSessionToken("cached@contoso.com");
      expect(res2.accessToken).toBe("mock_access_token");
    });
  });

  describe("3. AccountPool (7 Accounts Round-Robin & 429 Cooldown)", () => {
    let manager: TokenManager;
    let pool: AccountPool;
    const testAccounts: StoredAccount[] = [];

    beforeEach(() => {
      manager = new TokenManager(tempConfigPath);
      testAccounts.length = 0;
      for (let i = 1; i <= 7; i++) {
        testAccounts.push({
          email: `acc${i}@contoso.com`,
          refreshToken: encryptToken(`rt_${i}`),
        });
      }
      manager.saveAccounts(testAccounts);

      // Pre-seed cached session tokens for all 7 accounts so getAccessToken returns synchronously
      for (let i = 1; i <= 7; i++) {
        manager.setCachedToken(`acc${i}@contoso.com`, {
          email: `acc${i}@contoso.com`,
          accessToken: `token_acc_${i}`,
          refreshToken: `rt_${i}`,
          expiresAt: Date.now() + 3600_000,
          oid: `oid-${i}`,
          tid: `tid-${i}`,
        });
      }

      pool = new AccountPool(manager, { maxAccounts: 7, defaultCooldownMs: 60_000 });
    });

    it("should initialize pool with exactly 7 accounts", () => {
      const status = pool.getPoolStatus();
      expect(status.length).toBe(7);
      expect(status.every((s) => !s.isThrottled)).toBe(true);
    });

    it("should cycle through all 7 accounts in strict Round-Robin order", async () => {
      const receivedEmails: string[] = [];
      for (let i = 0; i < 14; i++) {
        const token = await pool.getNextAvailableToken();
        receivedEmails.push(token.email);
      }

      // First round 1..7
      for (let i = 1; i <= 7; i++) {
        expect(receivedEmails[i - 1]).toBe(`acc${i}@contoso.com`);
      }
      // Second round 1..7
      for (let i = 1; i <= 7; i++) {
        expect(receivedEmails[7 + i - 1]).toBe(`acc${i}@contoso.com`);
      }
    });

    it("should skip throttled accounts during round-robin", async () => {
      // Mark acc2 and acc3 throttled
      pool.markThrottled("acc2@contoso.com", 60_000);
      pool.markThrottled("acc3@contoso.com", 60_000);

      const status = pool.getPoolStatus();
      expect(status.find((s) => s.email === "acc2@contoso.com")?.isThrottled).toBe(true);
      expect(status.find((s) => s.email === "acc3@contoso.com")?.isThrottled).toBe(true);

      // Next calls should skip acc2 and acc3
      const t1 = await pool.getNextAvailableToken();
      expect(t1.email).toBe("acc1@contoso.com");

      const t2 = await pool.getNextAvailableToken();
      expect(t2.email).toBe("acc4@contoso.com");

      const t3 = await pool.getNextAvailableToken();
      expect(t3.email).toBe("acc5@contoso.com");
    });

    it("should automatically unthrottle accounts after cooldown expires", async () => {
      // Mark acc1 throttled with 10ms cooldown
      pool.markThrottled("acc1@contoso.com", 10);

      // Verify throttled
      const sBefore = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com");
      expect(sBefore?.isThrottled).toBe(true);

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 20));

      const sAfter = pool.getPoolStatus().find((s) => s.email === "acc1@contoso.com");
      expect(sAfter?.isThrottled).toBe(false);
    });

    it("should throw informative error when all 7 accounts are throttled", async () => {
      for (let i = 1; i <= 7; i++) {
        pool.markThrottled(`acc${i}@contoso.com`, 30_000);
      }

      await expect(pool.getNextAvailableToken()).rejects.toThrow(
        "All 7 accounts in the pool are currently rate-limited"
      );
    });

    it("should relay execution to next account when encountering rate limit (executeWithRelay)", async () => {
      let callCount = 0;
      const calledEmails: string[] = [];

      const result = await pool.executeWithRelay(async (token) => {
        callCount++;
        calledEmails.push(token.email);
        if (callCount === 1) {
          // Account 1 encounters 429 rate limit
          throw new Error("HTTP 429 Too Many Requests: Rate limit exceeded");
        }
        return `SUCCESS_FROM_${token.email}`;
      });

      expect(callCount).toBe(2);
      expect(calledEmails[0]).toBe("acc1@contoso.com");
      expect(calledEmails[1]).toBe("acc2@contoso.com");
      expect(result).toBe("SUCCESS_FROM_acc2@contoso.com");

      // Verify acc1 was marked throttled
      const status = pool.getPoolStatus();
      expect(status.find((s) => s.email === "acc1@contoso.com")?.isThrottled).toBe(true);
    });

    it("should immediately rethrow non-rate-limit errors without retrying", async () => {
      let callCount = 0;
      await expect(
        pool.executeWithRelay(async () => {
          callCount++;
          throw new Error("SyntaxError: Invalid JSON body");
        })
      ).rejects.toThrow("SyntaxError: Invalid JSON body");

      expect(callCount).toBe(1);
    });
  });
});

