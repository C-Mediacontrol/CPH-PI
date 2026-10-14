import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ToolBridge } from "../../src/protocol/tool-bridge";

describe("CR-3 ToolBridge Badge Sniffing Neutrality & Precision", () => {
  let tempDir: string;
  let recordedSteps: any[];
  let mockLedger: { recordStep: (step: any) => void };
  let bridge: ToolBridge;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-badge-test-"));
    recordedSteps = [];
    mockLedger = {
      recordStep: (step: any) => {
        recordedSteps.push(step);
      },
    };
    bridge = new ToolBridge({
      cwd: tempDir,
      ledger: mockLedger,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("1. Non-test commands and sensitive keywords (No false positive badge sniffing)", () => {
    it("should NOT sniff statusBadge when command output contains 'password' in echo command", () => {
      bridge.recordToLedger(
        "run_command",
        'echo "Enter password"',
        "bash",
        true,
        "Enter password:\nPassword accepted."
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toBeUndefined();
    });

    it("should NOT sniff statusBadge when command is grep password", () => {
      bridge.recordToLedger(
        "run_command",
        "grep password file.txt",
        "bash",
        true,
        "db_password=supersecret"
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toBeUndefined();
    });

    it("should NOT sniff statusBadge for non-bash tools even if output contains test patterns", () => {
      bridge.recordToLedger(
        "read_file",
        "src/test-results.txt",
        "read",
        true,
        "508 pass\n0 fail"
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toBeUndefined();
    });

    it("should NOT sniff statusBadge for generic shell commands with word pass like git log or compilation", () => {
      bridge.recordToLedger(
        "run_command",
        "git log -n 1",
        "bash",
        true,
        "commit a1b2c3d4: pass bypass token to downstream service"
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toBeUndefined();
    });
  });

  describe("2. Authentic test commands (Accurate and bounded badge extraction)", () => {
    it("should accurately extract '508 pass' from bun test output", () => {
      const bunTestOutput = `
tests/agent/orchestrator.test.ts:
(pass) should execute agent loop cleanly [12.34ms]

 508 pass
 0 fail
 2333 expect() calls
Ran 508 tests across 80 files. [15.20s]
`;
      bridge.recordToLedger(
        "run_command",
        "bun test",
        "bash",
        true,
        bunTestOutput
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toBe("508 pass");
    });

    it("should accurately extract test badge from npm test / jest output", () => {
      const jestOutput = `
PASS src/agent/orchestrator.spec.ts
  CopilotOrchestrator
    ✓ should initialize properly (2 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        1.234 s
`;
      bridge.recordToLedger(
        "run_command",
        "npm test",
        "bash",
        true,
        jestOutput
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toMatch(/^PASS/);
    });

    it("should accurately extract test badge for vitest or pytest commands", () => {
      const pytestOutput = `
============================= test session starts =============================
platform win32 -- Python 3.11.2, pytest-7.4.0
collected 45 items

test_auth.py ............................................. [100%]

============================== 45 passed in 0.52s ==============================
`;
      bridge.recordToLedger(
        "run_command",
        "pytest tests/",
        "bash",
        true,
        pytestOutput
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toMatch(/45 passed/);
    });

    it("should accurately extract failure test badges for test commands", () => {
      const failOutput = `
FAIL src/broken.spec.ts
  ✕ should not throw (5 ms)

Tests: 1 failed, 2 passed, 3 total
`;
      bridge.recordToLedger(
        "run_command",
        "npm test -- broken.spec.ts",
        "bash",
        false,
        failOutput
      );

      expect(recordedSteps.length).toBe(1);
      expect(recordedSteps[0].statusBadge).toMatch(/^FAIL/);
    });
  });
});
