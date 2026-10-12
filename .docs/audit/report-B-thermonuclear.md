# 对抗复核报告：热核级架构与分支异味 (Dim-4: thermo-nuclear-code-quality-review)

- **复核基准**: `E:\copilot-web proxy\CPH-PI\.docs\audit\report-A-thermonuclear.md`
- **参考设计资产**:
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-10-cph-pi-session-management-and-handshake-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-12-main-session-virtualization-and-account-concurrency-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\specs\2026-10-12-subagent-execution-architecture-design.md`
  - `E:\copilot-web proxy\CPH-PI\.docs\plans\2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-implementation.md`
- **参考项目宪章**:
  - `E:\copilot-web proxy\AGENTS.md` (核心准则 1, 2, 3, 4, 6)
  - `E:\copilot-web proxy\CPH-PI\AGENTS.md` (准则 1: Harness 纯粹与中立原则; 准则 3: 摒弃负面禁止词铁律; 准则 6: 行动导向与黑盒抽象)
- **Git 核查范围**:
  - `b8ad75a feat: initial commit of CPH-PI autonomous coding agent harness` (追踪 orchestrator 与 handoff 原始实现)
  - `a656b4f feat(orchestrator): implement generational successor main session relay and prompt injection` (追踪代际跃迁实现)
  - `e31676e test(integration): verify end-to-end main session virtualization and adaptive queue relay` (追踪单账号队列与虚拟化测试)
- **统计**: 确凿 [5] | 既定设计 [1] | 违反宪章 [1] | 设计脱节 [1] | 误报 [0]

---

## 紧凑对账索引表 (Reconciliation Table)

| 编号 | 缺陷简述 | 文件与行号 | A置信度 | B裁决 | 核心依据摘要 |
|---|---|---|---|---|---|
| 1 | 业务特化规则硬编码污染公共 Handoff 通道与负面禁止词 | `src/agent/orchestrator.ts#L1050-L1071`, `L1132-L1136` | Level 1 | `[VIOLATES-GOVERNANCE-RULE]` | 明确违背 AGENTS.md 准则 1 (调度中立严禁替模型擦屁股) 与准则 3 (摒弃“切勿”等负面禁止词) |
| 2 | `cli.ts` 膨胀至 2082 行突破千行死刑线，六大职责混杂 | `src/cli.ts#L1-L2082` | Level 1 | `[CONFIRMED]` | 物理行数 2081 行，单体包含参数解析、REPL、360 行命令 if 链、报表 ANSI 拼装与 290 行接力循环 |
| 3 | `orchestrator.ts` 膨胀至 1646 行，三巨头超长方法缺乏结构分解 | `src/agent/orchestrator.ts#L304-L862`, `L895-L1257`, `L1361-L1646` | Level 1 | `[CONFIRMED]` | `run()` 558行、`generateHandoffSnapshot()` 362行、`executeDisasterRecoveryArbitration()` 285行形成上帝类 |
| 4 | 幽灵抽象与死代码残留：`compaction.ts` 冗余并造成概念混淆 | `src/agent/compaction.ts#L1-L140`, `src/agent/orchestrator.ts#L158`, `L763-L774` | Level 2 | `[DRIFT-DESYNC]` | 早期滑动微压实设计在 10-10 实测免裁剪原则后弃用，硬编码关闭且无生产入口，但遗留死代码与双重导出 |
| 5 | `PromptBuilder` 中的动态类型反推与字符串猜谜代码 | `src/protocol/prompt-builder.ts#L140-L164` | Level 2 | `[CONFIRMED]` | `arg2.includes("Skill")` 运行时反推形参顺序，工具输出包含 "Skill" 时会引发严重颠倒 Bug |
| 6 | `SubagentRunner` 单次执行高频触发全盘技能扫描与重复构造 | `src/agent/subagent-runner.ts#L233-L243` | Level 2 | `[CONFIRMED]` | 每次启动子代理均同步全盘扫描 6 个目录读取磁盘，绕过已有的技能加载器缓存，并发产生无谓 I/O 阻塞 |
| 7 | `invoke_subagent` 破坏统一工具调度通道，强行与 Orchestrator 主循环混杂 | `src/agent/orchestrator.ts#L624-L712` | Level 2 | `[INTENDED-DESIGN]` | `invoke_subagent` 属于元控制流跃迁而非普通物理操作系统工具，由 Orchestrator 主控属于合理既定设计，但内联实现加剧了大方法异味 |
| 8 | `src/cli.ts` 参数手写解析器与大量重复静态/实例透传代码 | `src/cli.ts#L300-L325`, `L1683-L1926`, `L1980-L1991` | Level 3 | `[CONFIRMED]` | 240 行原生手写解析循环，类内存在 6 个纯转发的冗余静态/实例方法包装，平白增加心智与维护负担 |

---

## 逐项事实对账详情

### 针对初审第 1 项：业务特化规则硬编码污染公共 Handoff 生成通道
- **初审判定与代码柔道提案**:
  - 初审指出：`orchestrator.ts` L1050-L1071 与 L1132-L1136 硬编码了对 `.NET SDK`、`dotnet`、`winget`、`[System.IO.Path]` 的专用正则匹配与故障提示，甚至出现“切勿盲目重复调用 winget”等负面禁止词，违背 AGENTS.md 准则 1 和 3。
  - 提案建议：彻底删除这 40+ 行业务特化匹配与 hardcoded 提示文本，恢复通用调度器的协议中立性，将环境排错引导归还给对应 Skill。
- **原作者辩护推演 (Steelmanning)**:
  - 在 Windows 命令行实测环境下，Copilot Agent 执行构建或运行任务时，极高概率遭遇未安装 .NET 8 SDK 的情况。模型此时会下意识尝试调用 `winget install Microsoft.DotNet.SDK.8`，但在非管理员权限下 winget 会报错 `0x80070005 (Access is denied)`。
  - 模型无法理解系统提权受限，极易在随后的会话中陷入死循环反复重试 `winget`。原作者在遭遇 429 或交接换人时，希望在生成的交接文档中一次性把“这是环境/提权卡点，别再反复调 winget，找免安装 zip”作为事实直接告知接力 Agent，防止下一代 Agent 继续在坑中消耗 token。
- **项目宪章 (AGENTS.md) 校验**:
  - `CPH-PI/AGENTS.md` **准则 1 (Harness Neutrality)** 明确规定：“Harness 本身应当保持中立与协议纯粹。无论 Copilot 模型返回何种内容（不论对错），Harness 只管按统一既定协议进行客观处理、工具路由与流式渲染。严禁替模型‘擦屁股’：严禁在 Harness 中引入特化的容错补丁……如果模型输出了期望以外的内容，**应该调整的是系统提示词与专属 Skill 内容**；只有在确认 Harness 本身存在物理实现缺陷或工程 Bug 时，方可修改 Harness 源码。”
  - `CPH-PI/AGENTS.md` **准则 3 (摒弃负面禁止词铁律)** 明确规定：“杜绝使用‘严禁……’、‘切勿……’、‘不要……’等负面禁止词，全面转为建设性的正向引导……明确告知其当前目标与正确行动路径即可。”
  - 源码 L1134 使用了“切勿盲目重复调用 winget”，且将特定工具（winget）和特定运行库（.NET）的特化逻辑硬编码进核心 Harness，若后续执行 Python、Go、Node 等项目将产生严重的注意力误导与偏见。
- **复核裁决**: `[VIOLATES-GOVERNANCE-RULE]`
  - 此项不仅是结构异味，更是严重的**项目宪章条款违背**。初审定性精准。
- **源码与上下文核验**:
  - 经查看 `src/agent/orchestrator.ts` L1050-L1065 与 L1132-L1136，物理行号与源码文本与 A4 报告 100% 完全对账一致。
- **设计文档与 Git 证据链**:
  - 该段代码早在初版提交 `b8ad75a` (feat: initial commit of CPH-PI autonomous coding agent harness) 即已存在，属于早期原型实测中留下的特化保底代码，在后续确立 AGENTS.md 宪章后未被重构清理。
- **最终保留建议**:
  - **采纳 A4 精简提案**：彻底删除针对 `.NET/winget/PowerShell` 的 hardcoded 正则分支；改为通用的错误事实提取（最近失败动作、退出码、KeyError 预览）；正向引导通过 `systematic-debugging` 技能或系统提示词下发。

---

### 针对初审第 2 项：`cli.ts` 膨胀至 2082 行，突破千行死刑线，六大职责高度缠绕
- **初审判定与代码柔道提案**:
  - 初审指出：`src/cli.ts` 突破 2000 行大关（达 2082 行），揉杂了手写参数解析（250行）、巨型交互命令路由（360行 if-else）、UI 文本与报表拼装（350行）、多代自主接力调度循环（290行）与终端 Readline 输入缓冲（130行）。
  - 提案建议：抽离声明式 `CommandRegistry`、报表下沉领域模块、接力循环抽取至 `TaskRelayRunner`、参数解析抽取至 `src/cli/args.ts`，将 `cli.ts` 瘦身至 400 行以内。
- **原作者辩护推演 (Steelmanning)**:
  - `cli.ts` 是整个 TUI 的主驱动进程（Console App Entrypoint）。在交互式 CLI 中，Readline 事件监听、按键绑定（Ctrl+C 双击退出、多行输入缓冲）、Slash 命令响应与任务执行状态机紧密交织。
  - 原作者为了快速迭代交互体验与调试功能，采用单体类 `CphPiCli` 统摄全生命周期，并在同一入口内支持单命令模式（`--task`）、交互模式（REPL）与一键续跑（`/continue`），便于全局共享实例状态（如 `this.currentSession`、`this.orchestrator`、`this.renderer`）。
- **项目宪章 (AGENTS.md) 校验**:
  - AGENTS.md 准则 6 倡导“行动导向与认知极简”。
  - 一个超过 2000 行的巨石单文件不仅对人类维护者构成认知负担，且对 AI 代理的代码检索与安全变更造成极高成本。尤其 360 行的单体 `if-else` 命令分发（L767-L1126）使得新增或测试任何一个 Slash 命令都必须动这个巨型文件。
- **复核裁决**: `[CONFIRMED]`
  - 物理行数达 2081 行，职责严重缠绕确凿。
- **源码与上下文核验**:
  - 物理检查 `src/cli.ts`，行数确为 2081 行。包含 `handleCommand`（L767-L1126，360行）、`executeTask`（L1360-L1648，289行）、`parseCliArgs`（L1683-L1926，244行）、`formatSessionsList` 与 `formatAccountsList` 等多个大函数。
- **设计文档与 Git 证据链**:
  - 从 `2026-10-10-cph-pi-implementation.md` 至 `2026-10-12-cph-pi-subagent-execution-architecture.md`，随着接力循环、多代会话、三阶容灾、账号状态管理等特性不断追加至 CLI，`cli.ts` 持续线性膨胀，未做及时的模块化解构。
- **最终保留建议**:
  - **采纳 A4 建议并设置渐进式重构路线**：
    1. 第一步：抽离 `src/cli/args.ts`（参数解析），安全无副作用；
    2. 第二步：将 `formatSessionsList`、`formatAccountsList` 报表渲染抽离或下沉；
    3. 第三步：重构 `CommandDispatcher` 映射表，保持 `CphPiCli` 外部公共 API 与测试用例完全兼容。

---

### 针对初审第 3 项：`orchestrator.ts` 膨胀至 1646 行，三巨头超长方法缺乏结构分解
- **初审判定与代码柔道提案**:
  - 初审指出：`orchestrator.ts` 达 1646 行，主要被 3 个超长方法垄断：`run()` (558 行)、`generateHandoffSnapshot()` (362 行)、`executeDisasterRecoveryArbitration()` (285 行)，承担了握手、网络、容灾、工具、代际、文档生成等全部职责。
  - 提案建议：抽离独立的 `DisasterRecoveryArbitrator` 与 `HandoffDocumentGenerator`，将单轮执行抽象为 `TurnExecutionPipeline`。
- **原作者辩护推演 (Steelmanning)**:
  - `Orchestrator` 作为中心执行内核，需要对会话生命周期拥有强保证。`executeDisasterRecoveryArbitration` 作为发生 429 或网络猝死时的兜底防线，必须直接操作账号池换号、构造仲裁 Client、触发工具落地与本地写盘。将其封装在类内，可使得外部调用方只需统一调用 `await orchestrator.run()` 即可透明获得自愈保障。
  - `generateHandoffSnapshot` 需要访问工作区根目录、当前会话 ID 与完整历史 `TurnRecord[]`，作为内部辅助方法组装结构化 Markdown。
- **项目宪章 (AGENTS.md) 校验**:
  - AGENTS.md 准则 1 强调 Harness 纯粹调度与中立。
  - 虽然功能目标符合规范，但从代码质量和维护性角度看，558 行的 `run()` 方法中嵌套了 Refusal 重试、子代理虚拟化、云端附件上传、三阶段容灾等多层嵌套，严重违背高内聚低耦合原则。
- **复核裁决**: `[CONFIRMED]`
  - 确凿的超长方法与上帝类架构异味。
- **源码与上下文核验**:
  - 经查 `src/agent/orchestrator.ts`：
    - `run()`: L304-L862 (558 行)
    - `generateHandoffSnapshot()`: L895-L1257 (362 行)
    - `executeDisasterRecoveryArbitration()`: L1361-L1646 (285 行)
    - 全文件 1646 行，三巨头占据了全文件超过 73% 的代码量。
- **设计文档与 Git 证据链**:
  - `2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md` 规划了三阶容灾与黑匣子，但实现时全部堆砌在了 `Orchestrator` 单个类中。
- **最终保留建议**:
  - **采纳 A4 重构方案**：将 `generateHandoffSnapshot` 抽取为独立的 `HandoffDocumentGenerator`，将 `executeDisasterRecoveryArbitration` 抽取为 `DisasterRecoveryArbitrator`，`Orchestrator` 仅作为组装与调度中枢，可直接将代码行数压至 600 行以内。

---

### 针对初审第 4 项：幽灵抽象与死代码残留：`compaction.ts` 冗余并造成概念混淆
- **初审判定与代码柔道提案**:
  - 初审指出：系统中同时存在 `CompactionService` (140行) 和 `BlackboxCompactor` (467行)。在 `orchestrator.ts` 中 `enableInSessionCompaction` 默认且硬编码为 `false`，CLI 与运行时无任何开启路径，属于死代码。
  - 提案建议：直接删除 `compaction.ts`，迁移通用 `TurnRecord` 接口至统一类型文件，全局仅保留 `BlackboxCompactor`。
- **原作者辩护推演 (Steelmanning)**:
  - 为什么原作者会保留两套实现？
  - 查阅设计规范 `2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md` 第 1 节：“在经受多轮现网实测（包含 35 轮超大上下文 13.8 万字符实测通过、以及遭遇 429 频控断连实测）后，本规范确立了 CPH-PI 核心架构定位：……正常会话免裁剪原则……本地滑动剪枝定位：事故容灾黑匣子 (Disaster Recovery Blackbox)。”
  - 原作者最初在设计时预留了会话内两轮滑动微压实（`CompactionService`），并在现网验证中确认 Copilot 原生具备容纳 14 万+ 字符的超大上下文窗口，会话内裁剪历史工具输出反而破坏了模型的长上下文事实记忆。因此作者将压实能力的战略重心全面切换为事故容灾专属的 `BlackboxCompactor`，将 `enableInSessionCompaction` 关停置为 false，但保留了该开关以备将来 Copilot 策略收紧时快速恢复。
- **项目宪章与设计文档对账**:
  - 虽然保留该机制有历史决策背景，但现状是：
    1. CLI 和环境配置根本没有任何参数可以开启 `enableInSessionCompaction`；
    2. `compaction.ts` 内部 re-export 了 `BlackboxCompactor`，而 `blackbox-compactor.ts` 又 import 了 `compaction.ts` 中的 `TurnRecord`，形成了不规范的循环模块依赖；
    3. `tests/agent/compaction.test.ts` 完整测试着一个在生产中永远不执行的类。
- **复核裁决**: `[DRIFT-DESYNC]` (设计演进与代码实现脱节)
  - 属于早期特性在架构原则迭代（确立“免裁剪原则”）后未彻底完成废弃清退的代码漂移脱节。初审识别准确。
- **源码与上下文核验**:
  - 经查 `src/agent/compaction.ts` (140行)、`src/agent/orchestrator.ts` L158 (`enableInSessionCompaction = false`)、L763-L774。全代码库无任何生产调用方将该字段置为 true。
- **设计文档与 Git 证据链**:
  - `2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md` 明确将压实器规范定位于“事故容灾黑匣子”，印证了 `CompactionService` 的历史遗留性质。
- **最终保留建议**:
  - 将 `TurnRecord` 抽取至公共类型模块（如 `src/types.ts`），解开循环依赖；移除 `orchestrator.ts` 中的 dead if 分支；安全归档或移除 `CompactionService`，统合压实语义至 `BlackboxCompactor`。

---

### 针对初审第 5 项：`PromptBuilder` 中的动态类型反推与字符串猜谜代码
- **初审判定与代码柔道提案**:
  - 初审指出：`PromptBuilder.buildTurn2TaskPrompt` 内部使用 `arg2.includes("Skill") || arg2.includes("技能")` 来反推参数顺序，如果工具结果中偶然包含 "Skill"（例如分支名或代码内容），会导致参数解析完全颠倒。
  - 提案建议：消除多态猜谜，形参改为显式强类型对象契约 `Turn2TaskPromptOptions`。
- **原作者辩护推演 (Steelmanning)**:
  - 源码注释写道：`Supports both (task, skillsSection, toolResult) and (task, toolResult, skillsSection).`
  - 原作者在早期实现中，不同调用点（测试用例与 Orchestrator）传入形参顺序不一致。原作者为了避免破坏已有的单元测试调用方，采用了运行时字符串探测的“智能胶水”实现双向兼容。
- **项目宪章 (AGENTS.md) 校验**:
  - AGENTS.md 准则 1 要求“按统一既定协议进行客观处理”，准则 6 强调“严格黑盒契约”。
  - 这种依赖子字符串推断类型签名的写法严重违反了 TypeScript 静态类型安全保障。只要工具返回的真实 stdout 中包含 "Skill" 或 "技能"，并且同时传递了两个非空字符串参数，`arg2` 与 `arg3` 的角色就会发生意外翻转，产生不可预测的提示词拼接灾难。
- **复核裁决**: `[CONFIRMED]`
  - 确凿的脆弱类型契约与潜在逻辑 Bug。
- **源码与上下文核验**:
  - 经查 `src/protocol/prompt-builder.ts` L140-L164，代码逻辑与初审报告完全吻合：
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
  - `tests/protocol/prompt-builder.test.ts` L76 与 L93 分别以不同的传参形式调用了该方法，证实了该胶水补丁确实是为了迎合异构测试用例而产生。
- **最终保留建议**:
  - **采纳 A4 重构方案**：将形参标准化为显式参数结构体或强类型重载函数，修改测试用例使之统一遵循规范签名，根除基于字符串内容的歧义反推。

---

### 针对初审第 6 项：`SubagentRunner` 单次执行高频触发全盘技能扫描与重复构造
- **初审判定与代码柔道提案**:
  - 初审指出：在 `SubagentRunner.runSingleSubagent` 中，每个子代理启动时都新建一个 `SkillLoader` 并执行 `discoverSkills()` 全盘扫描 6 个目录，绕过了系统已有的技能缓存。
  - 提案建议：在构造器或选项中直接传入 `handoffSkill?: Skill` 或复用父级已有的 `SkillRegistry`。
- **原作者辩护推演 (Steelmanning)**:
  - 注释明确指明：“子代理仅挂载 handoff 技能，不挂载 subagent 技能”。
  - 原作者可能希望保证子代理技能挂载的绝对隔离性，防止子代理受到主会话已激活的其他工作流技能（如 `tdd`、`brainstorming` 等）的干扰；同时可能希望每次子代理执行时能够动态读取工作区中可能被修改过的 `skills/handoff/SKILL.md`，因此就地构造了独立的加载器。
- **项目宪章与性能事实核验**:
  - 检查 `SkillLoader.discoverSkills()` 实现可知，它包含 6 个全局及本地目录的 `fs.readdirSync` 与多层文件 `statSync`，是一个全盘同步 I/O 操作。
  - 当通过单账号队列或多账号并发执行批量子任务时，每个任务启动都执行一次全盘同步扫描，尤其在多代接力（`hopCount < maxAutonomousHops`）场景下会高频重复触发，带来毫无必要的同步 I/O 延迟。
  - 子代理需要的仅仅是 `handoff` 这一固定技能，完全可以在 `SubagentRunner` 实例化时单次加载或缓存。
- **复核裁决**: `[CONFIRMED]`
  - 确凿的性能损耗与冗余 I/O。
- **源码与上下文核验**:
  - 经查 `src/agent/subagent-runner.ts` L233-L243：
    ```typescript
    let handoffSkills: Skill[] = [];
    try {
      const loader = new SkillLoader(this.workspaceRoot);
      const discovered = loader.discoverSkills();
      const handoff = discovered.find((s) => s.name.toLowerCase() === "handoff");
      if (handoff) handoffSkills = [handoff];
    } catch {}
    ```
    确实在每次 `runSingleSubagent` 执行前重复执行全量发现。
- **设计文档与 Git 证据链**:
  - 该实现源于 `2026-10-12-cph-pi-subagent-execution-architecture.md` 快速落地子代理隔离机制时的初版代码。
- **最终保留建议**:
  - **采纳 A4 建议**：将 `handoffSkills` 的解析提升至 `SubagentRunner` 构造期执行一次并缓存为实例字段，供所有子代理执行复用，消灭单次派发的同步磁盘遍历开销。

---

### 针对初审第 7 项：`invoke_subagent` 破坏统一工具调度通道，强行与 Orchestrator 核心循环混杂
- **初审判定与代码柔道提案**:
  - 初审指出：`ToolBridge` 负责封装并规范所有本地 Pi 工具，但遇到 `invoke_subagent` 时却由 `orchestrator.ts` 内部近 100 行特殊分支接管，破坏了统一工具调度通道。
  - 提案建议：将代际跃迁与子代理执行抽象为独立的 `GenerationalTransitionCoordinator`。
- **原作者辩护推演 (Steelmanning)**:
  - 查阅 `2026-10-12-main-session-virtualization-and-account-concurrency-design.md`：
    `invoke_subagent` 根本**不是**一个普通的物理操作系统工具（如 read/write/bash），而是调度层的**元控制指令（Meta-Control Directive）**！
    当触发 `invoke_subagent` 时，系统必须执行以下一系列高阶状态机跃迁：
    1. 会话虚拟化：原子化持久化主规划快照；
    2. 主连接释放：主动关闭主会话的云端 WebSocket 连接，避免被后续子代理挤出微软保留窗口；
    3. 运行批处理：等待子代理执行并生成结构化总结；
    4. 代际跃迁：`this.generation++`，更新血缘追踪器（`LineageTracker`）；
    5. 重连新会话：向账号池申请可用账号并建立全新 `ChatHubClient`；
    6. 重置预算：提示词注入接棒 prompt，并重置 `turn = 0`，赋予新主控全新的 30 轮推理预算。
  - 这些跃迁强依赖 `Orchestrator` 的内部核心状态（`client`、`sessionId`、`turn`、`generation`、`isHandshakePending`）。`ToolBridge` 仅作为操作系统命令执行通道，绝不应承担会话生命周期与连接重连职责。原作者将其留在 `Orchestrator` 内部而非塞给 `ToolBridge` 是经过深思熟虑的正确架构边界决策。
- **项目宪章与架构核验**:
  - 原作者不在 `ToolBridge` 中处理 `invoke_subagent` 是完全正确的（符合职责边界划分）；
  - 但原作者将这近 100 行复杂的代际跃迁与快照管理逻辑直接内联在 558 行的 `run()` 主循环中，使得 `run()` 的控制流分支格外庞杂。
  - 抽离 `GenerationalTransitionCoordinator` 属于一种合理的内部方法提取，但初审指责“破坏统一工具调度通道”存在一定程度的概念泛化——元控制指令本就不属于 ToolBridge 的物理工具通道。
- **复核裁决**: `[INTENDED-DESIGN]` (既定设计与合理取舍)
  - 控制流由 Orchestrator 调度层主管而非下沉至 ToolBridge 属于**合理的既定设计**。内联实现虽然造成了函数过长（已包含在 Issue 3 的上帝类裁决中），但其架构层级划分本身并未背离系统定位。
- **源码与上下文核验**:
  - 查看 `src/agent/orchestrator.ts` L624-L712，确实处理了快照持久化、连接释放、代际递增、Token 重新申请与 turn 归零。
- **设计文档与 Git 证据链**:
  - `2026-10-12-main-session-virtualization-and-account-concurrency-design.md` 明确定义了该虚拟化与代际接棒协议。
- **最终保留建议**:
  - **维持 Orchestrator 对元控制流的主管定位**。在后续大文件结构重构时，可将内部内联代码抽取为 `Orchestrator.handleGenerationalTransition()` 私有方法，保持主循环结构平整，但无需引入过度抽象的独立协同器类。

---

### 针对初审第 8 项：`src/cli.ts` 参数手写解析器与大量重复静态/实例透传代码
- **初审判定与代码柔道提案**:
  - 初审指出：`cli.ts` 手写 240 行繁琐的 `while` 循环参数解析，且类内声明了 `parseArgs`, `printHelp`, `renderHelpBanner` 的静态和实例版本，并在类外重复导出，大量幽灵透传层。
  - 提案建议：提取独立参数解析器至 `src/cli/args.ts`，消除冗余的静态/实例包装。
- **原作者辩护推演 (Steelmanning)**:
  - 原作者选择手写参数解析是为了坚持“零多余第三方运行时依赖”，避免为了简单的 CLI 引入庞大的 CLI 框架包；
  - 至于静态和实例双重转发包装，检查 `tests/cli/timeout-arg-and-continuation.test.ts` 可以发现，不同的测试用例既有通过 `(app as any).parseArgs(...)` 调用的，也有通过 `(CliApp as any).parseArgs(...)` 静态调用的。原作者为了保证多种调用形式的测试兼容性，提供了双向包装。
- **项目宪章与代码事实核验**:
  - 尽管有测试兼容的历史动机，但在一个超过 2000 行的大文件中保留这种纯透传代理（每对方法占 6-8 行），并与底部的函数导出形成三重声明，平白增加了样板代码和心智干扰。
- **复核裁决**: `[CONFIRMED]`
  - 确凿的样板代码堆砌与文件膨胀。
- **源码与上下文核验**:
  - 经查 `src/cli.ts` L300-L322（类内静态/实例双重包装）、L1683-L1926（手写循环解析器 244 行）、L1980-L1991（类外函数导出与别名）。
- **设计文档与 Git 证据链**:
  - 对应测试 `tests/cli/timeout-arg-and-continuation.test.ts` 证实了静态/实例包装确实用于适配测试断言。
- **最终保留建议**:
  - 将参数解析逻辑剥离至独立的 `src/cli/args.ts`；在 `CphPiCli` 类中仅保留兼容旧测试的必要静态代理，消除无意义的重复包装层。

---

## 综合裁决与重构行动建议路线图

结合 8 项逐项复核结果，梳理最终综合执行路线图如下：

| 优先级 | 编号 | 目标模块 | 复核裁决 | 最终行动建议 |
|---|---|---|---|---|
| **P0 (宪章修正)** | 1 | `src/agent/orchestrator.ts` | `[VIOLATES-GOVERNANCE-RULE]` | 彻底切除 `.NET/winget` ad-hoc 正则与负面禁止词，恢复通用 Harness 的协议中立性 |
| **P0 (契约修复)** | 5 | `src/protocol/prompt-builder.ts` | `[CONFIRMED]` | 消除 `buildTurn2TaskPrompt` 的 `includes("Skill")` 运行时猜谜分支，改为强类型契约 |
| **P1 (大文件拆解)** | 2 | `src/cli.ts` (2082行) | `[CONFIRMED]` | 提取 `args.ts`、抽离命令调度器、下沉报表生成，将 CLI 瘦身至 400 行以内 |
| **P1 (上帝类拆解)** | 3 | `src/agent/orchestrator.ts` (1646行) | `[CONFIRMED]` | 抽取 `DisasterRecoveryArbitrator` 与 `HandoffDocumentGenerator`，剥离 600+ 行非核心编排代码 |
| **P2 (死代码清退)** | 4 | `src/agent/compaction.ts` | `[DRIFT-DESYNC]` | 抽取 `TurnRecord` 公共接口解开循环依赖，清退未生效的 `CompactionService`，统合至 `BlackboxCompactor` |
| **P2 (I/O 性能优化)** | 6 | `src/agent/subagent-runner.ts` | `[CONFIRMED]` | 将 `handoffSkill` 加载提升至构造期单次完成，消除单次执行重复扫描 6 个目录的磁盘开销 |
| **P3 (样板代码清理)** | 8 | `src/cli.ts` 透传层 | `[CONFIRMED]` | 清理静态/实例三重包装，保留必要兼容导出 |
| **保持现状 (架构中立)** | 7 | `orchestrator.ts` (`invoke_subagent`) | `[INTENDED-DESIGN]` | 确认元控制流跃迁属于 Orchestrator 核心调度职责，不移入 ToolBridge；未来仅做私有方法抽取 |
