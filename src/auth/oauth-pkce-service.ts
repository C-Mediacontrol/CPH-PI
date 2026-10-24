import crypto from "node:crypto";
import { TokenManager, type ActiveSessionToken } from "./token-manager.ts";

export const PKCE_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
export const PKCE_AUTHORITY = "https://login.microsoftonline.com/common";
export const PKCE_REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
export const PKCE_SCOPE = "openid profile offline_access https://substrate.office.com/sydney/.default";
export const PKCE_AUTHORIZE_URL = `${PKCE_AUTHORITY}/oauth2/v2.0/authorize`;
export const PKCE_TOKEN_URL = `${PKCE_AUTHORITY}/oauth2/v2.0/token`;
export const PKCE_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface AuthSession {
  authSessionId: string;
  authUrl: string;
  state: string;
  codeVerifier: string;
  createdAt: number;
  targetEmail?: string;
}

export interface PkceExchangeResult {
  success: boolean;
  email: string;
  expectedEmail?: string;
  emailMismatch: boolean;
  userId?: string;
  tenantId?: string;
  accessToken?: string;
}

export interface OAuthPkceServiceOptions {
  fetchFn?: typeof fetch;
  tokenEndpoint?: string;
  authorizeEndpoint?: string;
  sessionTtlMs?: number;
}

/**
 * Decode payload from standard JWT string (supporting Base64URL encoding)
 */
function decodeJwtClaims(token?: string): Record<string, any> {
  if (!token || typeof token !== "string") {
    return {};
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Extract identity claims from Azure AD tokens
 */
function extractClaims(
  accessToken: string,
  idToken?: string
): { email: string; oid: string; tid: string } {
  const accessClaims = decodeJwtClaims(accessToken);
  const idClaims = idToken ? decodeJwtClaims(idToken) : {};

  const email =
    accessClaims.unique_name ||
    accessClaims.upn ||
    accessClaims.preferred_username ||
    accessClaims.email ||
    idClaims.preferred_username ||
    idClaims.email ||
    idClaims.upn ||
    "";

  const oid = accessClaims.oid || accessClaims.sub || idClaims.oid || idClaims.sub || "";
  const tid = accessClaims.tid || idClaims.tid || "";

  return { email, oid, tid };
}

/**
 * RFC 7636 PKCE Authentication Engine for Microsoft Azure AD
 */
export class OAuthPkceService {
  private tokenManager: TokenManager;
  private sessions: Map<string, AuthSession> = new Map();
  private fetchFn: typeof fetch;
  private tokenEndpoint: string;
  private authorizeEndpoint: string;
  private sessionTtlMs: number;

  constructor(tokenManager: TokenManager, options?: OAuthPkceServiceOptions) {
    this.tokenManager = tokenManager;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
    this.tokenEndpoint = options?.tokenEndpoint || PKCE_TOKEN_URL;
    this.authorizeEndpoint = options?.authorizeEndpoint || PKCE_AUTHORIZE_URL;
    this.sessionTtlMs = options?.sessionTtlMs || PKCE_SESSION_TTL_MS;
  }

  /**
   * Start a new PKCE authentication session and construct the Microsoft authorization URL.
   */
  public startAuthSession(targetEmail?: string): {
    authSessionId: string;
    authUrl: string;
    state: string;
  } {
    this.cleanExpiredSessions();

    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("base64url");
    const authSessionId = crypto.randomUUID();

    const params = new URLSearchParams({
      client_id: PKCE_CLIENT_ID,
      response_type: "code",
      redirect_uri: PKCE_REDIRECT_URI,
      response_mode: "query",
      scope: PKCE_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });

    if (targetEmail && targetEmail.trim().length > 0) {
      params.set("login_hint", targetEmail.trim());
    }

    const authUrl = `${this.authorizeEndpoint}?${params.toString()}`;

    this.sessions.set(authSessionId, {
      authSessionId,
      authUrl,
      state,
      codeVerifier,
      createdAt: Date.now(),
      targetEmail: targetEmail?.trim(),
    });

    return { authSessionId, authUrl, state };
  }

  /**
   * Extract code and state from redirect URL, query string, or raw code.
   * Intercepts authorization errors and validates CSRF state.
   */
  public extractCodeAndState(
    redirectUrlOrCode: string,
    expectedState?: string
  ): { code: string; state?: string } {
    const trimmed = redirectUrlOrCode.trim();

    let searchString = "";
    if (trimmed.includes("?")) {
      searchString = trimmed.substring(trimmed.indexOf("?") + 1);
    } else if (trimmed.includes("#")) {
      searchString = trimmed.substring(trimmed.indexOf("#") + 1);
    } else if (trimmed.includes("=") && trimmed.includes("&")) {
      searchString = trimmed;
    } else if (trimmed.startsWith("code=") || trimmed.startsWith("error=")) {
      searchString = trimmed;
    }

    if (searchString) {
      const hashIndex = searchString.indexOf("#");
      if (hashIndex !== -1) {
        searchString = searchString.substring(0, hashIndex);
      }

      const searchParams = new URLSearchParams(searchString);
      const error = searchParams.get("error");
      if (error) {
        const errorDescription = searchParams.get("error_description");
        const detail = errorDescription ? `: ${errorDescription}` : "";
        throw new Error(`Azure AD authorization failed (${error})${detail}`);
      }

      const code = searchParams.get("code");
      const state = searchParams.get("state") || undefined;

      if (code) {
        if (expectedState && state && state !== expectedState) {
          throw new Error("State mismatch");
        }
        return { code, state };
      }
    }

    return { code: trimmed, state: undefined };
  }

  /**
   * Exchange authorization code for access and refresh tokens, decode user identity,
   * verify matching account, and persist credentials safely.
   */
  public async exchangeCode(
    authSessionId: string,
    redirectUrlOrCode: string,
    expectedEmail?: string
  ): Promise<PkceExchangeResult> {
    let session = this.sessions.get(authSessionId);
    if (!session) {
      session = Array.from(this.sessions.values()).find((s) => s.state === authSessionId);
    }
    if (!session) {
      throw new Error(`Authentication session not found or expired: ${authSessionId}`);
    }

    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(authSessionId);
      throw new Error(`Authentication session expired: ${authSessionId}`);
    }

    const { code } = this.extractCodeAndState(redirectUrlOrCode, session.state);

    const form = new URLSearchParams({
      client_id: PKCE_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: PKCE_REDIRECT_URI,
      code_verifier: session.codeVerifier,
    });

    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errDetail = errText.slice(0, 300);
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error_description || parsed.error) {
          errDetail = `${parsed.error}: ${parsed.error_description || ""}`;
        }
      } catch {}
      throw new Error(`Azure AD token exchange failed (${res.status}): ${errDetail}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new Error(`${data.error}: ${data.error_description || ""}`);
    }

    const claims = extractClaims(data.access_token, data.id_token);
    const actualEmail = claims.email || expectedEmail || session.targetEmail || "";
    const target = expectedEmail || session.targetEmail;

    const emailMismatch = Boolean(
      target &&
        actualEmail &&
        actualEmail.toLowerCase() !== target.toLowerCase()
    );

    if (data.refresh_token && actualEmail) {
      this.tokenManager.upsertAccountFromPkce(
        actualEmail,
        data.refresh_token,
        claims.oid,
        claims.tid
      );
    }

    if (data.access_token && actualEmail) {
      const accessClaims = decodeJwtClaims(data.access_token);
      const expiresAt = accessClaims.exp
        ? accessClaims.exp * 1000
        : Date.now() + (data.expires_in || 3600) * 1000;

      const activeToken: ActiveSessionToken = {
        email: actualEmail,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        expiresAt,
        oid: claims.oid,
        tid: claims.tid,
      };

      this.tokenManager.setCachedToken(actualEmail, activeToken);
    }

    this.sessions.delete(authSessionId);

    return {
      success: true,
      email: actualEmail,
      expectedEmail: target,
      emailMismatch,
      userId: claims.oid,
      tenantId: claims.tid,
      accessToken: data.access_token,
    };
  }

  /**
   * Retrieve active session by id or state if still valid
   */
  public getSession(authSessionIdOrState: string): AuthSession | undefined {
    this.cleanExpiredSessions();
    let session = this.sessions.get(authSessionIdOrState);
    if (!session) {
      session = Array.from(this.sessions.values()).find((s) => s.state === authSessionIdOrState);
    }
    if (!session) return undefined;
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(session.authSessionId);
      return undefined;
    }
    return session;
  }

  /**
   * Find first active session matching predicate
   */
  public findSession(predicate: (session: AuthSession) => boolean): AuthSession | undefined {
    this.cleanExpiredSessions();
    for (const session of this.sessions.values()) {
      if (predicate(session)) return session;
    }
    return undefined;
  }

  /**
   * Clean expired sessions based on configured TTL
   */
  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
