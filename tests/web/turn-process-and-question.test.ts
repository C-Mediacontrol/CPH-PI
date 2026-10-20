import { describe, it, expect, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import React from "../../web/node_modules/react";
import { renderToStaticMarkup } from "../../web/node_modules/react-dom/server";

describe("TurnProcessNodeView & AskQuestionCard Components (Task 4)", () => {
  const turnProcessPath = path.resolve(__dirname, "../../web/src/components/chat/TurnProcessNodeView.tsx");
  const reasoningBlockPath = path.resolve(__dirname, "../../web/src/components/chat/ReasoningBlock.tsx");
  const askQuestionPath = path.resolve(__dirname, "../../web/src/components/interaction/AskQuestionCard.tsx");
  const humanInteractionPath = path.resolve(__dirname, "../../web/src/components/interaction/HumanInteractionCard.tsx");
  const actionDockPath = path.resolve(__dirname, "../../web/src/components/interaction/ActionDock.tsx");
  const chatIndexPath = path.resolve(__dirname, "../../web/src/components/chat/index.ts");
  const interactionIndexPath = path.resolve(__dirname, "../../web/src/components/interaction/index.ts");

  describe("File Structure & Module Exports", () => {
    it("should have TurnProcessNodeView.tsx created", () => {
      expect(fs.existsSync(turnProcessPath)).toBe(true);
    });

    it("should have AskQuestionCard.tsx created", () => {
      expect(fs.existsSync(askQuestionPath)).toBe(true);
    });

    it("should export TurnProcessNodeView from chat/index.ts", () => {
      const content = fs.readFileSync(chatIndexPath, "utf-8");
      expect(content).toContain("TurnProcessNodeView");
    });

    it("should export AskQuestionCard from interaction/index.ts", () => {
      const content = fs.readFileSync(interactionIndexPath, "utf-8");
      expect(content).toContain("AskQuestionCard");
    });
  });

  describe("TurnProcessNodeView Specifications", () => {
    it("should have minimal hairline bottom border and 33px height specs", () => {
      const content = fs.readFileSync(turnProcessPath, "utf-8");
      expect(content).toMatch(/border-b/);
      expect(content).toMatch(/h-\[33px\]|min-h-\[33px\]/);
      expect(content).toContain("font-tabular");
    });

    it("should render 'Thinking...' and elapsed timer during streaming", async () => {
      const { TurnProcessNodeView } = await import("../../web/src/components/chat/TurnProcessNodeView.tsx");
      const html = renderToStaticMarkup(
        React.createElement(TurnProcessNodeView, {
          reasoning: "Thinking about file structure...",
          isStreaming: true,
          durationMs: 1200,
        })
      );

      expect(html).toContain("Thinking...");
      expect(html).toContain("1.2s");
      expect(html).toContain("font-tabular");
      expect(html).toContain("border-b");
    });

    it("should render 'Thought for' with tabular duration number when completed", async () => {
      const { TurnProcessNodeView } = await import("../../web/src/components/chat/TurnProcessNodeView.tsx");
      const html = renderToStaticMarkup(
        React.createElement(TurnProcessNodeView, {
          reasoning: "Analysis complete.",
          isStreaming: false,
          durationMs: 8400,
        })
      );

      expect(html).toContain("Thought for");
      expect(html).toContain("8.4s");
      expect(html).toContain("font-tabular");
    });

    it("should render 'Stopped' label when status is stopped", async () => {
      const { TurnProcessNodeView } = await import("../../web/src/components/chat/TurnProcessNodeView.tsx");
      const html = renderToStaticMarkup(
        React.createElement(TurnProcessNodeView, {
          reasoning: "Interrupted by user.",
          isStreaming: false,
          status: "stopped",
        })
      );

      expect(html).toContain("Stopped");
    });

    it("should render 'Failed' label when status is failed or error", async () => {
      const { TurnProcessNodeView } = await import("../../web/src/components/chat/TurnProcessNodeView.tsx");
      const html = renderToStaticMarkup(
        React.createElement(TurnProcessNodeView, {
          reasoning: "Network error occurred.",
          isStreaming: false,
          status: "failed",
        })
      );

      expect(html).toContain("Failed");
    });

    it("should render expanded reasoning content with subtle dark styling without purple borders", async () => {
      const { TurnProcessNodeView } = await import("../../web/src/components/chat/TurnProcessNodeView.tsx");
      const html = renderToStaticMarkup(
        React.createElement(TurnProcessNodeView, {
          reasoning: "Detailed step by step reasoning text here.",
          isStreaming: false,
          durationMs: 5000,
          defaultExpanded: true,
        })
      );

      expect(html).toContain("Detailed step by step reasoning text here.");
      // Must not contain the old purple theme classes
      expect(html).not.toContain("border-purple-800");
      expect(html).not.toContain("bg-purple-950");
    });
  });

  describe("ReasoningBlock Delegation", () => {
    it("should delegate to TurnProcessNodeView in ReasoningBlock.tsx", () => {
      const content = fs.readFileSync(reasoningBlockPath, "utf-8");
      expect(content).toContain("TurnProcessNodeView");
      expect(content).toContain("<TurnProcessNodeView");
    });

    it("should render backward-compatible ReasoningBlock with DeepSeek design", async () => {
      const { ReasoningBlock } = await import("../../web/src/components/chat/ReasoningBlock.tsx");
      const html = renderToStaticMarkup(
        React.createElement(ReasoningBlock, {
          reasoning: "Legacy props reasoning block",
          durationMs: 3200,
          isStreaming: false,
        })
      );

      expect(html).toContain("Thought for");
      expect(html).toContain("3.2s");
      expect(html).not.toContain("border-purple-800");
    });
  });

  describe("AskQuestionCard Component Specifications", () => {
    it("should render question text, pill buttons, write-in input, and DeepSeek blue submit button", async () => {
      const { AskQuestionCard } = await import("../../web/src/components/interaction/AskQuestionCard.tsx");
      const html = renderToStaticMarkup(
        React.createElement(AskQuestionCard, {
          question: "Which test runner should we use?",
          options: ["bun test", "jest", "vitest"],
          isMultiSelect: false,
        })
      );

      // Question title
      expect(html).toContain("Which test runner should we use?");
      // Pill options
      expect(html).toContain("bun test");
      expect(html).toContain("jest");
      expect(html).toContain("vitest");
      expect(html).toContain("rounded-full");
      // Write-in field
      expect(html).toContain("input");
      expect(html).toContain("bg-surface-panel");
      // Submit button with DeepSeek blue
      expect(html).toContain("bg-deepseek-500");
      expect(html).toContain("Submit");
    });

    it("should style selected pill options with deepseek blue accents", async () => {
      const { AskQuestionCard } = await import("../../web/src/components/interaction/AskQuestionCard.tsx");
      const html = renderToStaticMarkup(
        React.createElement(AskQuestionCard, {
          question: "Pick target environments",
          options: ["node", "bun", "browser"],
          isMultiSelect: true,
          initialAnswers: {
            "Pick target environments": {
              selected: ["node", "browser"],
            },
          },
        })
      );

      expect(html).toContain("border-deepseek-500");
      expect(html).toContain("text-deepseek-400");
    });

    it("should support multiple questions in a single card", async () => {
      const { AskQuestionCard } = await import("../../web/src/components/interaction/AskQuestionCard.tsx");
      const html = renderToStaticMarkup(
        React.createElement(AskQuestionCard, {
          questions: [
            { id: "q1", question: "Primary target?", options: ["Node.js", "Bun"] },
            { id: "q2", question: "Enable debug logging?", options: ["Yes", "No"] },
          ],
        })
      );

      expect(html).toContain("Primary target?");
      expect(html).toContain("Enable debug logging?");
      expect(html).toContain("Node.js");
      expect(html).toContain("Yes");
    });
  });

  describe("HumanInteractionCard Question Delegation & DeepSeek Cards", () => {
    it("should delegate question rendering to AskQuestionCard in HumanInteractionCard.tsx", () => {
      const content = fs.readFileSync(humanInteractionPath, "utf-8");
      expect(content).toContain("AskQuestionCard");
      expect(content).toContain("<AskQuestionCard");
    });

    it("should render tool approval section with DeepSeek surface card tokens", async () => {
      const { HumanInteractionCard } = await import("../../web/src/components/interaction/HumanInteractionCard.tsx");
      const sampleApproval = {
        approvalId: "appr-123",
        action: {
          tool: "run_command",
          command: "npm run build",
        },
        timestamp: Date.now(),
      };

      const html = renderToStaticMarkup(
        React.createElement(HumanInteractionCard, {
          pendingApproval: sampleApproval,
        })
      );

      expect(html).toContain("bg-surface-card");
      expect(html).toContain("border-border-base");
      expect(html).toContain("npm run build");
      expect(html).toContain("Approve");
    });
  });

  describe("ActionDock DeepSeek Design Tokens", () => {
    it("should use DeepSeek surface card, border base, and deepseek-500 send button", () => {
      const content = fs.readFileSync(actionDockPath, "utf-8");
      // Outer dock surface-card
      expect(content).toContain("bg-surface-card");
      expect(content).toContain("border-border-base");
      // DeepSeek blue send button
      expect(content).toContain("bg-deepseek-500");
      // Slash menu surface-panel
      expect(content).toContain("bg-surface-panel");
    });

    it("should render two-stage interrupt button when isRunning is true", async () => {
      const { ActionDock } = await import("../../web/src/components/interaction/ActionDock.tsx");
      const html = renderToStaticMarkup(
        React.createElement(ActionDock, {
          onSend: () => {},
          isRunning: true,
        })
      );

      expect(html).toContain("Stop");
      expect(html).toContain("bg-rose");
    });
  });
});
