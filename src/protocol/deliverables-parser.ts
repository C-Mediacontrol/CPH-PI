import path from "node:path";

/**
 * One structured deliverable declared by the model inside a FINAL_ANSWER block.
 *
 * Declaration contract (positive form, see agent prompts):
 *
 *   【交付文件与落盘指引 / Deliverables】
 *   - `test/review.md` <- [review.md](https://fr-prod.asyncgw.teams.microsoft.com/...)
 *   - `test/` -> [bundle.zip](https://fr-prod.asyncgw.teams.microsoft.com/...)
 */
export interface DeliverableItem {
  /** Workspace-relative destination path. A trailing slash means directory target. */
  destinationPath: string;
  /** Display file name; falls back to the URL basename. */
  fileName: string;
  /** Download URL. */
  url: string;
  /** True when the destination ends with `.zip` (keep zip as-is instead of extracting). */
  isZipTarget: boolean;
}

const SECTION_RE =
  /【交付文件与落盘指引\s*\/\s*Deliverables】|^#{1,3}\s*Deliverables\b/im;

const LINE_RE =
  /^\s*[-*]\s*`([^`]+)`\s*(?:<-|->|←|→|<=|=>|=>|:)\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

/**
 * Parses the structured deliverables section that must appear at the very top
 * of a FINAL_ANSWER. Plain Markdown links outside that section are ignored.
 */
export class DeliverablesParser {
  public static parse(raw: string): DeliverableItem[] {
    if (!raw || !SECTION_RE.test(raw)) return [];

    const items: DeliverableItem[] = [];
    const seen = new Set<string>();

    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(LINE_RE);
      if (!match) continue;

      const destination = match[1].trim().replace(/\\/g, "/");
      const url = match[3].trim();

      if (!/^https?:\/\//i.test(url)) continue;
      if (!destination) continue;

      const normalized = path.posix.normalize(destination);
      if (normalized.startsWith("..")) continue;
      if (path.posix.isAbsolute(normalized)) continue;
      if (normalized === ".") continue;

      const key = `${normalized}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let fallbackName = "download.bin";
      try {
        const lastSegment = new URL(url).pathname.split("/").filter(Boolean).pop();
        if (lastSegment) fallbackName = decodeURIComponent(lastSegment);
      } catch {
        // keep fallback
      }

      items.push({
        destinationPath: normalized,
        fileName: match[2].trim() || fallbackName,
        url,
        isZipTarget: normalized.toLowerCase().endsWith(".zip"),
      });
    }

    return items;
  }
}
