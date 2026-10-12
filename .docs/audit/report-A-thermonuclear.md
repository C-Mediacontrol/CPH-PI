# 初审报告：热核级架构与分支异味 (Dim-4: thermo-nuclear-code-quality-review)

- **审查对象**: E:\copilot-web proxy\CPH-PI
- **审查模式**: Full Mode
- **扫描文件数**: 24 个 TypeScript 核心源码文件 (`src/**/*.ts`)

---

## 热核级诊断核心概览与“代码柔道”精简契机

依据 **thermo-nuclear-code-quality-review**（热核级极严苛代码质量与结构精简）核心哲学，本审查不仅做局部代码异味扫描，更深入审视整个 CPH-PI 的结构健康度、大文件死刑线、Spaghetti 条件分支，以及 **AGENTS.md** 规定的 **Harness 纯粹与中立原则**。

### 核心诊断概览
1. **千行大文件死刑线失守**：
   - [`src/cli.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts) 膨胀至 **2082 行**（突破 2000 行大关），把 CLI 参数解析、Readline 多行输入与快捷键控制、15 个 Slash Commands 交互路由、诊断卡与状态报表生成、多代自主接力编排（Auto-Handoff Relay Loop）全部揉在一个巨石文件中。
   - [`src/agent/orchestrator.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts) 膨胀至 **1646 行**，拥有 558 行的 `run()`、362 行的 `generateHandoffSnapshot()` 以及 285 行的 `executeDisasterRecoveryArbitration()` 三巨头超长方法，集握手探测、网络收发、Refusal 拦截、账号轮换、工具执行、子代理协调、文档生成、三阶段容灾仲裁于一身。
2. **业务特化规则严重污染通用 Harness（明确违背 AGENTS.md 准则 1 & 3）**：
   - 在通用的 [`orchestrator.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1050-L1071) 交接文档生成器中，居然硬编码了针对 `.NET SDK`、`dotnet`、`winget`、`[System.IO.Path]` 的专用正则匹配与故障提示，甚至直接出现“切勿盲目重复调用 winget”等负面禁止词。公共通道被历史任务的业务特化补丁严重污染。
3. **幽灵抽象与死代码残留增加心智负担**：
   - [`src/agent/compaction.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/compaction.ts) (140行) 实现的“两轮滑动微压实”在生产环境被硬编码关闭（`enableInSessionCompaction = false` 且 CLI 无任何开关开启），与 [`src/agent/blackbox-compactor.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/blackbox-compactor.ts) (467行) 形成概念重叠与双重维护负担。
4. **散落的条件分支与脆弱的多态猜测**：
   - [`PromptBuilder.buildTurn2TaskPrompt`](file:///E:/copilot-web%20proxy/CPH-PI/src/protocol/prompt-builder.ts#L140-L164) 竟然使用 `arg2.includes("Skill") || arg2.includes("技能")` 来反推参数顺序；
   - [`cli.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts#L767-L1126) 包含一个 360 行的巨型 `if-else` 命令分发链；
   - [`SubagentRunner`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/subagent-runner.ts#L233-L243) 每次启动子代理都全盘重新扫描 6 个目录发现技能，绕过了已有的技能缓存。

### “代码柔道 (Code Judo)” 最大重构契机
- **柔道契机 1 (CLI 模块解构)**：通过声明式 `CommandRegistry` 与 `TaskRelayLoop` 抽离，消灭 `cli.ts` 内部 360 行命令 if 链与 290 行接力循环，将 `cli.ts` 整体削减 **75%**（从 2082 行瘦身至 400 行以内）。
- **柔道契机 2 (Harness 中立性复归)**：彻底切除 `orchestrator.ts` 中针对 `.NET/winget` 的 40+ 行特化正则补丁与负面禁止词，让通用调度器恢复 100% 协议中立，将领域知识归还给对应 Skill。
- **柔道契机 3 (消灭死层)**：成片删除未启用的 `compaction.ts`，统合到 `BlackboxCompactor`，减少 1 个模块概念与死逻辑分支。
- **柔道契机 4 (契约规范化)**：消灭 `PromptBuilder` 的字符串反推猜测，建立强类型接口。

---

## 发现的问题清单

### 1. 业务特化规则硬编码污染公共 Handoff 生成通道（违背 Harness 中立与禁止词铁律）
- **文件路径**: [`src/agent/orchestrator.ts#L1050-L1071`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1050-L1071), [`src/agent/orchestrator.ts#L1132-L1136`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1132-L1136)
- **置信度等级**: `Level 1` (确定性违规)
- **异味/缺陷类别**: 业务特化污染 / Spaghetti 条件分支 / 负面禁止词渗透
- **代码现状剖析**:
  在通用的 `Orchestrator.generateHandoffSnapshot` 中，存在硬编码针对特定工具链的 ad-hoc 正则提取分支：
  ```typescript
  // src/agent/orchestrator.ts L1050-L1065
  if (
    /\.net\s+sdk|dotnet/i.test(allFailedText) &&
    /not\s+found|missing|no \.net|0x80070005|failed/i.test(allFailedText)
  ) {
    envIssues.push("环境卡点: 缺少 .NET SDK 8 环境或安装中断，导致相关组件构建受阻");
  }
  if (/winget/i.test(allFailedText) && /failed|error|denied|提权|0x80070005/i.test(allFailedText)) {
    envIssues.push("包管理卡点: winget 自动化安装受提权或系统策略限制中断");
  }
  if (/access is denied|0x80070005/i.test(allFailedText)) {
    envIssues.push("权限卡点: 操作系统权限拒绝 (Access is denied)");
  }
  if (/\[System\.IO\.Path\\\]|TypeName|TypeNotFound/i.test(allFailedText)) {
    envIssues.push("脚本语法卡点: PowerShell 转义或类型名称格式错误");
  }

  // src/agent/orchestrator.ts L1132-L1136
  if (/\.net|dotnet|winget/i.test(allFailedText)) {
    nextSteps.push(
      `   - **环境修复指引**: 检测到 .NET SDK / winget 安装或提权受阻，建议优先采用免安装 zip 包、已有运行时路径或由外部环境提供支持，切勿盲目重复调用 winget。`
    );
  }
  ```
  **违背的治理原则**:
  1. **AGENTS.md 准则 1 (Harness Neutrality)**：“Harness 本身必须保持绝对中立与纯粹：无论 Copilot 模型返回什么内容、内容是对是错，Harness 只管按统一既定协议进行客观处理与调度，严禁在 Harness 代码中给模型打特化补丁或‘替模型擦屁股’”。
  2. **AGENTS.md 准则 3 (摒弃负面禁止词)**：“切勿盲目重复调用 winget”使用了强负面禁止词，违反建设性正向引导铁律。
  3. **架构中立性破坏**：如果后续 Agent 执行 Python、Go 或 Rust 项目，该通用 Handoff 中仍会带着 winget / .NET 专项推断逻辑，产生幻觉与认知污染。
- **“代码柔道”重构方案**:
  - 彻底删除这 40+ 行针对特定命令与环境的 ad-hoc if 匹配与 hardcoded 提示文本；
  - 采用通用、纯粹的事实聚合逻辑：客观提取最近失败的 `toolName`、命令预览与 `extractKeyError` 的前序输出；
  - 如果需要环境诊断引导，应由对应的排错专属 Skill（如 `systematic-debugging` 或环境排错提示词）来正向提示，绝不污染通用调度器。
- **消除的复杂度与收益**:
  - 消除 40+ 行业务特化分支；
  - 彻底根除负面禁止词在 Harness 层的残留；
  - 恢复通用调度器的协议纯粹性与中立性。

---

### 2. `cli.ts` 膨胀至 2082 行，突破千行死刑线，六大职责高度缠绕
- **文件路径**: [`src/cli.ts#L1-L2082`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts)
- **置信度等级**: `Level 1` (确定性结构质量退化)
- **异味/缺陷类别**: 千行膨胀 / 职责混淆 / Spaghetti 命令网络 / 巨石单文件
- **代码现状剖析**:
  `src/cli.ts` 超过 2000 行，将整套系统的交互、配置、调度与渲染全塞在一个文件里：
  1. **手写参数解析** (L1683-L1926，约 250 行)：充斥 40+ 个连续 `if (arg === ... || arg.startsWith(...))`；
  2. **巨型交互命令路由** (L767-L1126，约 360 行)：`handleCommand` 内部用单体庞大 if 链集中处理 15 个命令（`/help`, `/status`, `/accounts`, `/agent`, `/model`, `/skills`, `/skill`, `/new`, `/sessions`, `/resume`, `/continue`, `/relay`, `/debug`, `/reset`, `/exit`）；
  3. **UI 文本与报表拼装** (L469-L590, L1127-L1359，约 350 行)：`formatSessionsList`, `getDiagnosticCard`, `formatAccountsList`, `handleAccountsCommand` 等在 CLI 文件中直接拼接复杂 Chalk ANSI 格式；
  4. **多代自主接力调度循环 (Auto-Handoff Relay Loop)** (L1360-L1648，约 290 行)：`executeTask` 中混杂了 AbortController 拦截、20 个渲染事件适配、`SessionTurnRecord` 转录保存、hopCount 代际递增、提示词模板拼接；
  5. **终端 Readline 与多行缓冲处理** (L640-L766，约 130 行)：处理 `"""` 多行模式、`\` 续行符与输入缓冲。
- **“代码柔道”重构方案**:
  1. **声明式 Command 路由拆分**：将交互命令提取为 `CommandDispatcher` 或按领域划分的独立 Handler 映射表（`Map<string, CommandHandler>`），`cli.ts` 仅需 1 行 `await this.commandDispatcher.dispatch(cmd)`；
  2. **报表下沉领域模块**：`formatSessionsList` 下沉至 `SessionManager`，`formatAccountsList` 下沉至 `AccountPool`，`getDiagnosticCard` 下沉至专属 `DiagnosticPresenter`；
  3. **接力编排抽取**：将 `executeTask` 中的多代自主接力循环下沉为独立的 `TaskRelayRunner` 或由 Orchestrator 本身进行多代管理；
  4. **参数解析抽取**：将 250 行手写解析器拆分至独立的 `src/cli/args.ts`。
- **消除的复杂度与收益**:
  - `src/cli.ts` 代码行数可从 **2082 行削减至 400 行以内**（缩减逾 75%）；
  - 消灭 360 行的命令 if-else 巨石链；
  - 核心入口逻辑清晰易扫，每个命令与报表具备独立单元测试能力。

---

### 3. `orchestrator.ts` 膨胀至 1646 行，三巨头超长方法缺乏结构分解
- **文件路径**: [`src/agent/orchestrator.ts#L304-L862`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L304-L862), [`src/agent/orchestrator.ts#L895-L1257`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L895-L1257), [`src/agent/orchestrator.ts#L1361-L1646`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1361-L1646)
- **置信度等级**: `Level 1` (确定性结构膨胀)
- **异味/缺陷类别**: 千行膨胀 / 过度顺序编排 / 聚合上帝类 (God Class)
- **代码现状剖析**:
  `orchestrator.ts` 达 1646 行，主要被 3 个极长的方法垄断：
  - **`run()` (558 行, L304-L862)**：单一函数处理包括：会话注册、Token 与 Client 获取、Git 与目录树事实抓取、技能注入、Turn 1 握手状态机、SendMessage 与流式收集、传输异常捕获、Refusal 拦截与惩罚轮换、ResilientParser 分支判断（final_answer / handoff / action / invalid_chatter）、`invoke_subagent` 专属拦截与代际跃迁（约 100 行）、Cloud Document 附件上传、历史记录存盘、下一轮提示词组装。
  - **`generateHandoffSnapshot()` (362 行, L895-L1257)**：单一函数手写组装 6 维交接文档，包含大量工具历史遍历统计与正则挖掘。
  - **`executeDisasterRecoveryArbitration()` (285 行, L1361-L1646)**：单一函数处理 3 阶段容灾仲裁全流程（事故黑匣子提炼、受害账号惩罚、备用账号获取、仲裁 Client 生成、单轮 Prompt 发送、仲裁结果解析、本地兜底持久化）。
- **“代码柔道”重构方案**:
  1. **拆解独立容灾仲裁器**：将 `executeDisasterRecoveryArbitration` 抽离为 `DisasterRecoveryArbitrator`（减少 285 行）；
  2. **拆解交接文档生成器**：将 `generateHandoffSnapshot` 抽离为 `HandoffDocumentGenerator`（减少 360 行）；
  3. **Turn 循环内聚**：将 `run()` 中单轮的处理逻辑（Prompt 组装、网络收发、工具执行、结果回填）抽象为 `TurnExecutionPipeline`，`run()` 仅作为清晰的高层循环驱动。
- **消除的复杂度与收益**:
  - `orchestrator.ts` 从 1646 行压缩至 500~600 行以内；
  - 核心驱动层与灾备仲裁层、文档生成层彻底解耦，单测覆盖率可大幅提升。

---

### 4. 幽灵抽象与死代码残留：`compaction.ts` 冗余并造成概念混淆
- **文件路径**: [`src/agent/compaction.ts#L1-L140`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/compaction.ts), [`src/agent/orchestrator.ts#L158`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L158), [`src/agent/orchestrator.ts#L763-L774`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L763-L774)
- **置信度等级**: `Level 2` (设计异味 / 幽灵代码)
- **异味/缺陷类别**: 虚假抽象 / 幽灵层 / 冗余概念
- **代码现状剖析**:
  - 系统中同时存在两个以“压实”命名的模块：`src/agent/compaction.ts` (140行, `CompactionService`) 和 `src/agent/blackbox-compactor.ts` (467行, `BlackboxCompactor`)。
  - 在 `orchestrator.ts` 中：
    ```typescript
    private enableInSessionCompaction: boolean = false;
    // ...
    // 4. Two-turn sliding compaction (Disabled by default to preserve 100% full execution truth within active session)
    if (this.enableInSessionCompaction && history.length > 2) {
      const compaction = CompactionService.compactTurns(history, {
        preserveRecentTurns: 2,
      });
      // ...
    }
    ```
  - `enableInSessionCompaction` 在整个 `CPH-PI` 代码库中除声明外，从未在任何地方被置为 `true`。CLI、测试、配置均未暴露该开关。代码注释也明确写道：“Disabled by default to preserve 100% full execution truth within active session”。
  - 该模块属于典型的“遗留幽灵层（Phantom Layer）”，保留了死代码，且与实际生效的 `BlackboxCompactor` 造成了明显的概念混淆。
- **“代码柔道”重构方案**:
  - 直接删除 `src/agent/compaction.ts`；
  - 将通用的 `TurnRecord` 接口迁移至统一类型定义文件（如 `types.ts`）；
  - 移除 `orchestrator.ts` 中的 `enableInSessionCompaction` 字段与死 `if` 分支；
  - 全局只保留一个明确的压实概念：`BlackboxCompactor`（面向跨会话容灾的事故黑匣子压实）。
- **消除的复杂度与收益**:
  - 成片删除 1 个文件（140 行）；
  - 消除 1 个多余的心智概念（消灭双重压实混淆）；
  - 净化 Orchestrator 核心循环。

---

### 5. `PromptBuilder` 中的动态类型反推与字符串猜谜代码
- **文件路径**: [`src/protocol/prompt-builder.ts#L140-L164`](file:///E:/copilot-web%20proxy/CPH-PI/src/protocol/prompt-builder.ts#L140-L164)
- **置信度等级**: `Level 2` (结构不变量破坏 / 坏味道)
- **异味/缺陷类别**: 虚假多态 / Spaghetti 条件分支 / 脆弱类型契约
- **代码现状剖析**:
  在 `PromptBuilder.buildTurn2TaskPrompt` 中存在以下代码：
  ```typescript
  public static buildTurn2TaskPrompt(
    task: string,
    arg2: string,
    arg3 = "",
    toolName?: string
  ): string {
    let skillsSection = "";
    let toolResult = "";

    if (arg3 !== undefined && arg3 !== "") {
      if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
        skillsSection = arg2;
        toolResult = arg3;
      } else if (arg3.includes("Skill") || arg3.includes("技能")) {
        toolResult = arg2;
        skillsSection = arg3;
      } else {
        skillsSection = arg2;
        toolResult = arg3;
      }
    } else {
      toolResult = arg2;
      skillsSection = "";
    }
    // ...
  ```
  - 通过 `arg2.includes("Skill") || arg2.includes("技能")` 在运行时反推形参到底是 `skillsSection` 还是 `toolResult`！
  - 这种反模式通常是因为早期测试或不同调用点传参顺序不一致，开发者为了不修改调用点而打的“特化胶水补丁”，严重破坏了静态类型系统的保障。如果 `toolResult` 输出刚好包含字符串 "Skill"，参数解析就会完全颠倒！
- **“代码柔道”重构方案**:
  - 消除多态参数猜谜，将形参统一改为显式对象契约：
    ```typescript
    export interface Turn2TaskPromptOptions {
      task: string;
      toolResult: string;
      skillsSection?: string;
      toolName?: string;
    }
    public static buildTurn2TaskPrompt(options: Turn2TaskPromptOptions): string
    ```
  - 一举删除所有运行时 `includes("Skill")` 的反推分支。
- **消除的复杂度与收益**:
  - 删除 25 行脆弱的字符串猜测分支；
  - 杜绝因工具输出偶然包含 "Skill" 导致的致命提示词颠倒 Bug；
  - 建立确定性的强类型边界。

---

### 6. `SubagentRunner` 单次执行高频触发全盘技能扫描与重复构造
- **文件路径**: [`src/agent/subagent-runner.ts#L233-L243`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/subagent-runner.ts#L233-L243)
- **置信度等级**: `Level 2` (性能损耗与抽象破坏)
- **异味/缺陷类别**: 重复对象构建 / 绕过已有缓存 / 低效磁盘 I/O
- **代码现状剖析**:
  在 `SubagentRunner.runSingleSubagent` 中：
  ```typescript
  // 子代理仅挂载 handoff 技能，不挂载 subagent 技能
  let handoffSkills: Skill[] = [];
  try {
    const loader = new SkillLoader(this.workspaceRoot);
    const discovered = loader.discoverSkills();
    const handoff = discovered.find((s) => s.name.toLowerCase() === "handoff");
    if (handoff) {
      handoffSkills = [handoff];
    }
  } catch {
    // 忽略技能扫描异常
  }
  ```
  - 每一个子代理在启动时，都会完整实例化一次 `new SkillLoader(this.workspaceRoot)`，并遍历 6 个搜索路径全量读取磁盘上的所有 `SKILL.md` 文件！
  - 当主代理并发或顺序分派多个子代理（或子代理发生多次 hop 接力）时，会频繁产生不必要的同步文件读取，完全无视了系统本身已经存在且初始化好的 `SkillRegistry` 缓存。
- **“代码柔道”重构方案**:
  - 在 `SubagentRunnerOptions` 中直接接收 `handoffSkill?: Skill` 或复用父级已有的 `SkillRegistry`；
  - 在初始化时单次解析完成，彻底删除 `runSingleSubagent` 内的 `new SkillLoader` 与 `discoverSkills()`。
- **消除的复杂度与收益**:
  - 消除每次子代理执行时的 10~50ms 同步磁盘扫描开销；
  - 删除 15 行重复的异常兜底与扫描代码；
  - 统一技能引用的唯一数据源。

---

### 7. `invoke_subagent` 破坏统一工具调度通道，强行与 Orchestrator 核心循环混杂
- **文件路径**: [`src/agent/orchestrator.ts#L624-L712`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L624-L712)
- **置信度等级**: `Level 2` (架构边界侵入 / 关注点分离失效)
- **异味/缺陷类别**: 架构边界泄漏 / 控制流混淆 / 胶水侵入
- **代码现状剖析**:
  - `ToolBridge` 负责封装并规范所有本地 Pi 工具（read, edit, write, bash, question），按标准接口执行并输出 `ToolBridgeResult`。
  - 然而当遇到 `invoke_subagent` 时，`ToolBridge` 无法统一处理，而是交由 `orchestrator.ts` 内部一段近 100 行的特殊分支强行接管：
    - 手动调用 `createMainPlanSnapshot` 并写盘；
    - 触发 `onMainSessionVirtualized` 事件；
    - 手动强制调用 `(client as any)?.close?.()` 断开主 WebSocket 连接；
    - 手动实例化 `SubagentRunner` 并执行批处理；
    - 组装 `summaryOutput` 伪装成 `ToolBridgeResult`；
    - 手动递增代际 `this.generation++`，生成新的 `sessionId` 并更新血缘追踪器；
    - 重新向 `pool` 申请 token 并重建 `client`；
    - 重置 `turn = 0`。
  - 这导致通用工具执行与元控制流（Meta-Orchestration / Generational Transition）高度耦合在主循环内。
- **“代码柔道”重构方案**:
  - 将代际跃迁与子代理执行显式抽象为独立的 `GenerationalTransitionCoordinator`；
  - 主循环只需调用 `await this.generationalCoordinator.transition(parsed.action)`，并由其返回状态转换结果（包括重置后的 turn 预算、新会话标识与新客户端）；
  - 剥离主循环中近 100 行底层连接重置与快照序列化代码。
- **消除的复杂度与收益**:
  - `orchestrator.ts` 主循环削减近 90 行复杂的嵌套逻辑；
  - 明确“普通物理工具执行”与“架构代际演化”的清晰边界。

---

### 8. `src/cli.ts` 参数手写解析器与大量重复静态/实例透传代码
- **文件路径**: [`src/cli.ts#L300-L325`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts#L300-L325), [`src/cli.ts#L1683-L1926`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts#L1683-L1926), [`src/cli.ts#L1980-L1991`](file:///E:/copilot-web%20proxy/CPH-PI/src/cli.ts#L1980-L1991)
- **置信度等级**: `Level 3` (代码样板气味 / 冗余透传包装)
- **异味/缺陷类别**: 样板代码膨胀 / 冗余包装 / 重复声明
- **代码现状剖析**:
  - `src/cli.ts` 中手写了 240 行极其繁琐的 `while` 循环参数解析，充斥着大量的 `arg === "-h" || arg === "--help"`、`arg.startsWith("--agent=")`、`arg.startsWith("-a=")` 等重复分支。
  - 此外，类内部声明了 `parseArgs`, `printHelp`, `renderHelpBanner` 的静态版本和实例版本，在类外又定义了同名的独立函数，并在文件尾部重复导出（如 `export const parseArgs = parseCliArgs`）：
    ```typescript
    public static parseArgs(args: string[]): ParsedCliArgs { return parseCliArgs(args); }
    public parseArgs(args: string[]): ParsedCliArgs { return parseCliArgs(args); }
    public static printHelp(): string { return printHelp(); }
    public printHelp(): string { return printHelp(); }
    public static renderHelpBanner(): string { return renderHelpBanner(); }
    public renderHelpBanner(): string { return renderHelpBanner(); }
    ```
  - 大量冗余的“幽灵透传层”仅为凑数，无任何实际设计价值，平白增加代码行数。
- **“代码柔道”重构方案**:
  - 提取轻量声明式参数解析器或抽离至 `src/cli/args.ts`；
  - 消除冗余的静态/实例双重转发包装，仅保留规范的单点导出。
- **消除的复杂度与收益**:
  - 减少 200+ 行机械解析与包装胶水代码；
  - 消除认知混淆，导出契约统一规范。

---

## 综合裁决与重构行动建议路线图

| 优先级 | 目标模块 | 建议改动 | 预期代码删减 / 精简收益 |
|---|---|---|---|
| **P0 (铁律违规)** | `src/agent/orchestrator.ts` | 彻底切除 `.NET/winget` 特化正则补丁与负面禁止词，恢复 Harness 中立 | 减少 40+ 行特化代码，根除违背 AGENTS.md 的偏见与负面词 |
| **P0 (契约漏洞)** | `src/protocol/prompt-builder.ts` | 消除 `buildTurn2TaskPrompt` 的 `includes("Skill")` 猜谜代码，改为强类型对象 | 减少 25 行脆弱分支，根绝潜在提示词颠倒 Bug |
| **P1 (大文件死刑)** | `src/cli.ts` (2082行) | 拆分命令路由 (`CommandRegistry`)、报表下沉领域、接力循环抽离 | 文件行数减少 ~1600 行（从 2082 行瘦身至 400 行以内） |
| **P1 (大文件死刑)** | `src/agent/orchestrator.ts` (1646行) | 抽离 `DisasterRecoveryArbitrator` 与 `HandoffDocumentGenerator` | 文件行数减少 ~650 行（从 1646 行瘦身至 600 行以内） |
| **P2 (死代码清除)** | `src/agent/compaction.ts` | 删除未启用的会话内滑动微压实死模块，统合至 `BlackboxCompactor` | 直接删除 1 个文件（~140 行），消灭双重压实混淆概念 |
| **P2 (性能与去重)** | `src/agent/subagent-runner.ts` | 复用全局 `SkillRegistry`，消除单次执行全盘扫描磁盘加载 handoff | 减少 15 行冗余胶水，消除子代理并发磁盘 I/O 阻塞 |
| **P3 (胶水清理)** | `src/cli.ts` 透传层 | 清理重复的静态/实例包装与手写循环参数解析 | 减少 ~200 行样板代码 |
