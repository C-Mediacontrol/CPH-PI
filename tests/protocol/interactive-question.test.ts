import { describe, it, expect, mock } from "bun:test";
import { ToolBridge, type MappedQuestionArgs } from "../../src/protocol/tool-bridge.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { CliApp, CphPiCli } from "../../src/cli.ts";

describe("Interactive Question Protocol & ask_question Tool Wiring", () => {
  describe("1. ToolBridge onQuestion handling", () => {
    it("should format user responses with ToolBridge.formatUserResponse without double prefixing", () => {
      expect(ToolBridge.formatUserResponse("用户确认")).toBe("[USER_RESPONSE for ask_question]: 用户确认");
      expect(ToolBridge.formatUserResponse("[USER_RESPONSE for ask_question]: 选项 B")).toBe(
        "[USER_RESPONSE for ask_question]: 选项 B"
      );
      expect(ToolBridge.formatUserResponse("")).toBe("[USER_RESPONSE for ask_question]:");
    });

    it("should call onQuestion callback with mapped args and format output with [USER_RESPONSE for ask_question]:", async () => {
      let capturedArgs: MappedQuestionArgs | undefined;

      const bridge = new ToolBridge({
        cwd: process.cwd(),
        onQuestion: async (args) => {
          capturedArgs = args;
          return ToolBridge.formatUserResponse("用户确认：同意删除并继续");
        },
      });

      const result = await bridge.executeAction({
        tool: "ask_question",
        question: "请确认是否删除历史临时日志？",
        options: ["是", "否"],
      });

      expect(result.success).toBe(true);
      expect(capturedArgs).toBeDefined();
      expect(capturedArgs?.question).toBe("请确认是否删除历史临时日志？");
      expect(capturedArgs?.options).toEqual(["是", "否"]);

      // Verify formatted output prefix
      expect(result.output).toBe("[USER_RESPONSE for ask_question]: 用户确认：同意删除并继续");
      expect(result.formatted).toContain("【TOOL_RESULT: ask_question (请确认是否删除历史临时日志？) - SUCCESS】");
      expect(result.formatted).toContain("[USER_RESPONSE for ask_question]: 用户确认：同意删除并继续");
      expect(result.formatted).toContain("【END_TOOL_RESULT】");
    });

    it("should handle error gracefully when onQuestion throws", async () => {
      const bridge = new ToolBridge({
        cwd: process.cwd(),
        onQuestion: async () => {
          throw new Error("用户取消了交互输入 (EOF/Abort)");
        },
      });

      const result = await bridge.executeAction({
        tool: "ask_question",
        question: "继续操作吗？",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("用户取消了交互输入 (EOF/Abort)");
      expect(result.formatted).toContain("【TOOL_RESULT: ask_question (继续操作吗？) - FAILED】");
    });

    it("should fallback gracefully when no onQuestion callback is provided", async () => {
      const bridge = new ToolBridge({
        cwd: process.cwd(),
      });

      const result = await bridge.executeAction({
        tool: "ask_question",
        question: "需要确认配置吗？",
        options: ["是", "否"],
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("[Question prompted]: 需要确认配置吗？");
      expect(result.output).toContain("Options: 是, 否");
    });
  });

  describe("2. TuiRenderer Question Prompt Box Styling", () => {
    it("should format question prompt card with yellow box and numbered options", () => {
      const renderer = new TuiRenderer({ colorLevel: 0 }); // strip ANSI for clear string assertions
      const card = renderer.formatQuestionPrompt("请确认是否合并分支？", ["确认合并", "放弃并撤销"]);

      expect(card).toContain("请确认是否合并分支？");
      expect(card).toContain("[1] 确认合并");
      expect(card).toContain("[2] 放弃并撤销");
      expect(card).toContain("┌");
      expect(card).toContain("└");
      expect(card).toContain("ASK_QUESTION");
    });

    it("should format question prompt card cleanly when options are omitted", () => {
      const renderer = new TuiRenderer({ colorLevel: 0 });
      const card = renderer.formatQuestionPrompt("请输入待查找的目标模块名称：");

      expect(card).toContain("请输入待查找的目标模块名称：");
      expect(card).not.toContain("[1]");
      expect(card).toContain("┌");
      expect(card).toContain("└");
    });

    it("should render question prompt via writer function", () => {
      let output = "";
      const renderer = new TuiRenderer({
        colorLevel: 0,
        writer: (chunk) => {
          output += chunk;
        },
      });

      renderer.renderQuestionPrompt("执行该操作前请确认：", ["继续", "取消"]);

      expect(output).toContain("执行该操作前请确认：");
      expect(output).toContain("[1] 继续");
      expect(output).toContain("[2] 取消");
    });
  });

  describe("3. CliApp Integration & ToolBridge Wiring", () => {
    it("should export CliApp as an alias to CphPiCli", () => {
      expect(CliApp).toBeDefined();
      expect(CliApp).toBe(CphPiCli);
    });

    it("should wire default ToolBridge with onQuestion handler into CopilotOrchestrator when options.bridge is omitted", () => {
      const app = new CliApp({
        workspaceRoot: process.cwd(),
      });

      const bridge = app.getBridge();
      expect(bridge).toBeDefined();
      expect(bridge).toBeInstanceOf(ToolBridge);

      const orchestrator = app.getOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.getBridge()).toBe(bridge);
    });

    it("should preserve custom bridge when passed in options", () => {
      const customBridge = new ToolBridge({ cwd: process.cwd() });
      const app = new CliApp({
        workspaceRoot: process.cwd(),
        bridge: customBridge,
      });

      expect(app.getBridge()).toBe(customBridge);
      expect(app.getOrchestrator().getBridge()).toBe(customBridge);
    });

    it("should handle interactive question fallback in non-interactive mode", async () => {
      let written = "";
      const renderer = new TuiRenderer({
        colorLevel: 0,
        writer: (t) => {
          written += t;
        },
      });

      const app = new CliApp({
        workspaceRoot: process.cwd(),
        renderer,
        isInteractive: false,
      });

      const answer = await app.handleInteractiveQuestion({
        question: "自动测试中，是否跳过长任务？",
        options: ["跳过", "执行"],
      });

      // In non-interactive mode, should fallback to default first option
      expect(answer).toBe("跳过");
      expect(written).toContain("自动测试中，是否跳过长任务？");
    });

    it("should prompt readline and return user input in interactive mode", async () => {
      let promptAsked = "";
      let written = "";
      const renderer = new TuiRenderer({
        colorLevel: 0,
        writer: (t) => {
          written += t;
        },
      });

      // Mock readline interface
      const mockRl: any = {
        question: (promptText: string, cb: (ans: string) => void) => {
          promptAsked = promptText;
          // Simulate user selecting option 2
          cb("2");
        },
      };

      const app = new CliApp({
        workspaceRoot: process.cwd(),
        renderer,
        isInteractive: true,
        rl: mockRl,
      });

      const answer = await app.handleInteractiveQuestion({
        question: "请选择运行模式：",
        options: ["开发模式", "生产模式"],
      });

      expect(answer).toBe("生产模式");
      expect(promptAsked).toBeDefined();
      expect(written).toContain("请选择运行模式：");
    });

    it("should return raw text user input when input is not an option index", async () => {
      const mockRl: any = {
        question: (_promptText: string, cb: (ans: string) => void) => {
          cb("自定义输入内容");
        },
      };

      const app = new CliApp({
        workspaceRoot: process.cwd(),
        renderer: new TuiRenderer({ writer: () => {} }),
        isInteractive: true,
        rl: mockRl,
      });

      const answer = await app.handleInteractiveQuestion({
        question: "请输入描述：",
      });

      expect(answer).toBe("自定义输入内容");
    });

    it("should properly execute ask_question through orchestrator bridge and return formatted tool result", async () => {
      const mockRl: any = {
        question: (_prompt: string, cb: (ans: string) => void) => {
          cb("1");
        },
      };

      const app = new CliApp({
        workspaceRoot: process.cwd(),
        renderer: new TuiRenderer({ writer: () => {} }),
        isInteractive: true,
        rl: mockRl,
      });

      const bridge = app.getBridge();
      const result = await bridge.executeAction({
        tool: "ask_question",
        question: "是否重新构建缓存？",
        options: ["重建", "使用旧缓存"],
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("[USER_RESPONSE for ask_question]: 重建");
      expect(result.formatted).toContain("【TOOL_RESULT: ask_question (是否重新构建缓存？) - SUCCESS】");
      expect(result.formatted).toContain("[USER_RESPONSE for ask_question]: 重建");
    });
  });
});
