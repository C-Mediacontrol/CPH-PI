# 全工作区快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 突破 4MB 简易上传限制，构建基于 Microsoft Graph 原生分块协议与自适应路由的双通道直传引擎；落地 Windows PowerShell 5.1 受控 PnP 物理镜像与离线 CI 录放通道；实现基于 `git ls-files -z`、正则敏感过滤与 9 项核心系统断言的全景快照生成器；重构 Tri-Agent 提示词与专有 Skills，形成首轮全局全景洞察、单点攻坚 TDD 绿灯同步与微切片认知隔离的高韧性开发流水线。

**Architecture:** 
1. **传输自适应路由**: `SubstrateUploader` 实现 `uploadDocumentAuto`，≤4MB 走加固的简易直传（带 429/503 重试与退避中断），>4MB 走 `createUploadSession` + 8,000 KB 分块续传状态机；`uploadDocumentToOneDrive` 作为完全向后兼容别名保留历史启发式互换容错；
2. **SharePoint 物理镜像**: `scripts/sp-sync-engine.ps1` 强制断言 Windows PowerShell 5.1 运行，依赖受控 `scripts/lib/PnPSession.psm1` 实现命名空间化与 Windows ACL 权限隔离，单测单文件推送，配套 CI 离线 Mock 适配层；
3. **全景快照与微切片**: `SnapshotGenerator` 精准产出 151 源文件 / 1.30 MiB 快照交付件，内置密钥扫描阻断与 9 项核心系统源码断言，支持按工单提取 10~30KB 闭包微切片；
4. **流水线闭环与提示词重塑**: `Orchestrator` 串联首轮全景投递、单点攻坚指纹头下发与 Handoff 递增快照；重塑 Main/Researcher/Coder 提示词与 `subagent`/`handoff` 技能。

**Tech Stack:** TypeScript, Bun (`bun test`), Windows PowerShell 5.1, Node.js `fs`/`crypto`, Microsoft Graph API, PnP.PowerShell 1.12.0, SignalR WebSocket.

## Global Constraints

- **目录写入铁律**: 严禁在工作区根目录写入任何文件，所有代码、测试与文档均位于 `CPH-PI/` 及其二级子目录内；
- **Harness 纯粹与中立原则**: Harness 仅负责客观协议调度，不向业务提示词暴露 WebSocket/Token/账号池等物理细节；
- **纯协议与零 CDP 边界**: 生产环境全链路走 Node/Bun 原生 `fetch` 与 Chathub SignalR 原生 WebSocket，零 CDP / 零浏览器依赖；
- **运行环境强锁定**: PnP 脚本必须且仅能在 `powershell.exe` (Windows PowerShell 5.1) 下运行，严禁使用 `pwsh` (PS7+)；
- **凭据物理卫生**: 敏感 Cookie 严格存储于 `~/.cph/pnp-session.json` 并配置 Windows ACL 仅当前用户访问；证据件与日志严禁明文凭据入库；
- **正向建设性引导**: 系统提示词与 Skills 全面采用正向行为规范，遵循《AGENTS.md》规则 3；
- **真实数据口径**: 151 个源文件原始字节总和为 1,324,834 字节 (1.26 MB)，生成的最终快照交付件 `workspace-v1.txt` 为 1,365,870 字节 (1.30 MiB / 1.37 MB)。

---

## 冲击面扫描矩阵 (Impact Surface Scan)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 冲击处理与对账方案 |
|---|---|---|---|
| **函数/接口** | `SubstrateUploader.uploadDocumentAuto` | `Orchestrator`, `SubagentRunner`, `FilePorter` | 保留 `uploadDocumentToOneDrive` 4 参兼容别名与参数错序启发式，旧调用点零破坏性平移 |
| **配置文件** | `PnPSession.psm1` 写入 `~/.cph/pnp-session.json` | `sp-sync-engine.ps1` 消费 Cookie 缓存 | 写入时自动施加 Windows ACL (`FileSystemAccessRule`)，隔离跨项目污染 |
| **数据/存储** | `SnapshotGenerator` 生成全景快照文本 | `SubstrateUploader` 接收 Buffer 上传 | 经 9 项核心文件断言门禁，快照大小与哈希写入 manifest |
| **执行进程** | `Orchestrator` 触发 `powershell.exe 5.1` | `sp-sync-engine.ps1` 后台增量同步 | 异步解耦，同步失败追加至 `.cph/state/dirty-sync.jsonl`，不阻塞前台推理 |
| **提示词与技能**| `prompt-builder.ts` 组装系统提示词 | Copilot / GPT-6.1 Sol 认知构建 | 全面推倒重构为具备上帝视野与 DAG 因果感知的 Tri-Agent 矩阵 |

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

- [ ] **Step 0.1.1: 编写 `uploadSimple` 限流重试、退避中断与兼容别名的红灯单元测试**
  在 `tests/transport/resumable-uploader.test.ts` 中编写测试：
  - 测试 `uploadSimple` 在遇到 429 / 503 时解析 `Retry-After`（秒数与 HTTP-Date）并重试，超过 5 次熔断；
  - 测试 `AbortSignal` 触发时能立即打断退避等待并上抛中断异常；
  - 测试 `uploadDocumentToOneDrive` 在 3 参调用、4 参调用以及参数错序时正确兼容转发。
- [ ] **Step 0.1.2: 运行测试验证失败 (RED)**
  运行 `bun test tests/transport/resumable-uploader.test.ts`，确认因缺少重试与方法缺失报错。
- [ ] **Step 0.1.3: 实现 `uploadSimple` 加固逻辑与可中断退避辅助函数**
  在 `src/transport/substrate-uploader.ts` 中实现：
  - `sleepInterruptible(ms, signal)` 监听 `abort` 事件；
  - `uploadSimple` 包含 429/503 重试循环、`Retry-After` 解析与 AbortSignal 检查；
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
  - 测试 >4MB 文件路由至 `createUploadSession`；
  - 测试以严格的 8,192,000 字节循环发送 PUT 分块，携带 `Content-Range` 与 `Prefer: ExtractTextOnCommit`；
  - 测试依据模拟服务端返回的 202 (`nextExpectedRanges`) 推进下一分块，末尾分块返回 201 (`DriveItem`)；
  - 测试单分块重试上限 (5 次) 熔断与网络中断流转。
- [ ] **Step 0.2.2: 实现 `uploadResumable` 分块状态机**
  将规范 §3.1 中的分块状态机逻辑完整落入 `src/transport/substrate-uploader.ts`。
- [ ] **Step 0.2.3: 运行测试验证全量通过 (GREEN)**
  运行 `bun test tests/transport/resumable-uploader.test.ts` 确保简易与分块测试 100% 绿灯。
- [ ] **Step 0.2.4: 提交 Phase 0 代码变更**
  执行 `git commit -m "feat(transport): implement pure protocol resumable chunked upload and hardened uploadSimple"`。

#### Task 0.3: Phase 0 边界实测与假说验证 (3.9MB vs 4.1MB Boundary Experiment)
**Files:**
- Create: `CPH-PI/scripts/test-upload-boundary.ts`
- Output: `CPH-PI/.docs/evidence/upload-boundary-experiment-results.json`

- [ ] **Step 0.3.1: 编写 3.9MB 与 4.1MB 纯协议对比上传测试脚本**
  通过真实 Graph API 上传构造的 3.9MB 文本与 4.1MB 文本，记录各自走 `/content` 还是 `createUploadSession`，以及是否成功组装附件。
- [ ] **Step 0.3.2: 记录实验数据并落盘至证据库**
  将边界命中结果与卡片组装状态记录至证据文件，若发现云端阈值与 4MB 假说存在差异，调整 `CLIENT_SPLIT_THRESHOLD_HYPOTHESIS`。

---

### Phase 1: SharePoint 物理同步引擎与受控依赖 (`sp-sync-engine.ps1`)

#### Task 1.1: 落地 `sp-sync-engine.ps1` 核心同步逻辑与受控 PnPSession 集成
**Files:**
- Create: `CPH-PI/scripts/sp-sync-engine.ps1`
- Reference: `CPH-PI/scripts/lib/PnPSession.psm1`
- Create: `CPH-PI/tests/scripts/sp-sync-engine.test.ts`

**Interfaces:**
- Produces:
  CLI 命令行调用：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/sp-sync-engine.ps1 -Action <SyncWorkspace|SyncSingleFile> -SiteUrl <url> -TargetFolder <folder> ...`

- [ ] **Step 1.1.1: 编写 `sp-sync-engine.ps1` 的执行环境与参数解析断言**
  - 在 `scripts/sp-sync-engine.ps1` 中落地 PowerShell 5.1 版本硬断言：
    ```powershell
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
      throw "FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+)。"
    }
    ```
  - 引用受控 Vendored 模块 `scripts/lib/PnPSession.psm1`；
  - 实现 `SyncSingleFile`（单文件更新）与 `SyncWorkspace`（基于 `git ls-files` 增量推送）。
- [ ] **Step 1.1.2: 编写 CI 离线 Mock 传输层与单元测试**
  在 `tests/scripts/sp-sync-engine.test.ts` 中：
  - 构造 `MockSharePointSyncClient`，模拟网络抖动、重试 3 次与失败写入 `.cph/state/dirty-sync.jsonl`；
  - 断言 PS5.1 启动命令与参数格式。
- [ ] **Step 1.1.3: 运行测试并验证通过 (GREEN)**
  运行 `bun test tests/scripts/sp-sync-engine.test.ts`。
- [ ] **Step 1.1.4: 提交 Phase 1 代码变更**
  执行 `git commit -m "feat(pnp): implement sp-sync-engine.ps1 with PS5.1 assertion and CI mock support"`。

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

- [ ] **Step 2.1.1: 编写全景快照器的单元测试**
  - 断言过滤逻辑：排除 `.docs/`, `package/`, `dist/`, `.cph/`, `node_modules/`；排除 `.env*`, `*tokens.json`, `*-session.json`, `*.pem`, `*.key`；
  - 断言 9 大核心源码（`session-manager.ts`, `execution-ledger.ts`, `token-manager.ts`, `PnPSession.psm1`, 4 个提示词等）必在快照内；
  - 断言对含有敏感私钥/Token 的内容触发阻断并报错；
  - 验证本仓库实测生成的文件数（151 个源文件）与产物大小（~1.30 MiB）。
- [ ] **Step 2.1.2: 实现 `SnapshotGenerator` 全景生成与密钥扫描**
  在 `src/workspace/snapshot-generator.ts` 中实现：
  - 基于 `git ls-files -z` 的跨平台枚举；
  - 原始二进制 Buffer SHA256 哈希计算；
  - 内容级密钥扫描与 9 项核心源码存在性硬门禁。
- [ ] **Step 2.1.3: 实现子代理局部微切片组装逻辑 (`generateScopedSubagentSlice`)**
  仅提取目标文件及其导入接口定义，生成 10~30KB 的聚焦微切片。
- [ ] **Step 2.1.4: 运行测试并验证通过 (GREEN)**
  运行 `bun test tests/workspace/snapshot-generator.test.ts`。
- [ ] **Step 2.1.5: 提交 Phase 2 代码变更**
  执行 `git commit -m "feat(workspace): implement git-aware SnapshotGenerator and scoped slice generator"`。

---

### Phase 3: Orchestrator 挂载通道与生命周期闭环集成 (Pipeline Integration)

#### Task 3.1: Orchestrator 全景快照挂载与单点攻坚指纹头下发
**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/dual-layer-lifecycle.test.ts`

**Interfaces:**
- Consumes: `SnapshotGenerator.generateWorkspaceSnapshot`, `SubstrateUploader.uploadDocumentAuto`
- Produces:
  - Turn 1 会话启动时全自动上传并挂载 `workspace-v1.txt`；
  - 单点测试绿灯后，下发极简物理指纹头 `[WORKSPACE STATE UPDATE]` 并异步触发 PnP 单文件同步；
  - Handoff 时单调递增生成并投递 `workspace-v2.txt`。

- [ ] **Step 3.1.1: 编写双层流生命周期端到端对账测试**
  在 `tests/agent/dual-layer-lifecycle.test.ts` 中：
  - 模拟 Turn 1 注入全景附件注解；
  - 模拟 Turn 2 编码完成且单测绿灯，拦截全量上传，下发 5 行物理指纹头；
  - 模拟 Handoff 生成递增版本快照；
  - 确认现有 `uploadDocumentToOneDrive` 调用无损兼容。
- [ ] **Step 3.1.2: 在 `Orchestrator` 与 `SubagentRunner` 中集成双层流逻辑**
  - 首轮会话检测并挂载快照；
  - 局部编码门禁通过后调用 `sp-sync-engine.ps1` 异步增量同步；
  - 平滑平移调用点至 `SubstrateUploader.uploadDocumentAuto`。
- [ ] **Step 3.1.3: 运行测试并验证通过 (GREEN)**
  运行 `bun test tests/agent/dual-layer-lifecycle.test.ts`。
- [ ] **Step 3.1.4: 提交 Phase 3 代码变更**
  执行 `git commit -m "feat(agent): integrate dual-layer snapshot lifecycle and fingerprint header in Orchestrator"`。

---

### Phase 4: Tri-Agent 系统提示词与专有 Skills 重构 (Prompts & Skills Overhaul)

#### Task 4.1: 重写三大 Agent 提示词
**Files:**
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-researcher-agent-prompt.txt`
- Modify: `CPH-PI/cph-coder-agent-prompt.txt`
- Create: `CPH-PI/tests/skills/tri-agent-governance.test.ts`

- [ ] **Step 4.1.1: 编写提示词治理测试**
  - 断言 `cph-main-agent-prompt.txt` 包含全景快照认知与 DAG 因果时序屏障；
  - 断言 `cph-researcher-agent-prompt.txt` 专注于单点局部微切片审查；
  - 断言 `cph-coder-agent-prompt.txt` 专注于局部补丁与测试绿灯闭环；
  - 检查无“严禁”、“切勿”等负面禁止词，全面符合正向引导准则。
- [ ] **Step 4.1.2: 重构三大提示词文本**
  依据规范 §7 重写三个提示词文件，确立上帝视野与职责边界。
- [ ] **Step 4.1.3: 运行治理测试验证通过 (GREEN)**
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
  执行 `git commit -m "feat(prompts): overhaul Tri-Agent prompts and subagent/handoff skills with DAG causality"`。

---

### Phase 5: 全量回归、构建打包与实战对账 (Verification & Packaging)

#### Task 5.1: 全量测试套件回归与物理对账
**Files:**
- Modify: `CPH-PI/.docs/CHANGE-REQUEST.md` (标记为实施完成)

- [ ] **Step 5.1.1: 执行全量单元测试与集成测试**
  运行 `bun test`，确保全仓测试用例 100% 绿灯（目标用例数 ≥ 520 项，断言数 ≥ 2300）。
- [ ] **Step 5.1.2: 执行构建打包与制品产出**
  运行 `bun run package` 与 `bun run build:package`，确保分发制品 `package/` 与 `dist/` 编译通过。
- [ ] **Step 5.1.3: 更新变更请求台账并终审提交**
  更新 `CHANGE-REQUEST.md` 中的 `CR-2026-10-19-01` 状态为“实施完成 (Completed & Verified)”，提交并汇报用户。
