import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { TokenManager, type ActiveSessionToken } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { encryptToken } from "../../src/auth/crypto.ts";

describe("AccountPool Concurrency Lease & Non-blocking Isolation (CR-2)", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let manager: TokenManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pool-lease-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");
    manager = new TokenManager(tempConfigPath);

    const accounts = [
      { email: "worker-acc1@contoso.com", refreshToken: encryptToken("rt_1") },
      { email: "worker-acc2@contoso.com", refreshToken: encryptToken("rt_2") },
      { email: "worker-acc3@contoso.com", refreshToken: encryptToken("rt_3") },
    ];
    manager.saveAccounts(accounts);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should distribute 3 distinct accounts to 3 concurrent workers during asynchronous token retrieval", async () => {
    // Simulate async token fetch with small I/O delay
    manager.getAccessToken = async (email: string): Promise<ActiveSessionToken> => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        email,
        accessToken: `at_${email}`,
        refreshToken: `rt_${email}`,
        expiresAt: Date.now() + 3600_000,
        oid: "oid",
        tid: "tid",
      };
    };

    const pool = new AccountPool(manager, { maxAccounts: 3 });

    // 3 concurrent workers call getNextAvailableToken at the same time
    const [t1, t2, t3] = await Promise.all([
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
    ]);

    const allocatedEmails = [t1.email, t2.email, t3.email];
    const uniqueEmails = new Set(allocatedEmails);

    // Assert that concurrency lease prevents workers from colliding on the same account
    expect(uniqueEmails.size).toBe(3);
    expect(uniqueEmails.has("worker-acc1@contoso.com")).toBe(true);
    expect(uniqueEmails.has("worker-acc2@contoso.com")).toBe(true);
    expect(uniqueEmails.has("worker-acc3@contoso.com")).toBe(true);
  });

  it("should release in-flight lease properly so accounts can be reused subsequently", async () => {
    let callCounter = 0;
    manager.getAccessToken = async (email: string): Promise<ActiveSessionToken> => {
      callCounter++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        email,
        accessToken: `at_${email}`,
        refreshToken: `rt_${email}`,
        expiresAt: Date.now() + 3600_000,
        oid: "oid",
        tid: "tid",
      };
    };

    const pool = new AccountPool(manager, { maxAccounts: 3 });

    // Round 1: 3 concurrent calls
    const round1 = await Promise.all([
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
    ]);
    expect(new Set(round1.map((t) => t.email)).size).toBe(3);

    // Round 2: 3 concurrent calls after leases released
    const round2 = await Promise.all([
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
    ]);
    expect(new Set(round2.map((t) => t.email)).size).toBe(3);
    expect(callCounter).toBe(6);
  });

  it("should release in-flight lease even if getAccessToken throws an error", async () => {
    let failFirstTime = true;
    manager.getAccessToken = async (email: string): Promise<ActiveSessionToken> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (email === "worker-acc1@contoso.com" && failFirstTime) {
        failFirstTime = false;
        throw new Error("Network transient failure on acc1");
      }
      return {
        email,
        accessToken: `at_${email}`,
        refreshToken: `rt_${email}`,
        expiresAt: Date.now() + 3600_000,
        oid: "oid",
        tid: "tid",
      };
    };

    const pool = new AccountPool(manager, { maxAccounts: 3 });

    // When worker-acc1 fails, getNextAvailableToken should catch, throttle acc1,
    // release lease in finally, and proceed to next account
    const token = await pool.getNextAvailableToken();
    expect(token.email).toBe("worker-acc2@contoso.com");

    const status1 = pool.getPoolStatus().find((s) => s.email === "worker-acc1@contoso.com");
    expect(status1?.isThrottled).toBe(true);
  });
});
