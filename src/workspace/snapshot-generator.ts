import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface SnapshotResult {
  snapshotPath: string;
  hash: string;
  fileCount: number;
  bytes: number;
  files: string[];
  cloudFileName: string;
}

export interface SliceResult {
  slicePath: string;
  bytes: number;
  files: string[];
}

export class SnapshotGenerator {
  public static readonly MAX_SNAPSHOT_BYTES: number = 50 * 1024 * 1024; // 50MB 物理安全硬红线

  public static EXCLUDED_DIR_PREFIXES: string[] = [
    ".docs/",
    "package/",
    "dist/",
    ".cph/",
    "node_modules/",
    ".git/",
  ];

  public static SENSITIVE_FILE_PATTERNS: RegExp[] = [
    /^\.env/i,
    /token.*\.json$/i,
    /session.*\.json$/i,
    /\.(pem|key|pfx|pkcs12)$/i,
    /id_rsa/i,
  ];

  public static SENSITIVE_CONTENT_PATTERNS: RegExp[] = [
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----/i,
    /ey[A-Za-z0-9-_]{20,}\.ey[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/, // JWT token
  ];

  public static CRITICAL_CORE_FILES: string[] = [
    "src/session/session-manager.ts",
    "src/session/ledger/execution-ledger.ts",
    "src/session/lineage-tracker.ts",
    "src/auth/token-manager.ts",
    "scripts/lib/PnPSession.psm1",
    "cph-main-agent-prompt.txt",
    "cph-coder-agent-prompt.txt",
    "cph-researcher-agent-prompt.txt",
    "cph-dev-agent-prompt.txt",
  ];

  private static readonly ALLOWED_EXTENSIONS: Set<string> = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cs",
    ".py",
    ".ps1",
    ".psm1",
    ".psd1",
    ".json",
    ".md",
    ".sql",
    ".html",
    ".css",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".txt",
  ]);

  /**
   * 跨平台枚举 git 跟踪文件与有效未忽略源文件
   * 排除构建产物、敏感凭据与大型锁文件
   */
  public static getTrackedSourceFiles(workspaceRoot: string): string[] {
    let rawLines: string[] = [];

    try {
      const cmd = "git ls-files -z --cached --others --exclude-standard";
      const stdout = execSync(cmd, {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      rawLines = stdout.toString("utf-8").split("\0").filter(Boolean);
    } catch {
      // 在非 Git 仓库环境（如单元测试隔离的临时目录）平滑降级为递归目录扫描
      rawLines = this.scanDirRecursive(workspaceRoot, workspaceRoot);
    }

    return rawLines
      .map((p) => p.replace(/\\/g, "/"))
      .filter((relPath) => {
        // 1. 目录前缀排除
        if (
          this.EXCLUDED_DIR_PREFIXES.some(
            (prefix) => relPath.startsWith(prefix) || relPath.startsWith("./" + prefix)
          )
        ) {
          return false;
        }

        // 2. 白名单扩展名过滤
        const ext = path.extname(relPath).toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.has(ext)) {
          return false;
        }

        // 3. 大型依赖锁文件排除
        if (
          relPath.endsWith("package-lock.json") ||
          relPath.endsWith("bun.lock") ||
          relPath.endsWith("bun.lockb")
        ) {
          return false;
        }

        // 4. 精确敏感凭据与私钥文件名排除
        const baseName = path.basename(relPath);
        if (
          this.SENSITIVE_FILE_PATTERNS.some(
            (pattern) => pattern.test(baseName) || pattern.test(relPath)
          )
        ) {
          return false;
        }

        return true;
      });
  }

  /**
   * 生成 Git-Aware 全景快照交付件
   * 物理落盘为 workspace-snapshot-<hash>.txt，云端元数据映射为 workspace-v<generation>.txt
   */
  public static generateWorkspaceSnapshot(
    workspaceRoot: string,
    outputDir?: string,
    generation: number = 1
  ): SnapshotResult {
    const targetOutputDir = outputDir || path.join(workspaceRoot, ".cph", "snapshots");
    fs.mkdirSync(targetOutputDir, { recursive: true });

    const files = this.getTrackedSourceFiles(workspaceRoot);

    const manifestLines: string[] = [];
    const contentBlocks: string[] = [];
    const writtenFiles: string[] = [];

    let totalContentBytes = 0;

    for (const relPath of files) {
      const absPath = path.join(workspaceRoot, relPath);
      if (!fs.existsSync(absPath)) continue;

      const stat = fs.lstatSync(absPath);
      if (stat.isDirectory() || stat.isSymbolicLink()) continue;

      const rawBuffer = fs.readFileSync(absPath);
      const rawStr = rawBuffer.toString("utf-8");

      // 内容级密钥与凭据扫描阻断
      if (this.SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(rawStr))) {
        throw new Error(
          `CRITICAL SECURITY ALERT: Secret token or private key detected in file ${relPath}. Snapshot generation aborted!`
        );
      }

      const fileHash = crypto
        .createHash("sha256")
        .update(rawBuffer)
        .digest("hex")
        .slice(0, 12);
      const lineCount = rawStr.split("\n").length;

      manifestLines.push(
        `- ${relPath} (Lines: ${lineCount}, SHA: ${fileHash}, Bytes: ${stat.size})`
      );
      writtenFiles.push(relPath);

      const block =
        `================================================================================\n` +
        `FILE: ${relPath}\n` +
        `================================================================================\n` +
        `${rawStr}\n`;

      contentBlocks.push(block);
      totalContentBytes += Buffer.byteLength(block, "utf-8");

      if (totalContentBytes > this.MAX_SNAPSHOT_BYTES) {
        throw new Error(
          `Snapshot exceeded hard safety limit of ${this.MAX_SNAPSHOT_BYTES} bytes!`
        );
      }
    }

    // 核心源码断言硬门禁：确保无任何核心系统文件或提示词缺失
    const missingCore = this.CRITICAL_CORE_FILES.filter((cf) => {
      if (writtenFiles.includes(cf)) return false;
      const base = path.basename(cf);
      return !writtenFiles.some((w) => w.endsWith("/" + base) || w === base);
    });

    if (missingCore.length > 0) {
      throw new Error(
        `CRITICAL INTEGRITY FAULT: Snapshot dropped essential core files: ${missingCore.join(", ")}`
      );
    }

    const fullText =
      `// ================================================================================\n` +
      `// WORKSPACE STRUCTURE & MANIFEST\n` +
      `// ================================================================================\n` +
      manifestLines.join("\n") +
      `\n\n` +
      `// ================================================================================\n` +
      `// SOURCE FILE CONTENTS\n` +
      `// ================================================================================\n\n` +
      contentBlocks.join("\n");

    const fullBuffer = Buffer.from(fullText, "utf-8");
    const snapshotHash = crypto
      .createHash("sha256")
      .update(fullBuffer)
      .digest("hex")
      .slice(0, 16);

    const snapshotPath = path.join(
      targetOutputDir,
      `workspace-snapshot-${snapshotHash}.txt`
    );

    fs.writeFileSync(snapshotPath, fullBuffer);

    return {
      snapshotPath,
      hash: snapshotHash,
      fileCount: writtenFiles.length,
      bytes: fullBuffer.length,
      files: writtenFiles,
      cloudFileName: `workspace-v${generation}.txt`,
    };
  }

  /**
   * 生成子代理局部闭包微切片 (10~30KB)
   * 仅包含目标文件、前序审查报告与导入依赖接口定义
   */
  public static generateScopedSubagentSlice(
    workspaceRoot: string,
    targetFiles: string[],
    prerequisiteReports?: string[],
    outputDir?: string
  ): SliceResult {
    const targetOutputDir = outputDir || path.join(workspaceRoot, ".cph", "slices");
    fs.mkdirSync(targetOutputDir, { recursive: true });

    const includedFiles: string[] = [];
    const sections: string[] = [];
    const seenFiles = new Set<string>();

    const targetList = targetFiles.map((f) => f.replace(/\\/g, "/"));
    const reportList = (prerequisiteReports || []).map((f) => f.replace(/\\/g, "/"));

    // 1. 纳入前序审查报告
    for (const reportRel of reportList) {
      const absReport = path.join(workspaceRoot, reportRel);
      if (fs.existsSync(absReport) && !seenFiles.has(reportRel)) {
        seenFiles.add(reportRel);
        includedFiles.push(reportRel);
        const reportContent = fs.readFileSync(absReport, "utf-8");
        sections.push(
          `================================================================================\n` +
          `PREREQUISITE REPORT: ${reportRel}\n` +
          `================================================================================\n` +
          `${reportContent}\n`
        );
      }
    }

    // 2. 纳入目标源码文件并提取局部依赖接口定义
    const importedInterfaceSections: string[] = [];

    for (const targetRel of targetList) {
      const absTarget = path.join(workspaceRoot, targetRel);
      if (!fs.existsSync(absTarget) || seenFiles.has(targetRel)) continue;

      seenFiles.add(targetRel);
      includedFiles.push(targetRel);

      const targetContent = fs.readFileSync(absTarget, "utf-8");
      sections.push(
        `================================================================================\n` +
        `FILE: ${targetRel}\n` +
        `================================================================================\n` +
        `${targetContent}\n`
      );

      // 提取直接引用的相对模块接口声明
      const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(targetContent)) !== null) {
        const importSpecifier = match[1];
        const resolvedAbs = this.resolveImportPath(
          path.dirname(absTarget),
          importSpecifier
        );

        if (!resolvedAbs || !fs.existsSync(resolvedAbs)) continue;

        const depRelPath = path.relative(workspaceRoot, resolvedAbs).replace(/\\/g, "/");
        if (seenFiles.has(depRelPath)) continue;

        const depContent = fs.readFileSync(resolvedAbs, "utf-8");
        const typeBlocks = this.extractExportedTypeDeclarations(depContent);

        if (typeBlocks.length > 0) {
          importedInterfaceSections.push(
            `================================================================================\n` +
            `IMPORTED INTERFACE DEFINITIONS: ${depRelPath}\n` +
            `================================================================================\n` +
            typeBlocks.join("\n\n") +
            `\n`
          );
        }
      }
    }

    if (importedInterfaceSections.length > 0) {
      sections.push(...importedInterfaceSections);
    }

    const fullText =
      `// ================================================================================\n` +
      `// SUBAGENT SCOPED WORKSPACE SLICE\n` +
      `// TARGET FILES: ${targetList.join(", ")}\n` +
      (reportList.length > 0 ? `// PREREQUISITE REPORTS: ${reportList.join(", ")}\n` : "") +
      `// ================================================================================\n\n` +
      sections.join("\n");

    const fullBuffer = Buffer.from(fullText, "utf-8");
    const sliceHash = crypto
      .createHash("sha256")
      .update(fullBuffer)
      .digest("hex")
      .slice(0, 16);

    const slicePath = path.join(targetOutputDir, `slice-${sliceHash}.txt`);
    fs.writeFileSync(slicePath, fullBuffer);

    return {
      slicePath,
      bytes: fullBuffer.length,
      files: includedFiles,
    };
  }

  /**
   * 递归扫描目录（非 Git 隔离环境后备方案）
   */
  private static scanDirRecursive(currentDir: string, rootDir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(currentDir)) return results;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (
          this.EXCLUDED_DIR_PREFIXES.some(
            (p) => (relPath + "/").startsWith(p) || relPath === p.replace(/\/$/, "")
          )
        ) {
          continue;
        }
        results.push(...this.scanDirRecursive(fullPath, rootDir));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }

    return results;
  }

  /**
   * 解析 TypeScript / JavaScript 相对导入物理路径
   */
  private static resolveImportPath(
    baseDir: string,
    specifier: string
  ): string | null {
    const candidateBase = path.resolve(baseDir, specifier);
    const candidateExtensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];

    for (const ext of candidateExtensions) {
      const candidate = candidateBase + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 提取源码文件中导出的 interface 与 type 声明
   */
  private static extractExportedTypeDeclarations(content: string): string[] {
    const lines = content.split("\n");
    const blocks: string[] = [];
    let inBlock = false;
    let currentBlock: string[] = [];
    let braceCount = 0;

    for (const line of lines) {
      if (!inBlock) {
        if (/^\s*export\s+(?:type|interface)\s+/.test(line)) {
          inBlock = true;
          currentBlock = [line];
          const openBraces = (line.match(/{/g) || []).length;
          const closeBraces = (line.match(/}/g) || []).length;
          braceCount = openBraces - closeBraces;

          if (braceCount <= 0 && (!line.includes("{") || line.trim().endsWith(";"))) {
            blocks.push(currentBlock.join("\n"));
            inBlock = false;
            currentBlock = [];
          }
        }
      } else {
        currentBlock.push(line);
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        braceCount += openBraces - closeBraces;

        if (braceCount <= 0) {
          blocks.push(currentBlock.join("\n"));
          inBlock = false;
          currentBlock = [];
        }
      }
    }

    return blocks;
  }
}
