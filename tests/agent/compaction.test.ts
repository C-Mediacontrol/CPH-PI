import { describe, it, expect } from "bun:test";
import {
  CompactionService,
  type TurnRecord,
} from "../../src/agent/compaction.ts";

describe("CompactionService Unit Tests", () => {
  const createMockTurns = (count: number, outputLength = 2000): TurnRecord[] => {
    const turns: TurnRecord[] = [];
    for (let i = 1; i <= count; i++) {
      turns.push({
        turn: i,
        userInput: `User input for turn ${i}`,
        thought: `Thinking about step ${i} in detail...`,
        response: `Executing action for turn ${i}...`,
        action: { tool: "read_file", path: `src/file_${i}.ts` },
        toolName: "read_file",
        toolOutput: `Log line 1...\n${"x".repeat(outputLength)}\nLog line end`,
        success: true,
      });
    }
    return turns;
  };

  describe("1. Sliding Window Preservation (<= 2 turns)", () => {
    it("should keep all turns intact when total turns <= 2", () => {
      const turns = createMockTurns(2, 3000);
      const result = CompactionService.compactTurns(turns, {
        preserveRecentTurns: 2,
      });

      expect(result.compactedTurns.length).toBe(2);
      expect(result.clearedCharsCount).toBe(0);
      expect(result.compressionRatio).toBe(0);
      expect(result.compactedTurns[0].toolOutput).toBe(turns[0].toolOutput);
      expect(result.compactedTurns[1].toolOutput).toBe(turns[1].toolOutput);
    });

    it("should keep single turn intact without any modification", () => {
      const turns = createMockTurns(1, 5000);
      const result = CompactionService.compactTurns(turns);

      expect(result.compactedTurns.length).toBe(1);
      expect(result.clearedCharsCount).toBe(0);
      expect(result.compactedTurns[0].toolOutput).toBe(turns[0].toolOutput);
    });
  });

  describe("2. Historical Turns Pruning (> 2 turns)", () => {
    it("should prune older turns while preserving the most recent 2 turns completely", () => {
      const turns = createMockTurns(5, 3000); // 5 turns, each with 3000+ chars
      const result = CompactionService.compactTurns(turns, {
        preserveRecentTurns: 2,
      });

      expect(result.compactedTurns.length).toBe(5);

      // Recent 2 turns (turn 4 & 5) must be 100% intact
      expect(result.compactedTurns[3].toolOutput).toBe(turns[3].toolOutput);
      expect(result.compactedTurns[4].toolOutput).toBe(turns[4].toolOutput);

      // Older turns (turn 1, 2, 3) must be compacted into concise summaries
      for (let i = 0; i < 3; i++) {
        const compacted = result.compactedTurns[i];
        expect(compacted.toolOutput).toContain("[Historical output cleared to preserve context budget");
        expect(compacted.toolOutput!.length).toBeLessThan(200);
        // Essential metadata is preserved
        expect(compacted.turn).toBe(i + 1);
        expect(compacted.toolName).toBe("read_file");
        expect(compacted.success).toBe(true);
      }
    });

    it("should achieve 80% to 95% token/char savings on verbose historical tool outputs", () => {
      const turns = createMockTurns(6, 4000); // 6 turns, ~24KB
      const originalHistoricalChars = turns
        .slice(0, 4)
        .reduce((acc, t) => acc + (t.toolOutput?.length || 0), 0);

      const result = CompactionService.compactTurns(turns, {
        preserveRecentTurns: 2,
      });

      const compactedHistoricalChars = result.compactedTurns
        .slice(0, 4)
        .reduce((acc, t) => acc + (t.toolOutput?.length || 0), 0);

      const savingsOnHistory =
        (originalHistoricalChars - compactedHistoricalChars) /
        originalHistoricalChars;

      expect(savingsOnHistory).toBeGreaterThanOrEqual(0.85);
      expect(result.clearedCharsCount).toBeGreaterThan(10000);
    });

    it("should not compact historical turns if output is already very short", () => {
      const turns: TurnRecord[] = [
        {
          turn: 1,
          toolName: "bash",
          toolOutput: "OK",
          success: true,
        },
        {
          turn: 2,
          toolName: "read_file",
          toolOutput: "Short file",
          success: true,
        },
        {
          turn: 3,
          toolName: "edit",
          toolOutput: "Edited 1 line",
          success: true,
        },
      ];

      const result = CompactionService.compactTurns(turns, {
        preserveRecentTurns: 2,
        maxToolResultChars: 500,
      });

      expect(result.compactedTurns[0].toolOutput).toBe("OK");
      expect(result.clearedCharsCount).toBe(0);
    });
  });

  describe("3. Formatting Compacted History for Prompt Injection", () => {
    it("should generate a clean markdown summary of compacted history", () => {
      const turns = createMockTurns(4, 2000);
      const summary = CompactionService.buildCompactedHistorySummary(turns, 2);

      expect(summary).toContain("Turn 1");
      expect(summary).toContain("Turn 2");
      expect(summary).toContain("Historical output cleared");
      expect(summary).toContain("Turn 3");
      expect(summary).toContain("Turn 4");
    });
  });
});
