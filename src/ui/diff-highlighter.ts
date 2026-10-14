import { Chalk } from "chalk";
import * as Diff from "diff";

export interface DiffHighlighterOptions {
  colorLevel?: 0 | 1 | 2 | 3;
  chalk?: Chalk;
}

export interface ParsedDiffLine {
  prefix: string;
  lineNum: string;
  content: string;
}

/**
 * Pi-compatible intra-line word diff renderer with ANSI coloring and whitespace preservation.
 */
export class DiffHighlighter {
  private c: Chalk;

  constructor(options: DiffHighlighterOptions = {}) {
    this.c = options.chalk || new Chalk({ level: options.colorLevel ?? 3 });
  }

  /**
   * Parses diff line to extract prefix ('+', '-', ' ', '@@', etc.), optional line number, and content.
   */
  public parseDiffLine(line: string): ParsedDiffLine | null {
    const match = line.match(/^([+-\s])(?:(\s*\d+)\s+)?(.*)$/);
    if (!match) return null;
    return { prefix: match[1], lineNum: match[2]?.trim() || "", content: match[3] };
  }

  /**
   * Computes word-level diff and highlights changed parts with inverse styling.
   * Strips leading whitespace from inverse to avoid highlighting indentations.
   */
  public renderIntraLineDiff(
    oldContent: string,
    newContent: string
  ): { removedLine: string; addedLine: string } {
    const wordDiff = Diff.diffWords(oldContent, newContent);

    let removedLine = "";
    let addedLine = "";
    let isFirstRemoved = true;
    let isFirstAdded = true;

    for (const part of wordDiff) {
      if (part.removed) {
        let value = part.value;
        if (isFirstRemoved) {
          const leadingWs = value.match(/^(\s*)/)?.[1] || "";
          value = value.slice(leadingWs.length);
          removedLine += leadingWs;
          isFirstRemoved = false;
        }
        if (value) {
          removedLine += this.c.inverse(value);
        }
      } else if (part.added) {
        let value = part.value;
        if (isFirstAdded) {
          const leadingWs = value.match(/^(\s*)/)?.[1] || "";
          value = value.slice(leadingWs.length);
          addedLine += leadingWs;
          isFirstAdded = false;
        }
        if (value) {
          addedLine += this.c.inverse(value);
        }
      } else {
        removedLine += part.value;
        addedLine += part.value;
      }
    }

    return { removedLine, addedLine };
  }

  /**
   * Renders a diff string with colored lines and intra-line change highlighting.
   * - Removed lines: red with inverse on changed tokens
   * - Added lines: green with inverse on changed tokens
   * - Context lines: dim/gray
   * - Patch headers: bold cyan / cyan
   */
  public renderDiff(diffText: string): string {
    const rawLines = diffText.split("\n");
    const lines = rawLines.map((l) => l.replace(/\t/g, "   "));
    const result: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Handle patch headers (--- a/..., +++ b/..., @@ ... @@)
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        result.push(this.c.bold.cyan(line));
        i++;
        continue;
      }
      if (line.startsWith("@@")) {
        result.push(this.c.cyan(line));
        i++;
        continue;
      }

      const parsed = this.parseDiffLine(line);
      if (!parsed) {
        result.push(this.c.dim(line));
        i++;
        continue;
      }

      if (parsed.prefix === "-") {
        const removedLines: { lineNum: string; content: string }[] = [];
        while (i < lines.length) {
          const p = this.parseDiffLine(lines[i]);
          if (!p || p.prefix !== "-") break;
          removedLines.push({ lineNum: p.lineNum, content: p.content });
          i++;
        }

        const addedLines: { lineNum: string; content: string }[] = [];
        while (i < lines.length) {
          const p = this.parseDiffLine(lines[i]);
          if (!p || p.prefix !== "+") break;
          addedLines.push({ lineNum: p.lineNum, content: p.content });
          i++;
        }

        // Intra-line diffing when exactly 1 removed and 1 added line are adjacent
        if (removedLines.length === 1 && addedLines.length === 1) {
          const removed = removedLines[0];
          const added = addedLines[0];
          const { removedLine, addedLine } = this.renderIntraLineDiff(
            removed.content,
            added.content
          );
          const lineNumRem = removed.lineNum ? `${removed.lineNum} ` : "";
          const lineNumAdd = added.lineNum ? `${added.lineNum} ` : "";
          result.push(this.c.red(`-${lineNumRem}${removedLine}`));
          result.push(this.c.green(`+${lineNumAdd}${addedLine}`));
        } else {
          for (const rem of removedLines) {
            const lineNum = rem.lineNum ? `${rem.lineNum} ` : "";
            result.push(this.c.red(`-${lineNum}${rem.content}`));
          }
          for (const add of addedLines) {
            const lineNum = add.lineNum ? `${add.lineNum} ` : "";
            result.push(this.c.green(`+${lineNum}${add.content}`));
          }
        }
      } else if (parsed.prefix === "+") {
        const lineNum = parsed.lineNum ? `${parsed.lineNum} ` : "";
        result.push(this.c.green(`+${lineNum}${parsed.content}`));
        i++;
      } else {
        const lineNum = parsed.lineNum ? `${parsed.lineNum} ` : "";
        result.push(this.c.dim(` ${lineNum}${parsed.content}`));
        i++;
      }
    }

    return result.join("\n");
  }

  /**
   * Convenience static renderer
   */
  public static render(diffText: string, options?: DiffHighlighterOptions): string {
    return new DiffHighlighter(options).renderDiff(diffText);
  }
}

