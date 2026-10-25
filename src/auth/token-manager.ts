import fs from "fs";
import path from "path";
import os from "os";
import { decryptToken, encryptToken } from "./crypto.ts";

export interface StoredAccount {
  email: string;
  refreshToken: string; // encrypted (enc:v1:...) or plain
  tenantId?: string;
  userId?: string;
  lastRefresh?: string;
  notes?: string;
  cookies?: string;
}

export interface ActiveSessionToken {
  email: string;
  accessToken: string;
  refreshToken: string; // plain decrypted
  expiresAt: number; // Unix timestamp in ms
  oid: string;
  tid: string;
}

export interface TokenManagerOptions {
  tokenEndpoint?: string;
  fetchFn?: typeof fetch;
}

export const DEFAULT_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
export const DEFAULT_SCOPE =
  "openid profile offline_access https://substrate.office.com/sydney/.default";
export const GRAPH_SCOPE =
  "openid profile offline_access https://graph.microsoft.com/.default";
export const IC3_SCOPE =
  "openid profile offline_access https://ic3.teams.office.com/.default";
export const DEFAULT_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export class TokenManager {
  public static GRAPH_SCOPE = GRAPH_SCOPE;
  public static IC3_SCOPE = IC3_SCOPE;
  private configPath: string;
  private activeTokens: Map<string, ActiveSessionToken> = new Map();
  private graphTokens: Map<string, { token: string; expiresAt: number }> = new Map();
  private ic3Tokens: Map<string, { token: string; expiresAt: number }> = new Map();
  private tokenEndpoint: string;
  private fetchFn: typeof fetch;

  constructor(customPath?: string, options?: TokenManagerOptions) {
    if (customPath) {
      this.configPath = customPath;
    } else {
      const home = os.homedir();
      this.configPath = path.join(home, ".config", "m365-copilot2api", "accounts.json");
    }
    this.tokenEndpoint = options?.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Validate account credentials and structure
   */
  public static validateAccount(account: Partial<StoredAccount>): { valid: boolean; reason?: string } {
    if (!account.email || typeof account.email !== "string") {
      return { valid: false, reason: "Missing or invalid email" };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(account.email)) {
      return { valid: false, reason: `Invalid email format: ${account.email}` };
    }
    if (!account.refreshToken || typeof account.refreshToken !== "string") {
      return { valid: false, reason: "Missing refreshToken" };
    }
    try {
      const decrypted = decryptToken(account.refreshToken);
      if (!decrypted || decrypted.trim().length === 0) {
        return { valid: false, reason: "Decrypted refresh token is empty" };
      }
    } catch (err: any) {
      return { valid: false, reason: `Failed to decrypt refreshToken: ${err.message}` };
    }
    return { valid: true };
  }

  /**
   * Validate cookie string format
   */
  public static validateCookie(cookies?: string): { valid: boolean; reason?: string } {
    if (!cookies || typeof cookies !== "string" || cookies.trim().length === 0) {
      return { valid: false, reason: "Empty cookie string" };
    }
    // Check for standard name=value pairs separated by semicolon
    const pairs = cookies.split(";").map((p) => p.trim()).filter(Boolean);
    if (pairs.length === 0) {
      return { valid: false, reason: "No valid cookie pairs found" };
    }
    for (const pair of pairs) {
      if (!pair.includes("=")) {
        return { valid: false, reason: `Malformed cookie segment: ${pair}` };
      }
    }
    return { valid: true };
  }

  /**
   * Load all stored accounts from disk
   */
  public loadAccounts(): StoredAccount[] {
    if (!fs.existsSync(this.configPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : parsed.accounts || [];
    } catch (err) {
      console.error(`[TokenManager] Failed to read ${this.configPath}:`, err);
      return [];
    }
  }

  /**
   * Save accounts list to disk (ensures tokens are encrypted)
   */
  public saveAccounts(accounts: StoredAccount[]): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Ensure all refresh tokens are encrypted before disk write
    const sanitized = accounts.map((acc) => ({
      ...acc,
      refreshToken: acc.refreshToken.startsWith("enc:v1:")
        ? acc.refreshToken
        : encryptToken(acc.refreshToken),
    }));

    fs.writeFileSync(
      this.configPath,
      JSON.stringify({ accounts: sanitized }, null, 2),
      "utf8"
    );
  }

  /**
   * Explicitly cache an active session token (useful for test injection)
   */
  public setCachedToken(email: string, token: ActiveSessionToken): void {
    const key = email.toLowerCase();
    this.activeTokens.set(key, token);
    this.graphTokens.delete(key);
    this.ic3Tokens.delete(key);
  }

  /**
   * Upsert account credential from PKCE authentication flow.
   * Preserves existing metadata such as notes and cookies.
   */
  public upsertAccountFromPkce(
    email: string,
    refreshToken: string,
    oid?: string,
    tid?: string
  ): StoredAccount {
    const accounts = this.loadAccounts();
    const key = email.toLowerCase();
    const existing = accounts.find((a) => a.email.toLowerCase() === key);

    let updatedAccount: StoredAccount;
    if (existing) {
      existing.refreshToken = refreshToken;
      if (oid) existing.userId = oid;
      if (tid) existing.tenantId = tid;
      existing.lastRefresh = new Date().toISOString();
      updatedAccount = existing;
    } else {
      updatedAccount = {
        email,
        refreshToken,
        userId: oid,
        tenantId: tid,
        lastRefresh: new Date().toISOString(),
      };
      accounts.push(updatedAccount);
    }

    this.saveAccounts(accounts);
    this.clearCache(email);
    return updatedAccount;
  }

  /**
   * Clear active token cache
   */
  public clearCache(email?: string): void {
    if (email) {
      const key = email.toLowerCase();
      this.activeTokens.delete(key);
      this.graphTokens.delete(key);
      this.ic3Tokens.delete(key);
    } else {
      this.activeTokens.clear();
      this.graphTokens.clear();
      this.ic3Tokens.clear();
    }
  }

  /**
   * Helper to parse JWT payload (supporting base64url)
   */
  private parseJwt(token: string): any {
    const parts = token.split(".");
    if (parts.length < 2) {
      throw new Error("Invalid JWT token received from Azure AD");
    }
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  }

  /**
   * Acquire active session token for an account or email address (backward-compatible helper).
   */
  public async getActiveSessionToken(
    accountOrEmail: StoredAccount | string,
    forceRefresh = false
  ): Promise<ActiveSessionToken> {
    const email = typeof accountOrEmail === "string" ? accountOrEmail : accountOrEmail.email;
    return this.getAccessToken(email, forceRefresh);
  }

  /**
   * Refresh and return an active token for an account
   */
  public async getAccessToken(
    email: string,
    forceRefresh = false
  ): Promise<ActiveSessionToken> {
    const key = email.toLowerCase();
    const existing = this.activeTokens.get(key);
    const now = Date.now();

    // Cache valid if not forcing and > 5 mins remaining
    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing;
    }

    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }

    const validation = TokenManager.validateAccount(target);
    if (!validation.valid) {
      throw new Error(`Invalid credentials for ${email}: ${validation.reason}`);
    }

    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }

    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: DEFAULT_SCOPE,
    });

    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Azure AD token refresh failed (${res.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const payload = this.parseJwt(data.access_token);

    const activeSession: ActiveSessionToken = {
      email: target.email,
      accessToken: data.access_token,
      refreshToken: plainRt,
      expiresAt: payload.exp
        ? payload.exp * 1000
        : now + (data.expires_in || 3600) * 1000,
      oid: payload.oid || "",
      tid: payload.tid || "",
    };

    this.activeTokens.set(key, activeSession);

    // If Azure AD returned a new refresh token, persist it
    if (data.refresh_token && data.refresh_token !== plainRt) {
      target.refreshToken = encryptToken(data.refresh_token);
      target.lastRefresh = new Date().toISOString();
      this.saveAccounts(accounts);
    }

    return activeSession;
  }

  /**
   * Acquire a Microsoft Graph access token for OneDrive / document upload
   */
  public async getGraphAccessToken(
    email: string,
    forceRefresh = false
  ): Promise<string> {
    const key = email.toLowerCase();
    const existing = this.graphTokens.get(key);
    const now = Date.now();

    // Cache valid if not forcing and > 5 mins remaining
    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing.token;
    }

    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }

    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }

    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: TokenManager.GRAPH_SCOPE,
    });

    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Azure AD Graph token refresh failed (${res.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    const expiresAt = now + (data.expires_in || 3600) * 1000;
    this.graphTokens.set(key, { token: data.access_token, expiresAt });
    return data.access_token;
  }

  /**
   * Cache a graph token (useful for mocking/testing)
   */
  public setCachedGraphToken(email: string, token: string, expiresAt?: number): void {
    this.graphTokens.set(email.toLowerCase(), {
      token,
      expiresAt: expiresAt ?? Date.now() + 3600_000,
    });
  }

  /**
   * Acquire an IC3 Teams asyncgw access token for downloading generated files.
   */
  public async getIc3AccessToken(email: string, forceRefresh = false): Promise<string> {
    const key = email.toLowerCase();
    const existing = this.ic3Tokens.get(key);
    const now = Date.now();

    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing.token;
    }

    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }

    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }

    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: TokenManager.IC3_SCOPE,
    });

    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Azure AD IC3 token refresh failed (${res.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    const expiresAt = now + (data.expires_in || 3600) * 1000;
    this.ic3Tokens.set(key, { token: data.access_token, expiresAt });
    return data.access_token;
  }

  /**
   * Cache an IC3 token (useful for mocking/testing).
   */
  public setCachedIc3Token(email: string, token: string, expiresAt?: number): void {
    this.ic3Tokens.set(email.toLowerCase(), {
      token,
      expiresAt: expiresAt ?? Date.now() + 3600_000,
    });
  }
}

