import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../../src/agent/orchestrator.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

function makeUploadResult(fileName: string) {
  return {
    driveItemId: `item-${fileName}-${Math.random().toString(36).slice(2)}`,
    webUrl: `https://tenant-my.sharepoint.com/personal/x/Documents/Copilot/${fileName}`,
    driveId: "drive-1",
    fileName,
    annotation: {
      id: `anno-${fileName}`,
      text: fileName,
      url: `https://tenant-my.sharepoint.com/personal/x/Documents/Copilot/${fileName}`,
      messageAnnotationType: "LocalFile" as const,
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileName,
      },
    },
  } as any;
}

describe("Workspace catalog attachment", () => {
  let root: string;
  let originalUpload: any;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-catalog-attach-"));
    fs.mkdirSync(path.join(root, ".cph", "state"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(root, ".cph", "state", "sync-manifest.json"),
      JSON.stringify(
        {
          version: 2,
          siteUrl: "https://tenant.sharepoint.com/sites/test",
          targetFolder: "AFRASIA/WorkSpace/test_workspace",
          files: {
            "src/a.ts": {
              sha256: "abc",
              size: 10,
              serverRelativeUrl:
                "/sites/test/AFRASIA/WorkSpace/test_workspace/src/a.ts",
            },
          },
          folders: {},
        },
        null,
        2
      ),
      "utf8"
    );
    originalUpload = (SubstrateUploader as any).uploadDocumentToOneDrive;
  });

  afterEach(() => {
    (SubstrateUploader as any).uploadDocumentToOneDrive = originalUpload;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("uploads once per account+hash and reuses the cache", async () => {
    const uploads: string[] = [];
    (SubstrateUploader as any).uploadDocumentToOneDrive = async (
      _token: string,
      _content: string | Buffer,
      fileName: string
    ) => {
      uploads.push(fileName);
      return makeUploadResult(fileName);
    };

    const orch = new Orchestrator({
      workspaceRoot: root,
      chatClient: { sendMessage: async () => ({ text: "" }) } as any,
      bridge: { executeAction: async () => ({ success: true, output: "" }) } as any,
    });
    (orch as any).acquireGraphToken = async () => "graph-token";

    const first = await orch.ensureWorkspaceCatalogAttachment("A@x.com");
    const second = await orch.ensureWorkspaceCatalogAttachment("a@x.com");
    const third = await orch.ensureWorkspaceCatalogAttachment("B@x.com");

    expect(first?.fileName).toBe("remote-workspace-catalog.md");
    expect(second?.driveItemId).toBe(first?.driveItemId);
    expect(third?.driveItemId).not.toBe(first?.driveItemId);
    expect(uploads).toHaveLength(2);

    expect(fs.existsSync(path.join(root, ".cph", "state", "remote-workspace-catalog.md"))).toBe(true);
    const cache = JSON.parse(
      fs.readFileSync(path.join(root, ".cph", "state", "workspace-catalog-cache.json"), "utf8")
    );
    expect(Object.keys(cache.entries)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("attaches the catalog annotation on the first turn", async () => {
    (SubstrateUploader as any).uploadDocumentToOneDrive = async (
      _token: string,
      _content: string | Buffer,
      fileName: string
    ) => makeUploadResult(fileName);

    const sent: any[] = [];
    const orch = new Orchestrator({
      workspaceRoot: root,
      chatClient: {
        sendMessage: async (params: any) => {
          sent.push(params);
          return { text: "FINAL_ANSWER: done" };
        },
      } as any,
      bridge: { executeAction: async () => ({ success: true, output: "" }) } as any,
      customAgentId: "T_test_agent",
    });
    (orch as any).acquireGraphToken = async () => "graph-token";

    const result = await orch.run({ task: "review" });
    expect(result.completed).toBe(true);
    expect(sent).toHaveLength(1);
    const names = (sent[0].annotations || []).map(
      (a: any) => a.messageAnnotationMetadata?.fileName
    );
    expect(names).toContain("remote-workspace-catalog.md");
  });
});
