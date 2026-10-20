import { describe, it, expect } from "bun:test";
import {
  parseUnifiedDiff,
  isDiffContent,
  filterSlashCommands,
  formatDuration,
  DEFAULT_SLASH_COMMANDS,
  type ParsedDiff,
  type DiffLine,
} from "../../web/src/utils/chatHelpers.ts";

describe("Main Stage Helpers (Task 6)", () => {
  describe("Diff Parser Helper", () => {
    const sampleDiff = [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -10,5 +10,6 @@",
      " const x = 1;",
      "-const y = 2;",
      "+const y = 20;",
      "+const z = 30;",
      " console.log(x + y);",
    ].join("\n");

    it("should identify valid unified diff content with isDiffContent", () => {
      expect(isDiffContent(sampleDiff)).toBe(true);
      expect(isDiffContent("@@ -1,3 +1,4 @@\n+line")).toBe(true);
      expect(isDiffContent("Just a regular chat message")).toBe(false);
      expect(isDiffContent("")).toBe(false);
      expect(isDiffContent(null)).toBe(false);
      expect(isDiffContent(undefined)).toBe(false);
    });

    it("should parse unified diff into lines with accurate types and line counts", () => {
      const parsed: ParsedDiff = parseUnifiedDiff(sampleDiff);

      expect(parsed.addedCount).toBe(2);
      expect(parsed.deletedCount).toBe(1);
      expect(parsed.lines.length).toBe(8);

      // Check header lines
      expect(parsed.lines[0].type).toBe("header");
      expect(parsed.lines[0].content).toContain("--- a/src/index.ts");
      expect(parsed.lines[1].type).toBe("header");
      expect(parsed.lines[1].content).toContain("+++ b/src/index.ts");

      // Check hunk line
      expect(parsed.lines[2].type).toBe("hunk");
      expect(parsed.lines[2].content).toBe("@@ -10,5 +10,6 @@");

      // Check context line
      expect(parsed.lines[3].type).toBe("context");
      expect(parsed.lines[3].content).toBe("const x = 1;");
      expect(parsed.lines[3].oldLineNumber).toBe(10);
      expect(parsed.lines[3].newLineNumber).toBe(10);

      // Check deleted line
      expect(parsed.lines[4].type).toBe("delete");
      expect(parsed.lines[4].content).toBe("const y = 2;");
      expect(parsed.lines[4].oldLineNumber).toBe(11);
      expect(parsed.lines[4].newLineNumber).toBeUndefined();

      // Check added lines
      expect(parsed.lines[5].type).toBe("add");
      expect(parsed.lines[5].content).toBe("const y = 20;");
      expect(parsed.lines[5].oldLineNumber).toBeUndefined();
      expect(parsed.lines[5].newLineNumber).toBe(11);

      expect(parsed.lines[6].type).toBe("add");
      expect(parsed.lines[6].content).toBe("const z = 30;");
      expect(parsed.lines[6].oldLineNumber).toBeUndefined();
      expect(parsed.lines[6].newLineNumber).toBe(12);

      // Check trailing context
      expect(parsed.lines[7].type).toBe("context");
      expect(parsed.lines[7].content).toBe("console.log(x + y);");
      expect(parsed.lines[7].oldLineNumber).toBe(12);
      expect(parsed.lines[7].newLineNumber).toBe(13);
    });

    it("should handle diffs without file headers (patch hunks only)", () => {
      const hunkOnly = [
        "@@ -1,2 +1,3 @@",
        " line 1",
        "+line new",
        " line 2",
      ].join("\n");

      const parsed = parseUnifiedDiff(hunkOnly);
      expect(parsed.addedCount).toBe(1);
      expect(parsed.deletedCount).toBe(0);
      expect(parsed.lines.length).toBe(4);
      expect(parsed.lines[0].type).toBe("hunk");
      expect(parsed.lines[2].type).toBe("add");
      expect(parsed.lines[2].content).toBe("line new");
    });

    it("should handle empty or whitespace diff gracefully", () => {
      const parsed = parseUnifiedDiff("");
      expect(parsed.addedCount).toBe(0);
      expect(parsed.deletedCount).toBe(0);
      expect(parsed.lines).toEqual([]);

      const parsedNull = parseUnifiedDiff(null as any);
      expect(parsedNull.addedCount).toBe(0);
      expect(parsedNull.lines).toEqual([]);
    });
  });

  describe("Slash Command Filtering Logic", () => {
    it("should return all commands when query is '/'", () => {
      const results = filterSlashCommands("/");
      expect(results.length).toBe(DEFAULT_SLASH_COMMANDS.length);
      expect(results.map((c) => c.command)).toContain("/plan");
      expect(results.map((c) => c.command)).toContain("/goal");
      expect(results.map((c) => c.command)).toContain("/compact");
      expect(results.map((c) => c.command)).toContain("/clear");
    });

    it("should filter commands matching prefix", () => {
      const planResults = filterSlashCommands("/p");
      expect(planResults.length).toBe(1);
      expect(planResults[0].command).toBe("/plan");

      const goalResults = filterSlashCommands("/go");
      expect(goalResults.length).toBe(1);
      expect(goalResults[0].command).toBe("/goal");

      const cResults = filterSlashCommands("/c");
      expect(cResults.length).toBeGreaterThanOrEqual(2);
      const commands = cResults.map((r) => r.command);
      expect(commands).toContain("/compact");
      expect(commands).toContain("/clear");
    });

    it("should match case-insensitively", () => {
      const resultsUpper = filterSlashCommands("/PLAN");
      expect(resultsUpper.length).toBe(1);
      expect(resultsUpper[0].command).toBe("/plan");
    });

    it("should return empty list when query does not start with '/'", () => {
      expect(filterSlashCommands("hello")).toEqual([]);
      expect(filterSlashCommands("plan")).toEqual([]);
      expect(filterSlashCommands("")).toEqual([]);
    });

    it("should return empty list for unknown command prefix", () => {
      expect(filterSlashCommands("/nonexistent")).toEqual([]);
    });

    it("should support custom commands list parameter", () => {
      const customCommands = [
        { command: "/deploy", description: "Deploy service" },
        { command: "/destroy", description: "Destroy cluster" },
      ];

      const res = filterSlashCommands("/de", customCommands);
      expect(res.length).toBe(2);
      expect(res[0].command).toBe("/deploy");
      expect(res[1].command).toBe("/destroy");
    });
  });

  describe("Duration Formatting Helper", () => {
    it("should format milliseconds below 1000 as ms", () => {
      expect(formatDuration(0)).toBe("0ms");
      expect(formatDuration(150)).toBe("150ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    it("should format seconds between 1000ms and 59999ms with one decimal", () => {
      expect(formatDuration(1000)).toBe("1.0s");
      expect(formatDuration(8200)).toBe("8.2s");
      expect(formatDuration(15400)).toBe("15.4s");
      expect(formatDuration(59900)).toBe("59.9s");
    });

    it("should format minutes and seconds for values >= 60000ms", () => {
      expect(formatDuration(60000)).toBe("1m 0s");
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(125300)).toBe("2m 5s");
    });

    it("should handle null, undefined, negative, or NaN safely", () => {
      expect(formatDuration(null)).toBe("0ms");
      expect(formatDuration(undefined)).toBe("0ms");
      expect(formatDuration(NaN)).toBe("0ms");
      expect(formatDuration(-500)).toBe("0ms");
    });
  });
});
