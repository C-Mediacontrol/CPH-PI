import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TerminalLogger } from "../../src/ui/terminal-logger.ts";

describe("TerminalLogger - Session Hierarchy", () => {
  const testSessionId = `test-sess-${Date.now()}`;
  const testWorkspace = path.join(process.cwd(), "tests", ".tmp-workspace");

  afterEach(() => {
    try {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("should create isolated subagent log stream and write safely", async () => {
    const logger = TerminalLogger.getInstance();
    const tree = logger.initSessionTree(testSessionId, testWorkspace);

    expect(fs.existsSync(tree.sessionDir)).toBe(true);
    expect(fs.existsSync(tree.mainLogPath)).toBe(true);

    const subStream = tree.createSubagentLogStream("sub-01", "researcher");
    subStream.write("Subagent step 1 output\n");
    await new Promise((r) => subStream.end(r));

    const subLogPath = path.join(tree.sessionDir, "subagents", "sub-01-researcher.log");
    expect(fs.existsSync(subLogPath)).toBe(true);
    const content = fs.readFileSync(subLogPath, "utf8");
    expect(content).toContain("Subagent step 1 output");
  });

  it("should record timeline events in jsonl format", () => {
    const logger = TerminalLogger.getInstance();
    const tree = logger.initSessionTree(testSessionId, testWorkspace);

    tree.logTimelineEvent({ type: "SUBAGENT_SPAWNED", id: "sub-01", role: "coder", timestamp: Date.now() });
    expect(fs.existsSync(tree.timelineLogPath)).toBe(true);

    const timeline = fs.readFileSync(tree.timelineLogPath, "utf8");
    expect(timeline).toContain("SUBAGENT_SPAWNED");
    expect(timeline).toContain("sub-01");
  });
});
