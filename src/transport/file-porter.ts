import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface FilePorterOptions {
  cwd: string;
  scratchDir?: string;
  cdpClient?: any;
  timeoutMs?: number;
}

export interface SaveAndExecuteParams {
  fileName: string;
  downloadUrl?: string;
  content?: string;
  autoExecute?: boolean;
  destinationPath?: string;
}

export interface FilePorterResult {
  fileName: string;
  filePath: string;
  downloaded: boolean;
  executed: boolean;
  runtime?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  formattedOutput: string;
}

export class FilePorter {
  private cwd: string;
  private scratchDir: string;
  private cdpClient?: any;
  private timeoutMs: number;

  constructor(options: FilePorterOptions) {
    this.cwd = options.cwd;
    this.scratchDir =
      options.scratchDir || path.join(this.cwd, ".cph", "scratch");
    this.cdpClient = options.cdpClient;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /**
   * Detects available runtime environment for a given script fileName.
   */
  public detectRuntime(fileName: string): string | undefined {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case ".py":
        return "python";
      case ".js":
      case ".mjs":
      case ".cjs":
        return "node";
      case ".ts":
      case ".mts":
        return "bun";
      case ".ps1":
        return "powershell";
      case ".sh":
      case ".bash":
        return "bash";
      default:
        return undefined;
    }
  }

  /**
   * Resolves safe local storage destination within .cph/scratch or target path.
   */
  public resolveDestination(fileName: string, customPath?: string): string {
    const dest = customPath
      ? path.isAbsolute(customPath)
        ? customPath
        : path.join(this.cwd, customPath)
      : path.join(this.scratchDir, fileName);

    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dest;
  }

  /**
   * Downloads or extracts content and optionally executes script.
   */
  public async saveAndExecute(params: SaveAndExecuteParams): Promise<FilePorterResult> {
    const fileName = path.basename(params.fileName || "downloaded_file.txt");
    const filePath = this.resolveDestination(fileName, params.destinationPath);

    let content = params.content;

    // If content is not provided directly, fetch via downloadUrl
    if (content === undefined && params.downloadUrl) {
      if (params.downloadUrl.startsWith("blob:") && this.cdpClient) {
        // Fetch via CDP page context
        const evalRes = await this.cdpClient.evaluate(
          `(async () => { const r = await fetch("${params.downloadUrl}"); return await r.text(); })()`
        );
        content = typeof evalRes === "string" ? evalRes : String(evalRes?.result?.value ?? evalRes?.value ?? "");
      } else {
        // Standard HTTP/HTTPS fetch
        const res = await fetch(params.downloadUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch file from ${params.downloadUrl} (${res.status})`);
        }
        content = await res.text();
      }
    }

    if (content === undefined) {
      content = "";
    }

    // Write file to target destination
    fs.writeFileSync(filePath, content, "utf-8");

    const runtime = this.detectRuntime(fileName);
    const shouldExecute =
      params.autoExecute ?? (runtime !== undefined);

    if (!shouldExecute || !runtime) {
      return {
        fileName,
        filePath,
        downloaded: true,
        executed: false,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - SUCCESS】\n文件已通过 File Porter 成功搬运并落盘至：${path.relative(this.cwd, filePath) || filePath}\n【END_TOOL_RESULT】`,
      };
    }

    // Execute script
    try {
      const execRes = await this.runScript(filePath, runtime);
      const isSuccess = execRes.exitCode === 0;
      const statusText = isSuccess ? "SUCCESS" : "FAILED";

      let output = `文件已搬运落盘至：${path.relative(this.cwd, filePath) || filePath}\n宿主执行环境: ${runtime}\n`;
      if (execRes.stdout) {
        output += `\n[stdout]\n${execRes.stdout.trim()}`;
      }
      if (execRes.stderr) {
        output += `\n[stderr]\n${execRes.stderr.trim()}`;
      }
      if (!execRes.stdout && !execRes.stderr) {
        output += `\n(进程执行完毕，无输出)`;
      }

      return {
        fileName,
        filePath,
        downloaded: true,
        executed: true,
        runtime,
        exitCode: execRes.exitCode,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - ${statusText}】\n${output.trim()}\n【END_TOOL_RESULT】`,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        fileName,
        filePath,
        downloaded: true,
        executed: true,
        runtime,
        exitCode: 1,
        error: errMsg,
        formattedOutput: `【TOOL_RESULT: file_porter (${fileName}) - FAILED】\n执行失败: ${errMsg}\n【END_TOOL_RESULT】`,
      };
    }
  }

  /**
   * Spawns runtime process with timeout protection.
   */
  private runScript(
    filePath: string,
    runtime: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let command = runtime;
      let args: string[] = [filePath];

      if (runtime === "powershell") {
        command = "powershell.exe";
        args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath];
      } else if (runtime === "python") {
        command = process.platform === "win32" ? "python.exe" : "python3";
        args = [filePath];
      } else if (runtime === "node") {
        command = "node";
        args = [filePath];
      } else if (runtime === "bun") {
        command = process.platform === "win32" ? "bun.exe" : "bun";
        args = ["run", filePath];
      }

      const proc = spawn(command, args, {
        cwd: this.cwd,
        env: process.env,
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill();
        reject(new Error(`Script execution timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        // Fallback for python command alias if python.exe is missing
        if (runtime === "python" && command === "python.exe") {
          const fallback = spawn("python", [filePath], { cwd: this.cwd });
          let fbOut = "";
          let fbErr = "";
          fallback.stdout.on("data", (c) => (fbOut += c.toString()));
          fallback.stderr.on("data", (c) => (fbErr += c.toString()));
          fallback.on("close", (code) => {
            resolve({ exitCode: code ?? 0, stdout: fbOut, stderr: fbErr });
          });
          fallback.on("error", (e) => reject(e));
          return;
        }
        reject(err);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ exitCode: code ?? 0, stdout, stderr });
        }
      });
    });
  }
}

