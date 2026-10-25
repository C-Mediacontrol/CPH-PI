import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { TokenManager, type StoredAccount } from "../../src/auth/token-manager.ts";
import { AccountPool, getNextUtcMidnight } from "../../src/auth/account-pool.ts";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("AccountPool Tiered Monotonic Cooldown & Classification Tests (CR-2)", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let manager: TokenManager;
  let pool: AccountPool;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cooldown-test-"));
    tempConfigPath = path.join(tempDir, "accounts.json");
    manager = new TokenManager(tempConfigPath);

    const testAccounts: StoredAccount[] = [
      { email: "alpha@contoso.com", refreshToken: "rt_alpha" },
      { email: "beta@contoso.com", refreshToken: "rt_beta" },
    ];
    manager.saveAccounts(testAccounts);

    manager.setCachedToken("alpha@contoso.com", {
      email: "alpha@contoso.com",
      accessToken: "token_alpha",
      refreshToken: "rt_alpha",
      expiresAt: Date.now() + 3600_000,
    });
    manager.setCachedToken("beta@contoso.com", {
      email: "beta@contoso.com",
      accessToken: "token_beta",
      refreshToken: "rt_beta",
      expiresAt: Date.now() + 3600_000,
    });

    pool = new AccountPool(manager, { maxAccounts: 2, defaultCooldownMs: 60_000 });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Next UTC Midnight Calculation (getNextUtcMidnight)", () => {
    it("should return a timestamp >= Date.now() + floorMs and align to 00:00:00.000 UTC of next day", () => {
      const floorMs = 15 * 60 * 1000;
      const target = getNextUtcMidnight(floorMs);
      const now = Date.now();

      expect(target).toBeGreaterThanOrEqual(now + floorMs);

      const d = new Date(target);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
      expect(d.getUTCMilliseconds()).toBe(0);
      expect(d.toISOString().endsWith("T00:00:00.000Z")).toBe(true);

      // Verify default floorMs is 15 minutes
      const defaultTarget = getNextUtcMidnight();
      expect(defaultTarget).toBeGreaterThanOrEqual(now + 15 * 60 * 1000);
      expect(new Date(defaultTarget).toISOString().endsWith("T00:00:00.000Z")).toBe(true);

      // Verify helper method on AccountPool instance
      const poolTarget = pool.getNextUtcMidnight();
      expect(poolTarget).toBe(defaultTarget);
    });

    it("should correctly handle floorMs rolling beyond next midnight", () => {
      // 30 hours from now is definitely beyond tomorrow 00:00 UTC
      const floorMs = 30 * 60 * 60 * 1000;
      const target = getNextUtcMidnight(floorMs);
      const now = Date.now();

      expect(target).toBeGreaterThanOrEqual(now + floorMs);
      const d = new Date(target);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
      expect(d.getUTCMilliseconds()).toBe(0);
    });
  });

  describe("2. Monotonic Cooldown & Reason Preservation (markThrottled)", () => {
    it("should set daily cooldownUntil and throttleReason to 'daily'", () => {
      const email = "alpha@contoso.com";
      const midnight = getNextUtcMidnight();
      pool.markThrottled(email, midnight - Date.now(), "daily");

      const status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase());
      expect(status).toBeDefined();
      expect(status!.isThrottled).toBe(true);
      expect(status!.throttleReason).toBe("daily");
      expect(Math.abs(status!.cooldownUntil - midnight)).toBeLessThanOrEqual(100);
      expect(status!.throttledCount).toBe(1);
      expect(status!.consecutiveFailures).toBe(1);
    });

    it("should preserve monotonicity: subsequent burst cooldown MUST NOT shorten cooldownUntil or downgrade reason", () => {
      const email = "alpha@contoso.com";
      const midnight = getNextUtcMidnight();

      // Step 1: Mark account with daily limit (cooling down until tomorrow midnight)
      pool.markThrottled(email, midnight - Date.now(), "daily");

      let status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      const originalCooldown = status.cooldownUntil;
      expect(Math.abs(originalCooldown - midnight)).toBeLessThanOrEqual(100);
      expect(status.throttleReason).toBe("daily");

      // Step 2: Attempt a 120s burst throttle on the same account
      pool.markThrottled(email, 120_000, "burst");

      status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      // Cooldown timestamp must remain tomorrow midnight (NOT shortened to now + 120s)
      expect(status.cooldownUntil).toBe(originalCooldown);
      // Throttle reason must remain 'daily' (NOT downgraded to 'burst')
      expect(status.throttleReason).toBe("daily");
      expect(status.throttledCount).toBe(2);
      expect(status.consecutiveFailures).toBe(2);
    });

    it("should upgrade 'burst' to 'daily' when daily quota is encountered", () => {
      const email = "beta@contoso.com";

      // Step 1: Account hit burst limit first
      pool.markThrottled(email, 60_000, "burst");

      let status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      expect(status.throttleReason).toBe("burst");
      const initialCooldown = status.cooldownUntil;

      // Step 2: Account subsequently hits daily limit
      const midnight = getNextUtcMidnight();
      pool.markThrottled(email, midnight - Date.now(), "daily");

      status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      expect(status.throttleReason).toBe("daily");
      expect(status.cooldownUntil).toBe(midnight);
      expect(status.cooldownUntil).toBeGreaterThan(initialCooldown);
    });

    it("should preserve largest cooldownUntil between successive burst limits", () => {
      const email = "beta@contoso.com";
      pool.markThrottled(email, 120_000, "burst");

      let status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      const originalCooldown = status.cooldownUntil;

      // Call markThrottled with shorter duration (30s)
      pool.markThrottled(email, 30_000, "burst");

      status = pool.getPoolStatus().find((s) => s.email.toLowerCase() === email.toLowerCase())!;
      expect(status.cooldownUntil).toBe(originalCooldown);
      expect(status.throttleReason).toBe("burst");
    });
  });

  describe("3. Rate Limit Text Categorization (classifyRateLimitText)", () => {
    const orchestrator = new Orchestrator({
      workspaceRoot: process.cwd(),
    });

    it("should correctly classify daily quota limits as 'daily'", () => {
      const dailyPhrases = [
        "已达到今天的消息上限",
        "达到今天的消息上限，请明天再试",
        "今日消息上限已达",
        "今日上限已用完",
        "每日消息上限",
        "You have reached your daily limit for messages.",
        "daily message limit exceeded",
        "Daily limit reached. Please return tomorrow.",
        "Account daily quota exceeded",
      ];

      for (const phrase of dailyPhrases) {
        const result = (orchestrator as any).classifyRateLimitText(phrase);
        expect(result.isRateLimit).toBe(true);
        expect(result.kind).toBe("daily");
      }
    });

    it("should correctly classify short-term rate limits as 'burst'", () => {
      const burstPhrases = [
        "429 Too Many Requests",
        "429 too many requests: rate limit reached",
        "status code: 429",
        "Status Code 429: Throttled",
        "Error: status code: 429",
        "too many requests",
        "rate limit exceeded",
        "rate_limit_exceeded",
        "The account has been throttled",
        "请求过于频繁",
        "请求过于频繁，请稍后重试。",
        "暂时无法响应这么多请求",
        "配额已达上限",
      ];

      for (const phrase of burstPhrases) {
        const result = (orchestrator as any).classifyRateLimitText(phrase);
        expect(result.isRateLimit).toBe(true);
        expect(result.kind).toBe("burst");
      }
    });

    it("should correctly classify non-rate-limit text as 'none'", () => {
      const nonRateLimitCases = [
        "Normal response text explaining code implementation.",
        "```action\nrun_command\n{\"command\":\"grep -rn '429' ./src\"}\n```",
        "FINAL_ANSWER: 已修复 Line 429 处的并发竞态 Bug。",
        "如何排查 429 报错：请检查网络请求与频控配置，通常是客户端短时间内发送过多请求导致。",
        "错误发生在 Line 429: const handler = registry.get(name);",
        "",
        `
# 架构分析长报告 (>300 chars)
在分布式微服务架构中，当多个客户端并发调用上游 Sydney 接口时，容易触碰服务端 QPS 频控限制。
我们对系统进行了全链路压力测试，详细统计了 429 too many requests 的产生分布与上下文情境。
排查发现错误并不是由于账号被 throttled，而是由于客户端没有配置退避重试算法。
建议重构方案如下：引入指数退避重试机制；在账号池管理器中加入并发租约与轮询推进隔离。
`.trim(),
      ];

      for (const text of nonRateLimitCases) {
        const result = (orchestrator as any).classifyRateLimitText(text);
        expect(result.isRateLimit).toBe(false);
        expect(result.kind).toBe("none");
      }
    });

    it("should maintain boolean compatibility in isRateLimitResponseText", () => {
      expect((orchestrator as any).isRateLimitResponseText("已达到今天的消息上限")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("429 Too Many Requests")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("Normal code output")).toBe(false);
    });
  });

  describe("4. Non-Rate-Limit Exception Classification (User Abort & Tool Exceptions)", () => {
    const orchestrator = new Orchestrator({
      workspaceRoot: process.cwd(),
    });

    it("should NOT classify User abort (AbortError) as rate limit error", () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";

      expect((orchestrator as any).isExplicitRateLimitError(abortErr)).toBe(false);
      expect((orchestrator as any).isRecoverableTransportError(abortErr)).toBe(false);

      const classification = (orchestrator as any).classifyRateLimitError(abortErr);
      expect(classification.isRateLimit).toBe(false);
      expect(classification.kind).toBe("none");
    });

    it("should NOT classify command/tool execution failures as rate limit error", () => {
      const toolFailures = [
        new Error("Command failed with exit code 1: syntax error in main.py"),
        new Error("ENOENT: no such file or directory, open 'src/auth/missing.ts'"),
        new Error("TypeScript error TS2304: Cannot find name 'AccountStatus'"),
        new Error("Git checkout failed: branch 'feature/cloud-sync' not found"),
      ];

      for (const err of toolFailures) {
        expect((orchestrator as any).isExplicitRateLimitError(err)).toBe(false);
        const classification = (orchestrator as any).classifyRateLimitError(err);
        expect(classification.isRateLimit).toBe(false);
        expect(classification.kind).toBe("none");
      }
    });
  });
});
