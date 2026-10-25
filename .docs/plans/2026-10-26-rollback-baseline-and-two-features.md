# 回滚到 30d22da 基线并重放两个功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CPH-PI 行为回滚到 `30d22da` 好版本基线，并以最小补丁加入“文件链接自动落盘”和“目录清单附件化（补充式）”两个功能，同时修掉云端 URL 映射与契约脱节的必要缺陷。

**Architecture:** 先在干净分支重建 `30d22da` 行为基线；功能一以独立 `LandingService` 隔离落盘逻辑，只在 `FINAL_ANSWER` 与 `write_file(url)` 两个钩子接入；功能二保留内联映射表并加 24KB 上限，把完整清单作为 per-account 附件补充挂载；两者均由独立 feature flag 控制，可单独回退。

**Tech Stack:** Bun 1.4.x、TypeScript、Node 22、PowerShell 5.1/7（同步脚本）、`adm-zip`（新增）、Copilot ChatHub WebSocket、SharePoint CSOM/Graph。

**Spec:** `.docs/specs/2026-10-26-rollback-baseline-and-two-features-design.md`

## Global Constraints

- 行为基线：`30d22da`。除本计划列出的改动外，不修改其提示词措辞、技能内容、工具协议与读取顺序。
- 两个功能开关：`enableAutoLanding`（默认 true）、`enableWorkspaceCatalog`（默认 true）、`enableBoundedRepoMap`（默认 true）；任一关闭即回到基线行为。
- 内联索引硬上限：`CPH_TURN1_INDEX_MAX_CHARS` 默认 `24000` 字符。
- 下载路径永不自动执行；`autoExecute` 默认 `false`。
- 落盘默认 `overwrite: false`；关键文件 deny list 只对下载/解压落盘生效。
- 相对基线无新增测试失败；`tests/scripts/sp-sync-engine.test.ts` 的 Windows ACL 断言按环境 quarantine。
- 所有提示词/技能改动必须同步 `package/agent-bundle/`（规则 11）。
- 中文文案遵循 AGENTS.md 准则 3：使用正向引导，不使用“严禁/切勿/不要”类负面禁词。

---

## 冲击面扫描

| 制品 | 上游（谁生产） | 下游（谁消费） | 风险 | 对应任务 |
|---|---|---|---|---|
| `PromptBuilder` 输出 | `Orchestrator.run` | Copilot 模型 | 首轮提示词体积/内容变化影响读取行为 | Task 10、11 |
| `sync-manifest.json` 的 `serverRelativeUrl` | `sp-sync-engine.ps1` | `generateVirtualRepoMap`、catalog、prompt | 旧 URL 导致索引失真 | Task 2 |
| `FilePorter` 接口 | `ToolBridge`、新 `LandingService` | orchestrator、测试 | 新增 `fetchAndDeliver` 不能破坏 `saveAndExecute` | Task 4 |
| `TokenManager` | `AccountPool` | FilePorter IC3 下载 | 新增 IC3 方法不得影响现有 Graph/refresh 流程 | Task 5 |
| `ResilientParser` 优先级 | orchestrator | FINAL_ANSWER / action 分支 | 链接误判为 action | Task 3、6 |
| `Orchestrator` 主循环 | Web/CLI | UI 事件、session 持久化 | 新增钩子影响收敛/回执 | Task 6、9、12 |
| `skills/*` 与 bundle | 仓库文件 | Copilot 侧 Agent | 提示词与 Harness 能力脱节 | Task 11 |
| `.cph/state/workspace-catalog-cache.json` | orchestrator 上传 | 下一轮附件复用 | 跨账号串用 | Task 9 |
| `package/agent-bundle/*.zip` | `bun run package` | 用户上传 M365 | 提示词与 bundle 不一致 | Task 11 |

---

## Task 1: 保全现场并回滚到 30d22da 基线

**Files:**
- Create: `.docs/reports/2026-10-26-pre-rollback-wip.md`
- Create: `.docs/reports/2026-10-26-baseline-test-report.md`
- Git: 当前分支 WIP 提交 + tag；新分支 `fix/rollback-30d22da-plus-features` 从 `30d22da`

**Interfaces:**
- Consumes: 无
- Produces: 干净基线工作区；`baseline/30d22da-behavior` tag；基线测试报告（后续“无新增失败”判据）

- [ ] **Step 1: 检查是否有 CPH-PI 进程占用（避免切换分支时写文件）**

Run:
```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess
```
Expected: 无输出（若输出，记录 PID 并提示用户后仅继续读取，不 kill）。

- [ ] **Step 2: WIP 保全提交**

Run:
```powershell
git add -A
git commit -m "wip: preserve pre-rollback workspace (incl. two prior remediation attempts)"
git tag wip/pre-rollback-20261026
git show --stat --oneline wip/pre-rollback-20261026 | Select-Object -First 40
```
Expected: 提交成功；tag 存在。

- [ ] **Step 3: 写 WIP 摘要报告**

Run:
```powershell
New-Item -ItemType Directory -Force .docs/reports | Out-Null
git show --stat --oneline wip/pre-rollback-20261026 | Out-File -Encoding utf8 .docs/reports/2026-10-26-pre-rollback-wip.md
```
Expected: 文件存在。

- [ ] **Step 4: 创建干净修复分支**

Run:
```powershell
git checkout -b fix/rollback-30d22da-plus-features 30d22da
git tag baseline/30d22da-behavior
git status --porcelain
```
Expected: 工作区干净；分支基于 `30d22da`。

- [ ] **Step 5: 把本计划与设计规格带回新分支**

Run:
```powershell
git checkout wip/pre-rollback-20261026 -- .docs/specs/2026-10-26-rollback-baseline-and-two-features-design.md .docs/plans/2026-10-26-rollback-baseline-and-two-features.md .docs/reports/2026-10-26-pre-rollback-wip.md
git status --porcelain
```
Expected: 三个文件出现在 `??`/`A` 列表；工作区其他文件干净。

- [ ] **Step 6: 安装依赖并跑基线测试**

Run:
```powershell
bun install
bun test tests/ 2>&1 | Tee-Object -FilePath .docs/reports/2026-10-26-baseline-test-raw.txt
```
Expected: 记录 pass/fail 数；已知唯一失败允许为 `tests/scripts/sp-sync-engine.test.ts` 的 ACL 断言（若存在其他失败，必须先记录并修正基线理解，再继续）。

- [ ] **Step 7: 生成基线测试报告**

把 Step 6 的统计写入 `.docs/reports/2026-10-26-baseline-test-report.md`，格式：

```markdown
# 30d22da 基线测试报告
- 运行时间: <ISO>
- bun test tests/ 结果: <pass> pass / <fail> fail / <total> tests
- 已知环境失败: <列表或 none>
- bun run package: <成功/失败>
```

- [ ] **Step 8: 验证打包基线**

Run:
```powershell
bun run package
Test-Path package/agent-bundle/copilot-agent-bundle.zip
```
Expected: `True`。

- [ ] **Step 9: 提交基线与报告**

Run:
```powershell
git add .docs/
git commit -m "chore(baseline): restore 30d22da behavior baseline with rollback evidence"
```

---

## Task 2: 修复 sync manifest 的 URL 刷新（云端映射失真）

**Files:**
- Modify: `scripts/sp-sync-engine.ps1`（`SyncWorkspace` 分支的 SKIP 逻辑，基线约 616-640 行）
- Test: `tests/scripts/sp-sync-engine.test.ts`（基线文件，新增用例）

**Interfaces:**
- Consumes: `Get-SyncManifest`、`Get-SharePointCloudEntities`（返回 `files[rel]` 带 `ServerRelativeUrl`）
- Produces: `SyncFileResult.serverRelativeUrl` 始终属于当前 `TargetFolder`；manifest 在 SKIP 时被刷新

- [ ] **Step 1: 写失败测试**

在 `tests/scripts/sp-sync-engine.test.ts` 增加用例 `refreshes stale serverRelativeUrl on skip`：
- 构造 manifest：`targetFolder` 为 `.../test_workspace`，一条文件记录 `serverRelativeUrl` 指向 `.../test/Library/a.ps1`，sha256 与本地一致；
- mock 云端实体：同一相对路径的 `ServerRelativeUrl` 指向 `.../test_workspace/Library/a.ps1`；
- 执行 `SyncWorkspace`（沿用该测试文件已有的 `MockTransport`/本地 HTTP mock 方式）；
- 断言：返回结果 `status === "skipped"` 且 `serverRelativeUrl` 包含 `test_workspace`；manifest 文件被刷新。

Run:
```powershell
bun test tests/scripts/sp-sync-engine.test.ts
```
Expected: 新用例 FAIL（当前逻辑保留旧 URL）。

- [ ] **Step 2: 改 SKIP 分支**

把基线约 617-630 行：

```powershell
                if ($cloudFiles.ContainsKey($norm)) {
                    $cf = $cloudFiles[$norm]
                    if ($cf) {
                        if ($cf.UniqueId -and (-not $existing.uniqueId -or $existing.uniqueId -like 'guid-*')) {
                            $existing["uniqueId"] = $cf.UniqueId.ToString()
                        }
                        if ($cf.ServerRelativeUrl -and (-not $existing.serverRelativeUrl)) {
                            $existing["serverRelativeUrl"] = [string]$cf.ServerRelativeUrl
                        }
                    }
                }
```

改为：

```powershell
                if ($cloudFiles.ContainsKey($norm)) {
                    $cf = $cloudFiles[$norm]
                    if ($cf) {
                        if ($cf.UniqueId -and (-not $existing.uniqueId -or $existing.uniqueId -like 'guid-*')) {
                            $existing["uniqueId"] = $cf.UniqueId.ToString()
                        }
                        # 云端实体是当前 TargetFolder 的唯一真相：URL 不一致时刷新，避免工作区迁移后指向旧目录
                        if ($cf.ServerRelativeUrl -and ($existing.serverRelativeUrl -ne [string]$cf.ServerRelativeUrl)) {
                            $existing["serverRelativeUrl"] = [string]$cf.ServerRelativeUrl
                        }
                    }
                }
```

- [ ] **Step 3: 跑测试确认通过**

Run:
```powershell
bun test tests/scripts/sp-sync-engine.test.ts
```
Expected: PASS（含新用例）。

- [ ] **Step 4: 对 `E:\test_workspace` 做一次真实 sync 并校验 URL**

基线没有 `pnp-sync-cli.ts`，用引擎现有方法跑一次对账（读取工作区 `.cph/config.json` 的 `cloudWorkspace`）：

```powershell
cd 'E:\copilot-web proxy\CPH-PI'
@'
import fs from "node:fs";
import { PnPWorkspaceSyncEngine } from "./src/workspace/pnp-sync-engine.ts";
const cfg = JSON.parse(fs.readFileSync("E:/test_workspace/.cph/config.json", "utf8"));
const engine = new PnPWorkspaceSyncEngine();
const report = await engine.syncCloudWorkspace({
  workspaceRoot: "E:/test_workspace",
  siteUrl: cfg.cloudWorkspace.siteUrl,
  targetFolder: cfg.cloudWorkspace.targetFolder,
});
console.log(JSON.stringify({ synced: report.syncedCount, skipped: report.skippedCount, pruned: report.prunedCount, failed: report.failedCount }));
'@ | Set-Content -Encoding utf8 scripts/_tmp_sync_once.ts
bun run scripts/_tmp_sync_once.ts
Remove-Item scripts/_tmp_sync_once.ts
```

执行后校验：

```powershell
$m = Get-Content 'E:\test_workspace\.cph\state\sync-manifest.json' -Raw | ConvertFrom-Json
$bad = $m.files.PSObject.Properties | Where-Object { $_.Value.serverRelativeUrl -and $_.Value.serverRelativeUrl -notmatch 'test_workspace' }
"stale=$($bad.Count) total=$($m.files.PSObject.Properties.Count)"
```
Expected: `stale=0`。

- [ ] **Step 5: 提交**

```powershell
git add scripts/sp-sync-engine.ps1 tests/scripts/sp-sync-engine.test.ts
git commit -m "fix(sync): refresh manifest serverRelativeUrl when cloud URL drifts after workspace relocation"
```

---

## Task 3: DeliverablesParser（交付段解析）

**Files:**
- Create: `src/protocol/deliverables-parser.ts`
- Test: `tests/protocol/deliverables-parser.test.ts`

**Interfaces:**
- Consumes: `FINAL_ANSWER` 原始文本
- Produces:

```ts
export interface DeliverableItem {
  destinationPath: string; // 工作区相对路径；以 / 结尾表示目录目标
  fileName: string;        // 展示名，缺省取 URL basename
  url: string;             // 下载链接
  isZipTarget: boolean;    // destinationPath 以 .zip 结尾
}

export class DeliverablesParser {
  static parse(raw: string): DeliverableItem[];
}
```

- [ ] **Step 1: 写失败测试**

`tests/protocol/deliverables-parser.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";

const section = (body: string) =>
  `FINAL_ANSWER: 完成\n\n【交付文件与落盘指引 / Deliverables】\n${body}\n\n# 报告\n正文`;

describe("DeliverablesParser", () => {
  test("parses backtick path with left arrow", () => {
    const items = DeliverablesParser.parse(section("- `test/review.md` <- [review.md](https://x.test/a.md)"));
    expect(items).toHaveLength(1);
    expect(items[0].destinationPath).toBe("test/review.md");
    expect(items[0].url).toBe("https://x.test/a.md");
    expect(items[0].isZipTarget).toBe(false);
  });

  test("parses directory target with right arrow", () => {
    const items = DeliverablesParser.parse(section("- `test/` -> [bundle.zip](https://x.test/b.zip)"));
    expect(items[0].destinationPath).toBe("test/");
    expect(items[0].isZipTarget).toBe(false);
  });

  test("marks .zip target", () => {
    const items = DeliverablesParser.parse(section("- `test/bundle.zip` <- [b.zip](https://x.test/b.zip)"));
    expect(items[0].isZipTarget).toBe(true);
  });

  test("ignores non-deliverable markdown links outside the section", () => {
    const items = DeliverablesParser.parse("FINAL_ANSWER: 见 [文档](https://x.test/a.md)");
    expect(items).toHaveLength(0);
  });

  test("rejects path traversal", () => {
    const items = DeliverablesParser.parse(section("- `../evil.sh` <- [e](https://x.test/e.sh)"));
    expect(items).toHaveLength(0);
  });
});
```

Run: `bun test tests/protocol/deliverables-parser.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现解析器**

`src/protocol/deliverables-parser.ts`：

```ts
import path from "node:path";

export interface DeliverableItem {
  destinationPath: string;
  fileName: string;
  url: string;
  isZipTarget: boolean;
}

const SECTION_RE = /【交付文件与落盘指引\s*\/\s*Deliverables】|^#{1,3}\s*Deliverables\b/im;
const LINE_RE = /^\s*[-*]\s*`([^`]+)`\s*(?:<-|->|←|→|<=|=>|:)\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

export class DeliverablesParser {
  static parse(raw: string): DeliverableItem[] {
    if (!raw || !SECTION_RE.test(raw)) return [];
    const items: DeliverableItem[] = [];
    const seen = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(LINE_RE);
      if (!m) continue;
      const dest = m[1].trim().replace(/\\/g, "/");
      const url = m[3].trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const normalized = path.posix.normalize(dest);
      if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) continue;
      const key = `${normalized}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        destinationPath: normalized,
        fileName: m[2].trim() || decodeURIComponent(new URL(url).pathname.split("/").pop() || "download.bin"),
        url,
        isZipTarget: normalized.toLowerCase().endsWith(".zip"),
      });
    }
    return items;
  }
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `bun test tests/protocol/deliverables-parser.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/protocol/deliverables-parser.ts tests/protocol/deliverables-parser.test.ts
git commit -m "feat(protocol): add DeliverablesParser for structured landing declarations"
```

---

## Task 4: FilePorter 升级（下载/解压/鉴权/安全）

**Files:**
- Modify: `src/transport/file-porter.ts`（以 `de2fd20` 版本为参考移植）
- Modify: `package.json`（新增 `adm-zip`，`@types/adm-zip` 可选）
- Create/Modify: `tests/transport/file-porter.test.ts`

**Interfaces:**
- Consumes: `ic3TokenProvider?: () => Promise<string | undefined>`、`graphTokenProvider?`
- Produces:

```ts
export interface DeliverToWorkspaceParams {
  downloadUrl: string;
  destinationPath: string; // 工作区相对路径
  isDirectory?: boolean;
  isZip?: boolean;
}
export interface DeliverToWorkspaceResult {
  landedFiles: string[];   // 工作区相对路径
  extractedFromZip: boolean;
}
export class FilePorter {
  async fetchAndDeliver(params: DeliverToWorkspaceParams): Promise<DeliverToWorkspaceResult>;
  async saveAndExecute(params: SaveAndExecuteParams): Promise<FilePorterResult>; // 保持基线签名
}
```

- [ ] **Step 1: 写失败测试**

`tests/transport/file-porter.test.ts`（若基线已有同名文件则追加）：

```ts
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilePorter } from "../../src/transport/file-porter.ts";

function tmpWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-"));
  return root;
}

describe("FilePorter.fetchAndDeliver", () => {
  test("downloads http text to declared path with token header", async () => {
    const root = tmpWorkspace();
    const calls: any[] = [];
    const mockFetch = (async (url: string, init?: any) => {
      calls.push({ url, init });
      return new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
    }) as any;
    const porter = new FilePorter({ cwd: root, fetchFn: mockFetch });
    const res = await porter.fetchAndDeliver({
      downloadUrl: "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/original",
      destinationPath: "test/report.md",
      ic3Token: "tok",
    } as any);
    expect(res.landedFiles).toEqual(["test/report.md"]);
    expect(fs.readFileSync(path.join(root, "test/report.md"), "utf-8")).toBe("hello");
    expect(calls[0].url).toContain("asyncgw");
  });

  test("rejects non-allowlisted host", async () => {
    const root = tmpWorkspace();
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => new Response("x")) as any });
    await expect(
      porter.fetchAndDeliver({ downloadUrl: "http://127.0.0.1/secret", destinationPath: "a.txt" } as any)
    ).rejects.toThrow(/host/i);
  });

  test("extracts zip directory target and blocks traversal", async () => {
    const root = tmpWorkspace();
    // 用 adm-zip 在内存生成 zip 字节（含安全条目）
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("a/b.txt", Buffer.from("ok"));
    const bytes = zip.toBuffer();
    const porter = new FilePorter({
      cwd: root,
      fetchFn: (async () => new Response(bytes, { status: 200 })) as any,
    });
    const res = await porter.fetchAndDeliver({
      downloadUrl: "https://x.sharepoint.com/files/b.zip",
      destinationPath: "test/",
    } as any);
    expect(res.extractedFromZip).toBe(true);
    expect(res.landedFiles).toContain("test/a/b.txt");
  });

  test("refuses to overwrite existing file by default", async () => {
    const root = tmpWorkspace();
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "test", "a.md"), "old");
    const porter = new FilePorter({ cwd: root, fetchFn: (async () => new Response("new")) as any });
    await expect(
      porter.fetchAndDeliver({ downloadUrl: "https://x.sharepoint.com/a.md", destinationPath: "test/a.md" } as any)
    ).rejects.toThrow(/exists/i);
  });
});
```

Run: `bun test tests/transport/file-porter.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 2: 移植 `de2fd20` 的 FilePorter 实现**

```powershell
git checkout de2fd20 -- src/transport/file-porter.ts
```
若 HEAD 的测试文件存在则一并取用；不存在则以 Step 1 的用例为准补全。保留 `saveAndExecute` 以兼容 `ToolBridge`。

- [ ] **Step 3: 增加依赖并安装**

```powershell
bun add adm-zip@^0.6.1
bun add -d @types/adm-zip@^0.6.0
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/transport/file-porter.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add package.json bun.lock src/transport/file-porter.ts tests/transport/file-porter.test.ts
git commit -m "feat(transport): port hardened FilePorter with IC3 auth, host allowlist, and safe zip extraction"
```

---

## Task 5: IC3 下载 token

**Files:**
- Modify: `src/auth/token-manager.ts`
- Test: `tests/auth/ic3-token.test.ts`

**Interfaces:**
- Consumes: 现有 `TokenManager` 的 refresh 流程
- Produces:

```ts
export const IC3_SCOPE = "openid profile offline_access https://ic3.teams.office.com/.default";
// on TokenManager
async getIc3AccessToken(email?: string): Promise<string | undefined>;
setCachedIc3Token(email: string, token: string, expiresAt?: number): void;
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { TokenManager } from "../../src/auth/token-manager.ts";

describe("IC3 token", () => {
  test("returns cached token", async () => {
    const tm = new TokenManager();
    tm.setCachedIc3Token("A@x.com", "cached", Date.now() + 600_000);
    expect(await tm.getIc3AccessToken("a@x.com")).toBe("cached");
  });
});
```

Run: `bun test tests/auth/ic3-token.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 2: 移植 `de2fd20` 的 IC3 增量**

```powershell
git diff 30d22da de2fd20 -- src/auth/token-manager.ts
```
只移植 `IC3_SCOPE`、`ic3Tokens` map、`getIc3AccessToken`、`setCachedIc3Token` 与对应 fetch 逻辑（均为新增方法），不改既有 refresh/Graph 方法。注意基线 `TokenManager` 没有这些符号。

- [ ] **Step 3: 跑测试**

Run: `bun test tests/auth/`
Expected: PASS，且基线 auth 测试不回归。

- [ ] **Step 4: 提交**

```powershell
git add src/auth/token-manager.ts tests/auth/ic3-token.test.ts
git commit -m "feat(auth): add per-account IC3 access token for generated-file downloads"
```

---

## Task 6: LandingService + Orchestrator 钩子

**Files:**
- Create: `src/delivery/landing-service.ts`
- Modify: `src/agent/orchestrator.ts`（`FINAL_ANSWER` 分支、`write_file` 分支）
- Modify: `src/protocol/resilient-parser.ts`（FINAL_ANSWER 优先级）
- Modify: `src/protocol/prompt-builder.ts`（`buildFileSavedAndSyncedReceipt`）
- Test: `tests/delivery/landing-service.test.ts`、`tests/protocol/resilient-parser-deliverables.test.ts`

**Interfaces:**
- Consumes: `DeliverablesParser.parse`、`FilePorter.fetchAndDeliver`、`PnPWorkspaceSyncEngine.syncFile`
- Produces:

```ts
export interface LandingResult {
  landed: Array<{ relPath: string; cloudUrl?: string; status: "landed" | "failed"; error?: string }>;
  status: "ok" | "partial" | "failed";
}
export class LandingService {
  constructor(opts: {
    workspaceRoot: string;
    filePorter: FilePorter;
    syncFile: (relPath: string) => Promise<{ status: string; serverRelativeUrl?: string } | null>;
  });
  async landDeliverables(items: DeliverableItem[]): Promise<LandingResult>;
}
```

- [ ] **Step 1: 写失败测试（LandingService）**

```ts
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LandingService } from "../../src/delivery/landing-service.ts";

test("lands items and reports cloud sync", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cph-landing-"));
  const synced: string[] = [];
  const service = new LandingService({
    workspaceRoot: root,
    filePorter: { fetchAndDeliver: async (p: any) => ({ landedFiles: [p.destinationPath], extractedFromZip: false }) } as any,
    syncFile: async (rel: string) => {
      synced.push(rel);
      return { status: "synced", serverRelativeUrl: `https://sp/${rel}` };
    },
  });
  const res = await service.landDeliverables([
    { destinationPath: "test/r.md", fileName: "r.md", url: "https://x.test/r.md", isZipTarget: false },
  ]);
  expect(res.status).toBe("ok");
  expect(res.landed[0]).toMatchObject({ relPath: "test/r.md", status: "landed", cloudUrl: "https://sp/test/r.md" });
  expect(synced).toEqual(["test/r.md"]);
});
```

Run: `bun test tests/delivery/landing-service.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现 LandingService**

```ts
import path from "node:path";
import type { DeliverableItem } from "../protocol/deliverables-parser.ts";
import type { FilePorter } from "../transport/file-porter.ts";

export interface LandingResult {
  landed: Array<{ relPath: string; cloudUrl?: string; status: "landed" | "failed"; error?: string }>;
  status: "ok" | "partial" | "failed";
}

export class LandingService {
  private workspaceRoot: string;
  private filePorter: FilePorter;
  private syncFile: (relPath: string) => Promise<{ status: string; serverRelativeUrl?: string } | null>;

  constructor(opts: {
    workspaceRoot: string;
    filePorter: FilePorter;
    syncFile: (relPath: string) => Promise<{ status: string; serverRelativeUrl?: string } | null>;
  }) {
    this.workspaceRoot = opts.workspaceRoot;
    this.filePorter = opts.filePorter;
    this.syncFile = opts.syncFile;
  }

  async landDeliverables(items: DeliverableItem[]): Promise<LandingResult> {
    const landed: LandingResult["landed"] = [];
    for (const item of items) {
      try {
        const dest = item.destinationPath.endsWith("/") ? item.destinationPath : item.destinationPath;
        const res = await this.filePorter.fetchAndDeliver({
          downloadUrl: item.url,
          destinationPath: dest,
          isDirectory: dest.endsWith("/"),
          isZip: item.isZipTarget || dest.endsWith("/"),
        } as any);
        for (const rel of res.landedFiles) {
          let cloudUrl: string | undefined;
          try {
            const sync = await this.syncFile(rel);
            cloudUrl = sync?.serverRelativeUrl;
          } catch {}
          landed.push({ relPath: rel, cloudUrl, status: "landed" });
        }
      } catch (err: any) {
        landed.push({ relPath: item.destinationPath, status: "failed", error: String(err?.message || err) });
      }
    }
    const failed = landed.filter((l) => l.status === "failed").length;
    return {
      landed,
      status: failed === 0 ? "ok" : failed === landed.length ? "failed" : "partial",
    };
  }
}
```

- [ ] **Step 3: 接 Orchestrator FINAL_ANSWER 钩子**

先在 orchestrator 上补两个基线缺失的辅助方法与开关（构造参数 `enableAutoLanding ?? true`）：

```ts
public async acquireIc3Token(email?: string): Promise<string | undefined> {
  if (this.pool && typeof (this.pool as any).getIc3AccessToken === "function") {
    try { return await (this.pool as any).getIc3AccessToken(email || this.activeAccountEmail); } catch { return undefined; }
  }
  return undefined;
}

private resolveCloudTarget(): { siteUrl: string; targetFolder: string } {
  const manifest = PnPWorkspaceSyncEngine.loadManifest(
    path.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json")
  );
  return {
    siteUrl: manifest?.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL,
    targetFolder: manifest?.targetFolder || PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER,
  };
}
```

在基线 `orchestrator.ts` 的 `parsed.type === "final_answer"` 分支中，`onCompleted` 之前插入：

```ts
let deliveryResult: LandingResult | null = null;
try {
  const items = DeliverablesParser.parse(parsed.answer.raw || parsed.answer.summary || "");
  if (items.length > 0 && this.enableAutoLanding) {
    const target = this.resolveCloudTarget();
    const landing = new LandingService({
      workspaceRoot: this.workspaceRoot,
      filePorter: new FilePorter({
        cwd: this.workspaceRoot,
        ic3TokenProvider: () => this.acquireIc3Token(this.activeAccountEmail),
      }),
      syncFile: async (rel) => {
        const res = await new PnPWorkspaceSyncEngine().syncFile(
          this.workspaceRoot, rel, target.targetFolder, { siteUrl: target.siteUrl }
        );
        return res ? { status: res.status, serverRelativeUrl: res.serverRelativeUrl } : null;
      },
    });
    deliveryResult = await landing.landDeliverables(items);
  }
} catch (err) { /* 记录 delivery-report.json，不阻断 */ }
```

并把 `deliveryResult` 写入 `.cph/state/delivery-report.json` 与 `onCompleted` 的 `deliveryStatus` 字段（若接口不允许，先写日志）。

- [ ] **Step 4: 接 `write_file(url)` 钩子**

在 `write_file` 动作处理中：若 `action.url` 存在，走 `LandingService` 单条落盘；成功回执用 `PromptBuilder.buildFileSavedAndSyncedReceipt`，失败回执说明原因。

- [ ] **Step 5: 修 Parser 优先级**

`resilient-parser.ts`：
- `FINAL_ANSWER` 分支先于 2c；
- 2c 只匹配显式 `<a download>` 与 `blob:` URL；普通 Markdown `http(s)` 链接不再生成 `file_porter`。

- [ ] **Step 6: 跑测试**

Run: `bun test tests/delivery/ tests/protocol/`
Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add src/delivery/landing-service.ts src/agent/orchestrator.ts src/protocol/resilient-parser.ts src/protocol/prompt-builder.ts tests/delivery tests/protocol
git commit -m "feat(delivery): auto-land FINAL_ANSWER deliverables and write_file(url) with cloud sync receipts"
```

---

## Task 7: 交付契约提示词与能力登记

**Files:**
- Modify: `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`package/agent-bundle/` 镜像
- Create: `.docs/capability-registry.md`
- Test: `tests/skills/tri-agent-prompts.test.ts`（基线文件，追加断言）

**Interfaces:**
- Consumes: Task 3/6 的格式与回执
- Produces: 提示词包含 `【交付文件与落盘指引 / Deliverables】`、`<-` 格式、zip 语义；bundle 同步

- [ ] **Step 1: 在 Main/Coder 提示词加入正向交付契约**

文案（Main 提示词"分析、审查与诊断任务"小节内新增一行；Coder 同理）：

```markdown
- 若在终局产出文件，在 `FINAL_ANSWER` 最顶部声明【交付文件与落盘指引 / Deliverables】完成结题，系统会自动下载落盘并同步至云端：
  - 格式：`- \`<相对路径>\` <- [文件名](<下载链接>)`
  - `.zip` 目标以 `.zip` 结尾时原样保存；以目录结尾时解压到该目录。
```

- [ ] **Step 2: 同步 bundle 镜像**

Run:
```powershell
bun run package
```
校验 `package/agent-bundle/Instructions-Main-主协调智能体.txt` 与源文件包含同一交付契约。

- [ ] **Step 3: 写能力登记表**

`.docs/capability-registry.md`：

```markdown
# Capability Registry

| 能力 | 提示词登记 | Harness 实现 | 测试 |
|---|---|---|---|
| 文件链接自动落盘 | `cph-main-agent-prompt.txt` 交付契约 | `src/delivery/landing-service.ts` + `FilePorter.fetchAndDeliver` | `tests/delivery/landing-service.test.ts` |
| 目录清单附件（补充） | `prompt-builder` 首轮事实区 | `ensureWorkspaceCatalogAttachment` | `tests/agent/catalog-attachment.test.ts` |
| 内联索引上限 | `prompt-builder` | `buildBoundedRepoMap` | `tests/protocol/prompt-builder.test.ts` |
```

- [ ] **Step 4: 契约测试**

在 `tests/skills/tri-agent-prompts.test.ts` 增加：
```ts
expect(mainPrompt).toContain("交付文件与落盘指引");
expect(mainPrompt).toContain("<-");
```

Run: `bun test tests/skills/tri-agent-prompts.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add cph-main-agent-prompt.txt cph-coder-agent-prompt.txt package/agent-bundle .docs/capability-registry.md tests/skills/tri-agent-prompts.test.ts
git commit -m "feat(prompt): register deliverables landing contract and capability registry"
```

---

## Task 8: Catalog 生成（文件系统为准 + 状态列 + 正确 URL）

**Files:**
- Modify: `src/workspace/pnp-sync-engine.ts`（**新增** `generateCatalogMarkdown`；基线不存在该函数）
- Test: `tests/workspace/catalog.test.ts`

**Interfaces:**
- Consumes: 工作区文件系统、`sync-manifest.json`、`CloudTarget`
- Produces:

```ts
export interface CatalogStats {
  totalFiles: number; syncedIndexable: number; localOnly: number; unindexable: number;
}
export class PnPWorkspaceSyncEngine {
  static generateCatalogMarkdown(workspaceRoot: string, opts?: { manifestPath?: string }): { markdown: string; stats: CatalogStats };
}
```

- [ ] **Step 1: 写失败测试**

构造临时工作区（3 个文件 + manifest 中 2 条记录，其中一条 URL 属于旧目录）：
- 断言 markdown 含 `## 1. 目录结构` 与 `## 2. 文件映射清单`；
- 断言 2 条记录 URL 属于当前 targetFolder、1 条 `LOCAL-ONLY`；
- 断言统计行 `工作区文件 3 | 已同步可索引 2 | 本地独有 1`。

Run: `bun test tests/workspace/catalog.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现生成器**

要点：
- 枚举：`git ls-files --cached --others --exclude-standard`（子进程失败则 `fs.readdir` 递归）+ `Library/**` 补充；
- 状态：manifest 有记录且 URL 属于当前 targetFolder → `CLOUD-READY`；有记录但 URL 不属于 → 重新拼当前 URL（并提示 `SYNCED-STALE` 待同步）；无记录 → `LOCAL-ONLY`；二进制 → `CLOUD-UNINDEXABLE`；
- URL：优先 manifest；否则 `${siteUrl}/${targetFolder}/${encodeURI(relPath)}`，其中 `siteUrl` 去掉尾部 `/`，`targetFolder` 去首尾 `/`；
- 目录树：2 层，目录后写文件数；
- 分片：`markdown` 超过 200KB 或 2000 行时返回前 N 条并写 `catalog-part-*.md`（由调用方处理）。

- [ ] **Step 3: 跑测试**

Run: `bun test tests/workspace/catalog.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/workspace/pnp-sync-engine.ts tests/workspace/catalog.test.ts
git commit -m "feat(catalog): generate workspace catalog from filesystem with sync status and current URLs"
```

---

## Task 9: Catalog 附件挂载（per-account）

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Modify: `src/transport/substrate-uploader.ts`（如需 per-account 参数）
- Test: `tests/agent/catalog-attachment.test.ts`

**Interfaces:**
- Consumes: `generateCatalogMarkdown`、`SubstrateUploader.uploadDocumentToOneDrive`
- Produces:

```ts
async ensureWorkspaceCatalogAttachment(email: string): Promise<AttachmentAnnotation | null>;
```

- [ ] **Step 1: 写失败测试**

mock 上传器与 graph token：
- 首次调用：上传 1 次，返回 annotation，cache 写入 `entries[email].hash`；
- 同 email 同 hash：不重复上传；
- 换 email：重新上传；
- 换号事件：旧 annotation 从 `currentAnnotations` 移除。

Run: `bun test tests/agent/catalog-attachment.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现**

- catalog 写入 `.cph/state/remote-workspace-catalog.md`；
- cache 路径 `.cph/state/workspace-catalog-cache.json`，结构 `{ entries: { [emailLower]: { hash, uploadResult, updatedAt } } }`；
- 上传走当前账号 Graph token（`acquireGraphToken(email)`，基线已有类似方法则复用）；
- Turn 1 把 annotation push 到 `currentAnnotations`；429 换号后先过滤旧账号 annotation 再重挂；
- 失败时写 `.cph/state/upload-error.log`，不阻断任务。

- [ ] **Step 3: 跑测试**

Run: `bun test tests/agent/catalog-attachment.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/agent/orchestrator.ts src/transport/substrate-uploader.ts tests/agent/catalog-attachment.test.ts
git commit -m "feat(agent): attach per-account workspace catalog and reattach on account switch"
```

---

## Task 10: 有界内联索引（24KB）

**Files:**
- Modify: `src/protocol/prompt-builder.ts`
- Modify: `src/workspace/pnp-sync-engine.ts`（新增 `buildBoundedRepoMap`）
- Test: `tests/protocol/prompt-builder-bounded-map.test.ts`

**Interfaces:**
- Consumes: 工作区文件系统、manifest、环境变量 `CPH_TURN1_INDEX_MAX_CHARS`
- Produces:

```ts
export interface BoundedRepoMapOptions {
  workspaceRoot: string;
  task?: string;
  maxChars?: number;
}
export function buildBoundedRepoMap(opts: BoundedRepoMapOptions): string;
```

- [ ] **Step 1: 写失败测试**

- 20 个文件的小工作区：输出包含全部路径与 URL，长度 < maxChars；
- 2000 个文件（临时生成）：输出长度 ≤ maxChars，含 `其余` 截断提示，且任务前缀 `Library/proj/` 的文件排在最前；
- 目录骨架始终存在。

Run: `bun test tests/protocol/prompt-builder-bounded-map.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现**

- 解析任务中的 SharePoint URL：`new URL(task)` 的 `id` 参数解码，取 `/WorkSpace/<targetFolder>/<prefix>` 后的 `<prefix>`；再匹配工作区相对路径前缀；
- 排序键：`inScope(0/1)` → `isSource(0/1)` → `mtime desc` → `path asc`；
- 逐行格式化：`- ${rel} (${sizeKB}KB | [${status}] | ${url})`；
- 超限：保留目录骨架 + 前 N 行 + `...（其余 ${rest} 个文件见附件 remote-workspace-catalog.md）`；
- 注入 `buildTurn1Prompt`（替换原 `repoMapSection`）、`buildDirectAgentPrompt`、`buildReGroundingPrompt`；
- 在首轮事实区追加一段正向说明：

```markdown
- 工作区目录与云端文件索引: 内联为精简版；完整清单见随本轮消息挂载的附件【remote-workspace-catalog.md】（含 2 层目录树与逐文件直链）。
```

- 若本轮未挂载 catalog 附件（未启用/上传失败），该行写为“完整清单暂不可用，按需 `read_file` 探查”，避免承诺不存在的东西。

- [ ] **Step 3: 跑测试**

Run: `bun test tests/protocol/prompt-builder-bounded-map.test.ts tests/protocol/prompt-builder.test.ts`
Expected: PASS；既有 prompt-builder 测试不回归（必要时更新旧断言）。

- [ ] **Step 4: 提交**

```powershell
git add src/protocol/prompt-builder.ts src/workspace/pnp-sync-engine.ts tests/protocol
git commit -m "feat(prompt): bounded inline repo map with task scoping and 24KB cap"
```

---

## Task 11: 技能/提示词对齐与 bundle

**Files:**
- Modify: `skills/handoff/SKILL.md`、`skills/subagent/SKILL.md`、`package/agent-bundle/` 镜像
- Modify: `cph-dev-agent-prompt.txt`（`workspace-v1.txt` 承诺）
- Test: `tests/skills/skill-registry.test.ts`（或新增契约测试）

**Interfaces:**
- Consumes: Task 8/9/10 的 catalog 与内联映射表能力
- Produces: 四板块命名一致；bundle 与源文件一致

- [ ] **Step 1: 更新技能文案**

`skills/handoff` 与 `skills/subagent`：
- 把“`[SHAREPOINT REMOTE WORKSPACE]` 映射表”统一为“内联 `[SHAREPOINT REMOTE WORKSPACE]` 映射表与 `remote-workspace-catalog.md` 完整清单附件”；
- 保留原有正向引导句式，不新增负面禁词。

`cph-dev-agent-prompt.txt`：
- 第 7、73 行的 `workspace-v1.txt` 承诺改为“通过 `read_file` 按需读取，或查阅本轮挂载的 `remote-workspace-catalog.md`”。

- [ ] **Step 2: 重新打包并校验**

```powershell
bun run package
Select-String -Path package/agent-bundle/skills/handoff/SKILL.md -Pattern 'remote-workspace-catalog'
Select-String -Path package/agent-bundle/cph-dev-agent-prompt.txt -Pattern 'workspace-v1'
```
Expected: 第一处有输出；第二处无输出（或只出现"不再依赖"说明）。

- [ ] **Step 3: 契约测试**

新增/追加测试：检查 `skills/handoff/SKILL.md`、`skills/subagent/SKILL.md`、`cph-main-agent-prompt.txt`、`cph-dev-agent-prompt.txt`、bundle 镜像两两一致（对关键短语做断言）。

Run: `bun test tests/skills/`
Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add skills cph-dev-agent-prompt.txt package/agent-bundle tests/skills
git commit -m "docs(skills): align handoff, subagent, and dev prompt with catalog attachment and bounded map"
```

---

## Task 12: 契约加固（诚实回退/无进展保护/调试指纹/回执字段）

**Files:**
- Modify: `src/cli.ts`（`ask_question` 回退文案）
- Modify: `src/agent/orchestrator.ts`（无进展保护、调试指纹）
- Modify: `src/protocol/prompt-builder.ts`（回执字段）
- Test: `tests/agent/no-progress-guard.test.ts`、`tests/cli/ask-question-fallback.test.ts`

**Interfaces:**
- Consumes: 现有 orchestrator 循环与 TerminalLogger
- Produces: 重复失败动作被拦截；debug 日志含 `effectiveAgentId/promptHash/attachments/toolCallCount`；回执含 `source/status/freshness`

- [ ] **Step 1: 写失败测试（无进展保护）**

mock 一个总是返回同一失败 action 的 chat client：
- 第一次失败：继续；
- 第二次同指纹失败：返回纠正提示（断言提示文本包含“该动作已连续失败”）；
- 第三次：中止该动作（断言不再执行超过 3 次）。

Run: `bun test tests/agent/no-progress-guard.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现无进展保护**

在 orchestrator 循环中维护 `lastActionFingerprint`：
```ts
const fp = `${action.tool}:${JSON.stringify(action.args ?? action)}`;
if (fp === this.lastFailedActionFp) {
  this.repeatFailCount += 1;
} else {
  this.lastFailedActionFp = fp;
  this.repeatFailCount = 1;
}
if (this.repeatFailCount >= 2 && failed) {
  currentPrompt = "[SYSTEM NOTICE: 该动作已连续失败，请改用其他路径/工具，或输出 FINAL_ANSWER 说明阻塞点]";
  continue;
}
if (this.repeatFailCount >= 3) {
  // 中止该动作，回执说明后允许模型总结
}
```

- [ ] **Step 3: `ask_question` 诚实回退**

`src/cli.ts` 中 `"[Non-interactive fallback: Auto-confirmed default]"` 改为：

```ts
return "[QUESTION_UNAVAILABLE] 当前通道无法交互。请基于现有信息继续推进；若存在关键待确认点，请在 FINAL_ANSWER 中明确列出。";
```

测试断言字符串与行为。

- [ ] **Step 4: 回执字段与调试指纹**

- `buildToolResultPrompt` / `buildAttachedToolResultPrompt` / `buildFileSavedAndSyncedReceipt` 输出追加：
  `source: local|cloud-attachment`、`status: success|failed|attached`、`freshness: just-written|synced|unknown`。
- debug 模式下每轮 `console.debug`：`[CPH-FINGERPRINT] agentId=... promptHash=... attachments=... toolCalls=...`。

- [ ] **Step 5: 跑测试**

Run: `bun test tests/agent/no-progress-guard.test.ts tests/cli/ask-question-fallback.test.ts tests/protocol/`
Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/cli.ts src/agent/orchestrator.ts src/protocol/prompt-builder.ts tests/agent tests/cli
git commit -m "fix(agent): honest question fallback, no-progress guard, and debug fingerprints"
```

---

## Task 13: 全量验证、打包与验收准备

**Files:**
- Create: `.docs/reports/2026-10-26-rollback-fix-test-report.md`
- Create: `.docs/reports/2026-10-26-live-acceptance-checklist.md`

**Interfaces:**
- Consumes: 前面所有任务
- Produces: 测试绿、bundle 就绪、验收清单

- [ ] **Step 1: 全量测试**

Run:
```powershell
bun test tests/ 2>&1 | Tee-Object -FilePath .docs/reports/2026-10-26-final-test-raw.txt
```
Expected: 相对基线无新增失败。

- [ ] **Step 2: 类型/构建**

```powershell
bunx tsc --noEmit 2>&1 | Select-Object -Last 20
bun run package
```
Expected: 无新增类型错误；bundle zip 生成。

- [ ] **Step 3: Web 服务冒烟**

```powershell
$p = Start-Process -FilePath "bun" -ArgumentList "run","src/cli.ts","web" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000 -TimeoutSec 5).StatusCode } finally { Stop-Process -Id $p.Id -Force }
```
Expected: `200`（若端口被占则记录实际端口）。

- [ ] **Step 4: 写测试报告与验收清单**

`2026-10-26-rollback-fix-test-report.md` 记录：pass/fail、build、冒烟结果、与基线对比。
`2026-10-26-live-acceptance-checklist.md`：

```markdown
# 真实任务验收清单（需要用户执行）
1. 上传 `package/agent-bundle/copilot-agent-bundle.zip` 到 M365（Main/Coder Agent 指令 + skills）。
2. 启动 `bun run src/cli.ts web`，工作区选 E:\test_workspace。
3. 提交任务：/thermo-nuclear-code-quality-review + 原 SharePoint 目录，输出到 E:\test_workspace\test。
4. 记录：Turn1 本地扫描次数、收敛轮次、catalog 附件是否出现、报告是否落盘、云端同步回执。
5. 对照目标：本地扫描 ≤1、轮次 ≤3、catalog 链接属于 test_workspace、报告落盘成功。
```

- [ ] **Step 5: 提交**

```powershell
git add .docs/reports
git commit -m "docs(verification): record rollback fix test results and live acceptance checklist"
```

---

## Task 14: 收尾交付

**Files:**
- Create: `.docs/reports/2026-10-26-rollback-fix-summary.md`

- [ ] **Step 1: 汇总分支、commit、测试、bundle、回滚方法**

包含：基线 tag、WIP tag、修复分支、功能开关、如何回退、如何上传 bundle、已知限制（真实任务验收待用户执行）。

- [ ] **Step 2: 最终自查**

- `git status --porcelain` 干净；
- `git log --oneline baseline/30d22da-behavior..HEAD` 可读；
- `package/agent-bundle/copilot-agent-bundle.zip` 存在且提示词含交付契约。

- [ ] **Step 3: 提交并汇报**

```powershell
git add .docs/reports
git commit -m "docs: summarize rollback baseline restoration and two-feature replay"
```
