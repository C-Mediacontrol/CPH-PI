import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { OAuthPkceService } from "../../src/auth/oauth-pkce-service.ts";
import { TokenManager } from "../../src/auth/token-manager.ts";

function createMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.mock_signature`;
}

describe("OAuthPkceService RFC 7636 Unit Tests", () => {
  let tempDir: string;
  let tempAccountsPath: string;
  let tokenManager: TokenManager;
  let pkceService: OAuthPkceService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pkce-test-"));
    tempAccountsPath = path.join(tempDir, "accounts.json");
    tokenManager = new TokenManager(tempAccountsPath);
    tokenManager.saveAccounts([
      {
        email: "target@contoso.com",
        refreshToken: "old_rt_123",
        notes: "vip-account",
        cookies: "session=abc; domain=.contoso.com",
      },
    ]);
    pkceService = new OAuthPkceService(tokenManager);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should generate valid PKCE session with response_mode=query and login_hint", () => {
    const session = pkceService.startAuthSession("target@contoso.com");
    expect(session.authSessionId).toBeDefined();
    expect(session.authUrl).toContain("login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(session.authUrl).toContain("client_id=c0ab8ce9-e9a0-42e7-b064-33d422df41f1");
    expect(session.authUrl).toContain("response_type=code");
    expect(session.authUrl).toContain("response_mode=query");
    expect(session.authUrl).toContain("code_challenge_method=S256");
    expect(session.authUrl).toContain("login_hint=target%40contoso.com");
    expect(session.state).toBeDefined();
    expect(session.state.length).toBeGreaterThan(10);
  });

  it("should generate PKCE session without login_hint when targetEmail is omitted", () => {
    const session = pkceService.startAuthSession();
    expect(session.authSessionId).toBeDefined();
    expect(session.authUrl).not.toContain("login_hint");
  });

  it("should extract error and error_description from redirect URL", () => {
    const errorUrl =
      "https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied&error_description=User+declined";
    expect(() => pkceService.extractCodeAndState(errorUrl)).toThrow(
      "Azure AD authorization failed (access_denied): User declined"
    );
  });

  it("should extract code and validate state CSRF safely across full URL, query string, and raw code", () => {
    const session = pkceService.startAuthSession();
    const state = session.state;

    // Full URL
    const fullUrl = `https://login.microsoftonline.com/common/oauth2/nativeclient?code=code_123&state=${state}`;
    expect(pkceService.extractCodeAndState(fullUrl, state)).toEqual({ code: "code_123", state });

    // Query string only
    const queryOnly = `?code=code_456&state=${state}`;
    expect(pkceService.extractCodeAndState(queryOnly, state)).toEqual({ code: "code_456", state });

    // Raw code
    const rawCode = "raw_code_789";
    expect(pkceService.extractCodeAndState(rawCode)).toEqual({ code: "raw_code_789", state: undefined });

    // State mismatch
    expect(() => pkceService.extractCodeAndState(fullUrl, "different_state")).toThrow("State mismatch");
  });

  it("should successfully exchange code, decode claims, and update tokenManager preserving notes and cookies", async () => {
    const session = pkceService.startAuthSession("target@contoso.com");
    const mockAccessToken = createMockJwt({
      unique_name: "target@contoso.com",
      oid: "oid-111",
      tid: "tid-222",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const mockIdToken = createMockJwt({
      preferred_username: "target@contoso.com",
      sub: "oid-111",
      tid: "tid-222",
    });

    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          access_token: mockAccessToken,
          refresh_token: "new_rt_777",
          id_token: mockIdToken,
          token_type: "Bearer",
          scope: "openid profile offline_access",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const customPkceService = new OAuthPkceService(tokenManager, { fetchFn: mockFetch });
    const customSession = customPkceService.startAuthSession("target@contoso.com");

    const result = await customPkceService.exchangeCode(
      customSession.authSessionId,
      `https://login.microsoftonline.com/common/oauth2/nativeclient?code=auth_code_xyz&state=${customSession.state}`,
      "target@contoso.com"
    );

    expect(result.success).toBe(true);
    expect(result.email).toBe("target@contoso.com");
    expect(result.emailMismatch).toBe(false);
    expect(result.userId).toBe("oid-111");
    expect(result.tenantId).toBe("tid-222");

    // Verify stored account preserved notes and cookies
    const accounts = tokenManager.loadAccounts();
    const stored = accounts.find((a) => a.email.toLowerCase() === "target@contoso.com");
    expect(stored).toBeDefined();
    expect(stored?.notes).toBe("vip-account");
    expect(stored?.cookies).toBe("session=abc; domain=.contoso.com");
    expect(stored?.userId).toBe("oid-111");
    expect(stored?.tenantId).toBe("tid-222");
  });

  it("should detect email mismatch, return emailMismatch: true, and persist the actual account", async () => {
    const mockAccessToken = createMockJwt({
      preferred_username: "actual-user@contoso.com",
      oid: "oid-999",
      tid: "tid-888",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          access_token: mockAccessToken,
          refresh_token: "actual_rt_999",
          token_type: "Bearer",
          scope: "openid profile offline_access",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const customPkceService = new OAuthPkceService(tokenManager, { fetchFn: mockFetch });
    const session = customPkceService.startAuthSession("target@contoso.com");

    const result = await customPkceService.exchangeCode(
      session.authSessionId,
      `code=auth_code_mismatch&state=${session.state}`,
      "target@contoso.com"
    );

    expect(result.success).toBe(true);
    expect(result.email).toBe("actual-user@contoso.com");
    expect(result.expectedEmail).toBe("target@contoso.com");
    expect(result.emailMismatch).toBe(true);
    expect(result.userId).toBe("oid-999");
    expect(result.tenantId).toBe("tid-888");

    // Check that actual account is persisted
    const accounts = tokenManager.loadAccounts();
    const actual = accounts.find((a) => a.email.toLowerCase() === "actual-user@contoso.com");
    expect(actual).toBeDefined();
    expect(actual?.userId).toBe("oid-999");
  });

  it("should throw informative error on Azure AD failure", async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "AADSTS70008: The provided authorization code is invalid or expired.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const customPkceService = new OAuthPkceService(tokenManager, { fetchFn: mockFetch });
    const session = customPkceService.startAuthSession();

    await expect(
      customPkceService.exchangeCode(session.authSessionId, `code=expired_code&state=${session.state}`)
    ).rejects.toThrow("invalid_grant");
  });

  it("should clear graphTokens cache when setCachedToken is invoked", () => {
    tokenManager.setCachedGraphToken("target@contoso.com", "mock_graph_token");
    expect((tokenManager as any).graphTokens.has("target@contoso.com")).toBe(true);

    tokenManager.setCachedToken("target@contoso.com", {
      email: "target@contoso.com",
      accessToken: "token_123",
      refreshToken: "rt_123",
      expiresAt: Date.now() + 3600_000,
      oid: "oid-1",
      tid: "tid-1",
    });

    expect((tokenManager as any).graphTokens.has("target@contoso.com")).toBe(false);
  });

  it("should create new account via upsertAccountFromPkce if it did not exist", () => {
    tokenManager.upsertAccountFromPkce("brandnew@contoso.com", "new_rt_000", "new-oid", "new-tid");
    const accounts = tokenManager.loadAccounts();
    const created = accounts.find((a) => a.email.toLowerCase() === "brandnew@contoso.com");
    expect(created).toBeDefined();
    expect(created?.userId).toBe("new-oid");
    expect(created?.tenantId).toBe("new-tid");
  });
});
