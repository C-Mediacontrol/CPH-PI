import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TokenManager, IC3_SCOPE } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { encryptToken } from "../../src/auth/crypto.ts";

describe("TokenManager & AccountPool IC3 Token Acquisition", () => {
  test("requests IC3_SCOPE without Origin header and caches token per account", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ic3-test-"));
    const configPath = path.join(tmpDir, "accounts.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        accounts: [
          { email: "user1@example.com", refreshToken: encryptToken("rt_user1") },
          { email: "user2@example.com", refreshToken: encryptToken("rt_user2") },
        ],
      }),
      "utf8"
    );

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      const bodyStr = String(init?.body || "");
      const isUser2 = bodyStr.includes("rt_user2");
      return new Response(
        JSON.stringify({
          access_token: isUser2 ? "ic3_tok_user2" : "ic3_tok_user1",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const tm = new TokenManager(configPath, { fetchFn: mockFetch });
    const pool = new AccountPool(tm);

    expect(IC3_SCOPE).toBe("openid profile offline_access https://ic3.teams.office.com/.default");

    const tok1 = await pool.getIc3AccessToken("user2@example.com");
    expect(tok1).toBe("ic3_tok_user2");
    expect(calls.length).toBe(1);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Origin"]).toBeUndefined();
    expect(String(calls[0].init.body)).toContain(encodeURIComponent("https://ic3.teams.office.com/.default"));

    // Cached on second call
    const tok1Cached = await pool.getIc3AccessToken("user2@example.com");
    expect(tok1Cached).toBe("ic3_tok_user2");
    expect(calls.length).toBe(1);

    // Fallback when no email passed
    const tokDefault = await pool.getIc3AccessToken();
    expect(tokDefault).toBe("ic3_tok_user1");
    expect(calls.length).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("setCachedIc3Token and clearCache operate as expected", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ic3-test-"));
    const configPath = path.join(tmpDir, "accounts.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        accounts: [
          { email: "user1@example.com", refreshToken: encryptToken("rt_user1") },
        ],
      }),
      "utf8"
    );

    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          access_token: "fetched_ic3_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const tm = new TokenManager(configPath, { fetchFn: mockFetch });
    tm.setCachedIc3Token("user1@example.com", "pre_cached_token");

    const cached = await tm.getIc3AccessToken("user1@example.com");
    expect(cached).toBe("pre_cached_token");
    expect(fetchCount).toBe(0);

    // clearCache specific email
    tm.clearCache("user1@example.com");
    const reFetched = await tm.getIc3AccessToken("user1@example.com");
    expect(reFetched).toBe("fetched_ic3_token");
    expect(fetchCount).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("AccountPool falls through to healthy pool accounts if specified email fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ic3-test-"));
    const configPath = path.join(tmpDir, "accounts.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        accounts: [
          { email: "user1@example.com", refreshToken: encryptToken("rt_user1") },
          { email: "user2@example.com", refreshToken: encryptToken("rt_user2") },
        ],
      }),
      "utf8"
    );

    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyStr = String(init?.body || "");
      if (bodyStr.includes("rt_user2")) {
        return new Response("Invalid grant", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          access_token: "ic3_user1_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const tm = new TokenManager(configPath, { fetchFn: mockFetch });
    const pool = new AccountPool(tm);

    // user2 fails, should fallback to user1
    const token = await pool.getIc3AccessToken("user2@example.com");
    expect(token).toBe("ic3_user1_token");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
