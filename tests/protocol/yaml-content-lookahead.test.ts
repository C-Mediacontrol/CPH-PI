import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser - YAML content Lookahead Assertion", () => {
  it("should not swallow path into content when content precedes path in YAML action block", () => {
    const raw = `\`\`\`action
tool: write_file
content:
export const PI = 3.14159;
export function add(a: number, b: number): number {
  return a + b;
}
path: src/math.ts
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("write_file");
      expect(parsed.action.path).toBe("src/math.ts");
      expect(parsed.action.content).toBe(
        "export const PI = 3.14159;\nexport function add(a: number, b: number): number {\n  return a + b;\n}"
      );
      expect(parsed.action.content).not.toContain("path: src/math.ts");
    }
  });

  it("should handle content preceding action/tool/file lines safely", () => {
    const raw = `\`\`\`action
content: console.log("hello");
file: test.js
tool: write_file
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.path).toBe("test.js");
      expect(parsed.action.content).toBe('console.log("hello");');
      expect(parsed.action.content).not.toContain("file: test.js");
      expect(parsed.action.content).not.toContain("tool: write_file");
    }
  });

  it("should still parse correctly when path precedes content", () => {
    const raw = `\`\`\`action
tool: write_file
path: src/index.ts
content:
console.log("normal order");
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.path).toBe("src/index.ts");
      expect(parsed.action.content).toBe('console.log("normal order");');
    }
  });
});
