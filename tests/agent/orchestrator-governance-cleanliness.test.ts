import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  CopilotOrchestrator,
  type TurnRecord,
  type IOrchestratorChatClient,
  type IAccountPool,
} from "../../src/agent/orchestrator.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

class MockChatClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public callCount = 0;
  public sentPrompts: string[] = [];
  public token = { email: "dev@contoso.com" };

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    const resp = this.responses[this.callCount] ?? "FINAL_ANSWER: Done";
    this.callCount++;
    return { text: resp };
  }
}

class MockAccountPool implements IAccountPool {
  public releasedSessions: string[] = [];
  public requestedTokens: any[] = [];
  public currentLeases = new Map<string, string>();

  markThrottled(email: string, durationMs?: number, reason?: "daily" | "burst"): void {}

  async getNextAvailableToken(options?: any): Promise<any> {
    this.requestedTokens.push(options);
    if (options?.sessionId) {
      this.currentLeases.set(options.sessionId, "dev@contoso.com");
    }
    return { email: "dev@contoso.com", token: "mock-token" };
  }

  releaseSessionLease(sessionId: string): void {
    this.releasedSessions.push(sessionId);
    this.currentLeases.delete(sessionId);
  }

  refreshAccountList() {
    return [{ email: "dev@contoso.com" }];
  }
}

describe("CR-3 Harness Governance Cleanliness & Neutrality (AGENTS.md Principles 1, 3, 6)", () => {
  let tempDir: string;
  let orchestrator: CopilotOrchestrator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-governance-test-"));
    orchestrator = new CopilotOrchestrator({
      modelTone: "balanced",
      workspaceRoot: tempDir,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should NOT inject specialized .NET/winget environment blocker heuristics or negative prohibition phrases into handoff markdown", () => {
    const task = "排查模块构建与依赖环境";
    const history: TurnRecord[] = [
      {
        turn: 1,
        userInput: "请帮我配置环境并构建项目",
        thought: "检测到可能缺少运行时，尝试执行 winget 安装",
        action: {
          tool: "run_command",
          command: "winget install --id Microsoft.DotNet.SDK.8 --exact",
        },
        toolName: "run_command",
        toolOutput: "Error: 0x80070005 access is denied. winget failed to install Microsoft.DotNet.SDK.8.",
        success: false,
      },
      {
        turn: 2,
        userInput: "检查 dotnet 是否可用",
        thought: "运行 dotnet --list-sdks 验证当前是否已存在 .NET SDK",
        action: {
          tool: "run_command",
          command: "dotnet --list-sdks",
        },
        toolName: "run_command",
        toolOutput: "No .NET SDKs were found.",
        success: false,
      },
    ];

    const doc = orchestrator.generateHandoffSnapshot(task, history, "session-gov-001");

    // 1. Strict governance: MUST NOT contain hardcoded third-party environment blocker patches
    expect(doc).not.toContain("环境卡点: 缺少 .NET SDK 8 环境或安装中断，导致相关组件构建受阻");
    expect(doc).not.toContain("包管理卡点: winget 自动化安装受提权或系统策略限制中断");
    expect(doc).not.toContain("权限卡点: 操作系统权限拒绝 (Access is denied)");
    expect(doc).not.toContain("脚本语法卡点: PowerShell 转义或类型名称格式错误");
    expect(doc).not.toContain("识别的环境与系统卡点特征");

    // 2. Strict governance: MUST NOT contain negative prohibition phrases (Principle 3: Constructive guidance over prohibitions)
    expect(doc).not.toContain("切勿盲目重复调用 winget");
    expect(doc).not.toContain("切勿");
    expect(doc).not.toContain("环境修复指引: 检测到 .NET SDK / winget");

    // 3. Harness neutrality & Blackbox contract (Principles 1 & 6):
    expect(doc).toContain("【关键卡点、报错与最新诊断】");
    expect(doc).toContain("winget install --id Microsoft.DotNet.SDK.8 --exact");
    expect(doc).toContain("dotnet --list-sdks");
    expect(doc).toContain("No .NET SDKs were found.");

    // Actionable next steps are constructive and neutral
    expect(doc).toContain("【接力第一优先级待办事项 (Actionable Next Steps)】");
    expect(doc).toContain("第一优先级 (立即执行/优先处理)");
    expect(doc).toContain("dotnet --list-sdks");
    expect(doc).toContain("接力执行剩余需求");
  });

  it("should objectively present failures for generic programming environments without leaking host assumptions", () => {
    const task = "构建 Python / Rust 数据处理服务";
    const history: TurnRecord[] = [
      {
        turn: 1,
        userInput: "构建数据服务",
        thought: "编译 Rust 核心扩展",
        action: {
          tool: "run_command",
          command: "cargo build --release",
        },
        toolName: "run_command",
        toolOutput: "error[E0432]: unresolved import `serde_json`",
        success: false,
      },
    ];

    const doc = orchestrator.generateHandoffSnapshot(task, history, "session-gov-002");

    expect(doc).not.toContain(".NET SDK");
    expect(doc).not.toContain("winget");
    expect(doc).not.toContain("切勿");

    expect(doc).toContain("cargo build --release");
    expect(doc).toContain("unresolved import `serde_json`");
  });

  // ================= Task 3 Specific Governance & Cleanliness Tests =================

  it("Seal Point A: should intercept < 50 byte inline handoff, clean 0-byte file, and fallback to snapshot synthesis >= 50 bytes", async () => {
    const handoffsDir = path.join(tempDir, ".cph", "handoffs");
    fs.mkdirSync(handoffsDir, { recursive: true });
    const targetSessionId = "test-empty-handoff-session";
    const docPath = path.join(handoffsDir, `handoff-${targetSessionId}.md`);
    // Pre-create a damaged 0-byte handoff file
    fs.writeFileSync(docPath, "", "utf8");
    expect(fs.statSync(docPath).size).toBe(0);

    // Client emits an empty handoff block
    const mockClient = new MockChatClient([
      "```handoff\n```",
    ]);

    const orch = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      chatClient: mockClient,
      sessionId: targetSessionId,
      isHandshakePending: false,
    });

    const result = await orch.run({
      task: "重构鉴权模块并执行测试",
      sessionId: targetSessionId,
    });

    expect(result.handedOff).toBe(true);
    expect(result.handoffSnapshot).toBeDefined();
    expect(result.handoffSnapshot!.length).toBeGreaterThanOrEqual(50);
    expect(fs.existsSync(docPath)).toBe(true);
    const persistedContent = fs.readFileSync(docPath, "utf8");
    expect(persistedContent.length).toBeGreaterThanOrEqual(50);
    expect(persistedContent).toContain("【任务目标与原始需求】");
  });

  it("Seal Point B: should intercept 0-byte arbitration output and overwrite with disasterBlackbox >= 50 bytes", async () => {
    const handoffsDir = path.join(tempDir, ".cph", "handoffs");
    fs.mkdirSync(handoffsDir, { recursive: true });
    const sessionId = "session-victim-123";
    const docPath = path.join(handoffsDir, `handoff-${sessionId}.md`);
    // Pre-create damaged 0-byte arbitration file
    fs.writeFileSync(docPath, "", "utf8");
    expect(fs.statSync(docPath).size).toBe(0);

    // Arbitrator client returns empty text or action without content
    const arbClient = new MockChatClient([
      "",
    ]);

    const orch = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      sessionId,
      arbitratorChatClient: arbClient,
    });

    const res = await (orch as any).executeDisasterRecoveryArbitration({
      task: "紧急容灾恢复任务",
      history: [],
      client: {} as any,
      lastError: "Rate limit 429",
      sessionId,
      arbitratorChatClient: arbClient,
    });

    expect(res.handedOff).toBe(true);
    expect(fs.existsSync(docPath)).toBe(true);
    const fileContent = fs.readFileSync(docPath, "utf8");
    expect(fileContent.length).toBeGreaterThanOrEqual(50);
    expect(fileContent).toContain("事故现场黑匣子快照");
    expect(fileContent).toContain("429_RATE_LIMIT");
  });

  it("Real Ledger Path: generateHandoffSnapshot should reference .cph/state/execution-ledger.jsonl instead of nonexistent wal.jsonl", () => {
    const stateDir = path.join(tempDir, ".cph", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const jsonlPath = path.join(stateDir, "execution-ledger.jsonl");

    // Write mock ledger entries to the real execution-ledger.jsonl path
    const entry1 = {
      stepIndex: 1,
      canonicalTool: "read_file",
      actionTarget: "src/auth/token-manager.ts",
      success: true,
      timestamp: Date.now(),
    };
    const entry2 = {
      stepIndex: 2,
      canonicalTool: "run_command",
      actionTarget: "bun test",
      success: true,
      timestamp: Date.now(),
    };
    fs.writeFileSync(jsonlPath, `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}\n`, "utf8");

    const snapshot = orchestrator.generateHandoffSnapshot("执行账本验证", [], "session-ledger-test");

    // MUST NOT reference nonexistent wal.jsonl
    expect(snapshot).not.toContain("wal.jsonl");
    // MUST reference real ledger path and incorporate entries
    expect(snapshot).toContain("execution-ledger.jsonl");
    expect(snapshot).toContain("src/auth/token-manager.ts");
    expect(snapshot).toContain("bun test");
  });

  it("Session Lease Lifecycle: orchestrator.run() should release session lease in finally block on exit", async () => {
    const mockPool = new MockAccountPool();
    const mockClient = new MockChatClient(["FINAL_ANSWER: Success!"]);

    const orch = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      chatClient: mockClient,
      pool: mockPool,
      sessionId: "session-lease-test-1",
      isHandshakePending: false,
    });

    await orch.run({
      task: "测试正常退出释放租约",
      sessionId: "session-lease-test-1",
    });

    expect(mockPool.releasedSessions).toContain("session-lease-test-1");
  });

  it("Session Lease Lifecycle: orchestrator.run() should release session lease in finally block on exception", async () => {
    const mockPool = new MockAccountPool();
    const throwingClient: IOrchestratorChatClient = {
      sendMessage: async () => {
        throw new Error("Fatal network crash");
      },
    };

    const orch = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      chatClient: throwingClient,
      pool: mockPool,
      sessionId: "session-lease-error-test",
      isHandshakePending: false,
    });

    try {
      await orch.run({
        task: "测试异常退出释放租约",
        sessionId: "session-lease-error-test",
      });
    } catch {
      // Expected error
    }

    expect(mockPool.releasedSessions).toContain("session-lease-error-test");
  });

  it("Generational Virtualization: should release previous generation lease and request token with nextSessionId", async () => {
    const mockPool = new MockAccountPool();
    const initialSessionId = "session-gen-root";
    const subagentAction = "```action\ntool: invoke_subagent\nsubagents:\n  - role: coder\n    prompt: write unit tests\n```";
    const finalAnswer = "FINAL_ANSWER: All done";

    const mockClient = new MockChatClient([subagentAction, finalAnswer]);
    const mockRunner = {
      executeBatch: async () => [
        { id: "sub-1", role: "coder", success: true, finalAnswer: "Tests written", deliverablePath: ".cph/reports/r.md" },
      ],
      formatReportSummary: () => "Summary of reports",
    };

    const orch = new CopilotOrchestrator({
      workspaceRoot: tempDir,
      chatClientFactory: () => mockClient,
      pool: mockPool,
      subagentRunner: mockRunner,
      sessionId: initialSessionId,
      isHandshakePending: false,
    });

    await orch.run({
      task: "测试世代接力租约释放",
      sessionId: initialSessionId,
    });

    // Root session must have been released during generational handover
    expect(mockPool.releasedSessions).toContain(initialSessionId);
    // Successor generation must have requested a token with sessionId
    const successorTokenReq = mockPool.requestedTokens.find(
      (req) => req?.sessionId && req.sessionId.includes("_gen2")
    );
    expect(successorTokenReq).toBeDefined();
  });

  it("Constructive Guidance: prompt and skill files MUST NOT contain negative prohibition phrases", () => {
    const projectRoot = path.resolve(__dirname, "../../");
    const filesToCheck = [
      path.join(projectRoot, "src/agent/orchestrator.ts"),
      path.join(projectRoot, "src/agent/subagent-runner.ts"),
      path.join(projectRoot, "src/protocol/prompt-builder.ts"),
      path.join(projectRoot, "skills/handoff/SKILL.md"),
    ];

    // Negative prohibition keywords forbidden by AGENTS.md Principle 3
    const forbiddenPatterns = [
      "严禁",
      "切勿",
      "绝不",
      "绝不允许",
    ];

    for (const filePath of filesToCheck) {
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf8");

      for (const pattern of forbiddenPatterns) {
        // Exclude this test file itself and comments explaining principles if any
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip pure English comments or instructions referencing AGENTS.md rules about prohibitions
          if (line.includes("Principle 3") || line.includes("禁止词") || line.includes("负面词")) {
            continue;
          }
          if (line.includes(pattern)) {
            throw new Error(`File ${filePath}:${i + 1} contains forbidden prohibition '${pattern}':\n${line.trim()}`);
          }
        }
      }
    }
  });

  it("ToolBridge Neutrality: ToolBridge must NOT inject Notice or subjective lecturing into tool output", async () => {
    const bridge = new ToolBridge(tempDir);
    const testFile = path.join(tempDir, "sample.txt");
    const rawContent = "Hello, world!\nLine 2\nLine 3";
    fs.writeFileSync(testFile, rawContent, "utf8");

    const result = await bridge.executeAction({
      tool: "read_file",
      path: testFile,
    });

    expect(result.success).toBe(true);
    // Raw output MUST be 100% pure without notices
    expect(result.rawOutput).toBe(rawContent);
    expect(result.output).not.toContain("Notice:");
    expect(result.output).not.toContain("Notice");
  });
});
