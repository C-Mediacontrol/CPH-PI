import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../../src/cli.ts";

describe("CLI Argument Parsing - Tri-Agent IDs", () => {
  it("should parse --coder-agent-id and --researcher-agent-id flags", () => {
    const args = [
      "--agent",
      "main-id-123",
      "--coder-agent-id",
      "coder-id-456",
      "--researcher-agent-id",
      "researcher-id-789",
      "实现功能",
    ];

    const parsed = parseCliArgs(args);
    expect(parsed.customAgentId).toBe("main-id-123");
    expect(parsed.coderAgentId).toBe("coder-id-456");
    expect(parsed.researcherAgentId).toBe("researcher-id-789");
    expect(parsed.task).toBe("实现功能");
  });

  it("should provide default Tri-Agent IDs if not specified", () => {
    const parsed = parseCliArgs(["简单的任务"]);
    expect(parsed.customAgentId).toBe(
      "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852"
    );
    expect(parsed.coderAgentId).toBe(
      "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296"
    );
    expect(parsed.researcherAgentId).toBe(
      "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c"
    );
  });
});
