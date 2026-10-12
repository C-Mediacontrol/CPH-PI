import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Orchestrator, type IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import { RefusalGuard } from "../../src/agent/refusal-guard.ts";
import type { TurnRecord } from "../../src/agent/compaction.ts";

describe("CR-02 Governance Charter Alignment & Harness Neutrality Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-governance-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("用例 1: Orchestrator.generateHandoffSnapshot 中立性与禁止词消除", () => {
    it("严禁包含针对 .NET SDK、dotnet、winget、[System.IO.Path] 的硬编码特化分支，也不得包含“切勿盲目重复调用 winget”等负面禁止词，必须基于历史动作事实进行中立客观摘要", () => {
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
      });

      const history: TurnRecord[] = [
        {
          turn: 1,
          thought: "尝试运行 dotnet 检查环境",
          action: {
            tool: "run_command",
            command: "dotnet --version",
          },
          toolName: "run_command",
          toolOutput: "dotnet: command not found (missing .NET SDK)",
          success: false,
        },
        {
          turn: 2,
          thought: "尝试通过 winget 安装",
          action: {
            tool: "run_command",
            command: "winget install Microsoft.DotNet.SDK.8",
          },
          toolName: "run_command",
          toolOutput: "0x80070005: Access is denied. winget installation failed",
          success: false,
        },
        {
          turn: 3,
          thought: "测试路径处理脚本",
          action: {
            tool: "run_command",
            command: "powershell -Command [System.IO.Path]::GetFullPath('.')",
          },
          toolName: "run_command",
          toolOutput: "TypeNotFound: [System.IO.Path\\] could not be found",
          success: false,
        },
      ];

      const snapshot = orchestrator.generateHandoffSnapshot(
        "构建并部署 .NET 审计分析工具",
        history,
        "ses_governance_test_01"
      );

      // 严禁包含硬编码的环境卡点特化识别与系统推断分支
      expect(snapshot).not.toContain("识别的环境与系统卡点特征");
      expect(snapshot).not.toContain("环境卡点: 缺少 .NET SDK 8 环境");
      expect(snapshot).not.toContain("包管理卡点: winget 自动化安装受提权");
      expect(snapshot).not.toContain("权限卡点: 操作系统权限拒绝");
      expect(snapshot).not.toContain("脚本语法卡点: PowerShell 转义或类型名称格式错误");

      // 严禁包含负面禁止词与特化修复指引
      expect(snapshot).not.toContain("切勿盲目重复调用 winget");
      expect(snapshot).not.toContain("环境修复指引");

      // 必须基于历史事实进行中立客观摘要
      expect(snapshot).toContain("dotnet --version");
      expect(snapshot).toContain("dotnet: command not found");
      expect(snapshot).toContain("winget install Microsoft.DotNet.SDK.8");
      expect(snapshot).toContain("Access is denied");
      expect(snapshot).toContain("TypeNotFound");
    });
  });

  describe("用例 2: PromptBuilder.PROTOCOL_REMINDER 建设性正向指引", () => {
    it("必须全面转为建设性的正向行动指引，严禁出现“严禁输出工具块”等负面禁止词", () => {
      const reminder = PromptBuilder.PROTOCOL_REMINDER;

      // 正向建设性指引断言
      expect(reminder).toContain("若全部步骤已完成且无需后续动作，请直接输出任务交付总结：");
      expect(reminder).toContain("FINAL_ANSWER: <任务交付总结说明>");

      // 负面禁止词排查断言
      expect(reminder).not.toContain("严禁输出工具块");
      expect(reminder).not.toContain("严禁");
      expect(reminder).not.toContain("切勿");
    });
  });

  describe("用例 3: RefusalGuard.detectRefusal 正常技术与代码审计陈述免误判", () => {
    it("面对正常的代码审计、技术架构陈述（如提及“缺少待审计项目源码”、“未能连接到测试服务”），严禁误判为沙箱拒答", () => {
      // 包含“缺少待审计项目源码”的代码审查陈述
      expect(
        RefusalGuard.detectRefusal("在分析中发现缺少待审计项目源码的单元测试，需进一步补充测试用例。")
      ).toBe(false);

      // 包含“未能连接到测试服务”的真实测试输出或陈述
      expect(
        RefusalGuard.detectRefusal("执行测试套件时未能连接到测试服务（localhost:8080），正在重试。")
      ).toBe(false);

      // 包含技术性 Harness 陈述或外部依赖陈述
      expect(
        RefusalGuard.detectRefusal("架构审查结果：当前客户端模块并未连接到外部测试 Harness，保持了纯粹中立。")
      ).toBe(false);

      // 包含常规测试覆盖率描述
      expect(
        RefusalGuard.detectRefusal("经代码审计，目标模块缺少待审计项目源码的类型校验与边界防御。")
      ).toBe(false);
    });

    it("仍然准确拦截真实的沙箱拒答妄想", () => {
      expect(
        RefusalGuard.detectRefusal("抱歉，我无法直接访问你的本地路径 E:\\copilot-web proxy。")
      ).toBe(true);
      expect(
        RefusalGuard.detectRefusal("由于安全限制，看不到该项目目录，请上传 zip 压缩包。")
      ).toBe(true);
      expect(
        RefusalGuard.detectRefusal("I cannot directly access your local file system or disk drive.")
      ).toBe(true);
    });
  });

  describe("用例 4: 编排器处理拒答重试切号不误封正常账号", () => {
    it("编排器处理拒答重试切号时，不得调用 pool.markThrottled 错封正常账号", async () => {
      let markThrottledCalled = false;
      let throttledEmail = "";

      const mockPool: any = {
        async getNextAvailableToken() {
          return {
            email: "switched_account@example.com",
            accessToken: "mock-token-2",
          };
        },
        markThrottled(email: string) {
          markThrottledCalled = true;
          throttledEmail = email;
        },
      };

      let callCount = 0;
      const initialClient: IOrchestratorChatClient = {
        token: { email: "healthy_initial_account@example.com" },
        async sendMessage() {
          callCount++;
          if (callCount <= 3) {
            return {
              text: "抱歉，我无法直接访问你的本地路径 E:\\test，请上传项目压缩包。",
            };
          }
          return {
            text: "FINAL_ANSWER: 任务交付完成",
          };
        },
      } as any;

      const switchedClient: IOrchestratorChatClient = {
        token: { email: "switched_account@example.com" },
        async sendMessage() {
          return {
            text: "FINAL_ANSWER: 切号后成功交付",
          };
        },
      } as any;

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        pool: mockPool,
        chatClient: initialClient,
        chatClientFactory: () => switchedClient,
        maxRefusalRetries: 3,
        isHandshakePending: false,
      });

      let switchedFrom = "";
      let switchedTo = "";

      const result = await orchestrator.run({
        task: "审计代码库",
        events: {
          onAccountSwitched: (oldEmail, newEmail) => {
            switchedFrom = oldEmail;
            switchedTo = newEmail;
          },
        },
      });

      expect(result.completed).toBe(true);
      expect(switchedFrom).toBe("healthy_initial_account@example.com");
      expect(switchedTo).toBe("switched_account@example.com");

      // 关键核心断言：拒答切号绝不能调用 markThrottled
      expect(markThrottledCalled).toBe(false);
      expect(throttledEmail).toBe("");
    });
  });
});
