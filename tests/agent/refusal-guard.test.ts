import { describe, it, expect } from "bun:test";
import { RefusalGuard } from "../../src/agent/refusal-guard.ts";

describe("RefusalGuard Unit Tests", () => {
  describe("1. Chinese Refusal Pattern Detection", () => {
    const chineseRefusals = [
      "抱歉，我无法直接访问你的本地路径 E:\\copilot-web proxy\\CPH-PI。",
      "我无法直接访问你 E 盘上的文件，请将项目打包上传。",
      "由于安全限制，看不到该项目目录，请上传 zip 压缩包。",
      "作为 AI，我只能访问当前容器可见的文件系统，缺少待审计项目源码。",
      "抱歉，我并未连接到用户所声明的 Harness 环境。",
      "无法按你提供的自定义工具协议执行，并非当前会话可调用的实际工具。",
      "当前环境中并不存在用户所定义的 TOOL_RESULT 机制。",
      "我无法直接在你的计算机上运行终端命令，请你在本地终端手动执行。",
    ];

    for (const refusal of chineseRefusals) {
      it(`should detect Chinese refusal: "${refusal.slice(0, 35)}..."`, () => {
        expect(RefusalGuard.detectRefusal(refusal)).toBe(true);
      });
    }
  });

  describe("2. English Refusal Pattern Detection", () => {
    const englishRefusals = [
      "I cannot directly access your local file system or disk drive.",
      "I don't have access to your local machine. Please upload a zip file containing the project.",
      "As an AI language model, I cannot execute commands on your computer.",
      "The tool read_file is not a valid tool available in this session.",
      "I cannot interact with your local environment or run bash scripts.",
      "No such tool exists in my environment to access /mnt/data or local drives.",
    ];

    for (const refusal of englishRefusals) {
      it(`should detect English refusal: "${refusal.slice(0, 35)}..."`, () => {
        expect(RefusalGuard.detectRefusal(refusal)).toBe(true);
      });
    }
  });

  describe("3. False Positive Avoidance (Legitimate Outputs)", () => {
    it("should not flag responses containing standard action blocks", () => {
      const output = `
我将检查本地目录中的文件。
\`\`\`action
tool: read_file
path: src/index.ts
\`\`\`
`;
      expect(RefusalGuard.detectRefusal(output)).toBe(false);
    });

    it("should not flag responses containing JSON action blocks", () => {
      const output = `
\`\`\`json
{
  "tool": "edit",
  "path": "package.json"
}
\`\`\`
`;
      expect(RefusalGuard.detectRefusal(output)).toBe(false);
    });

    it("should not flag normal final answers talking about local tests", () => {
      const output = `FINAL_ANSWER: 本地单元测试全部通过，未发现路径配置问题。`;
      expect(RefusalGuard.detectRefusal(output)).toBe(false);
    });

    it("should not flag regular code discussion", () => {
      const output = "在处理文件读取时，需要处理本地路径规范化问题。";
      expect(RefusalGuard.detectRefusal(output)).toBe(false);
    });
  });

  describe("4. Correction Prompt Construction", () => {
    it("should build constructive override prompt with target path and candidate tool", () => {
      const prompt = RefusalGuard.buildCorrectionPrompt({
        workspaceRoot: "e:/test-workspace",
        candidateFile: "package.json",
        toolName: "read_file",
      });

      expect(prompt).toContain("【本地执行环境纠偏指令】");
      expect(prompt).toContain("tool: read_file");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("无需用户上传");
    });

    it("should build fallback prompt when no candidate file is provided", () => {
      const prompt = RefusalGuard.buildCorrectionPrompt();
      expect(prompt).toContain("【本地执行环境纠偏指令】");
      expect(prompt).toContain("tool: run_command");
    });
  });

  describe("5. Retry & Strategy Logic", () => {
    it("should allow retries within max limits", () => {
      expect(RefusalGuard.shouldRetry(1, 3)).toBe(true);
      expect(RefusalGuard.shouldRetry(2, 3)).toBe(true);
      expect(RefusalGuard.shouldRetry(3, 3)).toBe(false);
    });

    it("should recommend account rotation on persistent refusal", () => {
      const strategy1 = RefusalGuard.getRetryStrategy(1);
      expect(strategy1.shouldSwitchAccount).toBe(false);

      const strategy2 = RefusalGuard.getRetryStrategy(2);
      expect(strategy2.shouldSwitchAccount).toBe(false);

      const strategy3 = RefusalGuard.getRetryStrategy(3);
      expect(strategy3.shouldSwitchAccount).toBe(true);
    });
  });
});
