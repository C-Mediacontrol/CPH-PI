import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import fs from "fs";
import {
  Orchestrator,
  type IOrchestratorChatClient,
  type IAccountPool,
  type OrchestratorRunResult,
} from "../../src/agent/orchestrator.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

// Mock client that can return strings or throw errors
class MockChatHubClient implements IOrchestratorChatClient {
  public responses: Array<string | Error | { text: string; reasoning?: string }> = [];
  public sentPrompts: string[] = [];
  public callCount = 0;
  public email?: string;
  public token?: { email: string };

  constructor(
    responses: Array<string | Error | { text: string; reasoning?: string }>,
    email = "GSC.VFU2@cma-cgm.com"
  ) {
    this.responses = responses;
    this.email = email;
    this.token = { email };
  }

  async sendMessage(
    params: { text: string; [key: string]: any },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      onRateLimitDetected?: (email: string) => Promise<void> | void;
      [key: string]: any;
    }
  ): Promise<{ text: string; reasoning?: string }> {
    this.sentPrompts.push(params.text);
    const item = this.responses[this.callCount];
    this.callCount++;

    if (item instanceof Error) {
      throw item;
    }

    const text = typeof item === "string" ? item : item ? item.text : "FINAL_ANSWER: Done";
    const reasoning = typeof item === "object" && !(item instanceof Error) ? item.reasoning : undefined;

    if (reasoning && callbacks?.onDelta) {
      callbacks.onDelta({ type: "reasoning", content: reasoning });
    }

    if (callbacks?.onDelta) {
      callbacks.onDelta({ type: "text", content: text });
    }

    return { text, reasoning };
  }
}

// Mock AccountPool supporting rotation and throttling
class MockAccountPool implements IAccountPool {
  public accounts: Array<{ email: string; throttled: boolean }>;
  public throttledAccounts: string[] = [];
  public currentIndex = 0;

  constructor(
    accounts: string[] = ["GSC.VFU2@cma-cgm.com", "GSC.DDAI@cma-cgm.com"]
  ) {
    this.accounts = accounts.map((email) => ({ email, throttled: false }));
  }

  markThrottled(email: string, _durationMs?: number): void {
    const key = email.toLowerCase();
    this.throttledAccounts.push(key);
    const acc = this.accounts.find((a) => a.email.toLowerCase() === key);
    if (acc) {
      acc.throttled = true;
    }
  }

  async getNextAvailableToken(options?: any): Promise<any> {
    const available = this.accounts.filter((a) => !a.throttled);
    if (available.length === 0) {
      throw new Error("All accounts in the pool are currently rate-limited.");
    }
    const acc = available[this.currentIndex % available.length];
    this.currentIndex++;
    return {
      email: acc.email,
      accessToken: `token_for_${acc.email}`,
      expiresAt: Date.now() + 3600_000,
      oid: "oid_" + acc.email,
      tid: "tid_" + acc.email,
    };
  }

  refreshAccountList(): any[] {
    return this.accounts.map((a) => ({ email: a.email }));
  }

  getPoolStatus(): any[] {
    return this.accounts.map((a) => ({
      email: a.email,
      isAvailable: !a.throttled,
      isThrottled: a.throttled,
      cooldownUntil: a.throttled ? Date.now() + 180000 : 0,
      lastUsedAt: 0,
      totalRequests: 0,
      throttledCount: a.throttled ? 1 : 0,
    }));
  }
}

describe("Orchestrator A->B->C Disaster Recovery Relay Unit Tests (TDD)", () => {
  let tempDir: string;
  let testFile: string;
  let bridge: ToolBridge;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-relay-test-"));
    testFile = join(tempDir, "sample.txt");
    await writeFile(testFile, "initial content\n", "utf8");
    bridge = new ToolBridge(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("测试场景 1: 会话 A 在多轮攻坚中突发 429 频控异常与全自动接力", () => {
    it("should intercept 429 on Turn 3, extract blackbox, rotate account, and produce handoff doc via arbitrator session", async () => {
      const sessionIdA = "ses_victim_session_429";

      // Session A: Turn 1 (read_file), Turn 2 (edit), Turn 3 (429 Throttling Error)
      const clientA = new MockChatHubClient(
        [
          // Turn 1
          `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
          // Turn 2
          `\`\`\`action
tool: edit
path: sample.txt
old_string: initial
new_string: modified
\`\`\``,
          // Turn 3: 429 Rate limit exception thrown
          new Error("429 Too Many Requests: Rate limit quota exceeded by Sydney upstream"),
        ],
        "GSC.VFU2@cma-cgm.com"
      );

      // Session B (Arbitrator on DDAI account): generates handoff document via write_file action
      const clientB = new MockChatHubClient(
        [
          `THOUGHT: 前序会话遇险，我是交接仲裁者。正在提炼 5 维高保真交接文档并落盘。
\`\`\`action
tool: write_file
path: .cph/handoffs/handoff-${sessionIdA}.md
content: # 🔄 CPH-PI 会话高保真接力交接文档 (Autonomous Handoff Document)
## 1. 【任务目标与原始需求】
- **原始任务**: 检查并更新 sample.txt
- **工作区根目录**: \`${tempDir}\`

## 2. 【已验证客观事实与阶段性成果】
- Turn 1: 成功读取 sample.txt
- Turn 2: 成功修改 sample.txt 中的 initial -> modified

## 3. 【关键卡点、报错与最新诊断】
- Turn 3 遭遇 429_RATE_LIMIT 频控限流

## 4. 【已修改/生成文件清单】
- \`sample.txt\` (已修改)

## 5. 【接力第一优先级待办事项 (Actionable Next Steps)】
1. **第一优先级 (立即执行)**: 接力会话直接验证 modified 效果并完成交付。
\`\`\``,
        ],
        "GSC.DDAI@cma-cgm.com"
      );

      const mockPool = new MockAccountPool([
        "GSC.VFU2@cma-cgm.com",
        "GSC.DDAI@cma-cgm.com",
      ]);

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: clientA,
        arbitratorChatClient: clientB,
        pool: mockPool as any,
        sessionId: sessionIdA,
        maxTurns: 5,
      });

      let disasterOccurredCalled = false;
      let capturedBlackbox = "";
      let capturedLastError = "";
      let arbitratorHandoffStartCalled = false;
      let capturedArbitratorSessionId = "";
      let capturedArbitratorEmail = "";
      let arbitratorHandoffCompleteCalled = false;
      let capturedCompleteDocPath = "";

      const result: OrchestratorRunResult = await orchestrator.run({
        task: "检查并更新 sample.txt",
        sessionId: sessionIdA,
        events: {
          onDisasterOccurred: (bb, err) => {
            disasterOccurredCalled = true;
            capturedBlackbox = bb;
            capturedLastError = err;
          },
          onArbitratorHandoffStart: (arbId, email) => {
            arbitratorHandoffStartCalled = true;
            capturedArbitratorSessionId = arbId;
            capturedArbitratorEmail = email;
          },
          onArbitratorHandoffComplete: (docPath, arbId) => {
            arbitratorHandoffCompleteCalled = true;
            capturedCompleteDocPath = docPath;
          },
        },
      });

      // 1. Verify Session A did not crash and returned structured recovery result
      expect(result.handedOff).toBe(true);
      expect(result.disasterRecovered).toBe(true);
      expect(result.completed).toBe(false);

      // 2. Verify BlackboxCompactor extraction
      expect(disasterOccurredCalled).toBe(true);
      expect(capturedBlackbox).toContain("🚨 事故现场黑匣子快照");
      expect(capturedBlackbox).toContain("429_RATE_LIMIT");
      expect(capturedLastError).toContain("429");
      expect(result.disasterBlackbox).toBe(capturedBlackbox);

      // 3. Verify AccountPool marked VFU2 throttled and switched to DDAI
      expect(mockPool.throttledAccounts).toContain("gsc.vfu2@cma-cgm.com");
      expect(arbitratorHandoffStartCalled).toBe(true);
      expect(capturedArbitratorEmail).toBe("GSC.DDAI@cma-cgm.com");

      // 4. Verify Arbitrator Session B invoked with blackbox in prompt
      expect(clientB.sentPrompts.length).toBe(1);
      expect(clientB.sentPrompts[0]).toContain("事故现场黑匣子快照");
      expect(clientB.sentPrompts[0]).toContain(sessionIdA);

      // 5. Verify handoff document persisted to target location
      const expectedDocPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionIdA}.md`);
      expect(result.handoffDocPath).toBe(expectedDocPath);
      expect(capturedCompleteDocPath).toBe(expectedDocPath);
      expect(arbitratorHandoffCompleteCalled).toBe(true);
      expect(fs.existsSync(expectedDocPath)).toBe(true);

      const persistedContent = await readFile(expectedDocPath, "utf8");
      expect(persistedContent).toContain("CPH-PI 会话高保真接力交接文档");
      expect(persistedContent).toContain("sample.txt");

      // 6. Verify arbitratorSessionId in result
      expect(result.arbitratorSessionId).toBeDefined();
      expect(result.arbitratorSessionId).toBe(capturedArbitratorSessionId);
    });
  });

  describe("测试场景 2: 仲裁会话 B 中的工具调用拦截与执行", () => {
    it("should handle session B returning direct Markdown text and guarantee reliable disk persistence", async () => {
      const sessionIdA = "ses_victim_direct_text";

      const clientA = new MockChatHubClient(
        [
          `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
          new Error("429 RateLimit: Too Many Requests"),
        ],
        "GSC.VFU2@cma-cgm.com"
      );

      // Session B directly returns Markdown text instead of action: write_file
      const directMarkdown = `# 🔄 阶段性交接文档 (Direct Markdown)
## 1. 【任务目标与原始需求】
- 目标: 直接 Markdown 测试

## 2. 【已验证客观事实与阶段性成果】
- 验证直接文本输出能够被编排器可靠落盘

## 3. 【关键卡点、报错与最新诊断】
- 前序 429 限流

## 4. 【已修改/生成文件清单】
- 无

## 5. 【接力第一优先级待办事项 (Actionable Next Steps)】
1. 立即推进下一步`;

      const clientB = new MockChatHubClient([directMarkdown], "GSC.DDAI@cma-cgm.com");
      const mockPool = new MockAccountPool();

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: clientA,
        arbitratorChatClient: clientB,
        pool: mockPool as any,
        sessionId: sessionIdA,
      });

      const result = await orchestrator.run({
        task: "测试直接 Markdown 落盘保证",
        sessionId: sessionIdA,
      });

      expect(result.handedOff).toBe(true);
      expect(result.disasterRecovered).toBe(true);

      const expectedDocPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionIdA}.md`);
      expect(result.handoffDocPath).toBe(expectedDocPath);
      expect(fs.existsSync(expectedDocPath)).toBe(true);

      const savedContent = await readFile(expectedDocPath, "utf8");
      expect(savedContent).toBe(directMarkdown);
    });
  });

  describe("测试场景 3: 账号池所有账号均耗尽 (All throttled) 时的优雅降级", () => {
    it("should gracefully degrade by locally persisting blackbox when all accounts are throttled", async () => {
      const sessionIdA = "ses_victim_all_throttled";

      const clientA = new MockChatHubClient(
        [new Error("429 Too Many Requests")],
        "GSC.VFU2@cma-cgm.com"
      );

      // Pool with only 1 account, which immediately gets throttled on 429
      const mockPool = new MockAccountPool(["GSC.VFU2@cma-cgm.com"]);

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: clientA,
        pool: mockPool as any,
        sessionId: sessionIdA,
      });

      let handoffSnapshotFired = "";
      let handoffDocPathFired = "";

      const result = await orchestrator.run({
        task: "所有账号耗尽降级测试",
        sessionId: sessionIdA,
        events: {
          onHandoff: (snap, docPath) => {
            handoffSnapshotFired = snap;
            handoffDocPathFired = docPath || "";
          },
        },
      });

      expect(result.handedOff).toBe(true);
      expect(result.disasterRecovered).toBe(false);
      expect(result.disasterBlackbox).toBeDefined();
      expect(result.arbitratorSessionId).toBeUndefined();

      // Ensure local blackbox document was persisted
      const expectedDocPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionIdA}.md`);
      expect(result.handoffDocPath).toBe(expectedDocPath);
      expect(fs.existsSync(expectedDocPath)).toBe(true);

      const savedContent = await readFile(expectedDocPath, "utf8");
      expect(savedContent).toContain("事故现场黑匣子快照");
      expect(handoffSnapshotFired).toContain("事故现场黑匣子快照");
    });
  });

  describe("测试场景 4: 取消信号 (AbortSignal) 仍具有最高优先级", () => {
    it("should throw AbortError immediately without misinterpreting cancellation as 429 disaster", async () => {
      const clientA = new MockChatHubClient([
        new Error("429 Too Many Requests"),
      ]);
      const mockPool = new MockAccountPool();

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: clientA,
        pool: mockPool as any,
      });

      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      expect(
        orchestrator.run({
          task: "任务已取消",
          signal: controller.signal,
        })
      ).rejects.toThrow("aborted");
    });
  });
});
