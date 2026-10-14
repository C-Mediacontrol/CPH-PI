import fs from "node:fs";
import path from "node:path";

/**
 * Strips ANSI escape codes from terminal text.
 */
export function stripAnsi(str: string): string {
  if (!str) return "";
  // Strip standard ANSI 7-bit and 8-bit sequences (colors, cursor movements, erase codes)
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export interface TerminalLoggerStartOptions {
  logFilePath?: string;
  workspaceRoot?: string;
}

export interface SessionLoggerTree {
  sessionDir: string;
  mainLogPath: string;
  timelineLogPath: string;
  createSubagentLogStream(subagentId: string, role: string): fs.WriteStream;
  logTimelineEvent(event: { type: string; timestamp: number; [key: string]: any }): void;
}

/**
 * TerminalLogger: Global output interceptor teeing all console stdout and stderr
 * streams directly to a persistent local log file in real time, avoiding terminal
 * scrollback truncation in PowerShell/Windows Terminal.
 */
export class TerminalLogger {
  private static instance?: TerminalLogger;
  private logFilePath?: string;
  private stream?: fs.WriteStream;
  private originalStdoutWrite?: typeof process.stdout.write;
  private originalStderrWrite?: typeof process.stderr.write;
  private isHooked = false;
  private lastMatrixSummary?: string;

  public static isTuiMatrixRedrawFrame(text: string): boolean {
    if (!text) return false;
    return text.includes("多会话子代理协同看板") || text.includes("Sub-Agent Matrix");
  }

  public static getInstance(): TerminalLogger {
    if (!TerminalLogger.instance) {
      TerminalLogger.instance = new TerminalLogger();
    }
    return TerminalLogger.instance;
  }

  /**
   * Initializes a tree-structured session logging folder under <workspaceRoot>/.cph/logs/<sessionId>/
   * with dedicated subagents/ directory, main.log, and timeline.jsonl event logger.
   */
  public initSessionTree(sessionId: string, workspaceRoot?: string): SessionLoggerTree {
    const root = workspaceRoot || process.cwd();
    const cleanSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sessionDir = path.join(root, ".cph", "logs", cleanSessionId);
    const subagentsDir = path.join(sessionDir, "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });

    const mainLogPath = path.join(sessionDir, "main.log");
    if (!fs.existsSync(mainLogPath)) {
      fs.writeFileSync(mainLogPath, `=== [CPH-PI Main Session Log: ${sessionId}] ===\n`, "utf8");
    }

    const timelineLogPath = path.join(sessionDir, "timeline.jsonl");

    return {
      sessionDir,
      mainLogPath,
      timelineLogPath,
      createSubagentLogStream: (subagentId: string, role: string): fs.WriteStream => {
        const cleanId = subagentId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const cleanRole = role.replace(/[^a-zA-Z0-9_-]/g, "_");
        const subLogPath = path.join(subagentsDir, `${cleanId}-${cleanRole}.log`);
        const stream = fs.createWriteStream(subLogPath, { flags: "a", encoding: "utf8" });
        stream.write(`=== [CPH-PI Subagent Log: ${subagentId} (${role})] ===\n`);
        return stream;
      },
      logTimelineEvent: (event: { type: string; timestamp: number; [key: string]: any }) => {
        const line = JSON.stringify({ ...event, timestamp: event.timestamp || Date.now() }) + "\n";
        try {
          fs.appendFileSync(timelineLogPath, line, "utf8");
        } catch {}
      },
    };
  }

  /**
   * Resolves a default log path under <workspaceRoot>/.cph/logs/
   */
  public resolveDefaultLogPath(workspaceRoot?: string): string {
    const root = workspaceRoot || process.cwd();
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const logDir = path.join(root, ".cph", "logs");
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {}
    return path.join(logDir, `cph-terminal-${dateStr}.log`);
  }

  /**
   * Starts terminal logging by intercepting stdout and stderr.
   */
  public start(options: TerminalLoggerStartOptions = {}): string {
    if (this.isHooked && this.logFilePath) {
      return this.logFilePath;
    }

    const targetPath =
      options.logFilePath || this.resolveDefaultLogPath(options.workspaceRoot);
    const resolvedPath = path.resolve(targetPath);

    try {
      const parentDir = path.dirname(resolvedPath);
      fs.mkdirSync(parentDir, { recursive: true });
      this.stream = fs.createWriteStream(resolvedPath, {
        flags: "a",
        encoding: "utf8",
      });
    } catch (err: any) {
      process.stderr.write(`[TerminalLogger Error] 无法创建日志文件: ${err.message}\n`);
      return resolvedPath;
    }

    this.logFilePath = resolvedPath;
    this.lastMatrixSummary = undefined;

    // Save originals
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);

    // Intercept stdout
    process.stdout.write = (chunk: any, encodingOrCb?: any, cb?: any): boolean => {
      const ret = this.originalStdoutWrite!(chunk, encodingOrCb, cb);
      this.writeToLog(chunk);
      return ret;
    };

    // Intercept stderr
    process.stderr.write = (chunk: any, encodingOrCb?: any, cb?: any): boolean => {
      const ret = this.originalStderrWrite!(chunk, encodingOrCb, cb);
      this.writeToLog(chunk);
      return ret;
    };

    this.isHooked = true;
    this.stream.write(
      `\n=== [CPH-PI Terminal Log Started at ${new Date().toISOString()}] ===\n`
    );

    return resolvedPath;
  }

  /**
   * Stops terminal logging and restores stdout and stderr.
   */
  public stop(): void {
    if (!this.isHooked) return;

    if (this.originalStdoutWrite) {
      process.stdout.write = this.originalStdoutWrite;
      this.originalStdoutWrite = undefined;
    }

    if (this.originalStderrWrite) {
      process.stderr.write = this.originalStderrWrite;
      this.originalStderrWrite = undefined;
    }

    if (this.stream) {
      try {
        this.stream.write(
          `=== [CPH-PI Terminal Log Closed at ${new Date().toISOString()}] ===\n\n`
        );
        this.stream.end();
      } catch {}
      this.stream = undefined;
    }

    this.isHooked = false;
    this.logFilePath = undefined;
    this.lastMatrixSummary = undefined;
  }

  public isEnabled(): boolean {
    return this.isHooked;
  }

  public getLogFilePath(): string | undefined {
    return this.logFilePath;
  }

  private writeToLog(chunk: any): void {
    if (!this.stream || !this.isHooked) return;
    try {
      const text = typeof chunk === "string" ? chunk : chunk?.toString("utf8") || "";
      const cleaned = stripAnsi(text);
      if (!cleaned) return;

      if (TerminalLogger.isTuiMatrixRedrawFrame(cleaned)) {
        this.writeCompressedMatrixFrame(cleaned);
        return;
      }

      this.stream.write(cleaned);
    } catch {
      // Non-blocking: write errors must not crash main runtime
    }
  }

  private writeCompressedMatrixFrame(cleaned: string): void {
    if (!this.stream) return;

    const lines = cleaned.split(/\r?\n/);
    const subagentEvents: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("│ [Sub-") || line.startsWith("│ [sub-")) {
        let entry = line.replace(/^│\s*/, "");
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.startsWith("│") && (nextLine.includes("最新动作") || nextLine.includes("└─"))) {
            const actionText = nextLine.replace(/^│\s*(?:└─\s*)?/, "");
            entry += ` | ${actionText}`;
            i++;
          }
        }
        subagentEvents.push(entry);
      }
    }

    const summary =
      subagentEvents.length > 0
        ? `[Subagent Matrix Sync] ${subagentEvents.join(" ; ")}`
        : `[Subagent Matrix Sync] 协同看板状态刷新`;

    // Skip consecutive identical matrix frame redraws to avoid log bloat
    if (this.lastMatrixSummary === summary) {
      return;
    }

    this.lastMatrixSummary = summary;
    this.stream.write(`${summary}\n`);
  }
}

