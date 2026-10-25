import type { DeliverableItem } from "../protocol/deliverables-parser.ts";
import type { FilePorter } from "../transport/file-porter.ts";

export interface DeliveryItemResult {
  relPath: string;
  cloudUrl?: string;
  status: "landed" | "failed";
  error?: string;
}

export interface LandingResult {
  landed: DeliveryItemResult[];
  status: "ok" | "partial" | "failed";
}

/**
 * Downloads model-declared deliverables into the workspace and reports the
 * resulting cloud sync state. Pure orchestration: all file/network/sync
 * primitives are injected, which keeps this unit testable without a live
 * Copilot session.
 */
export class LandingService {
  private workspaceRoot: string;
  private filePorter: FilePorter;
  private syncFile: (
    relPath: string
  ) => Promise<{ status: string; serverRelativeUrl?: string } | null>;

  constructor(opts: {
    workspaceRoot: string;
    filePorter: FilePorter;
    syncFile: (relPath: string) => Promise<{ status: string; serverRelativeUrl?: string } | null>;
  }) {
    this.workspaceRoot = opts.workspaceRoot;
    this.filePorter = opts.filePorter;
    this.syncFile = opts.syncFile;
  }

  public async landDeliverables(items: DeliverableItem[]): Promise<LandingResult> {
    const landed: DeliveryItemResult[] = [];

    for (const item of items) {
      try {
        const isDirectory = item.destinationPath.endsWith("/");
        const result = await this.filePorter.deliverToWorkspace({
          downloadUrl: item.url,
          destinationPath: item.destinationPath,
          isDirectory,
          isZip: item.isZipTarget,
          fileName: item.fileName,
        });

        for (const rel of result.landedFiles) {
          let cloudUrl: string | undefined;
          try {
            const sync = await this.syncFile(rel);
            cloudUrl = sync?.serverRelativeUrl;
          } catch {
            // Local landing is still a success even when cloud sync fails.
          }
          landed.push({ relPath: rel, cloudUrl, status: "landed" });
        }
      } catch (err: any) {
        landed.push({
          relPath: item.destinationPath,
          status: "failed",
          error: String(err?.message || err),
        });
      }
    }

    const failed = landed.filter((item) => item.status === "failed").length;
    const status: LandingResult["status"] =
      landed.length === 0 || failed === 0 ? "ok" : failed === landed.length ? "failed" : "partial";

    return { landed, status };
  }

  /** One-line receipt that is safe to show to the user (no tokens, no secrets). */
  public static formatReceipt(result: LandingResult): string {
    const ok = result.landed.filter((item) => item.status === "landed");
    const failed = result.landed.filter((item) => item.status === "failed");

    const lines: string[] = [];
    if (ok.length > 0) {
      lines.push(
        `已落盘 ${ok.length} 个交付文件` +
          (ok.some((item) => item.cloudUrl) ? `（其中 ${ok.filter((item) => item.cloudUrl).length} 个已同步云端）` : "")
      );
      for (const item of ok) {
        lines.push(
          item.cloudUrl
            ? `✔ 文件已落盘至本地: ${item.relPath}\n✔ 已同步至云端工作区: ${item.cloudUrl}`
            : `✔ 文件已落盘至本地: ${item.relPath}`
        );
      }
    }
    if (failed.length > 0) {
      lines.push(`有 ${failed.length} 个交付文件落盘失败`);
      for (const item of failed) {
        lines.push(`✘ ${item.relPath}: ${item.error || "unknown error"}`);
      }
    }
    return lines.join("\n");
  }
}
