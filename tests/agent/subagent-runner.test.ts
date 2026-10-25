import { describe, it, expect, spyOn } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import {
  SubagentRunner,
  extractTargetFilePath,
  type SubagentRunnerOptions,
} from "../../src/agent/subagent-runner.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";
import type { SubagentTaskSpec } from "../../src/protocol/tool-bridge.ts";

describe("SubagentRunner", () => {
  it("should execute multiple subagent tasks concurrently and aggregate reports", async () => {
    const executedTasks: Array<{ role: string; customAgentId: string; prompt: string }> = [];

    const mockOrchestratorFactory = (opts: any) => ({
      run: async (runOpts: any) => {
        executedTasks.push({
          role: opts.subagentRole,
          customAgentId: opts.customAgentId,
          prompt: runOpts.task,
        });
        return {
          finalAnswer: `Subagent [${opts.subagentRole}] 完成交付: ${runOpts.task}`,
          turnsCount: 2,
          completed: true,
          history: [],
        };
      },
    });

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-session-test",
      coderAgentId: "coder-id-123",
      researcherAgentId: "researcher-id-456",
      createOrchestratorFn: mockOrchestratorFactory,
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "researcher", description: "调研接口", prompt: "调研接口: 检查 account-pool 导出" },
      { role: "coder", description: "修复测试", prompt: "修复 auth 模块测试" },
    ];

    const reports = await runner.executeBatch(tasks);

    expect(reports.length).toBe(2);
    // Dual-Agent architecture normalizes all subagents to coder
    expect(reports[0].role).toBe("coder");
    expect(reports[0].success).toBe(true);
    expect(reports[0].finalAnswer).toContain("调研接口");
    expect(reports[1].role).toBe("coder");
    expect(reports[1].success).toBe(true);

    expect(executedTasks.length).toBe(2);
    expect(executedTasks[0].customAgentId).toBe("coder-id-123");
    expect(executedTasks[1].customAgentId).toBe("coder-id-123");

    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("子代理多会话并发执行报告");
    expect(summary).toContain("coder");
    expect(summary).toContain("coder");
  });

  it("should release session leases in account pool after subagents complete", async () => {
    const releasedSessions: string[] = [];
    const mockPool: any = {
      getPoolStatus: () => [
        { email: "acc1@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        { email: "acc2@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
      ],
      releaseSessionLease: (sessionId: string) => {
        releasedSessions.push(sessionId);
      },
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-session-lease-test",
      coderAgentId: "coder-1",
      researcherAgentId: "researcher-1",
      pool: mockPool,
      createOrchestratorFn: () => ({
        run: async () => ({
          finalAnswer: "done",
          turnsCount: 1,
          completed: true,
          history: [],
        }),
      }),
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "coder", description: "task 1", prompt: "task 1" },
      { role: "coder", description: "task 2", prompt: "task 2" },
    ];

    await runner.executeBatch(tasks);

    expect(releasedSessions.length).toBe(2);
    expect(releasedSessions[0]).toContain("main-session-lease-test");
    expect(releasedSessions[1]).toContain("main-session-lease-test");
  });

  it("should stagger parallel worker launches when staggerIntervalMs is configured", async () => {
    const startTimestamps: number[] = [];
    const mockPool: any = {
      getPoolStatus: () => [
        { email: "acc1@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        { email: "acc2@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
      ],
      releaseSessionLease: () => {},
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-stagger-test",
      pool: mockPool,
      staggerIntervalMs: 50,
      createOrchestratorFn: () => ({
        run: async () => {
          startTimestamps.push(Date.now());
          await new Promise((r) => setTimeout(r, 60));
          return { finalAnswer: "done", turnsCount: 1, completed: true, history: [] };
        },
      }),
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "coder", description: "task 1", prompt: "task 1" },
      { role: "coder", description: "task 2", prompt: "task 2" },
    ];

    await runner.executeBatch(tasks);

    expect(startTimestamps.length).toBe(2);
    expect(startTimestamps[1] - startTimestamps[0]).toBeGreaterThanOrEqual(40);
  });

  it("should record leased account email in SubagentTaskReport and notify onSubagentStart", async () => {
    let startedAccount = "";
    const mockPool: any = {
      getPoolStatus: () => [
        { email: "sub-account@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
      ],
      acquireSessionLease: async () => ({
        token: "tok",
        email: "sub-account@contoso.com",
      }),
      releaseSessionLease: () => {},
      getSessionLease: () => "sub-account@contoso.com",
    };

    const runner = new SubagentRunner({
      workspaceRoot: process.cwd(),
      mainSessionId: "main-account-record-test",
      pool: mockPool,
      createOrchestratorFn: () => ({
        run: async () => ({
          finalAnswer: "done",
          turnsCount: 1,
          completed: true,
          history: [],
        }),
      }),
    });

    const tasks: SubagentTaskSpec[] = [
      { role: "coder", description: "task 1", prompt: "task 1" },
    ];

    const reports = await runner.executeBatch(tasks, undefined, {
      onSubagentStart: (_id: string, _role: string, _spec: any, _hop?: number, account?: string) => {
        if (account) startedAccount = account;
      },
    });

    expect(reports[0].account).toBe("sub-account@contoso.com");
    expect(startedAccount).toBe("sub-account@contoso.com");

    const summary = runner.formatReportSummary(reports);
    expect(summary).toContain("[账号: sub-account@contoso.com]");
    expect(summary).toContain("账号: sub-account@contoso.com");
  });

  describe("extractTargetFilePath", () => {
    const workspaceRoot = process.cwd();
    const existingFileRel = "src/agent/subagent-runner.ts";
    const existingFileAbs = path.resolve(workspaceRoot, existingFileRel);

    it("should extract path from explicit targetPath, file, or filePath", () => {
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "", targetPath: existingFileRel } as any,
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "", file: existingFileRel } as any,
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "", filePath: existingFileAbs } as any,
          workspaceRoot
        )
      ).toBe(existingFileAbs);
    });

    it("should extract path from Chinese and English prefix patterns in prompt or description", () => {
      // 目标文件: ...
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `目标文件: ${existingFileRel} 请深入分析` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // 目标文件：... (full-width colon)
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `目标文件：${existingFileRel}` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // 针对文件: ...
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `针对文件: ${existingFileRel} 进行重构` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // 分析文件: ...
      expect(
        extractTargetFilePath(
          { role: "researcher", description: `分析文件: ${existingFileRel}`, prompt: "请执行分析" },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // 读取文件: ...
      expect(
        extractTargetFilePath(
          { role: "researcher", description: "", prompt: `读取文件: ${existingFileRel} 校验导出` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // 探查文件: ...
      expect(
        extractTargetFilePath(
          { role: "researcher", description: "", prompt: `探查文件: ${existingFileRel}` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // target file: ...
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `target file: ${existingFileRel}` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // file: ...
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `file: ${existingFileRel}` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      // Trailing punctuation stripping
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `目标文件: ${existingFileRel}。` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `目标文件: ${existingFileRel}, 请分析` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);
    });

    it("should extract path wrapped in backticks", () => {
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: `请仔细审查 \`${existingFileRel}\` 文件的异常处理` },
          workspaceRoot
        )
      ).toBe(existingFileAbs);

      expect(
        extractTargetFilePath(
          { role: "coder", description: `探查 \`${existingFileRel}\``, prompt: "完成审查" },
          workspaceRoot
        )
      ).toBe(existingFileAbs);
    });

    it("should return null when file does not exist or matches no pattern", () => {
      // Explicit non-existent file
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "", targetPath: "src/non-existent-abc-xyz.ts" } as any,
          workspaceRoot
        )
      ).toBeNull();

      // Prefix non-existent file
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "目标文件: non-existent-12345.ts" },
          workspaceRoot
        )
      ).toBeNull();

      // Backtick non-existent file
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "请查看 `non-existent-54321.ts`" },
          workspaceRoot
        )
      ).toBeNull();

      // Backtick command (not an existing file)
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "请执行 `bun test` 验证结果" },
          workspaceRoot
        )
      ).toBeNull();

      // No file pattern at all
      expect(
        extractTargetFilePath(
          { role: "coder", description: "通用任务", prompt: "整理项目全局架构文档" },
          workspaceRoot
        )
      ).toBeNull();

      // Directory instead of a file
      expect(
        extractTargetFilePath(
          { role: "coder", description: "", prompt: "分析文件: src/agent" },
          workspaceRoot
        )
      ).toBeNull();
    });
  });

  describe("SubagentRunner single-file cloud attachment automatic mounting", () => {
    it("should mount initialAnnotations when target file is detected and graph token is available", async () => {
      const mockAnnotation = {
        id: "attachment-mock-id-123",
        messageAnnotationMetadata: {
          "@type": "File",
          fileName: "subagent-runner.ts",
          fileType: "ts",
        },
        messageAnnotationType: "File",
      };

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockResolvedValue({
        driveItemId: "drive-item-1",
        webUrl: "https://contoso.sharepoint.com/mock-file",
        fileName: "subagent-runner.ts",
        annotation: mockAnnotation as any,
      });

      const mockPool: any = {
        getPoolStatus: () => [
          { email: "acc@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        ],
        getGraphAccessToken: async () => "mock-graph-token-xyz-123",
        releaseSessionLease: () => {},
      };

      let capturedRunOptions: any = null;
      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "main-session-cloud-attach-test",
        pool: mockPool,
        createOrchestratorFn: () => ({
          run: async (opts: any) => {
            capturedRunOptions = opts;
            return { finalAnswer: "done", turnsCount: 1, completed: true, history: [] };
          },
        }),
      });

      const task: SubagentTaskSpec = {
        role: "coder",
        description: "优化子代理",
        prompt: "目标文件: src/agent/subagent-runner.ts 请进行单文件深度优化",
      };

      const reports = await runner.executeBatch([task]);

      expect(reports.length).toBe(1);
      expect(reports[0].success).toBe(true);

      // Verify SubstrateUploader.uploadDocumentToOneDrive was called
      expect(uploadSpy).toHaveBeenCalled();
      const lastCallArgs = uploadSpy.mock.calls[uploadSpy.mock.calls.length - 1];
      expect(lastCallArgs[0]).toBe("mock-graph-token-xyz-123");
      expect(lastCallArgs[2]).toBe("subagent-runner.ts");
      expect(typeof lastCallArgs[1]).toBe("string");
      expect(lastCallArgs[1]).toContain("extractTargetFilePath");

      // Verify orchestrator.run received initialAnnotations
      expect(capturedRunOptions).not.toBeNull();
      expect(capturedRunOptions.initialAnnotations).toBeDefined();
      expect(capturedRunOptions.initialAnnotations.length).toBe(1);
      expect(capturedRunOptions.initialAnnotations[0]).toEqual(mockAnnotation);

      uploadSpy.mockRestore();
    });

    it("should pass subagentAccount to pool.getGraphAccessToken", async () => {
      let passedAccountToGraph: string | undefined = undefined;
      const mockPool: any = {
        getPoolStatus: () => [
          { email: "sub1@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        ],
        acquireSessionLease: async () => ({
          token: "tok",
          email: "sub1@contoso.com",
        }),
        getNextAvailableToken: async () => ({
          email: "sub1@contoso.com",
          token: "token-sub1",
        }),
        getGraphAccessToken: async (email?: string) => {
          passedAccountToGraph = email;
          return "mock-graph-token";
        },
        releaseSessionLease: () => {},
      };

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockResolvedValue({
        driveItemId: "item-1",
        webUrl: "https://sp.com/sub.ts",
        fileName: "subagent-runner.ts",
        annotation: {
          type: "File",
          fileName: "subagent-runner.ts",
          fileUrl: "https://sp.com/sub.ts",
          title: "subagent-runner.ts",
          fileSize: 100,
        },
      });

      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "main-session-acc-test",
        pool: mockPool,
        createOrchestratorFn: () => ({
          run: async () => ({ finalAnswer: "done", turnsCount: 1, completed: true, history: [] }),
        }),
      });

      await runner.executeBatch([
        {
          role: "coder",
          description: "单文件优化",
          prompt: "目标文件: src/agent/subagent-runner.ts 请优化",
        },
      ]);

      expect(passedAccountToGraph).toBe("sub1@contoso.com");
      uploadSpy.mockRestore();
    });

    it("should gracefully degrade without crashing when uploadDocumentToOneDrive fails", async () => {
      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockRejectedValue(
        new Error("Network timeout or 500 error from Graph API")
      );

      const mockPool: any = {
        getPoolStatus: () => [
          { email: "acc@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        ],
        getGraphAccessToken: async () => "mock-graph-token-err",
        releaseSessionLease: () => {},
      };

      let capturedRunOptions: any = null;
      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "main-session-degrade-test",
        pool: mockPool,
        createOrchestratorFn: () => ({
          run: async (opts: any) => {
            capturedRunOptions = opts;
            return { finalAnswer: "done", turnsCount: 1, completed: true, history: [] };
          },
        }),
      });

      const task: SubagentTaskSpec = {
        role: "coder",
        description: "单文件优化",
        prompt: "目标文件: src/agent/subagent-runner.ts 请处理",
      };

      const reports = await runner.executeBatch([task]);

      expect(reports.length).toBe(1);
      expect(reports[0].success).toBe(true);
      expect(uploadSpy).toHaveBeenCalled();
      expect(capturedRunOptions.initialAnnotations).toBeUndefined();

      uploadSpy.mockRestore();
    });

    it("should not trigger upload when no target file is detected in the task", async () => {
      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive");

      const mockPool: any = {
        getPoolStatus: () => [
          { email: "acc@contoso.com", isAllowed: true, isThrottled: false, isLeased: false },
        ],
        getGraphAccessToken: async () => "mock-graph-token",
        releaseSessionLease: () => {},
      };

      let capturedRunOptions: any = null;
      const runner = new SubagentRunner({
        workspaceRoot: process.cwd(),
        mainSessionId: "main-session-no-file-test",
        pool: mockPool,
        createOrchestratorFn: () => ({
          run: async (opts: any) => {
            capturedRunOptions = opts;
            return { finalAnswer: "done", turnsCount: 1, completed: true, history: [] };
          },
        }),
      });

      const task: SubagentTaskSpec = {
        role: "researcher",
        description: "通用调研",
        prompt: "调研全局错误处理策略并形成架构报告",
      };

      const reports = await runner.executeBatch([task]);

      expect(reports.length).toBe(1);
      expect(reports[0].success).toBe(true);
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(capturedRunOptions.initialAnnotations).toBeUndefined();

      uploadSpy.mockRestore();
    });
  });
});



