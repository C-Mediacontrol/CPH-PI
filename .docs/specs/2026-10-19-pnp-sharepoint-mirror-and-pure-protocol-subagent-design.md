# 架构技术规范：SharePoint 物理镜像、纯协议会话投影与子代理微切片隔离体系

> **版本**：v1.0.0  
> **状态**：已批准 (Approved)  
> **关联分支**：`feat/workspace-snapshot-supercharger`  
> **实施基座**：CPH-PI (Bun + Windows PowerShell 5.1 + PnP 1.12.0)  

---

## 1. 背景与核心问题阐述 (Context & Problem Statement)

在将 Microsoft Copilot (`GPT-6.1 Sol`) 构建为高韧性自主编程 Agent 的实践中，经过真实网络抓包与物理推演测试，确立并化解了以下关键物理现实：

1. **Substrate 云端 RAG 的真实多跳推演能力**：实测证明，在 4MB（约 12 万行代码）的工程快照中，`GPT-6.1 Sol` 具备自发的多跳 Agentic 检索推理能力（58 秒内跨越 3 层抽象闭合推演）。全景代码快照可作为大模型的全局认知基座。
2. **SharePoint 爬虫延迟与会话级即时切片的矛盾**：若将整个工程直接作为 SharePoint 静态知识库挂载，SharePoint 后台全局 Search Crawler 存在 3 ~ 15 分钟的漫长索引延迟，无法适应瞬息万变的编码调试回路；而会话级附件卡片（Attachment Annotation）在云端享受最高实时优先级（5~10 秒即完成专有切片索引）。
3. **快照时效性崩塌 (Stale Snapshot Paradox)**：若在多轮会话中反复上传或直接忽略代码变动，首轮快照与当前本地磁盘代码会产生事实冲突；若盲目重复上传 4MB 快照，则会带来极大的网络开销与注意力冗余。
4. **子代理认知纯度与最小特权原则**：子代理（Subagent）是聚焦于单点攻坚的执行者。若向子代理投递全景快照，会引发注意力分散（粉色大象效应）、增加 Token 消耗并诱发跨模块越权修改；子代理物理上只能感知其工单声明的目标切片。
5. **纯协议与零 CDP 铁律**：整个生产运行时必须保持纯粹的协议交互（SignalR / WebSocket / HTTP），严禁在运行时引入浏览器或 CDP 依赖。

---

## 2. 总体系统架构：双层流体系 (Dual-Layer Architecture)

本架构将工程状态严格解耦为 **云端物理持久化层 (Ground-Truth Mirror)** 与 **会话推理投影层 (Instant Session Projection)**：

```
+-----------------------------------------------------------------------------------+
| 1. 本地执行核心 (Local Execution Core - Bun / Node)                                 |
|    - Workspace Snapshotter: 遍历真实磁盘，生成带 SHA256 指纹的代码全景快照           |
|    - Local Test Runner: 执行本地 Bun/Node 编译与单测门禁 (TDD Red/Green Guard)      |
|    - Subagent Slice Generator: 按 DAG 依赖精准抽取目标文件组装局部微切片            |
|    - Fingerprint Header Generator: 生成极简 [WORKSPACE STATE UPDATE] 状态头       |
+-----------------------------------------------------------------------------------+
           |                                                      |
           v (代码测试绿灯通过)                                     v (首轮或切片会话绑定)
+---------------------------------------+      +------------------------------------+
| 2. SharePoint 物理镜像引擎 (PnP Engine)|      | 3. 纯协议直传组件 (SubstrateUploader)|
|    - 运行环境: 静默 PWSH 5.1 + PnP     |      |    - 传输协议: HTTP PUT / Resumable|
|    - 认证方式: PnPSession 三级 Cookie  |      |    - ≤4MB: 单次 PUT ...:/content   |
|    - 存储路径: /sites/.../Workspaces/ |      |    - >4MB: createUploadSession 分块 |
|    - 职责: 保持云端与本地文件 1:1 镜像 |      |    - 产物: AttachmentAnnotation    |
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

## 3. 核心物理组件规范 (Component Specifications)

### 3.1 SharePoint 物理同步引擎 (`sp-sync-engine.ps1`)
* **运行环境与依赖**：
  - 强制使用系统原生 Windows PowerShell 5.1；
  - 强制加载已在 `Library/LTK/` 中验证的 `PnP.PowerShell` v1.12.0；
  - 导入 `PnPSession.psm1`，优先复用本地磁盘 Cookie 缓存（`~/.ltk-shipschedule-session.json`）及 WinINet 三级认证。
* **对外调用接口**：
  ```powershell
  # 1. 增量同步物理工作区至 SharePoint
  .\sp-sync-engine.ps1 -Action SyncWorkspace -LocalPath "E:\project" -SiteUrl "https://tenant.sharepoint.com/sites/Dev" -TargetFolder "/Workspaces/MyRepo"

  # 2. 同步单个绿灯变更文件
  .\sp-sync-engine.ps1 -Action SyncSingleFile -FilePath "src/billing/tax.ts" -SiteUrl "..." -TargetFolder "..."
  ```
* **容灾保障**：
  - 同步采用后台异步执行，即便偶发网络重试，绝不阻塞前台与模型的即时对话；
  - 失败重试 3 次（间隔 5s），若仍失败则追加记录至本地 `.cph/state/dirty-sync.jsonl`，在下一个绿灯周期静默对账补推。

### 3.2 纯协议大文件直传组件 (`substrate-uploader.ts`)
* **传输管道分水岭**：
  - **小文件 (≤ 4MB)**：直接调用 `PUT https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads:/{name}:/content`；
  - **大文件 (> 4MB)**：
    1. 发起 `POST https://graph.microsoft.com/v1.0/me/drive/special/copilotuploads:/{name}:/createUploadSession` 获取 `uploadUrl`；
    2. 以 `8,192,000` 字节（8,000 KB）为单位发起分块 `PUT` 请求，头携带 `Content-Range: bytes start-end/total`；
    3. 状态机响应 202 继续推流，最终分块响应 201 Created 落盘；
    4. 调用 `POST /searchservice/api/v1/unfurl?domain=File` 完成元数据组装。
* **协议层输出契约**：
  组装生成标准的 `AttachmentAnnotation`：
  ```typescript
  export interface AttachmentAnnotation {
    id: string; // SPO_<base64>_<driveItemId>
    text: string; // 文件名
    url: string; // webUrl
    messageAnnotationType: "LocalFile";
    messageAnnotationMetadata: {
      "@type": "File";
      annotationType: "File";
      fileName: string;
      webUrl: string;
      driveId: string;
      fileType: string;
    };
  }
  ```

### 3.3 本地工作区快照器 (`workspace-snapshotter.ts`)
* **快照策略**：
  - 自动读取 `.gitignore`，严格剔除 `.git`、`node_modules`、`dist`、`.cph` 以及各类二进制文件；
  - 单个文件格式化封装为清晰的边界块：
    ```typescript
    // ==========================================
    // File: src/services/order.service.ts (SHA256: 7f8a1b...)
    // ==========================================
    <code content>
    ```
  - 文件头部注入全局物理指纹清单（TOC Header），声明包含的文件列表、行数统计与全库 SHA256 根哈希。

---

## 4. 单轮与多轮生命周期流转规约 (Turn Lifecycle Protocols)

### 4.1 阶段一：全局开局 (Turn 1 - Macro Ingestion)
1. **生成全景快照**：本地调用 `workspace-snapshotter.ts` 生成 `workspace-v1.txt`；
2. **纯协议会话挂载**：`SubstrateUploader` 将快照文件上传，获取 `AttachmentAnnotation`；
3. **原生 SignalR 发送**：`chathub-client.ts` 发送首轮提示词并携带附件元数据；
4. **后台物理镜像备份**：PnP 引擎在后台异步启动，将真实源码目录树同步至 SharePoint 专有库，实现云端无容量上限的物理归档；
5. **模型语义闭环**：`GPT-6.1 Sol` 依托 Substrate Agentic RAG（5~10 秒完成专有切片），通读全库拓扑，输出高质量顶层 DAG 规划与切片计划。

### 4.2 阶段二：单点攻坚编码回路 (Turn 2 ~ N - Focused Coding Loop)
在具体的子任务推进过程中，严格遵守**局部聚焦准则**，绝不重复上传 4MB 快照：
1. **模型输出代码**：模型输出针对当前聚焦模块（如 `src/billing/tax.ts`）的精确修改；
2. **本地拦截与测试门禁 (TDD Red/Green Guard)**：
   - 本地 Harness 应用补丁并执行 `bun test` 与类型检查；
   - **RED (测试失败)**：拦截上盘，绝不同步云端！将失败堆栈回传当前会话闭环修复；
   - **GREEN (测试通过)**：
     - 本地落盘并提交 Git Commit；
     - PnP 引擎后台毫秒级单文件同步至 SharePoint；
     - 向模型下发极简物理指纹头：
       ```markdown
       [WORKSPACE STATE UPDATE]
       - Head: Commit 9c42b1 (v2)
       - Target: src/billing/tax.ts (Tests: 15/15 PASSED)
       - Cloud Mirror: Synced to SharePoint
       - Active Focus: Updated code is verified on disk
       ```
3. **消除时效性崩塌**：模型以首轮快照为背景拓扑，以指纹头和当前单文件为最新事实，彻底杜绝认知冲突。

### 4.3 阶段三：里程碑收敛与跨会话接力 (Handoff & Subagent Evolution)
当战役达成阶段性成果、上下文接近饱和或派发独立长任务时：
1. 本地 Harness 重新触发 `workspace-snapshotter.ts` 生成单调递增的新快照 `workspace-v2.txt`；
2. 纯协议直传 `workspace-v2.txt`；
3. 新接力会话以此快照为附件开局，彻底洗净历史累积的对话噪音，实现干净、轻盈的无损接力。

---

## 5. Subagent 局部定向切片挂载协议 (Scoped Slice Protocol)

为严格贯彻**最小认知特权原则**与**上下文纯度防御**，子代理必须与全量快照物理隔离：

```
主会话 DAG 派发工单 (声明 TargetFiles + 前序结论)
   │
   ▼
本地 Harness 抽取目标文件 ➔ 组装局部微切片 (subagent-slice-taskN.txt, 10~30KB)
   │
   ▼
SubstrateUploader 纯 HTTP 直传微切片 ➔ 注入 Subagent 会话的 annotations
   │
   ▼
Subagent (Coder) 会话启动 (纯净工作内存 / 零无关代码干扰)
   │
   ▼
输出单点精准 Patch ➔ 主环境执行单测验收 ➔ 绿灯合入 ➔ PnP 镜像到 SharePoint
```

### 规约细则：
1. **物理强隔离**：主会话派发子工单时，子代理会话的附件中**严禁包含**全景快照，仅包含与当前工单直接相关的 1~3 个目标源码文件及前序审查文档；
2. **前后依赖承接**：若当前 Coder 依赖前序 Researcher 的审查报告，主会话直接将该审查报告作为文本或切片附件传入子代理会话，形成完整的证据闭环；
3. **单点交付契约**：子代理仅对局部切片内的文件拥有编辑权，交付产物必须是针对该切片文件的唯一匹配补丁（Patch）。

---

## 6. 异常矩阵与自动化降级 (Fault Tolerance)

| 场景 | 物理表现 | 自动化对账与降级策略 |
|---|---|---|
| **PnP 网络抖动** | SharePoint CSOM 上传超时 | 重试 3 次 (间隔 5s)；仍失败则记入本地 Dirty Ledger，绝不阻塞当前会话，下一轮测试绿灯时自动补推 |
| **Cookie 凭据过期** | SharePoint 报 401/403 | 触发 `PnPSession` 三级 Cookie 自动降级读取；无法静默恢复时提示操作者 |
| **大文件分块中断** | HTTP 传输在某一分块断开 | 依据 `createUploadSession` 返回的 `nextExpectedRanges`，自动执行 HTTP Range 增量断点续传 |
| **单测死循环** | `bun test` 运行超 30s | 强制触发 SIGKILL 硬超时，捕获超时堆栈回传模型，拦截云端同步 |
| **补丁损坏 / 格式漂移**| Patch 无法在本地干净命中 | 本地校验拦截，不写磁盘，以标准格式错误协议要求模型基于唯一上下文重新生成 |

---

## 7. 验收标准与交付物 (Acceptance Criteria)

1. [x] **Substrate 云端 RAG 多跳能力实证**：在 4MB 真实快照（12 万行干草堆）中完成 3 跳隐式因果推演，`GPT-6.1 Sol` 达到 100% 盲测推演召回；
2. [ ] **纯协议分块直传模块实现**：`SubstrateUploader` 完整支持 `createUploadSession` 分块传输（8,000 KB 步长）与元数据生成，全链路 100% 纯网络流，零 CDP 依赖；
3. [ ] **SharePoint 物理同步模块打通**：`sp-sync-engine.ps1` 成功调用 PnP 1.12.0 将本地工程目录增量镜像至 SharePoint；
4. [ ] **子代理微切片生成器就绪**：Harness 能够依据工单定义的 `targetFiles` 自动生成仅包含必要上下文的局部切片附件；
5. [ ] **集成对账套件**：编写端到端单元测试覆盖“开局快照投递 ➔ 局部单点编码 ➔ TDD 验证 ➔ 物理指纹刷新 ➔ PnP 镜像同步 ➔ 子代理隔离”全闭环。
