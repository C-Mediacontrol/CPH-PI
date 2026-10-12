# 对抗复核报告：模块深度与双向冲击面 (Dim-3: improve-codebase-architecture)

- **复核基准**: `CPH-PI/.docs/audit/report-A-architecture.md`
- **参考设计资产**:
  - `CPH-PI/.docs/specs/2026-10-12-subagent-execution-architecture-design.md`
  - `CPH-PI/.docs/specs/2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md`
  - `CPH-PI/.docs/specs/2026-10-12-main-session-virtualization-and-account-concurrency-design.md`
  - `CPH-PI/.docs/specs/2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md`
  - `CPH-PI/.docs/plans/2026-10-12-cph-pi-subagent-execution-architecture.md`
  - `CPH-PI/.docs/plans/2026-10-12-tri-agent-handoff-and-lineage-implementation-plan.md`
- **参考项目宪章**:
  - `E:\copilot-web proxy\AGENTS.md` (五大核心开发与治理准则)
  - `CPH-PI/AGENTS.md` (准则 1 Harness 中立性、准则 3 正向引导铁律、准则 6 行动导向与黑盒契约)
- **Git 核查范围**:
  - 核心提交：`5ac15b4`, `462f2ad`, `3a2dca2`, `8c213f0`, `b3438f3`, `29eb52b`, `009d1d1`, `21f68b8`, `b36fd6f`
  - 演进分支与工作区未跟踪文件扫描 (`subagent-runner.ts`, `lineage-tracker.ts`, `main-plan-snapshot.ts`)
- **统计**: 确凿 [7] | 既定设计 [1] | 违反宪章 [0] | 设计脱节 [1] | 误报 [1]

---

## 紧凑对账索引表 (Reconciliation Table)

| 编号 | 缺陷简述 | 文件与行号 | A置信度 | B裁决 | 核心依据摘要 |
|---|---|---|---|---|---|
| 1 | `CopilotOrchestrator` 与 `SubagentRunner` 循环实例化依赖 | `src/agent/orchestrator.ts:24, 642-659`<br>`src/agent/subagent-runner.ts:4, 277-286` | Level 1 | `[CONFIRMED]` | 顶层静态 import 互引；虽有 `createOrchestratorFn` 缝隙，但缺省硬编码 `new` 导致 ESM 模块循环耦合确凿。 |
| 2 | `IOrchestratorChatClient` 伪 Seam 与底层 Transport/Cloud 物理泄漏 | `src/agent/orchestrator.ts:40, 638-640, 734-745, 1298-1350`<br>`src/transport/chathub-client.ts`<br>`src/transport/substrate-uploader.ts` | Level 1 | `[INTENDED-DESIGN]` (Seam)<br>`[FALSE-POSITIVE]` (A3假缝隙论与宪章违规论)<br>`[CONFIRMED]` (内部泄漏) | 30+ 自动化测试依赖该接口 mock 离线网络，绝非假 Seam；A3 误引面向提示词的 Rule 6 批判 Harness 源码。但 `(client as any)?.close?.()` 与 OneDrive 直连确属泄漏。 |
| 3 | 会话状态与血缘追踪过度碎片化，内存血缘在进程中断时丢失 | `src/session/session-manager.ts:24-57`<br>`src/session/lineage-tracker.ts:18-93`<br>`src/session/main-plan-snapshot.ts:95-116`<br>`src/session/index.ts:1-8` | Level 1 | `[DRIFT-DESYNC]` | 规格书明确要求“在 SessionManager 与内存中维护继承血缘”，实现中 `SessionRecord` 漏落盘血缘字段；`formatSuccessorTurn1Prompt` 职责倒置泄露至存储层。 |
| 4 | 历史压实与容灾快照模块的人为割裂与循环 Barrel 导出 | `src/agent/compaction.ts:136-140`<br>`src/agent/blackbox-compactor.ts:1` | Level 2 | `[CONFIRMED]` | `compaction.ts` 重新导出 `BlackboxCompactor`，后者从前者导入 `TurnRecord`，二者均为 `TurnRecord[]` 预算裁剪能力，割裂且存在 Barrel 回环。 |
| 5 | 技能体系双轨制碎片化与调用方绕过 Registry 导致的封装破坏 | `src/skills/skill-loader.ts:23-60`<br>`src/skills/skill-registry.ts:10-60, 134-188`<br>`src/agent/subagent-runner.ts:234-243`<br>`src/cli.ts:52-53` | Level 2 | `[CONFIRMED]` | `subagent-runner` 自行 `new SkillLoader` 全盘重扫磁盘；`SkillRegistry` 杂糅 Slash 命令解析与 Prompt 拼装，缺乏单一入口封装。 |
| 6 | 认证层反向依赖传输层 (Auth -> Transport Reverse Dependency) | `src/auth/account-pool.ts:3, 236, 251, 260`<br>`src/transport/chathub-client.ts:35-45` | Level 1 | `[CONFIRMED]` | `AccountPool` 仅为调用 10 行 URL 正则方法 `normalizeAgentId` 便导入整个 `ChatHubClient`，严重违反单向依赖分层律。 |
| 7 | Agent 核心调度层反向依赖 UI 终端日志器 (Agent -> UI Reverse Dependency) | `src/agent/subagent-runner.ts:6, 213, 222`<br>`src/ui/terminal-logger.ts:18-24, 50-65` | Level 1 | `[CONFIRMED]` | `SessionLoggerTree` 负责 `.cph/logs/` 目录与文件流落盘，本属 Session 领域，却内嵌于 `src/ui/terminal-logger.ts`，迫使调度核反向依赖 UI 模块。 |
| 8 | 提示词协议中的负面禁用词与参数嗅探设计异味 | `src/protocol/prompt-builder.ts:27, 140-164` | Level 2 | `[CONFIRMED]` | 第 27 行“严禁输出工具块”正面违背项目宪章 Rule 3（正向引导铁律）；第 140-164 行通过字符串包含 "Skill"/"技能" 模糊对调实参，契约脆弱。 |
| 9 | CLI 上帝模块膨胀与极端扁平化的 26 参构造接口 | `src/cli.ts:35-80, 207-627` (全长 2082 行) | Level 2 | `[CONFIRMED]` | 2,082 行巨型类，构造函数 26 参，暴露所有私有组件的 getter/setter，缺乏封装屏障与局部性（Locality）。 |
| 10 | `protocol/tool-bridge.ts` 混杂低级 Windows 字节流解码与工件持久化职责 | `src/protocol/tool-bridge.ts:182-242, 249-394` (全长 821 行) | Level 2 | `[CONFIRMED]` | 协议动作桥接层直接内嵌 CP936/GBK 字节流边界补齐解码与 `.cph/artifacts/` 哈希文件持久化，低层系统与存储逻辑越界杂糅。 |

---

## 逐项事实对账详情

### 针对初审第 1 项：`CopilotOrchestrator` 与 `SubagentRunner` 循环实例化依赖
- **初审判定与架构分析**: A3 指出 `orchestrator.ts` 顶层导入 `SubagentRunner` 并在第 642-659 行直接 `new SubagentRunner`，而 `subagent-runner.ts` 顶层导入 `CopilotOrchestrator` 并在第 277-286 行直接 `new CopilotOrchestrator`，构成静态循环依赖，未隔离 Seam。
- **原作者辩护推演 (Steelmanning)**:
  1. 子代理在架构本质上必须具备完整的 Copilot 交互核能力（Sydney 协议、30 轮上限管控、Token 预算、工具执行与重试、Handoff 承接）。复用 `CopilotOrchestrator` 是确保子代理行为与主代理 100% 同构且零重复实现的最直接方案；
  2. 原作者实际上已经预留了依赖注入缝隙：`subagent-runner.ts` 声明了 `createOrchestratorFn?: (opts: any) => any;`，`orchestrator.ts` 也声明了 `subagentRunner?: SubagentRunner | any;`，用于单元测试 mock；
  3. 但为了让命令行在不需要 IoC 容器的情况下直接“开箱即用”，原作者在三元表达式的 fallback 分支中保留了静态 `new SubagentRunner(...)` 与 `new CopilotOrchestrator(...)`。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合 Harness 中立性；重构切断该循环属于纯粹的 Harness 内部物理工程解耦，不涉及对模型输出的非中立修补。
- **复核裁决**: `[CONFIRMED]` (确凿结构缺陷)
- **源码与上下文核验**:
  - `src/agent/orchestrator.ts` 第 24 行：`import { SubagentRunner } from "./subagent-runner.ts";`
  - `src/agent/subagent-runner.ts` 第 4 行：`import { CopilotOrchestrator, type OrchestratorRunOptions } from "./orchestrator.ts";`
  - 在 ESM/TypeScript 规范中，两个位于同级目录的核心类相互硬引用，形成了明确的静态依赖闭环。
- **设计文档与 Git 证据链**:
  - `CPH-PI/.docs/specs/2026-10-12-subagent-execution-architecture-design.md` 第 64 行指出了调度流：`Orchestrator -> invoke_subagent -> SubagentRunner -> 子 Orchestrator`。设计规范定义了单向调用链，但在代码落地时由于缺省构造函数硬编码导致物理双向循环。
- **最终保留建议**:
  - 保留！通过提取抽象接口 `ISubagentRunner` 与 `IAgentExecutor`，将 Orchestrator 对 SubagentRunner 的依赖转化为纯接口依赖，或在应用层（CLI / Coordinator）进行运行时工厂组装，彻底移除顶层相互静态 import。

---

### 针对初审第 2 项：`IOrchestratorChatClient` 伪 Seam 与底层 Transport/Cloud 物理细节在 Orchestrator 中的抽象泄漏
- **初审判定与架构分析**: A3 认为 `IOrchestratorChatClient` 仅有 `ChatHubClient` 这一处实际实现，是“假缝隙 (Hypothetical Seam)”，且指出编排器内部使用了 `(client as any)?.close?.()`、持有 Graph Token、直连 OneDrive `SubstrateUploader`，违背 AGENTS.md 准则 6。
- **原作者辩护推演 (Steelmanning)**:
  1. **关于 Seam 性质**：`IOrchestratorChatClient` 绝不是凭空臆想的无用抽象！全工程在 `tests/agent/`、`tests/cli/`、`tests/e2e/` 目录下有超过 30 个自动化单元测试（如 `MockChatHubClient`、`MockAgentChatClient`、`MockE2EChatClient`）依赖该接口。若无此抽象，所有离线单测都必须启动真实的微软 Sydney WebSocket 连接，测试基础设施将彻底崩溃；
  2. **关于 `(client as any)?.close?.()`**：当主代理派发子代理并发任务时，主会话进入“虚拟化冻结”状态。由于用户的微软凭据池账号并发数极为有限（通常仅 1~2 个账号），若主会话持续霸占活动 WebSocket 连接，并发子代理极易触发微软 429 限流或连接被云端踢出。因此原作者在此处主动释放长连接，让出账号池连接配额；
  3. **关于 `SubstrateUploader`**：Copilot Sydney 云端单轮对工具返回内容有严格物理限制。当工具输出超过 120k 字符或 3k 行时，Copilot 官方生态支持通过 OneDrive 附件注解（`AttachmentAnnotation`）实现大文件无损旁路交付。该逻辑需要在工具返回结果产出后、轮次提示词发送前触发，原作者就近置入调度流中。
- **项目宪章 (AGENTS.md) 校验**:
  - **严重纠偏**: A3 援引的 AGENTS.md 准则 6 原文为：“*严禁在 Agent 系统提示词或 Skill 中向模型解释底层 Harness 是如何运转的*”。该准则是对**面向大模型的 Prompt 和 Skill 内容**的黑盒约束（防止大模型注意力被底层实现污染），**绝非约束 Harness 自身 TypeScript 源码不得实现网络容错或连接生命周期管理**！A3 将 Prompt 治理规范张冠李戴到了 Harness 架构分层上，属判定误报。
  - 另外，若按 A3 观点“因为只有一个生产实现就删除该 Seam”，将直接摧毁 Harness 的自动化可测性，违反工业级工程底线。
- **复核裁决**:
  - 对 Seam 定位判定: `[INTENDED-DESIGN]` (关键测试缝隙) / `[FALSE-POSITIVE]` (A3 假缝隙论与宪章违规论均为误报)
  - 对内部实现判定: `[CONFIRMED]` (连接管理与 OneDrive 上传存在抽象泄漏)
- **源码与上下文核验**:
  - `src/agent/orchestrator.ts:638-640` 使用 `(client as any)?.close?.()`，说明 `IOrchestratorChatClient` 接口定义缺失生命周期方法；
  - `src/agent/orchestrator.ts:734-745` 编排器直接调用微软特定的 `SubstrateUploader.uploadDocumentToOneDrive`，使业务调度核硬编码了 Graph API 与云端附件注解逻辑。
- **设计文档与 Git 证据链**:
  - `CPH-PI/.docs/specs/2026-10-12-main-session-virtualization-and-account-concurrency-design.md` 第 3 节专门定义了“主会话虚拟化与并发账号配额释放机制”；
  - Git commit `3a2dca2` ("fix(orchestrator): enforce aggressive lossless cloud attachment delivery") 证实云端附件上传是经专门实测优化的特性。
- **最终保留建议**:
  - 驳回 A3“删除 `IOrchestratorChatClient`”的建议！完整保留该测试接口，并在接口中显式声明 `close?(): void | Promise<void>`；
  - 将 OneDrive 附件上传提取为独立的 `AttachmentOffloader` 策略或下沉至 Transport/Storage 层，使 Orchestrator 仅通过标准接口感知附件注入结果。

---

### 针对初审第 3 项：会话状态与血缘追踪过度碎片化，内存血缘在进程中断时丢失
- **初审判定与架构分析**: A3 指出会话领域被割裂在 `SessionManager`、`SessionLineageTracker`、`MainPlanSnapshot` 和 `session/index.ts` 4 个模块中。核心的 `SessionLineageTracker` 纯存内存、无落盘，进程中断重启后血缘链条断裂；`MainPlanSnapshot` 中内嵌了 `formatSuccessorTurn1Prompt` 提示词拼接。
- **原作者辩护推演 (Steelmanning)**:
  1. `SessionLineageTracker` 最核心的物理使命，是防范**运行期（In-Flight）并发调度中的 429 容灾脱节**：当主会话正在等待 2 个异步并发子代理攻坚，若主会话所在账号突然暴毙触发 429 容灾接力迁移为新会话，子代理结题返回时必须能够在内存中通过 `resolveActiveHead(mainId)` 动态查找到当前存活的新主端点，将报告投递给它；
  2. 因此，血缘追踪器首要保证的是内存查找的高性能与防环安全性（`visited` 机制）；
  3. `MainPlanSnapshot` 的产生背景是虚拟化架构需要在 `.cph/handoffs/` 生成专门的人类可读 Markdown 蓝图供后继者继承。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合 Harness 中立性。但内存血缘不落盘确实违反了 Harness“提供可靠客观调度”的基石职责。
- **复核裁决**: `[DRIFT-DESYNC]` (设计与实现脱节)
- **源码与上下文核验**:
  - 查阅 `CPH-PI/src/session/lineage-tracker.ts` 全文（共 93 行），全类仅有私有字段 `private registry = new Map<string, SessionLineage>()`，无任何 `fs.writeFileSync` 或与 `SessionManager` 的联动落盘；
  - 查阅 `CPH-PI/src/session/session-manager.ts` 第 24-57 行，`SessionRecord` 与 `SessionIndexItem` 中包含 `handoffSnapshot`、`disasterBlackbox`，但**完全没有定义 `parentSessionId`、`predecessorId`、`successorId`、`subagentSessionIds` 字段**；
  - 查阅 `CPH-PI/src/session/main-plan-snapshot.ts` 第 95-116 行，确实导出了提示词模板生成函数 `formatSuccessorTurn1Prompt`。
- **设计文档与 Git 证据链**:
  - 查看设计规范 `CPH-PI/.docs/specs/2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md` 第 4.1 节，其设计要求原文为：
    `在 SessionManager 与内存中维护继承血缘：export interface SessionLineage ...`
  - 事实证明：**架构设计文档明确要求在 `SessionManager` 中维护血缘持久化，但具体代码实施时仅写了内存 Map，遗漏了向 `SessionRecord` 和磁盘的持久化落地**！属于典型且确凿的设计实现脱节（Drift Desync）。
- **最终保留建议**:
  - 保留！将 `SessionLineage` 元数据作为 `SessionRecord` 的固有属性，由 `SessionManager` 写入 `.cph/sessions/index.json` 与详情文件，使断电重启后血缘图谱完全可重构；
  - 将 `formatSuccessorTurn1Prompt` 移至 `protocol/prompt-builder.ts`；补齐 `session/index.ts` 导出。

---

### 针对初审第 4 项：历史压实与容灾快照模块的人为割裂与循环 Barrel 导出
- **初审判定与架构分析**: A3 指出 `compaction.ts` 重新导出 `BlackboxCompactor`，而 `blackbox-compactor.ts` 第一行便从 `compaction.ts` 导入 `TurnRecord`，构成循环 Barrel 依赖；且两模块均为基于 `TurnRecord[]` 的上下文预算裁剪，割裂严重。
- **原作者辩护推演 (Steelmanning)**:
  1. `CompactionService` 最初是用于会话运行期间两轮滑动压实（将早期历史的工具输出打桩替换）；
  2. 但在现网实测后（参见设计规范 `2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md` 第 1 节），架构组确立了“实测证明云端可容纳 14 万+ 字符，正常会话中本地不进行任何主动剪枝”的原则，日常滑动压实默认被关闭；
  3. `BlackboxCompactor` 则是为了解决“突发 429 或连接猝死时，将 10 万字日志安全浓缩为 5k~8k 事故现场快照供接力会话消费”这一特定容灾场景而独立研发的深层算法；
  4. 原作者在 `compaction.ts` 尾部增加 re-export 是为了让外部通过单个文件引入所有压实相关的能力，而 `blackbox-compactor.ts` 中仅使用了 `import type`（TS 编译后会被擦除，不产生运行时循环崩溃）。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合治理准则。
- **复核裁决**: `[CONFIRMED]` (设计异味 / 浅层模块 / 静态循环导出)
- **源码与上下文核验**:
  - `src/agent/compaction.ts:136-139`: `export { BlackboxCompactor, type BlackboxCompactorOptions } from "./blackbox-compactor.ts";`
  - `src/agent/blackbox-compactor.ts:1`: `import type { TurnRecord } from "./compaction.ts";`
  - 源码物理结构与 A3 描述 100% 一致。虽然 `import type` 在运行时无害，但在静态模块依赖图谱中构成了双向死锁，且 `CompactionService` 仅 140 行、职责极浅，与 `BlackboxCompactor` 本质上共享相同的上下文预算计算逻辑。
- **设计文档与 Git 证据链**:
  - `2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md` 显示两者均为上下文裁剪策略演进过程中的产物。
- **最终保留建议**:
  - 保留！将 `compaction.ts` 与 `blackbox-compactor.ts` 合并为高内聚的 `ContextBudgetManager`（或统一的 `HistoryCompactor`），将 `TurnRecord` 的唯一定义收敛至此，彻底解除循环 Barrel。

---

### 针对初审第 5 项：技能体系双轨制碎片化与调用方绕过 Registry 导致的封装破坏
- **初审判定与架构分析**: A3 指出 `SkillLoader` 与 `SkillRegistry` 存在碎片化；`subagent-runner.ts` 绕过 Registry 直接 `new SkillLoader` 扫描磁盘；`SkillRegistry` 包揽了 Slash 命令解析和 Prompt 渲染，职责发散。
- **原作者辩护推演 (Steelmanning)**:
  1. `SkillRegistry` 在设计之初主要服务于 **CLI 交互会话**（维护用户当前激活的技能，支持 `/brainstorming` 等 Slash 命令）；
  2. 而在子代理并发执行时，设计规范（`2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md`）严格规定：**子代理绝不能继承用户在主交互终端中激活的花哨技能，子代理必须且只能挂载 `handoff` 技能**；
  3. 原作者为了避免子代理意外继承主会话 `SkillRegistry` 中的脏状态，选择在 `SubagentRunner` 中临时 `new SkillLoader(this.workspaceRoot)` 独立抓取干净的 `handoff` 技能。
- **项目宪章 (AGENTS.md) 校验**:
  - 隔离子代理技能的做法高度符合 AGENTS.md 准则 4（通用 Skill 绝对中立与定制隔离）。但实现手法过于原始（每次子代理运行都重新执行 6 个路径的目录遍历与磁盘 IO）。
- **复核裁决**: `[CONFIRMED]` (设计异味 / 浅层模块 / 封装破坏)
- **源码与上下文核验**:
  - `src/agent/subagent-runner.ts:234-243` 确凿存在直接 `new SkillLoader(this.workspaceRoot)` 并执行 `loader.discoverSkills()` 的磁盘遍历代码；
  - `src/skills/skill-registry.ts:139-186` 确凿包含了 `parseSlashCommand`（CLI 输入解析）和 `buildPromptSection`（提示词协议渲染）。
- **设计文档与 Git 证据链**:
  - `2026-10-12-subagent-execution-architecture-design.md` 强调了子代理技能必须裁剪；但工程实现中缺乏针对这一需求的专属方法（如 `registry.createIsolatedSubagentRegistry(["handoff"])`）。
- **最终保留建议**:
  - 保留！将 `SkillLoader` 作为内部私有加载机制完全封进 `SkillRegistry`（或统一的 `SkillManager`），对外提供 `getSkill(name)` 与 `createIsolatedSnapshot(names)`，杜绝外部直接 new Loader 扫盘；将 Slash 命令解析迁入 CLI 输入层。

---

### 针对初审第 6 项：认证层反向依赖传输层 (Auth -> Transport Reverse Architectural Dependency)
- **初审判定与架构分析**: A3 指出底层 `auth/account-pool.ts` 导入了上层 `transport/chathub-client.ts`，仅为了调用静态工具方法 `ChatHubClient.normalizeAgentId`，构成严重的分层倒置。
- **原作者辩护推演 (Steelmanning)**:
  1. 微软 Copilot Agent 标识形式多样：用户可能传入单纯的 GUID 字符串，也可能直接从浏览器地址栏复制完整 URL（形如 `https://copilot.microsoft.com/chat/agent/T_9ace...`）；
  2. 原作者最初在 `ChatHubClient` 构建 WebSocket 请求路径时顺手编写了 `normalizeAgentId` 正则解析工具；
  3. 随后在实现多账号池支持自定义 Agent 过滤功能（记录哪些账号无权限访问特定 Agent）时，需要用规范化的 Agent ID 作为 Map Key。原作者为了避免重复编写正则表达式，直接 `import { ChatHubClient }` 调用了该静态方法。
- **项目宪章 (AGENTS.md) 校验**:
  - 纯物理分层缺陷，不涉及 Harness 中立性争议。
- **复核裁决**: `[CONFIRMED]` (确凿的分层倒置缺陷)
- **源码与上下文核验**:
  - `src/auth/account-pool.ts` 第 3 行：`import { ChatHubClient } from "../transport/chathub-client.ts";`
  - 第 236、251、260 行多次调用 `ChatHubClient.normalizeAgentId(agentId)`；
  - 查阅 `src/transport/chathub-client.ts` 第 35-45 行，`normalizeAgentId` 仅是一段 10 行的纯文本正则表达式，没有任何对网络、WebSocket、SignalR 乃至类的成员状态依赖。
- **设计文档与 Git 证据链**:
  - `2026-10-10-cph-pi-custom-agent-and-gpt61-implementation.md` 任务记录显示，该功能系在多账号池增加 Agent 鉴权时顺手引入的快捷调用。
- **最终保留建议**:
  - 保留！将 `normalizeAgentId` 独立提取至 `protocol/agent-identity.ts` 或轻量领域工具文件，供 `AccountPool` 与 `ChatHubClient` 共同依赖，彻底消除反向分层依赖。

---

### 针对初审第 7 项：Agent 核心调度层反向依赖 UI 终端日志器 (Agent -> UI Reverse Dependency)
- **初审判定与架构分析**: A3 指出 `subagent-runner.ts` 导入并依赖 `ui/terminal-logger.ts` 的 `SessionLoggerTree` 接口，且 `TerminalLogger` 包揽了目录创建、子代理日志流和 `timeline.jsonl` 落盘，造成 Agent 反向依赖 UI。
- **原作者辩护推演 (Steelmanning)**:
  1. CPH-PI 在 Windows PowerShell / Windows Terminal 运行长期任务时，曾遭遇严重的终端回滚缓冲区截断问题（控制台输出被冲刷丢失）；
  2. 原作者在 `src/ui/` 下建立了 `TerminalLogger`，通过劫持 `process.stdout.write` 将控制台所有 ANSI 流实时分流（Tee）持久化到本地日志，保障用户在 UI 崩溃时仍可审计全量日志；
  3. 当引入 Subagent 并发执行时，每个子代理需要独立的日志流（避免多代理输出在终端交织混乱）。原作者顺理成章地将“子代理独立日志流”作为终端日志体系的子集，放在了 `TerminalLogger.initSessionTree` 中。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合治理准则。
- **复核裁决**: `[CONFIRMED]` (确凿的分层倒置与职责错位缺陷)
- **源码与上下文核验**:
  - `src/agent/subagent-runner.ts` 第 6 行：`import type { SessionLoggerTree } from "../ui/terminal-logger.ts";`
  - `src/ui/terminal-logger.ts` 第 18-24 行声明了 `SessionLoggerTree`，第 50-65 行实现了创建 `.cph/logs/<cleanSessionId>/subagents` 物理目录、写入 `main.log` 和 `timeline.jsonl` 的逻辑；
  - 文件系统日志落盘属于 Session/Storage 领域的基础设施，与终端 ANSI 拦截呈现（UI）完全非正交。核心智能体调度核（Agent）依赖 UI 目录中的模块，违背了 Clean Architecture 原则。
- **设计文档与 Git 证据链**:
  - `CPH-PI/.docs/plans/2026-10-12-cph-pi-subagent-execution-architecture.md` Task 4 中设计了此日志树；因开发节奏紧凑，作者直接将其挂载在现有的 `TerminalLogger` 上。
- **最终保留建议**:
  - 保留！将 `SessionLoggerTree` 与会话文件日志流管理器抽取至 `src/session/session-logger.ts`；UI 层（`TerminalLogger`）仅作为日志事件的可选消费者，切断 Agent 对 UI 层的反向依赖。

---

### 针对初审第 8 项：提示词协议中的负面禁用词与参数嗅探设计异味
- **初审判定与架构分析**: A3 指出 `PromptBuilder.PROTOCOL_REMINDER` 第 27 行包含“严禁输出工具块”，违反 AGENTS.md 准则 3；且 `buildTurn2TaskPrompt` 内部通过包含 "Skill"/"技能" 模糊对调实参。
- **原作者辩护推演 (Steelmanning)**:
  1. **关于“严禁”**：在前期大量现网对话中，Copilot 模型在任务已经全部完成时，极易产生“复读”或“臆想一个多余的空工具块（如空 read_file）”的顽疾，导致轮次白白浪费甚至陷入死循环。原作者出于对模型行为失控的极度防御，使用了带有强烈警示语气的“严禁”字眼；
  2. **关于参数嗅探**：在多轮迭代中，`buildTurn2TaskPrompt` 的调用方（测试代码与 Orchestrator）在参数重构后出现了传参顺序不一致的历史遗留问题。原作者为了避免大面积重构单测导致测试断裂，加入了启发式类型嗅探代码作为兼容垫片。
- **项目宪章 (AGENTS.md) 校验**:
  - **严重违背准则 3**: `AGENTS.md` 准则 3 明确规定：“*正向引导铁律：摒弃负面禁止词，杜绝使用‘严禁……’、‘切勿……’、‘不要……’，全面转为建设性的正向引导。负面词极易引发粉色大象效应（注意力分散、诱发模型复读禁用关键词进而导致协议解析冲突）*”。
  - 源码中的“严禁输出工具块”正是准则 3 明令禁止的典型违规反例！
- **复核裁决**: `[CONFIRMED]` (确凿的项目宪章违背与脆弱防御性补丁)
- **源码与上下文核验**:
  - `src/protocol/prompt-builder.ts` 第 27 行物理现状：
    `2. 若全部步骤已完成且无需后续动作，严禁输出工具块，必须直接输出交付格式：`
  - `src/protocol/prompt-builder.ts` 第 150-159 行物理现状：
    ```typescript
    if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
      skillsSection = arg2;
      toolResult = arg3;
    } else if (arg3.includes("Skill") || arg3.includes("技能")) {
      toolResult = arg2;
      skillsSection = arg3;
    }
    ```
- **设计文档与 Git 证据链**:
  - Git commit `3a2dca2` ("fix(orchestrator): enforce aggressive lossless cloud attachment delivery and affirmative prompt contract") 记录了前期尝试修改为正向提示词的演进脉络，但第 27 行遗漏了清洗。
- **最终保留建议**:
  - 保留！坚决落实 AGENTS.md 准则 3，将第 27 行重写为纯正向建设性引导：“*2. 当全部步骤验证完成且目标达成时，请直接输出最终交付总结：FINAL_ANSWER: <任务交付总结说明>*”；
  - 将 `buildTurn2TaskPrompt` 改为强类型配置对象入参，彻底删除启发式字符串嗅探分支。

---

### 针对初审第 9 项：CLI 上帝模块膨胀与极端扁平化的 26 参构造接口
- **初审判定与架构分析**: A3 指出 `cli.ts` 膨胀至 2,082 行，`CphPiCliOptions` 拥有 26 个配置项，包含了参数解析、REPL、配置持久化、数百行命令处理，暴露全部底层组件的 getter/setter，无封装屏障。
- **原作者辩护推演 (Steelmanning)**:
  1. `CphPiCli` 扮演了整个终端应用程序的**唯一组合根 (Composition Root / Application Container)**；
  2. 原作者希望在一个顶层类中完成所有子系统的实例化组装（AccountPool, Orchestrator, TuiRenderer, ToolBridge, SessionManager 等）；
  3. 为了对整个 CLI 交互流程编写极其细致的端到端白盒测试（在测试中模拟用户输入特定命令并断言内部各组件的状态），原作者在 `CphPiCli` 上完整暴露了所有子系统的 Getter 与 Setter。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合治理准则。
- **复核裁决**: `[CONFIRMED]` (确凿的上帝类膨胀与缺乏 Locality)
- **源码与上下文核验**:
  - `src/cli.ts` 物理行数确认：2,082 行，体积 78KB；
  - `CphPiCliOptions` 接口参数确认：多达 26 个字段；
  - `cli.ts` 内联了完整的 `parseCliArgs`（245 行）、`handleCommand` 包含 7 种复杂命令的完整控制台打印与配置读写。
- **设计文档与 Git 证据链**:
  - 伴随历次 plan 的落地（多账号支持、自定义 Agent、中断控制器、会话恢复），新功能特性均以线性追加方式直接堆叠入 `cli.ts`。
- **最终保留建议**:
  - 保留！将命令行参数解析提取为 `cli/args.ts`，交互式命令路由提取为 `cli/commands/`，REPL 交互循环提取为 `cli/repl.ts`，使主 `cli.ts` 缩减为 200 行以内的纯粹组装管道。

---

### 针对初审第 10 项：`protocol/tool-bridge.ts` 混杂低级 Windows 字节流解码与工件持久化职责
- **初审判定与架构分析**: A3 指出 `tool-bridge.ts` 职责应为协议动作映射，但内部混入了处理 Windows CP936/GBK 编码自愈的底层字节流解码器（`smartDecodeBuffer`, `decodeStreamChunk`）以及大输出哈希文件落盘（`persistLargeOutputIfNeeded`），导致模块膨胀至 821 行。
- **原作者辩护推演 (Steelmanning)**:
  1. **关于编码自愈**：在 Windows 平台上，执行 `dir`、`cmd` 或 `ipconfig` 等原生命令时，系统默认输出 GBK（CP936）多字节流。Pi 官方上游工具链原生仅支持 UTF-8，在遇到 GBK 中文字符被分块截断时会喷出大量菱形问号（`\uFFFD`）。原作者必须拦截底层子进程的 `stdout/stderr` 数据流，执行跨字节边界的自愈拼接；
  2. **关于工件持久化**：Copilot Sydney 云端无法承受几千行的命令输出（如 `git log` 或全量扫描）。当工具执行完毕并返回结果时，必须在交回给编排器之前立刻拦截超大输出，写入 `.cph/artifacts/` 并生成双端预览；
  3. 因为这两项能力都是在**Copilot Action 被转化为 Pi 本地工具执行的“进出卡口”处**发生的，原作者为了实现拦截与增强的一站式闭环，将它们全部写在了 `tool-bridge.ts` 内部。
- **项目宪章 (AGENTS.md) 校验**:
  - 符合治理准则（此为物理环境与协议适配的工业级增强）。
- **复核裁决**: `[CONFIRMED]` (确凿的职责杂糅与内聚度不足)
- **源码与上下文核验**:
  - `src/protocol/tool-bridge.ts` 第 182-242 行完整实现了大文件 SHA256 哈希计算、`.cph/artifacts/` 目录确保、文件落盘与双端截断生成；
  - 第 249-350 行完整实现了 `TextDecoder("gbk")`、检测多字节前导码（`0xc2`~`0xf4`）、GBK 高字节奇偶计数（`highCount % 2 === 1`）等低级字节流算法；
  - 这些操作系统级与存储级的底层机制与“Copilot 协议桥接（将 action 映射为 tool 调用）”在领域概念上完全正交。
- **设计文档与 Git 证据链**:
  - `2026-10-10-cph-pi-encoding-healing-and-autonomous-handoff-implementation.md` 显示编码自愈是作为关键平台增强引入的。
- **最终保留建议**:
  - 保留！将底层 Windows 编码自愈提取为 `src/platform/encoding-healer.ts`，将超大输出工件归档提取为 `src/session/artifact-manager.ts`，`ToolBridge` 仅保留对它们的轻量级组合调用。

---

## 裁决综合结论与实施门禁 (Executive Verdict & Implementation Gate)

本复审代理 B3 对初审报告 A3 的 10 项缺陷进行了全面客观的证伪与事实核验，裁决结论如下：

1. **确凿成立项 (7项)**：第 1、4、5、6、7、8、9、10 项缺陷在源码物理现状与架构原则上完全成立，应纳为重构目标；
2. **纠偏与澄清项 (第 2 项)**：
   - 坚决驳回 A3“`IOrchestratorChatClient` 是应予删除的假 Seam”的裁决！该接口是维系 30+ 自动化测试的生命线；
   - 纠正 A3 对 `AGENTS.md` 准则 6 的张冠李戴误读；
   - 确认编排器内 `(client as any)?.close?.()` 与 OneDrive 直连确属抽象泄漏，应予封装而非摧毁 Seam；
3. **设计脱节项 (第 3 项)**：确认规格设计文档（`tri-agent-handoff-and-lineage-architecture-design.md`）已先行规划了持久化血缘，但生产代码发生实现脱节（Drift），应立即补齐；
4. **宪章违规警示项 (第 8 项)**：确认提示词第 27 行“严禁输出工具块”正面违背项目宪章准则 3，必须立刻按照正向引导原则进行文本清洗。

**后续实施硬性门禁**：
在主协调代理汇总生成综合仲裁裁决并由用户批准前，**严禁修改任何生产源码**！
