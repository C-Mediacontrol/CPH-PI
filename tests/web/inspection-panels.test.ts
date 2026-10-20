import { describe, it, expect } from "bun:test";
import {
  maskEmail,
  calculateThrottleCountdown,
  buildWorkspaceTree,
  filterLedger,
  extractModifiedAndReadFiles,
  normalizePath,
  type WorkspaceTreeNode,
} from "../../web/src/utils/panelHelpers.ts";
import type { LedgerItem, ToolCallState } from "../../web/src/types/protocol.ts";

describe("Inspection Panels Helpers (Task 7)", () => {
  describe("Account Status & Email Masking", () => {
    it("should mask email username preserving first 2 chars and domain", () => {
      expect(maskEmail("admin@domain.com")).toBe("ad***@domain.com");
      expect(maskEmail("copilot-dev@github.com")).toBe("co***@github.com");
      expect(maskEmail("user123@sub.example.com")).toBe("us***@sub.example.com");
    });

    it("should handle short username or single char gracefully", () => {
      expect(maskEmail("a@test.com")).toBe("a***@test.com");
      expect(maskEmail("ab@test.com")).toBe("ab***@test.com");
    });

    it("should handle strings without @ symbol or edge cases", () => {
      expect(maskEmail("usernameonly")).toBe("us***");
      expect(maskEmail("")).toBe("");
      expect(maskEmail(null)).toBe("");
      expect(maskEmail(undefined)).toBe("");
      expect(maskEmail("   ")).toBe("");
    });

    it("should calculate throttle remaining countdown accurately", () => {
      const now = 1_000_000;
      // 34 seconds in future
      const cooldown34s = now + 34_000;
      const res34 = calculateThrottleCountdown(cooldown34s, now);
      expect(res34.isThrottled).toBe(true);
      expect(res34.remainingSeconds).toBe(34);
      expect(res34.formatted).toBe("34s");

      // 500ms in future rounds up to 1s
      const cooldownHalfSec = now + 500;
      const resHalf = calculateThrottleCountdown(cooldownHalfSec, now);
      expect(resHalf.isThrottled).toBe(true);
      expect(resHalf.remainingSeconds).toBe(1);
      expect(resHalf.formatted).toBe("1s");

      // Expired in past
      const expired = now - 5_000;
      const resExpired = calculateThrottleCountdown(expired, now);
      expect(resExpired.isThrottled).toBe(false);
      expect(resExpired.remainingSeconds).toBe(0);
      expect(resExpired.formatted).toBe("");

      // Undefined or null cooldown
      const resUndefined = calculateThrottleCountdown(undefined, now);
      expect(resUndefined.isThrottled).toBe(false);
      expect(resUndefined.remainingSeconds).toBe(0);
      expect(resUndefined.formatted).toBe("");
    });
  });

  describe("Workspace Tree Hierarchy Builder", () => {
    const rawPaths = [
      "src/components/Sidebar.tsx",
      "src/components/App.tsx",
      "src/index.ts",
      "package.json",
      "README.md",
    ];

    it("should convert a flat list of paths into a nested directory tree", () => {
      const tree = buildWorkspaceTree(rawPaths);

      // Root should have 1 directory ('src') and 2 files ('package.json', 'README.md')
      expect(tree.length).toBe(3);

      const srcDir = tree.find((n) => n.name === "src");
      expect(srcDir).toBeDefined();
      expect(srcDir?.isDirectory).toBe(true);
      expect(srcDir?.path).toBe("src");

      // Check src children: components directory and index.ts file
      const srcChildren = srcDir?.children || [];
      expect(srcChildren.length).toBe(2);

      const componentsDir = srcChildren.find((n) => n.name === "components");
      expect(componentsDir).toBeDefined();
      expect(componentsDir?.isDirectory).toBe(true);
      expect(componentsDir?.path).toBe("src/components");

      const compChildren = componentsDir?.children || [];
      expect(compChildren.length).toBe(2);
      expect(compChildren.map((c) => c.name).sort()).toEqual(["App.tsx", "Sidebar.tsx"]);
    });

    it("should sort directories before files, and alphabetically within groups", () => {
      const tree = buildWorkspaceTree(rawPaths);
      // 'src' (dir) comes before 'package.json' and 'README.md'
      expect(tree[0].name).toBe("src");
      expect(tree[0].isDirectory).toBe(true);

      // Files sorted alphabetically
      expect(tree[1].name).toBe("package.json");
      expect(tree[1].isDirectory).toBe(false);
      expect(tree[2].name).toBe("README.md");
      expect(tree[2].isDirectory).toBe(false);
    });

    it("should handle Windows backslashes and normalize paths", () => {
      const winPaths = [
        "web\\src\\components\\Sidebar.tsx",
        "web\\src\\App.tsx",
      ];
      const tree = buildWorkspaceTree(winPaths);
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe("web");
      expect(tree[0].path).toBe("web");
    });

    it("should mark modified and read file statuses accurately", () => {
      const tree = buildWorkspaceTree(rawPaths, {
        modifiedPaths: ["src/components/Sidebar.tsx"],
        readPaths: ["README.md"],
      });

      const srcDir = tree.find((n) => n.name === "src");
      expect(srcDir?.status).toBe("modified"); // contains modified child

      const compDir = srcDir?.children?.find((n) => n.name === "components");
      expect(compDir?.status).toBe("modified");

      const sidebarFile = compDir?.children?.find((n) => n.name === "Sidebar.tsx");
      expect(sidebarFile?.status).toBe("modified");

      const appFile = compDir?.children?.find((n) => n.name === "App.tsx");
      expect(appFile?.status).toBe("normal");

      const readmeFile = tree.find((n) => n.name === "README.md");
      expect(readmeFile?.status).toBe("read");
    });

    it("should handle empty or malformed path lists", () => {
      expect(buildWorkspaceTree([])).toEqual([]);
      expect(buildWorkspaceTree(["", "   "])).toEqual([]);
    });
  });

  describe("Ledger Filter Helper", () => {
    const sampleLedger: LedgerItem[] = [
      {
        stepIndex: 1,
        timestamp: 1700000001000,
        role: "main",
        sessionId: "sess_1",
        tool: "read_file",
        target: "src/App.tsx",
        status: "SUCCESS",
        briefSummary: "Inspected current layout tree",
      },
      {
        stepIndex: 2,
        timestamp: 1700000002000,
        role: "coder",
        sessionId: "sess_1",
        tool: "patch_file",
        target: "src/components/Sidebar.tsx",
        status: "SUCCESS",
        modifiedFiles: ["src/components/Sidebar.tsx"],
        briefSummary: "Added account rotation panel",
      },
      {
        stepIndex: 3,
        timestamp: 1700000003000,
        role: "researcher",
        sessionId: "sess_1",
        tool: "bash",
        target: "bun test",
        status: "FAILURE",
        statusBadge: "EXIT 1",
        briefSummary: "Test execution failed with assertion error",
      },
    ];

    it("should return all items when query is empty or whitespace", () => {
      expect(filterLedger(sampleLedger, "").length).toBe(3);
      expect(filterLedger(sampleLedger, "   ").length).toBe(3);
    });

    it("should filter by tool name case-insensitively", () => {
      const readMatches = filterLedger(sampleLedger, "read_file");
      expect(readMatches.length).toBe(1);
      expect(readMatches[0].tool).toBe("read_file");

      const bashMatches = filterLedger(sampleLedger, "BASH");
      expect(bashMatches.length).toBe(1);
      expect(bashMatches[0].tool).toBe("bash");
    });

    it("should filter by turn or step number", () => {
      const step2 = filterLedger(sampleLedger, "2");
      expect(step2.some((i) => i.stepIndex === 2)).toBe(true);

      const turn1 = filterLedger(sampleLedger, "turn #1");
      expect(turn1.length).toBe(1);
      expect(turn1[0].stepIndex).toBe(1);
    });

    it("should filter by target path or brief summary content", () => {
      const sidebarMatches = filterLedger(sampleLedger, "Sidebar.tsx");
      expect(sidebarMatches.length).toBe(1);
      expect(sidebarMatches[0].target).toContain("Sidebar.tsx");

      const assertionMatches = filterLedger(sampleLedger, "assertion error");
      expect(assertionMatches.length).toBe(1);
      expect(assertionMatches[0].briefSummary).toContain("assertion error");
    });

    it("should filter by status or statusBadge", () => {
      const failureMatches = filterLedger(sampleLedger, "failure");
      expect(failureMatches.length).toBe(1);
      expect(failureMatches[0].status).toBe("FAILURE");

      const exitMatches = filterLedger(sampleLedger, "EXIT 1");
      expect(exitMatches.length).toBe(1);
      expect(exitMatches[0].statusBadge).toBe("EXIT 1");
    });

    it("should return empty list when no matches found", () => {
      const noMatches = filterLedger(sampleLedger, "non-existent-keyword-xyz");
      expect(noMatches.length).toBe(0);
    });
  });

  describe("File Activity Extractor", () => {
    it("should extract modified and read files from tool calls and ledger", () => {
      const toolCalls: ToolCallState[] = [
        {
          id: "1",
          action: { tool: "read_file", path: "src/utils.ts" },
          status: "completed",
          timestamp: 1000,
        },
        {
          id: "2",
          action: { tool: "patch_file", path: "src/App.tsx" },
          status: "completed",
          timestamp: 2000,
        },
      ];

      const ledger: LedgerItem[] = [
        {
          stepIndex: 1,
          timestamp: 3000,
          role: "coder",
          sessionId: "sess_1",
          tool: "write_file",
          target: "src/components/New.tsx",
          status: "SUCCESS",
          briefSummary: "Wrote new component",
        },
      ];

      const result = extractModifiedAndReadFiles(toolCalls, ledger);
      expect(result.modifiedFiles).toContain("src/App.tsx");
      expect(result.modifiedFiles).toContain("src/components/New.tsx");
      expect(result.readFiles).toContain("src/utils.ts");
      expect(result.readFiles).not.toContain("src/App.tsx");
    });
  });
});
