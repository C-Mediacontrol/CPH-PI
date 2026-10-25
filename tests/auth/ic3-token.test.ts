import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TokenManager, IC3_SCOPE, type StoredAccount } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";

describe("IC3 token acquisition", () => {
  let tempDir: string;
  let configPath: string;
  let manager: TokenManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ic3-test-"));
    configPath = path.join(tempDir, "accounts.json");
    manager = new TokenManager(configPath);
    const accounts: StoredAccount[] = [{ email: "alpha@contoso.com", refreshToken: "rt_alpha" }];
    manager.saveAccounts(accounts);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("returns a cached IC3 token without network calls", async () => {
    manager.setCachedIc3Token("alpha@contoso.com", "cached_ic3", Date.now() + 600_000);
    expect(await manager.getIc3AccessToken("alpha@contoso.com")).toBe("cached_ic3");
  });

  it("refreshes with the IC3 scope and caches the result", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body || ""));
      return new Response(
        JSON.stringify({ access_token: "ic3_access", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;

    const tokenManager = new TokenManager(configPath, {
      tokenEndpoint: "https://login.example.test/token",
      fetchFn,
    });

    const token = await tokenManager.getIc3AccessToken("alpha@contoso.com");
    expect(token).toBe("ic3_access");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("scope=");
    expect(decodeURIComponent(bodies[0]).replace(/\+/g, " ")).toContain(IC3_SCOPE);

    // Second call must be served from cache.
    const second = await tokenManager.getIc3AccessToken("alpha@contoso.com");
    expect(second).toBe("ic3_access");
    expect(bodies).toHaveLength(1);
  });

  it("AccountPool returns the IC3 token for a specified account", async () => {
    manager.setCachedIc3Token("alpha@contoso.com", "pool_ic3", Date.now() + 600_000);
    const pool = new AccountPool(manager, { maxAccounts: 1, defaultCooldownMs: 60_000 });
    expect(await pool.getIc3AccessToken("alpha@contoso.com")).toBe("pool_ic3");
  });

  it("does not silently borrow another account's IC3 token", async () => {
    const failingManager = new TokenManager(configPath, {
      tokenEndpoint: "https://login.example.test/token",
      fetchFn: (async () => new Response("nope", { status: 400 })) as any,
    });
    failingManager.saveAccounts([
      { email: "alpha@contoso.com", refreshToken: "rt_alpha" },
      { email: "beta@contoso.com", refreshToken: "rt_beta" },
    ]);
    failingManager.setCachedIc3Token("beta@contoso.com", "beta_token", Date.now() + 600_000);

    const pool = new AccountPool(failingManager, {
      maxAccounts: 2,
      defaultCooldownMs: 60_000,
    });

    await expect(pool.getIc3AccessToken("alpha@contoso.com")).rejects.toThrow(
      /IC3 token refresh failed|failed/i
    );
  });
});
