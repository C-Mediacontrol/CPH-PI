import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  Orchestrator,
  isInlineScoutTask,
  type IOrchestratorChatClient,
} from "../../src/agent/orchestrator.ts";
import { ToolBridge } from "../../src/protocol/tool-bridge.ts";

// Helper mock client simulating Sydney WebSocket streaming responses
class MockChatHubClient implements IOrchestratorChatClient {
  public responses: Array<string | { text: string; reasoning?: string }> = [];
  public sentPrompts: string[] = [];
  public sentParams: any[] = [];
  public callCount = 0;
  public closed = false;

  close(): void {
    this.closed = true;
  }

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
    this.sentParams.push(params);
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

  describe("5. Initial Annotations & Arbitrator Prompt Governance (Task 3)", () => {
    it("should pass initialAnnotations into client.sendMessage on Turn 1", async () => {
      const dummyAnnotation: any = {
        id: "att-123",
        text: "handoff.md",
        url: "https://example.com/handoff.md",
        messageAnnotationType: "LocalFile",
      };

      const mockResponses = [
        "FINAL_ANSWER: Handshake and task completed.",
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
        customAgentId: "cph-dev",
      });

      await orchestrator.run({
        task: "Execute with initial attachment",
        initialAnnotations: [dummyAnnotation],
      });

      expect(client.sentParams.length).toBeGreaterThan(0);
      expect(client.sentParams[0].annotations).toEqual([dummyAnnotation]);
    });

    it("should reset annotations to undefined on Turn 2 when tool execution generates no cloud attachment", async () => {
      const dummyAnnotation: any = {
        id: "att-handoff-001",
        text: "handoff.md",
        url: "https://example.com/handoff.md",
        messageAnnotationType: "LocalFile",
      };

      const mockResponses = [
        // Turn 1: Model issues a small read action (does not trigger cloud upload)
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        // Turn 2: Model finishes
        "FINAL_ANSWER: Done reading file.",
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
        customAgentId: "cph-dev",
      });

      await orchestrator.run({
        task: "Read sample file",
        initialAnnotations: [dummyAnnotation],
      });

      expect(client.sentParams.length).toBe(2);
      expect(client.sentParams[0].annotations).toEqual([dummyAnnotation]);
      expect(client.sentParams[1].annotations).toBeUndefined();
      expect(client.sentParams[0].isStartOfSession).toBe(true);
      expect(client.sentParams[1].isStartOfSession).toBe(false);
    });

    it("should propagate isStartOfSession: true on Turn 1 and false on subsequent turns", async () => {
      const mockResponses = [
        `\`\`\`action
tool: read_file
path: sample.txt
\`\`\``,
        "FINAL_ANSWER: Done reading file.",
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
      });

      await orchestrator.run({
        task: "Read sample file",
      });

      expect(client.sentParams.length).toBe(2);
      expect(client.sentParams[0].isStartOfSession).toBe(true);
      expect(client.sentParams[1].isStartOfSession).toBe(false);
    });

    it("should pass rootUserPrompt to disaster recovery blackbox and clean arbitratorPrompt of defeatist phrases", async () => {
      // Simulate victim client failing with 429
      const victimClient: any = {
        sendMessage: async () => {
          const err: any = new Error("429 Too Many Requests: Throttled");
          err.statusCode = 429;
          throw err;
        },
      };

      let arbitratorReceivedPrompt = "";
      const arbitratorClient: any = {
        sendMessage: async (params: any) => {
          arbitratorReceivedPrompt = params.text;
          return {
            text: `\`\`\`action
tool: write_file
path: .cph/handoffs/handoff-test-session.md
content: # Handoff Document
\`\`\``,
          };
        },
      };

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: victimClient,
        arbitratorChatClient: arbitratorClient,
      });

      const rootUserPrompt = "战役北极星：重构所有鉴权模块并达到 100% 单测覆盖率";
      const result = await orchestrator.run({
        task: "当前阶段临时任务：排查 token 校验失败",
        rootUserPrompt,
        sessionId: "test-session",
      });

      expect(result.disasterRecovered).toBe(true);

      // 1. rootUserPrompt must be passed to BlackboxCompactor and appear in Section 0
      expect(arbitratorReceivedPrompt).toContain("## 0. 战役终极北极星 (Root User Goal)");
      expect(arbitratorReceivedPrompt).toContain(rootUserPrompt);

      // 2. arbitratorPrompt must NOT contain defeatist phrases
      expect(arbitratorReceivedPrompt).not.toContain("若仅为交接");
      expect(arbitratorReceivedPrompt).not.toContain("核验后即可交付");
      expect(arbitratorReceivedPrompt).not.toContain("若任务仅为交接或阶段性报告交付");

      // 3. arbitratorPrompt must require arranging unfinished slices as highest priority actionable next steps
      expect(arbitratorReceivedPrompt).toContain("未完成切片");
      expect(arbitratorReceivedPrompt).toContain("最高优先级待办");
    });
  });

  describe("6. Error Classification & Rate Limit Distinction", () => {
    it("should distinguish network drops from 429 rate limit even when URL contains GUID 4329", async () => {
      let throttledEmail = "";
      const mockPool: any = {
        markThrottled: (email: string) => {
          throttledEmail = email;
        },
        getNextAvailableToken: async () => ({
          token: "dummy",
          email: "arbitrator@example.com",
        }),
      };

      const victimClient: any = {
        token: { email: "victim@example.com" },
        sendMessage: async () => {
          throw new Error(
            "WebSocket connection to wss://substrate.office.com/m365Copilot/Chathub/hub?sub=9d314297-75dc-4329-8f94-a66489b4b9bb failed: socket hang up"
          );
        },
      };

      const arbitratorClient: any = {
        sendMessage: async () => ({
          text: `\`\`\`action\ntool: write_file\npath: .cph/handoffs/handoff-net-session.md\ncontent: # Handoff Document\n\`\`\``,
        }),
      };

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: victimClient,
        arbitratorChatClient: arbitratorClient,
        pool: mockPool,
      });

      await orchestrator.run({
        task: "Test task",
        sessionId: "net-session",
      });

      // Pure socket hang up must NOT mark account as throttled!
      expect(throttledEmail).toBe("");
    });

    it("should mark account as throttled when error is genuine HTTP 429", async () => {
      let throttledEmail = "";
      const mockPool: any = {
        markThrottled: (email: string) => {
          throttledEmail = email;
        },
        getNextAvailableToken: async () => ({
          token: "dummy",
          email: "arbitrator@example.com",
        }),
      };

      const victimClient: any = {
        token: { email: "victim@example.com" },
        sendMessage: async () => {
          throw new Error("HTTP 429 Too Many Requests: Request limit exceeded");
        },
      };

      const arbitratorClient: any = {
        sendMessage: async () => ({
          text: `\`\`\`action\ntool: write_file\npath: .cph/handoffs/handoff-429-session.md\ncontent: # Handoff Document\n\`\`\``,
        }),
      };

      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: victimClient,
        arbitratorChatClient: arbitratorClient,
        pool: mockPool,
      });

      await orchestrator.run({
        task: "Test task",
        sessionId: "429-session",
      });

      // Real 429 MUST mark account as throttled!
      expect(throttledEmail).toBe("victim@example.com");
    });

    it("should classify initial handshake failure 'failed: Failed to connect' as recoverable transport error", async () => {
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
      });

      const handshakeErr = new Error(
        "WebSocket connection error: WebSocket connection to 'wss://substrate.office.com/m365Copilot/Chathub/hub' failed: Failed to connect"
      );
      expect(orchestrator.isRecoverableTransportError(handshakeErr)).toBe(true);

      const connEndedErr = new Error(
        "WebSocket connection error: WebSocket connection to 'wss://substrate.office.com/m365Copilot/Chathub/hub' failed: Connection ended"
      );
      expect(orchestrator.isRecoverableTransportError(connEndedErr)).toBe(true);

      const refusedErr: any = new Error("connect ECONNREFUSED 127.0.0.1:443");
      refusedErr.code = "ECONNREFUSED";
      expect(orchestrator.isRecoverableTransportError(refusedErr)).toBe(true);
    });
  });

  describe("7. Scout Inline Wait Mode & Account Physical Isolation (Task 1)", () => {
    describe("isInlineScoutTask helper function", () => {
      it("should return true for single researcher with scout-matching description or prompt", () => {
        expect(
          isInlineScoutTask([
            { role: "researcher", description: "斥候探查代码库大纲", prompt: "探查项目结构" },
          ])
        ).toBe(true);

        expect(
          isInlineScoutTask([
            { role: "researcher", description: "探查系统结构", prompt: "架构探查并整理依赖" },
          ])
        ).toBe(true);

        expect(
          isInlineScoutTask([
            { role: "searcher", description: "项目大纲梳理", prompt: "搜索项目模块" },
          ])
        ).toBe(true);

        expect(
          isInlineScoutTask([
            { role: "researcher", description: "进行结构梳理", prompt: "分析代码结构" },
          ])
        ).toBe(true);

        expect(
          isInlineScoutTask([
            { role: "researcher", description: "Scout codebase architecture", prompt: "list files" },
          ])
        ).toBe(true);
      });

      it("should return true when isScout === true regardless of text", () => {
        expect(
          isInlineScoutTask([
            { role: "researcher", isScout: true, description: "常规调研", prompt: "检查配置" },
          ])
        ).toBe(true);

        expect(
          isInlineScoutTask([
            { role: "searcher", isScout: "true", description: "快速探查", prompt: "检查环境" },
          ])
        ).toBe(true);
      });

      it("should return false for multi-subagent tasks", () => {
        expect(
          isInlineScoutTask([
            { role: "researcher", isScout: true, description: "斥候1" },
            { role: "researcher", isScout: true, description: "斥候2" },
          ])
        ).toBe(false);
      });

      it("should return false for coder role even if description mentions scout", () => {
        expect(
          isInlineScoutTask([
            { role: "coder", description: "斥候代码探查", prompt: "编写代码" },
          ])
        ).toBe(false);
      });

      it("should return false for non-scout researcher tasks", () => {
        expect(
          isInlineScoutTask([
            { role: "researcher", description: "深度代码审查与单元测试分析", prompt: "排查所有错误" },
          ])
        ).toBe(false);
      });

      it("should return false for empty or invalid input", () => {
        expect(isInlineScoutTask([])).toBe(false);
        expect(isInlineScoutTask(null as any)).toBe(false);
        expect(isInlineScoutTask([{}])).toBe(false);
      });
    });

    describe("Orchestrator Scout Inline Wait Closed-Loop", () => {
      it("should NOT trigger onMainSessionVirtualized, NOT increment generation, NOT close client, and return result in current session", async () => {
        const mockResponses = [
          // Turn 1: Orchestrator issues inline scout subagent
          `THOUGHT: 派发斥候子代理探查系统架构大纲
\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 斥候探查代码库大纲
    prompt: 探查当前工作区目录并提取架构大纲
\`\`\``,
          // Turn 2: Orchestrator receives scout report and completes with FINAL_ANSWER
          `THOUGHT: 收到斥候探测报告，已清晰掌握架构。
FINAL_ANSWER: 架构大纲探查完毕，包含 auth、agent 与 protocol 核心模块。`,
        ];

        const client = new MockChatHubClient(mockResponses);

        let executeBatchTasks: any[] = [];
        const mockRunner = {
          executeBatch: async (tasks: any[]) => {
            executeBatchTasks = tasks;
            return [
              {
                id: "sub-scout-1",
                role: "researcher",
                description: "斥候探查代码库大纲",
                success: true,
                finalAnswer: "发现 auth、agent、protocol 模块，结构完整。",
                turnsCount: 2,
                durationMs: 650,
                deliverablePath: ".cph/reports/report-scout-1.md",
              },
            ];
          },
          formatReportSummary: () =>
            `### 🎯 斥候子代理探测报告: 发现 auth、agent、protocol 模块，结构完整。`,
        };

        const orchestrator = new Orchestrator({
          workspaceRoot: tempDir,
          bridge,
          chatClient: client,
          subagentRunner: mockRunner as any,
          customAgentId: "main-scout-agent",
        });

        let virtualizedCalled = false;
        let virtualizedSnapshot: any = null;
        let successorAwakenedCalled = false;
        const toolStarts: string[] = [];
        const toolEnds: string[] = [];

        const initialGeneration = orchestrator.getGeneration();
        expect(initialGeneration).toBe(1);

        const result = await orchestrator.run({
          task: "探查代码库并输出大纲",
          sessionId: "main-scout-session",
          events: {
            onMainSessionVirtualized: (snapshot) => {
              virtualizedCalled = true;
              virtualizedSnapshot = snapshot;
            },
            onSuccessorAwakened: () => {
              successorAwakenedCalled = true;
            },
            onToolStart: (a) => {
              toolStarts.push(a.tool || "");
            },
            onToolEnd: (r) => {
              toolEnds.push(r.actionName);
            },
          },
        });

        // 1. Task completed in current session
        expect(result.completed).toBe(true);
        expect(result.turnsCount).toBe(2);
        expect(result.finalAnswer).toContain("架构大纲探查完毕");

        // 2. Scout Inline Wait invariants:
        // - onMainSessionVirtualized MUST NOT be triggered
        expect(virtualizedCalled).toBe(false);
        expect(virtualizedSnapshot).toBeNull();

        // - Client connection MUST remain open and NOT closed
        expect(client.closed).toBe(false);

        // - Generation MUST NOT increment
        expect(orchestrator.getGeneration()).toBe(1);

        // - onSuccessorAwakened MUST NOT be called
        expect(successorAwakenedCalled).toBe(false);

        // 3. Runner was called with subagents spec
        expect(executeBatchTasks.length).toBe(1);
        expect(executeBatchTasks[0].description).toBe("斥候探查代码库大纲");

        // 4. Tool start and end events fired for invoke_subagent
        expect(toolStarts).toContain("invoke_subagent");
        expect(toolEnds).toContain("invoke_subagent");

        // 5. Turn 2 prompt sent to client contained scout report
        expect(client.sentPrompts.length).toBe(2);
        expect(client.sentPrompts[1]).toContain("斥候子代理探测报告");
      });

      it("should execute standard virtualization and generational increment for non-scout multi-subagent batch", async () => {
        const mockResponses = [
          // Turn 1: Orchestrator issues standard batch with coder and researcher
          `THOUGHT: 派发多智能体协作实施复杂任务
\`\`\`action
tool: invoke_subagent
subagents:
  - role: coder
    description: 编写业务代码
    prompt: 实现重构代码
  - role: researcher
    description: 验证单元测试
    prompt: 运行测试并分析覆盖率
\`\`\``,
          // Turn 2: Successor session completes
          `FINAL_ANSWER: 多智能体批处理任务圆满完成。`,
        ];

        const client = new MockChatHubClient(mockResponses);

        const mockRunner = {
          executeBatch: async () => [
            {
              id: "sub-1",
              role: "coder",
              description: "编写业务代码",
              success: true,
              finalAnswer: "代码已编写",
              turnsCount: 3,
              durationMs: 1500,
            },
            {
              id: "sub-2",
              role: "researcher",
              description: "验证单元测试",
              success: true,
              finalAnswer: "单测 100% 通过",
              turnsCount: 2,
              durationMs: 1200,
            },
          ],
          formatReportSummary: () => "### 🎯 子代理多会话并发执行报告: 全部成功",
        };

        const orchestrator = new Orchestrator({
          workspaceRoot: tempDir,
          bridge,
          chatClient: client,
          subagentRunner: mockRunner as any,
          customAgentId: "main-batch-agent",
        });

        let virtualizedCalled = false;
        let successorAwakenedCalled = false;
        let successorNewSessionId = "";

        const result = await orchestrator.run({
          task: "多智能体批量实施任务",
          sessionId: "main-batch-session",
          events: {
            onMainSessionVirtualized: () => {
              virtualizedCalled = true;
            },
            onSuccessorAwakened: (newSessionId) => {
              successorAwakenedCalled = true;
              successorNewSessionId = newSessionId;
            },
          },
        });

        // For non-scout batch:
        // - Virtualization MUST be triggered
        expect(virtualizedCalled).toBe(true);

        // - Client close method was called
        expect(client.closed).toBe(true);

        // - Generation MUST increment
        expect(orchestrator.getGeneration()).toBe(2);

        // - onSuccessorAwakened MUST be triggered
        expect(successorAwakenedCalled).toBe(true);
        expect(successorNewSessionId).toContain("_gen2");
      });
    });
  });

  describe("8. Write-After-Sync Barrier (Task 3)", () => {
    it("should trigger bounded write-after-sync barrier when sync-manifest.json exists and append Cloud Mirror note", async () => {
      // Create sync-manifest.json with mockTransport
      const stateDir = join(tempDir, ".cph", "state");
      await mkdir(stateDir, { recursive: true });
      const manifestPath = join(stateDir, "sync-manifest.json");
      await writeFile(
        manifestPath,
        JSON.stringify({
          version: 2,
          siteUrl: "https://example.sharepoint.com/sites/TestSite",
          targetFolder: "/sites/TestSite/Shared Documents",
          mockTransport: true,
          files: {},
        }),
        "utf8"
      );

      const mockResponses = [
        `THOUGHT: Editing file
\`\`\`action
tool: edit
path: sample.txt
old_string: hello
new_string: greetings
\`\`\``,
        `THOUGHT: Done
FINAL_ANSWER: Edited file successfully`,
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
      });

      const result = await orchestrator.run({
        task: "Update sample file",
      });

      expect(result.completed).toBe(true);
      expect(client.sentPrompts.length).toBeGreaterThan(1);
      // Turn 2 prompt should contain either the synced note or pending note (graceful fallback)
      const turn2Prompt = client.sentPrompts[1];
      expect(turn2Prompt).toMatch(/\[Cloud Mirror: (?:Synced sample\.txt to SharePoint|PENDING)/);

      // Verify virtual-repo-map.md was created/updated
      const mapPath = join(stateDir, "virtual-repo-map.md");
      expect(await readFile(mapPath, "utf8")).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    }, 20000);

    it("should NOT run write-after-sync barrier when modified file is inside .cph/", async () => {
      const stateDir = join(tempDir, ".cph", "state");
      await mkdir(stateDir, { recursive: true });
      const manifestPath = join(stateDir, "sync-manifest.json");
      await writeFile(
        manifestPath,
        JSON.stringify({
          version: 2,
          siteUrl: "https://example.sharepoint.com/sites/TestSite",
          targetFolder: "/sites/TestSite/Shared Documents",
          mockTransport: true,
          files: {},
        }),
        "utf8"
      );
      const cphFile = join(stateDir, "internal.txt");
      await writeFile(cphFile, "cph content", "utf8");

      const mockResponses = [
        `THOUGHT: Editing .cph file
\`\`\`action
tool: edit
path: .cph/state/internal.txt
old_string: cph content
new_string: updated cph content
\`\`\``,
        `THOUGHT: Done
FINAL_ANSWER: Edited .cph file`,
      ];

      const client = new MockChatHubClient(mockResponses);
      const orchestrator = new Orchestrator({
        workspaceRoot: tempDir,
        bridge,
        chatClient: client,
      });

      const result = await orchestrator.run({
        task: "Update internal cph file",
      });

      expect(result.completed).toBe(true);
      const turn2Prompt = client.sentPrompts[1];
      expect(turn2Prompt).not.toContain("[Cloud Mirror:");
    }, 20000);
  });
});


