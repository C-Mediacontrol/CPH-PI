import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TerminalLogger, stripAnsi } from "../../src/ui/terminal-logger";
import { parseCliArgs, CphPiCli } from "../../src/cli";

describe("TerminalLogger & Debug Mode Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-logger-test-"));
  });

  afterEach(() => {
    TerminalLogger.getInstance().stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should cleanly strip ANSI color and style sequences", () => {
    const ansiText = "\x1b[31mError:\x1b[0m \x1b[1;32mSuccess\x1b[0m [Turn 1] \x1b[35mThought\x1b[0m";
    const cleaned = stripAnsi(ansiText);
    expect(cleaned).toBe("Error: Success [Turn 1] Thought");
  });

  it("should hook stdout/stderr and write clean text to log file in real time", async () => {
    const logFile = path.join(tempDir, "test-terminal.log");
    const logger = TerminalLogger.getInstance();

    const startedPath = logger.start({
      logFilePath: logFile,
      workspaceRoot: tempDir,
    });
    expect(startedPath).toBe(logFile);
    expect(logger.isEnabled()).toBe(true);

    process.stdout.write("\x1b[36mcph-pi>\x1b[0m Hello World\n");
    process.stderr.write("\x1b[31m[STDERR WARNING]\x1b[0m Something happened\n");

    // Allow stream to flush
    await new Promise((r) => setTimeout(r, 50));

    logger.stop();
    expect(logger.isEnabled()).toBe(false);

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, "utf8");
    expect(content).toContain("cph-pi> Hello World");
    expect(content).toContain("[STDERR WARNING] Something happened");
    expect(content).not.toContain("\x1b[36m");
  });

  it("should parse --debug and --log cli arguments accurately", () => {
    const args1 = ["E:/test", "--debug"];
    const parsed1 = parseCliArgs(args1);
    expect(parsed1.debug).toBe(true);

    const args2 = ["E:/test", "--debug", "E:/custom/logs.txt"];
    const parsed2 = parseCliArgs(args2);
    expect(parsed2.debug).toBe(true);
    expect(parsed2.debugLogPath).toBe("E:/custom/logs.txt");

    const args3 = ["E:/test", "-d"];
    const parsed3 = parseCliArgs(args3);
    expect(parsed3.debug).toBe(true);

    const args4 = ["E:/test", "--log=E:/my-logs.log"];
    const parsed4 = parseCliArgs(args4);
    expect(parsed4.debug).toBe(true);
    expect(parsed4.debugLogPath).toBe("E:/my-logs.log");
  });

  it("should resolve default log file path in workspace logs directory", () => {
    const logger = TerminalLogger.getInstance();
    const resolved = logger.resolveDefaultLogPath(tempDir);
    expect(resolved).toContain(path.join(tempDir, ".cph", "logs"));
    expect(resolved.endsWith(".log")).toBe(true);
  });

  it("should toggle debug mode via /debug slash command", async () => {
    const app = new CphPiCli({
      workspaceRoot: tempDir,
      debug: false,
    });

    expect(app.isDebugModeEnabled()).toBe(false);

    // Turn debug on
    await app.handleCommand("/debug on");
    expect(app.isDebugModeEnabled()).toBe(true);

    // Turn debug off
    await app.handleCommand("/debug off");
    expect(app.isDebugModeEnabled()).toBe(false);

    app.close();
  });
});

