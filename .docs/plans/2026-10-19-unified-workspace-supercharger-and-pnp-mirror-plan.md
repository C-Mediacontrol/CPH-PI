# 全工作区快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立基于 Microsoft Graph 原生分块协议与自适应路由的双通道直传引擎，实现对 4MB 客户端假说的弹性覆盖与无上限传输；落地 Windows PowerShell 5.1 受控 PnP 物理镜像与离线 CI 录放通道；实现基于 `git ls-files -z`、正则敏感过滤、9 项核心系统断言与幂等防膨胀的全景快照生成器（`WorkspaceSnapshot`）；重构 Tri-Agent 提示词与专有 Skills，形成首轮全局全景洞察、单点攻坚 TDD 绿灯增量同步与微切片认知隔离的高韧性开发流水线。

**Architecture:** 
1. **传输自适应路由**: `SubstrateUploader` 实现 `uploadDocumentAuto`，≤4MB 走加固的简易直传（带 429/503 重试、4xx 立即熔断上抛与退避中断），>4MB 走 `createUploadSession` + 8,000 KB 分块续传状态机；`uploadDocumentToOneDrive` 作为完全向后兼容别名保留历史启发式互换容错；
2. **SharePoint 物理镜像**: `scripts/sp-sync-engine.ps1` 强制断言 Windows PowerShell 5.1 运行，依赖受控 `scripts/lib/PnPSession.psm1` 实现严格命名空间化与 Windows ACL 权限隔离，基于 `.cph/state/sync-manifest.json` 状态基线实现单文件与变更文件精准增量推送，彻底移除遗留跨项目共享回退，配套 CI 离线 Mock 适配层；
3. **全景快照与微切片**: `SnapshotGenerator` 产出源码全景快照交付件（`WorkspaceSnapshot`），落盘强制限定于 `.cph/snapshots/` 严防递归收录膨胀；内置密钥扫描阻断与 9 项核心系统源码断言门禁，支持按工单提取 10~30KB 闭包微切片，并与既有记录任务规划/执行账本的 `MainPlanSnapshot`（`.cph/handoffs/`）保持正交分工与生命周期协同；
4. **流水线闭环与提示词重塑**: `Orchestrator` 串联首轮全景投递（显式告警与降级兜底，严禁静默吞错）、未变更哈希复用（消除 Turn 1 重复开销）、单点攻坚指纹头下发与 Handoff 递增快照；重塑 Main/Researcher/Coder 提示词与 `subagent`/`handoff` 技能。

**Tech Stack:** TypeScript, Bun (`bun test`), Windows PowerShell 5.1, Node.js `fs`/`crypto`, Microsoft Graph API, PnP.PowerShell 1.12.0, SignalR WebSocket.

## Global Constraints

- **目录写入铁律**: 严禁在工作区根目录写入任何文件，所有代码、测试与文档均位于 `CPH-PI/` 及其二级子目录内；
- **Harness 纯粹与中立原则**: Harness 仅负责客观协议调度，不向业务提示词暴露 WebSocket/Token/账号池等物理细节；
- **纯协议与零 CDP 边界**: 生产环境全链路走 Node/Bun 原生 `fetch` 与 Chathub SignalR 原生 WebSocket，零 CDP / 零浏览器依赖；
- **离线研究实验豁免**: 仅在离线边界探索脚本（`scripts/test-upload-boundary.ts`）中，允许复用 `evidence/run-rag-boundary-test.ts` 的 CDP 范式模拟真实 UI 附件卡片以观测云端阈值行为；生产运行时与持续会话链路（`src/`）严禁引入任何 CDP 依赖；
- **运行环境强锁定**: PnP 脚本必须且仅能在 `powershell.exe` (Windows PowerShell 5.1) 下运行，严禁使用 `pwsh` (PS7+)；
- **凭据物理卫生与严格隔离**: 敏感 Cookie 严格存储于 `~/.cph/pnp-session.json` 并配置 Windows ACL 仅当前用户访问；证据件与日志严禁明文凭据入库；彻底废除跨项目遗留缓存回退；
- **正向建设性引导**: 系统提示词与 Skills 全面采用正向行为规范，遵循《AGENTS.md》规则 3；
- **真实数据口径与动态断言**: 151 个源文件原始字节总和为 1,324,834 字节 (1.26 MB)，生成的最终快照交付件 `workspace-v1.txt` 为 1,365,870 字节 (1.30 MiB / 1.37 MB)；测试断言采用“核心 9 项必在快照内”硬门禁 + 动态文件范围断言，杜绝自指失效。

---

## 冲击面扫描矩阵 (Impact Surface Scan)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 冲击处理与对账方案 |
|---|---|---|---|
| **函数/接口** | `SubstrateUploader.uploadDocumentAuto` | `Orchestrator`, `SubagentRunner` | 移除无调用关系的 `FilePorter`；保留 `uploadDocumentToOneDrive` 4 参兼容别名与参数错序启发式，旧调用点零破坏性平移 |
| **配置文件** | `PnPSession.psm1` 写入 `~/.cph/pnp-session.json` | `sp-sync-engine.ps1` 消费 Cookie 缓存 | 写入时自动施加 Windows ACL (`FileSystemAccessRule`)，彻底废除跨项目遗留回退，建立独立命名空间 |
| **数据/存储** | `SnapshotGenerator` 生成全景源码快照 (`WorkspaceSnapshot`) | `SubstrateUploader` 接收 Buffer 上传至 OneDrive | 输出锁定于 `.cph/snapshots/` 防递归膨胀；与存量规划/账本快照 `MainPlanSnapshot` (`.cph/handoffs/`) 职责与目录严格正交 |
| **执行进程** | `Orchestrator` 触发 `powershell.exe 5.1` | `sp-sync-engine.ps1` 基于 `sync-manifest.json` 增量同步 | 异步解耦，维护 `.cph/state/sync-manifest.json` 基线，未变更文件不推，失败追加至 `.cph/state/dirty-sync.jsonl` |
| **提示词与技能**| `package-agent-bundle.ts` 装配提示词文本并打包 | `package/agent-bundle/` 部署至 Copilot Agent | 明确 `prompt-builder.ts` 仅负责运行时动态装配，四类 `.txt` 由打包脚本统一装配并发布，重塑为具备上帝视野与 DAG 因果感知的 Tri-Agent 矩阵 |

---

## 实施路线与任务依赖图 (Task Dependency DAG)

```
[Phase 0: 纯协议直传与分块引擎] ──> [Phase 0.2: 3.9MB vs 4.1MB 边界实验]
           │
           ├──> [Phase 1: PnP 镜像引擎与 CI Mock] ──┐
           │                                        │
           └──> [Phase 2: 快照生成器与微切片] ────────┼──> [Phase 3: Orchestrator 闭环集成]
                                                    │                │
                                                    │                v
                                                    └──> [Phase 4: Tri-Agent 提示词与技能]
                                                                     │
                                                                     v
                                                         [Phase 5: 全量回归与打包]
```

---

### Phase 0: 纯协议自适应直传与断点分块引擎 (Resumable Upload Engine)

#### Task 0.1: 加固 `uploadSimple` 与重构 `SubstrateUploader` 核心接口
**Files:**
- Modify: `CPH-PI/src/transport/substrate-uploader.ts`
- Create: `CPH-PI/tests/transport/resumable-uploader.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export class SubstrateUploader {
    public static CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4 * 1024 * 1024;
    public static CHUNK_SIZE = 8192000;
    public static MAX_CHUNK_ATTEMPTS = 5;
    public static MAX_SIMPLE_ATTEMPTS = 5;

    public static async uploadDocumentAuto(
      graphAccessToken: string,
      content: Buffer | string,
      fileName: string,
      signal?: AbortSignal
    ): Promise<UploadDocumentResult>;

    public static async uploadDocumentToOneDrive(
      graphAccessToken: string,
      content: string | Buffer,
      fileName: string,
      customBaseUrlOrSignal?: string | AbortSignal
    ): Promise<UploadDocumentResult>;
  }
  ```

- [ ] **Step 0.1.1: 编写 `uploadSimple` 限流重试、退避中断、4xx 立即熔断与兼容别名的红灯单元测试**
  在 `tests/transport/resumable-uploader.test.ts` 中编写测试：
  - 测试 `uploadSimple` 在遇到 429 / 503 / 5xx 时解析 `Retry-After`（秒数与 HTTP-Date）并进行指数退避重试，超过 5 次熔断；
  - 测试遇到 400 / 401 / 403 等不可恢复客户端/鉴权错误时，不予重试立即上抛异常（杜绝白白等待 20s）；
  - 测试 `AbortSignal` 触发时能立即打断退避等待并上抛中断异常；
  - 测试 `uploadDocumentToOneDrive` 在 3 参调用、4 参调用以及参数错序时正确兼容转发。
- [ ] **Step 0.1.2: 运行测试验证失败 (RED)**
  运行 `bun test tests/transport/resumable-uploader.test.ts`，确认因缺少重试、4xx 熔断与方法缺失报错。
- [ ] **Step 0.1.3: 实现 `uploadSimple` 加固逻辑与可中断退避辅助函数**
  在 `src/transport/substrate-uploader.ts` 中实现：
  - `sleepInterruptible(ms, signal)` 监听 `abort` 事件；
  - `uploadSimple` 包含 4xx 立即抛出拦截、429/503/5xx 重试循环、`Retry-After` 解析与 AbortSignal 检查；
  - `uploadDocumentToOneDrive` 向后兼容签名与参数错序检测。
- [ ] **Step 0.1.4: 运行测试验证通过 (GREEN)**
  运行 `bun test tests/transport/resumable-uploader.test.ts` 确保用例全部通过。

#### Task 0.2: 实现断点分块直传状态机 (`uploadResumable`)
**Files:**
- Modify: `CPH-PI/src/transport/substrate-uploader.ts`
- Test: `CPH-PI/tests/transport/resumable-uploader.test.ts`

**Interfaces:**
- Produces:
  `uploadResumable(graphAccessToken: string, buffer: Buffer, fileName: string, signal?: AbortSignal): Promise<UploadDocumentResult>`

- [ ] **Step 0.2.1: 编写分块状态机测试用例**
  - 测试 >4MB 文件自适应路由至 `createUploadSession`；
  - 测试以严格的 8,192,000 字节循环发送 PUT 分块，携带 `Content-Range` 与 `Prefer: ExtractTextOnCommit`；
  - 测试依据模拟服务端返回的 202 (`nextExpectedRanges`) 推进下一分块，末尾分块返回 201 (`DriveItem`)；
  - 测试 400/401/403 等客户端错误立即熔断退出，429/503/网络超时执行单分块重试 (上限 5 次) 与可中断退避。
- [ ] **Step 0.2.2: 实现 `uploadResumable` 分块状态机**
  将规范 §3.1 中的分块状态机逻辑完整落入 `src/transport/substrate-uploader.ts`，加入 4xx 快速失败与 `sleepInterruptible`。
- [ ] **Step 0.2.3: 运行测试验证全量通过 (GREEN)**
  运行 `bun test tests/transport/resumable-uploader.test.ts` 确保简易与分块测试 100% 绿灯。
- [ ] **Step 0.2.4: 提交 Phase 0 代码变更**
  执行 `git commit -m "feat(transport): implement pure protocol resumable chunked upload with 4xx fail-fast and hardened uploadSimple"`。

#### Task 0.3: Phase 0 边界实测与假说验证 (3.9MB vs 4.1MB Boundary Experiment)
**Files:**
- Create: `CPH-PI/scripts/test-upload-boundary.ts`
- Output: `CPH-PI/.docs/evidence/upload-boundary-experiment-results.json`

- [ ] **Step 0.3.1: 编写离线真实附件卡片 CDP 探针脚本**
  享受 Global Constraints 离线研究实验豁免，复用 `evidence/run-rag-boundary-test.ts` 的 CDP 范式，通过浏览器注入构造的 3.9MB 与 4.1MB 真实附件，抓取 Network/WebSocket 帧并监测云端 Substrate 在不同体积下的卡片解析行为与分水岭。
- [ ] **Step 0.3.2: 记录实验数据并落盘至证据库**
  将边界命中结果、真实就绪耗时与卡片组装状态记录至 `.docs/evidence/upload-boundary-experiment-results.json`；若发现云端真实分块阈值与 4MB 假说存在差异，调整 `CLIENT_SPLIT_THRESHOLD_HYPOTHESIS`。

---

### Phase 1: SharePoint 物理同步引擎与受控依赖 (`sp-sync-engine.ps1`)

#### Task 1.1: 落地 `sp-sync-engine.ps1` 核心同步逻辑、增量状态基线与受控 PnPSession 权限加固
**Files:**
- Create: `CPH-PI/scripts/sp-sync-engine.ps1`
- Modify: `CPH-PI/scripts/lib/PnPSession.psm1`
- Create: `CPH-PI/tests/scripts/sp-sync-engine.test.ts`

**Interfaces:**
- Produces:
  CLI 命令行调用：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/sp-sync-engine.ps1 -Action <SyncWorkspace|SyncSingleFile> -SiteUrl <url> -TargetFolder <folder> ...`
  增量状态基线清单：
  `.cph/state/sync-manifest.json` (记录 relativePath -> { sha256, lastSyncedAt })

- [ ] **Step 1.1.1: 加固 `PnPSession.psm1` 凭据隔离与命名空间规范**
  - 彻底移除 `PnPSession.psm1` 中的跨项目遗留回退（清退 `~/.ltk-shipschedule-session.json`），强绑定单一入口 `~/.cph/pnp-session.json`；
  - 完善 `Write-DpsSessionCache` 中的 Windows ACL 权限加固：
    ```powershell
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, 'FullControl', 'Allow')
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    $fileInfo = New-Object System.IO.FileInfo($CacheFile)
    $fileInfo.SetAccessControl($acl)
    ```
- [ ] **Step 1.1.2: 编写 `sp-sync-engine.ps1` 执行环境、增量基线比对与参数解析**
  - 落地 PowerShell 5.1 版本硬断言：
    ```powershell
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
      throw "FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+)。"
    }
    ```
  - 引入增量状态清单机制：维护 `.cph/state/sync-manifest.json`；推送前比对本地文件 SHA256，未变更文件直接跳过（解决 M4 增量退化全量问题）；
  - 实现 `SyncSingleFile`（单文件更新）与 `SyncWorkspace`（基于 `git ls-files` + `sync-manifest.json` 增量推送）；
  - 异常状态处理：同步失败追加至 `.cph/state/dirty-sync.jsonl`，不阻塞主流程。
- [ ] **Step 1.1.3: 编写 CI 离线 Mock 传输层与单元测试**
  在 `tests/scripts/sp-sync-engine.test.ts` 中：
  - 构造 `MockSharePointSyncClient`，模拟网络抖动、重试 3 次与失败写入 `.cph/state/dirty-sync.jsonl`；
  - 断言 PS5.1 启动命令与参数格式；
  - 断言 `sync-manifest.json` 增量判定：未修改文件跳过推送，新修改文件触发推送并刷新清单；
  - 断言 Windows ACL 权限加固调用与禁用跨项目 `.ltk-*` 遗留回退。
- [ ] **Step 1.1.4: 运行测试并验证通过 (GREEN)**
  运行 `bun test tests/scripts/sp-sync-engine.test.ts`。
- [ ] **Step 1.1.5: 提交 Phase 1 代码变更**
  执行 `git commit -m "feat(pnp): implement sp-sync-engine.ps1 with sync manifest, Windows ACL isolation and PS5.1 assertion"`。

---

### Phase 2: Git-Aware 全景快照与子代理微切片生成器

#### Task 2.1: 实现 `SnapshotGenerator` 全景快照器
**Files:**
- Create: `CPH-PI/src/workspace/snapshot-generator.ts`
- Create: `CPH-PI/tests/workspace/snapshot-generator.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export class SnapshotGenerator {
    public static SENSITIVE_FILE_PATTERNS: RegExp[];
    public static CRITICAL_CORE_FILES: string[];
    public static getTrackedSourceFiles(workspaceRoot: string): string[];
    public static generateWorkspaceSnapshot(workspaceRoot: string, outputDir: string): {
      snapshotPath: string;
      hash: string;
      fileCount: number;
      bytes: number;
    };
    public static generateScopedSubagentSlice(workspaceRoot: string, targetFiles: string[], prerequisiteReports?: string[]): {
      slicePath: string;
      bytes: number;
    };
  }
  ```

- [ ] **Step 2.1.1: 编写全景快照器的单元测试（硬子集门禁 + 动态范围 + 幂等防膨胀）**
  - 断言目录排除逻辑：严格排除 `.docs/`, `package/`, `dist/`, `.cph/`, `node_modules/`；排除敏感文件 `.env*`, `*tokens.json`, `*-session.json`, `*.pem`, `*.key`；
  - **核心 9 大源码硬门禁断言**（确保关键架构不漏）：断言 `CRITICAL_CORE_FILES`（`session-manager.ts`, `execution-ledger.ts`, `token-manager.ts`, `PnPSession.psm1`, 以及 4 个提示词等）必在快照列表内；
  - **动态文件范围与字节断言**（防自指失效 P2）：断言 `fileCount >= 151` 且落在当前分支有效代码文件数区间 `[151, 175]`，字节数落在 `[1.25 MiB, 1.60 MiB]`；
  - **幂等性与防递归膨胀断言**（防快照套快照 M5）：指定 `outputDir` 为 `.cph/snapshots/`，连续执行两次快照生成，断言两次生成的 `fileCount`、`bytes` 与 `hash` 100% 稳定一致；
  - 断言敏感凭据扫描：模拟注入带有私钥或真实 Token 格式的文本，断言触发扫描阻断并抛出异常。
- [ ] **Step 2.1.2: 实现 `SnapshotGenerator` 全景生成与密钥扫描**
  在 `src/workspace/snapshot-generator.ts` 中实现：
  - 基于 `git ls-files -z` 跨平台安全枚举；
  - 默认输出目录强制锁定为 `path.join(workspaceRoot, '.cph', 'snapshots')`，产物命名为 `workspace-snapshot-<sha256>.txt`；
  - 原始二进制 Buffer SHA256 哈希计算与 manifest 记录；
  - 内容级敏感模式扫描与 9 项核心源码存在性硬门禁。
- [ ] **Step 2.1.3: 实现子代理局部微切片组装逻辑 (`generateScopedSubagentSlice`)**
  仅提取目标文件及其导入接口定义，生成 10~30KB 的聚焦微切片。
- [ ] **Step 2.1.4: 运行测试并验证通过 (GREEN)**
  运行 `bun test tests/workspace/snapshot-generator.test.ts`。
- [ ] **Step 2.1.5: 提交 Phase 2 代码变更**
  执行 `git commit -m "feat(workspace): implement git-aware SnapshotGenerator with anti-expansion idempotency and dynamic subset assertions"`。

---

### Phase 3: Orchestrator 挂载通道与生命周期闭环集成 (Pipeline Integration)

#### Task 3.1: Orchestrator 全景快照挂载、未变更复用、显式容错与物理指纹头下发
**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Reference: `CPH-PI/src/session/main-plan-snapshot.ts`
- Create: `CPH-PI/tests/agent/dual-layer-lifecycle.test.ts`

**Architecture Boundary (双快照正交分工):**
- **全景代码快照 (`WorkspaceSnapshot`)**: 由 `SnapshotGenerator` 生成，落盘 `.cph/snapshots/workspace-snapshot-<hash>.txt`，经由 `SubstrateUploader` 投递至 OneDrive 挂载为 Turn 1 附件，向大模型提供全局代码拓扑视野；
- **规划与执行账本快照 (`MainPlanSnapshot`)**: 既有实现保持不变，落盘 `.cph/handoffs/main-plan-*.{json,md}`，负责任务 DAG、Ledger 事实与断点状态恢复，仅供本地 TUI 横幅与 Handoff 接力消费。

**Interfaces:**
- Consumes: `SnapshotGenerator.generateWorkspaceSnapshot`, `SubstrateUploader.uploadDocumentAuto`, `MainPlanSnapshot`
- Produces:
  - Turn 1 会话启动时检测代码树哈希，若有变更上传挂载 `workspace-snapshot-<hash>.txt`；若无变更复用上次缓存 `webUrl`（解决 I13 避免重复 20s 延迟）；
  - **首轮上传显式容错（解决 M2 杜绝静默吞错）**：若上传失败，不得静默 catch 吞没，必须在 TUI 显式输出黄色告警 `[WARN: Turn 1 workspace snapshot upload failed]`、记录详细堆栈至 `.cph/state/upload-error.log`，并激活内联降级兜底；
  - 单点测试绿灯后，下发极简物理指纹头 `[WORKSPACE STATE UPDATE]` 并异步触发 PnP 单文件增量同步；
  - Handoff 时单调递增生成并投递下一版本快照。

- [ ] **Step 3.1.1: 编写双层流生命周期端到端对账测试**
  在 `tests/agent/dual-layer-lifecycle.test.ts` 中：
  - 模拟 Turn 1 首次注入全景附件注解；
  - 模拟 Turn 1 代码未变更时复用已有 `webUrl` 缓存，跳过重复上传；
  - 模拟 Turn 1 上传失败时触发显式告警与降级逻辑，断言错误被完整记录且不导致进程崩溃（杜绝盲跑）；
  - 模拟 Turn 2 编码完成且单测绿灯，拦截全量上传，下发 5 行物理指纹头；
  - 模拟 Handoff 生成递增版本快照；
  - 确认现有 `uploadDocumentToOneDrive` 调用无损兼容。
- [ ] **Step 3.1.2: 在 `Orchestrator` 与 `SubagentRunner` 中集成双层流逻辑**
  - 首轮会话检测、代码哈希比对与快照挂载/复用；
  - 改造 `orchestrator.ts` 中的异常捕获：上传失败输出 TUI 告警并安全降级，禁止静默吞错；
  - 局部编码门禁通过后调用 `sp-sync-engine.ps1` 异步增量同步；
  - 平滑平移调用点至 `SubstrateUploader.uploadDocumentAuto`。
- [ ] **Step 3.1.3: 运行生命周期测试与存量虚拟化/快照回归测试 (GREEN)**
  同时运行新双层流测试与存量 `MainPlanSnapshot` / `virtualization` 既有测试套件：
  `bun test tests/agent/dual-layer-lifecycle.test.ts tests/session/snapshot-static-import.test.ts tests/agent/orchestrator-virtualization.test.ts tests/agent/smart-handoff.test.ts tests/integration/virtualization-relay.test.ts`。
- [ ] **Step 3.1.4: 提交 Phase 3 代码变更**
  执行 `git commit -m "feat(agent): integrate dual-layer snapshot lifecycle with explicit error handling and hash reuse in Orchestrator"`。

---

### Phase 4: Tri-Agent 系统提示词与专有 Skills 重构 (Prompts & Skills Overhaul)

#### Task 4.1: 重写三大 Agent 提示词与装配流水线
**Files:**
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-researcher-agent-prompt.txt`
- Modify: `CPH-PI/cph-coder-agent-prompt.txt`
- Modify: `CPH-PI/scripts/package-agent-bundle.ts`
- Create: `CPH-PI/tests/skills/tri-agent-governance.test.ts`

- [ ] **Step 4.1.1: 编写提示词治理测试（DAG 结构契约 + 行为边界）**
  - 断言 `cph-main-agent-prompt.txt` 包含全景快照认知输入契约与 DAG 因果时序屏障（解决 I15，由单纯禁词检查升级为行为契约断言）；
  - 断言 `cph-researcher-agent-prompt.txt` 专注于单点局部微切片审查与只读证据链；
  - 断言 `cph-coder-agent-prompt.txt` 专注于局部补丁与测试绿灯闭环，符合正向建设性规范；
  - 断言提示词全文无破坏性指令与底层 Harness 管道泄露，保持纯粹黑盒。
- [ ] **Step 4.1.2: 重构三大提示词文本**
  依据规范 §7 重写三个提示词文件，确立上帝视野与职责边界。
- [ ] **Step 4.1.3: 更新并运行打包脚本同步至 agent-bundle**
  执行 `bun run package` 触发 `scripts/package-agent-bundle.ts`，确保修改后的四个提示词与 skills 完整打包至 `package/agent-bundle/`（解决 P6，确保投递端与源端同步）。
- [ ] **Step 4.1.4: 运行治理测试验证通过 (GREEN)**
  运行 `bun test tests/skills/tri-agent-governance.test.ts`。

#### Task 4.2: 重构 `skills/subagent` 与微调 `skills/handoff`
**Files:**
- Modify: `CPH-PI/skills/subagent/SKILL.md`
- Modify: `CPH-PI/skills/handoff/SKILL.md`

- [ ] **Step 4.2.1: 编写技能治理测试用例**
  - 断言 `skills/subagent/SKILL.md` 包含工单切片契约与阶段屏障，废除旧式斥候探查；
  - 断言 `skills/handoff/SKILL.md` 包含后继智能体防失忆契约与全景快照递增对齐。
- [ ] **Step 4.2.2: 重构技能文档**
  依据规范 §8 落实技能改造。
- [ ] **Step 4.2.3: 运行治理测试验证通过 (GREEN)**
  运行 `bun test tests/skills/tri-agent-governance.test.ts`。
- [ ] **Step 4.2.4: 提交 Phase 4 代码变更**
  执行 `git commit -m "feat(prompts): overhaul Tri-Agent prompts, agent bundle packaging, and subagent/handoff skills"`。

---

### Phase 5: 全量回归、构建打包与实战对账 (Verification & Packaging)

#### Task 5.1: 全量测试套件回归与物理对账
**Files:**
- Modify: `CPH-PI/.docs/CHANGE-REQUEST.md` (标记为实施完成)
- Modify: `CPH-PI/CHANGELOG.md` (记录实施增量与新测试基线)

- [ ] **Step 5.1.1: 执行全量单元测试与集成测试（以当前实测 655/2847 为绝对底线）**
  运行 `bun test`，确保全仓测试用例 100% 绿灯：
  - **测试用例总数硬门禁**：用例数 ≥ 655（当前全仓现状为 655 pass / 0 fail / 86 files，新增测试后预计 ≥ 670）；
  - **断言总数硬门禁**：断言数 ≥ 2847（当前全仓现状为 2847 expect calls，新增后预计 ≥ 2900）；
  - **零失败门禁**：fail == 0，严禁带病推进；
  - 彻底废除已过期的旧指标（520/2300），确保门禁具备真实拦截能力（解决 P1）。
- [ ] **Step 5.1.2: 执行构建打包与制品产出**
  运行 `bun run package` 与 `bun run build:package`，确保分发制品 `package/` 与 `dist/` 编译通过无错误。
- [ ] **Step 5.1.3: 更新 CHANGELOG 与变更请求台账**
  - 更新 `CHANGELOG.md`，记录本次 v1.3.0 统一架构实施增量与全新测试基线；
  - 更新 `CHANGE-REQUEST.md` 中的 `CR-2026-10-19-01` 状态为“实施完成 (Completed & Verified)”，提交并汇报用户。
- [ ] **Step 5.1.4: 执行全链路离线 Mock 模拟集成对账**
  运行集成测试脚本验证：首轮全景生成 -> 附件模拟挂载 -> 指纹头下发 -> 局部增量 PnP 同步 -> Handoff 快照递增全生命周期无阻塞跑通。

