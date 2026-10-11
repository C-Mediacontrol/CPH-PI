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

  public static getInstance(): TerminalLogger {
    if (!TerminalLogger.instance) {
      TerminalLogger.instance = new TerminalLogger();
    }
    return TerminalLogger.instance;
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
      if (cleaned) {
        this.stream.write(cleaned);
      }
    } catch {
      // Non-blocking: write errors must not crash main runtime
    }
  }
}

