import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import fs from "node:fs";
import { join } from "path";
import { tmpdir } from "os";
import { CopilotOrchestrator, type IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { SnapshotGenerator, type SnapshotResult, type SliceResult } from "../../src/workspace/snapshot-generator.ts";
import { SubstrateUploader, type UploadDocumentResult } from "../../src/transport/substrate-uploader.ts";
import { SubagentRunner } from "../../src/agent/subagent-runner.ts";

describe("Phase 3: Dual-Layer Snapshot Lifecycle & Pipeline Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-dual-layer-test-"));
    await mkdir(join(tempDir, ".cph", "snapshots"), { recursive: true });
    await mkdir(join(tempDir, ".cph", "state"), { recursive: true });
    await mkdir(join(tempDir, "scripts"), { recursive: true });
    // Create dummy sp-sync-engine.ps1 script
    await writeFile(join(tempDir, "scripts", "sp-sync-engine.ps1"), "# dummy sync script\n", "utf8");
  });

  afterEach(async () => {
    if (tempDir) {
      // Allow spawned child processes to release folder handles on Windows
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rm(tempDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  });

  describe("1. Turn 1 Workspace Snapshot Injection & Cache", () => {
    it("should mount full workspace snapshot as annotation in Turn 1 and persist cache", async () => {
      const dummySnapPath = join(tempDir, ".cph", "snapshots", "workspace-snapshot-hash111.txt");
      await writeFile(dummySnapPath, "FAKE_SNAPSHOT_BODY", "utf8");

      const mockSnapResult: SnapshotResult = {
        snapshotPath: dummySnapPath,
        hash: "hash111",
        fileCount: 155,
        bytes: 1300000,
        files: ["src/a.ts"],
        cloudFileName: "workspace-v1.txt",
      };

      const generateSpy = spyOn(SnapshotGenerator, "generateWorkspaceSnapshot").mockReturnValue(mockSnapResult);

      const mockUploadResult: UploadDocumentResult = {
        driveItemId: "item-snap-1",
        webUrl: "https://substrate.office.com/drives/item-snap-1",
        driveId: "drive-snap-1",
        fileName: "workspace-v1.txt",
        annotation: {
          id: "SPO_base64_item-snap-1",
          text: "workspace-v1.txt",
          url: "https://substrate.office.com/drives/item-snap-1",
          messageAnnotationType: "LocalFile",
          messageAnnotationMetadata: {
            "@type": "File",
            annotationType: "File",
            fileName: "workspace-v1.txt",
            webUrl: "https://substrate.office.com/drives/item-snap-1",
            driveId: "drive-snap-1",
            fileType: "txt",
          },
        },
      };

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockResolvedValue(mockUploadResult);

      let receivedAnnotations: any[] | undefined;
      const mockChatClient: IOrchestratorChatClient = {
        sendMessage: async (params: any) => {
          receivedAnnotations = params.annotations;
          return { text: "FINAL_ANSWER: 首轮快照接收正常" };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        chatClient: mockChatClient,
        enableWorkspaceSnapshot: true,
        enableWorkspaceCatalog: false,
        isHandshakePending: false,
        graphTokenProvider: async () => "mock-graph-token",
        maxTurns: 3,
      });

      const res = await orchestrator.run({
        task: "测试首轮全景快照挂载",
        sessionId: "ses_dual_test_1",
      });

      expect(res.completed).toBe(true);
      expect(generateSpy).toHaveBeenCalled();
      expect(uploadSpy).toHaveBeenCalled();
      expect(receivedAnnotations).toBeDefined();
      expect(receivedAnnotations!.length).toBe(1);
      expect(receivedAnnotations![0].id).toBe("SPO_base64_item-snap-1");
      expect(receivedAnnotations![0].messageAnnotationMetadata.fileName).toBe("workspace-v1.txt");

      // Verify cache written to .cph/state/workspace-snapshot-cache.json
      const cachePath = join(tempDir, ".cph", "state", "workspace-snapshot-cache.json");
      expect(fs.existsSync(cachePath)).toBe(true);
      const cacheContent = JSON.parse(await readFile(cachePath, "utf8"));
      expect(cacheContent.snapshotHash).toBe("hash111");
      expect(cacheContent.uploadResult.driveItemId).toBe("item-snap-1");
      expect(cacheContent.uploadResult.annotation.id).toBe("SPO_base64_item-snap-1");

      generateSpy.mockRestore();
      uploadSpy.mockRestore();
    });

    it("should reuse full annotation from cache without re-uploading when snapshot hash is unchanged", async () => {
      const dummySnapPath = join(tempDir, ".cph", "snapshots", "workspace-snapshot-hash222.txt");
      await writeFile(dummySnapPath, "FAKE_SNAPSHOT_BODY_2", "utf8");

      const mockSnapResult: SnapshotResult = {
        snapshotPath: dummySnapPath,
        hash: "hash222",
        fileCount: 155,
        bytes: 1300000,
        files: ["src/b.ts"],
        cloudFileName: "workspace-v1.txt",
      };

      // Pre-seed cache
      const cachePath = join(tempDir, ".cph", "state", "workspace-snapshot-cache.json");
      await writeFile(
        cachePath,
        JSON.stringify({
          snapshotHash: "hash222",
          uploadResult: {
            driveItemId: "item-cached-222",
            webUrl: "https://substrate.office.com/drives/item-cached-222",
            driveId: "drive-cached",
            fileName: "workspace-v1.txt",
            annotation: {
              id: "SPO_CACHED_ANNOTATION_222",
              text: "workspace-v1.txt",
              url: "https://substrate.office.com/drives/item-cached-222",
              messageAnnotationType: "LocalFile",
            },
          },
          updatedAt: new Date().toISOString(),
        }),
        "utf8"
      );

      const generateSpy = spyOn(SnapshotGenerator, "generateWorkspaceSnapshot").mockReturnValue(mockSnapResult);
      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto");

      let receivedAnnotations: any[] | undefined;
      const mockChatClient: IOrchestratorChatClient = {
        sendMessage: async (params: any) => {
          receivedAnnotations = params.annotations;
          return { text: "FINAL_ANSWER: 缓存复用测试完成" };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        chatClient: mockChatClient,
        enableWorkspaceSnapshot: true,
        enableWorkspaceCatalog: false,
        isHandshakePending: false,
        graphTokenProvider: async () => "mock-graph-token",
        maxTurns: 3,
      });

      const res = await orchestrator.run({
        task: "测试快照缓存未变更复用",
        sessionId: "ses_dual_test_2",
      });

      expect(res.completed).toBe(true);
      expect(generateSpy).toHaveBeenCalled();
      // uploadDocumentAuto MUST NOT be called when cache matches!
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(receivedAnnotations).toBeDefined();
      expect(receivedAnnotations!.length).toBe(1);
      expect(receivedAnnotations![0].id).toBe("SPO_CACHED_ANNOTATION_222");

      generateSpy.mockRestore();
      uploadSpy.mockRestore();
    });
  });

  describe("2. Explicit Fault Tolerance & Degradation Notice (M2/I20)", () => {
    it("should handle upload failure explicitly with warning, error log, and degradation notice in prompt", async () => {
      const dummySnapPath = join(tempDir, ".cph", "snapshots", "workspace-snapshot-fail.txt");
      await writeFile(dummySnapPath, "LARGE_SNAPSHOT_CONTENT_1.3MB", "utf8");

      const mockSnapResult: SnapshotResult = {
        snapshotPath: dummySnapPath,
        hash: "hash_fail",
        fileCount: 155,
        bytes: 1300000,
        files: ["src/fail.ts"],
        cloudFileName: "workspace-v1.txt",
      };

      const generateSpy = spyOn(SnapshotGenerator, "generateWorkspaceSnapshot").mockReturnValue(mockSnapResult);
      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockRejectedValue(
        new Error("Graph API 503 Service Unavailable")
      );

      let sentPrompt = "";
      let sentAnnotations: any[] | undefined;
      const mockChatClient: IOrchestratorChatClient = {
        sendMessage: async (params: any) => {
          sentPrompt = params.text;
          sentAnnotations = params.annotations;
          return { text: "FINAL_ANSWER: 降级模式正常响应" };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        chatClient: mockChatClient,
        enableWorkspaceSnapshot: true,
        enableWorkspaceCatalog: false,
        isHandshakePending: false,
        graphTokenProvider: async () => "mock-graph-token",
        maxTurns: 3,
      });

      const res = await orchestrator.run({
        task: "测试首轮上传异常捕获与降级感知",
        sessionId: "ses_dual_test_fail",
      });

      expect(res.completed).toBe(true);
      expect(uploadSpy).toHaveBeenCalled();

      // Error log written to .cph/state/upload-error.log
      const errLogPath = join(tempDir, ".cph", "state", "upload-error.log");
      expect(fs.existsSync(errLogPath)).toBe(true);
      const errContent = await readFile(errLogPath, "utf8");
      expect(errContent).toContain("Graph API 503 Service Unavailable");

      // Degradation notice injected into Turn 1 prompt
      expect(sentPrompt).toContain(
        "[WORKSPACE NOTICE: 全景代码快照上传暂未就绪，当前进入增量探查降级模式，请按需调用 read_file 探查所需文件]"
      );
      // Large snapshot content must NEVER be dumped inline!
      expect(sentPrompt).not.toContain("LARGE_SNAPSHOT_CONTENT_1.3MB");
      expect(sentAnnotations).toBeUndefined();

      generateSpy.mockRestore();
      uploadSpy.mockRestore();
    });
  });

  describe("3. Green Test Physical Fingerprint Header & Single-File Sync", () => {
    it("should prepend 5-line [WORKSPACE STATE UPDATE] header after green test tool result", async () => {
      let turnCall = 0;
      let turn2Prompt = "";

      const mockChatClient: IOrchestratorChatClient = {
        sendMessage: async (params: any) => {
          turnCall++;
          if (turnCall === 1) {
            return {
              text: `THOUGHT: 运行测试验证代码\n\`\`\`action\ntool: run_command\ncommand: bun test tests/unit.test.ts\n\`\`\``,
            };
          }
          turn2Prompt = params.text;
          return { text: "FINAL_ANSWER: 绿灯状态验证完毕" };
        },
      };

      const mockBridge = {
        executeAction: async (action: any) => {
          return {
            success: true,
            actionName: "run_command",
            output: "bun test v1.4.2\n(pass) tests/unit.test.ts > should succeed [1.2ms]\n 1 pass\n 0 fail",
          };
        },
      };

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        chatClient: mockChatClient,
        bridge: mockBridge as any,
        enableWorkspaceSnapshot: false, // Turn off snapshot to isolate green header
        maxTurns: 5,
      });

      const res = await orchestrator.run({
        task: "执行单点测试门禁",
        sessionId: "ses_green_test",
      });

      expect(res.completed).toBe(true);
      expect(turnCall).toBe(2);

      // Verify Turn 2 prompt contains the 5-line fingerprint header
      expect(turn2Prompt).toContain("[WORKSPACE STATE UPDATE]");
      expect(turn2Prompt).toContain("Status: Green");
      expect(turn2Prompt).toContain("Cloud Mirror: Synced to SharePoint");

      const lines = turn2Prompt.split(/\r?\n/).filter(Boolean);
      const headerIndex = lines.findIndex((l) => l.includes("[WORKSPACE STATE UPDATE]"));
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(lines[headerIndex]).toBe("[WORKSPACE STATE UPDATE]");
      expect(lines[headerIndex + 1]).toContain("Branch:");
      expect(lines[headerIndex + 2]).toContain("Status: Green");
    });
  });

  describe("4. Handoff Incremental Snapshot Generation", () => {
    it("should generate incremented snapshot generation (workspace-v2.txt) on cross-session handoff", async () => {
      const dummySnapPath = join(tempDir, ".cph", "snapshots", "workspace-snapshot-handoff.txt");
      await writeFile(dummySnapPath, "HANDOFF_SNAPSHOT_BODY", "utf8");

      let recordedGeneration = 0;
      const generateSpy = spyOn(SnapshotGenerator, "generateWorkspaceSnapshot").mockImplementation(
        (_ws, _out, gen) => {
          recordedGeneration = gen || 1;
          return {
            snapshotPath: dummySnapPath,
            hash: "hash_handoff_v2",
            fileCount: 155,
            bytes: 1300000,
            files: ["src/handoff.ts"],
            cloudFileName: `workspace-v${recordedGeneration}.txt`,
          };
        }
      );

      const orchestrator = new CopilotOrchestrator({
        workspaceRoot: tempDir,
        enableWorkspaceSnapshot: true,
      });

      const handoffDoc = orchestrator.generateHandoffSnapshot("交接任务目标", [], "ses_handoff_test");

      expect(generateSpy).toHaveBeenCalled();
      expect(recordedGeneration).toBe(2);
      expect(handoffDoc).toContain("workspace-v2.txt");

      generateSpy.mockRestore();
    });
  });

  describe("5. SubagentRunner Scoped Slice & uploadDocumentAuto Integration", () => {
    it("should extract scoped micro-slice and upload via uploadDocumentAuto for targeted tasks", async () => {
      const targetFileRel = "src/feature/service.ts";
      const targetFileAbs = join(tempDir, targetFileRel);
      await mkdir(join(tempDir, "src", "feature"), { recursive: true });
      await writeFile(targetFileAbs, "export class FeatureService { run() { return 42; } }", "utf8");

      const dummySlicePath = join(tempDir, ".cph", "slices", "subagent-slice-target.txt");
      await mkdir(join(tempDir, ".cph", "slices"), { recursive: true });
      await writeFile(dummySlicePath, "SCOPED_SLICE_CONTENT_25KB", "utf8");

      const mockSliceResult: SliceResult = {
        slicePath: dummySlicePath,
        bytes: 25000,
        files: [targetFileRel],
      };

      const sliceSpy = spyOn(SnapshotGenerator, "generateScopedSubagentSlice").mockReturnValue(mockSliceResult);

      const mockUploadResult: UploadDocumentResult = {
        driveItemId: "item-slice-1",
        webUrl: "https://substrate.office.com/drives/item-slice-1",
        driveId: "drive-slice-1",
        fileName: "subagent-slice-target.txt",
        annotation: {
          id: "SPO_SLICE_ANNOTATION_1",
          text: "subagent-slice-target.txt",
          messageAnnotationType: "LocalFile",
        },
      };

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockResolvedValue(mockUploadResult);

      const mockPool = {
        getGraphAccessToken: async () => "mock-token",
        acquireSessionLease: async () => ({ email: "test@domain.com" }),
      };

      let runnerReceivedAnnotations: any[] | undefined;
      const mockCreateOrchestrator = (opts: any) => {
        return {
          run: async (runOpts: any) => {
            runnerReceivedAnnotations = runOpts.initialAnnotations;
            return {
              finalAnswer: "FINAL_ANSWER: 切片分析完成",
              turnsCount: 1,
              completed: true,
            };
          },
        };
      };

      const runner = new SubagentRunner({
        workspaceRoot: tempDir,
        mainSessionId: "main_ses_slice_test",
        pool: mockPool as any,
        createOrchestratorFn: mockCreateOrchestrator as any,
      });

      const reports = await runner.executeBatch([
        {
          role: "coder",
          description: "分析特性服务",
          prompt: "分析文件: src/feature/service.ts",
          targetFiles: [targetFileRel],
        } as any,
      ]);

      expect(reports.length).toBe(1);
      expect(reports[0].success).toBe(true);
      expect(sliceSpy).toHaveBeenCalled();
      expect(uploadSpy).toHaveBeenCalled();
      expect(runnerReceivedAnnotations).toBeDefined();
      expect(runnerReceivedAnnotations!.length).toBe(1);
      expect(runnerReceivedAnnotations![0].id).toBe("SPO_SLICE_ANNOTATION_1");

      sliceSpy.mockRestore();
      uploadSpy.mockRestore();
    });
  });
});
