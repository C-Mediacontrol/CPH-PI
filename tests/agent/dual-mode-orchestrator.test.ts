import { describe, it, expect } from "bun:test";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import type { Skill } from "../../src/skills/skill-loader.ts";

describe("Dual-Mode Orchestrator (Custom Agent vs Handshake)", () => {
  describe("PromptBuilder.buildDirectAgentPrompt", () => {
    it("should build direct prompt for custom agent without verbose tool rules or handshake probe", () => {
      const prompt = PromptBuilder.buildDirectAgentPrompt("E:/test", "修复 index.ts 的 bug");
      expect(prompt).toContain("修复 index.ts 的 bug");
      expect(prompt).toContain("E:/test");
      expect(prompt).not.toContain("【第一轮基准探测握手");
      // 不重复灌入大段 PROTOCOL_REMINDER 避免浪费 Token
      expect(prompt).not.toContain("【交接协议铁律 (Turn Protocol Contract)】");
      // 不包含冗余工具语法定义
      expect(prompt).not.toContain("【可用工具格式 (Tool Calling)】");
    });

    it("should include active skills section when provided", () => {
      const skillsSection = "【技能: tdd】\n执行红绿测试驱动开发。";
      const prompt = PromptBuilder.buildDirectAgentPrompt(
        "C:\\workspace\\project",
        "重构支付模块",
        skillsSection
      );
      expect(prompt).toContain("C:/workspace/project");
      expect(prompt).toContain("重构支付模块");
      expect(prompt).toContain(skillsSection);
      expect(prompt).not.toContain("【第一轮基准探测握手");
      expect(prompt).not.toContain("【交接协议铁律 (Turn Protocol Contract)】");
    });
  });

  describe("CopilotOrchestrator Dual-Mode Dispatch", () => {
    it("should bypass handshake and send business task on Turn 1 when customAgentId is present", async () => {
      let capturedPrompt = "";
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          capturedPrompt = params.text;
          return { text: "FINAL_ANSWER: 已完成修复" };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        customAgentId: "T_custom_agent_id_123",
        chatClient: mockClient as any,
      });

      expect(orchestrator.isHandshakePending).toBe(false);

      const result = await orchestrator.run({ task: "直接开发任务" });
      expect(result.completed).toBe(true);
      expect(capturedPrompt).toContain("直接开发任务");
      expect(capturedPrompt).not.toContain("【第一轮基准探测握手");
      expect(capturedPrompt).not.toContain("【交接协议铁律 (Turn Protocol Contract)】");
      expect(orchestrator.isHandshakePending).toBe(false);
    });

    it("should inject active skills into direct prompt when customAgentId is present", async () => {
      let capturedPrompt = "";
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          capturedPrompt = params.text;
          return { text: "FINAL_ANSWER: 技能驱动任务完成" };
        },
      };

      const sampleSkills: Skill[] = [
        {
          name: "tdd",
          description: "红绿重构测试驱动开发模式",
          content: "【TDD 铁律】先写失败测试。",
          filePath: "/skills/tdd/SKILL.md",
          source: "workspace",
        },
      ];

      const orchestrator = new CopilotOrchestrator({
        customAgentId: "T_custom_agent_id_123",
        chatClient: mockClient as any,
        activeSkills: sampleSkills,
      });

      const result = await orchestrator.run({ task: "按 TDD 编写业务逻辑" });
      expect(result.completed).toBe(true);
      expect(capturedPrompt).toContain("按 TDD 编写业务逻辑");
      expect(capturedPrompt).toContain("tdd");
      expect(capturedPrompt).toContain("【TDD 铁律】先写失败测试。");
    });

    it("should enforce pure Turn 1 handshake when customAgentId is absent", async () => {
      const sentPrompts: string[] = [];
      const responses = [
        "```action\ntool: run_command\ncommand: git status\n```",
        "FINAL_ANSWER: 通用握手模式下第二轮任务完成",
      ];
      let callCount = 0;

      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          sentPrompts.push(params.text);
          const resp = responses[callCount++] || "FINAL_ANSWER: 结束";
          return { text: resp };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        chatClient: mockClient as any,
      });

      expect(orchestrator.isHandshakePending).toBe(true);

      const result = await orchestrator.run({ task: "通用模式任务" });
      expect(result.completed).toBe(true);
      expect(sentPrompts.length).toBe(2);

      // Turn 1: 必须是基准探测，严禁泄露任务
      expect(sentPrompts[0]).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
      expect(sentPrompts[0]).toContain("command: git status");
      expect(sentPrompts[0]).not.toContain("通用模式任务");

      // Turn 2: 注入任务
      expect(sentPrompts[1]).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(sentPrompts[1]).toContain("通用模式任务");

      expect(orchestrator.isHandshakePending).toBe(false);
    });

    it("should maintain correct isHandshakePending state on resetHandshake()", () => {
      // 1. With customAgentId: resetHandshake keeps isHandshakePending = false
      const customAgentOrchestrator = new CopilotOrchestrator({
        customAgentId: "T_agent_abc",
      });
      expect(customAgentOrchestrator.isHandshakePending).toBe(false);
      customAgentOrchestrator.resetHandshake();
      expect(customAgentOrchestrator.isHandshakePending).toBe(false);

      // 2. Without customAgentId: resetHandshake resets isHandshakePending = true
      const standardOrchestrator = new CopilotOrchestrator();
      expect(standardOrchestrator.isHandshakePending).toBe(true);
      standardOrchestrator.isHandshakePending = false;
      standardOrchestrator.resetHandshake();
      expect(standardOrchestrator.isHandshakePending).toBe(true);
    });
  });
});
