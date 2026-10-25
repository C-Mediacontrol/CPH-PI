# 实施计划：SharePoint 云仓库开工预热与增量同步引擎 (Implementation Plan)

> **关联规范**: [`.docs/specs/2026-10-20-pnp-sharepoint-cloud-repo-sync-design.md`](../specs/2026-10-20-pnp-sharepoint-cloud-repo-sync-design.md)  
> **基座环境**: CPH-PI (Bun + TypeScript + Windows PowerShell 5.1 + PnP 1.12.0)  
> **实施状态**: 待执行 (Ready for Execution)

---

## 阶段一：PowerShell 传输引擎升级 (`sp-sync-engine.ps1`)

### 任务 1.1：重构 `sp-sync-engine.ps1` 支持 Prewarm、Orphan Pruning 与 -HardReset
* **涉及文件**: [`CPH-PI/scripts/sp-sync-engine.ps1`](file:///e:/copilot-web%20proxy/CPH-PI/scripts/sp-sync-engine.ps1)
* **目标**:
  1. 支持 `Prewarm`、`SyncSingleFile`、`PullFile` 三大 Action；
  2. 实现 `Orphan Pruning`：使用 CSOM 枚举远端目标目录下的现有文件，比对本地清单，对多余的孤儿文件执行 `DeleteObject()` 彻底清除；
  3. 实现 `-HardReset`：当指定该开关时，清空整个远端文件夹并重建；
  4. 对本地存在且哈希变化的文件调用 `[Microsoft.SharePoint.Client.File]::SaveBinaryDirect($ctx, $url, $stream, $true)` 原地覆写；
  5. 产出并更新 `.cph/state/sync-manifest.json`，保存每个文件的 `sha256`、`size`、`uniqueId` 与 `timeLastModified`。
* **验证命令**:
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\copilot-web proxy\CPH-PI\scripts\sp-sync-engine.ps1" -Action Prewarm -LocalPath "E:\copilot-web proxy\CPH-PI\.cph\state\live-test-workspace" -TargetFolder "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test" -SiteUrl "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
  ```
* **验收门禁**: 控制台输出对账清单，显示已推送到 SharePoint，`sync-manifest.json` 包含文件条目。

---

## 阶段二：TypeScript 调度核与 Manifest 契约实现

### 任务 2.1：实现 `PnPWorkspaceSyncEngine` 与 Virtual Repo Map 生成器
* **涉及文件**: `CPH-PI/src/workspace/pnp-sync-engine.ts`
* **目标**:
  1. 封装子进程调用 `powershell.exe 5.1` 执行 `sp-sync-engine.ps1`；
  2. 提供 `prewarm(options)` 方法：异步执行对账预热，解析返回的 JSON 报告；
  3. 提供 `syncFile(workspaceRoot, relativePath, targetFolder)` 方法：执行单文件秒级覆写；
  4. 提供 `generateVirtualRepoMap(...)`：基于 manifest 产出紧凑的 Markdown 目录树，写入 `.cph/state/virtual-repo-map.md`。
* **验收门禁**: `bun test test/pnp-sync-engine.test.ts` 单元测试绿灯。

### 任务 2.2：编写离线单元测试 (`test/pnp-sync-engine.test.ts`)
* **涉及文件**: `CPH-PI/test/pnp-sync-engine.test.ts`
* **目标**:
  1. 测试基于 Mock 传输模式下的预热报告生成；
  2. 验证剪枝逻辑（本地缺失的模拟文件被标记为 pruned）；
  3. 验证哈希未变的文件被正确跳过（status: skipped）；
  4. 验证 Virtual Repo Map 生成的格式与完整性。
* **验收门禁**: 单测覆盖全部状态分支并通过。

---

## 阶段三：CLI 命令集成与真实 SharePoint E2E 对账

### 任务 3.1：在 `package.json` 注册便捷命令
* **涉及文件**: `CPH-PI/package.json`
* **目标**:
  注册脚本快捷方式：
  ```json
  "scripts": {
    "sync:prewarm": "bun run src/workspace/pnp-sync-cli.ts --action prewarm",
    "sync:reset": "bun run src/workspace/pnp-sync-cli.ts --action prewarm --hard-reset",
    "sync:file": "bun run src/workspace/pnp-sync-cli.ts --action sync-file"
  }
  ```
* **验收门禁**: 执行 `bun run sync:prewarm --help` 正常展示参数说明。

### 任务 3.2：真实 SharePoint 孤儿剪枝与增量覆写 E2E 验证
* **涉及文件**: `CPH-PI/scripts/test-e2e-pnp-mirror.ts`
* **目标**:
  1. 先向云端推入一个临时孤儿文件 `dummy-orphan.txt`；
  2. 执行 `prewarm`，断言 `dummy-orphan.txt` 被成功剪枝移除；
  3. 断言存量 `app_entry.py` / `kernel_calc.py` 保留原始 `UniqueId`；
  4. 触发单文件更新，验证在 2 秒内落盘。
* **验收门禁**: 孤儿被清除，`UniqueId` 保持一致，实测对账报告无报错。

