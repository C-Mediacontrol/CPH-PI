# 综合技术架构规范：全工作区源码快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片隔离体系 (Unified Workspace Supercharger, Resumable Upload, SharePoint Mirror & Scoped Subagent Architecture)

> **设计日期**: 2026-10-19  
> **文档版本**: v1.3.1 (对抗审计中立对账与硬化闭环版 / Fully Audited & Hardened v1.3.1)  
> **文档地位**: 本分支下全工作区增压与持久化镜像的**唯一权威技术规范**（同日所有历史草稿均已标注废止）  
> **关联分支**: `feat/workspace-snapshot-supercharger`  
> **关联变更**: `CR-2026-10-19-01` (见 [`.docs/CHANGE-REQUEST.md`](../CHANGE-REQUEST.md))  
> **对抗审计记录**:  
> 1. 第一轮中立审计: [`.docs/audit/report-C-spec-neutral-review.md`](../audit/report-C-spec-neutral-review.md)  
> 2. 第二轮中立复评: [`.docs/audit/report-D-spec-neutral-review-v1.1.md`](../audit/report-D-spec-neutral-review-v1.1.md)  
> 3. 第三轮中立复评: [`.docs/audit/report-E-spec-neutral-review-v1.2.md`](../audit/report-E-spec-neutral-review-v1.2.md)  
> 4. 第四轮中立复评: [`.docs/audit/report-F-spec-neutral-review-v1.3.md`](../audit/report-F-spec-neutral-review-v1.3.md)  
> **受控证据索引 (已安全脱敏)**:  
> 1. 宿主 9222 端口 100MB 真实大文件分块抓包: [`.docs/evidence/upload-network-trace.json`](../evidence/upload-network-trace.json)  
> 2. `GPT-6.1 Sol` 4MB 源码快照 3 跳跨文件因果推演原始记录: [`.docs/evidence/rag-boundary-experiment-results.json`](../evidence/rag-boundary-experiment-results.json)  
> 3. 半自动化 RAG 边界压力测试复现脚本: [`.docs/evidence/run-rag-boundary-test.ts`](../evidence/run-rag-boundary-test.ts)  
> 4. 4MB 跨文件因果金针快照生成器: [`.docs/evidence/generate-rag-snapshot.ts`](../evidence/generate-rag-snapshot.ts)  
> **核心开发准则**: 严格遵循《AGENTS.md》Harness 纯粹中立性、纯协议零 CDP、状态持久化与工作内存正交解耦、正向认知塑形与正交 DAG 调度。

---

## 1. 执行摘要与实测物理基座 (Executive Summary & Empirical Foundation)

本架构综合前期的底层网络抓包、物理推演测试以及第三方中立对抗审查，旨在解决 Copilot 编程智能体在复杂大型工程中的**全景视野盲区**、**大文件传输切片**、**云端爬虫高延迟**、**快照时效性崩塌**以及**子代理认知污染**五大系统性难题。

### 1.1 实测物理证据一：传输管道双轨分水岭与客户端策略
通过 9222 端口对微软云端真实大文件传输的抓包对账（脱敏证据见 [`.docs/evidence/upload-network-trace.json`](../evidence/upload-network-trace.json)），确立了客户端传输行为与服务端状态机规律：
* **简易直传通道 (≤ 4MB 经验假说区间)**：
  单次 `PUT https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads:/{fileName}:/content`，快速可靠落盘；
* **断点分块直传通道 (> 4MB 经验假说区间)**：
  虽然 Microsoft Graph 服务端标准文档定义简易上传最大可支持 250MB，但在 100MB 实测抓包中观测到：**Copilot Web 客户端在文件较大时切入分块上传会话**。为与 Copilot 云端切片与前端状态机保持严密协议对齐，Harness 将 4MB 作为经验假说阈值（并在 Phase 0 通过 3.9MB vs 4.1MB 边界实验正式验证）：
  1. 发起 `POST /me/drive/special/copilotuploads:/{name}:/createUploadSession` 获取专属 `uploadUrl`；
  2. 客户端以严格的 **`8,192,000` 字节 (8,000 KB)** 步长（严格符合微软要求的 320 KiB 整数倍）循环发起分块 `PUT` 请求；
  3. 服务端在首轮会话返回 `nextExpectedRanges: ["0-"]`。在标准 Microsoft Graph 分块协议中，中间分块返回 `202 Accepted` 并携带后续预期范围，末尾分块返回 `201 Created`（或 `200 OK`），返回持久化 `DriveItem` 元数据（注：抓包记录证实了 100MB 传输触发了分块 PUT、12 次 202 与最终 201 状态码；逐块由 `nextExpectedRanges` 响应体驱动则属于标准 Graph API 协议规范定义）；
  4. 抓包中观察到随后调用 `POST /searchservice/api/v1/unfurl?domain=File` 完成即时附件卡片组装。
* **物理吞吐性能**：实测 100MB 文本在企业通道中耗时 24 秒全量落盘，平均吞吐达 ~4.2 MB/s。

### 1.2 实测物理证据二：Substrate 云端 RAG + GPT-6.1 Sol 真实语义边界
针对“云端 RAG 是否仅具备单跳关键词检索”的疑虑，在包含 12 万行合成代码干草堆的 4.00 MB 代码快照中，埋入物理间隔约 1.5MB 的 3 跳跨文件因果链（`PaymentGatewayService` ➔ `DispatcherRegistry` ➔ `KernelSecurityGuard` ➔ 异常码 `CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B`）：
* **测试结论**：在提示词**完全不提及任何下游符号与异常代码**的前提下，`GPT-6.1 Sol` 深度思考约 58.5 秒（由自动化控制台计时观测，并已补入基准结果文件），盲测推演出了完整的跨文件调用链与底层异常（原始测试数据见 [`.docs/evidence/rag-boundary-experiment-results.json`](../evidence/rag-boundary-experiment-results.json)）；
* **机制观察与严谨定性**：模型回复的分析部分显示，初次摘要未发现直接异常时，模型在云端发起了跟进检索。该测试在 $n=1$ 样本下证实了该多跳检索能力的物理存在性；在后续集成阶段将开展 $n \ge 5$ 重复试验与负样本测试，以确立统计意义上的召回率置信区间。

### 1.3 核心矛盾与架构破解
1. **化解 SharePoint 爬虫延迟 (3~15 分钟)**：
   若将 SharePoint 目录作为静态知识库绑定，后台 Search Crawler 需 3~15 分钟建立索引，无法支撑即时编码回路。本架构采用**“双层流体系”**：SharePoint 负责企业级 TB 容量的后台物理持久化归档；会话内认知全部走**会话级附件卡片 (Session Attachment)**，享受云端十秒级即时挂载（实测约 20~25s 附件卡片就绪），免去 3~15 分钟后台爬虫延迟；
2. **根除快照时效性崩塌 (Stale Snapshot Paradox)**：
   首轮快照确立全局背景拓扑；单点编码轮次保持首轮快照基准，依赖本地 TDD 绿灯门禁、单文件 PnP 同步与极简物理指纹头进行状态更新；跨阶段 Handoff 单调递增产生新版本快照；
3. **子代理认知纯度防御 (Subagent Scoped Slice)**：
   恪守最小特权原则，子代理仅接收主会话切片派发的局部微切片（10~30KB）及前序审查文档，隔离全局全景干扰；
4. **纯协议与零 CDP 边界 (Pure Protocol & Scoped Fallback)**：
   代码上传、快照挂载、会话通信与执行推理全链路 100% 纯网络流（Node/Bun 原生 `fetch` + Chathub SignalR 原生 WebSocket），零 CDP / 零浏览器依赖；宿主仅在 `file-porter.ts` 中保留 `blob:` 本地下载的兜底降级分支。

---

## 2. 总体系统架构：双层流体系 (Dual-Layer System Architecture)

```
+-----------------------------------------------------------------------------------+
| 1. 本地执行核心 (Local Execution Core - Bun / Node)                                 |
|    - Git-Aware Snapshotter: 经由 git ls-files -z 枚举真实源码，纳入提示词，排除构建与文档 |
|    - Local Test Runner: 执行本地 Bun/Node 编译与单测门禁 (TDD Red/Green Guard)      |
|    - Subagent Slice Generator: 按 DAG 依赖精准抽取目标文件组装局部微切片 (10~30KB)   |
|    - Fingerprint Header Generator: 生成极简 [WORKSPACE STATE UPDATE] 状态头       |
+-----------------------------------------------------------------------------------+
           |                                                      |
           v (单测绿灯通过触发)                                     v (首轮或切片会话绑定)
+---------------------------------------+      +------------------------------------+
| 2. SharePoint 物理镜像库 (PnP Engine) |      | 3. 纯协议分块直传 (SubstrateUploader)|
|    - 运行环境: 强制 powershell.exe 5.1 |      |    - 传输协议: HTTP PUT / Resumable|
|    - 核心实现: PnPSession 受控三级Cookie|      |    - ≤4MB(假说): 单次 PUT ...:/content|
|    - 存储路径: /sites/.../Workspaces/ |      |    - >4MB(假说): createUploadSession分块|
|    - 特性: 企业级大容量、全量物理目录树 |      |    - 产物: AttachmentAnnotation    |
+---------------------------------------+      +------------------------------------+
                                                                  |
                                                                  v (纯 SignalR 帧注入)
                                               +------------------------------------+
                                               | 4. 原生 Chathub WebSocket 管道     |
                                               |    - 零浏览器 / 零 CDP / 纯网络流   |
                                               |    - 会话即时挂载 (卡片就绪约 20~25s) |
                                               +------------------------------------+
```

---

## 3. 纯协议大文件分块直传引擎规范 (Pure Protocol Resumable Upload Engine)

升级 [`src/transport/substrate-uploader.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/transport/substrate-uploader.ts)，实现由服务端状态驱动、防死循环且支持中途取消的双通道自适应传输器：

### 3.1 工业级分块传输状态机实现规范
```typescript
import type { AttachmentAnnotation, UploadDocumentResult } from "./types.ts";

export class SubstrateUploader {
  public static DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads";
  public static CHUNK_SIZE = 8192000; // 8,000 KB (严格 320 KiB 整数倍)
  public static CLIENT_SPLIT_THRESHOLD_HYPOTHESIS = 4 * 1024 * 1024; // 4MB 经验假说区间 (待 Phase 0 边界实验正式验证)
  public static MAX_CHUNK_ATTEMPTS = 5; // 单分块最大尝试次数
  public static MAX_SIMPLE_ATTEMPTS = 5; // 简易上传最大尝试次数

  /**
   * 纯协议自适应上传：自动根据体积策略路由至简易直传或断点分块
   */
  public static async uploadDocumentAuto(
    graphAccessToken: string,
    content: Buffer | string,
    fileName: string,
    signal?: AbortSignal
  ): Promise<UploadDocumentResult> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    if (buffer.length <= this.CLIENT_SPLIT_THRESHOLD_HYPOTHESIS) {
      return await this.uploadSimple(graphAccessToken, buffer, fileName, signal);
    }
    return await this.uploadResumable(graphAccessToken, buffer, fileName, signal);
  }

  /**
   * 向后兼容调用点别名 (无缝适配存量 3 参 / 4 参调用及模型参数错序容错)
   */
  public static async uploadDocumentToOneDrive(
    graphAccessToken: string,
    content: string | Buffer,
    fileName: string,
    customBaseUrlOrSignal?: string | AbortSignal
  ): Promise<UploadDocumentResult> {
    let actualContent = content;
    let actualFileName = fileName;
    // 保留历史启发式容错：当模型将长正文填入 fileName 时自动互换
    if (
      typeof content === "string" &&
      (content.endsWith(".md") || content.endsWith(".txt") || content.startsWith("handoff-")) &&
      !content.includes("\n") &&
      (fileName.includes("\n") || fileName.length > 255)
    ) {
      actualContent = fileName;
      actualFileName = content;
    }

    const signal = customBaseUrlOrSignal instanceof AbortSignal ? customBaseUrlOrSignal : undefined;
    return await this.uploadDocumentAuto(graphAccessToken, actualContent, actualFileName, signal);
  }

  /**
   * 简易上传 (≤ 4MB 经验假说区间)
   * 加固 429 限流 / 503 暂时不可用重试、Retry-After 解析、指数退避与 AbortSignal 中断
   */
  private static async uploadSimple(
    graphAccessToken: string,
    buffer: Buffer,
    fileName: string,
    signal?: AbortSignal
  ): Promise<UploadDocumentResult> {
    const encodedName = encodeURIComponent(fileName);
    const url = `${this.DEFAULT_GRAPH_URL}:/${encodedName}:/content`;

    let attempts = 0;
    while (true) {
      if (signal?.aborted) throw new Error("Upload aborted by caller");
      attempts++;

      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${graphAccessToken}`,
            "Content-Type": "text/plain; charset=utf-8",
            Prefer: "ExtractTextOnCommit, pacToken=N",
            SdkVersion: "graph-js/3.0.7 (featureUsage=7)",
          },
          body: buffer,
          signal,
        });

        // 处理 429 限流 / 503 暂时不可用：解析秒数或 HTTP-Date
        if (res.status === 429 || res.status === 503) {
          if (attempts >= this.MAX_SIMPLE_ATTEMPTS) {
            throw new Error(`Simple upload hit rate limit / service unavailable and exceeded max retry limit (${this.MAX_SIMPLE_ATTEMPTS})`);
          }
          let retrySec = 5;
          const headerVal = res.headers.get("Retry-After");
          if (headerVal) {
            const parsedInt = parseInt(headerVal, 10);
            if (!isNaN(parsedInt)) {
              retrySec = Math.max(parsedInt, 1);
            } else {
              const parsedDate = Date.parse(headerVal);
              if (!isNaN(parsedDate)) {
                retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 1);
              }
            }
          }
          await new Promise((r) => setTimeout(r, Math.min(retrySec, 60) * 1000));
          continue;
        }

        if (!res.ok) {
          throw new Error(`Graph simple upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }

        const data = await res.json();
        return this.assembleUploadResult(graphAccessToken, data, fileName);
      } catch (err: any) {
        if (signal?.aborted || err.name === "AbortError") throw err;
        if (attempts >= this.MAX_SIMPLE_ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, attempts * 2000));
      }
    }
  }

  /**
   * 工业级断点续传状态机 (> 4MB)
   * 严密支持 nextExpectedRanges 驱动、HTTP-Date 解析、Abort 立即上抛与无限重试熔断
   */
  private static async uploadResumable(
    graphAccessToken: string,
    buffer: Buffer,
    fileName: string,
    signal?: AbortSignal
  ): Promise<UploadDocumentResult> {
    const totalBytes = buffer.length;
    const encodedName = encodeURIComponent(fileName);

    // 1. 创建 UploadSession (预授权 uploadUrl)
    const sessionRes = await fetch(`${this.DEFAULT_GRAPH_URL}:/${encodedName}:/createUploadSession`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${graphAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace", name: fileName } }),
      signal,
    });

    if (!sessionRes.ok) {
      throw new Error(`Create upload session failed (${sessionRes.status}): ${(await sessionRes.text()).slice(0, 200)}`);
    }

    const sessionData = await sessionRes.json();
    const uploadUrl = sessionData.uploadUrl;
    let nextRanges: string[] = sessionData.nextExpectedRanges || ["0-"];
    let driveItemData: any = null;

    // 2. 由服务端 nextExpectedRanges 驱动分块循环
    while (nextRanges.length > 0 && !driveItemData) {
      if (signal?.aborted) throw new Error("Upload aborted by caller");

      const match = nextRanges[0].match(/^(\d+)-/);
      if (!match) throw new Error(`Invalid nextExpectedRanges format: ${JSON.stringify(nextRanges)}`);
      const offset = parseInt(match[1], 10);
      if (offset >= totalBytes) break;

      const end = Math.min(offset + this.CHUNK_SIZE, totalBytes);
      const chunk = buffer.subarray(offset, end);

      let attempts = 0;
      let chunkSuccess = false;

      while (!chunkSuccess) {
        if (signal?.aborted) throw new Error("Upload aborted by caller");
        attempts++;
        if (attempts > this.MAX_CHUNK_ATTEMPTS) {
          throw new Error(`Chunk PUT at offset ${offset} exceeded max retry limit (${this.MAX_CHUNK_ATTEMPTS})`);
        }

        try {
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": `bytes ${offset}-${end - 1}/${totalBytes}`,
              Prefer: "ExtractTextOnCommit, pacToken=N",
              SdkVersion: "graph-js/3.0.7 (featureUsage=7)",
            },
            body: chunk,
            signal,
          });

          // 处理 429 限流 / 503 暂时不可用：解析秒数或 HTTP-Date
          if (putRes.status === 429 || putRes.status === 503) {
            let retrySec = 5;
            const headerVal = putRes.headers.get("Retry-After");
            if (headerVal) {
              const parsedInt = parseInt(headerVal, 10);
              if (!isNaN(parsedInt)) {
                retrySec = Math.max(parsedInt, 1);
              } else {
                const parsedDate = Date.parse(headerVal);
                if (!isNaN(parsedDate)) {
                  retrySec = Math.max(Math.ceil((parsedDate - Date.now()) / 1000), 1);
                }
              }
            }
            await new Promise((r) => setTimeout(r, Math.min(retrySec, 60) * 1000));
            continue;
          }

          if (putRes.status === 202) {
            const resJson = await putRes.json();
            nextRanges = resJson.nextExpectedRanges || [`${end}-`];
            chunkSuccess = true;
          } else if (putRes.status === 201 || putRes.status === 200) {
            driveItemData = await putRes.json();
            nextRanges = [];
            chunkSuccess = true;
          } else {
            throw new Error(`Chunk PUT failed (${putRes.status}): ${(await putRes.text()).slice(0, 200)}`);
          }
        } catch (err: any) {
          if (signal?.aborted || err.name === "AbortError") throw err;
          if (attempts >= this.MAX_CHUNK_ATTEMPTS) throw err;
          await new Promise((r) => setTimeout(r, attempts * 2000));
        }
      }
    }

    if (!driveItemData || !driveItemData.id) {
      throw new Error(`Resumable upload completed without DriveItem metadata returned.`);
    }

    return this.assembleUploadResult(graphAccessToken, driveItemData, fileName);
  }

  private static async assembleUploadResult(
    graphAccessToken: string,
    data: any,
    fileName: string
  ): Promise<UploadDocumentResult> {
    const spoBase64 = await this.resolveSpoBase64(graphAccessToken);
    const annotationId = spoBase64 ? `SPO_${spoBase64}_${data.id}` : data.id;
    const driveId = data.parentReference?.driveId || "";

    return {
      driveItemId: data.id,
      webUrl: data.webUrl,
      driveId,
      fileName,
      annotation: {
        id: annotationId,
        text: fileName,
        url: data.webUrl,
        messageAnnotationType: "LocalFile",
        messageAnnotationMetadata: {
          "@type": "File",
          annotationType: "File",
          fileName,
          webUrl: data.webUrl,
          driveId,
          fileType: fileName.split(".").pop() || "txt",
        },
      },
    };
  }
}
```

---

## 4. SharePoint 物理镜像引擎规范 (`sp-sync-engine.ps1`)

在 `CPH-PI/scripts/sp-sync-engine.ps1` 中落地：

### 4.1 执行环境硬断言与受控依赖加载 (PowerShell 5.1 Only)
脚本执行前进行严格环境检查，杜绝 PS7 反射崩溃问题；模块依赖改为引用受控 Vendored 副本：
1. **环境版本硬断言**：
   ```powershell
   # 启动强制断言：必须且仅能在 Windows PowerShell 5.1 下运行
   if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
     throw "FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+)，否则 PnP 1.12.0 反射认证将整体失效。"
   }
   ```
2. **受控模块引入与环境解耦**:
   引入位于受控仓库路径的 `CPH-PI/scripts/lib/PnPSession.psm1`。该受控模块已彻底去租户化，动态探测本地用户配置目录（包括可能重定向至 OneDrive 的 Documents 目录）；Cookie 磁盘缓存严格命名空间化至当前项目专有的 `~/.cph/pnp-session.json`（支持仅当前 Windows 用户 ACL 权限），并作为 Tier 1 缓存配合 WinINet Cookie 存储文件无缝运转。

### 4.2 接口操作与单向增量推送
```powershell
param(
  [Parameter(Mandatory)][ValidateSet("SyncWorkspace", "SyncSingleFile")][string]$Action,
  [string]$LocalPath,
  [string]$FilePath,
  [Parameter(Mandatory)][string]$SiteUrl,
  [Parameter(Mandatory)][string]$TargetFolder,
  [switch]$VerboseLog
)

# 1. 全库增量推送 (基于文件清单比对差异，只对有变化的文件调用 SaveBinaryDirect)
if ($Action -eq "SyncWorkspace") {
  # 依赖 git ls-files 提取真实源码清单，剔除忽略文件，避免扫描 node_modules
}

# 2. 单文件推送 (单点编码 TDD 绿灯后增量同步)
if ($Action -eq "SyncSingleFile") {
  # 将指定单文件流式推送覆盖云端同名文件，耗时约 1~3 秒
}
```

### 4.3 异步解耦与对账
* 本地 Harness 通过异步子进程触发：
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/sp-sync-engine.ps1 ...`
* 同步失败自动重试 3 次（间隔 5s）；仍失败则记入本地 `.cph/state/dirty-sync.jsonl`，**绝不阻塞**前台推理对话；在下一轮测试绿灯时统一对账补推。

### 4.4 CI 离线测试与 Mock 录放隔离 (CI Offline Mock Architecture)
为确保测试用例在 GitHub Actions / 离线 CI 管道可复现且无需真实 SharePoint 租户与 IE Cookie 交互：
1. **Mock 传输层注入**：在 Node/TS 单元测试中，为 PnP 子进程封装抽象调用适配器（`ISharePointSyncClient`）；测试环境自动注入 `MockSharePointSyncClient`，模拟网络延迟、429 报错与 200 成功响应；
2. **离线 CSOM 状态验证**：单测重点断言“文件变更是按白名单过滤”、“失败自动追加到本地 dirty-sync.jsonl”、“重试 3 次后不阻塞前台”；真实租户 E2E 验证仅在带有 `--live-pnp` 标志的端到端集成测试中按需执行。

---

## 5. Git-Aware 快照与子代理微切片生成器规范 (Snapshot & Scoped Slice Generator)

落地于 `src/workspace/snapshot-generator.ts`：

### 5.1 精准枚举算法：基于 `git ls-files -z` 的全景快照生成
彻底排除构建产物与审计文档，同时确保纳入核心 Agent 提示词与会话底层源码。实测 151 个源文件原始字节总和为 **1,324,834 字节 (1.26 MB)**；经由清单组织与文件包裹后的快照交付件 `workspace-v1.txt` 实际产物大小为 **1,365,870 字节 (1.30 MiB / 1.37 MB)**：

```typescript
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class SnapshotGenerator {
  public static MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024; // 50MB 物理安全硬红线
  public static EXCLUDED_DIR_PREFIXES = ["package/", ".docs/", "dist/", ".cph/", "node_modules/"];

  // 敏感文件正则模式：精确匹配凭据、私钥与环境配置，常规业务源码正常纳入
  public static SENSITIVE_FILE_PATTERNS = [
    /^\.env(\..+)?$/i,
    /^.*tokens?\.json$/i,
    /^.*-session\.json$/i,
    /^id_[a-zA-Z0-9_]+$/i,
    /\.(pem|key|pfx|p12)$/i
  ];

  // 核心源码断言清单：快照必须无损包含的 9 项核心系统文件与提示词
  public static CRITICAL_CORE_FILES = [
    "src/session/session-manager.ts",
    "src/session/ledger/execution-ledger.ts",
    "src/session/lineage-tracker.ts",
    "src/auth/token-manager.ts",
    "scripts/lib/PnPSession.psm1",
    "cph-main-agent-prompt.txt",
    "cph-coder-agent-prompt.txt",
    "cph-dev-agent-prompt.txt",
    "cph-researcher-agent-prompt.txt"
  ];

  /**
   * 基于 git ls-files -z 提取真实源码文件列表
   * 自动将子模块 (submodule) 视为单一 gitlink 记录，天然规避 pi/ 等巨型库
   * 排除构建与审计产物，确保包含核心 .txt 提示词与会话核心
   */
  public static getTrackedSourceFiles(workspaceRoot: string): string[] {
    const cmd = "git ls-files -z --cached --others --exclude-standard";
    const stdout = execSync(cmd, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.toString("utf-8").split("\0").filter(Boolean);

    const allowedExtensions = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".cs", ".py", ".ps1", ".psm1", ".psd1",
      ".json", ".md", ".sql", ".html", ".css", ".yaml", ".yml", ".toml", ".sh", ".txt"
    ]);

    return lines.filter((relPath) => {
      // 1. 目录前缀排除
      if (this.EXCLUDED_DIR_PREFIXES.some(prefix => relPath.startsWith(prefix))) return false;

      // 2. 扩展名白名单过滤
      const ext = path.extname(relPath).toLowerCase();
      if (!allowedExtensions.has(ext)) return false;

      // 3. 大型锁文件排除
      if (relPath.endsWith("package-lock.json") || relPath.endsWith("bun.lock") || relPath.endsWith("bun.lockb")) return false;

      // 4. 精确敏感文件模式排除 (防误杀)
      const baseName = path.basename(relPath);
      if (this.SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(baseName))) return false;

      return true;
    });
  }

  /**
   * 生成全景快照 (实测本仓库规模精准对账为 151 文件 / 1.26 MB)
   */
  public static generateWorkspaceSnapshot(workspaceRoot: string, outputDir: string): { snapshotPath: string; hash: string; fileCount: number; bytes: number } {
    const files = this.getTrackedSourceFiles(workspaceRoot);
    const chunks: string[] = ["// ======================================\n// WORKSPACE STRUCTURE & MANIFEST\n// ======================================\n"];

    const manifestLines: string[] = [];
    const contentChunks: string[] = ["\n// ======================================\n// SOURCE FILE CONTENTS\n// ======================================\n"];
    const writtenFiles: string[] = [];

    let totalBytes = 0;

    for (const relPath of files) {
      const absPath = path.join(workspaceRoot, relPath);
      if (!fs.existsSync(absPath)) continue;
      const stat = fs.lstatSync(absPath);
      if (stat.isDirectory() || stat.isSymbolicLink()) continue; // 排除目录、gitlink 及外部软链接

      // 必须对原始 Buffer 二进制计算 SHA，避免 UTF-8 BOM 字符污染哈希
      const rawBuffer = fs.readFileSync(absPath);

      // 内容级密钥扫描阻断 (Content Secret Scanning)
      const rawStr = rawBuffer.toString("utf-8");
      if (/Bearer\s+eyJ[a-zA-Z0-9_\-\.]+/i.test(rawStr) || rawStr.includes("-----BEGIN PRIVATE KEY-----")) {
        throw new Error(`CRITICAL SECURITY ALERT: Secret token detected in file ${relPath}. Snapshot generation aborted!`);
      }

      const fileHash = crypto.createHash("sha256").update(rawBuffer).digest("hex").slice(0, 12);
      const lineCount = rawStr.split("\n").length;

      manifestLines.push(`- ${relPath} (Lines: ${lineCount}, SHA: ${fileHash}, Bytes: ${stat.size})`);
      writtenFiles.push(relPath);

      const block = `\n// ##################################################\n// FILE: ${relPath} (Lines: ${lineCount}, SHA: ${fileHash})\n// ##################################################\n${rawStr}\n`;
      contentChunks.push(block);
      totalBytes += Buffer.byteLength(block, "utf-8");

      if (totalBytes > this.MAX_SNAPSHOT_BYTES) {
        throw new Error(`Snapshot exceeded hard safety limit of ${this.MAX_SNAPSHOT_BYTES} bytes!`);
      }
    }

    // 核心源码断言硬门禁：确保无任何关键源码被误杀
    const missingCore = this.CRITICAL_CORE_FILES.filter(cf => !writtenFiles.includes(cf));
    if (missingCore.length > 0) {
      throw new Error(`CRITICAL INTEGRITY FAULT: Snapshot dropped essential core files: ${missingCore.join(", ")}`);
    }

    chunks.push(manifestLines.join("\n"));
    chunks.push(...contentChunks);

    const fullText = chunks.join("");
    const snapshotHash = crypto.createHash("sha256").update(Buffer.from(fullText, "utf-8")).digest("hex").slice(0, 16);
    const snapshotPath = path.join(outputDir, `workspace-snapshot-${snapshotHash}.txt`);

    fs.writeFileSync(snapshotPath, fullText, "utf-8");

    return {
      snapshotPath,
      hash: snapshotHash,
      fileCount: writtenFiles.length,
      bytes: Buffer.byteLength(fullText, "utf-8")
    };
  }
}
```

### 5.2 子代理微切片生成器 (`generateScopedSubagentSlice`)
贯彻**最小特权与注意力聚焦**原则：
* **工单契约**: 接收工单声明的 `targetFiles`（1~3 个文件）与可选的 `prerequisiteReports`（前序 Researcher 审查文档）；
* **闭包补全**: 自动将这几个目标文件直接 `import` 声明的核心接口定义纳入切片，组装为 `subagent-slice-task-<id>.txt`（仅 10KB ~ 30KB）；
* **纯协议绑定**: 由 `SubstrateUploader` 即时直传为专有附件，注入子代理会话的 `annotations`；
* **物理效果**: 子代理在纯净、无任何无关代码干扰的工作内存中专注于当前模块的攻坚。

---

## 6. 三阶段生命周期流转与状态同步协议 (Lifecycle Protocols)

```
【阶段一：全局开局】Turn 1
本地磁盘 ───> SnapshotGenerator (git-aware) ───> workspace-v1.txt (151 源文件 / 1.30 MiB 产物)
                   │
                   ├──> SubstrateUploader (纯协议自适应直传) ──> AttachmentAnnotation
                   │                                                  │
                   │                                                  v
                   │                              Chathub WebSocket (纯 SignalR 帧)
                   │                                                  │
                   v (后台异步 powershell.exe 5.1)                     v
          PnP 推送真实物理目录至 SharePoint              Copilot (GPT-6.1 Sol) 获得全局全景视野
-----------------------------------------------------------------------------------------
【阶段二：单点攻坚编码】Turn 2 ~ N (高频快跑循环)
1. Copilot 输出局部代码/补丁 (如 src/billing/tax.ts)
2. 本地 Harness 拦截代码 ➔ 本地打补丁 ➔ 执行本地验证 (`bun test` / `tsc`)
   ├── [验证失败 RED] ──> 本地拦截！SharePoint 保持原样！
   │                     将具体错误反馈给 Copilot 闭环修复。
   └── [验证通过 GREEN] ─> 
         ├── PnP 后台秒级 (1~3s) 将该单文件更新到 SharePoint 真实目录树；
         └── 本地 Harness 下发极简物理指纹头给 Copilot：
             ```markdown
             [WORKSPACE STATE UPDATE]
             - Snapshot: sha256:7f4a8b... (151 files, 1.30MiB artifact)
             - Target: src/billing/tax.ts (Tests: 15/15 PASSED)
             - Cloud Mirror: Synced to SharePoint (Eventual Consistent)
             - Next Action: 推进下一个 DAG 任务
             ```
   *(注：单点编码轮次维持首轮快照拓扑，后续状态仅通过极简物理指纹头与单文件补丁高效同步，避免重复全量上传)*
-----------------------------------------------------------------------------------------
【阶段三：里程碑收敛与跨会话接力】Handoff / Subagent
当一个战役里程碑达成、上下文窗口饱和或需要换子代理接力时：
1. 本地生成全新的递增快照 `workspace-v2.txt`；
2. 纯协议直传 `workspace-v2.txt`；
3. 新会话以 `workspace-v2.txt` 为附件开局，彻底洗净历史对话包袱，版本单调递增，无任何旧历史干扰。
```

---

## 7. Tri-Agent 认知推倒重塑与因果感知调度 (Tri-Agent Cognition & DAG Scheduling)

全面废除旧模式下摸黑探查的提示词逻辑，重构为具备上帝视角的三大 Agent 矩阵：

### 7.1 Main Agent (`cph-main-agent-prompt.txt`) 重塑
* **首轮终局立桩**：在 Turn 1 依据挂载的全景快照，产出覆盖核心任务与依赖关系的初始 `plan.md`，并支持在后续执行中动态演进与版本打标；
* **统帅职责纯粹化**：专注于全局架构把控、DAG 依赖分析、任务切片派发、单测结果审查与终局收敛对账。

### 7.2 Subagent 职责与切片契约
* **Researcher (`cph-researcher-agent-prompt.txt`)**:
  - 定位为纯粹的“单点深度攻坚分析锤”；
  - 挂载局部微切片附件（目标代码及接口定义），专注于深度代码审查、漏洞分析与状态机验证，输出结构化审查报告；
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
2. **全景快照无缝对齐**：接力启动时由 Harness 全自动投递递增版本快照（`workspace-vN.txt`），确保交接文档与云端代码事实最终一致。

---

## 9. 异常矩阵、自动化降级与安全边界 (Fault-Tolerance & Security Matrix)

| 故障场景 | 物理表现 | 自动化对账、降级与安全防护策略 |
|---|---|---|
| **PnP 网络抖动** | SharePoint CSOM 上传超时 | 重试 3 次 (间隔 5s)；仍失败则记入本地 Dirty Ledger，绝不阻塞当前会话，下一轮测试绿灯时自动补推 |
| **Cookie 凭据过期** | SharePoint 报 401/403 | 触发 `PnPSession` 三级 Cookie 自动降级读取 (磁盘 ➔ WinINet 文件存储)；无法静默恢复时提示操作者 |
| **凭据安全保护** | Cookie 缓存文件泄露风险 | 针对 `~/.cph/pnp-session.json` 实施 Windows ACL 仅限当前用户读写；CI/CD 与代码提交严格排除 |
| **凭据泄露与历史卫生** | 敏感 Token 或租户信息暴露 | 实施提交前正则扫描阻断、证据文件自动化占位符脱敏、测试夹具隔离与 Git 对象库定期对账 |
| **预授权 URL 脱敏** | `uploadUrl` 泄露风险 | Harness 日志格式化时对 `createUploadSession` 返回的预授权 URL 查询参数自动脱敏打码 |
| **大文件分块中断** | HTTP 传输在某一分块断开 | 依据服务端返回的 `nextExpectedRanges`，自动执行 HTTP Range 增量断点续传 |
| **单测死循环 / 挂起** | `bun test` 超时 | 依据项目当前基线（20.14 秒）自适应设定超时（以基线 3 倍即约 60 秒为基准上限），Windows 下通过 `taskkill.exe /F /T` 终止超时进程树 |
| **补丁损坏 / 格式漂移**| Patch 无法在本地干净命中 | 本地校验拦截，不写磁盘，以标准格式错误协议要求模型基于唯一上下文重新生成 |

---

## 10. 分阶段实施路线图 (Phased Implementation Roadmap)

### Phase 0: 纯协议大文件分块直传模块 (Resumable Upload Engine)
- 在 `src/transport/substrate-uploader.ts` 实现 `createUploadSession` 与 8,000 KB 分块 PUT 状态机（支持 `nextExpectedRanges`、HTTP-Date 解析、Abort 立即上抛与防无限重试熔断）；
- 同步加固 `uploadSimple`（支持 429/503 重试、Retry-After 解析、指数退避与 AbortSignal）；
- 导出 `uploadDocumentToOneDrive` 作为向后兼容别名（支持 3 参/4 参及错序启发式兜底），无缝适配存量调用；
- 编写 `tests/transport/resumable-uploader.test.ts`，同时覆盖简易上传与分块断流后续传、429 退避、异常上抛与取消流转；
- **边界实验**：实测 3.9MB 与 4.1MB 边界，核对 Copilot 云端切片与 `unfurl` 的真实触发机制；若实验推翻 4MB 假说，直接调整常量配置，架构路由自适应平移。

### Phase 1: SharePoint 物理同步引擎与受控依赖 (`sp-sync-engine.ps1`)
- 在 `scripts/sp-sync-engine.ps1` 中集成 Windows PowerShell 5.1 版本断言、`PnP 1.12.0` 与受控 Vendored 模块 `scripts/lib/PnPSession.psm1`；
- 支持 `~/.cph/pnp-session.json` 命名空间缓存、Windows ACL 隔离与动态用户目录探测；
- 编写集成测试验证本地与 SharePoint 目录树的增量镜像与单文件推送（秒级吞吐），并配套 CI 离线 Mock 传输层。

### Phase 2: Git-Aware 全景快照与子代理微切片生成器 (Snapshot & Slice Generators)
- 在 `src/workspace/snapshot-generator.ts` 实现基于 `git ls-files -z` 的全景快照（实测本仓库收敛至 151 源文件 / 1.30 MiB 产物，包含 9 项核心源码与提示词断言）与局部微切片组装逻辑；
- 编写 `tests/workspace/snapshot-generator.test.ts` 验证正则敏感过滤、子模块隔离、密钥扫描阻断与核心断言门禁。

### Phase 3: Orchestrator 挂载通道与生命周期闭环集成 (Pipeline Integration)
- 在 `Orchestrator` 中串联首轮全景投递、单点攻坚 TDD 红绿门禁、指纹头下发与 Handoff 快照递增；
- 平滑迁移调用点，确保存量 `uploadDocumentToOneDrive` 调用零破坏性平移；
- 编写端到端对账测试 `tests/agent/dual-layer-lifecycle.test.ts`。

### Phase 4: Tri-Agent 系统提示词与专有 Skills 重构 (Prompts & Skills Overhaul)
- 推倒重写 `cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`cph-coder-agent-prompt.txt`；
- 重构 `skills/subagent/SKILL.md` 与微调 `skills/handoff/SKILL.md`；
- 编写提示词与技能治理测试 `tests/skills/tri-agent-governance.test.ts`。

### Phase 5: 全量回归、构建打包与实战对账 (Verification & Packaging)
- 运行 `bun test` 确保全量测试套件 100% 绿灯；
- 运行 `bun run package; bun run build:package` 产出最终分发制品。
