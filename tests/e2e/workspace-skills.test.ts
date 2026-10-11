import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  CphPiCli,
  runCli,
  parseCliArgs,
} from "../../src/cli.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { InterruptController } from "../../src/agent/interrupt-controller.ts";
import { SkillRegistry } from "../../src/skills/skill-registry.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";

/**
 * Mock ChatHub Client capturing sent prompts
 */
class CapturingMockChatClient implements IOrchestratorChatClient {
  public sentPrompts: string[] = [];
  public callCount = 0;

  async sendMessage(params: { text: string; [key: string]: any }): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    this.callCount++;
    if (this.callCount === 1) {
      return {
        text: "```action\ntool: run_command\ncommand: git status\n```",
      };
    }
    return {
      text: "FINAL_ANSWER: 任务已在专属技能指导下成功达成。",
    };
  }
}

describe("OpenCode Workspace Launch & Skill Slash Commands E2E Tests", () => {
  let tempWorkspace: string;
  let tempCallerDir: string;
  let outputBuffer: string[];
  let renderer: TuiRenderer;
  let interruptController: InterruptController;

  beforeEach(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), "cph-pi-opencode-ws-"));
    tempCallerDir = await mkdtemp(join(tmpdir(), "cph-pi-caller-cwd-"));
    outputBuffer = [];
    renderer = new TuiRenderer({
      writer: (chunk: string) => outputBuffer.push(chunk),
    });
    interruptController = new InterruptController({
      idleExitTimeoutMs: 1500,
      autoAttach: false,
    });
  });

  afterEach(async () => {
    delete process.env.CPH_PI_ORIGINAL_CWD;
    if (tempWorkspace) await rm(tempWorkspace, { recursive: true, force: true });
    if (tempCallerDir) await rm(tempCallerDir, { recursive: true, force: true });
  });

  const getRenderedOutput = () => outputBuffer.join("");

  // =========================================================================
  // 1. OpenCode-Style Workspace Priority Resolution
  // =========================================================================
  describe("1. OpenCode-Style Workspace Priority Resolution", () => {
    it("should respect explicit -w / --workspace flag as top priority", () => {
      const parsed1 = parseCliArgs(["-w", tempWorkspace, "run", "diagnostics"]);
      expect(parsed1.workspaceRoot).toBe(tempWorkspace);
      expect(parsed1.task).toBe("run diagnostics");

      const parsed2 = parseCliArgs([`--workspace=${tempWorkspace}`, "audit"]);
      expect(parsed2.workspaceRoot).toBe(tempWorkspace);
      expect(parsed2.task).toBe("audit");
    });

    it("should identify first positional argument as workspace if it is an existing directory", () => {
      const parsed = parseCliArgs([tempWorkspace, "fix", "memory", "leak"]);
      expect(parsed.workspaceRoot).toBe(tempWorkspace);
      expect(parsed.task).toBe("fix memory leak");
    });

    it("should identify '.' as workspace and merge remaining positional args as task", () => {
      process.env.CPH_PI_ORIGINAL_CWD = tempCallerDir;
      const parsed = parseCliArgs([".", "implement", "feature"]);
      expect(parsed.workspaceRoot).toBe(tempCallerDir);
      expect(parsed.task).toBe("implement feature");
    });

    it("should not consume first positional argument if it is not a valid directory or '.'", () => {
      const parsed = parseCliArgs(["build", "production", "bundle"]);
      expect(parsed.task).toBe("build production bundle");
      // workspaceRoot falls back to current working directory
      expect(parsed.workspaceRoot).toBeDefined();
    });

    it("should prioritize CPH_PI_ORIGINAL_CWD when launching with '.' or default", () => {
      process.env.CPH_PI_ORIGINAL_CWD = tempCallerDir;
      const parsed = parseCliArgs([]);
      expect(parsed.workspaceRoot).toBe(tempCallerDir);
      expect(parsed.task).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Startup Banner Workspace Printing
  // =========================================================================
  describe("2. Startup Banner Workspace Printing", () => {
    it("should print '工作区根目录: <resolvedWorkspace>' in startup banner", () => {
      renderer.renderBanner(tempWorkspace);
      const output = getRenderedOutput();

      expect(output).toContain("CPH-PI: Copilot M365 x Pi Autonomous Coding Terminal");
      expect(output).toContain("工作区根目录:");
      expect(output).toContain(tempWorkspace);
    });
  });

  // =========================================================================
  // 3. Interactive CLI Skill Management (/skills, /skill, /skills find)
  // =========================================================================
  describe("3. Interactive CLI Skill Management (/skills, /skill, /skills find)", () => {
    let skillRegistry: SkillRegistry;
    let cli: CphPiCli;

    beforeEach(async () => {
      // Create local skills in tempWorkspace/.skills
      const skillDir = join(tempWorkspace, ".skills", "brainstorming");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: brainstorming
description: 探索用户意图、需求与设计
---
【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。`
      );

      const tddDir = join(tempWorkspace, ".skills", "tdd");
      await mkdir(tddDir, { recursive: true });
      await writeFile(
        join(tddDir, "SKILL.md"),
        `---
name: tdd
description: 红绿重构测试驱动开发
---
测试先行原则。`
      );

      cli = new CphPiCli({
        workspaceRoot: tempWorkspace,
        renderer,
        interruptController,
      });
      skillRegistry = cli.getSkillRegistry();
    });

    it("should handle /skills and list detected skills with activation indicator", async () => {
      const stdoutWrites: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutWrites.push(String(chunk));
        return true;
      }) as any;

      try {
        await cli.handleCommand("/skills");
        const output = stdoutWrites.join("");
        expect(output).toContain("[CPH-PI 可用原生技能列表");
        expect(output).toContain("brainstorming");
        expect(output).toContain("tdd");
        expect(output).toContain("[ ]");
      } finally {
        process.stdout.write = origWrite;
      }
    });

    it("should handle /skills find <kw> and filter matching skills", async () => {
      const stdoutWrites: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutWrites.push(String(chunk));
        return true;
      }) as any;

      try {
        await cli.handleCommand("/skills find tdd");
        const output = stdoutWrites.join("");
        expect(output).toContain('搜索结果: 匹配 "tdd" 的技能');
        expect(output).toContain("tdd");
        expect(output).not.toContain("brainstorming");
      } finally {
        process.stdout.write = origWrite;
      }
    });

    it("should toggle skill activation status via /skill <name>", async () => {
      const stdoutWrites: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutWrites.push(String(chunk));
        return true;
      }) as any;

      try {
        // 1. Activate
        await cli.handleCommand("/skill brainstorming");
        expect(stdoutWrites.join("")).toContain("已激活技能: brainstorming");
        expect(skillRegistry.isSkillActive("brainstorming")).toBe(true);

        stdoutWrites.length = 0;
        // 2. Deactivate
        await cli.handleCommand("/skill brainstorming");
        expect(stdoutWrites.join("")).toContain("已停用技能: brainstorming");
        expect(skillRegistry.isSkillActive("brainstorming")).toBe(false);
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  // =========================================================================
  // 4. Skill Slash Command Triggering & Prompt Injection
  // =========================================================================
  describe("4. Skill Slash Command Triggering & Prompt Injection", () => {
    it("should trigger /brainstorming slash command, render badge and inject prompt", async () => {
      // Create custom skill in workspace
      const skillDir = join(tempWorkspace, ".skills", "brainstorming");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: brainstorming
description: 探索用户意图、需求与设计
---
【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。`
      );

      const mockChatClient = new CapturingMockChatClient();
      const cli = new CphPiCli({
        workspaceRoot: tempWorkspace,
        renderer,
        interruptController,
        chatClient: mockChatClient,
      });

      // Execute via handleInputLine with slash command
      await cli.handleInputLine("/brainstorming 帮我构思一个自动化部署管道");

      // Verify TUI highlighted badge rendered
      const rendered = getRenderedOutput();
      expect(rendered).toContain("🎯 [已激活专属技能: brainstorming]");

      // Verify Prompt sent to ChatClient: Turn 1 pure handshake, Turn 2 active skill injection
      expect(mockChatClient.sentPrompts.length).toBe(2);
      expect(mockChatClient.sentPrompts[0]).toContain("【第一轮基准探测握手");
      expect(mockChatClient.sentPrompts[0]).not.toContain("brainstorming");

      const taskPrompt = mockChatClient.sentPrompts[1];
      expect(taskPrompt).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(taskPrompt).toContain("【当前已激活的专业技能 (Skill)】");
      expect(taskPrompt).toContain("brainstorming");
      expect(taskPrompt).toContain("【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。");
      expect(taskPrompt).toContain("帮我构思一个自动化部署管道");
    });

    it("should trigger prefix slash command /brainstorm and map to brainstorming", async () => {
      const skillDir = join(tempWorkspace, ".skills", "brainstorming");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: brainstorming
description: 探索用户意图
---
设计方案探讨指南`
      );

      const mockChatClient = new CapturingMockChatClient();
      const cli = new CphPiCli({
        workspaceRoot: tempWorkspace,
        renderer,
        interruptController,
        chatClient: mockChatClient,
      });

      await cli.handleInputLine("/brainstorm 设计微服务路由");

      const rendered = getRenderedOutput();
      expect(rendered).toContain("🎯 [已激活专属技能: brainstorming]");
      expect(mockChatClient.sentPrompts.length).toBe(2);
      expect(mockChatClient.sentPrompts[0]).toContain("【第一轮基准探测握手");
      expect(mockChatClient.sentPrompts[1]).toContain("设计方案探讨指南");
      expect(mockChatClient.sentPrompts[1]).toContain("设计微服务路由");
    });

    it("should support non-interactive execution with slash command via runCli", async () => {
      const skillDir = join(tempWorkspace, ".skills", "tdd");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: tdd
description: 测试驱动开发
---
公共接口单元测试先行。`
      );

      const mockChatClient = new CapturingMockChatClient();

      const result = await runCli(
        [tempWorkspace, "-t", "/tdd 编写词法分析器测试"],
        {
          renderer,
          interruptController,
          chatClient: mockChatClient,
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("task");

      // Verify prompt injection in Turn 2
      expect(mockChatClient.sentPrompts.length).toBe(2);
      expect(mockChatClient.sentPrompts[0]).toContain("【第一轮基准探测握手");
      const prompt = mockChatClient.sentPrompts[1];
      expect(prompt).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(prompt).toContain("【当前已激活的专业技能 (Skill)】");
      expect(prompt).toContain("tdd");
      expect(prompt).toContain("公共接口单元测试先行。");
      expect(prompt).toContain("编写词法分析器测试");
    });
  });
});
