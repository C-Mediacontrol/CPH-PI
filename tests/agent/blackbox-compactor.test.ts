import { describe, it, expect } from "bun:test";
import {
  BlackboxCompactor,
  type BlackboxCompactorOptions,
} from "../../src/agent/blackbox-compactor.ts";
import type { TurnRecord } from "../../src/agent/compaction.ts";

describe("BlackboxCompactor Unit Tests (TDD)", () => {
  const createMockHistory = (count: number, outputLength = 2000): TurnRecord[] => {
    const turns: TurnRecord[] = [];
    for (let i = 1; i <= count; i++) {
      turns.push({
        turn: i,
        userInput: `User request for step ${i}: please inspect module_${i}`,
        thought: `Detailed reasoning for step ${i}: analyzing AST and dependencies.`,
        action: { tool: "read_file", path: `src/module_${i}.ts` },
        toolName: "read_file",
        toolOutput: `=== File src/module_${i}.ts (lines 1-100) ===\n${"x".repeat(outputLength)}\n=== End of file ===`,
        success: true,
      });
    }
    return turns;
  };

  describe("1. Structured Blackbox Format and Field Completeness", () => {
    it("should generate all four required sections and preserve core metadata", () => {
      const history = createMockHistory(5, 500);
      history[4].error = "429 RateLimitReached: Throttled by Sydney upstream";

      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "429 RateLimitReached: Throttled by Sydney upstream",
        {
          incidentTime: "2026-10-10T15:30:00.000Z",
        }
      );

      // Section 1: Incident Metadata
      expect(blackbox).toContain("🚨 事故现场黑匣子快照");
      expect(blackbox).toContain("事故基础元数据");
      expect(blackbox).toContain("2026-10-10T15:30:00.000Z");
      expect(blackbox).toContain("5 轮");
      expect(blackbox).toContain("429 RateLimitReached");

      // Section 2: Incident Diagnostics
      expect(blackbox).toContain("事故特征诊断");
      expect(blackbox).toContain("429_RATE_LIMIT");

      // Section 3: Historical Timeline Summary (Turns 1 ~ 3)
      expect(blackbox).toContain("历史轮次时间线摘要");
      expect(blackbox).toContain("Turn 1");
      expect(blackbox).toContain("read_file");
      expect(blackbox).toContain("SUCCESS");

      // Section 4: Crash Scene (Latest 2 turns: Turn 4 and Turn 5)
      expect(blackbox).toContain("末期案发现场");
      expect(blackbox).toContain("Turn 4");
      expect(blackbox).toContain("Turn 5");
      expect(blackbox).toContain(history[4].toolOutput!);
      expect(blackbox).toContain(history[3].toolOutput!);
    });

    it("should accurately diagnose 429 rate limit incidents", () => {
      const history = createMockHistory(3, 200);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "HTTP 429 Too Many Requests - Throttled by upstream"
      );

      expect(blackbox).toContain("429_RATE_LIMIT");
      expect(blackbox).toContain("频控限流");
      expect(blackbox).toContain("冷却");
    });

    it("should accurately diagnose connection aborted incidents", () => {
      const history = createMockHistory(3, 200);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "WebSocket connection closed unexpectedly: ECONNRESET"
      );

      expect(blackbox).toContain("CONNECTION_ABORTED");
      expect(blackbox).toContain("网络中断");
    });

    it("should accurately diagnose connection aborted incidents even if WebSocket URL contains 4329 in GUID", () => {
      const history = createMockHistory(3, 200);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "WebSocket connection failed to wss://substrate.office.com/m365Copilot/Chathub/hub?sub=9d314297-75dc-4329-8f94-a66489b4b9bb: socket hang up"
      );

      expect(blackbox).toContain("CONNECTION_ABORTED");
      expect(blackbox).not.toContain("429_RATE_LIMIT");
    });

    it("should accurately diagnose custom agent permission incidents", () => {
      const history = createMockHistory(3, 200);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "GptAccessForbidden: User lacks permission to access custom agent CPH-Dev"
      );

      expect(blackbox).toContain("ACCESS_RESTRICTED");
      expect(blackbox).toContain("权限");
    });
  });

  describe("2. Ultra-Large History Context Compression & 5k~8k Hard Size Constraint", () => {
    it("should strictly constrain 50-turn, 100k-character history to [5000, 8000] chars", () => {
      // 50 turns with 2,000 chars output each => ~100,000+ characters total history
      const history = createMockHistory(50, 2000);
      history[49].error = "Rate limit 429: Connection closed by Sydney server";

      const totalOriginalChars = history.reduce(
        (sum, t) =>
          sum +
          (t.userInput?.length || 0) +
          (t.thought?.length || 0) +
          (t.toolOutput?.length || 0),
        0
      );
      expect(totalOriginalChars).toBeGreaterThanOrEqual(100000);

      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "Rate limit 429: Connection closed by Sydney server"
      );

      // Hard constraint verification: [5000, 8000]
      expect(blackbox.length).toBeGreaterThanOrEqual(5000);
      expect(blackbox.length).toBeLessThanOrEqual(8000);

      // Verify compression ratio: > 90% savings
      const compressionRatio = (totalOriginalChars - blackbox.length) / totalOriginalChars;
      expect(compressionRatio).toBeGreaterThan(0.9);

      // Verify latest 2 turns (Turns 49 and 50) are 100% intact
      expect(blackbox).toContain(history[49].toolOutput!);
      expect(blackbox).toContain(history[48].toolOutput!);
      expect(blackbox).toContain(history[49].thought!);
      expect(blackbox).toContain(history[48].thought!);

      // Verify older turns (Turns 1~48) are folded into timeline items
      expect(blackbox).toContain("Turn 1");
      expect(blackbox).toContain("Turn 10");
      expect(blackbox).toContain("Turn 48");
      // But older turns' full 2000-char toolOutputs must not be leaked verbatim
      expect(blackbox).not.toContain(history[0].toolOutput!);
    });

    it("should dynamically adapt and trim when raw timeline exceeds upper bound", () => {
      // 80 turns with long thoughts and actions
      const history = createMockHistory(80, 1500);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "Connection reset mid-stream",
        { maxSnapshotChars: 8000 }
      );

      expect(blackbox.length).toBeLessThanOrEqual(8000);
      expect(blackbox.length).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("3. Boundary Conditions & Graceful Degradation", () => {
    it("should handle single-turn session (turns <= 2) without folding history", () => {
      const history = createMockHistory(1, 1000);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "Immediate crash on turn 1"
      );

      expect(blackbox).toContain("Turn 1");
      expect(blackbox).toContain("无需折叠");
      expect(blackbox).toContain(history[0].toolOutput!);
      // Natural size for small history
      expect(blackbox.length).toBeLessThan(5000);
    });

    it("should handle two-turn session (turns <= 2) without folding history", () => {
      const history = createMockHistory(2, 1000);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "Crash on turn 2"
      );

      expect(blackbox).toContain("Turn 1");
      expect(blackbox).toContain("Turn 2");
      expect(blackbox).toContain("无需折叠");
      expect(blackbox).toContain(history[0].toolOutput!);
      expect(blackbox).toContain(history[1].toolOutput!);
    });

    it("should handle pure conversation turns with no tool calls", () => {
      const history: TurnRecord[] = [
        {
          turn: 1,
          userInput: "Hello, who are you?",
          thought: "I will greet the user.",
          response: "I am CPH-PI Copilot assistant.",
        },
        {
          turn: 2,
          userInput: "Can you analyze this project?",
          thought: "I need to inspect the project layout.",
          response: "Sure, let me check.",
        },
        {
          turn: 3,
          userInput: "Go ahead.",
          thought: "Starting analysis...",
          error: "429 Too Many Requests",
        },
      ];

      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        "429 Too Many Requests"
      );

      expect(blackbox).toContain("Turn 1");
      expect(blackbox).toContain("Turn 2");
      expect(blackbox).toContain("Turn 3");
      expect(blackbox).toContain("429_RATE_LIMIT");
      expect(blackbox).not.toContain("NaN");
      expect(blackbox).not.toContain("undefined");
    });

    it("should gracefully handle undefined or empty lastError", () => {
      const history = createMockHistory(3, 200);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(history, undefined);

      expect(blackbox).toContain("事故现场黑匣子快照");
      expect(blackbox).toContain("NO_EXPLICIT_ERROR");
      expect(blackbox).not.toContain("undefined");
    });
  });

  describe("4. Normal Uncompacted Option (skipCompaction)", () => {
    it("should preserve full natural history when skipCompaction is enabled", () => {
      const history = createMockHistory(5, 1000);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(
        history,
        undefined,
        { skipCompaction: true }
      );

      expect(blackbox).toContain("免裁剪模式");
      // All turns 1 to 5 tool outputs are preserved
      for (let i = 0; i < 5; i++) {
        expect(blackbox).toContain(history[i].toolOutput!);
      }
    });
  });

  describe("5. Compatibility and API aliases", () => {
    it("should support extractSnapshot as an alias matching design spec", () => {
      const history = createMockHistory(4, 300);
      const blackbox = BlackboxCompactor.extractSnapshot(history, {
        maxSnapshotChars: 8000,
      });

      expect(blackbox).toContain("事故现场黑匣子快照");
      expect(blackbox).toContain("Turn 3");
      expect(blackbox).toContain("Turn 4");
    });
  });

  describe("6. Root User Goal Pinning (North Star Persistence)", () => {
    it("should prioritize options.rootUserPrompt when provided and format Section 0", () => {
      const history = createMockHistory(5, 500);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(history, undefined, {
        rootUserPrompt: "Fix critical memory leak in Sydney WebSocket handler",
      });

      expect(blackbox).toContain("## 0. 战役终极北极星 (Root User Goal)");
      expect(blackbox).toContain("Fix critical memory leak in Sydney WebSocket handler");
      const idx0 = blackbox.indexOf("## 0. 战役终极北极星 (Root User Goal)");
      const idx1 = blackbox.indexOf("## 1. 事故基础元数据 (Incident Metadata)");
      expect(idx0).toBeGreaterThanOrEqual(0);
      expect(idx1).toBeGreaterThan(idx0);
    });

    it("should fallback to history[0].userInput when options.rootUserPrompt is not provided", () => {
      const history = createMockHistory(5, 500);
      history[0].userInput = "Original user query from first turn";
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(history, undefined);

      expect(blackbox).toContain("## 0. 战役终极北极星 (Root User Goal)");
      expect(blackbox).toContain("Original user query from first turn");
    });

    it("should fallback to default note when neither is available", () => {
      const history: TurnRecord[] = [
        { turn: 1, thought: "Starting without explicit userInput" },
      ];
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(history, undefined);

      expect(blackbox).toContain("## 0. 战役终极北极星 (Root User Goal)");
      expect(blackbox).toContain("None (无原始用户输入记录)");
    });

    it("should retain Section 0 intact before Section 1 even under heavy compaction (30+ turns)", () => {
      const history = createMockHistory(40, 2000);
      const blackbox = BlackboxCompactor.extractDisasterBlackbox(history, "429 RateLimit", {
        rootUserPrompt: "Important root goal that must never be compacted away",
      });

      expect(blackbox).toContain("## 0. 战役终极北极星 (Root User Goal)");
      expect(blackbox).toContain("Important root goal that must never be compacted away");
      const idx0 = blackbox.indexOf("## 0. 战役终极北极星 (Root User Goal)");
      const idx1 = blackbox.indexOf("## 1. 事故基础元数据 (Incident Metadata)");
      expect(idx1).toBeGreaterThan(idx0);
      expect(blackbox.length).toBeLessThanOrEqual(8000);
      expect(blackbox.length).toBeGreaterThanOrEqual(5000);
    });
  });
});
