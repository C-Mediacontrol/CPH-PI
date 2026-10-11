import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";

describe("Handoff Fenced Block Protocol Support", () => {
  it("should parse ```handoff fenced block into type 'handoff'", () => {
    const raw = `THOUGHT: 会话即将达到轮数限制，我正在提炼高保真交接文档。
\`\`\`handoff
# 跨会话自主任务交接文档
## 1. 任务目标
完成账户池自适应并发控制。
## 2. 关键发现
单账号必须限制并发度为 1。
\`\`\``;

    const parsed = ResilientParser.parse(raw);
    expect(parsed.type).toBe("handoff");
    if (parsed.type === "handoff") {
      expect(parsed.thought).toContain("会话即将达到轮数限制");
      expect(parsed.handoffDoc).toContain("# 跨会话自主任务交接文档");
      expect(parsed.handoffDoc).toContain("单账号必须限制并发度为 1");
    }
  });

  it("should build prompt instructing ```handoff block rather than write_file action", () => {
    const prompt = PromptBuilder.buildHandoffPreparationPrompt("重构会话持久化");
    expect(prompt).toContain("```handoff");
    expect(prompt).toContain("HANDOFF_MEMO:");
    expect(prompt).not.toContain("tool: write_file");
  });

  it("should automatically persist ```handoff output to disk and complete turn in Orchestrator", async () => {
    const tmpDir = path.join(os.tmpdir(), "cph-handoff-test-" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    let handoffEventTriggered = false;
    let eventDocContent = "";
    let eventDocPath = "";

    const mockClient: IOrchestratorChatClient = {
      sendMessage: async () => {
        return {
          text: `THOUGHT: 总结交接
\`\`\`handoff
# 深度交接文档
- 已修改: src/agent/orchestrator.ts
- 待办: 接入后继会话
\`\`\``,
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpDir,
      isHandshakePending: false,
      chatClient: mockClient,
      maxTurns: 5,
    });

    const result = await orchestrator.run({
      task: "交接测试",
      sessionId: "ses_handoff_block_001",
      events: {
        onHandoff: (doc, docPath) => {
          handoffEventTriggered = true;
          eventDocContent = doc;
          eventDocPath = docPath || "";
        },
      },
    });

    expect(result.handedOff).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.handoffDocPath).toBeDefined();
    expect(fs.existsSync(result.handoffDocPath!)).toBe(true);
    const contentOnDisk = fs.readFileSync(result.handoffDocPath!, "utf8");
    expect(contentOnDisk).toContain("# 深度交接文档");
    expect(handoffEventTriggered).toBe(true);
    expect(eventDocContent).toContain("# 深度交接文档");
    expect(eventDocPath).toBe(result.handoffDocPath!);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
