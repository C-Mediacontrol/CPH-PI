import { describe, it, expect } from "bun:test";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("Rate Limit Response Text Filter Unit Tests (CR-2)", () => {
  const orchestrator = new Orchestrator({
    workspaceRoot: process.cwd(),
  });

  describe("1. False Positives Prevention (Explanatory & Contextual Text)", () => {
    it("should not misidentify discussion on how to troubleshoot 429 as rate limit error", () => {
      const text = "如何排查 429 报错：请检查网络请求与频控配置，通常是客户端短时间内发送过多请求导致。";
      expect((orchestrator as any).isRateLimitResponseText(text)).toBe(false);
    });

    it("should not misidentify error line reference as rate limit error", () => {
      const text = "错误发生在 Line 429: const handler = registry.get(name);";
      expect((orchestrator as any).isRateLimitResponseText(text)).toBe(false);
    });

    it("should not misidentify HTTP status code explanation as rate limit error", () => {
      const text = "HTTP 状态码 429 含义是 Too Many Requests，客户端需要等待 Retry-After 头部指定的时间。";
      expect((orchestrator as any).isRateLimitResponseText(text)).toBe(false);
    });

    it("should not misidentify long analytical or architectural reports containing rate limit terms", () => {
      const longReport = `
# 系统架构审查与负载分析报告
在分布式微服务架构中，当多个客户端并发调用上游 Sydney 接口时，容易触碰服务端 QPS 频控限制。
我们对系统进行了全链路压力测试，详细统计了 429 too many requests 的产生分布与上下文情境。
排查发现错误并不是由于账号被 throttled，而是由于客户端没有配置退避重试算法。
建议重构方案如下：
1. 引入指数退避重试机制（Exponential Backoff with Jitter）；
2. 在账号池管理器中加入并发租约与轮询推进隔离；
3. 对于大文件传输采用切片流式写入，避免占用单一会话带宽。
以上方案实施后，频控错误率预期下降 99%，系统整体健壮性大幅提升。
`.trim();

      expect(longReport.length).toBeGreaterThan(300);
      expect((orchestrator as any).isRateLimitResponseText(longReport)).toBe(false);
    });

    it("should ignore action blocks and final answers even if they mention 429", () => {
      const actionText = "```action\nrun_command\n{\"command\":\"grep -rn '429' ./src\"}\n```";
      expect((orchestrator as any).isRateLimitResponseText(actionText)).toBe(false);

      const finalText = "FINAL_ANSWER: 已修复 Line 429 处的并发竞态 Bug。";
      expect((orchestrator as any).isRateLimitResponseText(finalText)).toBe(false);
    });

    it("should return false for empty or non-rate-limit normal replies", () => {
      expect((orchestrator as any).isRateLimitResponseText("")).toBe(false);
      expect((orchestrator as any).isRateLimitResponseText("代码已经修改完成，所有单元测试均已通过。")).toBe(false);
    });
  });

  describe("2. True Positives Detection (Platform Rate Limit Signals)", () => {
    it("should correctly detect standard '429 Too Many Requests'", () => {
      expect((orchestrator as any).isRateLimitResponseText("429 Too Many Requests")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("429 too many requests: rate limit reached")).toBe(true);
    });

    it("should correctly detect status code 429 error messages", () => {
      expect((orchestrator as any).isRateLimitResponseText("status code: 429")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("Status Code 429: Throttled")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("Error: status code: 429")).toBe(true);
    });

    it("should correctly detect line-initial 429 signal", () => {
      expect((orchestrator as any).isRateLimitResponseText("429")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("429\nRate limit reached")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("System notice:\n429 Too Many Requests")).toBe(true);
    });

    it("should correctly detect rate limit exceeded phrases", () => {
      expect((orchestrator as any).isRateLimitResponseText("rate limit exceeded")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("rate_limit_exceeded")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("The account has been throttled")).toBe(true);
    });

    it("should correctly detect Chinese platform rate limit messages", () => {
      expect((orchestrator as any).isRateLimitResponseText("当前账号配额已达上限，请稍后再试。")).toBe(true);
      expect((orchestrator as any).isRateLimitResponseText("请求过于频繁，请稍后重试。")).toBe(true);
    });
  });
});
