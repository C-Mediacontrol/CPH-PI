import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";

export interface FilePorterOptions {
  cwd: string;
  scratchDir?: string;
  cdpClient?: any;
  timeoutMs?: number;
  ic3TokenProvider?: () => Promise<string | undefined>;
  graphTokenProvider?: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
}

export interface SaveAndExecuteParams {
  fileName: string;
  downloadUrl?: string;
  content?: string;
  autoExecute?: boolean;
  destinationPath?: string;
}

export interface DeliverToWorkspaceParams {
  downloadUrl: string;
  destinationPath: string;
  isDirectory?: boolean;
  isZip?: boolean;
}

export interface DeliverToWorkspaceResult {
  landedFiles: string[];
  extractedFromZip: boolean;
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
  private ic3TokenProvider?: () => Promise<string | undefined>;
  private graphTokenProvider?: () => Promise<string | undefined>;
  private fetchFn?: typeof fetch;

  constructor(options: FilePorterOptions) {
    this.cwd = options.cwd;
    this.scratchDir =
      options.scratchDir || path.join(this.cwd, ".cph", "scratch");
    this.cdpClient = options.cdpClient;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.ic3TokenProvider = options.ic3TokenProvider;
    this.graphTokenProvider = options.graphTokenProvider;
    this.fetchFn = options.fetchFn;
  }

  /**
   * Normalizes asyncgw URL by stripping trailing filename from /views/original/
   * while extracting the original filename and preserving query parameters.
   */
  public static normalizeAsyncGwUrl(rawUrl: string): {
    fetchUrl: string;
    fileNameFromUrl?: string;
  } {
    try {
      const u = new URL(rawUrl);
      if (u.hostname.endsWith(".asyncgw.teams.microsoft.com")) {
        const match = u.pathname.match(
          /^(\/v1\/objects\/[^/]+\/views\/[^/]+)(?:\/([^/]+))?$/i
        );
        if (match) {
          const fileNameFromUrl = match[2]
            ? decodeURIComponent(match[2])
            : undefined;
          u.pathname = match[1];
          return { fetchUrl: u.toString(), fileNameFromUrl };
        }
      }
      const base = path.posix.basename(u.pathname);
      return {
        fetchUrl: rawUrl,
        fileNameFromUrl: base && base !== "/" ? decodeURIComponent(base) : undefined,
      };
    } catch {
      return { fetchUrl: rawUrl };
    }
  }

  /**
   * Enforces SSRF host allowlist for downloaded URLs.
   */
  public static assertAllowedDownloadUrl(rawUrl: string): URL {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error(`Disallowed download host: invalid URL "${rawUrl}"`);
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Disallowed download host: unsupported protocol "${u.protocol}"`);
    }

    const host = u.hostname.toLowerCase();
    const allowed =
      host === "graph.microsoft.com" ||
      host === "asyncgw.teams.microsoft.com" ||
      host.endsWith(".asyncgw.teams.microsoft.com") ||
      host === "sharepoint.com" ||
      host.endsWith(".sharepoint.com") ||
      host === "1drv.com" ||
      host.endsWith(".1drv.com") ||
      host === "office.com" ||
      host.endsWith(".office.com") ||
      host === "cloud.microsoft" ||
      host.endsWith(".cloud.microsoft");

    if (!allowed) {
      throw new Error(`Disallowed download host "${u.hostname}" for URL: ${rawUrl}`);
    }

    return u;
  }

  /**
   * Downloads binary content with SSRF check, IC3/Graph authentication, and 100MB limit.
   */
  private async downloadBinary(
    rawUrl: string
  ): Promise<{ buffer: Buffer; fileNameFromUrl?: string }> {
    FilePorter.assertAllowedDownloadUrl(rawUrl);
    const norm = FilePorter.normalizeAsyncGwUrl(rawUrl);

    const parsed = new URL(norm.fetchUrl);
    const host = parsed.hostname.toLowerCase();
    const isAsyncGw =
      host === "asyncgw.teams.microsoft.com" ||
      host.endsWith(".asyncgw.teams.microsoft.com");

    const headers: Record<string, string> = {};
    if (isAsyncGw && this.ic3TokenProvider) {
      const token = await this.ic3TokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const fetcher = this.fetchFn || fetch;
    let res = await fetcher(norm.fetchUrl, { headers });

    if (
      (res.status === 401 || res.status === 403) &&
      isAsyncGw &&
      this.graphTokenProvider
    ) {
      const graphToken = await this.graphTokenProvider();
      if (graphToken) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${graphToken}` };
        res = await fetcher(norm.fetchUrl, { headers: retryHeaders });
      }
    }

    if (!res.ok) {
      throw new Error(
        `Failed to download binary from ${norm.fetchUrl} (${res.status} ${res.statusText})`
      );
    }

    const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
    const clHeader = res.headers.get("content-length");
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (!isNaN(cl) && cl > MAX_DOWNLOAD_SIZE) {
        throw new Error(`Download payload exceeds 100MB limit: ${cl} bytes`);
      }
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) {
      throw new Error(
        `Download payload exceeds 100MB limit: ${arrayBuffer.byteLength} bytes`
      );
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      fileNameFromUrl: norm.fileNameFromUrl,
    };
  }

  /**
   * Delivers remote download directly to workspace with path-safe extraction.
   */
  public async deliverToWorkspace(
    params: DeliverToWorkspaceParams
  ): Promise<DeliverToWorkspaceResult> {
    const resolvedDest = path.resolve(this.cwd, params.destinationPath);
    const relToCwd = path.relative(this.cwd, resolvedDest);
    if (relToCwd.startsWith("..") || path.isAbsolute(relToCwd)) {
      throw new Error(
        `Destination path "${params.destinationPath}" resolves outside workspace cwd: ${this.cwd}`
      );
    }

    const isDirTarget = Boolean(
      params.isDirectory || /[\\/]$/.test(params.destinationPath)
    );
    const isExplicitZipFile = params.destinationPath.toLowerCase().endsWith(".zip");

    const { buffer, fileNameFromUrl } = await this.downloadBinary(params.downloadUrl);

    const isZipPayload = Boolean(
      params.isZip ||
        fileNameFromUrl?.toLowerCase().endsWith(".zip") ||
        isExplicitZipFile
    );

    if (isZipPayload && !isExplicitZipFile) {
      const targetDir = resolvedDest;
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      if (entries.length > 200) {
        throw new Error(
          `Zip archive exceeds maximum allowed entry count (found ${entries.length}, max 200)`
        );
      }

      let totalUncompressedBytes = 0;
      for (const entry of entries) {
        totalUncompressedBytes += entry.header.size;
      }
      if (totalUncompressedBytes > 100 * 1024 * 1024) {
        throw new Error(
          `Zip archive uncompressed size exceeds 100MB limit: ${totalUncompressedBytes} bytes`
        );
      }

      const targetBase = path.basename(targetDir);
      const landedFiles: string[] = [];

      for (const entry of entries) {
        const rawName = entry.entryName;
        // Zip-Slip protection
        if (
          rawName.includes("..") ||
          path.isAbsolute(rawName) ||
          /^[a-zA-Z]:/.test(rawName)
        ) {
          throw new Error(
            `Disallowed zip entry path (Zip-Slip detected): "${rawName}"`
          );
        }

        const normalizedEntry = path.posix.normalize(rawName.replace(/\\/g, "/"));
        if (normalizedEntry.startsWith("..") || path.isAbsolute(normalizedEntry)) {
          throw new Error(
            `Disallowed zip entry path (Zip-Slip detected): "${rawName}"`
          );
        }

        const rawParts = normalizedEntry.split("/").filter(Boolean);
        if (rawParts.length === 0) continue;

        let effectiveParts = rawParts;
        if (
          targetBase &&
          (effectiveParts[0] === targetBase ||
            effectiveParts[0].toLowerCase() === targetBase.toLowerCase())
        ) {
          if (effectiveParts.length === 1 && entry.isDirectory) {
            fs.mkdirSync(targetDir, { recursive: true });
            continue;
          }
          if (effectiveParts.length > 1) {
            effectiveParts = effectiveParts.slice(1);
          }
        }

        const relativeEntryPath = effectiveParts.join("/");
        const outPath = path.resolve(targetDir, relativeEntryPath);

        const relToTarget = path.relative(targetDir, outPath);
        if (relToTarget.startsWith("..") || path.isAbsolute(relToTarget)) {
          throw new Error(
            `Zip entry "${rawName}" would extract outside target directory`
          );
        }

        if (entry.isDirectory) {
          fs.mkdirSync(outPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, entry.getData());
          const relToWorkspace = path
            .relative(this.cwd, outPath)
            .replace(/\\/g, "/");
          landedFiles.push(relToWorkspace);
        }
      }

      return {
        landedFiles,
        extractedFromZip: true,
      };
    }

    let targetFilePath: string;
    if (isDirTarget) {
      const finalName = fileNameFromUrl || "downloaded_file";
      targetFilePath = path.resolve(resolvedDest, finalName);
    } else {
      targetFilePath = resolvedDest;
    }

    const relCheck = path.relative(this.cwd, targetFilePath);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new Error(
        `Target file path "${targetFilePath}" resolves outside workspace cwd: ${this.cwd}`
      );
    }

    fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
    fs.writeFileSync(targetFilePath, buffer);

    const relPath = path.relative(this.cwd, targetFilePath).replace(/\\/g, "/");
    return {
      landedFiles: [relPath],
      extractedFromZip: false,
    };
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
        // Standard HTTP/HTTPS fetch via downloadBinary (SSRF + Auth + Limit protected)
        const { buffer } = await this.downloadBinary(params.downloadUrl);
        content = buffer.toString("utf-8");
      }
    }

    if (content === undefined) {
      content = "";
    }

    // Write file to target destination
    fs.writeFileSync(filePath, content, "utf-8");

    const runtime = this.detectRuntime(fileName);
    const shouldExecute = params.autoExecute === true;

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
