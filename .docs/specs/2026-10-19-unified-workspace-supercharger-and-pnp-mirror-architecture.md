# 综合技术架构规范：全工作区源码快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片隔离体系 (Unified Workspace Supercharger, Resumable Upload, SharePoint Mirror & Scoped Subagent Architecture)

> **设计日期**: 2026-10-19  
> **文档状态**: 终审已批准待实施 (Final Approved - Ready for Implementation)  
> **关联分支**: `feat/workspace-snapshot-supercharger`  
> **实测证据基座**:  
> 1. 宿主 9222 端口 100MB 真实大文件分块抓包 (`upload-network-trace.json`)  
> 2. `GPT-6.1 Sol` 4MB 源码快照 3 跳跨文件因果推演 100% 盲测实证 (`rag-boundary-experiment-results.json`)  
> **核心开发准则**: 严格遵循《AGENTS.md》Harness 纯粹中立性、纯协议零 CDP、状态持久化与工作内存正交解耦、正向认知塑形与正交 DAG 调度。

---

## 1. 执行摘要与实测物理基座 (Executive Summary & Empirical Foundation)

本架构综合前期的底层逆向与实证测试，彻底解决 Copilot 编程智能体在复杂大型工程中的**全景视野盲区**、**大文件传输截断**、**云端爬虫高延迟**、**快照时效性崩塌**以及**子代理认知污染**五大系统性难题。

### 1.1 实测物理证据一：传输管道双轨分水岭 (Dual-Track Upload Pipeline)
通过 9222 端口对微软云端真实大文件传输的完整抓包对账，确立了传输管道的物理硬边界：
* **简易直传通道 (≤ 4MB)**：
  单次 `PUT https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads:/{fileName}:/content`，毫秒级快速落盘；
* **断点分块直传通道 (> 4MB)**：
  1. `POST /me/drive/special/copilotuploads:/{name}:/createUploadSession` 获取专属 `uploadUrl`；
  2. 客户端以严格的 **`8,192,000` 字节 (8,000 KB)** 步长循环发起分块 `PUT` 请求；
  3. 中间分块返回 `202 Accepted`，末尾分块返回 `201 Created`，返回持久化 `DriveItem` 元数据；
  4. 调用 `POST /searchservice/api/v1/unfurl?domain=File` 组装即时附件卡片。
* **物理吞吐性能**：100MB 文本在企业通道中仅耗时 24 秒全量落盘，平均吞吐达 ~4.2 MB/s。

### 1.2 实测物理证据二：Substrate 云端 RAG + GPT-6.1 Sol 真实语义边界
针对“云端 RAG 是否仅具备单跳关键词检索”的疑虑，在包含 12 万行代码干草堆的 4.00 MB 代码快照中，埋入物理间隔约 1.5MB 的 3 跳跨文件因果链（`PaymentGatewayService` ➔ `DispatcherRegistry` ➔ `KernelSecurityGuard` ➔ 异常码 `CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B`）：
* **盲测结果**：在提示词**完全不提及任何下游符号与异常代码**的前提下，`GPT-6.1 Sol` 深度思考 58.5 秒，100% 盲测推演出完整的跨文件调用链与底层异常；
* **关键机制揭秘**：模型思考链日志明确证实：初次摘要未发现直接异常时，模型在云端自主发起了**符号级多跳 Agentic 递归检索**。这证实全景代码快照具备极高的架构理解可行性。

### 1.3 核心矛盾与架构破解
1. **化解 SharePoint 爬虫延迟 (3~15 分钟)**：
   若将 SharePoint 目录作为静态知识库绑定，后台 Search Crawler 需数分钟甚至数十分钟才建立索引，无法支撑瞬息万变的开发循环。本架构采用**“双层流体系”**：SharePoint 负责无容量上限的后台物理归档，会话理解全部走**会话级附件卡片 (Instant Unfurl)**，享受云端 5~10 秒的专有切片高优先级；
2. **根除快照时效性崩塌 (Stale Snapshot Paradox)**：
   首轮 4MB 快照确立全局背景拓扑；单点编码轮次严禁重复上传全库快照，依赖本地 TDD 绿灯门禁、单文件 PnP 同步与极简物理指纹头进行状态更新；跨阶段 Handoff 单调递增产生新版本快照；
3. **子代理认知纯度防御 (Subagent Scoped Slice)**：
   恪守最小特权原则，子代理严禁接触全库快照，仅接收主会话切片派发的局部微切片（10~30KB）及前序审查文档；
4. **100% 纯协议铁律 (Pure Protocol & Zero CDP)**：
   生产运行时彻底剔除任何浏览器或 CDP 依赖，全链路基于原生 Node/Bun `fetch` 分块直传与 Chathub SignalR 原生 WebSocket。

---

## 2. 总体系统架构：双层流体系 (Dual-Layer System Architecture)

```
+-----------------------------------------------------------------------------------+
| 1. 本地执行核心 (Local Execution Core - Bun / Node)                                 |
|    - Workspace Snapshotter: 遍历真实磁盘，生成带 SHA256 指纹的代码全景快照           |
|    - Local Test Runner: 执行本地 Bun/Node 编译与单测门禁 (TDD Red/Green Guard)      |
|    - Subagent Slice Generator: 按 DAG 依赖精准抽取目标文件组装局部微切片 (10~30KB)   |
|    - Fingerprint Header Generator: 生成极简 [WORKSPACE STATE UPDATE] 状态头       |
+-----------------------------------------------------------------------------------+
           |                                                      |
           v (代码测试绿灯通过)                                     v (首轮或切片会话绑定)
+---------------------------------------+      +------------------------------------+
| 2. SharePoint 物理镜像库 (PnP Engine) |      | 3. 纯协议直传组件 (SubstrateUploader)|
|    - 运行环境: 静默 PWSH 5.1 + PnP     |      |    - 传输协议: HTTP PUT / Resumable|
|    - 核心实现: PnPSession 三级 Cookie  |      |    - ≤4MB: 单次 PUT ...:/content   |
|    - 存储路径: /sites/.../Workspaces/ |      |    - >4MB: createUploadSession 分块 |
|    - 特性: 无限容量、全量物理目录树    |      |    - 产物: AttachmentAnnotation    |
+---------------------------------------+      +------------------------------------+
                                                                  |
                                                                  v (纯 SignalR 帧注入)
                                               +------------------------------------+
                                               | 4. 原生 Chathub WebSocket 管道     |
                                               |    - 零浏览器 / 零 CDP / 纯网络流   |
                                               |    - 5~10 秒完成 Substrate 会话切片 |
                                               +------------------------------------+
```

---

## 3. 纯协议大文件分块直传引擎规范 (Pure Protocol Resumable Upload Engine)

升级 [`src/transport/substrate-uploader.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/transport/substrate-uploader.ts)，实现双通道自适应路由：

```typescript
export class SubstrateUploader {
  public static DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads";
  public static CHUNK_SIZE = 8192000; // 8,000 KB (严格 320 KiB 整数倍)

  /**
   * 纯协议自适应上传：自动根据文件体积选择简易直传或分块会话
   */
  public static async uploadDocumentAuto(
    graphAccessToken: string,
    content: Buffer | string,
    fileName: string
  ): Promise<UploadDocumentResult> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    if (buffer.length <= 4 * 1024 * 1024) {
      return await this.uploadSimple(graphAccessToken, buffer, fileName);
    }
    return await this.uploadResumable(graphAccessToken, buffer, fileName);
  }

  /**
   * 阶段二：分块流水线传输状态机 (>4MB)
   */
  private static async uploadResumable(
    graphAccessToken: string,
    buffer: Buffer,
    fileName: string
  ): Promise<UploadDocumentResult> {
    const totalBytes = buffer.length;
    const encodedName = encodeURIComponent(fileName);

    // 1. 创建 UploadSession
    const sessionRes = await fetch(`${this.DEFAULT_GRAPH_URL}:/${encodedName}:/createUploadSession`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${graphAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace", name: fileName } }),
    });
    if (!sessionRes.ok) throw new Error(`Create upload session failed: ${await sessionRes.text()}`);
    const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };

    // 2. 循环分块 PUT
    let offset = 0;
    let driveItemData: any = null;

    while (offset < totalBytes) {
      const end = Math.min(offset + this.CHUNK_SIZE, totalBytes);
      const chunk = buffer.subarray(offset, end);
      const chunkLen = chunk.length;

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${offset}-${end - 1}/${totalBytes}`,
          "Content-Length": chunkLen.toString(),
        },
        body: chunk,
      });

      if (putRes.status === 202) {
        offset = end;
      } else if (putRes.status === 201 || putRes.status === 200) {
        driveItemData = await putRes.json();
        break;
      } else {
        throw new Error(`Chunk upload failed at offset ${offset}: ${await putRes.text()}`);
      }
    }

    // 3. 解析 SPO 凭据与组装 AttachmentAnnotation
    const spoBase64 = await this.resolveSpoBase64(graphAccessToken);
    const annotationId = spoBase64 ? `SPO_${spoBase64}_${driveItemData.id}` : driveItemData.id;

    return {
      driveItemId: driveItemData.id,
      webUrl: driveItemData.webUrl,
      driveId: driveItemData.parentReference?.driveId || "",
      fileName,
      annotation: {
        id: annotationId,
        text: fileName,
        url: driveItemData.webUrl,
        messageAnnotationType: "LocalFile",
        messageAnnotationMetadata: {
          "@type": "File",
          annotationType: "File",
          fileName,
          webUrl: driveItemData.webUrl,
          driveId: driveItemData.parentReference?.driveId || "",
          fileType: fileName.split(".").pop() || "txt",
        },
      },
    };
  }
}
```

---

## 4. SharePoint 物理镜像引擎规范 (`sp-sync-engine.ps1`)

在 `CPH-PI/scripts/sp-sync-engine.ps1` 中落地，完整复用已验证的 `Library/LTK/` 模块：

### 4.1 核心环境与依赖
* **执行壳**: 系统内置 Windows PowerShell 5.1 (`System32\WindowsPowerShell\v1.0\powershell.exe`)；
* **模块加载**: 显式加载 `PnP.PowerShell` v1.12.0；
* **三级认证**: 引入 `PnPSession.psm1`，优先读取 `~/.ltk-shipschedule-session.json` 磁盘缓存与 WinINet 注册表 Cookie，确保纯后台静默运行。

### 4.2 接口操作模式
```powershell
param(
  [Parameter(Mandatory)][ValidateSet("SyncWorkspace", "SyncSingleFile")][string]$Action,
  [string]$LocalPath,
  [string]$FilePath,
  [Parameter(Mandatory)][string]$SiteUrl,
  [Parameter(Mandatory)][string]$TargetFolder,
  [switch]$VerboseLog
)

# 1. 增量镜像全库 (用于阶段开局与里程碑备份)
if ($Action -eq "SyncWorkspace") {
  # 遍历本地文件 (自动排除 node_modules, .git 等)，利用 CSOM SaveBinaryDirect 增量同步
}

# 2. 单文件毫秒级推送 (用于单点编码 TDD 绿灯后增量同步)
if ($Action -eq "SyncSingleFile") {
  # 直接将指定单文件以流方式直传至 SharePoint 对应目录
}
```

### 4.3 异步解耦与对账
* 本地 Harness 通过子进程异步触发 `pwsh -File sp-sync-engine.ps1`；
* 同步失败自动重试 3 次（间隔 5s），仍失败则静默记录至 `.cph/state/dirty-sync.jsonl`，**绝不阻塞**前台推理对话；下一轮单测绿灯时统一批量对账补推。

---

## 5. 工作区快照与子代理微切片生成器规范 (Snapshot & Scoped Slice Generator)

落地于 `src/workspace/snapshot-generator.ts`：

### 5.1 全景快照生成规范 (`generateWorkspaceSnapshot`)
1. **严苛过滤门禁**:
   - 自动解析 `.gitignore`；
   - 强制排除非代码目录：`node_modules/`, `dist/`, `.git/`, `.cph/`, `.vscode/`, `bin/`, `obj/`, `coverage/`, `build/`；
   - 强制剔除不可读原生二进制：`.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.pdb`, `.class`, `.pyc`, `.zip`, `.tar` 以及图片多媒体；
   - 白名单支持常用源码：`.ts`, `.tsx`, `.js`, `.jsx`, `.cs`, `.py`, `.ps1`, `.psm1`, `.json`, `.md`, `.sql`, `.html`, `.css`, `.yaml`, `.toml`, `.sh`；
2. **格式化封装**:
   - 头部生成 **TOC 目录树与全库 SHA256 指纹**；
   - 每个文件以清晰的 `FILE: <rel-path> (Lines: N)` 作为结构分隔符；
   - 设立 **100MB 物理硬上限**，防止极端情况打爆 Node/Bun 内存。

### 5.2 子代理局部微切片生成规范 (`generateScopedSubagentSlice`)
为贯彻**最小特权与注意力聚焦**原则：
* **输入契约**: 接收子工单指定的 `targetFiles`（1~3 个文件）与可选的 `prerequisiteReports`（前序 Researcher 审查文档）；
* **输出文件**: `.cph/cache/slices/subagent-slice-task-<id>.txt`（仅 10KB ~ 30KB）；
* **会话绑定**: 由 `SubstrateUploader` 毫秒级直传为专有附件，注入子代理会话的 `annotations`；
* **物理效果**: 子代理在纯净、无任何无关代码干扰的工作内存中专注于当前模块的攻坚。

---

## 6. 三阶段生命周期流转与状态同步协议 (Lifecycle Protocols)

```
【阶段一：全局开局】Turn 1
本地磁盘 ───> snapshot-generator ───> workspace-v1.txt (4MB)
                   │
                   ├──> SubstrateUploader (纯协议分块直传) ──> AttachmentAnnotation
                   │                                                  │
                   │                                                  v
                   │                              Chathub WebSocket (纯 SignalR 帧)
                   │                                                  │
                   v (后台异步)                                        v
          PnP 物理镜像推送到 SharePoint               Copilot (GPT-6.1 Sol) 获得全局全景视野
-----------------------------------------------------------------------------------------
【阶段二：单点攻坚编码】Turn 2 ~ N (高频快跑循环)
1. Copilot 输出局部代码/补丁 (如 src/billing/tax.ts)
2. 本地 Harness 拦截代码 ➔ 本地打补丁 ➔ 执行本地验证 (`bun test` / `tsc`)
   ├── [验证失败 RED] ──> 本地拦截！SharePoint 绝不更新！
   │                     将具体错误反馈给 Copilot 闭环修复。
   └── [验证通过 GREEN] ─> 
         ├── PnP 后台毫秒级将该单文件更新到 SharePoint 真实目录树；
         └── 本地 Harness 下发极简物理指纹头给 Copilot：
             ```markdown
             [WORKSPACE STATE UPDATE]
             - Head: Commit 9c42b1 (v2)
             - Target: src/billing/tax.ts (Tests: 15/15 PASSED)
             - Cloud Mirror: Synced to SharePoint
             - Next Action: 推进下一个 DAG 任务
             ```
   *(注：单点编码轮次严禁重复上传 4MB 快照！模型以首轮快照为背景拓扑，以指纹头和当前修改文件为最新真实事实)*
-----------------------------------------------------------------------------------------
【阶段三：里程碑收敛与跨会话接力】Handoff / Subagent
当一个战役里程碑达成、上下文窗口饱和或需要换子代理接力时：
1. 本地生成全新的递增快照 `workspace-v2.txt`；
2. 纯协议直传 `workspace-v2.txt`；
3. 新会话以 `workspace-v2.txt` 为附件开局，彻底洗净历史对话包袱，版本单调递增，无任何旧历史干扰。
```

---

## 7. Tri-Agent 认知推倒重塑与因果感知调度 (Tri-Agent Cognition & DAG Scheduling)

全面废除旧模式下盲目摸黑探查的提示词逻辑，重构为具备上帝视角的三大 Agent 矩阵：

### 7.1 Main Agent (`cph-main-agent-prompt.txt`) 重塑
* **首轮终局立桩**：在 Turn 1 依据挂载的全景快照，直接产出包含所有切片与依赖关系的完整 `plan.md`；
* **统帅职责纯粹化**：专注于全局架构把控、DAG 依赖分析、任务切片派发、单测结果审查与终局收敛对账。

### 7.2 Subagent 职责与切片契约
* **Researcher (`cph-researcher-agent-prompt.txt`)**:
  - 定位为纯粹的“单点深度攻坚分析锤”；
  - 挂载微切片附件（≤300 行目标代码），专注于热核级代码审查、漏洞分析与状态机竞争条件逆向，输出结构化审查报告；
* **Coder (`cph-coder-agent-prompt.txt`)**:
  - 外科手术级代码实施与自动化测试闭环验证专家；
  - 挂载局部源码与单测微切片，专注于局部补丁输出与本地测试绿灯验证。

### 7.3 通用因果依赖与正交调度准则 (DAG Causality & Dependency Awareness)
主控在任务派发中全面建立有向无环图因果时序感知，坚决杜绝盲目并发：
1. **多元依赖与阶段屏障 (Stage Barrier)**：
   - **契约先于实现**：接口定义与数据契约确立后，下游实现方可开工；
   - **底座先于应用**：公共类库打桩就绪后，上层业务方可接入；
   - **研判先于重构**：调研走查报告产出并经主控在会话中综合提炼后，方可派发编码工单；
   - **实施先于集成**：各独立模块单测全绿后，方可调度集成测试；
2. **正交任务满额并发 (Orthogonal Concurrency)**：
   - 当多个子任务负责互不重叠的文件集合且输入输出相互独立时，并行派发 Worker 集群，达成安全高吞吐。

---

## 8. 专有专属 Skills 重构规范 (Dedicated Skills Overhaul)

### 8.1 `skills/subagent/SKILL.md` 重构要点
1. **废除斥候探查机制**：全面升级为基于 DAG 因果依赖的工单派发指南；
2. **规范局部微切片工单标准**：明确写入子代理工单必须声明 `targetFiles` 与 `prerequisiteContext`，强制约束子代理认知边界；
3. **因果时机控制门禁 (Gate 5)**：要求主控派发前核对依赖关系，合理使用阶段屏障（`stage: 1 ➔ stage: 2`）。

### 8.2 `skills/handoff/SKILL.md` 微调要点
1. **接力智能体防失忆契约**：明确写入：
   > “接力智能体处于既定战役的攻坚推进期，天然继承工作区已有的 `plan.md` 物理清单与全景快照视野，直接依据 P0/P1 待办推进单点补缺或对账收敛，无需重新向用户确认初始工程目标”；
2. **全景快照无缝对齐**：接力启动时由 Harness 全自动投递递增版本快照（`workspace-vN.txt`），确保交接文档与云端代码事实绝对一致。

---

## 9. 异常矩阵与自动化降级 (Fault-Tolerance Matrix)

| 故障场景 | 物理表现 | 自动化对账与降级策略 |
|---|---|---|
| **PnP 网络抖动** | SharePoint CSOM 上传超时 | 重试 3 次 (间隔 5s)；仍失败则记入本地 Dirty Ledger，绝不阻塞当前会话，下一轮测试绿灯时自动补推 |
| **Cookie 凭据过期** | SharePoint 报 401/403 | 自动触发 `PnPSession` 三级 Cookie 降级读取 (磁盘 ➔ WinINet)；无法静默恢复时提示操作者 |
| **大文件分块中断** | HTTP 传输在某一分块断开 | 依据 `createUploadSession` 返回的 `nextExpectedRanges`，自动执行 HTTP Range 增量断点续传 |
| **单测死循环** | `bun test` 运行超 30s | 强制触发 SIGKILL 硬超时，捕获超时堆栈回传模型，拦截云端同步 |
| **补丁损坏 / 格式漂移**| Patch 无法在本地干净命中 | 本地校验拦截，不写磁盘，以标准格式错误协议要求模型基于唯一上下文重新生成 |

---

## 10. 分阶段实施路线图 (Phased Implementation Roadmap)

### Phase 0: 纯协议大文件分块直传模块 (Resumable Upload Engine)
- 在 `src/transport/substrate-uploader.ts` 实现 `createUploadSession` 与 8,000 KB 分块 PUT 状态机；
- 编写 `tests/transport/resumable-uploader.test.ts`，验证纯 HTTP 状态流转与断点续传。

### Phase 1: SharePoint 物理同步引擎与静默脚本 (`sp-sync-engine.ps1`)
- 在 `scripts/sp-sync-engine.ps1` 中集成 `PWSH 5.1 + PnP 1.12.0` 与 `PnPSession.psm1`；
- 编写集成测试验证本地与 SharePoint 目录树的增量镜像与单文件推送。

### Phase 2: 工作区全景快照与子代理微切片生成器 (Snapshot & Slice Generators)
- 在 `src/workspace/snapshot-generator.ts` 实现全景快照（100MB 物理上限）与局部微切片组装逻辑；
- 编写 `tests/workspace/snapshot-generator.test.ts` 验证白名单过滤与切片隔离。

### Phase 3: Orchestrator 挂载通道与生命周期闭环集成 (Pipeline Integration)
- 在 `Orchestrator` 中串联首轮全景投递、单点攻坚 TDD 红绿门禁、指纹头下发与 Handoff 快照递增；
- 编写端到端对账测试 `tests/agent/dual-layer-lifecycle.test.ts`。

### Phase 4: Tri-Agent 系统提示词与专有 Skills 重构 (Prompts & Skills Overhaul)
- 推倒重写 `cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`cph-coder-agent-prompt.txt`；
- 重构 `skills/subagent/SKILL.md` 与微调 `skills/handoff/SKILL.md`；
- 编写提示词与技能治理测试 `tests/skills/tri-agent-governance.test.ts`。

### Phase 5: 全量回归、构建打包与实战对账 (Verification & Packaging)
- 运行 `bun test` 确保全量测试套件 100% 绿灯；
- 运行 `bun run package; bun run build:package` 产出最终分发制品。
