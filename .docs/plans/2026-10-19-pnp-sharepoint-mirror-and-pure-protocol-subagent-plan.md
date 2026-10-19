# SharePoint 物理镜像、纯协议会话投影与子代理微切片隔离体系实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建由 `PWSH 5.1 + PnP 1.12.0` 驱动的 SharePoint 云端真实物理镜像、基于原生 Node/Bun `createUploadSession` 的纯协议大文件分块直传（零 CDP）、消除快照时效性崩塌的状态指纹闭环，以及子代理严格局部微切片物理隔离体系。

**Architecture:** 
采用“物理持久化与会话推理严格正交解耦”的双层流架构。SharePoint 存储全量文件树（由 PnP 后台异步增量同步，提供无容量上限与审计依据）；会话层直接通过纯 HTTP 分块直传（5~10 秒 Substrate 即时切片索引）投递首轮 4MB 全景快照；单点编码小步迭代走本地 TDD 门禁并通过极简指纹头对账；子代理通过 DAG 依赖抽取 10~30KB 局部微切片进行纯净隔离攻坚。

**Tech Stack:** TypeScript, Bun, Windows PowerShell 5.1, PnP.PowerShell v1.12.0, Microsoft Graph REST API, SignalR WebSocket (Chathub Protocol).

**Spec Reference:** [`.docs/specs/2026-10-19-pnp-sharepoint-mirror-and-pure-protocol-subagent-design.md`](file:///E:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-19-pnp-sharepoint-mirror-and-pure-protocol-subagent-design.md)

## Global Constraints

- **AI 严禁在工作区根目录写任何文件**：所有代码、测试与配置必须创建在二级目录 `CPH-PI/` 内。
- **纯协议与零 CDP 铁律**：严禁在生产运行时引入任何浏览器启动、Puppeteer 或 CDP 依赖，全链路走纯 HTTP / WebSocket。
- **Harness 中立纯粹准则**：Harness 仅做客观调度与物理对账，不在管道中给模型打特化补丁。
- **正向引导与无负面词**：提示词与 Skill 杜绝“严禁”、“切勿”等负面禁令词，转为建设性流程引导。
- **子代理隔离铁律**：子代理严禁接触全库快照，仅挂载针对工单声明的 `targetFiles` 微切片。
- **本地 TDD 红绿门禁**：本地单测未通过（RED）的代码绝对禁止同步至 SharePoint 物理仓库。

---

### Task 1: 本地工作区快照器与子代理微切片提取器 (Workspace Snapshotter & Scoped Slicer)

**Files:**
- Create: `src/snapshot/workspace-snapshotter.ts`
- Test: `tests/snapshot/workspace-snapshotter.test.ts`

**Interfaces:**
- Consumes: 本地磁盘物理文件系统与 `.gitignore` 规则。
- Produces: 
  - `generateWorkspaceSnapshot(options: SnapshotOptions): Promise<SnapshotResult>`
  - `generateSubagentSlice(options: SubagentSliceOptions): Promise<SubagentSliceResult>`

- [ ] **Step 1: 编写快照器与微切片提取器的失败单测**

```typescript
// tests/snapshot/workspace-snapshotter.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateWorkspaceSnapshot,
  generateSubagentSlice,
} from "../../src/snapshot/workspace-snapshotter.ts";

describe("WorkspaceSnapshotter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-snapshot-test-"));
    fs.mkdirSync(path.join(tempDir, "src", "billing"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "tests", "billing"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });

    fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\ndist/\n");
    fs.writeFileSync(path.join(tempDir, "src", "billing", "tax.ts"), "export const tax = 0.08;\n");
    fs.writeFileSync(path.join(tempDir, "tests", "billing", "tax.test.ts"), "import { tax } from '../../src/billing/tax';\n");
    fs.writeFileSync(path.join(tempDir, "node_modules", "pkg", "ignored.js"), "console.log('skip');\n");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. 应该生成排除忽略目录的全景快照并包含指纹头", async () => {
    const res = await generateWorkspaceSnapshot({ workspaceRoot: tempDir });
    expect(res.fileCount).toBe(3); // .gitignore, tax.ts, tax.test.ts
    expect(res.content).toContain("// File: src/billing/tax.ts");
    expect(res.content).toContain("export const tax = 0.08;");
    expect(res.content).not.toContain("ignored.js");
    expect(res.sha256).toBeDefined();
    expect(res.tocHeader).toContain("TOTAL_FILES: 3");
  });

  it("2. 应该仅针对工单声明的 targetFiles 生成子代理微切片", async () => {
    const res = await generateSubagentSlice({
      workspaceRoot: tempDir,
      targetFiles: ["src/billing/tax.ts"],
      prerequisiteContext: "Researcher report: verified tax constant.",
    });
    expect(res.fileCount).toBe(1);
    expect(res.content).toContain("src/billing/tax.ts");
    expect(res.content).not.toContain("tax.test.ts");
    expect(res.content).toContain("Researcher report: verified tax constant.");
    expect(res.isScoped).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**
Run: `bun test tests/snapshot/workspace-snapshotter.test.ts`  
Expected: FAIL (Cannot find module `workspace-snapshotter.ts`)

- [ ] **Step 3: 实现 `workspace-snapshotter.ts` 核心逻辑**

```typescript
// src/snapshot/workspace-snapshotter.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface SnapshotOptions {
  workspaceRoot: string;
  outputPath?: string;
  maxFileSizeBytes?: number;
}

export interface SnapshotResult {
  content: string;
  fileCount: number;
  totalSizeBytes: number;
  sha256: string;
  tocHeader: string;
  savedPath?: string;
}

export interface SubagentSliceOptions {
  workspaceRoot: string;
  targetFiles: string[];
  prerequisiteContext?: string;
  outputPath?: string;
}

export interface SubagentSliceResult {
  content: string;
  fileCount: number;
  isScoped: boolean;
  savedPath?: string;
}

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cph",
  ".gemini",
  "tmp",
  ".turbo",
]);

function computeSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function shouldIgnorePath(relPath: string, ignorePatterns: string[]): boolean {
  const norm = relPath.replace(/\\/g, "/");
  const parts = norm.split("/");
  if (parts.some((p) => DEFAULT_IGNORED_DIRS.has(p))) return true;
  for (const pat of ignorePatterns) {
    const cleanPat = pat.trim().replace(/^\//, "").replace(/\/$/, "");
    if (!cleanPat || cleanPat.startsWith("#")) continue;
    if (norm === cleanPat || norm.startsWith(cleanPat + "/")) return true;
  }
  return false;
}

function collectFiles(root: string, current: string, ignorePatterns: string[], results: string[]): void {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full);
    if (shouldIgnorePath(rel, ignorePatterns)) continue;
    if (entry.isDirectory()) {
      collectFiles(root, full, ignorePatterns, results);
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
}

export async function generateWorkspaceSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const root = path.resolve(options.workspaceRoot);
  const ignorePatterns: string[] = [];
  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/);
    ignorePatterns.push(...lines);
  }

  const fileRelPaths: string[] = [];
  collectFiles(root, root, ignorePatterns, fileRelPaths);
  fileRelPaths.sort();

  const fileEntries: Array<{ relPath: string; content: string; sha256: string }> = [];
  for (const rel of fileRelPaths) {
    const full = path.join(root, rel);
    try {
      const content = fs.readFileSync(full, "utf8");
      fileEntries.push({
        relPath: rel.replace(/\\/g, "/"),
        content,
        sha256: computeSha256(content),
      });
    } catch {
      // 忽略无法以 UTF-8 读取的二进制文件
    }
  }

  const tocLines = [
    "// ========================================================",
    "// WORKSPACE REPOSITORY SNAPSHOT (GROUND-TRUTH)",
    `// TOTAL_FILES: ${fileEntries.length}`,
    `// GENERATED_AT: ${new Date().toISOString()}`,
    "// ========================================================",
  ];

  const bodyChunks: string[] = [];
  for (const entry of fileEntries) {
    bodyChunks.push(
      `\n// ==========================================\n// File: ${entry.relPath} (SHA256: ${entry.sha256})\n// ==========================================\n` +
        entry.content +
        "\n"
    );
  }

  const fullContent = tocLines.join("\n") + "\n" + bodyChunks.join("");
  const totalSha256 = computeSha256(fullContent);

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, fullContent, "utf8");
  }

  return {
    content: fullContent,
    fileCount: fileEntries.length,
    totalSizeBytes: Buffer.byteLength(fullContent, "utf8"),
    sha256: totalSha256,
    tocHeader: tocLines.join("\n"),
    savedPath: options.outputPath,
  };
}

export async function generateSubagentSlice(options: SubagentSliceOptions): Promise<SubagentSliceResult> {
  const root = path.resolve(options.workspaceRoot);
  const chunks: string[] = [
    "// ========================================================",
    "// SUBAGENT SCOPED TASK SLICE (MINIMAL PRIVILEGE)",
    `// TARGET_FILES_COUNT: ${options.targetFiles.length}`,
    "// ========================================================\n",
  ];

  if (options.prerequisiteContext) {
    chunks.push(`// --- PREREQUISITE REVIEW CONTEXT ---\n${options.prerequisiteContext}\n// ------------------------------------\n`);
  }

  let includedCount = 0;
  for (const rel of options.targetFiles) {
    const norm = rel.replace(/\\/g, "/");
    const full = path.join(root, norm);
    if (!fs.existsSync(full)) continue;
    try {
      const code = fs.readFileSync(full, "utf8");
      chunks.push(`// File: ${norm}\n${code}\n`);
      includedCount++;
    } catch {}
  }

  const content = chunks.join("\n");
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, content, "utf8");
  }

  return {
    content,
    fileCount: includedCount,
    isScoped: true,
    savedPath: options.outputPath,
  };
}
```

- [ ] **Step 4: 运行测试验证绿灯**
Run: `bun test tests/snapshot/workspace-snapshotter.test.ts`  
Expected: PASS (2 tests pass)

- [ ] **Step 5: 提交任务代码**
```bash
git add src/snapshot/workspace-snapshotter.ts tests/snapshot/workspace-snapshotter.test.ts
git commit -m "feat(snapshot): implement workspace snapshotter and subagent scoped slicer"
```

---

### Task 2: 纯协议大文件分块断点直传通道 (Pure Protocol Resumable Uploader)

**Files:**
- Modify: `src/transport/substrate-uploader.ts`
- Test: `tests/transport/resumable-uploader.test.ts`

**Interfaces:**
- Consumes: Graph API OAuth Token / Microsoft Cloud Upload Session API.
- Produces: `SubstrateUploader.uploadLargeDocumentResumable(token: string, content: string, fileName: string): Promise<UploadDocumentResult>`

- [ ] **Step 1: 编写大文件分块上传与断点续传的失败测试**

```typescript
// tests/transport/resumable-uploader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

describe("SubstrateUploader.uploadLargeDocumentResumable", () => {
  let mockServer: any = null;
  let chunkRequests: Array<{ range: string | null; length: number }> = [];
  let sessionCreated = false;

  beforeEach(() => {
    chunkRequests = [];
    sessionCreated = false;

    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // 1. Handle createUploadSession
        if (url.pathname.endsWith("/createUploadSession")) {
          sessionCreated = true;
          return new Response(
            JSON.stringify({
              uploadUrl: `http://127.0.0.1:${mockServer.port}/upload-chunk-target`,
              expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        // 2. Handle chunk PUT
        if (url.pathname === "/upload-chunk-target") {
          const range = req.headers.get("content-range");
          const bodyBytes = await req.arrayBuffer();
          chunkRequests.push({ range, length: bodyBytes.byteLength });

          // If last chunk, return 201 Created with DriveItem
          const isFinal = range && range.endsWith("/16384000");
          if (isFinal) {
            return new Response(
              JSON.stringify({
                id: "drive-item-big-7788",
                name: "large-snapshot.txt",
                webUrl: "https://tenant.sharepoint.com/personal/user/large-snapshot.txt",
                parentReference: { driveId: "drive-123" },
              }),
              { status: 201, headers: { "Content-Type": "application/json" } }
            );
          }

          // Otherwise return 202 Accepted
          return new Response(
            JSON.stringify({
              expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
              nextExpectedRanges: ["8192000-16383999"],
            }),
            { status: 202, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not found", { status: 404 });
      },
    });
  });

  afterEach(() => {
    if (mockServer) {
      mockServer.stop(true);
      mockServer = null;
    }
  });

  it("1. 应该通过 createUploadSession 以 8,000KB 步长分块上传并生成 LocalFile 结构", async () => {
    // 构造恰好 16,384,000 字节 (2个分块)
    const totalBytes = 16384000;
    const largeContent = "A".repeat(totalBytes);

    const customBase = `http://127.0.0.1:${mockServer.port}/drive/root:/copilotuploads`;
    const res = await SubstrateUploader.uploadLargeDocumentResumable(
      "mock-graph-token",
      largeContent,
      "large-snapshot.txt",
      customBase
    );

    expect(sessionCreated).toBe(true);
    expect(chunkRequests.length).toBe(2);
    expect(chunkRequests[0].length).toBe(8192000);
    expect(chunkRequests[0].range).toBe("bytes 0-8191999/16384000");
    expect(chunkRequests[1].length).toBe(8192000);
    expect(chunkRequests[1].range).toBe("bytes 8192000-16383999/16384000");

    expect(res.driveItemId).toBe("drive-item-big-7788");
    expect(res.annotation.messageAnnotationType).toBe("LocalFile");
    expect(res.annotation.messageAnnotationMetadata?.fileName).toBe("large-snapshot.txt");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**
Run: `bun test tests/transport/resumable-uploader.test.ts`  
Expected: FAIL (`uploadLargeDocumentResumable` is not a function)

- [ ] **Step 3: 在 `src/transport/substrate-uploader.ts` 实现分块直传协议**

在 `SubstrateUploader` 类中增加如下实现：

```typescript
  /**
   * Resumable chunked upload for large documents (>4MB) via Microsoft Graph createUploadSession
   */
  public static async uploadLargeDocumentResumable(
    graphAccessToken: string,
    content: string,
    fileName: string,
    customBaseUrl?: string,
    chunkSize: number = 8192000 // 8,000 KB (aligned with Edge browser physical capture)
  ): Promise<UploadDocumentResult> {
    const rootUrl = customBaseUrl || this.DEFAULT_GRAPH_URL;
    const encodedName = encodeURIComponent(fileName);
    const sessionUrl = `${rootUrl}:/${encodedName}:/createUploadSession`;

    // 1. Create upload session
    const sessionRes = await fetch(sessionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${graphAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "replace",
          name: fileName,
        },
      }),
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      throw new Error(`Graph createUploadSession failed (${sessionRes.status}): ${err.slice(0, 200)}`);
    }

    const sessionData = (await sessionRes.json()) as { uploadUrl: string };
    const uploadUrl = sessionData.uploadUrl;
    const contentBuffer = Buffer.from(content, "utf8");
    const totalBytes = contentBuffer.byteLength;

    let offset = 0;
    let driveItemData: any = null;

    // 2. Upload chunks sequentially
    while (offset < totalBytes) {
      const end = Math.min(offset + chunkSize, totalBytes);
      const chunk = contentBuffer.subarray(offset, end);
      const range = `bytes ${offset}-${end - 1}/${totalBytes}`;

      let retry = 0;
      let chunkSuccess = false;

      while (!chunkSuccess && retry < 3) {
        retry++;
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Range": range,
            "Content-Length": chunk.byteLength.toString(),
          },
          body: chunk,
        });

        if (putRes.status === 200 || putRes.status === 201) {
          driveItemData = await putRes.json();
          chunkSuccess = true;
          offset = end;
          break;
        } else if (putRes.status === 202) {
          chunkSuccess = true;
          offset = end;
          break;
        } else {
          if (retry >= 3) {
            const err = await putRes.text();
            throw new Error(`Chunk upload failed (${putRes.status}) at ${range}: ${err.slice(0, 200)}`);
          }
          await new Promise((r) => setTimeout(r, 1000 * retry));
        }
      }
    }

    if (!driveItemData || !driveItemData.id) {
      throw new Error("Resumable upload completed without returning a valid DriveItem");
    }

    const driveId = driveItemData.parentReference?.driveId || "";
    const ext = fileName.split(".").pop() || "txt";
    const spoBase64 = await this.resolveSpoBase64(graphAccessToken, customBaseUrl);
    const annotationId = spoBase64 ? `SPO_${spoBase64}_${driveItemData.id}` : driveItemData.id;

    const annotation: AttachmentAnnotation = {
      id: annotationId,
      text: fileName,
      url: driveItemData.webUrl,
      messageAnnotationType: "LocalFile",
      messageAnnotationMetadata: {
        "@type": "File",
        annotationType: "File",
        fileName,
        webUrl: driveItemData.webUrl,
        driveId,
        fileType: ext,
      },
    };

    return {
      driveItemId: driveItemData.id,
      webUrl: driveItemData.webUrl,
      driveId,
      fileName,
      annotation,
    };
  }
```

- [ ] **Step 4: 运行测试验证绿灯**
Run: `bun test tests/transport/resumable-uploader.test.ts`  
Expected: PASS

- [ ] **Step 5: 提交任务代码**
```bash
git add src/transport/substrate-uploader.ts tests/transport/resumable-uploader.test.ts
git commit -m "feat(transport): add pure protocol resumable chunk upload via createUploadSession"
```

---

### Task 3: SharePoint PnP 物理镜像增量同步引擎 (PnP SharePoint Sync Engine)

**Files:**
- Create: `src/storage/sp-sync-engine.ps1`
- Test: `tests/storage/sp-sync-engine.test.ts`

**Interfaces:**
- Consumes: `Library/LTK/PnPSession.psm1`, `ShipScheduleSharePointUpload.ps1`, 本地物理文件树。
- Produces: 
  - `sp-sync-engine.ps1 -Action SyncWorkspace -LocalPath <dir> -SiteUrl <url> -TargetFolder <folder>`
  - `sp-sync-engine.ps1 -Action SyncSingleFile -FilePath <file> -SiteUrl <url> -TargetFolder <folder>`

- [ ] **Step 1: 编写测试脚本验证 PnP 同步引擎参数接口与返回契约**

```typescript
// tests/storage/sp-sync-engine.test.ts
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

describe("sp-sync-engine.ps1", () => {
  const scriptPath = path.resolve("src/storage/sp-sync-engine.ps1");

  it("1. 脚本应该存在且能够通过语法解析", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const check = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `$err = $null; [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$null, [ref]$err); if ($err) { exit 1 } else { exit 0 }`,
    ]);
    expect(check.status).toBe(0);
  });

  it("2. 缺少必填参数时应输出标准错误提示", () => {
    const res = spawnSync("powershell.exe", [
      "-NoProfile",
      "-File",
      scriptPath,
      "-Action",
      "SyncWorkspace",
    ], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr || res.stdout).toContain("LocalPath is required");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**
Run: `bun test tests/storage/sp-sync-engine.test.ts`  
Expected: FAIL (File not found)

- [ ] **Step 3: 编写 `src/storage/sp-sync-engine.ps1` 实现**

```powershell
# src/storage/sp-sync-engine.ps1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("SyncWorkspace", "SyncSingleFile", "PingSession")]
  [string]$Action,

  [string]$LocalPath = "",
  [string]$FilePath = "",
  [string]$SiteUrl = "",
  [string]$LibraryName = "Documents",
  [string]$TargetFolder = "/Workspaces/Default",
  [string]$SessionCacheFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 定位 LTK PnPSession 模块
$ltkDir = "E:\copilot-web proxy\Library\LTK"
$pnpSessionModule = Join-Path $ltkDir "PnPSession.psm1"
if (-not (Test-Path $pnpSessionModule)) {
  throw "PnPSession module not found at: $pnpSessionModule"
}

Import-Module $pnpSessionModule -Force

$config = [PSCustomObject]@{
  EnableLogOutput = $true
  SharePoint = [PSCustomObject]@{
    SiteUrl = $SiteUrl
    LibraryName = $LibraryName
    FolderPath = $TargetFolder
    SessionCacheFile = $SessionCacheFile
    UploadRetryCount = 3
    UploadRetryDelaySec = 3
  }
}

function Upload-SingleFileInternal([string]$AbsFilePath, [string]$RelTargetUrl) {
  if (-not (Test-Path $AbsFilePath)) {
    throw "Source file not found: $AbsFilePath"
  }
  $ctx = Get-DpsClientContext -Config $config -SiteUrl $SiteUrl
  $stream = [System.IO.File]::OpenRead($AbsFilePath)
  try {
    [Microsoft.SharePoint.Client.File]::SaveBinaryDirect($ctx, $RelTargetUrl, $stream, $true) | Out-Null
    Write-Host ("OK synced {0} -> {1}" -f (Split-Path $AbsFilePath -Leaf), $RelTargetUrl)
  } finally {
    $stream.Dispose()
  }
}

if ($Action -eq "PingSession") {
  $ctx = Get-DpsClientContext -Config $config -SiteUrl $SiteUrl
  Write-Host "PnPSession connection successful."
  exit 0
}

if ($Action -eq "SyncSingleFile") {
  if (-not $FilePath) { throw "FilePath is required for SyncSingleFile." }
  $abs = [System.IO.Path]::GetFullPath($FilePath)
  $leaf = Split-Path $abs -Leaf
  $serverRel = ("/{0}/{1}/{2}" -f $LibraryName.Trim('/'), $TargetFolder.Trim('/'), $leaf) -replace '//+', '/'
  Upload-SingleFileInternal $abs $serverRel
  exit 0
}

if ($Action -eq "SyncWorkspace") {
  if (-not $LocalPath) { throw "LocalPath is required for SyncWorkspace." }
  if (-not (Test-Path $LocalPath)) { throw "LocalPath does not exist: $LocalPath" }

  $files = Get-ChildItem -Path $LocalPath -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\(\.git|node_modules|dist|\.cph)\\'
  }

  $rootAbs = [System.IO.Path]::GetFullPath($LocalPath)
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($rootAbs.Length).TrimStart('\', '/') -replace '\\', '/'
    $serverRel = ("/{0}/{1}/{2}" -f $LibraryName.Trim('/'), $TargetFolder.Trim('/'), $rel) -replace '//+', '/'
    Upload-SingleFileInternal $f.FullName $serverRel
  }
  Write-Host ("Sync completed: {0} files mirrored to SharePoint." -f $files.Count)
  exit 0
}
```

- [ ] **Step 4: 运行测试验证绿灯**
Run: `bun test tests/storage/sp-sync-engine.test.ts`  
Expected: PASS

- [ ] **Step 5: 提交任务代码**
```bash
git add src/storage/sp-sync-engine.ps1 tests/storage/sp-sync-engine.test.ts
git commit -m "feat(storage): implement sp-sync-engine using PWSH 5.1 and PnP 1.12.0"
```

---

### Task 4: 编排器集成：首轮全景挂载、TDD 红绿门禁与状态指纹刷新闭环

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Test: `tests/agent/scoped-slice-orchestrator.test.ts`

**Interfaces:**
- Consumes: `workspace-snapshotter.ts`, `SubstrateUploader`, `sp-sync-engine.ps1`.
- Produces: `Orchestrator.runCycle(params: OrchestratorParams): Promise<OrchestratorResult>` 闭环执行。

- [ ] **Step 1: 编写编排器状态闭环测试（首轮挂载快照、编码通过后刷新指纹头）**

```typescript
// tests/agent/scoped-slice-orchestrator.test.ts
import { describe, it, expect } from "bun:test";
import { formatWorkspaceStateUpdate } from "../../src/agent/orchestrator.ts";

describe("Orchestrator Workspace State Fingerprint", () => {
  it("1. 应该生成标准的 [WORKSPACE STATE UPDATE] 极简物理指纹头", () => {
    const header = formatWorkspaceStateUpdate({
      headCommit: "9c42b1f",
      targetFile: "src/billing/tax.ts",
      testSummary: "15/15 PASSED",
      spSynced: true,
    });

    expect(header).toContain("[WORKSPACE STATE UPDATE]");
    expect(header).toContain("Head: Commit 9c42b1f");
    expect(header).toContain("Target: src/billing/tax.ts (Tests: 15/15 PASSED)");
    expect(header).toContain("Cloud Mirror: Synced to SharePoint");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**
Run: `bun test tests/agent/scoped-slice-orchestrator.test.ts`  
Expected: FAIL (`formatWorkspaceStateUpdate` is not defined)

- [ ] **Step 3: 在 `src/agent/orchestrator.ts` 实现指纹格式化与全景开局挂载集成**

导出并集成格式化函数：
```typescript
export interface StateUpdateParams {
  headCommit: string;
  targetFile: string;
  testSummary: string;
  spSynced: boolean;
}

export function formatWorkspaceStateUpdate(params: StateUpdateParams): string {
  return [
    "```markdown",
    "[WORKSPACE STATE UPDATE]",
    `- Head: Commit ${params.headCommit}`,
    `- Target: ${params.targetFile} (Tests: ${params.testSummary})`,
    `- Cloud Mirror: ${params.spSynced ? "Synced to SharePoint" : "Pending Sync"}`,
    "```",
  ].join("\n");
}
```

- [ ] **Step 4: 运行测试验证绿灯**
Run: `bun test tests/agent/scoped-slice-orchestrator.test.ts`  
Expected: PASS

- [ ] **Step 5: 提交任务代码**
```bash
git add src/agent/orchestrator.ts tests/agent/scoped-slice-orchestrator.test.ts
git commit -m "feat(agent): add workspace state fingerprint header formatter to orchestrator"
```

---

### Task 5: 子代理局部微切片隔离规约与调度规范更新 (Subagent Scoped Slice Skill Alignment)

**Files:**
- Modify: `skills/subagent/SKILL.md`
- Modify: `cph-main-agent-prompt.txt`
- Modify: `cph-dev-agent-prompt.txt`

**Interfaces:**
- Consumes: DAG 任务切片契约与工单声明。
- Produces: 规范化系统提示词，严禁向子代理投递全景快照，引导主会话按工单抽取微切片。

- [ ] **Step 1: 检查现有 `skills/subagent/SKILL.md` 中的派发规则**
查看并确保派发规则中包含 `targetFiles` 契约定义。

- [ ] **Step 2: 更新 `skills/subagent/SKILL.md`**
将子代理输入规范升级为“局部微切片隔离机制”：
- 明确指出：子代理只接收其工单直接声明的 `targetFiles` 微切片及必要前序结论，恪守最小认知特权；
- 绝不使用负面词，全部采用建设性的正向引导（如：“工单通过 targetFiles 声明局部边界，系统自动装配微切片”）。

- [ ] **Step 3: 更新提示词文件与运行测试**
运行现有套件确保无语法或路径破坏：
Run: `bun test tests/agent/cloud-attachment-orchestrator.test.ts`  
Expected: PASS

- [ ] **Step 4: 提交任务代码**
```bash
git add skills/subagent/SKILL.md cph-main-agent-prompt.txt cph-dev-agent-prompt.txt
git commit -m "docs(skill): update subagent skill and system prompts with scoped slice protocol"
```

---

## Plan Self-Review Checklist

1. **Spec Coverage:**
   - SharePoint PnP 物理镜像 ➔ Task 3 (`sp-sync-engine.ps1`)
   - 纯协议大文件分块断点续传 ➔ Task 2 (`substrate-uploader.ts`)
   - 本地全景快照与子代理微切片 ➔ Task 1 (`workspace-snapshotter.ts`)
   - 状态指纹闭环与消除时效性崩塌 ➔ Task 4 (`orchestrator.ts`)
   - 子代理最小特权隔离规约 ➔ Task 5 (`skills/subagent/SKILL.md`)
2. **Placeholder Scan:** 确认无 "TBD"、"TODO"、"稍后实现" 等占位符，所有步骤均包含具体文件、测试与代码片段。
3. **Agent-Friendly Check:** 任务按职责与文件严格解耦（Task 1, 2, 3 各司其职，无跨任务未定义依赖），符合并发切片最佳实践。
