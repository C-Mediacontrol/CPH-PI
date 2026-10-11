import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  Orchestrator,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

// Helper mock client simulating Sydney WebSocket streaming responses
class MockChatHubClient implements IOrchestratorChatClient {
  public responses: Array<string | { text: string; reasoning?: string }> = [];
  public sentPrompts: string[] = [];
  public callCount = 0;

  constructor(responses: Array<string | { text: string; reasoning?: string }>) {
    this.responses = responses;
  }

  async sendMessage(
    params: { text: string; [key: string]: any },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      [key: string]: any;
    }
  ): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    const resp = this.responses[this.callCount] || "FINAL_ANSWER: No more mock responses.";
    this.callCount++;

    const text = typeof resp === "string" ? resp : resp.text;
    const reasoning = typeof resp === "object" ? resp.reasoning : undefined;

    if (reasoning && callbacks?.onDelta) {
      callbacks.onDelta({ type: "reasoning", content: reasoning });
    }

    // Simulate streaming chunks
    if (callbacks?.onDelta) {
      const chunkSize = 20;
      for (let i = 0; i < text.length; i += chunkSize) {
        callbacks.onDelta({
          type: "text",
          content: text.slice(i, i + chunkSize),
        });
      }
    }

    return { text };
  }
}

describe("Orchestrator Unit & Closed-Loop Tests", () => {
  let tempDir: string;
  let testFile: string;
  let bridge: ToolBridge;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-orchestrator-test-"));
    testFile = join(tempDir, "sample.txt");
    await writeFile(testFile, "hello from local file\nline 2\n", "utf8");
    bridge = new ToolBridge(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. Multi-step Autonomous Closed-Loop", () => {
    it("should coordinate read, edit, and final answer to accomplish a task", async () => {
      const mockResponses = [
        // Turn 1: Model decides to read sample.txt
        `THOUGHT: First I will read sample.txt to understand the content.
\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 2: Model decides to edit sample.txt
        `THOUGHT: Now I will update hello to greetings.
\`\`\`action
tool: edit
path: sample.txt
old_string: hello
new_string: greetings
\`\`\``,
        // Turn 3: Model completes task
        `THOUGHT: Verification completed.
FINAL_ANSWER:
已成功读取 sample.txt 并将 hello 替换为 greetings，任务完成。`,
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
        maxTurns: 5,
      });

      const deltas: string[] = [];
      const toolStarts: string[] = [];
      const toolEnds: string[] = [];

      const result = await orchestrator.run({
        task: "将 sample.txt 中的 hello 替换为 greetings",
        events: {
          onDelta: (d) => deltas.push(d),
          onToolStart: (a) => toolStarts.push(a.tool || ""),
          onToolEnd: (r) => toolEnds.push(r.actionName),
        },
      });

      expect(result.completed).toBe(true);
      expect(result.turnsCount).toBe(3);
      expect(result.finalAnswer).toContain("替换为 greetings");
      expect(toolStarts).toEqual(["read_file", "edit"]);
      expect(toolEnds).toEqual(["read_file", "edit"]);
      expect(deltas.length).toBeGreaterThan(0);

      // Verify physical disk change
      const updatedContent = await readFile(testFile, "utf8");
      expect(updatedContent).toContain("greetings from local file");
    });
  });

  describe("2. Refusal Interception and Self-Healing", () => {
    it("should intercept sandbox refusal and auto-recover using correction prompt", async () => {
      const mockResponses = [
        // Turn 1: Model hallucinating refusal
        "抱歉，我无法直接访问你的本地路径，请上传 zip 压缩包。",
        // Turn 2 (after correction prompt): Model issues valid action
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 3: Final answer
        "FINAL_ANSWER: 文件读取成功，内容确认无误。",
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
        maxTurns: 5,
      });

      let refusalIntercepted = false;
      const result = await orchestrator.run({
        task: "读取 sample.txt",
        events: {
          onRefusalIntercepted: () => {
            refusalIntercepted = true;
          },
        },
      });

      expect(refusalIntercepted).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.finalAnswer).toContain("文件读取成功");
      // Check that the second prompt sent to client contained the correction override
      expect(client.sentPrompts[1]).toContain("【本地执行环境纠偏指令】");
    });
  });

  describe("3. Sliding Compaction Integration", () => {
    it("should trigger compaction after > 2 turns to prune older verbose tool results", async () => {
      // Create a sequence of 4 turns
      const mockResponses = [
        // Turn 1
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 2
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 3
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 4
        "FINAL_ANSWER: All reads completed.",
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
        maxTurns: 6,
      });

      let compactionCount = 0;
      const result = await orchestrator.run({
        task: "Perform repeated checks",
        events: {
          onCompacted: () => {
            compactionCount++;
          },
        },
      });

      expect(result.completed).toBe(true);
      expect(result.turnsCount).toBe(4);
      expect(result.history.length).toBe(4);
    });
  });

  describe("4. AbortSignal Cancellation", () => {
    it("should cancel execution immediately if AbortSignal is triggered", async () => {
      const mockResponses = [
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
      });

      const controller = new AbortController();
      controller.abort(); // Pre-abort

      expect(
        orchestrator.run({
          task: "Cancelled task",
          signal: controller.signal,
        })
      ).rejects.toThrow("aborted");
    });
  });
});
