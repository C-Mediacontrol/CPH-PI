import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Orchestrator, type IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { FilePorter } from "../../src/transport/file-porter.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";
import { PnPWorkspaceSyncEngine } from "../../src/workspace/pnp-sync-engine.ts";
import { SnapshotGenerator } from "../../src/workspace/snapshot-generator.ts";
import type { AttachmentAnnotation } from "../../src/transport/types.ts";

class TestChatClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public sentPrompts: string[] = [];
  public sentParams: any[] = [];
  public callCount = 0;
  public token: any;

  constructor(responses: string[], token: any = { email: "acc1@contoso.com" }) {
    this.responses = responses;
    this.token = token;
  }

  async sendMessage(
    params: { text: string; [key: string]: any },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      onRateLimitDetected?: (email: string) => Promise<void> | void;
      [key: string]: any;
    }
  ): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    this.sentParams.push(params);

    const resp = this.responses[this.callCount] || "FINAL_ANSWER: Done";
    this.callCount++;

    if (callbacks?.onDelta) {
      callbacks.onDelta({ type: "text", content: resp });
    }

    return { text: resp };
  }
}

describe("Catalog Attachment & FilePorter Orchestrator Integration", () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cat-port-test-"));
    fs.mkdirSync(path.join(tmpWorkspace, ".cph", "state"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpWorkspace, "package.json"),
      JSON.stringify({ name: "test-workspace" }, null, 2),
      "utf8"
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("1. Turn 1 mounts remote-workspace-catalog.md annotation per active account and caches by entries[email]; switching account re-resolves and preserves initialAnnotations", async () => {
    let currentAccount = "account1@contoso.com";
    const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockImplementation(
      async (graphToken, content, fileName) => {
        return {
          driveItemId: `item-${currentAccount}`,
          webUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
          fileName: fileName as string,
          annotation: {
            type: "File",
            fileName: fileName as string,
            fileUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
            title: fileName as string,
            fileSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
          },
        };
      }
    );

    const mockPool: any = {
      getNextAvailableToken: async () => ({
        email: currentAccount,
        token: `mock-token-${currentAccount}`,
      }),
      getGraphAccessToken: async (email?: string) => `graph-token-${email || currentAccount}`,
      getIc3AccessToken: async (email?: string) => `ic3-token-${email || currentAccount}`,
      markThrottled: (email: string) => {
        currentAccount = "account2@contoso.com";
      },
      releaseSessionLease: () => {},
    };

    const initialSliceAnnotation: AttachmentAnnotation = {
      type: "File",
      fileName: "subagent-slice.md",
      fileUrl: "https://sharepoint.example.com/slice.md",
      title: "subagent-slice.md",
      fileSize: 500,
    };

    let clientRef: TestChatClient | null = null;
    const clientFactory = (token: any) => {
      const client = new TestChatClient(
        [
          "FINAL_ANSWER: Initial inspection completed.",
        ],
        token
      );
      clientRef = client;
      return client;
    };

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      pool: mockPool,
      chatClientFactory: clientFactory,
      enableWorkspaceSnapshot: false,
      isHandshakePending: false,
    });

    const res = await orch.run({
      task: "Inspect repository",
      initialAnnotations: [initialSliceAnnotation],
    });

    expect(res.completed).toBe(true);
    expect(uploadSpy).toHaveBeenCalled();

    // Check sent params in Turn 1
    const firstCallParams = clientRef!.sentParams[0];
    expect(firstCallParams).toBeDefined();
    expect(firstCallParams.annotations).toBeDefined();
    expect(firstCallParams.annotations.length).toBe(2);

    // Initial annotation preserved
    const hasInitial = firstCallParams.annotations.some(
      (a: AttachmentAnnotation) => a.fileName === "subagent-slice.md"
    );
    expect(hasInitial).toBe(true);

    // Catalog annotation mounted
    const catalogAnno1 = firstCallParams.annotations.find(
      (a: AttachmentAnnotation) => a.fileName === "remote-workspace-catalog.md"
    );
    expect(catalogAnno1).toBeDefined();
    expect(catalogAnno1.fileUrl).toContain("account1@contoso.com");

    // Check cache file entries[email]
    const cacheFile = path.join(tmpWorkspace, ".cph", "state", "workspace-catalog-cache.json");
    expect(fs.existsSync(cacheFile)).toBe(true);
    const cacheContent = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(cacheContent.entries).toBeDefined();
    expect(cacheContent.entries["account1@contoso.com"]).toBeDefined();
    expect(cacheContent.entries["account1@contoso.com"].uploadResult.annotation.fileUrl).toContain("account1@contoso.com");

    uploadSpy.mockRestore();
  });

  it("1b. Switching account on 429 re-uploads catalog attachment for the new account and updates entries[email]", async () => {
    let currentAccount = "alpha@contoso.com";
    const uploadedAccounts: string[] = [];

    const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockImplementation(
      async (graphToken, content, fileName) => {
        uploadedAccounts.push(currentAccount);
        return {
          driveItemId: `item-${currentAccount}`,
          webUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
          fileName: fileName as string,
          annotation: {
            type: "File",
            fileName: fileName as string,
            fileUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
            title: fileName as string,
            fileSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
          },
        };
      }
    );

    const mockPool: any = {
      getNextAvailableToken: async () => ({
        email: currentAccount,
        token: `mock-token-${currentAccount}`,
      }),
      getGraphAccessToken: async (email?: string) => `graph-token-${email || currentAccount}`,
      getIc3AccessToken: async (email?: string) => `ic3-token-${email || currentAccount}`,
      markThrottled: (email: string) => {
        currentAccount = "beta@contoso.com";
      },
      releaseSessionLease: () => {},
    };

    class ThrottlingChatClient extends TestChatClient {
      async sendMessage(
        params: { text: string; [key: string]: any },
        callbacks?: {
          onDelta?: (delta: { type: string; content: string }) => void;
          onRateLimitDetected?: (email: string) => Promise<void> | void;
          [key: string]: any;
        }
      ): Promise<{ text: string }> {
        if (this.callCount === 0 && callbacks?.onRateLimitDetected) {
          await callbacks.onRateLimitDetected("alpha@contoso.com");
        }
        return super.sendMessage(params, callbacks);
      }
    }

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      pool: mockPool,
      chatClientFactory: (token: any) =>
        new ThrottlingChatClient(["FINAL_ANSWER: Done after throttle recovery."], token),
      enableWorkspaceSnapshot: false,
      isHandshakePending: false,
    });

    const res = await orch.run({
      task: "Task with 429 throttling",
    });

    expect(res.completed).toBe(true);
    expect(uploadedAccounts).toContain("alpha@contoso.com");
    expect(uploadedAccounts).toContain("beta@contoso.com");

    const cacheFile = path.join(tmpWorkspace, ".cph", "state", "workspace-catalog-cache.json");
    expect(fs.existsSync(cacheFile)).toBe(true);
    const cacheContent = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(cacheContent.entries["alpha@contoso.com"]).toBeDefined();
    expect(cacheContent.entries["beta@contoso.com"]).toBeDefined();

    uploadSpy.mockRestore();
  });

  it("1c. Successor session (generation++) resolves catalog attachment for successor leased account", async () => {
    let currentAccount = "main_gen1@contoso.com";
    const uploadedAccounts: string[] = [];

    const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockImplementation(
      async (graphToken, content, fileName) => {
        uploadedAccounts.push(currentAccount);
        return {
          driveItemId: `item-${currentAccount}`,
          webUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
          fileName: fileName as string,
          annotation: {
            type: "File",
            fileName: fileName as string,
            fileUrl: `https://sharepoint.example.com/${currentAccount}/${fileName}`,
            title: fileName as string,
            fileSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
          },
        };
      }
    );

    const mockPool: any = {
      getNextAvailableToken: async (opts?: any) => {
        if (opts?.sessionId?.includes("gen2")) {
          currentAccount = "main_gen2@contoso.com";
        }
        return {
          email: currentAccount,
          token: `mock-token-${currentAccount}`,
        };
      },
      getGraphAccessToken: async (email?: string) => `graph-token-${email || currentAccount}`,
      getIc3AccessToken: async (email?: string) => `ic3-token-${email || currentAccount}`,
      releaseSessionLease: () => {},
      acquireSessionLease: async () => ({ token: "sub-tok", email: "sub@contoso.com" }),
    };

    const mockSubagentRunner: any = {
      executeBatch: async () => [{ success: true, finalAnswer: "sub done", role: "coder" }],
      formatReportSummary: () => "Subagent executed successfully",
    };

    let clientCount = 0;
    const clientFactory = (token: any) => {
      clientCount++;
      if (clientCount === 1) {
        return new TestChatClient(
          [
            `THOUGHT: invoking subagent
\`\`\`action
tool: invoke_subagent
subagents: [{"role": "coder", "prompt": "Implement module"}]
\`\`\``,
          ],
          token
        );
      } else {
        return new TestChatClient(["FINAL_ANSWER: Successor turn completed."], token);
      }
    };

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      pool: mockPool,
      chatClientFactory: clientFactory,
      subagentRunner: mockSubagentRunner,
      enableWorkspaceSnapshot: false,
      isHandshakePending: false,
    });

    const res = await orch.run({
      task: "Run multi-generation task",
    });

    expect(res.completed).toBe(true);
    expect(uploadedAccounts).toContain("main_gen1@contoso.com");
    expect(uploadedAccounts).toContain("main_gen2@contoso.com");

    const cacheFile = path.join(tmpWorkspace, ".cph", "state", "workspace-catalog-cache.json");
    const cacheContent = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(cacheContent.entries["main_gen1@contoso.com"]).toBeDefined();
    expect(cacheContent.entries["main_gen2@contoso.com"]).toBeDefined();

    uploadSpy.mockRestore();
  });

  it("1d. Workspace snapshot cache stores entries per account entries[email] with backward compatibility", async () => {
    const snapFile = path.join(tmpWorkspace, "workspace-v1.txt");
    fs.writeFileSync(snapFile, "dummy snapshot content", "utf8");

    const snapResult = {
      snapshotPath: snapFile,
      hash: "mock-snap-hash-999",
      fileCount: 1,
      bytes: 20,
      files: ["package.json"],
      cloudFileName: "workspace-v1.txt",
    };

    const snapSpy = spyOn(SnapshotGenerator, "generateWorkspaceSnapshot").mockReturnValue(snapResult);

    let uploadCount = 0;
    const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentAuto").mockImplementation(
      async (token, buffer, fileName) => {
        uploadCount++;
        return {
          driveItemId: "snap-item-1",
          webUrl: "https://sharepoint.example.com/snapshot.zip",
          fileName: fileName as string,
          annotation: {
            type: "File",
            fileName: fileName as string,
            fileUrl: "https://sharepoint.example.com/snapshot.zip",
            title: fileName as string,
            fileSize: (buffer as Buffer).length,
          },
        };
      }
    );

    const mockPool: any = {
      getNextAvailableToken: async () => ({
        email: "snap_user@contoso.com",
        token: "snap-tok",
      }),
      getGraphAccessToken: async () => "snap-graph-token",
      getIc3AccessToken: async () => "snap-ic3-token",
      releaseSessionLease: () => {},
    };

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      pool: mockPool,
      chatClientFactory: (token: any) => new TestChatClient(["FINAL_ANSWER: Snapshot done."], token),
      enableWorkspaceSnapshot: true,
      isHandshakePending: false,
    });

    const res = await orch.run({ task: "Snapshot test" });
    expect(res.completed).toBe(true);
    expect(uploadCount).toBe(2); // 1 for catalog, 1 for snapshot

    const snapCacheFile = path.join(tmpWorkspace, ".cph", "state", "workspace-snapshot-cache.json");
    expect(fs.existsSync(snapCacheFile)).toBe(true);
    const snapCache = JSON.parse(fs.readFileSync(snapCacheFile, "utf8"));
    expect(snapCache.entries).toBeDefined();
    expect(snapCache.entries["snap_user@contoso.com"]).toBeDefined();
    expect(snapCache.snapshotHash).toBeDefined(); // backward compatibility

    // Second run with same account should hit cache without uploading again
    const orch2 = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      pool: mockPool,
      chatClientFactory: (token: any) => new TestChatClient(["FINAL_ANSWER: Snapshot done 2."], token),
      enableWorkspaceSnapshot: true,
      isHandshakePending: false,
    });
    const res2 = await orch2.run({ task: "Snapshot test 2" });
    expect(res2.completed).toBe(true);
    expect(uploadCount).toBe(2); // No new upload! Both hit cache!

    snapSpy.mockRestore();
    uploadSpy.mockRestore();
  });

  it("2. Intermediate turn write_file with url downloads via FilePorter, syncs to SharePoint, and sends receipt; skips SharePoint sync for .zip binary", async () => {
    // Setup sync manifest for cloud target resolution
    fs.writeFileSync(
      path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json"),
      JSON.stringify(
        {
          siteUrl: "https://cmacgmgroup.sharepoint.com/sites/TestSite",
          targetFolder: "/sites/TestSite/AFRASIA/TestFolder",
        },
        null,
        2
      ),
      "utf8"
    );

    const deliverSpy = spyOn(FilePorter.prototype, "deliverToWorkspace").mockImplementation(
      async (params) => {
        const fullPath = path.join(tmpWorkspace, params.destinationPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, "dummy content", "utf8");
        return {
          landedFiles: [params.destinationPath],
          extractedFromZip: false,
        };
      }
    );

    const syncSpy = spyOn(PnPWorkspaceSyncEngine.prototype, "syncFile").mockImplementation(
      async (wsRoot, relPath, targetFolder) => {
        return {
          file: relPath,
          status: "synced",
          localPath: path.join(wsRoot, relPath),
          serverRelativeUrl: `${targetFolder}/${relPath}`,
        } as any;
      }
    );

    const responses = [
      `THOUGHT: Downloading document
\`\`\`action
tool: write_file
path: test/doc.md
url: https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original/doc.md
\`\`\``,
      `THOUGHT: Downloading binary archive
\`\`\`action
tool: write_file
path: test/archive.zip
url: https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/456/views/original/archive.zip
\`\`\``,
      `FINAL_ANSWER:
All files downloaded and processed.`,
    ];

    const mockClient = new TestChatClient(responses, { email: "coder@contoso.com" });

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      client: mockClient,
      enableWorkspaceSnapshot: false,
      isHandshakePending: false,
    });

    const res = await orch.run({
      task: "Download and sync assets",
    });

    expect(res.completed).toBe(true);
    expect(res.turnsCount).toBe(3);

    // Verify turn 2 prompt received doc.md receipt with cloud web url
    const turn2Prompt = mockClient.sentPrompts[1];
    expect(turn2Prompt).toContain("✔ 文件已落盘至本地: test/doc.md");
    expect(turn2Prompt).toContain("✔ 已同步至云端工作区: https://cmacgmgroup.sharepoint.com/sites/TestSite/AFRASIA/TestFolder/test/doc.md");

    // Verify turn 3 prompt received archive.zip receipt with local only (no cloud web url claimed)
    const turn3Prompt = mockClient.sentPrompts[2];
    expect(turn3Prompt).toContain("✔ 文件已落盘至本地: test/archive.zip");
    expect(turn3Prompt).not.toContain("✔ 已同步至云端工作区: https://cmacgmgroup.sharepoint.com/sites/TestSite/AFRASIA/TestFolder/test/archive.zip");

    deliverSpy.mockRestore();
    syncSpy.mockRestore();
  });

  it("3. FINAL_ANSWER containing Deliverables downloads all via FilePorter, syncs indexable files, writes delivery-report.json, and terminates without sending receipt", async () => {
    fs.writeFileSync(
      path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json"),
      JSON.stringify(
        {
          siteUrl: "https://cmacgmgroup.sharepoint.com/sites/TestSite",
          targetFolder: "/sites/TestSite/AFRASIA/TestFolder",
        },
        null,
        2
      ),
      "utf8"
    );

    const deliverSpy = spyOn(FilePorter.prototype, "deliverToWorkspace").mockImplementation(
      async (params) => {
        const fullPath = path.join(tmpWorkspace, params.destinationPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, "deliverable content", "utf8");
        return {
          landedFiles: [params.destinationPath],
          extractedFromZip: false,
        };
      }
    );

    const syncSpy = spyOn(PnPWorkspaceSyncEngine.prototype, "syncFile").mockImplementation(
      async (wsRoot, relPath, targetFolder) => {
        return {
          file: relPath,
          status: "synced",
          localPath: path.join(wsRoot, relPath),
          serverRelativeUrl: `${targetFolder}/${relPath}`,
        } as any;
      }
    );

    const finalAnswerText = `FINAL_ANSWER:
【交付文件与落盘指引 / Deliverables】
- \`test/final-report.md\` <- [下载审查报告](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original/final-report.md)
- \`test/evidence.zip\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/456/views/original/evidence.zip

# 任务交付报告
全量代码审查已完成，所有证据已归档。`;

    const mockClient = new TestChatClient([finalAnswerText], { email: "lead@contoso.com" });

    const orch = new Orchestrator({
      workspaceRoot: tmpWorkspace,
      client: mockClient,
      enableWorkspaceSnapshot: false,
      isHandshakePending: false,
    });

    const res = await orch.run({
      task: "Execute final review",
    });

    expect(res.completed).toBe(true);
    expect(res.turnsCount).toBe(1);
    // Crucial: Must NOT send any follow-up receipt to the model in FINAL_ANSWER turn!
    expect(mockClient.callCount).toBe(1);

    // Verify deliveryStatus and deliverables in result
    expect(res.deliveryStatus).toBe("ok");
    expect(res.landedDeliverables).toContain("test/final-report.md");
    expect(res.landedDeliverables).toContain("test/evidence.zip");

    // Verify user-facing finalAnswer contains verification summary
    expect(res.finalAnswer).toContain("【Harness 物理落盘与云端同步核验】");
    expect(res.finalAnswer).toContain("本地物理落盘: 2/2");
    expect(res.finalAnswer).toContain("云端工作区同步: 1/2");

    // Verify delivery-report.json was written to disk
    const reportPath = path.join(tmpWorkspace, ".cph", "state", "delivery-report.json");
    expect(fs.existsSync(reportPath)).toBe(true);
    const reportJson = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(reportJson.deliveryStatus).toBe("ok");
    expect(reportJson.totalDeliverables).toBe(2);
    expect(reportJson.landedCount).toBe(2);
    expect(reportJson.syncedCount).toBe(1);
    expect(reportJson.items.length).toBe(2);

    deliverSpy.mockRestore();
    syncSpy.mockRestore();
  });
});
