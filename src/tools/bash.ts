import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Tool, ToolResult, BashOperations, BashToolOptions, BashToolInput } from "./types.ts";

export interface ShellConfig {
  shell: string;
  args: string[];
}

export function resolveShellConfig(customShellPath?: string): ShellConfig {
  if (customShellPath && existsSync(customShellPath)) {
    return { shell: customShellPath, args: ["-c"] };
  }

  if (process.platform === "win32") {
    // 1. Try Git Bash in standard locations
    const candidates = [
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : null,
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : null,
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ].filter((p): p is string => Boolean(p && existsSync(p)));

    if (candidates.length > 0) {
      return { shell: candidates[0], args: ["-c"] };
    }

    // 2. Fallback to PowerShell
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
    };
  }

  // Unix
  if (existsSync("/bin/bash")) {
    return { shell: "/bin/bash", args: ["-c"] };
  }
  return { shell: "sh", args: ["-c"] };
}

function killProcess(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // ignore
  }
}

export function createLocalBashOperations(options?: BashToolOptions): BashOperations {
  return {
    exec: async (command, cwd, execOptions) => {
      const shellCfg = resolveShellConfig(options?.shellPath);
      const timeoutMs = execOptions.timeout ? execOptions.timeout * 1000 : undefined;

      return new Promise<{ exitCode: number }>((resolve, reject) => {
        if (execOptions.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }

        const child = spawn(shellCfg.shell, [...shellCfg.args, command], {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: process.env,
        });

        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (timeoutMs && timeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            killProcess(child);
          }, timeoutMs);
        }

        const onAbort = () => {
          killProcess(child);
        };

        if (execOptions.signal) {
          execOptions.signal.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          try {
            execOptions.onData(chunk);
          } catch {
            // ignore stream write errors
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          try {
            execOptions.onData(chunk);
          } catch {
            // ignore stream write errors
          }
        });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (execOptions.signal) {
            execOptions.signal.removeEventListener("abort", onAbort);
          }
          reject(err);
        });

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (execOptions.signal) {
            execOptions.signal.removeEventListener("abort", onAbort);
          }

          if (execOptions.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }

          if (timedOut) {
            reject(new Error(`timeout:${execOptions.timeout || 30}`));
            return;
          }

          resolve({ exitCode: code ?? 0 });
        });
      });
    },
  };
}

export function createBashTool(cwd: string, options?: BashToolOptions): Tool<BashToolInput> {
  const ops = options?.operations ?? createLocalBashOperations(options);

  return {
    name: "bash",
    description: "Execute bash or terminal commands (ls, grep, git, etc.) in the workspace.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional)" },
      },
      required: ["command"],
    },
    execute: async (_toolCallId: string, params: BashToolInput, signal?: AbortSignal): Promise<ToolResult> => {
      const command = params.command;
      if (!command) {
        throw new Error("command parameter is required for bash tool");
      }

      const chunks: Buffer[] = [];
      const handleData = (data: Buffer) => {
        chunks.push(data);
      };

      const startTime = performance.now();
      try {
        const result = await ops.exec(command, cwd, {
          onData: handleData,
          signal,
          timeout: params.timeout,
        });

        const outputText = Buffer.concat(chunks).toString("utf-8");
        const wallTimeSeconds = Math.round((performance.now() - startTime) / 100) / 10;
        const exitCode = result.exitCode;

        if (exitCode !== 0) {
          const errMsg = outputText
            ? `${outputText}\n\nCommand exited with code ${exitCode}`
            : `Command exited with code ${exitCode}`;
          return {
            content: [{ type: "text", text: errMsg }],
            isError: true,
            structuredContent: {
              output: outputText,
              exit_code: exitCode,
              wall_time_seconds: wallTimeSeconds,
            },
          };
        }

        return {
          content: [{ type: "text", text: outputText || "(no output)" }],
          structuredContent: {
            output: outputText,
            exit_code: 0,
            wall_time_seconds: wallTimeSeconds,
          },
        };
      } catch (err: any) {
        const outputText = Buffer.concat(chunks).toString("utf-8");
        if (err?.message === "aborted") {
          const msg = outputText ? `${outputText}\n\nCommand aborted` : "Command aborted";
          throw new Error(msg);
        }
        if (err?.message?.startsWith("timeout:")) {
          const timeoutSec = err.message.split(":")[1];
          const msg = outputText
            ? `${outputText}\n\nCommand timed out after ${timeoutSec} seconds`
            : `Command timed out after ${timeoutSec} seconds`;
          throw new Error(msg);
        }
        throw err;
      }
    },
  };
}

