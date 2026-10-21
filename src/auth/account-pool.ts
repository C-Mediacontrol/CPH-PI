import { TokenManager } from "./token-manager.ts";
import type { ActiveSessionToken, StoredAccount } from "./token-manager.ts";
import { ChatHubClient } from "../transport/chathub-client.ts";

export interface AccountStatus {
  email: string;
  isAvailable: boolean;
  isThrottled: boolean;
  isAllowed: boolean;
  isLeased?: boolean;
  leasedBy?: string;
  cooldownUntil: number; // timestamp in ms
  lastUsedAt: number;
  totalRequests: number;
  throttledCount: number;
  ineligibleAgents?: string[];
  throttleReason?: "daily" | "burst" | "agent_ineligible";
  consecutiveFailures?: number;
}

/**
 * Calculates the timestamp of 00:00:00.000 UTC of the next day,
 * ensuring the resulting timestamp is at least Date.now() + floorMs.
 */
export function getNextUtcMidnight(floorMs = 15 * 60 * 1000): number {
  const now = Date.now();
  const minTarget = now + floorMs;
  const d = new Date(now);
  let midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  while (midnight < minTarget) {
    midnight += 24 * 60 * 60 * 1000;
  }
  return midnight;
}

export interface AccountPoolOptions {
  maxAccounts?: number;
  defaultCooldownMs?: number;
  allowedAccounts?: string[];
}

export interface GetTokenOptions {
  forAgentId?: string;
  sessionId?: string;
}

export interface RelayOptions {
  forAgentId?: string;
  maxAttempts?: number;
}

export class AccountPool {
  private manager: TokenManager;
  private statuses: Map<string, AccountStatus> = new Map();
  private ineligibleAgents: Map<string, Set<string>> = new Map();
  private allowedAccounts?: Set<string>;
  private originalAllowedCase: Map<string, string> = new Map();
  private inFlightLeases: Set<string> = new Set();
  private sessionLeases: Map<string, string> = new Map(); // sessionId -> lowercase email
  private currentIndex = 0;
  private maxAccounts: number;
  private defaultCooldownMs: number;

  constructor(manager?: TokenManager, options?: AccountPoolOptions) {
    this.manager = manager || new TokenManager();
    this.maxAccounts = options?.maxAccounts ?? 7;
    this.defaultCooldownMs = options?.defaultCooldownMs ?? 180_000; // 3 minutes
    if (options?.allowedAccounts) {
      this.setAllowedAccounts(options.allowedAccounts);
    }
    this.refreshAccountList();
  }

  public getManager(): TokenManager {
    return this.manager;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Set whitelist of allowed accounts (empty or null resets to allow all)
   */
  public setAllowedAccounts(emails?: string[] | null): void {
    if (emails && emails.length > 0) {
      this.allowedAccounts = new Set();
      this.originalAllowedCase.clear();
      for (const e of emails) {
        const trimmed = e.trim();
        if (trimmed) {
          const lower = trimmed.toLowerCase();
          this.allowedAccounts.add(lower);
          this.originalAllowedCase.set(lower, trimmed);
        }
      }
    } else {
      this.allowedAccounts = undefined;
      this.originalAllowedCase.clear();
    }
    this.refreshAccountList();
  }

  /**
   * Get whitelist of allowed accounts
   */
  public getAllowedAccounts(): string[] | undefined {
    if (!this.allowedAccounts) return undefined;
    return Array.from(this.allowedAccounts).map(
      (lower) => this.originalAllowedCase.get(lower) || lower
    );
  }

  /**
   * Check if account is allowed for active use
   */
  public isAccountAllowed(email: string): boolean {
    if (!this.allowedAccounts || this.allowedAccounts.size === 0) return true;
    return this.allowedAccounts.has(email.trim().toLowerCase());
  }

  /**
   * Dynamically enable an account
   */
  public enableAccount(email: string): void {
    const trimmed = email.trim();
    const lower = trimmed.toLowerCase();
    if (!this.allowedAccounts) {
      const all = this.manager.loadAccounts();
      this.allowedAccounts = new Set();
      this.originalAllowedCase.clear();
      for (const a of all) {
        const l = a.email.toLowerCase();
        this.allowedAccounts.add(l);
        this.originalAllowedCase.set(l, a.email);
      }
    }
    this.allowedAccounts.add(lower);
    this.originalAllowedCase.set(lower, trimmed);
    this.refreshAccountList();
  }

  /**
   * Dynamically disable an account (default skip)
   */
  public disableAccount(email: string): void {
    const trimmed = email.trim();
    const lower = trimmed.toLowerCase();
    if (!this.allowedAccounts) {
      const all = this.manager.loadAccounts();
      this.allowedAccounts = new Set();
      this.originalAllowedCase.clear();
      for (const a of all) {
        const l = a.email.toLowerCase();
        this.allowedAccounts.add(l);
        this.originalAllowedCase.set(l, a.email);
      }
    }
    this.allowedAccounts.delete(lower);
    this.originalAllowedCase.delete(lower);
    this.refreshAccountList();
  }

  /**
   * Sync accounts list from TokenManager (capped at maxAccounts, or filtered by allowedAccounts)
   */
  public refreshAccountList(): StoredAccount[] {
    const rawAccounts = this.manager.loadAccounts();
    const hasAllowedFilter = this.allowedAccounts && this.allowedAccounts.size > 0;
    const targetAccounts = hasAllowedFilter
      ? rawAccounts.filter((acc) => this.isAccountAllowed(acc.email))
      : rawAccounts.slice(0, this.maxAccounts);

    for (const acc of rawAccounts) {
      const key = acc.email.toLowerCase();
      const isAllowed = this.isAccountAllowed(acc.email);
      if (!this.statuses.has(key)) {
        this.statuses.set(key, {
          email: acc.email,
          isAvailable: true,
          isThrottled: false,
          isAllowed,
          cooldownUntil: 0,
          lastUsedAt: 0,
          totalRequests: 0,
          throttledCount: 0,
          throttleReason: undefined,
          consecutiveFailures: 0,
        });
      } else {
        const st = this.statuses.get(key)!;
        st.isAllowed = isAllowed;
      }
    }
    return targetAccounts;
  }

  /**
   * Get all registered accounts and their live status
   */
  public getPoolStatus(): AccountStatus[] {
    this.refreshAccountList();
    const now = Date.now();
    const result: AccountStatus[] = [];

    for (const st of this.statuses.values()) {
      if (st.isThrottled && now >= st.cooldownUntil) {
        st.isThrottled = false;
        st.cooldownUntil = 0;
        st.throttleReason = undefined;
        st.consecutiveFailures = 0;
      }
      st.isAllowed = this.isAccountAllowed(st.email);
      const lower = st.email.toLowerCase();
      const ineligibles = this.ineligibleAgents.get(lower);
      const isLeased = this.isAccountLeased(lower);
      let leasedBy: string | undefined;
      for (const [sId, lEmail] of this.sessionLeases.entries()) {
        if (lEmail === lower) {
          leasedBy = sId;
          break;
        }
      }
      result.push({
        ...st,
        isLeased,
        leasedBy,
        ineligibleAgents: ineligibles ? Array.from(ineligibles) : [],
      });
    }
    return result;
  }

  /**
   * Check whether an account is currently leased by an active session or in flight
   */
  public isAccountLeased(email: string): boolean {
    const lower = email.trim().toLowerCase();
    for (const leasedEmail of this.sessionLeases.values()) {
      if (leasedEmail === lower) return true;
    }
    return this.inFlightLeases.has(lower);
  }

  /**
   * Get total number of unthrottled and unleased accounts eligible for a given agent
   */
  public getAvailableCapacity(forAgentId?: string): number {
    const normAgentId = forAgentId?.trim().toLowerCase();
    const accounts = this.refreshAccountList();
    const now = Date.now();
    let capacity = 0;

    for (const acc of accounts) {
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key);
      if (!status) continue;
      if (normAgentId && !this.isAgentEligible(acc.email, normAgentId)) continue;
      if (status.isThrottled && now < status.cooldownUntil) continue;
      if (this.isAccountLeased(key)) continue;
      capacity++;
    }
    return capacity;
  }

  /**
   * Acquires an exclusive account lease for a session.
   * The leased account will NOT be assigned to any other session until releaseSessionLease is called.
   */
  public async acquireSessionLease(
    sessionId: string,
    options?: GetTokenOptions
  ): Promise<ActiveSessionToken> {
    const normSessionId = sessionId.trim();
    if (!normSessionId) {
      throw new Error("sessionId is required to acquire a session lease");
    }

    // Re-use already leased account if held by this session
    const existingEmail = this.sessionLeases.get(normSessionId);
    if (existingEmail) {
      const status = this.statuses.get(existingEmail.toLowerCase());
      if (status && !status.isThrottled) {
        status.lastUsedAt = Date.now();
        status.totalRequests++;
        return await this.manager.getAccessToken(existingEmail);
      }
      this.sessionLeases.delete(normSessionId);
    }

    const accounts = this.refreshAccountList();
    const total = accounts.length;
    if (total === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }

    const rawAgentId = options?.forAgentId;
    const normAgentId = rawAgentId
      ? (ChatHubClient.normalizeAgentId(rawAgentId) || rawAgentId.trim())
      : undefined;

    const now = Date.now();
    const startIndex = this.currentIndex;

    for (let i = 0; i < total; i++) {
      const idx = (startIndex + i) % total;
      const acc = accounts[idx];
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key)!;

      if (normAgentId && !this.isAgentEligible(acc.email, normAgentId)) {
        continue;
      }

      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
      }

      if (status.isThrottled) {
        continue;
      }

      if (this.isAccountLeased(key)) {
        continue;
      }

      // Claim session lease
      this.sessionLeases.set(normSessionId, key);
      this.currentIndex = (idx + 1) % total;

      try {
        const session = await this.manager.getAccessToken(acc.email);
        status.lastUsedAt = Date.now();
        status.totalRequests++;
        return session;
      } catch (err) {
        this.sessionLeases.delete(normSessionId);
        status.isThrottled = true;
        status.cooldownUntil = Date.now() + 60 * 1000;
        status.throttledCount = (status.throttledCount || 0) + 1;
      }
    }

    const eligibleAccounts = accounts.filter(
      (acc) => !normAgentId || this.isAgentEligible(acc.email, normAgentId)
    );
    const unthrottledCount = eligibleAccounts.filter(
      (acc) => !this.statuses.get(acc.email.toLowerCase())?.isThrottled
    ).length;

    const error = new Error(
      `ALL_ACCOUNTS_LEASED: All ${unthrottledCount} available accounts in the pool are currently leased by active sessions.`
    );
    (error as any).code = "ALL_ACCOUNTS_LEASED";
    throw error;
  }

  /**
   * Releases the session lease held by a session
   */
  public releaseSessionLease(sessionId: string): void {
    const normSessionId = sessionId.trim();
    this.sessionLeases.delete(normSessionId);
  }

  /**
   * Get the account email currently leased by a session
   */
  public getSessionLease(sessionId: string): string | undefined {
    const normSessionId = sessionId.trim();
    const lower = this.sessionLeases.get(normSessionId);
    if (!lower) return undefined;
    return this.originalAllowedCase.get(lower) || this.statuses.get(lower)?.email || lower;
  }

  /**
   * Helper to compute next UTC midnight timestamp with floorMs guard
   */
  public getNextUtcMidnight(floorMs = 15 * 60 * 1000): number {
    return getNextUtcMidnight(floorMs);
  }

  public static getNextUtcMidnight(floorMs = 15 * 60 * 1000): number {
    return getNextUtcMidnight(floorMs);
  }

  /**
   * Mark an account as throttled/rate-limited and schedule cooldown in milliseconds.
   * Monotonic: preserves the maximum cooldownUntil and preserves 'daily' status from being downgraded.
   */
  public markThrottled(
    email: string,
    durationMs?: number,
    reason: "daily" | "burst" = "burst"
  ): void {
    const key = email.toLowerCase();
    let status = this.statuses.get(key);
    if (!status) {
      this.refreshAccountList();
      status = this.statuses.get(key);
    }
    if (status) {
      const defaultMs =
        reason === "daily"
          ? Math.max(getNextUtcMidnight() - Date.now(), 15 * 60 * 1000)
          : this.defaultCooldownMs;
      const cooldown = durationMs ?? defaultMs;
      const target = Date.now() + cooldown;

      status.isThrottled = true;
      status.cooldownUntil = Math.max(status.cooldownUntil ?? 0, target);
      status.throttleReason = status.throttleReason === "daily" ? "daily" : reason;
      status.throttledCount = (status.throttledCount || 0) + 1;
      status.consecutiveFailures = (status.consecutiveFailures || 0) + 1;
    }
  }

  /**
   * Backward-compatible alias for markThrottled accepting seconds
   */
  public markAccountThrottled(
    email: string,
    cooldownSeconds = 180,
    reason: "daily" | "burst" = "burst"
  ): void {
    this.markThrottled(email, cooldownSeconds * 1000, reason);
  }

  /**
   * Manually unthrottle an account
   */
  public unthrottle(email: string): void {
    const key = email.toLowerCase();
    const status = this.statuses.get(key);
    if (status) {
      status.isThrottled = false;
      status.cooldownUntil = 0;
      status.throttleReason = undefined;
      status.consecutiveFailures = 0;
    }
  }

  /**
   * Mark an account as ineligible for a specific Copilot Agent (e.g. GptAccessForbidden / GptNotAvailable)
   */
  public markAgentIneligible(email: string, agentId: string, reason?: string): void {
    const key = email.toLowerCase();
    const normAgent = ChatHubClient.normalizeAgentId(agentId) || agentId.trim();
    if (!this.ineligibleAgents.has(key)) {
      this.ineligibleAgents.set(key, new Set());
    }
    this.ineligibleAgents.get(key)!.add(normAgent);
  }

  /**
   * Check if an account is eligible to access the specified Copilot Agent
   */
  public isAgentEligible(email: string, agentId?: string): boolean {
    if (!agentId) return true;
    const key = email.toLowerCase();
    const set = this.ineligibleAgents.get(key);
    if (!set) return true;
    const normAgent = ChatHubClient.normalizeAgentId(agentId) || agentId.trim();
    return !set.has(normAgent);
  }

  /**
   * Clear ineligibility markers for an account, an agent, or all
   */
  public clearAgentIneligibility(email?: string, agentId?: string): void {
    const normAgent = agentId
      ? (ChatHubClient.normalizeAgentId(agentId) || agentId.trim())
      : undefined;

    if (!email && !normAgent) {
      this.ineligibleAgents.clear();
      return;
    }
    if (email && !normAgent) {
      this.ineligibleAgents.delete(email.toLowerCase());
      return;
    }
    if (email && normAgent) {
      const set = this.ineligibleAgents.get(email.toLowerCase());
      if (set) {
        set.delete(normAgent);
        if (set.size === 0) {
          this.ineligibleAgents.delete(email.toLowerCase());
        }
      }
      return;
    }
    if (!email && normAgent) {
      for (const [key, set] of this.ineligibleAgents.entries()) {
        set.delete(normAgent);
        if (set.size === 0) {
          this.ineligibleAgents.delete(key);
        }
      }
    }
  }

  /**
   * Acquire next available account token using round-robin, skipping throttled and ineligible ones
   */
  public async getNextAvailableToken(
    targetAgentOrOptions?: string | GetTokenOptions
  ): Promise<ActiveSessionToken> {
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }

    if (typeof targetAgentOrOptions === "object" && targetAgentOrOptions?.sessionId) {
      return await this.acquireSessionLease(targetAgentOrOptions.sessionId, targetAgentOrOptions);
    }

    const rawAgentId =
      typeof targetAgentOrOptions === "string"
        ? targetAgentOrOptions
        : targetAgentOrOptions?.forAgentId;
    const normAgentId = rawAgentId
      ? (ChatHubClient.normalizeAgentId(rawAgentId) || rawAgentId.trim())
      : undefined;

    const now = Date.now();
    const total = accounts.length;

    // Check if any accounts exist that are eligible for this agent
    if (normAgentId) {
      const hasEligible = accounts.some((acc) => this.isAgentEligible(acc.email, normAgentId));
      if (!hasEligible) {
        throw new Error(`No eligible accounts found in pool for agent '${normAgentId}'`);
      }
    }

    // Scan pool: Pass 1 prioritizes unleased accounts to avoid concurrency collisions;
    // Pass 2 falls back to any unthrottled account if all eligible accounts are currently leased.
    for (const preferUnleased of [true, false]) {
      const startIndex = this.currentIndex;
      for (let i = 0; i < total; i++) {
        const idx = (startIndex + i) % total;
        const acc = accounts[idx];
        const key = acc.email.toLowerCase();
        const status = this.statuses.get(key)!;

        // Skip ineligible accounts for this agent
        if (normAgentId && !this.isAgentEligible(acc.email, normAgentId)) {
          continue;
        }

        // Check if cooldown expired
        if (status.isThrottled && now >= status.cooldownUntil) {
          status.isThrottled = false;
          status.cooldownUntil = 0;
        }

        if (status.isThrottled) {
          continue;
        }

        const isLeased = this.inFlightLeases.has(key) || this.isAccountLeased(key);
        if (preferUnleased && isLeased) {
          continue;
        }

        // Claim in-flight lease and advance index immediately before awaiting async fetch
        this.inFlightLeases.add(key);
        this.currentIndex = (idx + 1) % total;

        try {
          const session = await this.manager.getAccessToken(acc.email);
          status.lastUsedAt = Date.now();
          status.totalRequests++;
          return session;
        } catch (err) {
          // If token acquisition fails, mark throttled and continue to next account
          status.isThrottled = true;
          status.cooldownUntil = Date.now() + 60 * 1000;
          status.throttledCount = (status.throttledCount || 0) + 1;
        } finally {
          this.inFlightLeases.delete(key);
        }
      }
    }

    // If all eligible accounts are throttled, compute earliest cooldown wait time
    const eligibleAccounts = accounts.filter(
      (acc) => !normAgentId || this.isAgentEligible(acc.email, normAgentId)
    );

    let earliest: AccountStatus | null = null;
    for (const acc of eligibleAccounts) {
      const st = this.statuses.get(acc.email.toLowerCase());
      if (st && (!earliest || st.cooldownUntil < earliest.cooldownUntil)) {
        earliest = st;
      }
    }

    const waitSeconds = earliest
      ? Math.max(1, Math.ceil((earliest.cooldownUntil - now) / 1000))
      : 30;

    if (normAgentId) {
      throw new Error(
        `All ${eligibleAccounts.length} eligible account(s) for agent '${normAgentId}' in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`
      );
    } else if (this.allowedAccounts && this.allowedAccounts.size > 0) {
      throw new Error(
        `All ${total} allowed account(s) in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`
      );
    } else {
      throw new Error(
        `All ${total} accounts in the pool are currently rate-limited. Earliest cooldown expires in ${waitSeconds}s`
      );
    }
  }

  /**
   * Relay execution with automatic account rotation when rate limits (429) or agent permission errors occur
   */
  public async executeWithRelay<T>(
    fn: (token: ActiveSessionToken) => Promise<T>,
    optionsOrMaxAttempts?: number | RelayOptions
  ): Promise<T> {
    let forAgentId: string | undefined;
    let maxAttempts: number | undefined;

    if (typeof optionsOrMaxAttempts === "number") {
      maxAttempts = optionsOrMaxAttempts;
    } else if (typeof optionsOrMaxAttempts === "object" && optionsOrMaxAttempts !== null) {
      forAgentId = optionsOrMaxAttempts.forAgentId;
      maxAttempts = optionsOrMaxAttempts.maxAttempts;
    }

    const accounts = this.refreshAccountList();
    const attempts = maxAttempts ?? Math.max(1, accounts.length);
    let lastError: any;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.getNextAvailableToken(forAgentId ? { forAgentId } : undefined);
      try {
        return await fn(token);
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err).toLowerCase();
        const isRateLimited =
          msg.includes("rate limit") ||
          msg.includes("too many requests") ||
          msg.includes("429") ||
          msg.includes("throttled") ||
          msg.includes("quota");

        if (isRateLimited) {
          this.markThrottled(token.email);
          continue; // relay to next account
        }

        const isGptForbidden =
          msg.includes("gptaccessforbidden") ||
          (err as any)?.errorCode === "GptAccessForbidden";
        const isGptUnavailable =
          msg.includes("gptnotavailable") ||
          (err as any)?.errorCode === "GptNotAvailable";

        if (isGptForbidden || isGptUnavailable) {
          const targetAgent = forAgentId || (err as any)?.agentId;
          const reason = isGptForbidden ? "GptAccessForbidden" : "GptNotAvailable";
          if (targetAgent) {
            this.markAgentIneligible(token.email, targetAgent, reason);
          }
          continue; // relay to next account
        }

        // Non-rate-limit and non-agent-error errors are thrown directly
        throw err;
      }
    }

    throw lastError;
  }

  /**
   * Acquire a Microsoft Graph access token from the active or specified account
   */
  public async getGraphAccessToken(email?: string): Promise<string> {
    if (email) {
      return this.manager.getGraphAccessToken(email);
    }
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }
    const idx = Math.max(0, (this.currentIndex - 1 + accounts.length) % accounts.length);
    const target = accounts[idx];
    return this.manager.getGraphAccessToken(target.email);
  }
}
