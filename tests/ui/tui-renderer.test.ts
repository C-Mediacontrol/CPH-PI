import { describe, it, expect, beforeEach } from "bun:test";
import { TuiRenderer, type SessionStatusInfo } from "../../src/ui/tui-renderer.ts";
import type { CopilotAction, ToolBridgeResult } from "../../src/protocol/tool-bridge.ts";

describe("TuiRenderer Unit & Visual Tests", () => {
  let outputBuffer: string[];
  let renderer: TuiRenderer;

  beforeEach(() => {
    outputBuffer = [];
    renderer = new TuiRenderer({
      writer: (text: string) => outputBuffer.push(text),
    });
  });

  const getCombinedOutput = () => outputBuffer.join("");

  describe("1. Streaming Chunk Rendering", () => {
    it("should format and render reasoning / thinking chunks in magenta", () => {
      renderer.renderReasoningChunk("Analyzing directory structure...");
      const output = getCombinedOutput();

      expect(output).toContain("Analyzing directory structure...");
      // Check ANSI escape code for magenta (typically \u001b[35m)
      expect(output).toContain("\u001b[35m");
    });

    it("should format and render standard text stream chunks directly", () => {
      renderer.renderTextChunk("Hello world from Copilot stream");
      const output = getCombinedOutput();

      expect(output).toBe("Hello world from Copilot stream");
    });
  });

  describe("2. Tool Invocation Badges", () => {
    it("should format read_file badge with line ranges", () => {
      const action: CopilotAction = {
        tool: "read_file",
        path: "src/cli.ts",
        start_line: 1,
        end_line: 50,
      };

      const badge = renderer.formatToolBadge(action);

      expect(badge).toContain("⚡");
      expect(badge).toContain("正在执行");
      expect(badge).toContain("read_file");
      expect(badge).toContain("src/cli.ts (lines 1-50)");
    });

    it("should format read_file badge with default 100 lines when not specified", () => {
      const action: CopilotAction = {
        tool: "read_file",
        path: "README.md",
      };

      const badge = renderer.formatToolBadge(action);

      expect(badge).toContain("README.md (lines 1-100)");
    });

    it("should format edit badge with block count", () => {
      const action: CopilotAction = {
        tool: "edit",
        path: "src/index.ts",
        edits: [
          { oldText: "foo", newText: "bar" },
          { oldText: "baz", newText: "qux" },
        ],
      };

      const badge = renderer.formatToolBadge(action);

      expect(badge).toContain("edit");
      expect(badge).toContain("src/index.ts (2 blocks)");
    });

    it("should format run_command badge with command preview", () => {
      const action: CopilotAction = {
        tool: "run_command",
        command: "bun test --coverage",
      };

      const badge = renderer.formatToolBadge(action);

      expect(badge).toContain("run_command");
      expect(badge).toContain("bun test --coverage");
    });

    it("should format ask_question badge with question text", () => {
      const action: CopilotAction = {
        tool: "ask_question",
        question: "Should we proceed with migration?",
      };

      const badge = renderer.formatToolBadge(action);

      expect(badge).toContain("ask_question");
      expect(badge).toContain("Should we proceed with migration?");
    });
  });

  describe("3. Diff Rendering with Intra-Line Word Highlighting", () => {
    it("should render added lines in green and removed lines in red", () => {
      const rawDiff = [
        "-const oldVersion = 1;",
        "+const newVersion = 2;",
      ].join("\n");

      const rendered = renderer.renderDiff(rawDiff);

      // Contains both versions
      expect(rendered).toContain("const");
      expect(rendered).toContain("oldVersion");
      expect(rendered).toContain("newVersion");

      // Red ANSI \u001b[31m and Green ANSI \u001b[32m
      expect(rendered).toContain("\u001b[31m");
      expect(rendered).toContain("\u001b[32m");
      // Intra-line inverse ANSI \u001b[7m
      expect(rendered).toContain("\u001b[7m");
    });

    it("should preserve unified patch headers and context lines", () => {
      const patch = [
        "--- a/config.json",
        "+++ b/config.json",
        "@@ -1,3 +1,3 @@",
        "  line 1 context",
        "- old line",
        "+ new line",
        "  line 3 context",
      ].join("\n");

      const rendered = renderer.renderDiff(patch);

      expect(rendered).toContain("--- a/config.json");
      expect(rendered).toContain("+++ b/config.json");
      expect(rendered).toContain("@@ -1,3 +1,3 @@");
      expect(rendered).toContain("line 1 context");
    });
  });

  describe("4. Tool Execution Results Formatting", () => {
    it("should format success tool result with checkmark and target", () => {
      const result: ToolBridgeResult = {
        actionName: "read_file",
        piToolName: "read",
        target: "package.json",
        success: true,
        output: '{\n  "name": "cph-pi"\n}',
        formatted: "",
      };

      const formatted = renderer.formatToolResult(result);

      expect(formatted).toContain("✔");
      expect(formatted).toContain("read_file");
      expect(formatted).toContain("[package.json]");
      expect(formatted).toContain("执行成功");
      expect(formatted).toContain('"name": "cph-pi"');
    });

    it("should format failure tool result with cross mark", () => {
      const result: ToolBridgeResult = {
        actionName: "run_command",
        piToolName: "bash",
        target: "invalid-command",
        success: false,
        output: "command not found: invalid-command",
        formatted: "",
      };

      const formatted = renderer.formatToolResult(result);

      expect(formatted).toContain("✖");
      expect(formatted).toContain("run_command");
      expect(formatted).toContain("执行失败");
      expect(formatted).toContain("command not found");
    });

    it("should embed Diff preview box when edit tool provides diff", () => {
      const result: ToolBridgeResult = {
        actionName: "edit",
        piToolName: "edit",
        target: "src/utils.ts",
        success: true,
        output: "Successfully replaced 1 block in src/utils.ts.\n\nDiff:\n-10 let a = 1;\n+10 let a = 2;",
        formatted: "",
        rawResult: {
          content: [],
          details: {
            diff: "-10 let a = 1;\n+10 let a = 2;",
          },
        },
      };

      const formatted = renderer.formatToolResult(result);

      expect(formatted).toContain("Diff 局部预览");
      expect(formatted).toContain("let a");
    });

    it("should truncate long output exceeding 15 lines with notice", () => {
      const longOutput = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n");
      const result: ToolBridgeResult = {
        actionName: "read_file",
        piToolName: "read",
        target: "big-file.txt",
        success: true,
        output: longOutput,
        formatted: "",
      };

      const formatted = renderer.formatToolResult(result);

      expect(formatted).toContain("line 1");
      expect(formatted).toContain("line 15");
      expect(formatted).toContain("已省略 10 行输出");
    });
  });

  describe("5. FINAL_ANSWER Highlight Box", () => {
    it("should render final answer enclosed in unicode box with header", () => {
      const summary = "所有任务已完成！\n1. 接入 TUI 终端渲染\n2. 实现两段式安全中断";
      const box = renderer.formatFinalAnswer(summary);

      expect(box).toContain("┌");
      expect(box).toContain("┐");
      expect(box).toContain("└");
      expect(box).toContain("┘");
      expect(box).toContain("🎯 【任务已完成交付 / FINAL ANSWER】");
      expect(box).toContain("所有任务已完成！");
      expect(box).toContain("1. 接入 TUI 终端渲染");
      expect(box).toContain("2. 实现两段式安全中断");
    });
  });

  describe("6. Terminal Banners and Status Indicators", () => {
    it("should render banner with framework and protocol notes", () => {
      renderer.renderBanner();
      const output = getCombinedOutput();

      expect(output).toContain("CPH-PI: Copilot M365 x Pi Autonomous Coding Terminal");
      expect(output).toContain("@earendil-works/pi-tui");
      expect(output).toContain("Sydney / ChatHub");
    });

    it("should render turn header", () => {
      renderer.renderTurnHeader(3);
      expect(getCombinedOutput()).toContain("[Turn 3]");
    });

    it("should render refusal warning", () => {
      renderer.renderRefusalWarning("I cannot do that", 2);
      const output = getCombinedOutput();
      expect(output).toContain("RefusalGuard");
      expect(output).toContain("第 2 次重试");
    });

    it("should render compaction notice", () => {
      renderer.renderCompactedNotice(1234, 0.85);
      const output = getCombinedOutput();
      expect(output).toContain("Compaction");
      expect(output).toContain("1234");
      expect(output).toContain("85.0%");
    });

    it("should render account switched notice", () => {
      renderer.renderAccountSwitchedNotice("a@test.com", "b@test.com");
      const output = getCombinedOutput();
      expect(output).toContain("AccountPool");
      expect(output).toContain("a@test.com");
      expect(output).toContain("b@test.com");
    });

    it("should render aborted notice", () => {
      renderer.renderAbortedNotice();
      const output = getCombinedOutput();
      expect(output).toContain("已拦截 Ctrl+C");
      expect(output).toContain("会话历史与上下文完整保留");
    });
  });

  describe("7. Session Status Bar Rendering", () => {
    it("should render complete status bar with ANSI highlighting and tokens & compaction ratio", () => {
      const info: SessionStatusInfo = {
        sessionId: "ses_20261010_1001",
        turnCount: 3,
        maxTurns: 25,
        estimatedTokens: 1800,
        compactionRatio: 0.86,
        currentAccount: "dev1@m365.com",
      };

      const bar = renderer.renderStatusBar(info);

      expect(bar).toContain("┌─ [");
      expect(bar).toContain("会话:");
      expect(bar).toContain("ses_20261010_1001");
      expect(bar).toContain("轮次:");
      expect(bar).toContain("3/25");
      expect(bar).toContain("上下文:");
      expect(bar).toContain("~1.8k Token");
      expect(bar).toContain("压实率 86%");
      expect(bar).toContain("账号:");
      expect(bar).toContain("dev1@m365.com");
      expect(bar).toContain("]");

      // Check writer output as well
      const writerOutput = getCombinedOutput();
      expect(writerOutput).toContain("ses_20261010_1001");
    });

    it("should gracefully fallback when optional fields are omitted", () => {
      const info: SessionStatusInfo = {
        sessionId: "ses_empty",
        turnCount: 0,
        maxTurns: 30,
      };

      const bar = renderer.renderStatusBar(info);

      expect(bar).toContain("ses_empty");
      expect(bar).toContain("0/30");
      expect(bar).toContain("上下文:");
      expect(bar).toContain("初始");
      expect(bar).toContain("账号:");
      expect(bar).toContain("默认");
    });

    it("should format tokens without compaction ratio when ratio is absent", () => {
      const info: SessionStatusInfo = {
        sessionId: "ses_tokens",
        turnCount: 1,
        maxTurns: 25,
        estimatedTokens: 500,
      };

      const bar = renderer.renderStatusBar(info);

      expect(bar).toContain("~500 Token");
      expect(bar).not.toContain("压实率");
    });

    it("should render agent badge when agentName is provided", () => {
      const info: SessionStatusInfo = {
        sessionId: "ses_agent",
        turnCount: 2,
        maxTurns: 30,
        agentName: "T_agent_abc",
      };

      const bar = renderer.renderStatusBar(info);

      expect(bar).toContain("智能体:");
      expect(bar).toContain("T_agent_abc");
    });

    it("should render fallback 通用握手模式 badge when agentName is omitted", () => {
      const info: SessionStatusInfo = {
        sessionId: "ses_no_agent",
        turnCount: 0,
        maxTurns: 30,
      };

      const bar = renderer.renderStatusBar(info);

      expect(bar).toContain("智能体:");
      expect(bar).toContain("通用握手模式");
    });

    it("should render generation badge and handoff count in status bar", () => {
      const infoInitial: SessionStatusInfo = {
        sessionId: "ses_gen1",
        turnCount: 5,
        maxTurns: 30,
        generation: 1,
        handoffCount: 0,
      };
      const bar1 = renderer.renderStatusBar(infoInitial);
      expect(bar1).toContain("第 1 代 (接手 0 次)");

      const infoHandedOff: SessionStatusInfo = {
        sessionId: "ses_gen3",
        turnCount: 2,
        maxTurns: 30,
        generation: 3,
        handoffCount: 2,
      };
      const bar2 = renderer.renderStatusBar(infoHandedOff);
      expect(bar2).toContain("第 3 代 (接手 2 次)");
    });
  });

  describe("8. Three-stage Disaster Recovery Banners", () => {
    it("should format and render Stage 1 Disaster Blackbox Banner", () => {
      const banner = renderer.formatDisasterBlackboxBanner("ses_victim", "429 Too Many Requests");
      expect(banner).toContain("⚡");
      expect(banner).toContain("[Disaster-Recovery: 阶一]");
      expect(banner).toContain("ses_victim");
      expect(banner).toContain("429 Too Many Requests");

      renderer.renderDisasterBlackboxBanner("ses_victim", "429 Too Many Requests");
      expect(getCombinedOutput()).toContain("[Disaster-Recovery: 阶一]");
    });

    it("should format and render Stage 2 Arbitrator Handoff Banner", () => {
      const banner = renderer.formatArbitratorHandoffBanner("ses_arb", "test@m365.com", "/path/to/doc.md");
      expect(banner).toContain("📑");
      expect(banner).toContain("[Disaster-Recovery: 阶二]");
      expect(banner).toContain("ses_arb");
      expect(banner).toContain("test@m365.com");
      expect(banner).toContain("/path/to/doc.md");

      renderer.renderArbitratorHandoffBanner("ses_arb", "test@m365.com", "/path/to/doc.md");
      expect(getCombinedOutput()).toContain("[Disaster-Recovery: 阶二]");
    });

    it("should format and render Stage 3 Disaster Successor Banner", () => {
      const banner = renderer.formatDisasterSuccessorBanner("ses_succ", 1, 3, "/path/to/doc.md");
      expect(banner).toContain("🚀");
      expect(banner).toContain("[Disaster-Recovery: 阶三]");
      expect(banner).toContain("ses_succ");
      expect(banner).toContain("阶段 1/3");
      expect(banner).toContain("/path/to/doc.md");

      renderer.renderDisasterSuccessorBanner("ses_succ", 1, 3, "/path/to/doc.md");
      expect(getCombinedOutput()).toContain("[Disaster-Recovery: 阶三]");
    });
  });
});
