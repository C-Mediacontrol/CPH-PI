import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import {
  CopilotOrchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";

describe("Smart Handoff Dual-Insurance & Memo Capture (Task 3)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-smart-handoff-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. PromptBuilder.buildHandoffPreparationPrompt", () => {
    it("should contain system notice and HANDOFF_MEMO protocol guidance", () => {
      const task = "审查当前工程代码与架构质量";
      const prompt = PromptBuilder.buildHandoffPreparationPrompt(task, "ses_123");

      expect(prompt).toContain("[SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限]");
      expect(prompt).toContain("HANDOFF_MEMO");
      expect(prompt).toContain("```handoff");
      expect(prompt).toContain("原生交接文档格式指南");
      expect(prompt).not.toContain("FINAL_ANSWER: <任务交付总结说明>");
      expect(prompt).toContain(task);
    });
  });

  describe("2. Orchestrator.generateHandoffSnapshot Dual-Insurance Aggregation", () => {
    it("should integrate .cph/review_draft.md into handoff snapshot when present", async () => {
      const cphDir = join(tempDir, ".cph");
      await mkdir(cphDir, { recursive: true });
      await writeFile(
        join(cphDir, "review_draft.md"),
        "### JsygtBatch.psm1 审查发现\n- 第 400 行存在重试缺失漏洞\n- 架构过于臃肿",
        "utf8"
      );

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
      });

      const snapshot = orchestrator.generateHandoffSnapshot("测试任务", [], "ses_test_001");
      expect(snapshot).toContain("【阶段性技术审计发现与核心见解 (Review Draft)】");
      expect(snapshot).toContain("JsygtBatch.psm1 审查发现");
      expect(snapshot).toContain("第 400 行存在重试缺失漏洞");
    });

    it("should extract HANDOFF_MEMO from model response in history and embed it under dedicated section", () => {
      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
      });
      const history = [
        {
          turn: 29,
          userInput: "test",
          response: "HANDOFF_MEMO: 经全量审查，CNNJI QUERY 模块整体健壮，但 JsygtBatch 缺少超时保护，建议下任 Agent 优先编写回归用例。",
        },
      ];

      const snapshot = orchestrator.generateHandoffSnapshot("长任务", history as any, "ses_test_002");
      expect(snapshot).toContain("## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】");
      expect(snapshot).toContain("经全量审查，CNNJI QUERY 模块整体健壮");
    });

    it("should aggregate both .cph/review_draft.md and HANDOFF_MEMO simultaneously (Dual Insurance)", async () => {
      const cphDir = join(tempDir, ".cph");
      await mkdir(cphDir, { recursive: true });
      await writeFile(
        join(cphDir, "review_draft.md"),
        "### 阶段性审查落盘事实\n- 发现未捕获异常",
        "utf8"
      );

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
      });
      const history = [
        {
          turn: 29,
          userInput: "test",
          response: "HANDOFF_MEMO: 核心备忘录：已定位根因，接力者需重点验证重试机制。",
        },
      ];

      const snapshot = orchestrator.generateHandoffSnapshot("双保险任务", history as any, "ses_test_003");
      expect(snapshot).toContain("【阶段性技术审计发现与核心见解 (Review Draft)】");
      expect(snapshot).toContain("### 阶段性审查落盘事实");
      expect(snapshot).toContain("## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】");
      expect(snapshot).toContain("核心备忘录：已定位根因，接力者需重点验证重试机制。");
    });

    it("should honor existing .cph/handoffs/handoff-<sessionId>.md written by model without secondary wrapping", async () => {
      const handoffsDir = join(tempDir, ".cph", "handoffs");
      await mkdir(handoffsDir, { recursive: true });
      const customModelHandoff = "# My Custom Model Handoff\n- Author: Copilot Model Native\n- Status: In progress\n- Actionable next: test module X directly";
      await writeFile(
        join(handoffsDir, "handoff-ses_file_first.md"),
        customModelHandoff,
        "utf8"
      );

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
      });

      const snapshot = orchestrator.generateHandoffSnapshot("测试任务", [], "ses_file_first");
      expect(snapshot).toBe(customModelHandoff);
    });
  });

  describe("3. Orchestrator.run Pre-Handoff Summons on Turn maxTurns - 1", () => {
    it("should set currentPrompt to buildHandoffPreparationPrompt when turn === maxTurns - 1 and task not completed", async () => {
      let turnCount = 0;
      let promptSentAtTurn2 = "";

      const mockClient: IOrchestratorChatClient = {
        sendMessage: async (params: { text: string }) => {
          turnCount++;
          if (turnCount === 1) {
            // Turn 1: model executes a tool action
            return {
              text: "```action\ntool: run_command\ncommand: echo turn1\n```",
            };
          }
          if (turnCount === 2) {
            // Turn 2 is turn === maxTurns - 1 (since maxTurns = 3)
            promptSentAtTurn2 = params.text;
            return {
              text: "HANDOFF_MEMO: 当前会话即将到达上限，交接备忘：JsygtClient 模块审查完毕，请下任接力者继续审查 Batch 模块。",
            };
          }
          // Turn 3: maxTurns reached
          return {
            text: "```action\ntool: run_command\ncommand: echo final_wrap\n```",
          };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        maxTurns: 3,
        isHandshakePending: false,
        chatClient: mockClient,
      });

      const result = await orchestrator.run({
        task: "审查当前工程代码与架构质量",
      });

      // Verify Turn 2 prompt was pre-handoff summons
      expect(promptSentAtTurn2).toContain("[SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限]");
      expect(promptSentAtTurn2).toContain("HANDOFF_MEMO:");
      expect(promptSentAtTurn2).toContain("审查当前工程代码与架构质量");

      // Verify orchestrator handed off and aggregated the memo
      expect(result.handedOff).toBe(true);
      expect(result.handoffSnapshot).toBeDefined();
      expect(result.handoffSnapshot).toContain("【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】");
      expect(result.handoffSnapshot).toContain("JsygtClient 模块审查完毕，请下任接力者继续审查 Batch 模块");
    });

    it("should NOT trigger handoff if model finishes with FINAL_ANSWER before max turns", async () => {
      let turnCount = 0;
      const mockClient: IOrchestratorChatClient = {
        sendMessage: async () => {
          turnCount++;
          if (turnCount === 1) {
            return {
              text: "FINAL_ANSWER: 任务在第一轮即已全部完成交付。",
            };
          }
          return { text: "unused" };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        maxTurns: 3,
        isHandshakePending: false,
        chatClient: mockClient,
      });

      const result = await orchestrator.run({
        task: "轻量任务",
      });

      expect(result.completed).toBe(true);
      expect(result.handedOff).toBe(false);
      expect(result.finalAnswer).toContain("任务在第一轮即已全部完成交付");
    });
  });
});
