import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LandingService } from "../../src/delivery/landing-service.ts";

describe("LandingService", () => {
  test("lands items and reports cloud sync per file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-landing-"));
    const synced: string[] = [];
    const service = new LandingService({
      workspaceRoot: root,
      filePorter: {
        deliverToWorkspace: async (params: any) => {
          fs.mkdirSync(path.dirname(path.join(root, params.destinationPath)), { recursive: true });
          fs.writeFileSync(path.join(root, params.destinationPath), "content");
          return { landedFiles: [params.destinationPath], extractedFromZip: false };
        },
      } as any,
      syncFile: async (rel: string) => {
        synced.push(rel);
        return { status: "synced", serverRelativeUrl: `https://sp/${rel}` };
      },
    });

    const result = await service.landDeliverables([
      {
        destinationPath: "test/r.md",
        fileName: "r.md",
        url: "https://x.test/r.md",
        isZipTarget: false,
      },
    ]);

    expect(result.status).toBe("ok");
    expect(result.landed[0]).toMatchObject({
      relPath: "test/r.md",
      status: "landed",
      cloudUrl: "https://sp/test/r.md",
    });
    expect(synced).toEqual(["test/r.md"]);
  });

  test("reports partial and failed status without throwing", async () => {
    const service = new LandingService({
      workspaceRoot: os.tmpdir(),
      filePorter: {
        deliverToWorkspace: async () => {
          throw new Error("boom");
        },
      } as any,
      syncFile: async () => null,
    });

    const result = await service.landDeliverables([
      { destinationPath: "a.md", fileName: "a.md", url: "https://x.test/a.md", isZipTarget: false },
    ]);

    expect(result.status).toBe("failed");
    expect(result.landed[0].error).toContain("boom");
  });

  test("formatReceipt is user-visible and token-free", async () => {
    const service = new LandingService({
      workspaceRoot: os.tmpdir(),
      filePorter: {
        deliverToWorkspace: async (params: any) => ({
          landedFiles: [params.destinationPath],
          extractedFromZip: false,
        }),
      } as any,
      syncFile: async (rel: string) => ({ status: "synced", serverRelativeUrl: `https://sp/${rel}` }),
    });

    const result = await service.landDeliverables([
      { destinationPath: "test/r.md", fileName: "r.md", url: "https://x.test/r.md", isZipTarget: false },
    ]);
    const receipt = LandingService.formatReceipt(result);
    expect(receipt).toContain("已落盘");
    expect(receipt).toContain("已同步至云端工作区");
    expect(receipt.toLowerCase()).not.toContain("token");
  });
});
