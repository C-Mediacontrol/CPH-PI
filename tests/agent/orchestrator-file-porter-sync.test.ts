import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { CopilotOrchestrator, type IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { SubstrateUploader, type UploadDocumentResult } from "../../src/transport/substrate-uploader.ts";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";
import { FilePorter } from "../../src/transport/file-porter.ts";
import type { ToolBridgeResult } from "../../src/protocol/tool-bridge.ts";

describe("Orchestrator Pre-Turn Sync, Catalog Attachment, Auto FilePorter & Hot Sync", () => {
  let tmpWs: string;
  let uploadSpy: any = null;
  let fetchBlobSpy: any = null;
  let syncWorkspaceSpy: any = null;
  let syncFileSpy: any = null;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "cph-orch-sync-"));
    fs.mkdirSync(path.join(tmpWs, ".cph", "state"), { recursive: true });
    fs.mkdirSync(path.join(tmpWs, "test"), { recursive: true });

    syncWorkspaceSpy = spyOn(PnPWorkspaceSyncEngine, "syncWorkspace").mockResolvedValue({
      workspaceRoot: tmpWs,
      targetFolder: "/Shared Documents/WorkSpace",
      totalLocal: 0,
      syncedCount: 0,
      skippedCount: 0,
      prunedCount: 0,
      failedCount: 0,
      durationMs: 1,
      results: [],
    });
  });

  afterEach(() => {
    if (uploadSpy) {
      uploadSpy.mockRestore();
      uploadSpy = null;
    }
    if (fetchBlobSpy) {
      fetchBlobSpy.mockRestore();
      fetchBlobSpy = null;
    }
    if (syncWorkspaceSpy) {
      syncWorkspaceSpy.mockRestore();
      syncWorkspaceSpy = null;
    }
    if (syncFileSpy) {
      syncFileSpy.mockRestore();
      syncFileSpy = null;
    }
    try {
      fs.rmSync(tmpWs, { recursive: true, force: true });
    } catch {}
  });

  it("1. Pre-Turn 1: should execute syncWorkspace and generate catalog if sync-manifest.json exists", async () => {
    const manifestPath = path.join(tmpWs, ".cph", "state", "sync-manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        siteUrl: "https://test.sharepoint.com/sites/Test",
        targetFolder: "/Shared Documents/WorkSpace",
        files: {
          "test/sample.txt": { sha256: "hash123", size: 100 },
        },
      }),
      "utf8"
    );

    let syncWorkspaceCalled = false;
    let generateCatalogCalled = false;

    syncWorkspaceSpy = spyOn(PnPWorkspaceSyncEngine, "syncWorkspace").mockImplementation(
      async (wsRoot, targetFolder, opts) => {
        syncWorkspaceCalled = true;
        return {
          workspaceRoot: wsRoot,
          targetFolder: targetFolder || "",
          totalLocal: 1,
          syncedCount: 1,
          skippedCount: 0,
          prunedCount: 0,
          failedCount: 0,
          durationMs: 10,
          results: [],
        };
      }
    );

    const origGen = PnPWorkspaceSyncEngine.generateCatalogMarkdown;
    const genSpy = spyOn(PnPWorkspaceSyncEngine, "generateCatalogMarkdown").mockImplementation(
      (wsRoot, opts) => {
        generateCatalogCalled = true;
        return origGen(wsRoot, opts);
      }
    );

    const mockClient: IOrchestratorChatClient = {
      async sendMessage() {
        return { text: "FINAL_ANSWER: Done." };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
    });

    await orchestrator.run({ task: "测试开工前同步" });

    expect(syncWorkspaceCalled).toBe(true);
    expect(generateCatalogCalled).toBe(true);
    expect(fs.existsSync(path.join(tmpWs, ".cph", "state", "remote-workspace-catalog.md"))).toBe(true);

    genSpy.mockRestore();
  });

  it("2. Catalog Attachment: should upload catalog and cache SHA-256 hash when cache is empty", async () => {
    const catalogPath = path.join(tmpWs, ".cph", "state", "remote-workspace-catalog.md");
    const catalogContent = "# Remote Workspace Catalog\n- `test/a.ts`: https://sp/a.ts";
    fs.writeFileSync(catalogPath, catalogContent, "utf8");
    const expectedHash = crypto.createHash("sha256").update(catalogContent).digest("hex");

    const mockAnnotation = {
      id: "catalog-item-123",
      messageAnnotationType: "File",
      messageAnnotationMetadata: {
        "@type": "File",
        fileName: "remote-workspace-catalog.md",
        webUrl: "https://sp/catalog.md",
      },
    };

    uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockResolvedValue({
      driveItemId: "catalog-item-123",
      webUrl: "https://sp/catalog.md",
      fileName: "remote-workspace-catalog.md",
      annotation: mockAnnotation as any,
    });

    const sentMessages: Array<{ text: string; annotations?: any[] }> = [];
    const mockClient: IOrchestratorChatClient = {
      async sendMessage(params) {
        sentMessages.push(params);
        return { text: "FINAL_ANSWER: 收到受控目录" };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
      graphTokenProvider: async () => "mock-graph-token",
    });

    await orchestrator.run({ task: "检查目录附件挂载" });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const cacheFile = path.join(tmpWs, ".cph", "state", "workspace-catalog-cache.json");
    expect(fs.existsSync(cacheFile)).toBe(true);
    const cacheJson = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(cacheJson.catalogHash).toBe(expectedHash);
    expect(cacheJson.uploadResult.annotation.id).toBe("catalog-item-123");

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].annotations?.some((a) => a.id === "catalog-item-123")).toBe(true);
  });

  it("3. Catalog Attachment: should reuse cached annotation when SHA-256 matches", async () => {
    const catalogPath = path.join(tmpWs, ".cph", "state", "remote-workspace-catalog.md");
    const catalogContent = "# Remote Workspace Catalog\n- `test/a.ts`: https://sp/a.ts";
    fs.writeFileSync(catalogPath, catalogContent, "utf8");
    const catalogHash = crypto.createHash("sha256").update(catalogContent).digest("hex");

    const cacheFile = path.join(tmpWs, ".cph", "state", "workspace-catalog-cache.json");
    const cachedAnnotation = {
      id: "cached-catalog-item-999",
      messageAnnotationType: "File",
      messageAnnotationMetadata: {
        "@type": "File",
        fileName: "remote-workspace-catalog.md",
        webUrl: "https://sp/cached.md",
      },
    };

    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        catalogHash,
        uploadResult: {
          driveItemId: "cached-catalog-item-999",
          webUrl: "https://sp/cached.md",
          fileName: "remote-workspace-catalog.md",
          annotation: cachedAnnotation,
        },
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );

    uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto");

    const sentMessages: Array<{ text: string; annotations?: any[] }> = [];
    const mockClient: IOrchestratorChatClient = {
      async sendMessage(params) {
        sentMessages.push(params);
        return { text: "FINAL_ANSWER: 缓存命中" };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
      graphTokenProvider: async () => "mock-graph-token",
    });

    await orchestrator.run({ task: "测试哈希缓存命中" });

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(sentMessages[0].annotations?.some((a) => a.id === "cached-catalog-item-999")).toBe(true);
  });

  it("4. Catalog Attachment: should gracefully log error to upload-error.log and continue if upload fails", async () => {
    const catalogPath = path.join(tmpWs, ".cph", "state", "remote-workspace-catalog.md");
    fs.writeFileSync(catalogPath, "# Remote Workspace Catalog", "utf8");

    uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockRejectedValue(
      new Error("Graph 503 Service Unavailable")
    );

    const mockClient: IOrchestratorChatClient = {
      async sendMessage() {
        return { text: "FINAL_ANSWER: 降级完成" };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
      graphTokenProvider: async () => "mock-graph-token",
    });

    const result = await orchestrator.run({ task: "测试容错降级" });

    expect(result.completed).toBe(true);
    const errLogPath = path.join(tmpWs, ".cph", "state", "upload-error.log");
    expect(fs.existsSync(errLogPath)).toBe(true);
    expect(fs.readFileSync(errLogPath, "utf8")).toContain("workspace catalog upload failed");
  });

  it("5. Auto FilePorter on FINAL_ANSWER: should parse deliverables and fetchAndDeliver to local disk", async () => {
    fetchBlobSpy = spyOn(FilePorter, "fetchBlobOrBuffer").mockResolvedValue(
      Buffer.from("print('Audit completed successfully')")
    );

    const mockClient: IOrchestratorChatClient = {
      async sendMessage() {
        return {
          text: `FINAL_ANSWER: 代码审查与优化完毕。

【交付文件与落盘指引 / Deliverables】
- [数据审查.py](https://test.local/download/audit.py) -> 目标落盘路径: \`test/audit.py\`
`,
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "执行生成并交付" });

    expect(result.completed).toBe(true);
    const landedFile = path.join(tmpWs, "test", "audit.py");
    expect(fs.existsSync(landedFile)).toBe(true);
    expect(fs.readFileSync(landedFile, "utf8")).toBe("print('Audit completed successfully')");
  });

  it("6. Auto FilePorter & Hot Sync: should trigger syncFile on landed deliverables when manifest exists", async () => {
    const manifestPath = path.join(tmpWs, ".cph", "state", "sync-manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        siteUrl: "https://test.sharepoint.com/sites/Test",
        targetFolder: "/Shared Documents/WorkSpace",
        files: {},
      }),
      "utf8"
    );

    fetchBlobSpy = spyOn(FilePorter, "fetchBlobOrBuffer").mockResolvedValue(
      Buffer.from("# Security report markdown content")
    );

    const syncedPaths: string[] = [];
    syncFileSpy = spyOn(PnPWorkspaceSyncEngine.prototype, "syncFile").mockImplementation(
      async (wsRoot, relPath, targetFolder, opts) => {
        syncedPaths.push(relPath);
        return {
          relativePath: relPath,
          status: "synced",
          size: 100,
        };
      }
    );

    const mockClient: IOrchestratorChatClient = {
      async sendMessage() {
        return {
          text: `FINAL_ANSWER: 任务完成。

【交付文件与落盘指引 / Deliverables】
- [报告.md](https://test.local/download/report.md) -> 目标落盘路径: \`test/report.md\`
`,
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "测试交付物热同步" });

    expect(result.completed).toBe(true);
    expect(syncedPaths).toContain("test/report.md");
  });

  it("7. Post-Update Hot Sync: should trigger syncFile when write_file or patch_file modifies file", async () => {
    const manifestPath = path.join(tmpWs, ".cph", "state", "sync-manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        siteUrl: "https://test.sharepoint.com/sites/Test",
        targetFolder: "/Shared Documents/WorkSpace",
        files: {},
      }),
      "utf8"
    );

    const syncedPaths: string[] = [];
    syncFileSpy = spyOn(PnPWorkspaceSyncEngine.prototype, "syncFile").mockImplementation(
      async (wsRoot, relPath, targetFolder, opts) => {
        syncedPaths.push(relPath);
        return {
          relativePath: relPath,
          status: "synced",
          size: 50,
        };
      }
    );

    const mockBridge: any = {
      executeAction: async (action: any) => {
        fs.writeFileSync(path.join(tmpWs, "test", "helper.ts"), "export const x = 1;", "utf8");
        return {
          actionName: "write_file",
          piToolName: "write",
          target: "test/helper.ts",
          success: true,
          output: "File written successfully",
          formatted: "formatted",
        } as ToolBridgeResult;
      },
    };

    let step = 0;
    const mockClient: IOrchestratorChatClient = {
      async sendMessage() {
        step++;
        if (step === 1) {
          return {
            text: '```action\ntool: write_file\npath: test/helper.ts\ncontent: export const x = 1;\n```',
          };
        }
        return {
          text: "FINAL_ANSWER: 文件已写完",
        };
      },
    };

    const orchestrator = new CopilotOrchestrator({
      workspaceRoot: tmpWs,
      bridge: mockBridge,
      chatClient: mockClient,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "测试本地写文件热同步" });

    expect(result.completed).toBe(true);
    expect(syncedPaths).toContain("test/helper.ts");
    expect(fs.existsSync(path.join(tmpWs, ".cph", "state", "remote-workspace-catalog.md"))).toBe(true);
  });
});
