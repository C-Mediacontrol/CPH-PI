import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CopilotOrchestrator } from "../../src/agent/orchestrator.ts";
import { CphPiCli } from "../../src/cli.ts";
import { SessionManager } from "../../src/session/session-manager.ts";

describe("E2E Session Flow & Auto-Handoff Integration Tests", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;
  let cliOutputBuffer: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-e2e-session-"));
    sessionManager = new SessionManager(tmpDir);
    cliOutputBuffer = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const getCombinedOutput = () => cliOutputBuffer.join("");

  describe("1. Orchestrator Auto-Handoff on Reaching maxTurns", () => {
    it("should trigger auto-handoff when turn limit is reached and carry structured handoffSnapshot", async () => {
      let turnCount = 0;
      const executedTools: string[] = [];
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          turnCount++;
          if (params.text.includes("【第一轮基准探测握手")) {
            return { text: "```action\ntool: run_command\ncommand: git status\n```" };
          }
          if (turnCount === 2) {
            return { text: "```action\ntool: read_file\npath: package.json\n```" };
          }
          return { text: "```action\ntool: run_command\ncommand: npm test\n```" };
        },
      };

      let snapshotEventTriggered = false;
      let eventSnapshot = "";

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tmpDir,
        maxTurns: 3,
        chatClient: mockClient as any,
      });

      const result = await orchestrator.run({
        task: "执行全量代码重构与性能优化",
        events: {
          onToolStart: (act) => {
            executedTools.push(act.tool);
          },
          onHandoff: (snap) => {
            snapshotEventTriggered = true;
            eventSnapshot = snap;
          },
        },
      });

      // 验证未完成与自动脱困标记
      expect(result.completed).toBe(false);
      expect(result.handedOff).toBe(true);
      expect(result.turnsCount).toBe(3);
      expect(result.finalAnswer).toContain("Max turns reached without final answer");

      // 验证历史记录与工具执行
      expect(result.history.length).toBe(3);
      expect(snapshotEventTriggered).toBe(true);
      expect(eventSnapshot).toBeDefined();

      // 验证快照结构
      const snapshot = result.handoffSnapshot;
      expect(snapshot).toBeDefined();
      expect(snapshot).toContain("### [阶段性成果快照 (Auto-Handoff Snapshot)]");
      expect(snapshot).toContain("执行全量代码重构与性能优化");
      expect(snapshot).toContain("已执行动作清单");
      expect(snapshot).toContain("run_command");
      expect(snapshot).toContain("read_file");
      expect(snapshot).toContain("最近工具发现与上下文");
      expect(snapshot).toContain("接力建议");
    });
  });

  describe("2. CLI Auto-Handoff Behavior & Session State Transitions", () => {
    it("should mark session status as handed_off on disk in non-interactive mode", async () => {
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          if (params.text.includes("【第一轮基准探测握手")) {
            return { text: "```action\ntool: run_command\ncommand: git status\n```" };
          }
          return { text: "```action\ntool: read_file\npath: package.json\n```" };
        },
      };

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        maxTurns: 2,
        chatClient: mockClient as any,
        isInteractive: false,
      });

      const session = cli.initSession();
      const initialId = session.id;

      await cli.executeTask("非交互长任务");

      // 会话应被标记为 handed_off 并落盘
      const saved = sessionManager.loadSession(initialId);
      expect(saved).toBeDefined();
      expect(saved!.status).toBe("handed_off");
      expect(saved!.handoffSnapshot).toBeDefined();
      expect(saved!.handoffSnapshot).toContain("非交互长任务");

      // 索引中状态也应同步更新
      const indexList = sessionManager.listSessions();
      const indexEntry = indexList.find((i) => i.id === initialId);
      expect(indexEntry?.status).toBe("handed_off");
    });

    it("should archive handed_off session and auto-create relay session in interactive mode", async () => {
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          if (params.text.includes("【第一轮基准探测握手")) {
            return { text: "```action\ntool: run_command\ncommand: git status\n```" };
          }
          return { text: "```action\ntool: read_file\npath: package.json\n```" };
        },
      };

      const originalStdout = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        cliOutputBuffer.push(String(chunk));
        return true;
      }) as any;

      try {
        const cli = new CphPiCli({
          workspaceRoot: tmpDir,
          sessionManager,
          maxTurns: 2,
          chatClient: mockClient as any,
          isInteractive: true,
        });

        const initialSession = cli.initSession();
        const initialId = initialSession.id;

        await cli.executeTask("交互式长链复杂任务");

        // 1. 验证前序会话已正确标记 handed_off
        const archived = sessionManager.loadSession(initialId);
        expect(archived).toBeDefined();
        expect(archived!.status).toBe("handed_off");

        // 2. 验证控制台输出了黄色脱困提示与成果快照
        const out = getCombinedOutput();
        expect(out).toContain("🔄 [Auto-Handoff]");
        expect(out).toContain("当前会话已达单次推理上限，已自动提取成果快照并归档会话");
        expect(out).toContain("【阶段性成果快照摘要】");
        expect(out).toContain("已自动开启接力新会话");

        // 3. 验证 CLI 当前会话已自动切换为接续新会话
        const currentSession = cli.getCurrentSession();
        expect(currentSession).toBeDefined();
        expect(currentSession!.id).not.toBe(initialId);
        expect(currentSession!.title).toContain("(接力)");
        expect(currentSession!.status).toBe("active");

        // 4. 验证新会话背景中注入了快照
        expect(currentSession!.turns.length).toBe(1);
        expect(currentSession!.turns[0].userInput).toContain("[前序会话脱困成果快照]");
        expect(currentSession!.turns[0].modelResponse).toContain("已加载阶段性成果快照");

        // 5. 验证状态机已重置为 Turn 1 探测握手
        expect(cli.getOrchestrator().getIsHandshakePending()).toBe(true);

        // 6. 验证 pendingHandoffSnapshot 已设置
        expect(cli.getPendingHandoffSnapshot()).toBeDefined();
      } finally {
        process.stdout.write = originalStdout;
      }
    });
  });

  describe("3. Full Lifecycle Flow: Create -> Handshake -> Persist -> Exit -> --continue Resume", () => {
    it("should execute full session lifecycle from handshake probe to resume seamlessly", async () => {
      const promptsLog1: string[] = [];
      const mockClient1 = {
        sendMessage: async (params: { text: string }) => {
          promptsLog1.push(params.text);
          if (params.text.includes("【第一轮基准探测握手")) {
            return { text: "```action\ntool: run_command\ncommand: git status\n```" };
          }
          return { text: "FINAL_ANSWER: 第一阶段握手与环境探测就绪" };
        },
      };

      // 阶段 1: 启动 CLI 实例 1 并执行首个任务
      const cli1 = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        chatClient: mockClient1 as any,
        isInteractive: true,
      });

      const s1 = cli1.initSession();
      const s1Id = s1.id;
      expect(cli1.getOrchestrator().getIsHandshakePending()).toBe(true);

      await cli1.executeTask("初始化并分析项目架构");

      // 验证 Turn 1 纯净握手与 Turn 2 需求注入
      expect(promptsLog1.length).toBe(2);
      expect(promptsLog1[0]).toContain("【第一轮基准探测握手 (Turn 1 Grounding Handshake)】");
      expect(promptsLog1[0]).toContain("command: git status");
      expect(promptsLog1[0]).not.toContain("初始化并分析项目架构");

      expect(promptsLog1[1]).toContain("【环境握手完成：本地工具与工作区已就绪】");
      expect(promptsLog1[1]).toContain("初始化并分析项目架构");

      // 验证落盘文件与增量轮次
      const diskSession1 = sessionManager.loadSession(s1Id);
      expect(diskSession1).toBeDefined();
      expect(diskSession1!.turnCount).toBe(2);
      expect(diskSession1!.turns.length).toBe(2);

      // 阶段 2: 同一会话追问任务 (不重复握手)
      const promptsLogFollowUp: string[] = [];
      (mockClient1 as any).sendMessage = async (params: { text: string }) => {
        promptsLogFollowUp.push(params.text);
        return { text: "FINAL_ANSWER: 追问模块分析完成" };
      };

      await cli1.executeTask("追问模块依赖细节");
      expect(promptsLogFollowUp.length).toBe(1);
      expect(promptsLogFollowUp[0]).not.toContain("【第一轮基准探测握手");
      expect(promptsLogFollowUp[0]).toContain("追问模块依赖细节");

      // 增量存盘检查
      const diskSessionAfterFollowUp = sessionManager.loadSession(s1Id);
      expect(diskSessionAfterFollowUp!.turnCount).toBe(3);

      // 阶段 3: 模拟退出 CLI
      cli1.close();

      // 阶段 4: 新 CLI 实例通过 --continue 恢复会话
      const promptsLog2: string[] = [];
      const mockClient2 = {
        sendMessage: async (params: { text: string }) => {
          promptsLog2.push(params.text);
          return { text: "FINAL_ANSWER: 成功接续会话并完成第三个任务" };
        },
      };

      const cli2 = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        continueLast: true,
        chatClient: mockClient2 as any,
        isInteractive: true,
      });

      const resumedSession = cli2.initSession();
      // 验证恢复的是之前的会话
      expect(resumedSession.id).toBe(s1Id);
      expect(resumedSession.turnCount).toBe(3);
      // 验证状态机不会对已探测恢复的会话重新进行 Turn 1 探测
      expect(cli2.getOrchestrator().getIsHandshakePending()).toBe(false);

      // 在恢复的会话中继续执行新任务
      await cli2.executeTask("在恢复会话中执行追加测试");
      expect(promptsLog2.length).toBe(1);
      expect(promptsLog2[0]).not.toContain("【第一轮基准探测握手");
      expect(promptsLog2[0]).toContain("在恢复会话中执行追加测试");

      // 验证落盘轮次进一步递增
      const finalDiskSession = sessionManager.loadSession(s1Id);
      expect(finalDiskSession!.turnCount).toBe(4);
      expect(finalDiskSession!.turns.length).toBe(4);

      cli2.close();
    });
  });
});

