/**
 * DeliverablesParser
 * Parses structured deliverables and landing directives from Copilot responses,
 * especially from the pinned "【交付文件与落盘指引 / Deliverables】" section or full text.
 */

export interface DeliverableItem {
  name: string;
  url: string;
  destinationPath: string; // 规范化相对路径，例如 "test/review.md" 或 "test/"
  isZip: boolean;
}

export class DeliverablesParser {
  /**
   * Parse response text to extract deliverable files to be landed on host.
   *
   * @param text The model output or final answer text
   * @param workspaceRoot Optional absolute path to workspace root for relative resolution
   */
  public static parse(text: string, workspaceRoot?: string): DeliverableItem[] {
    if (!text || typeof text !== "string" || !text.trim()) {
      return [];
    }

    const deliverables: DeliverableItem[] = [];
    const seenUrls = new Set<string>();

    const lines = text.split(/\r?\n/);

    // Separator pattern:
    // Matches arrows (->, —>, –>, -->, =>, →, ➔) with optional keywords (目标落盘路径, etc.),
    // keywords alone with colon, or colon alone.
    const separatorRegex =
      /^\s*(?:(?:->|—>|–>|-->|=>|→|➔)\s*(?:(?:目标(?:落盘)?路径|落盘(?:目标|路径)|目标|Destination|Target|Path)\s*[:：]?\s*)?|(?:目标(?:落盘)?路径|落盘(?:目标|路径)|目标|Destination|Target|Path)\s*[:：]?\s*|[:：]\s*)(.*)$/i;

    // 1. Line-by-line Standard Syntax Parsing
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Look for markdown link: [name](url)
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!linkMatch || linkMatch.index === undefined) continue;

      const name = linkMatch[1].trim();
      const url = linkMatch[2].trim();
      const remainder = line.slice(linkMatch.index + linkMatch[0].length);

      const sepMatch = remainder.match(separatorRegex);
      if (!sepMatch) continue;

      const rawTail = sepMatch[1].trim();
      if (!rawTail) continue;

      // Determine isZip from name, url, or line text
      let isZip =
        /\bzip\b|自动解压|解压|压缩包/i.test(name) ||
        /\bzip\b|自动解压|解压|压缩包/i.test(rawTail) ||
        name.toLowerCase().endsWith(".zip") ||
        url.toLowerCase().endsWith(".zip") ||
        url.toLowerCase().includes(".zip?");

      // Extract cleaned destination string
      let destStr = rawTail;

      // Check if quoted with trailing note, e.g. `path` (note) or "path" (note)
      const quotedWithTrailing = destStr.match(/^([`'"])(.+?)\1(?:\s*[（(\[][^）)\]]*[）)\]])?\s*$/);
      if (quotedWithTrailing) {
        destStr = quotedWithTrailing[2].trim();
      } else {
        const backtickInner = destStr.match(/^`(.+?)`\s*$/);
        if (backtickInner) {
          destStr = backtickInner[1].trim();
        }
        // Strip trailing bracketed note, e.g. (ZIP 自动解压), （说明）
        destStr = destStr.replace(/\s*[（(\[][^）)\]]*[）)\]]\s*$/, "").trim();
        // Strip surrounding quotes if any
        destStr = destStr.replace(/^[`'"]|[`'"]$/g, "").trim();
      }

      const normalizedDest = this.normalizeDestinationPath(destStr, workspaceRoot);

      if (normalizedDest.toLowerCase().endsWith(".zip")) {
        isZip = true;
      }

      deliverables.push({
        name,
        url,
        destinationPath: normalizedDest,
        isZip,
      });
      seenUrls.add(url);
    }

    // 2. Fallback Inference for asyncgw.teams.microsoft.com links without explicit path
    const asyncgwRegex = /\[([^\]]+)\]\((https?:\/\/[^)]*asyncgw\.teams\.microsoft\.com[^)]*)\)/gi;
    let match: RegExpExecArray | null;

    while ((match = asyncgwRegex.exec(text)) !== null) {
      const anchorText = match[1].trim();
      const url = match[2].trim();

      if (seenUrls.has(url)) {
        continue;
      }

      let inferredFilename: string | null = null;
      let inferredIsZip = false;

      // 2a. Check if anchorText has a valid file extension (e.g. .md, .zip, .docx, .json)
      const cleanedAnchor = anchorText
        .replace(/^(?:下载|点击下载|获取|点击获取|Download|Click to download)\s*/i, "")
        .trim();
      const extMatch = cleanedAnchor.match(/\.([a-zA-Z0-9]{1,10})$/);

      if (extMatch) {
        inferredFilename = cleanedAnchor;
        if (extMatch[1].toLowerCase() === "zip") {
          inferredIsZip = true;
        }
      } else {
        // 2b. Check URL query params or URL pathname
        let urlFilename: string | null = null;
        try {
          const parsedUrl = new URL(url);
          const qFilename =
            parsedUrl.searchParams.get("filename") || parsedUrl.searchParams.get("name");
          if (qFilename) {
            urlFilename = decodeURIComponent(qFilename);
          } else {
            const lastPart = parsedUrl.pathname.split("/").pop();
            if (lastPart && /\.[a-zA-Z0-9]{1,10}$/.test(lastPart)) {
              urlFilename = decodeURIComponent(lastPart);
            }
          }
        } catch {
          const fnMatch = url.match(/[?&](?:filename|name)=([^&#]+)/i);
          if (fnMatch) {
            urlFilename = decodeURIComponent(fnMatch[1]);
          }
        }

        if (urlFilename) {
          inferredFilename = urlFilename;
          if (urlFilename.toLowerCase().endsWith(".zip")) {
            inferredIsZip = true;
          }
        } else {
          // 2c. Fallback using anchorText: if hints at zip -> .zip, else default to .md
          const isZipHint = /\bzip\b|压缩包/i.test(anchorText) || /\bzip\b/i.test(url);
          if (isZipHint) {
            inferredIsZip = true;
            inferredFilename = `${anchorText}.zip`;
          } else {
            inferredFilename = `${anchorText}.md`;
          }
        }
      }

      if (inferredFilename) {
        inferredFilename = inferredFilename.replace(/[\\/:*?"<>|]/g, "_");
        const dest = this.normalizeDestinationPath(`test/${inferredFilename}`, workspaceRoot);
        deliverables.push({
          name: anchorText,
          url,
          destinationPath: dest,
          isZip: inferredIsZip,
        });
        seenUrls.add(url);
      }
    }

    return deliverables;
  }

  /**
   * Normalizes destination path to relative POSIX path obeying AGENTS.md Rule 1.
   * Ensures paths default to a safe secondary directory (e.g. test/).
   */
  private static normalizeDestinationPath(dest: string, workspaceRoot?: string): string {
    let p = dest.replace(/\\/g, "/");
    p = p.replace(/\/+/g, "/");

    // Resolve against workspaceRoot if absolute
    if (workspaceRoot) {
      const normRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
      if (p.toLowerCase().startsWith(normRoot.toLowerCase())) {
        p = p.slice(normRoot.length).replace(/^\/+/, "");
      }
    }

    // Strip Windows drive letter (e.g. C:/ or C:)
    p = p.replace(/^[a-zA-Z]:\/?/, "");

    // Strip leading slashes and ./
    p = p.replace(/^\/+/, "");
    p = p.replace(/^\.\//, "");

    // Check for traversal attempts (..)
    const hadTraversal = /(?:^|\/)\.\.(?:\/|$)/.test(p);
    const segments = p.split("/").filter((seg) => seg !== "." && seg !== ".." && seg.length > 0);

    const endsWithSlash = dest.endsWith("/") || dest.endsWith("\\");

    if (endsWithSlash) {
      if (segments.length === 0) {
        p = "test/";
      } else {
        p = segments.join("/") + "/";
      }
      if (hadTraversal && !p.startsWith("test/")) {
        p = "test/" + p;
      }
    } else {
      if (segments.length === 0) {
        p = "test/";
      } else if (segments.length === 1) {
        // Naked filename at root level: relocate into secondary directory per AGENTS.md Rule 1
        p = "test/" + segments[0];
      } else {
        p = segments.join("/");
        if (hadTraversal && !p.startsWith("test/")) {
          p = "test/" + p;
        }
      }
    }

    return p;
  }
}
