# 初审报告：模块深度与双向冲击面 (Dim-3: improve-codebase-architecture)

- **审查对象**: `E:\copilot-web proxy\CPH-PI`
- **审查模式**: Full Mode
- **扫描文件数**: 24 个生产源码文件 (覆盖 `src/` 全量代码库，共计约 7,720 行)
- **审查基准哲学**: `improve-codebase-architecture`（模块深度、真伪 Seam 鉴别、抽象泄漏拦截、7 类制品双向冲击面矩阵）

---

## 架构健康度与浅层模块概览

经过对 `CPH-PI` 源码（共 24 个 TypeScript 核心模块）的全面拓扑分析、依赖遍历与模块深度度量，当前代码库在以下几个方面表现出显著的**结构张力与架构异味**：

1. **模块深度两极分化（Extreme Depth Skew）**：
   - **巨型上帝类（God Modules）**：`cli.ts` (2,082 行)、`orchestrator.ts` (1,646 行)、`tool-bridge.ts` (821 行) 集中了过多的非正交职责。接口巨大、内部实现极其庞杂，缺乏高杠杆（High Leverage）的封装屏障。
   - **微型浅层模块（Shallow Micro-Modules）**：如 `session/index.ts` (8 行残缺 Barrel)、`auth/crypto.ts`（透明别名 `protectSecret`）、`agent/compaction.ts`（140 行静态工具）等，接口复杂度与其内部行为几乎等价，缺乏真正的封装价值（Low Leverage）。
2. **结构性循环依赖（Circular Import Cycles）**：
   静态依赖图检测出 **2 处确定性循环引用**：
   - `src/agent/orchestrator.ts` ⇄ `src/agent/subagent-runner.ts`（相互实例化，强双向耦合）
   - `src/agent/blackbox-compactor.ts` ⇄ `src/agent/compaction.ts`（循环 Barrel 导出与类型交叉引用）
3. **Seam 伪造与抽象泄漏（Fake Seams & Abstraction Leaks）**：
   - `IOrchestratorChatClient` 是典型的**假缝隙（Hypothetical Seam）**：全工程仅有唯一生产实现 `ChatHubClient`（满足 "One adapter = hypothetical seam"）。然而编排器内部不仅对该客户端进行 `(client as any)?.close?.()` 强制类型断言，更直接内嵌了 `SubstrateUploader.uploadDocumentToOneDrive`、OneDrive `AttachmentAnnotation` 和底层 SignalR/WebSocket 错误特征嗅探，严重违背了“严格隔绝 Harness 底层物理细节”的黑盒原则。
4. **架构分层反向依赖（Inverted Layer Dependencies）**：
   - **Auth 反向依赖 Transport**：底层认证模块 `auth/account-pool.ts` 直接导入上层传输模块 `transport/chathub-client.ts`（仅为调用字符串格式化方法 `normalizeAgentId`）。
   - **Agent 反向依赖 UI**：核心智能体调度模块 `agent/subagent-runner.ts` 直接导入并依赖 `ui/terminal-logger.ts` 的 `SessionLoggerTree` 接口及其实例方法。
5. **领域状态过度碎片化与持久化断层（Domain Fragmentation & In-Memory Volatility）**：
   - 会话生命周期与容灾管理被割裂在 `SessionManager`、`SessionLineageTracker`、`MainPlanSnapshot`、`BlackboxCompactor` 4 个平行的模块中。其中核心的树状血缘追踪器（`SessionLineageTracker`）为**纯内存实现**，无持久化保障，在进程重启或异常退出时血缘链条将彻底断裂。

---

## 发现的问题清单与 7 类制品冲击面

### 1. `CopilotOrchestrator` 与 `SubagentRunner` 循环实例化依赖
- **涉及文件**: `src/agent/orchestrator.ts`, `src/agent/subagent-runner.ts`
- **置信度等级**: `Level 1`（确定性结构缺陷）
- **缺陷类别**: 循环依赖 / 抽象泄漏 / 缺乏 Locality
- **当前问题剖析**:
  - `orchestrator.ts` 第 24 行导入 `SubagentRunner`，并在第 642-659 行执行 `invoke_subagent` 工具时，直接通过 `new SubagentRunner(...)` 调度子任务并等待执行结果；
  - 与此同时，`subagent-runner.ts` 第 4 行导入 `CopilotOrchestrator`，并在自身执行各子任务的推进循环中（第 277-286 行）直接调用 `new CopilotOrchestrator(...)` 实例化子编排器；
  - **删除测试（Deletion Test）**：若在编译单元中单独删除或剥离任意一方，另一方均立即因缺失类型与构造方法而崩溃。两者的复杂度没有被隔离在各自的 Seam 之后，而是互相纠缠在一起。
  - **聚合测试（Aggregation Test）**：子代理的本质是一次独立的 `SessionRun`。编排器不应直接依赖“批量调度器”，调度器也不应直接依赖上层编排器的具体类，而应通过注入轻量级的执行器抽象或由统一的 Agent 运行时驱动。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `cli.ts` 构造并调用 `orchestrator.run()` | `runner.executeBatch()`、`orchestrator.run()` | 🔴 |
  | **配置/环境** | `CphPiCliOptions.maxAutonomousHandoffHops` | 构造传递给子任务的 `maxTurns`, `modelTone` | 🟢 |
  | **全局状态** | 会话世代演进状态 (`generation++`, `nextSessionId`) | 血缘关系注册 (`lineageTracker.register`) | 🔴 |
  | **数据/存储** | `saveMainPlanSnapshot` 生成主控计划快照 | 子代理交接文档读取与任务 prompt 拼装 | 🟡 |
  | **文件/资源** | `.cph/handoffs/main-plan-*.json/.md` | `createSubagentLogStream` 文件写流句柄 | 🟡 |
  | **共享常量** | `DEFAULT_CODER_AGENT_ID`, `DEFAULT_RESEARCHER_AGENT_ID` | 角色 ID 缺省兜底 | 🟢 |
  | **依赖/库** | Node `crypto.randomUUID` | Node `child_process`, `fs` | 🟢 |
- **深层化重构方案与 Benefits**:
  - **接口收敛**：定义轻量级执行契约 `IAgentExecutor`，Orchestrator 仅依赖任务分发接口；或者将 Orchestrator 作为无状态的单轮/多轮执行核，由上层的会话执行器统一调度，切断两者在文件顶层的双向静态 import。
  - **收益 (Benefits)**：
    - **Locality**：子代理生命周期控制完全收敛至 `SubagentRunner`，不再向 `orchestrator.ts` 泄露执行器构建逻辑；
    - **Leverage**：单体测试 `orchestrator.ts` 时无需 mock 复杂的 `SubagentRunner`，杜绝模块加载期的循环解析隐患。

---

### 2. `IOrchestratorChatClient` 伪 Seam 与底层 Transport/Cloud 物理细节在 Orchestrator 中的抽象泄漏
- **涉及文件**: `src/agent/orchestrator.ts`, `src/transport/chathub-client.ts`, `src/transport/substrate-uploader.ts`
- **置信度等级**: `Level 1`（确定性缺陷 / 结构不变量破坏）
- **缺陷类别**: 伪 Seam / 抽象泄漏
- **当前问题剖析**:
  - `orchestrator.ts` 第 40 行声明了 `IOrchestratorChatClient` 接口，但整个代码库**只有 `ChatHubClient` 这一处实际实现**（单元测试中的 mock 除外），且 `ChatHubClient` 甚至未显式实现该接口（依赖脆弱的结构化鸭子类型）；
  - **严重抽象泄漏 1（连接管理泄漏）**：在 `orchestrator.ts` 第 638-640 行，编排器在派发子任务前直接探测并调用底层的私有网络方法：
    ```typescript
    // Safely disconnect client WebSocket if close method exists to free cloud account
    try { (client as any)?.close?.(); } catch {}
    ```
    上层智能体编排业务竟然需要亲自关闭底层的 WebSocket 连接以释放云端并发配额，破坏了网络连接生命周期的封装。
  - **严重抽象泄漏 2（云端存储与 Token 物理泄漏）**：在 `orchestrator.ts` 第 734-745 行，编排器直接持有 `acquireGraphToken()`，并直接调用微软专属的 `SubstrateUploader.uploadDocumentToOneDrive(...)`，将底层 Graph API 与云端附件注解（`LocalFile` / `AttachmentAnnotation`）直接掺杂在核心思考与工具推进逻辑中；
  - **严重抽象泄漏 3（网络报错模式匹配）**：在第 1298-1350 行，编排器直接实现针对 Node socket、WebSocket 帧与 Sydney 报错特征的字符串模式匹配；
  - 违背 `AGENTS.md` 铁律：“严格隔绝 Harness 底层物理实现细节：严禁向 Agent 系统提示词或 Skill 中向模型解释底层 Harness 是如何运转的……保持纯粹的黑盒契约”。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `cli.ts` 传入 `chatClient` 或 `chatClientFactory` | `client.sendMessage()`, `SubstrateUploader.uploadDocumentToOneDrive()` | 🔴 |
  | **配置/环境** | `tokenEndpoint`, `modelTone`, `scenario` | `acquireGraphToken()`, Graph API 认证请求头 | 🟡 |
  | **全局状态** | 账号连接池活跃状态与云端并发占用 | WebSocket 连接开启/关闭、OneDrive 附件凭证 | 🔴 |
  | **数据/存储** | 工具执行原始输出（字符串） | OneDrive 云端上传文件、附件 Annotation 注入 | 🟡 |
  | **文件/资源** | 待上传临时文件名 `tool-result-*.txt` | Graph API HTTP 连接池 | 🟢 |
  | **共享常量** | `DEFAULT_GRAPH_URL`, `GRAPH_SCOPE` | `RECORD_SEPARATOR` (\x1e) | 🟢 |
  | **依赖/库** | 全局 `fetch`, `ws` | Node `crypto` | 🟡 |
- **深层化重构方案与 Benefits**:
  - **深层化封装**：将网络连接维护、断线释放、云端附件自动上传（Attachment Offloading）与错误分类完整封装到 `TransportService`（或增强版的 `ChatHubClient`）中。
  - **接口收敛**：`Orchestrator` 只面对极简接口：输入 `TurnPrompt`，获得包含附件感知的响应 `TurnResponse`。Orchestrator 完全不需要知道什么叫 WebSocket `.close()`，也不需要知道什么叫 Graph Token。
  - **收益**：彻底消除 `(client as any)?.close?.()` 等黑客式补丁，使 Orchestrator 真正回归纯粹的中立业务调度核。

---

### 3. 会话状态与血缘追踪过度碎片化，内存血缘在进程中断时丢失
- **涉及文件**: `src/session/session-manager.ts`, `src/session/lineage-tracker.ts`, `src/session/main-plan-snapshot.ts`, `src/session/index.ts`
- **置信度等级**: `Level 1`（确定性缺陷 / 状态一致性隐患）
- **缺陷类别**: 碎片化过度 / 浅层模块 / 抽象泄漏
- **当前问题剖析**:
  - 会话管理领域被分散在 4 个平行小模块中：
    1. `SessionManager` (350 行)：读写 `.cph/sessions/` 下的 `index.json` 和 `<sessionId>.json`，维护轮次记录；
    2. `SessionLineageTracker` (93 行)：在内存中使用 `Map<string, SessionLineage>` 维护主从、前后任会话关系与活动端点解析（`resolveActiveHead`）。**但该类没有任何磁盘持久化逻辑！** 当发生系统崩溃、用户强退或断电重启后，内存中的树状血缘关系彻底丢失，`SessionManager` 恢复出的孤立会话无法得知其前任与子代理关系；
    3. `MainPlanSnapshot` (117 行)：将规划快照保存至另外的目录 `.cph/handoffs/main-plan-*.json/.md`。更为严重的是，该模块第 95 行居然导出了 `formatSuccessorTurn1Prompt`，把**智能体提示词拼接逻辑**泄露到了数据存储模块；
    4. `session/index.ts` (8 行)：残缺的 Barrel 文件，仅重新导出了 `SessionManager`，遗漏了另外两个关键类。
  - **删除测试**：如果合并为一个深层的 `SessionStore`，4 个碎片化概念合并，调用方无需在 `SessionManager`、`SessionLineageTracker` 和 `saveMainPlanSnapshot` 之间来回调用与同步。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `cli.ts`, `orchestrator.ts`, `subagent-runner.ts` | `sessionManager.saveSession()`, `lineageTracker.register()`, `saveMainPlanSnapshot()` | 🔴 |
  | **配置/环境** | `workspaceRoot` 绝对路径 | `.cph/sessions/`, `.cph/handoffs/` 存储路径 | 🟡 |
  | **全局状态** | `SessionLineageTracker.registry`（非持久化内存态） | 会话接力链、活动头解析 (`resolveActiveHead`) | 🔴 |
  | **数据/存储** | 会话索引表 `index.json`、详情 JSON | 主控规划 JSON/MD、前序思绪快照 | 🔴 |
  | **文件/资源** | `.cph/` 下分散的两个子目录 | 文件读写锁与并发安全 | 🟡 |
  | **共享常量** | 状态字符串 (`"active" \| "handed_off" \| ...`) | 会话前缀、快照 ID 格式 | 🟢 |
  | **依赖/库** | Node `fs`, `path` | Node `crypto` | 🟢 |
- **深层化重构方案与 Benefits**:
  - **深层化整合**：将 `SessionManager`、`SessionLineageTracker` 和快照落盘统一聚合为单一深层模块 `SessionStore`（或深层化的 `SessionManager`）。血缘关系作为 `SessionRecord` 的固有属性直接持久化到磁盘；
  - **职责归位**：将 `formatSuccessorTurn1Prompt` 移至 `protocol/prompt-builder.ts`；
  - **收益**：消除血缘追踪器断电丢失的可靠性漏洞，统一 `.cph/sessions` 存储规范，简化外部调用者的认知负担。

---

### 4. 历史压实与容灾快照模块的人为割裂与循环 Barrel 导出
- **涉及文件**: `src/agent/compaction.ts`, `src/agent/blackbox-compactor.ts`
- **置信度等级**: `Level 2`（设计异味 / 浅层模块 / 循环依赖）
- **缺陷类别**: 浅层模块 / 循环依赖 / 缺乏 Locality
- **当前问题剖析**:
  - `compaction.ts` (140 行) 导出了接口 `TurnRecord` 与静态类 `CompactionService`，并在其尾部（第 136-139 行）通过 Barrel 重新导出 `BlackboxCompactor`；
  - 而 `blackbox-compactor.ts` (467 行) 开篇第一行便从 `./compaction.ts` 导入 `type TurnRecord`；
  - 依赖关系形成了物理回环：`blackbox-compactor.ts` ⇄ `compaction.ts`；
  - **模块深度分析**：`CompactionService` 本身仅包含 `compactTurns`（遍历并在字符超标时替换为打桩文本）等简单逻辑，是一个极浅的模块。而 `BlackboxCompactor` 同样是在做会话历史的智能折叠、诊断提取与 5k~8k 容灾上下文生成。两者原本是同构的上下文预算裁剪能力，却被人为割裂为两个文件。
  - 调用方 `orchestrator.ts` 必须同时 `import { CompactionService }` 和 `import { BlackboxCompactor }`，并在不同的 turn 阶段分别调用，缺乏概念局部性（Locality）。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `orchestrator.ts` 轮次推进与容灾处理代码 | `CompactionService.compactTurns`, `BlackboxCompactor.extractDisasterBlackbox` | 🟡 |
  | **配置/环境** | `preserveRecentTurns`, `maxChars` | `minSnapshotChars`, `maxSnapshotChars` (8000) | 🟢 |
  | **全局状态** | 会话历史数组 `turns: TurnRecord[]` | 无 | 🟢 |
  | **数据/存储** | `SessionRecord.disasterBlackbox` | `SessionTurnRecord.toolOutput` 折叠文本 | 🟡 |
  | **文件/资源** | 无 | 无 | 🟢 |
  | **共享常量** | `DEFAULT_PRESERVE_RECENT_TURNS` | `DEFAULT_MAX_SNAPSHOT_CHARS` | 🟢 |
  | **依赖/库** | 无 | 无 | 🟢 |
- **深层化重构方案与 Benefits**:
  - **合并为一个深层模块**：将 `compaction.ts` 与 `blackbox-compactor.ts` 合并为一个深层模块 `ContextBudgetManager`（或深层化统一的 `HistoryCompactor`）。对外暴露单一接口：提供日常历史压实与容灾高密快照提取；
  - **收益**：消除循环 Barrel 导出，收敛 `TurnRecord` 定义源头，提升上下文裁剪策略的高内聚度。

---

### 5. 技能体系双轨制碎片化与调用方绕过 Registry 导致的封装破坏
- **涉及文件**: `src/skills/skill-loader.ts`, `src/skills/skill-registry.ts`, `src/agent/subagent-runner.ts`, `src/cli.ts`
- **置信度等级**: `Level 2`（设计异味 / 浅层模块 / 职责越界）
- **缺陷类别**: 浅层模块 / 碎片化过度 / 封装失效
- **当前问题剖析**:
  - 技能体系被拆成两个浅层模块：`SkillLoader`（仅做目录 glob 扫描与文本读取）和 `SkillRegistry`（内存 Map 存储）；
  - **封装失效**：`subagent-runner.ts` 第 9 行完全不使用 `SkillRegistry`，而是直接 `new SkillLoader(this.workspaceRoot)` 自行寻找 `handoff` 技能；
  - **接口爆炸**：`CphPiCliOptions` 被迫同时暴露两个配置字段 `skillRegistry?: SkillRegistry` 和 `skillLoader?: SkillLoader`；
  - **职责混乱**：`SkillRegistry` 不仅保存技能，还包揽了 CLI 用户命令解析（`parseSlashCommand`）和智能体 Prompt 组装（`buildPromptSection`），职责跨越了领域模型、CLI 输入层与协议组装层。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `cli.ts`, `subagent-runner.ts`, `orchestrator.ts` | `SkillLoader.discoverSkills()`, `SkillRegistry.activateSkill()` | 🟡 |
  | **配置/环境** | `~/.gemini/config/skills`, 工作区路径 | `customPaths` 技能检索优先级列表 | 🟡 |
  | **全局状态** | 已激活技能列表 `activeSkills` | Slash 命令匹配结果 | 🟡 |
  | **数据/存储** | `SKILL.md` 物理文件 | 内存中的 `Skill` 对象缓存 | 🟢 |
  | **文件/资源** | 技能文档读取 | 无 | 🟢 |
  | **共享常量** | 6 大默认搜索路径优先级数组 | 技能 Markdown 提示词标题常量 | 🟢 |
  | **依赖/库** | Node `fs`, `path`, `os` | 无 | 🟢 |
- **深层化重构方案与 Benefits**:
  - **深层化聚合**：将 `SkillLoader` 私有内聚到 `SkillManager`（或 `SkillRegistry`）内部，外部调用者只需面对单一的技能管理器，通过 `skills.getSkill("handoff")` 即可完成查找与按需加载；
  - **职责剥离**：将 `parseSlashCommand` 移入 CLI 输入解析层，将 `buildPromptSection` 归还给 `PromptBuilder`。

---

### 6. 认证层反向依赖传输层 (Auth -> Transport Reverse Architectural Dependency)
- **涉及文件**: `src/auth/account-pool.ts`, `src/transport/chathub-client.ts`
- **置信度等级**: `Level 1`（确定性缺陷 / 架构分层倒置）
- **缺陷类别**: 抽象泄漏 / 架构分层倒置
- **当前问题剖析**:
  - `src/auth/account-pool.ts` 第 3 行导入：
    ```typescript
    import { ChatHubClient } from "../transport/chathub-client.ts";
    ```
  - 在第 236、251、260、307 行，`AccountPool` 多次调用：
    ```typescript
    const normAgent = ChatHubClient.normalizeAgentId(agentId) || agentId.trim();
    ```
  - **分层倒置**：身份认证与凭据池（Auth）作为底层基础设施层，竟然直接反向依赖了上层的网络传输协议客户端（Transport），仅仅是为了使用其附带的一个 URL 正则替换工具函数（`normalizeAgentId`）；
  - 这严重破坏了软件架构的单向依赖规则（底层不得依赖上层）。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `AccountPool.getAvailableToken({ forAgentId })` | `ChatHubClient.normalizeAgentId(input)` | 🟢 |
  | **配置/环境** | 无 | Copilot 自定义 Agent 路由 URL | 🟢 |
  | **全局状态** | `ineligibleAgents` 账号可用性映射表 | 无 | 🟡 |
  | **数据/存储** | `accounts.json` 凭据存储 | 无 | 🟢 |
  | **文件/资源** | 无 | 无 | 🟢 |
  | **共享常量** | 无 | 无 | 🟢 |
  | **依赖/库** | 无 | 无 | 🟢 |
- **深层化重构方案与 Benefits**:
  - **抽取独立领域工具**：将 `normalizeAgentId` 提取至通用的 `AgentIdentifier` 或 `protocol/` 领域工具函数中，由 `AccountPool` 和 `ChatHubClient` 分别引用；
  - **收益**：彻底断开 Auth 对 Transport 的倒置依赖，恢复纯净的单向分层依赖流。

---

### 7. Agent 核心调度层反向依赖 UI 终端日志器 (Agent -> UI Reverse Dependency)
- **涉及文件**: `src/agent/subagent-runner.ts`, `src/ui/terminal-logger.ts`
- **置信度等级**: `Level 1`（确定性缺陷 / 架构分层倒置）
- **缺陷类别**: 抽象泄漏 / 分层倒置
- **当前问题剖析**:
  - `src/agent/subagent-runner.ts` 第 6 行导入：
    ```typescript
    import type { SessionLoggerTree } from "../ui/terminal-logger.ts";
    ```
  - `SubagentRunner` 在属性中持有 `private loggerTree?: SessionLoggerTree`，并在子代理执行循环和交接过程中直接调用 `this.loggerTree?.logTimelineEvent(...)` 和 `logStream?.write(...)`；
  - **职责越界**：`TerminalLogger` 本身定位为全局控制台输出拦截器（带有 `process.stdout.write` 劫持逻辑），却在自身内部实现了 `.cph/logs/<sessionId>/` 目录创建、子代理日志文件流创建与 `timeline.jsonl` 事件追加；
  - 核心业务调度层（Agent）不应直接依赖 UI 层的日志呈现器。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `subagent-runner.ts` 内部各 hop 执行流程 | `loggerTree.logTimelineEvent()`, `createSubagentLogStream()` | 🟡 |
  | **配置/环境** | `workspaceRoot` 路径 | `.cph/logs/` 本地日志落盘路径 | 🟢 |
  | **全局状态** | 子代理运行生命周期进度 | `TerminalLogger.instance` 静态单例拦截状态 | 🟡 |
  | **数据/存储** | 子代理执行进度事件对象 | `timeline.jsonl`, `main.log`, `<subId>.log` | 🟡 |
  | **文件/资源** | 打开的 Node `fs.WriteStream` | 文件写流句柄（异常时未安全关闭的风险） | 🔴 |
  | **共享常量** | 事件类型字符串 `"SUBAGENT_CONTINUED"` | 无 | 🟢 |
  | **依赖/库** | Node `fs`, `path` | Node `stream` | 🟢 |
- **深层化重构方案与 Benefits**:
  - **事件驱动解耦**：`SubagentRunner` 通过标准事件回调（如 `events.onTimelineEvent`）向上抛出业务事实；
  - **目录日志归位**：将 session 目录树日志（`SessionLoggerTree`）从 `ui/terminal-logger.ts` 剥离，移入独立的 `session/session-logger.ts`，UI 仅作为可选的订阅者。
  - **收益**：核心 Agent 模块不再反向依赖 UI 模块，日志文件句柄生命周期由专用日志服务集中管控。

---

### 8. 提示词协议中的负面禁用词与参数嗅探设计异味
- **涉及文件**: `src/protocol/prompt-builder.ts`
- **置信度等级**: `Level 2`（设计异味 / 规范违背）
- **缺陷类别**: 抽象脆弱 / 契约污染
- **当前问题剖析**:
  - **负面禁用词违规**：`PromptBuilder.PROTOCOL_REMINDER` 第 27 行明确包含：
    `"2. 若全部步骤已完成且无需后续动作，严禁输出工具块，必须直接输出交付格式："`
    直接违反了工作区治理铁律第 3 条（“正向引导铁律：摒弃负面禁止词，杜绝使用‘严禁……’、‘切勿……’、‘不要……’，全面转为建设性的正向引导”）；
  - **参数类型嗅探与自动对调**：在 `PromptBuilder.buildTurn2TaskPrompt` 第 140-164 行：
    ```typescript
    if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
      skillsSection = arg2;
      toolResult = arg3;
    } else if (arg3.includes("Skill") || arg3.includes("技能")) {
      toolResult = arg2;
      skillsSection = arg3;
    }
    ```
    方法内部通过对传入字符串内容进行模糊匹配（嗅探是否包含 "Skill" 或 "技能"）来自动交换实参顺序。这属于典型的因为历史重构传参不一致而采取的防御性修补（Defensive Hack），掩盖了调用方的传参缺陷，使接口契约变得不可预测。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `orchestrator.ts` 在握手完成和工具反馈时调用 | 模型所接收到的系统与轮次提示词 | 🟡 |
  | **配置/环境** | 无 | 无 | 🟢 |
  | **全局状态** | 无 | 无 | 🟢 |
  | **数据/存储** | `TurnRecord.userInput` 保存的提示词 | 模型注意力上下文质量 | 🟡 |
  | **文件/资源** | 无 | 无 | 🟢 |
  | **共享常量** | `PromptBuilder.PROTOCOL_REMINDER` | 模型输出协议解析器 `ResilientParser` | 🟡 |
  | **依赖/库** | 无 | 无 | 🟢 |
- **深层化重构方案与 Benefits**:
  - **正向引导重写**：将协议说明转为建设性正向引导：“2. 当全部步骤验证完成且目标达成时，请直接输出最终交付总结：FINAL_ANSWER: <任务交付总结说明>”；
  - **严格接口对象化**：将 `buildTurn2TaskPrompt` 的位置参数改为明确的强类型参数对象 `interface Turn2PromptOptions { task: string; toolResult: string; skillsSection?: string; toolName?: string; }`，彻底删除启发式字符串嗅探分支。

---

### 9. CLI 上帝模块膨胀与极端扁平化的 26 参构造接口
- **涉及文件**: `src/cli.ts`
- **置信度等级**: `Level 2`（设计异味 / 缺乏 Locality）
- **缺陷类别**: 缺乏 Locality / 接口爆炸 / 上帝类
- **当前问题剖析**:
  - `cli.ts` 文件体积高达 2,082 行（78KB），`CphPiCliOptions` 接口包含多达 26 个配置项；
  - 包含了 CLI 参数解析器（`parseCliArgs`，245 行）、REPL 多行交互、工作区 JSON 配置读写、近 400 行长命令分支路由（`handleCommand` 包含 `/help`, `/model`, `/agent`, `/accounts`, `/status`, `/skills`, `/session` 等大量内联实现）、诊断卡片生成等多个完全不同层次的逻辑；
  - 构造函数直接持有并暴露所有底层内部依赖的 Getter/Setter，导致封装屏障（Encapsulation Barrier）完全不存在。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `cph-pi.bat`, `cph-pi.ps1`, 测试套件中的 `new CphPiCli()` | 26 个子组件的直接构造与方法调用 | 🔴 |
  | **配置/环境** | `process.argv`, `.cph/config.json` | 宿主全局账号文件、工作区路径 | 🟡 |
  | **全局状态** | REPL 交互状态、多行输入缓冲区 | 控制台 raw 模式与 SIGINT 监听器 | 🟡 |
  | **数据/存储** | 会话历史与诊断信息 | 工作区持久化配置 | 🟡 |
  | **文件/资源** | 终端读写流 `process.stdin` / `process.stdout` | 日志持久化句柄 | 🟢 |
  | **共享常量** | 命令行指令集与交互帮助文本 | 默认 Agent ID 等常量 | 🟡 |
  | **依赖/库** | `chalk`, `node:readline` | 全局依赖链 | 🟢 |
- **深层化重构方案与 Benefits**:
  - **分拆命令路由**：将 REPL 命令处理（`/accounts`, `/skills`, `/session` 等）提取为独立的 Command Handlers；
  - **参数解析与运行器分离**：将 CLI 命令行参数解析提取为 `cli/args-parser.ts`，REPL 循环提取为 `cli/interactive-repl.ts`；
  - **收益**：`cli.ts` 规模大幅缩减至 200 行以内，提升代码的可读性、可维护性与测试隔离度。

---

### 10. `protocol/tool-bridge.ts` 混杂低级 Windows 字节流解码与工件持久化职责
- **涉及文件**: `src/protocol/tool-bridge.ts`
- **置信度等级**: `Level 2`（设计异味 / 职责杂糅）
- **缺陷类别**: 缺乏 Locality / 职责越界
- **当前问题剖析**:
  - `tool-bridge.ts` 承担了“协议转换”（将 Copilot 动作映射为 Pi 原生工具）的职能，本应关注数据契约；
  - 但其内部直接包含了：
    1. `persistLargeOutputIfNeeded`（第 182-242 行）：负责在工具执行结果超限（3000字符/50行）时，向 `.cph/artifacts/` 写入哈希文件，并截断生成双端预览（属于 Artifact 存储职责）；
    2. `smartDecodeBuffer`、`decodeStreamChunk`、`createEncodingSelfHealingBashOperations`（第 249-394 行）：负责处理 Windows OEM CP936/GBK 与 UTF-8 多字节边界流拼接自愈逻辑（属于平台与进程执行优化职责）；
  - 这导致该文件膨胀至 821 行，并将底层操作系统特定（Windows OEM CodePage）与文件存储细节深度粘连在协议桥接层。
- **7 类制品双向冲击面评估**:
  | 制品类型 | ⬆️ 上游（生产方/调用方） | ⬇️ 下游（消费方/被调用方） | 风险评级 |
  |---|---|---|---|
  | **函数/接口** | `orchestrator.ts`, `tui-renderer.ts` | Pi 原生工具 (`createReadTool`, `createEditTool` 等) | 🟡 |
  | **配置/环境** | `process.platform === "win32"` | `.cph/artifacts/` 目录路径 | 🟢 |
  | **全局状态** | 无 | 无 | 🟢 |
  | **数据/存储** | 工具执行返回的输出字符串 | `.cph/artifacts/tool-output-*.log` 工件文件 | 🟡 |
  | **文件/资源** | 待读写的目标物理源码文件 | 工件持久化文件系统句柄 | 🟡 |
  | **共享常量** | `MAX_INLINE_OUTPUT_CHARS`, `PREVIEW_HEAD_LINES` | `MAX_READ_SLICE_LINES` (100) | 🟢 |
  | **依赖/库** | `TextDecoder`, Node `crypto`, `Buffer` | Pi upstream tools package | 🟢 |
- **深层化重构方案与 Benefits**:
  - **职责拆分**：
    - 将编码自愈逻辑抽取至 `src/platform/encoding-healer.ts`；
    - 将大输出工件归档抽取至 `src/session/artifact-manager.ts`；
  - **收益**：`ToolBridge` 纯粹专注于 Copilot 动作参数归一化与 Pi 工具调用，大幅精简其代码体积，使 Windows 字符集自愈逻辑具备独立可测性。

---

## 架构重构路线图建议 (Roadmap Recommendations)

依据上述 10 项核心架构问题与冲击面扫描，推荐实施以下深层化重构演进：

```
                ┌────────────────────────────────────────────────────────┐
                │                  Interactive App / CLI                 │
                │        (轻量入口: 参数解析 + REPL 路由器, <200 行)        │
                └───────────────────────────┬────────────────────────────┘
                                            │
                                            ▼
                ┌────────────────────────────────────────────────────────┐
                │                 Agent Core Runtime                     │
                │   ┌────────────────────────────────────────────────┐   │
                │   │  SessionCoordinator (会话生命周期与世代流转)    │   │
                │   └──────┬──────────────────────────────────┬──────┘   │
                │          │                                  │          │
                │          ▼                                  ▼          │
                │   ┌───────────────┐                  ┌───────────────┐ │
                │   │ Orchestrator  │                  │ SubagentPool  │ │
                │   │ (纯净调度核)  │                  │ (子任务并发核)│ │
                │   └──────┬────────┘                  └───────────────┘ │
                └──────────┼─────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┬──────────────────┐
         ▼                 ▼                 ▼                  ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐ ┌───────────────┐
│ ProtocolBridge  │ │SessionStore │ │TransportService │ │ SkillRegistry │
│(动作映射+提示词)│ │(血缘+快照)  │ │(连接+断线+附件) │ │ (纯净技能集)  │
└─────────────────┘ └─────────────┘ └─────────────────┘ └───────────────┘
```

1. **第一优先级（解除物理循环与倒置依赖）**：
   - 移除 `AccountPool` 对 `ChatHubClient` 的倒置引用；
   - 提取 `SessionCoordinator` 或引入 `IAgentExecutor` 接口，解开 `Orchestrator` 与 `SubagentRunner` 之间的互相实例化循环；
   - 将 `SessionLoggerTree` 移出 UI 目录，切断 Agent 对 UI 的反向依赖。
2. **第二优先级（深层化封装 Transport 与 Session）**：
   - 将 WebSocket 连接生命周期和 OneDrive 附件上传完全封装到 `TransportService`，消除编排器中的 `(client as any)?.close?.()` 与 Graph Token 获取逻辑；
   - 将纯内存的 `SessionLineageTracker` 与 `SessionManager` 合并持久化，彻底修复断电/强退丢失血缘图谱的隐患。
3. **第三优先级（消除浅层模块与上帝类拆解）**：
   - 合并 `compaction.ts` 与 `blackbox-compactor.ts`；
   - 拆解 2,000+ 行的 `cli.ts` 与 1,600+ 行的 `orchestrator.ts`；
   - 将 `tool-bridge.ts` 中的 Windows 编码自愈与大文件工件持久化剥离为专门模块。
