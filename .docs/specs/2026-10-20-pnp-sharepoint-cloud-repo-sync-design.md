# 架构技术规范：SharePoint 云仓库开工预热与增量同步引擎体系 (SharePoint Cloud Repo Pre-warming & Fast-path Incremental Sync Engine Architecture)

> **设计日期**: 2026-10-20  
> **文档版本**: v1.0.0 (实测定型与闭环规范版 / Fully Validated & Approved v1.0.0)  
> **状态**: 【已批准 / APPROVED】已获用户正式批准实施  
> **实施基座**: CPH-PI (Bun + TypeScript + Windows PowerShell 5.1 + PnP.PowerShell 1.12.0)  
> **核心开发准则**: 严格遵循《AGENTS.md》Harness 纯粹中立性、纯协议与受控 CSOM、状态持久化与工作内存正交解耦、本地单一真实源 (SSOT) 原则。

---

## 1. 背景与实测物理基座 (Context & Empirical Foundation)

在将 Microsoft 365 Copilot (`GPT-6.1 Sol`) 构建为高韧性企业级云端协作 Agent 的探索中，针对“能否像 GitHub Copilot Workspace 一样直接将远程 SharePoint 作为代码仓库让 Copilot 阅读与协作”的命题，在 CMA CGM 生产租户中完成了三层嵌套因果链代码的真实物理测试，确立并化解了以下关键客观现实：

### 1.1 核心物理事实一：冷爬虫与热覆写的双轨分水岭
* **冷启动初次全量索引延迟 (Cold Crawling Lag: 15 ~ 18 分钟)**：
  当一个全新目录或全新文件名首次推送到 SharePoint Document Library 时，后台 Microsoft 365 Substrate Search 爬虫需要 **15 到 18 分钟** 的异步批处理流水线才能完成全文与语义切片索引。在此期间，Copilot 的检索工具调用返回 0 结果（明确提示“文件刚同步，尚未被企业搜索索引”）。
* **存量文件同名原地覆写极速穿透 (Hot Overwrite Latency: < 42 秒)**：
  一旦文件在 SharePoint 中建立了元数据节点，后续对其进行同名覆盖（`SaveBinaryDirect`，`overwrite=$true`）：
  1. SharePoint 保持底层 `UniqueId` (GUID) 100% 恒定；
  2. 文件的物理 WebURL 与分享链接 100% 恒定；
  3. **Copilot 在覆写完成仅 42 秒后再次提问，能够立刻直接读取并输出最新代码数值**（实测三层嵌套推导真值从 `3555` 瞬时跃迁至 `7888`，零冷爬虫惩罚）。

### 1.2 核心物理事实二：商业产品 (GitHub Copilot Workspace) 的架构对齐
对比 GitHub Copilot Workspace，本引擎确立了企业级 SharePoint 上的对齐实现：
* **Canonical Remote (权威远端)**：SharePoint 专用工作区目录，永久归档、多端协同、合规审计；
* **Transport Engine (传输管道)**：Windows PowerShell 5.1 + `PnPSession.psm1` 三级认证机制，具备企业内网免密穿透与原子写入能力；
* **Virtual Repo Map (虚拟代码树)**：轻量级目录拓扑指纹（包含永久 WebURL 与哈希），无需模型盲猜；
* **Local SSOT (本地单一真实源)**：本地磁盘代码为唯一基准，杜绝云端脏文件污染。

---

## 2. 总体架构与数据流图 (System Architecture)

```
+-----------------------------------------------------------------------------------------+
| 1. 本地物理工作区 (Local SSOT Workspace)                                                 |
|    - 源码文件、配置文件、测试用例 (严格以 git ls-files 过滤，剔除 node_modules/构建产物)    |
+-----------------------------------------------------------------------------------------+
       │                                                         ▲
       │ (1. 监听变更 / Git 状态)                                   │ (4. File Porter 下行拉取)
       ▼                                                         │
+-----------------------------------------------------------------------------------------+
| 2. 本地增量调度核 (CPH-PI PnPWorkspaceSyncEngine - TypeScript / Bun)                     |
|    - SyncManifest 管理器: 维护 .cph/state/sync-manifest.json                             |
|    - 虚拟目录树映射器: 提取极简目录树 TOC 与恒定 SharePoint WebURL                        |
|    - 异步容灾队列: 防抖聚合 + 失败重试 3 次 + 写入 dirty-sync.jsonl                         |
+-----------------------------------------------------------------------------------------+
       │
       ▼ (2. 调用 powershell.exe 子进程)
+-----------------------------------------------------------------------------------------+
| 3. PnP 传输引擎 (sp-sync-engine.ps1 / PnPSession.psm1)                                  |
|    - 运行环境: 强锁定 powershell.exe 5.1 (杜绝 pwsh 7 反射崩溃)                           |
|    - 认证方式: 免密复用 ~/.cph/pnp-session.json Cookie 认证                             |
|    - 智能剪枝: Orphan Pruning (删除云端孤儿，原地保留存量节点)                              |
|    - 极速推流: SaveBinaryDirect (overwrite=$true, 耗时 1~2s)                             |
+-----------------------------------------------------------------------------------------+
       │
       ▼ (3. 保持同名覆盖，GUID 不变)
+-----------------------------------------------------------------------------------------+
| 4. 企业 SharePoint 远端仓库 (Canonical Remote)                                          |
|    - UniqueId (GUID) 与 WebURL 永久恒定，仅递增版本号                                      |
|    - Copilot Agent 在 40 秒内实时穿透读取最新版本                                        |
+-----------------------------------------------------------------------------------------+
```

---

## 3. 核心物理组件规范 (Component Specifications)

### 3.1 PnP 同步引擎 (`scripts/sp-sync-engine.ps1`)
强锁定于 Windows PowerShell 5.1 环境，提供三类操作：

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Prewarm', 'SyncSingleFile', 'PullFile')][string]$Action,
    [string]$SiteUrl,
    [string]$TargetFolder,
    [string]$WorkspaceRoot,
    [string]$FilePath,
    [string]$ManifestPath,
    [string]$DirtyLogPath,
    [switch]$HardReset,
    [switch]$MockTransport
)
```

#### 行为规范：
1. **Action: `Prewarm`（开工预热与智能对账剪枝）**
   * **HardReset 判定**：若指定 `-HardReset`，直接调用 CSOM 将云端目标文件夹递归删除后重建（注：仅在用户明确需要推倒重来时使用，需承受一次 15 分钟初次冷爬虫）；
   * **默认智能剪枝 (Orphan Pruning)**：
     - 递归枚举云端所有文件相对路径；
     - 枚举本地 `git ls-files` 白名单文件；
     - **孤儿清理**：凡是云端存在、本地不存在的文件，调用 `[Microsoft.SharePoint.Client.File]::DeleteObject()` 彻底删除，确保云端绝无脏文件冲突；
     - **存量热覆写**：对本地清单中 SHA256 发生变动的文件，调用 `[Microsoft.SharePoint.Client.File]::SaveBinaryDirect` 原子覆写；
     - **跳过未变**：哈希一致的文件跳过上传，避免网络浪费；
   * **状态落地**：全量对账完成后原子保存 `.cph/state/sync-manifest.json`。
2. **Action: `SyncSingleFile`（秒级单文件热覆写）**
   * 计算目标文件本地 SHA256，与 manifest 比对；
   * 变动时调用 `SaveBinaryDirect` 流式推送到目标路径；
   * 覆写耗时 1~2 秒，更新 manifest 对应条目；
   * 若失败重试 3 次，仍失败则追加至 `dirty-sync.jsonl`，绝不阻塞前台。
3. **Action: `PullFile`（下行拉取回流）**
   * 将云端生成的目标文件通过 CSOM 流式下载落盘至本地工作区对应相对路径。

---

### 3.2 TypeScript 同步调度核 (`src/workspace/pnp-sync-engine.ts`)

为 CPH-PI 运行核提供高内聚的异步 TypeScript API：

```typescript
export interface PrewarmOptions {
  workspaceRoot: string;
  targetFolder: string;
  siteUrl?: string;
  hardReset?: boolean;
  signal?: AbortSignal;
}

export interface SyncFileResult {
  relativePath: string;
  status: "synced" | "skipped" | "pruned" | "failed";
  size: number;
  sha256: string;
  uniqueId?: string;
  webUrl?: string;
  error?: string;
}

export interface PrewarmReport {
  workspaceRoot: string;
  targetFolder: string;
  totalLocal: number;
  syncedCount: number;
  skippedCount: number;
  prunedCount: number;
  failedCount: number;
  durationMs: number;
  results: SyncFileResult[];
}

export class PnPWorkspaceSyncEngine {
  public static DEFAULT_SITE_URL = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN";

  /**
   * 触发开工预热与智能差异剪枝
   */
  public async prewarm(options: PrewarmOptions): Promise<PrewarmReport>;

  /**
   * 单文件秒级热覆写推送
   */
  public async syncFile(workspaceRoot: string, relativePath: string, targetFolder: string): Promise<SyncFileResult>;

  /**
   * 生成极简 Virtual Repo Map 供 Prompt 注入
   */
  public static generateVirtualRepoMap(manifest: SyncManifest, siteUrl: string, targetFolder: string): string;
}
```

---

### 3.3 虚拟代码树映射规范 (Virtual Repo Map Contract)

预热完成后，Harness 会在本地生成 `.cph/state/virtual-repo-map.md`，并在每次会话启动、阶段切片或跨会话接力时，以极简物理指纹注入模型上下文（遵循《AGENTS.md》传引用准则）：

```markdown
[SHAREPOINT REMOTE WORKSPACE]
Remote Root URL: https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01%20Team/03%20AFR/AFR%20SCHK/06_Training/New%20Hire%20Training/2025/Vincent%20Fu/WorkSpace/test
Sync Status: Synchronized (Local SSOT) | Total Files: 18

Files Index:
- shared/modules/JsygtBatch.psm1 (Size: 8.4KB | Web: https://.../JsygtBatch.psm1)
- tools/jsygt-ocr/OcrInfer.cs (Size: 15.2KB | Web: https://.../OcrInfer.cs)
- src/billing/tax.ts (Size: 3.1KB | Web: https://.../tax.ts)
...
Guidance: All repository files are grounded at the SharePoint paths above. You may cite, inspect or trace them directly by relative path or URL.
```

---

## 4. 状态持久化契约 (Persistence Schema)

严格遵循《AGENTS.md》准则 7（状态持久化与工作内存正交解耦），所有证据落盘在 `.cph/state/` 下，零 Token 消耗：

### 4.1 增量状态清单：`.cph/state/sync-manifest.json`
```json
{
  "version": 1,
  "lastPrewarmAt": "2026-10-20T21:17:05.123Z",
  "siteUrl": "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN",
  "targetFolder": "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/.../WorkSpace/test",
  "files": {
    "src/kernel_calc.py": {
      "sha256": "7b4d81f8a846...",
      "size": 174,
      "uniqueId": "3931905f-c8e5-4684-aded-1ed9b9a1ee8e",
      "serverRelativeUrl": "/sites/CMA-GBSC_BKGDOMAIN/.../kernel_calc.py",
      "lastSyncedAt": "2026-10-20T21:17:05.123Z"
    }
  }
}
```

### 4.2 容灾对账日志：`.cph/state/dirty-sync.jsonl`
```jsonl
{"file":"src/billing/tax.ts","timestamp":"2026-10-20T21:18:00Z","error":"WebException: The operation has timed out","attempts":3}
```
* 同步失败自动重试 3 次（间隔 100ms * attempt）；
* 仍失败写入 `dirty-sync.jsonl`，**绝不阻塞前台推理**；
* 下一轮预热或对账时静默自动补推。

---

## 5. 验证与门禁标准 (Verification & Acceptance Criteria)

| 阶段 | 验证目标 | 门禁检验标准 |
|---|---|---|
| **Gate 1: 离线单元测试** | `pnp-sync-engine.test.ts` | 注入 Mock 传输层，断言 Orphan Pruning 逻辑正确、SHA256 增量过滤生效、失败重试记录正确。 |
| **Gate 2: 剪枝与覆盖真实对账** | `test-pnp-prewarm.ps1` | 在真实 SharePoint `live test/` 目录下推入废弃孤儿文件并验证其被物理删除，存量文件被覆盖且保留 GUID。 |
| **Gate 3: 40秒时效真实验证** | `test-e2e-fast-sync.ts` | 修改单个存量文件，触发 `syncFile`，并在 40 秒内通过 CDP 向 Copilot 验证其读取到最新数值。 |

---
*文档编制完成，符合全部架构中立性与工程安全准则。*

