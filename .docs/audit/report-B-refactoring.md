# 对抗复核报告：代码坏味道与重构契机 (Dim-1: refactoring-patterns)

- **复核基准**: `.docs/audit/report-A-refactoring.md`
- **参考设计资产**:
  - `specs/2026-10-10-cph-pi-design.md`
  - `specs/2026-10-11-cph-pi-smart-handoff-and-interactive-runtime-design.md`
  - `specs/2026-10-12-main-session-virtualization-and-account-concurrency-design.md`
  - `plans/2026-10-12-main-session-virtualization-and-account-concurrency-plan.md`
  - `plans/2026-10-12-tri-agent-handoff-and-lineage-implementation-plan.md`
- **参考项目宪章**: `AGENTS.md` (根目录与 CPH-PI 目录全部 6 大条款)
- **Git 核查范围**: `HEAD` (commit `6d1d7cb` 至 `b8ad75a`, 重点比对 `2297b87`, `acde463`, `2eb4e39`, `a656b4f`)
- **基线测试验证**: 476 passed / 0 failed / 63 test files (实测通过)
- **架构健康评分纠偏**: 由初审 **3.5 / 10** 纠偏为 **6.0 / 10** (在 476 绿灯测试保护下，系统具极高工程可用性，不属于濒死“大泥球”，但存在局部显著技术债)
- **统计**: 确凿 [7] | 既定设计 [3] | 违反宪章 [0] | 设计脱节 [0] | 误报 [0]

---

## 紧凑对账索引表 (Reconciliation Table)

| 编号 | 缺陷简述 | 文件与行号 | A置信度 | B裁决 | 核心依据摘要 |
|---|---|---|---|---|---|
| 1 | CphPiCli 职责严重超载 | `src/cli.ts#L71-L1658` | Level 2 | `[CONFIRMED]` | 2082 行包含 8 个正交关注点，命令隔离与单测困难，SRP 破坏确凿 |
| 2 | CopilotOrchestrator.run() 超长函数与发散变化 | `src/agent/orchestrator.ts#L140-L858` | Level 2 | `[CONFIRMED]` | 554 行嵌套 10+ 异步阶段并在循环体篡改 `turn = 0` 控制变量，圈复杂度过高 |
| 3 | 主控与子代理各自克隆自主接力循环 | `src/cli.ts#L1385-L1637` vs `src/agent/subagent-runner.ts#L246-L378` | Level 1 | `[INTENDED-DESIGN]` | **部分论据存在幻觉**（`cli.ts` 无 `lineageTracker`）。前台交互宿主与后台批处理工作流领域模型正交，强行抽象为反模式 |
| 4 | CLI 强行注入 Orchestrator 内部状态 | `src/cli.ts#L195, L437, L448, L828, L893, L962, L1243` | Level 1 | `[CONFIRMED]` | `(orchestrator as any).timeoutMs` 为无效幽灵属性；`modelTone` 破坏 private 封装。注：`isHandshakePending` 原生为 public 非越权 |
| 5 | PromptBuilder 模糊内容推断 | `src/protocol/prompt-builder.ts#L140-L164` | Level 1 | `[CONFIRMED]` | 基于关键词 `Skill`/`技能` 字符串嗅探参数，工具输出若包含技能代码会导致提示词语义致命错位，严重违反协议确定性 |
| 6 | TurnRecord 与 SessionTurnRecord 不对齐 | `src/agent/compaction.ts#L1-L11` vs `src/session/session-manager.ts#L7-L19` | Level 2 | `[INTENDED-DESIGN]` | 内存紧凑运算模型与磁盘 JSON 存储模型分层设计合理；但 `cli.ts` 暴露手动映射属于局部胶水代码异味 |
| 7 | ToolBridge 结果包装与持久化样板 4 次复制 | `src/protocol/tool-bridge.ts#L602-L622, L659-679, L686-706, L758-778` | Level 2 | `[CONFIRMED]` | 4 处 catch 与失败分支中一字不差复制粘贴 20 行样板代码，违背 DRY 原则 |
| 8 | 上下文 Token 估算算法复制粘贴 | `src/cli.ts#L472-L480` vs `src/cli.ts#L1139-L1147` | Level 1 | `[CONFIRMED]` | 状态栏与 `/status` 诊断卡中各手写一份完全相同的字符求和除以 3.5 算法，存在展示分歧隐患 |
| 9 | ChatHubClient.sendMessage() 巨石长函数与闭包 | `src/transport/chathub-client.ts#L113-L483` | Level 2 | `[CONFIRMED]` | 370 行单 Promise 闭包管理底层 SignalR 帧与连接，属于典型 Long Method，但重构具有高网络风险，需渐进下沉帧解析 |
| 10 | 散落的魔术字面量与协议配置泥团 | `src/transport/chathub-client.ts#L257-L277, L314-L322` | Level 3 | `[CONFIRMED]` | 11 个 Sydney optionsSets、6 个消息类型等硬编码在网络方法内，应提取为协议常量 |
| 11 | TuiRenderer 横幅框渲染重复逻辑 | `src/ui/tui-renderer.ts#L492-L604, L798-L835` | Level 3 | `[INTENDED-DESIGN]` | 容灾横幅 (双线+Emoji) 与虚拟化横幅 (单线单宽框) 属于专用 UI 卡片设计，强行抽象函数反而增加参数复杂度 |

---

## 逐项事实对账详情

### 针对初审第 1 项：CphPiCli 职责严重超载 (God Class & Divergent Change)
- **初审判定与 PoC**:
  初审指出 `CphPiCli` 拥有 27 个实例字段，代码量 2082 行，混杂了 CLI 参数解析、配置存取、Readline REPL 循环、多行累积、12+ 快捷命令、账号白名单、子代理矩阵状态渲染与多代接力调度。单测任何子功能都必须实例化沉重的整套运行环境。
- **原作者辩护推演 (Steelmanning)**:
  `CphPiCli` 是整个终端命令行工具的 Application Shell / REPL Host，承接了终端交互式 TUI 与底层 Orchestrator 之间的所有黏合逻辑。在前期从极简 Pi 架构演进到支持三阶容灾、多子代理实时仪表盘以及多代会话跃迁的过程中，原作者为了保障开发节奏与端到端闭环，将所有与终端交互相关的状态集中收敛在 CLI 宿主中，避免过早过度设计和碎裂化文件结构。
- **项目宪章 (AGENTS.md) 校验**:
  重构 `CphPiCli` 纯属本地 Harness 控制台外壳的代码重组，既不涉及系统提示词侵犯，也不改变黑盒契约，未违反宪章。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**:
  查看 `src/cli.ts#L71-L1658`，该类确有 27 个私有/公有字段，`executeTask` 方法长达 250 行，`handleCommand` 包含庞大的分支分发，符合 Martin Fowler 描述的 God Class 坏味道。
- **设计文档与 Git 证据链**:
  在 `specs/2026-10-11-cph-pi-smart-handoff-and-interactive-runtime-design.md` 中，REPL、问答打通与状态展示被一次性并入 `cli.ts`，未规划独立控制器层。
- **最终保留建议**:
  采纳 A1 建议：提炼 `CommandRegistry` 与独立 Command Handler 处理类，提炼 `ReplController` 负责 Readline 流管理，让 `cli.ts` 缩减至纯胶水组装入口。

---

### 针对初审第 2 项：CopilotOrchestrator.run() 职责严重过载 (Long Method & God Class)
- **初审判定与 PoC**:
  `CopilotOrchestrator.run()` 跨越 L304-L858（长达 554 行），深层嵌套 Token 故障转移、Turn 1 握手探测、主推演循环、流式数据解析、SandBox 拒答重试、子代理并发虚拟化、代际转生重置计数器（`turn = 0; this.generation++`）、OneDrive 附件上传与滑动微压实。
- **原作者辩护推演 (Steelmanning)**:
  在 Sydney/SignalR 协议的长会话编排中，每一轮对话的流转高度依赖前序轮次的上下文状态（如拒答重试次数、握手标志、活动账号 Token、流式 Delta、当前 Prompt）。特别是在引入“主控会话虚拟化”与“后继代际唤醒”（commit `2eb4e39` / `a656b4f`）时，系统需要在 `invoke_subagent` 动作返回后原地完成：释放 WebSocket 链接、执行子代理批处理、生成架构快照、重置 `turn = 0`、构造代际唤醒 Prompt 并继续推演。将这一连续的会话生命周期编写在同一个扁平循环中，极大降低了异步状态跨对象传递时的时序错乱风险。
- **项目宪章 (AGENTS.md) 校验**:
  重构 Harness 编排层提取子类（如代际转生管理器、附件上传拦截器）符合工程解耦规范，不违反中立性与黑盒契约。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**:
  物理行号完全对齐。方法内局部变量过多，`turn` 变量在循环中被 `turn = 0` 重置，极难单测或插桩。
- **设计文档与 Git 证据链**:
  `plans/2026-10-12-main-session-virtualization-and-account-concurrency-plan.md` 任务 3 与 4 显示，代际转生与附件上传是快速叠加进入 `run()` 循环体的。
- **最终保留建议**:
  采纳 A1 建议：提炼 `GenerationalSuccessor` 管理主控虚拟化与后继代际唤醒；提炼单轮分发方法 `dispatchTurnAction`。

---

### 针对初审第 3 项：主控与子代理各自克隆自主接力循环 (Duplicate Code)
- **初审判定与 PoC**:
  初审声称 `src/cli.ts#L1385-L1637` 与 `src/agent/subagent-runner.ts#L246-L378` 均实现了“递增循环、监听 handedOff、读取快照、向 lineageTracker 注册后继节点、拼接接力模版、重跑 Orchestrator”，属于典型散弹式修改。
- **原作者辩护推演 (Steelmanning)**:
  主控与子代理在架构上分属两个完全不同的执行域（Execution Domains）：
  - 主控是**交互式前台有状态宿主 (Interactive TUI Host)**，其会话必须完整持久化到 `.cph/sessions/*.json`，并由用户通过键盘干预（`/continue`, `/resume`）；
  - 子代理是**无头后台受限并发执行器 (Headless Batch Worker)**，其生命周期是轻量级瞬态的，会话由 `lineageTracker` 和日志树追踪，不生成完整的 SessionRecord，且需在完结时产出 `SubagentReport`。
  如果强行将两者抽象为一个泛型 `AutonomousHandoffLoop<TContext, TResult>`，将导致需要注入大量的回调函数（UI 渲染 vs 日志流、SessionManager 存取 vs LineageTracker 登记、交互式中断 vs 批处理取消），造成严重的**不成熟抽象 (Accidental Generalization / Premature Abstraction)**，破坏关注点分离。
- **项目宪章 (AGENTS.md) 校验**:
  AGENTS.md 准则 6 规定“操作者视角而非运维者视角”、“黑盒契约”，主控与子代理的提示词差异正是基于准则 2（认知塑形与正向引导优先）做出的针对性角色定制，不应抹平。
- **复核裁决**: `[INTENDED-DESIGN]` (既定设计与合理取舍，A1 存在关键事实幻觉与过度抽象)
- **源码与上下文核验**:
  - **严重事实查证**: `src/cli.ts` 全文中**根本不存在任何 `lineageTracker` 引用**！A1 报告声称两者在第 4 步均执行了“向 lineageTracker 注册后继节点与父子关系”，属于**事实幻觉 (Fact Hallucination)**。
  - `cli.ts` 深度耦合 `SessionManager`、`TuiRenderer` 与 ANSI 横幅；`subagent-runner.ts` 深度耦合 `loggerTree`、`lineageTracker` 与 `SubagentReport`。两者数据流正交。
- **设计文档与 Git 证据链**:
  `specs/2026-10-12-tri-agent-handoff-and-lineage-architecture-design.md` 明确界定了主控与子代理的生命周期差异：主控是 Session 树根，子代理是轻量无头瞬态执行单元。
- **最终保留建议**:
  **否决 A1 的提炼通用模板类方案**。保留两者的独立执行循环；仅允许将两处共用的交接文档读取与容错逻辑抽为小工具函数，不得合并主控与子代理的调度控制器。

---

### 针对初审第 4 项：CLI 强行注入 Orchestrator 内部状态 (Inappropriate Intimacy)
- **初审判定与 PoC**:
  初审指控 `cli.ts` 使用 `as any` 篡改 `timeoutMs` (L195, L828)、`isHandshakePending` (L437, L448, L893, L962)、`modelTone` (L1243)，以及 `orchestrator.ts` 内部使用 `(client as any)?.token?.email` (L526)。
- **原作者辩护推演 (Steelmanning)**:
  在早期迭代中，CLI 动态命令（`/model`, `/timeout`）以及 Orchestrator 内部的账号池轮换（Failover）需要在运行时动态调整配置。原作者为了避免级联修改 `IOrchestratorChatClient` 和 `CopilotOrchestrator` 的公共接口与测试 Mock，采用了临时性的类型逃逸。
- **项目宪章 (AGENTS.md) 校验**:
  重构类型契约、清理无效属性完全符合规范。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷，部分行号判定需纠偏)
- **源码与上下文核验**:
  - **纠偏**: `isHandshakePending` 在 `src/agent/orchestrator.ts#L168` 中本身即为 `public isHandshakePending: boolean = true;`，在 `cli.ts` 中并没有使用 `as any` 访问，A1 描述有偏差；
  - **实锤**: `(this.orchestrator as any).timeoutMs` 在 `orchestrator.ts` 内部**压根没有该字段**，此属性设置是完全无效的“幽灵属性 (Ghost Field)”！
  - **实锤**: `modelTone` 确为 private 字段，`as any` 破坏类型安全；`client.token.email` 与 `client.close()` 破坏接口约束。
- **设计文档与 Git 证据链**:
  Git blame 显示 `(this.orchestrator as any).timeoutMs` 来自初始原型提交 `b8ad75a`，属于历史遗留死代码。
- **最终保留建议**:
  采纳 A1 建议：删除无用的 `timeoutMs` 幽灵赋值；在 `CopilotOrchestrator` 提供 `updateModelTone()` 等方法；在 `IOrchestratorChatClient` 中明确补充 `token?: any; close?(): void` 可选契约。

---

### 针对初审第 5 项：PromptBuilder 模糊内容推断 (Primitive Obsession & Parameter Sniffing)
- **初审判定与 PoC**:
  初审指出 `PromptBuilder.buildTurn2TaskPrompt` 依据 `arg2.includes("Skill") || arg2.includes("技能")` 或 `arg3.includes("Skill")` 动态猜测哪个参数是技能提示词、哪个是工具输出。若工具输出的代码包含 `Skill`，会导致参数语义反转，将代码错拼进系统技能区。
- **原作者辩护推演 (Steelmanning)**:
  在开发初期，该方法仅接收 `(task, toolResult)`。后续需求演进增加了技能系统提示词注入（`skillsSection`），为了向后兼容旧的单/双参数调用方，原作者避免了全量重构测试和调用点，编写了内容嗅探逻辑进行动态重载适配。
- **项目宪章 (AGENTS.md) 校验**:
  **高度契合项目宪章准则 1 与准则 2！**
  - 准则 1：“调度纯粹性……严禁在 Harness 中引入模糊猜测”。
  - 准则 2：“提示词优先：所有解决模型偏离的着力点，必须聚焦在协议提示词构建器上”。
  内容嗅探反模式极易因用户源码或工具输出中含有 "Skill" 关键词而诱发致命的提示词倒置与认知污染！
- **复核裁决**: `[CONFIRMED]` (高危确凿缺陷)
- **源码与上下文核验**:
  查看 `src/protocol/prompt-builder.ts#L140-L164`，代码完全吻合 A1 描述。单测 `tests/protocol/prompt-builder.test.ts` 均依赖这一脆弱签名。
- **设计文档与 Git 证据链**:
  在 `2026-10-10-cph-pi-session-and-handshake-implementation.md` 中增加了技能注入，因未设计参数对象而引入了该启发式反模式。
- **最终保留建议**:
  采纳 A1 建议：引入强类型参数对象 `interface Turn2PromptParams { task: string; toolResult: string; skillsSection?: string; toolName?: string; }`，彻底废除内容模糊嗅探。

---

### 针对初审第 6 项：TurnRecord 与 SessionTurnRecord 不对齐 (Data Clumps / Duplicate Abstraction)
- **初审判定与 PoC**:
  初审指控 `TurnRecord` (扁平结构) 与 `SessionTurnRecord` (带 toolCalls 数组和时间戳) 结构不对齐，导致在 `cli.ts#L1478-L1506` 编写了长达 30 行的手动映射胶水循环。
- **原作者辩护推演 (Steelmanning)**:
  这是典型的**运行时计算模型 (Runtime Calculation Model)** 与 **磁盘持久化模式 (Persistence Storage Model)** 的分层解耦：
  - `TurnRecord` 是为了 `CompactionService` 高频执行滑动窗口折叠与字符估算而设计的，必须保持扁平轻量；
  - `SessionTurnRecord` 是为了序列化保存至 `.cph/sessions/ses_*.json`，需要容纳 ISO 时间戳以及未来多工具并发调用的 `toolCalls` 数组。
  如果不分层而直接绑定，未来持久化 schema 的变更会直接污染内部紧凑算法，甚至导致磁盘上的老会话记录反序列化失败。
- **项目宪章 (AGENTS.md) 校验**:
  纯属底层工程分层设计，不违反宪章准则。
- **复核裁决**: `[INTENDED-DESIGN]` (既定设计与合理分层，存在局部胶水异味)
- **源码与上下文核验**:
  两个接口确实字段名不同；但在 `cli.ts` 中手写适配循环确实增加了阅读噪音。
- **设计文档与 Git 证据链**:
  `specs/2026-10-10-cph-pi-session-management-and-handshake-design.md` 显示 Session 文件持久化格式先于 compaction 模块确立，两者独立演进。
- **最终保留建议**:
  **不强行统一为一个实体**（保留运行时内存模型与磁盘 JSON Schema 的独立演进能力）。但应在 `SessionManager` 中新增 `appendOrchestratorHistory(session, history)` 适配方法，将胶水代码从 `cli.ts` 中彻底移出。

---

### 针对初审第 7 项：ToolBridge 结果包装与持久化样板 4 次复制 (Duplicate Code)
- **初审判定与 PoC**:
  初审指出在 `ToolBridge.executeAction` 中，大输出脱敏、持久化文件判断、结果格式化这 20 行样板代码在 4 处 `catch` 和错误分支中一字不差地重复出现。
- **原作者辩护推演 (Steelmanning)**:
  4 个分支分别位于 `mapAction` 失败、`onQuestion` 失败、未找到原生 Pi 工具、工具实际执行异常 4 个截然不同的生命周期阶段。原作者为了保证工具桥梁绝不对外抛出未捕获异常、确保任何故障都能产生符合协议格式的 `ToolBridgeResult`，在每个 `catch` 和错误分支独立封闭处理，确保局部逻辑自包含。
- **项目宪章 (AGENTS.md) 校验**:
  内部提炼私有函数，不改变客观工具输出协议，完全合规。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**:
  查看 `src/protocol/tool-bridge.ts#L602-L622, L659-679, L686-706, L758-778`，4 段代码物理上完全一模一样，纯属 Copy-Paste。
- **设计文档与 Git 证据链**:
  该文件在特性迭代中逐步为每个分支补全错误包装，产生了机械复制。
- **最终保留建议**:
  采纳 A1 建议：提炼 `private createErrorResult(...)` 统一错误结果构造。

---

### 针对初审第 8 项：上下文 Token 估算算法复制粘贴 (Duplicate Code)
- **初审判定与 PoC**:
  初审指出在 `cli.ts` 的 `renderCurrentStatusBar()` (L472-L480) 与 `getDiagnosticCard()` (L1139-L1147) 中，统计会话字符并除以 3.5 估算 Token 的算法完全复制粘贴。
- **原作者辩护推演 (Steelmanning)**:
  状态栏渲染和 `/status` 诊断卡是分别在不同特性开发周期中添加的终端呈现组件。因为算法仅有 8 行简单的累加与除法，原作者就地内联实现，未额外定义共享工具函数。
- **项目宪章 (AGENTS.md) 校验**:
  无冲突。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**:
  完全一致的 8 行累加算法，属于标准 DRY 违背。
- **设计文档与 Git 证据链**:
  在 `2026-10-10-cph-pi-turn-limits-and-context-probe-design.md` 中定义了 3.5 换算比率，后在各 UI 处直接内联。
- **最终保留建议**:
  采纳 A1 建议：提取为 `SessionManager` 或独立工具函数 `estimateSessionTokens(session: SessionRecord): number`。

---

### 针对初审第 9 项：ChatHubClient.sendMessage() 巨石长函数与深度回调闭包 (Long Method)
- **初审判定与 PoC**:
  初审指出 `sendMessage()` 长达 370 行，封闭在一个大 Promise 闭包中，同时掌管生命周期、定时器、WebSocket 连接、SignalR 握手与各种类型帧解析。
- **原作者辩护推演 (Steelmanning)**:
  在低层 WebSocket 网络传输中，单次请求响应是一个拥有严格原子生命周期与时序约束的状态机。将 `isSettled`、`cleanup()`、`ws`、`timeoutTimer` 封装在单个 Promise 闭包内部，是 JavaScript 处理异步连接防止定时器泄露和并发竞态的最直接且自包含的模式。一旦拆分成跨类或跨实例对象，生命周期的管理与清理边界将变得更加分散，稍有不慎即会在高并发或频繁中断（AbortSignal）下产生死锁或内存泄露。
- **项目宪章 (AGENTS.md) 校验**:
  AGENTS.md 准则 6 规定“严格隔绝 Harness 底层物理实现细节：严禁向模型解释底层 WebSocket 如何连接与断开……SignalR 帧解析机制”。传输层的重构纯属底层网络工程，对 Agent 保持绝对黑盒透明。
- **复核裁决**: `[CONFIRMED]` (确凿代码异味，但属于工程高风险区)
- **源码与上下文核验**:
  行号吻合（L113-L483）。闭包内部共享可变状态多达 10 个。
- **设计文档与 Git 证据链**:
  该实现来自原始轻量级代理核心，历经多轮稳定性修补。
- **最终保留建议**:
  **谨慎实施重构**。建议优先做轻量级“提炼纯函数”，将 SignalR 帧分发逻辑提取为无状态的帧解析器函数，而不是直接重写为复杂的 `ChatHubStreamingSession` 会话对象，防止破坏脆弱的定时器清理与套接字析构逻辑。

---

### 针对初审第 10 项：散落的魔术字面量与协议配置泥团 (Magic Literals & Data Clumps)
- **初审判定与 PoC**:
  初审指出 `src/transport/chathub-client.ts#L257-L277, L314-L322` 中深度内嵌了 11 个 Sydney optionsSets、6 个 allowedMessageTypes 等长文本魔术字面量数组。
- **原作者辩护推演 (Steelmanning)**:
  这些字符串字面量是微软 Sydney/Office Copilot 私有协议写死的固定请求契约，全系统仅在 `ChatHubClient.sendMessage` 发送 Chat 帧时使用一次，且与该协议版本高度耦合，没有其他业务组件会复用它们。
- **项目宪章 (AGENTS.md) 校验**:
  无冲突。
- **复核裁决**: `[CONFIRMED]` (确凿缺陷)
- **源码与上下文核验**:
  行号对齐，代码内直接硬编码了长数组字面量。
- **设计文档与 Git 证据链**:
  属于协议逆向资产的直接映射。
- **最终保留建议**:
  采纳 A1 建议：提炼至 `src/transport/protocol-constants.ts`，提升可配置性。

---

### 针对初审第 11 项：TuiRenderer 横幅框渲染重复逻辑 (Duplicate Code)
- **初审判定与 PoC**:
  初审指出在 `tui-renderer.ts` 中存在 6 个独立的 Banner 格式化方法，每个方法均手写了 `border = "─".repeat(60)`、`padEnd(35)` 等 ANSI 控制字符与换行组合。
- **原作者辩护推演 (Steelmanning)**:
  TUI 界面中不同的系统事件（容灾接力 vs 会话虚拟化归档 vs 后继代际唤醒）对应不同层级的视觉提示。终端字符画（ASCII/Unicode Box）对每一行的文本对齐（`padEnd(35)`）有极高的硬编码视觉要求，原作者为每个关键阶段手写排版以获得最佳的终端视觉呈现效果。
- **项目宪章 (AGENTS.md) 校验**:
  无冲突。
- **复核裁决**: `[INTENDED-DESIGN]` (既定设计与合理取舍)
- **源码与上下文核验**:
  源码中 6 个 Banner 实际上分为两组截然不同的设计语言：
  - 容灾与接力系列（L492-L604）采用 `═` 双横线 + Emoji 居中分隔风格；
  - 虚拟化与代际唤醒系列（L798-L835）采用 `┌─┐` Unicode 单线盒式框风格。
  两组风格的换行与填充计算完全不同。
- **设计文档与 Git 证据链**:
  在 commit `b2094a5` 中专门为虚拟化和代际转生定制了醒目的终端单线方框，属于特定 UI 资产设计。
- **最终保留建议**:
  **维持现状**。此类 UI 文本模板代码变更频率低且互不影响，强行抽取通用方框生成器会导致传入繁琐的排版回调，代码可读性反而下降。

---

## 针对初审重构蓝图的综合修正指导

| 实施阶段 | A1 原始建议 | B 对抗裁决与修正建议 |
|---|---|---|
| **第一阶段** | 消除嗅探(5)、ToolBridge(7)、Token(8)、Orchestrator封装(4) | **完全批准并高优先级执行**。特别强调第 5 项消除参数内容嗅探是关乎模型提示词确定性的第一安全屏障；清理第 4 项中无效的 `timeoutMs` 幽灵赋值。 |
| **第二阶段** | 提炼接力执行核(3)、分解 CLI(1)、分解 Orchestrator.run(2) | **大幅修正**：<br>1. **否决**合并主控与子代理接力核(3)，因两者领域模型完全正交且 A1 存在事实幻觉；<br>2. **批准**将 CLI(1) 的命令模式与 REPL 抽离；<br>3. **批准**在 Orchestrator(2) 提炼代际转生管理器。 |
| **第三阶段** | 统一轮次契约(6)、重构 ChatHub 传输层(9, 10) | **谨慎修正**：<br>1. **否决**消除 `TurnRecord` 与 `SessionTurnRecord` 的分层边界，改为在 `SessionManager` 封装适配器方法消除手写胶水；<br>2. 常量下沉(10)立即执行；传输层(9)只做无状态帧解析提取，严禁重写 WebSocket 异步 Promise 闭包。 |

---
*复审人: Adversarial Auditor Subagent B1 (Dim-1: refactoring-patterns)*
