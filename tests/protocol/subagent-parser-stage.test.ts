import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser - invoke_subagent stage extraction", () => {
  it("should extract stage in JSON format and default to 1 when unspecified", () => {
    const raw = `\`\`\`action
{
  "tool": "invoke_subagent",
  "subagents": [
    {
      "role": "researcher",
      "stage": 2,
      "description": "第二阶段调研",
      "prompt": "深度分析"
    },
    {
      "role": "coder",
      "description": "默认阶段编码",
      "prompt": "编写代码"
    }
  ]
}
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      const subagents = (parsed.action as any).subagents;
      expect(subagents.length).toBe(2);
      expect(subagents[0].stage).toBe(2);
      expect(subagents[1].stage).toBe(1);
    }
  });

  it("should extract stage in YAML format and default to 1 when unspecified", () => {
    const raw = `\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    stage: 2
    description: 第二阶段调研
    prompt: 深入探查
  - role: coder
    description: 默认阶段编码
    prompt: 执行修复
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      const subagents = (parsed.action as any).subagents;
      expect(subagents.length).toBe(2);
      expect(subagents[0].stage).toBe(2);
      expect(subagents[1].stage).toBe(1);
    }
  });

  it("should handle stage 1 explicitly specified in YAML", () => {
    const raw = `\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    stage: 1
    description: 第一阶段调研
    prompt: 快速审查
\`\`\``;
    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      const subagents = (parsed.action as any).subagents;
      expect(subagents[0].stage).toBe(1);
    }
  });
});
