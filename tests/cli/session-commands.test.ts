import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CphPiCli, parseCliArgs } from "../../src/cli.ts";
import { SessionManager } from "../../src/session/session-manager.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";

describe("CLI Session Commands & Flags Unit Tests", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;
  let cliOutputBuffer: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cli-session-test-"));
    sessionManager = new SessionManager(tmpDir);
    cliOutputBuffer = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const getCombinedOutput = () => cliOutputBuffer.join("");

  describe("1. CLI Flags Parsing (--continue, --resume, -c, -r)", () => {
    it("should parse --continue and -c flags", () => {
      const res1 = parseCliArgs(["--continue"]);
      expect(res1.continueLast).toBe(true);

      const res2 = parseCliArgs(["-c"]);
      expect(res2.continueLast).toBe(true);
    });

    it("should parse --resume and -r flags with session ID", () => {
      const res1 = parseCliArgs(["--resume", "ses_test_123"]);
      expect(res1.resumeSessionId).toBe("ses_test_123");

      const res2 = parseCliArgs(["-r", "ses_test_456"]);
      expect(res2.resumeSessionId).toBe("ses_test_456");

      const res3 = parseCliArgs(["--resume=ses_test_789"]);
      expect(res3.resumeSessionId).toBe("ses_test_789");

      const res4 = parseCliArgs(["-r=ses_test_abc"]);
      expect(res4.resumeSessionId).toBe("ses_test_abc");
    });

    it("should parse --continue along with task prompt", () => {
      const res = parseCliArgs(["--continue", "继续重构模块"]);
      expect(res.continueLast).toBe(true);
      expect(res.task).toBe("继续重构模块");
    });
  });

  describe("2. formatSessionsList() Rendering", () => {
    it("should display empty notice when no sessions exist", () => {
      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
      });

      const output = cli.formatSessionsList();
      expect(output).toBeDefined();
      expect(output).toContain("暂无历史会话记录");
    });

    it("should render tabular formatted list when sessions exist", () => {
      sessionManager.createSession({ title: "任务 Alpha", maxTurns: 25 });
      sessionManager.createSession({ title: "任务 Beta", maxTurns: 30 });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
      });

      const output = cli.formatSessionsList();
      expect(output).toContain("历史会话列表");
      expect(output).toContain("会话 ID");
      expect(output).toContain("标题");
      expect(output).toContain("轮次");
      expect(output).toContain("状态");
      expect(output).toContain("最后活跃时间");
      expect(output).toContain("任务 Alpha");
      expect(output).toContain("任务 Beta");
    });
  });

  describe("3. Interactive Slash Commands: /new, /sessions, /resume, /status", () => {
    it("should handle /new command by creating new session and resetting handshake", async () => {
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        cliOutputBuffer.push(String(chunk));
        return true;
      }) as any;

      try {
        const cli = new CphPiCli({
          workspaceRoot: tmpDir,
          sessionManager,
        });

        // Initialize first session
        const session1 = cli.initSession();
        expect(session1.id).toBeDefined();
        cli.getOrchestrator().isHandshakePending = false;

        // Execute /new
        await cli.handleCommand("/new 重构测试套件");

        const session2 = cli.getCurrentSession();
        expect(session2).toBeDefined();
        expect(session2!.id).not.toBe(session1.id);
        expect(session2!.title).toBe("重构测试套件");
        expect(cli.getOrchestrator().isHandshakePending).toBe(true);

        // Previous session should be marked completed
        const prevSession = sessionManager.loadSession(session1.id);
        expect(prevSession?.status).toBe("completed");

        const stdout = getCombinedOutput();
        expect(stdout).toContain("新会话已开启");
        expect(stdout).toContain(session2!.id);
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
    });

    it("should handle /sessions command by printing list", async () => {
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        cliOutputBuffer.push(String(chunk));
        return true;
      }) as any;

      try {
        sessionManager.createSession({ title: "会话 1" });
        const cli = new CphPiCli({
          workspaceRoot: tmpDir,
          sessionManager,
        });

        await cli.handleCommand("/sessions");
        const stdout = getCombinedOutput();
        expect(stdout).toContain("历史会话列表");
        expect(stdout).toContain("会话 1");
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
    });

    it("should handle /resume command for existing and non-existing sessions", async () => {
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        cliOutputBuffer.push(String(chunk));
        return true;
      }) as any;

      try {
        const targetSession = sessionManager.createSession({ title: "待恢复会话" });
        // Give targetSession some turns so handshake is not pending
        targetSession.turns.push({
          turnNumber: 1,
          timestamp: new Date().toISOString(),
          userInput: "探测",
          modelResponse: "ok",
        });
        targetSession.turnCount = 1;
        sessionManager.saveSession(targetSession);

        const cli = new CphPiCli({
          workspaceRoot: tmpDir,
          sessionManager,
        });

        // Resume non-existing
        await cli.handleCommand("/resume ses_not_found_999");
        expect(getCombinedOutput()).toContain("未找到会话 ID");

        // Resume without arg
        cliOutputBuffer = [];
        await cli.handleCommand("/resume");
        expect(getCombinedOutput()).toContain("请输入要恢复的会话 ID");

        // Resume existing
        cliOutputBuffer = [];
        await cli.handleCommand(`/resume ${targetSession.id}`);
        expect(getCombinedOutput()).toContain("已恢复会话");
        expect(getCombinedOutput()).toContain(targetSession.id);
        expect(cli.getCurrentSession()?.id).toBe(targetSession.id);
        expect(cli.getOrchestrator().isHandshakePending).toBe(false);
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
    });

    it("should handle /status command with session diagnostics card", async () => {
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        cliOutputBuffer.push(String(chunk));
        return true;
      }) as any;

      try {
        const cli = new CphPiCli({
          workspaceRoot: tmpDir,
          sessionManager,
        });
        cli.initSession();

        await cli.handleCommand("/status");
        const stdout = getCombinedOutput();
        expect(stdout).toContain("CPH-PI 运行与会话诊断卡");
        expect(stdout).toContain("当前会话 ID");
        expect(stdout).toContain("当前轮次");
        expect(stdout).toContain("工作区目录");
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
    });
  });

  describe("4. Session Auto-Resolution (--continue & --resume startup)", () => {
    it("should auto-load latest active session when continueLast is true", () => {
      const s1 = sessionManager.createSession({ title: "旧会话" });
      s1.status = "completed";
      sessionManager.saveSession(s1);

      const s2 = sessionManager.createSession({ title: "活跃会话" });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        continueLast: true,
      });

      const current = cli.initSession();
      expect(current.id).toBe(s2.id);
      expect(current.title).toBe("活跃会话");
    });

    it("should auto-load specified session when resumeSessionId is provided", () => {
      const s1 = sessionManager.createSession({ title: "会话 A" });
      const s2 = sessionManager.createSession({ title: "会话 B" });

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        resumeSessionId: s1.id,
      });

      const current = cli.initSession();
      expect(current.id).toBe(s1.id);
      expect(current.title).toBe("会话 A");
    });
  });

  describe("5. Incremental Persistence After Task Execution", () => {
    it("should persist session turns to disk after orchestrator runs", async () => {
      const mockClient = {
        sendMessage: async (params: { text: string }) => {
          if (params.text.includes("【第一轮基准探测握手")) {
            return { text: "```action\ntool: run_command\ncommand: git status\n```" };
          }
          return { text: "FINAL_ANSWER: 测试任务搞定" };
        },
      };

      const cli = new CphPiCli({
        workspaceRoot: tmpDir,
        sessionManager,
        chatClient: mockClient as any,
      });

      await cli.executeTask("测试自动存盘");

      const current = cli.getCurrentSession();
      expect(current).toBeDefined();
      expect(current!.turnCount).toBeGreaterThanOrEqual(1);

      // Verify on disk
      const onDisk = sessionManager.loadSession(current!.id);
      expect(onDisk).toBeDefined();
      expect(onDisk!.turnCount).toBe(current!.turnCount);
      expect(onDisk!.turns.length).toBeGreaterThanOrEqual(1);
    });
  });
});

