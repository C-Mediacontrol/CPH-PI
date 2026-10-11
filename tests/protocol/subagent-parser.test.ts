import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser - invoke_subagent", () => {
  it("should parse standard invoke_subagent code block with multiple subagents", () => {
    const raw = `THOUGHT: 拆分为调研与编码两个子任务
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 调研模块接口
    prompt: 深入走查 src/auth/account-pool.ts 并输出分析报告
  - role: coder
    description: 修复单元测试
    prompt: 修改 tests/auth.test.ts 并运行 bun test
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("invoke_subagent");
      expect(Array.isArray((parsed.action as any).subagents)).toBe(true);
      expect((parsed.action as any).subagents.length).toBe(2);
      expect((parsed.action as any).subagents[0].role).toBe("researcher");
      expect((parsed.action as any).subagents[0].description).toBe("调研模块接口");
      expect((parsed.action as any).subagents[0].prompt).toBe("深入走查 src/auth/account-pool.ts 并输出分析报告");
      expect((parsed.action as any).subagents[1].role).toBe("coder");
      expect((parsed.action as any).subagents[1].description).toBe("修复单元测试");
      expect((parsed.action as any).subagents[1].prompt).toBe("修改 tests/auth.test.ts 并运行 bun test");
    }
  });

  it("should normalize role 'searcher' to 'researcher'", () => {
    const raw = `\`\`\`action
tool: invoke_subagent
subagents:
  - role: searcher
    description: 搜索定义
    prompt: 寻找 TokenManager 定义
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect((parsed.action as any).subagents[0].role).toBe("researcher");
    }
  });

  it("should parse JSON structured invoke_subagent payload", () => {
    const raw = `\`\`\`action
{
  "tool": "invoke_subagent",
  "subagents": [
    {
      "role": "coder",
      "description": "JSON形式任务",
      "prompt": "实现新特性"
    }
  ]
}
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("invoke_subagent");
      expect((parsed.action as any).subagents.length).toBe(1);
      expect((parsed.action as any).subagents[0].role).toBe("coder");
    }
  });
});
