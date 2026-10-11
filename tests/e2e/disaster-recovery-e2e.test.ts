import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import fs from "fs";
import {
  CphPiCli,
  type CphPiCliOptions,
} from "../../src/cli.ts";
import {
  CopilotOrchestrator,
  type IOrchestratorChatClient,
  type IAccountPool,
} from "../../src/agent/orchestrator.ts";
import { SessionManager } from "../../src/session/session-manager.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

// Mock ChatHubClient with sequence of responses
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

describe("E2E Three-stage Disaster Recovery Pipeline (A -> B -> C) & CLI Tests (TDD)", () => {
  let tempDir: string;
  let testFile: string;
  let sessionManager: SessionManager;
  let capturedOutput: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-e2e-disaster-"));
    testFile = join(tempDir, "sample.txt");
    await writeFile(testFile, "initial content in sample.txt\n", "utf8");
    sessionManager = new SessionManager(tempDir);
    capturedOutput = [];
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const createCapturingRenderer = () => {
    return new TuiRenderer({
      writer: (chunk: string) => {
        capturedOutput.push(chunk);
      },
    });
  };

  describe("1. TuiRenderer 三阶容灾横幅格式与 ANSI 高亮测试", () => {
    it("should format and render Stage 1 Disaster Blackbox Banner (⚡ 红色/黄色边框)", () => {
      const renderer = createCapturingRenderer();
      const banner = renderer.formatDisasterBlackboxBanner(
        "ses_victim_001",
        "429 Too Many Requests: Rate limit exceeded"
      );

      expect(banner).toContain("⚡");
      expect(banner).toContain("[Disaster-Recovery: 阶一]");
      expect(banner).toContain("ses_victim_001");
      expect(banner).toContain("429 Too Many Requests");
      expect(banner).toContain("5k~8k");

      renderer.renderDisasterBlackboxBanner(
        "ses_victim_001",
        "429 Too Many Requests: Rate limit exceeded"
      );
      const combined = capturedOutput.join("");
      expect(combined).toContain("[Disaster-Recovery: 阶一]");
      expect(combined).toContain("ses_victim_001");
    });

    it("should format and render Stage 2 Arbitrator Handoff Banner (📑 蓝色/青色边框)", () => {
      const renderer = createCapturingRenderer();
      const docPath = join(tempDir, ".cph", "handoffs", "handoff-ses_001.md");
      const banner = renderer.formatArbitratorHandoffBanner(
        "ses_arbitrator_002",
        "GSC.DDAI@cma-cgm.com",
        docPath
      );

      expect(banner).toContain("📑");
      expect(banner).toContain("[Disaster-Recovery: 阶二]");
      expect(banner).toContain("ses_arbitrator_002");
      expect(banner).toContain("GSC.DDAI@cma-cgm.com");
      expect(banner).toContain(docPath);
      expect(banner).toContain("handoff");

      renderer.renderArbitratorHandoffBanner(
        "ses_arbitrator_002",
        "GSC.DDAI@cma-cgm.com",
        docPath
      );
      const combined = capturedOutput.join("");
      expect(combined).toContain("[Disaster-Recovery: 阶二]");
      expect(combined).toContain("GSC.DDAI@cma-cgm.com");
    });

    it("should format and render Stage 3 Disaster Successor Banner (🚀 绿色边框)", () => {
      const renderer = createCapturingRenderer();
      const docPath = join(tempDir, ".cph", "handoffs", "handoff-ses_001.md");
      const banner = renderer.formatDisasterSuccessorBanner(
        "ses_successor_003",
        1,
        3,
        docPath
      );

      expect(banner).toContain("🚀");
      expect(banner).toContain("[Disaster-Recovery: 阶三]");
      expect(banner).toContain("ses_successor_003");
      expect(banner).toContain("阶段 1/3");
      expect(banner).toContain(docPath);
      expect(banner).toContain("接力会话");

      renderer.renderDisasterSuccessorBanner(
        "ses_successor_003",
        1,
        3,
        docPath
      );
      const combined = capturedOutput.join("");
      expect(combined).toContain("[Disaster-Recovery: 阶三]");
      expect(combined).toContain("ses_successor_003");
    });
  });

  describe("2. 三阶容灾全链路端到端闭环验证 (A -> B -> C)", () => {
    it("should complete full A -> B -> C disaster recovery lifecycle without crashing", async () => {
      const sessionIdA = "ses_victim_e2e_a";
      const renderer = createCapturingRenderer();
      const pool = new MockAccountPool([
        "GSC.VFU2@cma-cgm.com",
        "GSC.DDAI@cma-cgm.com",
      ]);

      // Session A (Victim): Turn 1 read_file, Turn 2 429 exception
      const clientA = new MockChatHubClient(
        [
          // Turn 1
          `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
          // Turn 2: Sydney throws 429
          new Error("429 Too Many Requests: Rate limit quota exceeded by Sydney upstream"),
        ],
        "GSC.VFU2@cma-cgm.com"
      );

      // Session B (Arbitrator on DDAI): writes 5-dimension handoff document
      const clientB = new MockChatHubClient(
        [
          `THOUGHT: 前序会话遭遇 429 频控，我是交接仲裁者。正在提炼 5 维交接文档并落盘。
\`\`\`action
tool: write_file
path: .cph/handoffs/handoff-${sessionIdA}.md
content: # 🔄 CPH-PI 会话高保真接力交接文档 (Autonomous Handoff Document)
## 1. 【任务目标与原始需求】
- **原始任务**: 检查并更新 sample.txt 生产配置
- **工作区根目录**: \`${tempDir}\`

## 2. 【已验证客观事实与阶段性成果】
- Turn 1: 成功读取 sample.txt，文件内容完整。

## 3. 【关键卡点、报错与最新诊断】
- Turn 2: 遭遇 429_RATE_LIMIT 频控限流，已自动提炼事故黑匣子。

## 4. 【已修改/生成文件清单】
- 无（待修改 sample.txt）

## 5. 【接力第一优先级待办事项 (Actionable Next Steps)】
1. **第一优先级 (立即执行)**: 接力会话使用健康账号 DDAI，执行 edit 修改 sample.txt 并完成交付。
\`\`\``,
        ],
        "GSC.DDAI@cma-cgm.com"
      );

      // Session C (Successor on DDAI): receives handoff prompt, modifies sample.txt and completes
      const clientC = new MockChatHubClient(
        [
          `THOUGHT: 我是接力执行者 C，已读取交接文档，立即推进第一优先级待办。
\`\`\`action
tool: edit
path: sample.txt
old_string: initial content
new_string: disaster recovery completed content
\`\`\``,
          `THOUGHT: 检查修改已完成，输出最终答复。
FINAL_ANSWER: 🎯 任务接力攻坚成功！已依据高保真交接文档无缝接续，成功将 sample.txt 更新为生产配置并验证完成。`,
        ],
        "GSC.DDAI@cma-cgm.com"
      );

      // Chat client factory returning the appropriate client based on token/session context
      let orchestratorRunCount = 0;
      const chatClientFactory = (token: any, _options: any) => {
        orchestratorRunCount++;
        if (token.email === "GSC.VFU2@cma-cgm.com") {
          return clientA;
        }
        return clientC;
      };

      const cli = new CphPiCli({
        workspaceRoot: tempDir,
        sessionManager,
        pool: pool as any,
        renderer,
        chatClientFactory,
        arbitratorChatClient: clientB,
        maxTurns: 5,
        maxAutonomousHandoffHops: 3,
        isInteractive: false,
      });

      // Override the initial session ID so we can verify deterministic handoff document naming
      const sessionA = cli.initSession();
      sessionA.id = sessionIdA;
      sessionManager.saveSession(sessionA);

      // Execute task through CLI
      await cli.executeTask("检查并更新 sample.txt 生产配置");

      const combinedOutput = capturedOutput.join("");

      // 1. Verify 3-Stage Disaster Recovery Banners were all rendered in stdout
      expect(combinedOutput).toContain("[Disaster-Recovery: 阶一]");
      expect(combinedOutput).toContain("遭遇 429 频控/突发中断");
      expect(combinedOutput).toContain(sessionIdA);

      expect(combinedOutput).toContain("[Disaster-Recovery: 阶二]");
      expect(combinedOutput).toContain("唤起原生 handoff 仲裁微会话");
      expect(combinedOutput).toContain("GSC.DDAI@cma-cgm.com");

      expect(combinedOutput).toContain("[Disaster-Recovery: 阶三]");
      expect(combinedOutput).toContain("灾备接力闭环就绪，接力会话继续攻坚");
      expect(combinedOutput).toContain("阶段 1/3");

      // 2. Verify Session A status and artifacts on disk
      const savedSessionA = sessionManager.loadSession(sessionIdA);
      expect(savedSessionA).toBeDefined();
      expect(savedSessionA!.status).toBe("handed_off");
      expect(savedSessionA!.disasterBlackbox).toBeDefined();
      expect(savedSessionA!.disasterBlackbox).toContain("🚨 事故现场黑匣子快照");
      expect(savedSessionA!.disasterBlackbox).toContain("429_RATE_LIMIT");

      const handoffDocPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionIdA}.md`);
      expect(savedSessionA!.handoffDocPath).toBe(handoffDocPath);
      expect(fs.existsSync(handoffDocPath)).toBe(true);

      const persistedDoc = await readFile(handoffDocPath, "utf8");
      expect(persistedDoc).toContain("CPH-PI 会话高保真接力交接文档");
      expect(persistedDoc).toContain("【任务目标与原始需求】");
      expect(persistedDoc).toContain("【接力第一优先级待办事项 (Actionable Next Steps)】");

      // 3. Verify AccountPool throttled VFU2 and retained DDAI
      expect(pool.throttledAccounts).toContain("gsc.vfu2@cma-cgm.com");

      // 4. Verify Session C (Successor) continued and completed successfully
      const currentSession = cli.getCurrentSession();
      expect(currentSession).toBeDefined();
      expect(currentSession!.id).not.toBe(sessionIdA);
      expect(currentSession!.status).toBe("completed");
      expect(currentSession!.title).toContain("(接力 1)");

      // 5. Verify the business action actually completed in the workspace
      const updatedFileContent = await readFile(testFile, "utf8");
      expect(updatedFileContent).toContain("disaster recovery completed content");

      // 6. Verify final answer box rendered
      expect(combinedOutput).toContain("FINAL ANSWER");
      expect(combinedOutput).toContain("任务接力攻坚成功");
    });
  });

  describe("3. 中途中断 (AbortController / Ctrl+C) 安全性验证", () => {
    it("should gracefully abort mid-flight during disaster relay without deadlock and preserve handoff doc", async () => {
      const sessionIdA = "ses_victim_abort_test";
      const renderer = createCapturingRenderer();
      const pool = new MockAccountPool([
        "GSC.VFU2@cma-cgm.com",
        "GSC.DDAI@cma-cgm.com",
      ]);

      const clientA = new MockChatHubClient(
        [
          new Error("429 Too Many Requests: Rate limit quota exceeded by Sydney upstream"),
        ],
        "GSC.VFU2@cma-cgm.com"
      );

      const clientB = new MockChatHubClient(
        [
          `\`\`\`action
tool: write_file
path: .cph/handoffs/handoff-${sessionIdA}.md
content: # 🔄 CPH-PI 会话高保真接力交接文档 (Aborted Mid-Flight)
## 1. 【任务目标与原始需求】
- 原始任务: 中断测试
\`\`\``,
        ],
        "GSC.DDAI@cma-cgm.com"
      );

      let cliInstance: CphPiCli;

      const chatClientFactory = (token: any, _options: any) => {
        if (token.email === "GSC.VFU2@cma-cgm.com") {
          return clientA;
        }
        // Successor client triggers interrupt controller abort on first invocation!
        cliInstance.getInterruptController().handleSigint();
        return new MockChatHubClient([
          new Error("Aborted mid-stream"),
        ], "GSC.DDAI@cma-cgm.com");
      };

      cliInstance = new CphPiCli({
        workspaceRoot: tempDir,
        sessionManager,
        pool: pool as any,
        renderer,
        chatClientFactory,
        arbitratorChatClient: clientB,
        maxTurns: 3,
        isInteractive: false,
      });

      const sessionA = cliInstance.initSession();
      sessionA.id = sessionIdA;
      sessionManager.saveSession(sessionA);

      await cliInstance.executeTask("测试中途中断安全性");

      const combinedOutput = capturedOutput.join("");

      // 1. Should have rendered abort notice gracefully
      expect(combinedOutput).toContain("已拦截 Ctrl+C");

      // 2. The handoff doc from session B should be safely preserved
      const handoffDocPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionIdA}.md`);
      expect(fs.existsSync(handoffDocPath)).toBe(true);

      // 3. Session A should be preserved as handed_off
      const savedSessionA = sessionManager.loadSession(sessionIdA);
      expect(savedSessionA).toBeDefined();
      expect(savedSessionA!.status).toBe("handed_off");
    });
  });
});
