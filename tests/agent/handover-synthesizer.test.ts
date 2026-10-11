import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import fs from "fs";
import {
  Orchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";
import type { TurnRecord } from "../../src/agent/compaction.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

class MockChatHubClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    const text = this.responses[this.callCount] || "FINAL_ANSWER: Done";
    this.callCount++;
    return { text };
  }
}

describe("Handover Document Synthesizer (Task 3)", () => {
  let tempDir: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-handover-test-"));
    orchestrator = new Orchestrator({
      workspaceRoot: tempDir,
      maxTurns: 3,
    });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. 5-Dimensional Structured Module Extraction", () => {
    it("should extract all 5 dimensions with high fidelity from rich session history", () => {
      const task = '审查 "E:\\test\\Library\\CNNJI QUERY" 项目并输出报告到 E:\\test\\test';
      const history: TurnRecord[] = [
        {
          turn: 1,
          thought: "先递归盘点整个工作区结构并确认 Git 状态",
          action: {
            tool: "run_command",
            command: "git status -s",
          },
          toolName: "run_command",
          toolOutput: "## main\n?? Library/\n",
          success: true,
        },
        {
          turn: 2,
          thought: "读取项目核心模块 shared/modules/JsygtClient.psm1",
          action: {
            tool: "read_file",
            path: "shared/modules/JsygtClient.psm1",
          },
          toolName: "read_file",
          toolOutput: "function Invoke-JsygtQuery { ... }",
          success: true,
        },
        {
          turn: 3,
          thought: "修改配置文件以修复端口冲突",
          action: {
            tool: "edit",
            path: "web/config.json",
            old_string: '"port": 8080',
            new_string: '"port": 8088',
          },
          toolName: "edit",
          toolOutput: "File updated successfully",
          success: true,
        },
        {
          turn: 4,
          thought: "生成测试报告脚手架",
          action: {
            tool: "write_file",
            path: "test/audit-summary.md",
            content: "# Audit Summary",
          },
          toolName: "write_file",
          toolOutput: "File created successfully",
          success: true,
        },
        {
          turn: 5,
          thought: "尝试使用 winget 安装 .NET SDK 8 以支持 OCR 模块构建",
          action: {
            tool: "run_command",
            command: "winget install --id Microsoft.DotNet.SDK.8 --exact",
          },
          toolName: "run_command",
          toolOutput: "Error: winget failed with exit code 0x80070005: Access is denied. .NET SDK 8 installation interrupted.",
          success: false,
        },
        {
          turn: 6,
          thought: "由于 winget 提权失败，检测到 .NET SDK 8 缺失无法编译 JsygtOcr.csproj，需要切换为免安装 zip 包或由用户手动安装",
          action: {
            tool: "run_command",
            command: "dotnet --list-sdks",
          },
          toolName: "run_command",
          toolOutput: "No .NET SDKs were found.",
          success: false,
        },
      ];

      const doc = orchestrator.generateHandoffSnapshot(task, history, "test-session-001");

      // ① 【任务目标与原始需求】
      expect(doc).toContain("【任务目标与原始需求】");
      expect(doc).toContain(task);
      expect(doc).toContain(tempDir);

      // ② 【已验证客观事实与阶段性成果】
      expect(doc).toContain("【已验证客观事实与阶段性成果】");
      expect(doc).toContain("shared/modules/JsygtClient.psm1");
      expect(doc).toContain("git status -s");

      // ③ 【关键卡点、报错与最新诊断】
      expect(doc).toContain("【关键卡点、报错与最新诊断】");
      expect(doc).toMatch(/\.NET SDK|winget|Access is denied|No \.NET SDKs were found/i);
      expect(doc).toMatch(/提权失败|\.NET SDK 8 缺失|无法编译/);

      // ④ 【已修改/生成文件清单】
      expect(doc).toContain("【已修改/生成文件清单】");
      expect(doc).toContain("web/config.json");
      expect(doc).toContain("test/audit-summary.md");

      // ⑤ 【接力第一优先级待办事项 (Actionable Next Steps)】
      expect(doc).toContain("【接力第一优先级待办事项 (Actionable Next Steps)】");
      expect(doc).toMatch(/第一优先级|立即执行|优先处理/);
      expect(doc).toMatch(/\.NET SDK|winget|dotnet/i);
    });
  });

  describe("2. Document Disk Persistence to <workspaceRoot>/.cph/handoffs/", () => {
    it("should write handover document to .cph/handoffs/handoff-<sessionId>.md and match return string", async () => {
      const task = "构建用户系统";
      const history: TurnRecord[] = [
        {
          turn: 1,
          thought: "初始化项目结构",
          action: { tool: "write_file", path: "src/user.ts", content: "export class User {}" },
          toolName: "write_file",
          toolOutput: "ok",
          success: true,
        },
      ];

      const sessionId = "ses_20261010_test_disk";
      const doc = orchestrator.generateHandoffSnapshot(task, history, sessionId);

      const targetPath = join(tempDir, ".cph", "handoffs", `handoff-${sessionId}.md`);
      expect(fs.existsSync(targetPath)).toBe(true);

      const savedContent = await readFile(targetPath, "utf8");
      expect(savedContent).toBe(doc);
    });

    it("should integrate with Orchestrator.run and return handoffDocPath when max turns exceeded", async () => {
      // Setup mock client that always requests actions, exhausting maxTurns (3)
      const mockResponses = [
        `\`\`\`action
tool: run_command
command: echo step1
\`\`\``,
        `\`\`\`action
tool: run_command
command: echo step2
\`\`\``,
        `\`\`\`action
tool: run_command
command: echo step3
\`\`\``,
      ];

      const client = new MockChatHubClient(mockResponses);
      const testSessionId = "ses_run_max_turns_123";
      const runOrch = new Orchestrator({
        workspaceRoot: tempDir,
        maxTurns: 3,
        chatClient: client,
        sessionId: testSessionId,
      });

      let firedHandoffSnapshot = "";
      let firedHandoffDocPath: string | undefined = "";

      const result = await runOrch.run({
        task: "持续执行直到轮次耗尽",
        sessionId: testSessionId,
        events: {
          onHandoff: (snapshot, docPath) => {
            firedHandoffSnapshot = snapshot;
            firedHandoffDocPath = docPath;
          },
        },
      });

      expect(result.handedOff).toBe(true);
      expect(result.completed).toBe(false);
      expect(result.handoffSnapshot).toBeDefined();
      expect(result.handoffDocPath).toBeDefined();

      const expectedDocPath = join(tempDir, ".cph", "handoffs", `handoff-${testSessionId}.md`);
      expect(result.handoffDocPath).toBe(expectedDocPath);
      expect(firedHandoffDocPath).toBe(expectedDocPath);
      expect(firedHandoffSnapshot).toBe(result.handoffSnapshot!);
      expect(fs.existsSync(expectedDocPath)).toBe(true);

      const fileContent = await readFile(expectedDocPath, "utf8");
      expect(fileContent).toBe(result.handoffSnapshot!);
    });
  });

  describe("3. Edge Cases & Graceful Degradation", () => {
    it("should gracefully handle empty history", () => {
      const doc = orchestrator.generateHandoffSnapshot("空历史测试任务", []);

      expect(doc).toContain("【任务目标与原始需求】");
      expect(doc).toContain("空历史测试任务");
      expect(doc).toContain("【已验证客观事实与阶段性成果】");
      expect(doc).toContain("【关键卡点、报错与最新诊断】");
      expect(doc).toContain("【已修改/生成文件清单】");
      expect(doc).toContain("【接力第一优先级待办事项 (Actionable Next Steps)】");
      // Fallback notices
      expect(doc).toMatch(/暂无已执行的物理动作|未执行/);
      expect(doc).toMatch(/运行健康|无关键错误卡点|无报错/);
      expect(doc).toMatch(/未修改或新建文件|未产生文件修改/);
    });

    it("should gracefully handle healthy session with all successful actions and no errors", () => {
      const history: TurnRecord[] = [
        {
          turn: 1,
          thought: "成功读取 readme",
          action: { tool: "read_file", path: "README.md" },
          toolName: "read_file",
          toolOutput: "# Hello World",
          success: true,
        },
        {
          turn: 2,
          thought: "成功修改 readme 增加文档",
          action: { tool: "edit", path: "README.md", old_string: "World", new_string: "CPH-PI" },
          toolName: "edit",
          toolOutput: "File updated",
          success: true,
        },
      ];

      const doc = orchestrator.generateHandoffSnapshot("文档更新任务", history);

      expect(doc).toContain("【关键卡点、报错与最新诊断】");
      expect(doc).toMatch(/运行健康|无关键错误卡点|无报错/);
      expect(doc).toContain("【已修改/生成文件清单】");
      expect(doc).toContain("README.md");
    });

    it("should gracefully handle pure dialogue turns with no tool calls", () => {
      const history: TurnRecord[] = [
        {
          turn: 1,
          userInput: "你好，请评估架构",
          thought: "分析用户提问并给出架构建议",
          response: "建议采用分层架构...",
        },
        {
          turn: 2,
          userInput: "请继续展开细节",
          thought: "继续阐述分层细节",
          response: "表现层与服务层解耦...",
        },
      ];

      const doc = orchestrator.generateHandoffSnapshot("架构咨询任务", history);

      expect(doc).toContain("【任务目标与原始需求】");
      expect(doc).toContain("架构咨询任务");
      expect(doc).toContain("【已验证客观事实与阶段性成果】");
      expect(doc).toMatch(/暂无已执行的物理动作|对话/);
      expect(doc).toContain("【接力第一优先级待办事项 (Actionable Next Steps)】");
    });

    it("should truncate and condense massive tool outputs (>500KB) without blowing up document size", () => {
      const massiveOutput = "A".repeat(600_000) + "\nError: fatal crash occurred at line 999\n" + "B".repeat(10_000);
      const history: TurnRecord[] = [
        {
          turn: 1,
          thought: "执行超大输出诊断命令",
          action: { tool: "run_command", command: "cat huge.log" },
          toolName: "run_command",
          toolOutput: massiveOutput,
          success: false,
        },
      ];

      const doc = orchestrator.generateHandoffSnapshot("大输出压力测试", history);

      // Document should capture the critical error but remain compact (< 15KB)
      expect(doc).toMatch(/fatal crash|Error/);
      expect(doc.length).toBeLessThan(15_000);
    });
  });
});
