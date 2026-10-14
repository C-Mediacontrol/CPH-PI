import { describe, it, expect } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";
import {
  Orchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";

class MockChatHubClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async sendMessage(params: { text: string }): Promise<{ text: string }> {
    const text = this.responses[this.callCount] ?? "";
    this.callCount++;
    return { text };
  }
}

describe("Empty Response Handling & Protocol Segregation (CR-2)", () => {
  it("should classify empty string as empty_response rather than invalid_chatter", () => {
    const result = ResilientParser.parse("");
    expect(result.type).toBe("empty_response");
  });

  it("should classify whitespace-only text as empty_response rather than invalid_chatter", () => {
    const result = ResilientParser.parse("   \n\t  ");
    expect(result.type).toBe("empty_response");
  });

  it("should still classify non-empty invalid chatter as invalid_chatter", () => {
    const result = ResilientParser.parse("你好，我是 Copilot，请问有什么可以帮您？");
    expect(result.type).toBe("invalid_chatter");
  });

  it("should retry transient empty responses without incrementing formal turn", async () => {
    const mockClient = new MockChatHubClient([
      "",
      "   \n  ",
      "FINAL_ANSWER: 任务圆满完成",
    ]);

    const orchestrator = new Orchestrator({
      chatClient: mockClient,
      maxTurns: 5,
      isHandshakePending: false,
    });

    const result = await orchestrator.run({ task: "test-transient-empty" });
    expect(result.completed).toBe(true);
    expect(result.turnsCount).toBe(1);
    expect(mockClient.callCount).toBe(3);
    expect(result.finalAnswer).toContain("任务圆满完成");
  });

  it("should throw EMPTY_RESPONSE_LIMIT_EXCEEDED when consecutive empty responses exceed limit without pool", async () => {
    const mockClient = new MockChatHubClient([
      "",
      "",
      "",
      "FINAL_ANSWER: should not reach here",
    ]);

    const orchestrator = new Orchestrator({
      chatClient: mockClient,
      maxTurns: 5,
      isHandshakePending: false,
    });

    await expect(orchestrator.run({ task: "test-exceeded-empty" })).rejects.toThrow(
      "EMPTY_RESPONSE_LIMIT_EXCEEDED"
    );
  });
});

