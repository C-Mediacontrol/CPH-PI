export interface TurnRecord {
  turn: number;
  userInput?: string;
  thought?: string;
  response?: string;
  action?: any;
  toolName?: string;
  toolOutput?: string;
  success?: boolean;
  [key: string]: any;
}

export interface CompactionOptions {
  preserveRecentTurns?: number; // Number of most recent turns to keep completely uncompacted (default: 2)
  maxToolResultChars?: number;  // Threshold for folding older tool outputs (default: 500)
}

export interface CompactionResult {
  compactedTurns: TurnRecord[];
  clearedCharsCount: number;
  compressionRatio: number;
}

export class CompactionService {
  public static readonly DEFAULT_PRESERVE_RECENT_TURNS = 2;
  public static readonly DEFAULT_MAX_CHARS = 500;

  /**
   * Compact multi-turn conversation history by stripping verbose tool outputs from older turns.
   * Latest <= 2 turns are strictly preserved with complete detail.
   * Historical > 2 turns have verbose tool logs folded into concise markers, saving 80%~95% token budget.
   */
  public static compactTurns(
    turns: TurnRecord[],
    options: CompactionOptions = {}
  ): CompactionResult {
    const preserveRecent =
      options.preserveRecentTurns ?? this.DEFAULT_PRESERVE_RECENT_TURNS;
    const maxChars = options.maxToolResultChars ?? this.DEFAULT_MAX_CHARS;

    const totalTurns = turns.length;
    const cutoffIndex = Math.max(0, totalTurns - preserveRecent);

    let clearedCharsCount = 0;
    let totalOriginalHistoricalOutput = 0;

    const compactedTurns: TurnRecord[] = turns.map((turn, index) => {
      // Latest turns (index >= cutoffIndex) are strictly preserved intact
      if (index >= cutoffIndex) {
        return { ...turn };
      }

      // Older turns (index < cutoffIndex)
      if (turn.toolOutput) {
        const originalLen = turn.toolOutput.length;
        totalOriginalHistoricalOutput += originalLen;

        if (originalLen > maxChars) {
          const lineCount = turn.toolOutput.split("\n").length;
          const summaryTag = `[Historical output cleared to preserve context budget (~${lineCount} lines / ${originalLen} chars)]`;
          const saved = originalLen - summaryTag.length;
          clearedCharsCount += saved;

          return {
            ...turn,
            toolOutput: summaryTag,
            isCompacted: true,
          };
        }
      }

      return { ...turn };
    });

    const compressionRatio =
      totalOriginalHistoricalOutput > 0
        ? clearedCharsCount / totalOriginalHistoricalOutput
        : 0;

    return {
      compactedTurns,
      clearedCharsCount,
      compressionRatio,
    };
  }

  /**
   * Compact a single tool result string if marked as historical and exceeding character budget.
   */
  public static compactToolResultString(
    toolName: string,
    output: string,
    isHistorical: boolean,
    maxChars = 500
  ): string {
    if (!isHistorical) return output;
    if (output.length <= maxChars) return output;

    const lineCount = output.split("\n").length;
    return `[Historical output for ${toolName} cleared to preserve context budget (~${lineCount} lines / ${output.length} chars)]`;
  }

  /**
   * Formats compacted conversation turns into a clean markdown history section.
   */
  public static buildCompactedHistorySummary(
    turns: TurnRecord[],
    preserveRecent = 2
  ): string {
    const { compactedTurns } = this.compactTurns(turns, {
      preserveRecentTurns: preserveRecent,
    });

    const lines: string[] = [];
    for (const t of compactedTurns) {
      lines.push(`### Turn ${t.turn}:`);
      if (t.userInput) {
        lines.push(`- **User**: ${t.userInput}`);
      }
      if (t.thought) {
        lines.push(`- **Thought**: ${t.thought}`);
      }
      if (t.toolName) {
        lines.push(`- **Tool**: \`${t.toolName}\` (${t.success ? "SUCCESS" : "FAILED"})`);
      }
      if (t.toolOutput) {
        lines.push(`- **Result**: ${t.toolOutput}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  }
}

export {
  BlackboxCompactor,
  type BlackboxCompactorOptions,
} from "./blackbox-compactor.ts";
