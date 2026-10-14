import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CopilotOrchestrator, TurnRecord } from "../../src/agent/orchestrator";

describe("CR-3 Harness Governance Cleanliness & Neutrality (AGENTS.md Principles 1, 3, 6)", () => {
  let tempDir: string;
  let orchestrator: CopilotOrchestrator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-governance-test-"));
    orchestrator = new CopilotOrchestrator({
      model: "gpt-4o",
      copilotToken: "dummy-token",
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

    // Call generateHandoffMarkdown (or generateHandoffSnapshot)
    const doc = orchestrator.generateHandoffMarkdown
      ? orchestrator.generateHandoffMarkdown(task, history, "session-gov-001")
      : orchestrator.generateHandoffSnapshot(task, history, "session-gov-001");

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
    // Objectively records the actual failed command and output context without biased editorializing
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

    const doc = orchestrator.generateHandoffMarkdown
      ? orchestrator.generateHandoffMarkdown(task, history, "session-gov-002")
      : orchestrator.generateHandoffSnapshot(task, history, "session-gov-002");

    // Must be completely free of .NET or winget references
    expect(doc).not.toContain(".NET SDK");
    expect(doc).not.toContain("winget");
    expect(doc).not.toContain("切勿");

    // Must cleanly record the cargo error
    expect(doc).toContain("cargo build --release");
    expect(doc).toContain("unresolved import `serde_json`");
  });
});
