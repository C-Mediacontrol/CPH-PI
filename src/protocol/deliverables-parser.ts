import path from "node:path";

export interface DeliverableSpec {
  targetPath: string;
  downloadUrl: string;
  isDirectory: boolean;
  isZip: boolean;
}

export class DeliverablesParser {
  /**
   * Extracts structured deliverable mappings from the top-pinned
   * 【交付文件与落盘指引 / Deliverables】 section (or explicit `<-` / `->` / `←` / `→` lines).
   * Bare colons `:` are intentionally NOT matched to prevent false positives in prose.
   */
  public static extractDeliverables(
    text: string,
    workspaceRoot?: string
  ): DeliverableSpec[] {
    if (!text || typeof text !== "string") return [];

    // Limit scan to the Deliverables block if header is present, or first 60 lines of text
    let scopeText = text;
    const headerMatch = text.match(
      /【\s*交付文件与落盘指引\s*(?:\/\s*Deliverables)?\s*】([\s\S]*?)(?:\n\s*#{1,6}\s+|\n\s*---|\n\n\n|$)/i
    );
    if (headerMatch) {
      scopeText = headerMatch[1];
    } else {
      scopeText = text.split(/\r?\n/).slice(0, 60).join("\n");
    }

    const lines = scopeText.split(/\r?\n/);
    const results: DeliverableSpec[] = [];
    const seen = new Set<string>();

    // Matches: - `target/path` <- [label](https://...) or - target/path <- https://...
    const lineRegex =
      /^\s*[-*+]\s+`?([^`←→\r\n]+?)`?\s*(?:<-|->|←|→)\s*(?:\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/\S+))/i;

    for (const line of lines) {
      const m = line.match(lineRegex);
      if (!m) continue;

      const rawTarget = m[1].trim().replace(/^['"`]|['"`]$/g, "");
      const rawUrl = (m[2] || m[3] || "").trim().replace(/[).,;]+$/, "");
      if (!rawTarget || !rawUrl) continue;

      // Validate target path safety (reject absolute paths and `..` traversal)
      const normTarget = rawTarget.replace(/\\/g, "/").replace(/^\.\//, "");
      if (
        normTarget.startsWith("/") ||
        /^[a-zA-Z]:/.test(normTarget) ||
        normTarget.split("/").some((seg) => seg === "..")
      ) {
        continue;
      }

      if (workspaceRoot) {
        const absRoot = path.resolve(workspaceRoot);
        const absTarget = path.resolve(absRoot, normTarget);
        const rel = path.relative(absRoot, absTarget);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          continue;
        }
      }

      const isDirectory = normTarget.endsWith("/");
      let urlPathname = "";
      try {
        urlPathname = new URL(rawUrl).pathname.toLowerCase();
      } catch {
        urlPathname = rawUrl.toLowerCase();
      }
      const isZip =
        urlPathname.endsWith(".zip") || normTarget.toLowerCase().endsWith(".zip");

      const dedupeKey = `${normTarget}::${rawUrl}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({
        targetPath: normTarget,
        downloadUrl: rawUrl,
        isDirectory,
        isZip,
      });
    }

    return results;
  }
}
