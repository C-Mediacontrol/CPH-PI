# 云端工作区目录双轨对齐与拓扑生命周期实施计划 (Cloud Workspace Folder Dual-Track Sync Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建文件与目录独立双轨对齐的 SharePoint 工作区镜像体系，彻底解决本地空文件夹在云端被误删、本地新建空文件夹无法上云的问题，达成云端与本地 1:1 严格镜像。

**Architecture:** 
1. **双轨采集与状态解耦**: `Get-LocalFolders`（集成 Git 忽略）与 `Get-SharePointCloudEntities`（过滤系统保留目录）分别提取目录实体；`SyncManifest` 升级 v2 引入 `folders` 映射字典。
2. **三阶段拓扑流水线**: 
   - 阶段 1: 自顶向下（Top-Down，浅层优先）在云端补齐本地存在的目录（包括纯空目录）；
   - 阶段 2: 保持既有文件数据增量对齐与孤儿文件回收；
   - 阶段 3: 自底向上（Bottom-Up，深层优先）执行双门禁孤儿目录回收（门禁 1: 本地必须不存在；门禁 2: 云端必须无文件与子目录）。
3. **独立目录操作与地图感知**: `EnsureFolder` / `syncFolder()` 接口与 `generateVirtualRepoMap()` 空目录可视化。

**Tech Stack:** PowerShell 5.1, Microsoft SharePoint CSOM, TypeScript, Bun Test, node:fs, node:path.

## Global Constraints

- **AGENTS.md Rule 1 (Harness Neutrality & Root Isolation):** 所有代码、测试与文档改动均位于 `CPH-PI/` 目录下，工作区根目录零文件写入。
- **AGENTS.md Rule 3 (Constructive Guidance):** 全程贯彻建设性正向引导，杜绝使用负面禁止词。
- **AGENTS.md Rule 5 (Workspace Packaging):** 专注于当前工作区内部演进，隔离并保护用户全局配置。
- **AGENTS.md Rule 7 (Orthogonal Persistence):** 清单文件仅存在于 `.cph/state/sync-manifest.json`，不污染代码库。
- **AGENTS.md Rule 9 (Full Attachment Fidelity):** 保持文件与目录原始字节保真。

---

## 冲击面扫描（Impact Surface Scan）

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 应对策略 |
|---|---|---|---|
| **PowerShell 采集函数** | `Get-LocalFolders`, `Get-SharePointCloudEntities` | `Prewarm`, `SyncWorkspace`, `EnsureFolder` | 目录路径统一标准化为正斜杠 `/`，剥离首尾斜杠；排除 `_` 与 `Forms` 目录。 |
| **状态清单: `sync-manifest.json`** | `sp-sync-engine.ps1`, `PnPWorkspaceSyncEngine` | `VirtualRepoMap`, 增量比对 | 升为 `version: 2` 并新增 `folders` 字典；加载时若为 v1 自动初始化 `folders: {}`，保障向后兼容。 |
| **拓扑回收算法** | `sp-sync-engine.ps1` 阶段 3 | SharePoint 云端回收站 | **修复核心 Bug**：严格施加本地存续硬门禁；若 `$localFolders` 包含该目录，无论云端是否为空，绝对保留！按路径深度降序遍历。 |
| **镜像守卫: `VerifyCloudMirror`** | `sp-sync-engine.ps1` | `RpcHandler`, `pnp-sync-cli.ts` | 检查 `$folder.Files` 与 `$folder.Folders`，修复仅有子目录被误判为全空的缺陷。 |
| **TS 引擎 API: `pnp-sync-engine.ts`** | `PnPWorkspaceSyncEngine.syncFolder` | `RpcHandler`, CLI 脚本 | 新增 `syncFolder` 方法；扩展 `PrewarmReport` 统计字段。 |

---

## Agent-Friendly Slicing 矩阵

| Task | 专注文件 | 对应测试文件 | 提交规范 |
|---|---|---|---|
| **Task 1** | `CPH-PI/scripts/sp-sync-engine.ps1` (采集与 EnsureFolder) | `CPH-PI/tests/scripts/sp-sync-engine.test.ts` | 独立 Commit |
| **Task 2** | `CPH-PI/scripts/sp-sync-engine.ps1` (Prewarm 3 阶段流水线) | `CPH-PI/tests/scripts/sp-sync-engine.test.ts` | 独立 Commit |
| **Task 3** | `CPH-PI/src/workspace/pnp-sync-engine.ts` (TS API 与 Manifest) | `CPH-PI/tests/workspace/pnp-sync-engine.test.ts` | 独立 Commit |
| **Task 4** | `CPH-PI/.docs/CHANGE-REQUEST.md` (全量回归验证与归档) | 全仓全量测试套件 | 独立 Commit |

---

## File Structure

- **修改文件**:
  - `CPH-PI/scripts/sp-sync-engine.ps1`: 增加 `Get-LocalFolders`、`Get-SharePointCloudEntities`、`-Action EnsureFolder`、三阶段流水线及 `VerifyCloudMirror` 修复。
  - `CPH-PI/src/workspace/pnp-sync-engine.ts`: 增加 `FolderManifestEntry`、`SyncFolderResult`、`syncFolder()`、扩展 `PrewarmReport` 及 `generateVirtualRepoMap`。
  - `CPH-PI/tests/scripts/sp-sync-engine.test.ts`: 新增空目录主动同步、防误删守护、自底向上孤儿回收及 EnsureFolder 测试。
  - `CPH-PI/tests/workspace/pnp-sync-engine.test.ts`: 新增 `syncFolder` 及空目录地图感知测试。
  - `CPH-PI/tests/workspace/mirror-guard.test.ts`: 回归验证镜像守卫对目录的判断。
  - `CPH-PI/.docs/CHANGE-REQUEST.md`: 登记 `CR-2026-10-24-02`。

---

### Task 1: PowerShell 物理引擎双轨采集与独立 EnsureFolder Action

**Files:**
- Modify: `CPH-PI/scripts/sp-sync-engine.ps1`
- Test: `CPH-PI/tests/scripts/sp-sync-engine.test.ts`

**Interfaces:**
- Produces: 
  - `Get-LocalFolders -WorkspaceRoot <string>` -> `[hashtable]$localFolders`
  - `Get-SharePointCloudEntities -Context <obj> -TargetFolder <string>` -> `@{ files = @{}; folders = @{} }`
  - `EnsureFolder` Action -> CLI 执行返回标准 JSON，支持 `-SourceFolder <relPath>`

- [ ] **Step 1: 在 `sp-sync-engine.test.ts` 中编写失败测试**

测试 `Get-LocalFolders`（应排除 `.git`, `.cph`, 忽略目录）与 `-Action EnsureFolder`：

```typescript
describe("5. Folder Dual-Track & EnsureFolder Action (Task 1)", () => {
  it("should support -Action EnsureFolder in Mock mode and register into manifest", () => {
    if (!IS_WINDOWS) return;
    const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");

    const res = runPowerShell([
      "-File", SCRIPT_PATH,
      "-Action", "EnsureFolder",
      "-SourceFolder", "src/empty-dir",
      "-WorkspaceRoot", tmpWorkspace,
      "-ManifestPath", manifestPath,
      "-MockTransport",
    ]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[FOLDER-SYNCED] src/empty-dir");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.folders["src/empty-dir"]).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts`
预期: FAIL，因为 `EnsureFolder` 不是合法的 ValidateSet，且 `manifest.folders` 尚未实现。

- [ ] **Step 3: 在 `sp-sync-engine.ps1` 中实现 `Get-LocalFolders`、`Get-SharePointCloudEntities` 与 `EnsureFolder`**

1. 在 `param([ValidateSet(..., 'EnsureFolder'))]` 中加入 `EnsureFolder` 与 `[string]$SourceFolder` 参数。
2. 实现 `Get-LocalFolders`:
```powershell
function Get-LocalFolders {
    param([string]$WorkspaceRoot)
    $localFolders = @{}
    $dirs = Get-ChildItem -Path $WorkspaceRoot -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.FullName -notmatch '(^|[\\/])(\.git|\.cph|node_modules|dist|package|Library)[\\/]'
    }
    foreach ($d in $dirs) {
        $rel = $d.FullName.Substring($WorkspaceRoot.Length).TrimStart('\', '/').Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }
        # 校验 git check-ignore
        try {
            $check = git -C $WorkspaceRoot check-ignore $rel 2>$null
            if ($LASTEXITCODE -eq 0 -and $check) { continue }
        } catch { }
        $localFolders[$rel] = $true
    }
    return $localFolders
}
```
3. 实现 `Get-SharePointCloudEntities`：递归同时采集 `$cloudFiles` 与 `$cloudFolders`，并跳过 `_` 开头及 `Forms` 目录。
4. 在 `switch ($Action)` 中实现 `'EnsureFolder'` 分支，写入 `$manifest.folders`。

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts`
预期: PASS。

- [ ] **Step 5: 提交代码**

```powershell
git add CPH-PI/scripts/sp-sync-engine.ps1 CPH-PI/tests/scripts/sp-sync-engine.test.ts
git commit -m "feat(sync): implement local/cloud folder discovery and EnsureFolder action"
```

---

### Task 2: PowerShell 引擎三阶段拓扑流水线与双门禁安全回收

**Files:**
- Modify: `CPH-PI/scripts/sp-sync-engine.ps1`
- Test: `CPH-PI/tests/scripts/sp-sync-engine.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Get-LocalFolders` 与 `Get-SharePointCloudEntities`
- Produces: 
  - `Prewarm` / `SyncWorkspace` 执行 3 阶段拓扑流水线
  - 核心 Bug 防御：本地存在的空目录在 `$prunedCount > 0` 时绝对保留
  - 自底向上孤儿目录安全回收
  - 修复 `VerifyCloudMirror` 目录计数

- [ ] **Step 1: 在 `sp-sync-engine.test.ts` 中编写失败测试**

编写空目录主动同步、**防误删核心守护**（本地空目录 + 另一文件被删）及自底向上孤儿回收测试：

```typescript
describe("6. Three-Phase Dual-Track Sync Pipeline (Task 2)", () => {
  it("should actively sync local empty folders during Prewarm/SyncWorkspace", () => {
    if (!IS_WINDOWS) return;
    const emptySub = path.join(tmpWorkspace, "components", "empty-box");
    fs.mkdirSync(emptySub, { recursive: true });

    const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
    const res = runPowerShell([
      "-File", SCRIPT_PATH,
      "-Action", "SyncWorkspace",
      "-WorkspaceRoot", tmpWorkspace,
      "-ManifestPath", manifestPath,
      "-MockTransport",
    ]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[FOLDER-SYNCED] components/empty-box");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.folders["components/empty-box"]).toBeDefined();
  });

  it("DEFENSE INVARIANT: should retain local empty folders when other files are pruned", () => {
    if (!IS_WINDOWS) return;
    const emptySub = path.join(tmpWorkspace, "preserved-empty");
    fs.mkdirSync(emptySub, { recursive: true });

    const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
    // 初始运行：写入 emptySub
    runPowerShell([
      "-File", SCRIPT_PATH,
      "-Action", "SyncWorkspace",
      "-WorkspaceRoot", tmpWorkspace,
      "-ManifestPath", manifestPath,
      "-MockTransport",
    ]);

    // 人工在 manifest 中模拟一个孤儿文件，触发 prunedCount > 0
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files["orphan.txt"] = { sha256: "fake", size: 10, uniqueId: "g1" };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    // 第二次运行，触发 pruning
    const res = runPowerShell([
      "-File", SCRIPT_PATH,
      "-Action", "SyncWorkspace",
      "-WorkspaceRoot", tmpWorkspace,
      "-ManifestPath", manifestPath,
      "-MockTransport",
    ]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[PRUNED] orphan.txt");
    // 验证核心不变性：本地存在的空目录绝对不被回收
    expect(res.stdout).not.toContain("[FOLDER-RECYCLED] preserved-empty");
    const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(updated.folders["preserved-empty"]).toBeDefined();
  });

  it("should recycle true orphan folders bottom-up (deepest first)", () => {
    if (!IS_WINDOWS) return;
    const manifestPath = path.join(tmpWorkspace, ".cph", "state", "sync-manifest.json");
    // 模拟云端历史清单存在 a/b/c 嵌套目录，但在本地该目录已被完全删除
    const manifest = {
      version: 2,
      files: {},
      folders: {
        "nested/sub/leaf": { lastSyncedAt: new Date().toISOString() },
        "nested/sub": { lastSyncedAt: new Date().toISOString() },
        "nested": { lastSyncedAt: new Date().toISOString() },
      },
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const res = runPowerShell([
      "-File", SCRIPT_PATH,
      "-Action", "SyncWorkspace",
      "-WorkspaceRoot", tmpWorkspace,
      "-ManifestPath", manifestPath,
      "-MockTransport",
    ]);

    expect(res.status).toBe(0);
    // 验证回收日志包含所有孤儿目录，且从清单中抹除
    const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(updated.folders["nested/sub/leaf"]).toBeUndefined();
    expect(updated.folders["nested/sub"]).toBeUndefined();
    expect(updated.folders["nested"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts`
预期: FAIL。

- [ ] **Step 3: 在 `sp-sync-engine.ps1` 中实现三阶段拓扑流水线**

在 `Prewarm` / `SyncWorkspace` 中：
1. **阶段 1 (Top-Down)**：
   - 提取 `$localFolders = Get-LocalFolders -WorkspaceRoot $WorkspaceRoot`；
   - 按路径深度升序排序 `$localFolders.Keys | Sort-Object { ($_ -split '/').Count }`；
   - 遍历缺失项调用 `Ensure-SharePointFolder`，在 `$manifest.folders` 登记，输出 `[FOLDER-SYNCED]`。
2. **阶段 2 (Files)**：
   - 保持原文件增量流转与孤儿文件回收。
3. **阶段 3 (Bottom-Up Safe Pruning)**：
   - 彻底废除旧版无差别回收代码（原 463~482 行）；
   - 按路径深度降序遍历云端及 Manifest 中孤儿目录候选；
   - 施加硬门禁 1：`if ($localFolders.ContainsKey($folderRel)) { continue }`；
   - 施加硬门禁 2：检查 CSOM `Files.Count == 0 && Folders.Count == 0`；
   - 满足两项门禁后调用 `.Recycle()` 并从 `$manifest.folders` 移除。
4. 修复 `VerifyCloudMirror`：
   - 同时加载 `$folder.Files` 与 `$folder.Folders`，校验文件数与子目录数。

- [ ] **Step 4: 运行测试验证全部通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/scripts/sp-sync-engine.test.ts`
预期: PASS。

- [ ] **Step 5: 提交代码**

```powershell
git add CPH-PI/scripts/sp-sync-engine.ps1 CPH-PI/tests/scripts/sp-sync-engine.test.ts
git commit -m "fix(sync): implement 3-phase topology pipeline and two-gate safe folder pruning"
```

---

### Task 3: TypeScript 引擎与清单 Manifest v2 升级

**Files:**
- Modify: `CPH-PI/src/workspace/pnp-sync-engine.ts`
- Test: `CPH-PI/tests/workspace/pnp-sync-engine.test.ts`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的 PowerShell 行为
- Produces: 
  - `PnPWorkspaceSyncEngine.syncFolder(workspaceRoot, relativePath, ...)`
  - `SyncManifest` v2 结构（带向后兼容）
  - `PrewarmReport` 汇总目录计数
  - `generateVirtualRepoMap` 生成包含空目录的 Markdown

- [ ] **Step 1: 在 `tests/workspace/pnp-sync-engine.test.ts` 中编写失败测试**

测试 `syncFolder` 接口与 `virtual-repo-map` 对空目录的感知渲染：

```typescript
it("should support syncFolder for standalone directory in mock mode", async () => {
  const engine = new PnPWorkspaceSyncEngine();
  const res = await engine.syncFolder(tmpDir, "src/components/empty-widget", undefined, {
    mockTransport: true,
  });
  expect(res.status).toBe("synced");
  expect(res.relativePath).toBe("src/components/empty-widget");
});

it("should generate virtual repo map containing empty directories", () => {
  const manifest: SyncManifest = {
    version: 2,
    files: {
      "README.md": { sha256: "h1", size: 100, uniqueId: "g1" },
    },
    folders: {
      "src/empty-box": { lastSyncedAt: new Date().toISOString() },
    },
  };
  const map = PnPWorkspaceSyncEngine.generateVirtualRepoMap(manifest, "https://site", "/target");
  expect(map).toContain("src/empty-box");
  expect(map).toContain("DIRECTORIES");
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/workspace/pnp-sync-engine.test.ts`
预期: FAIL。

- [ ] **Step 3: 在 `pnp-sync-engine.ts` 中实现对应接口与类型**

1. 扩展 `FolderManifestEntry`, `SyncFolderResult`，升级 `SyncManifest` v2（`loadManifest` 中若无 `folders` 自动补齐 `{}`）。
2. 在 `PrewarmReport` 中加入 `syncedFoldersCount`, `prunedFoldersCount`, `folderResults`。
3. 实现 `syncFolder()` 方法：调用 `sp-sync-engine.ps1 -Action EnsureFolder -SourceFolder <relativePath>`。
4. 在 `generateVirtualRepoMap` 中渲染 `[DIRECTORIES / EMPTY FOLDERS]` 节点。

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/workspace/pnp-sync-engine.test.ts`
预期: PASS。

- [ ] **Step 5: 提交代码**

```powershell
git add CPH-PI/src/workspace/pnp-sync-engine.ts CPH-PI/tests/workspace/pnp-sync-engine.test.ts
git commit -m "feat(workspace): add syncFolder TS API, manifest v2, and directory repo map"
```

---

### Task 4: 全量测试回归、Change Request 登记与归档

**Files:**
- Modify: `CPH-PI/.docs/CHANGE-REQUEST.md`
- Verify: Full Test Suite (`bun test`), Web Production Build (`npm run web:build`)

- [ ] **Step 1: 运行全仓单元与集成测试**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test`
预期: 106+ 个测试文件、845+ 项测试用例全部 100% PASS，0 失败。

- [ ] **Step 2: 运行前端生产编译**

运行: `cd "E:\copilot-web proxy\CPH-PI\web"; npm run build`
预期: Vite 构建无报错，0 类型错误。

- [ ] **Step 3: 登记变更文档 `CPH-PI/.docs/CHANGE-REQUEST.md`**

追加 `CR-2026-10-24-02` 变更记录，说明空文件夹误删根治与双轨模型交付。

- [ ] **Step 4: 最终提交**

```powershell
git add CPH-PI/.docs/CHANGE-REQUEST.md
git commit -m "docs: finalize CR-2026-10-24-02 implementation and full verification"
```
