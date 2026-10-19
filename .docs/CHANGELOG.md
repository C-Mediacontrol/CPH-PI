# CPH-PI 变更日志 (CHANGELOG)

本文档记录 CPH-PI 核心调度核、协议层、会话治理与展现层的关键变更历史，严格遵循《AGENTS.md》开发与治理准则。

## [2026-10-19] 长战役连续自主接力跃迁与集群并发容量感知架构升级 (Autonomous Multi-Hop Handoff & Swarm Concurrency)

### 概述
排查并彻底解决真实长战役日志中执行至 Gen 11 发生意外中断、返回终端提示符且输入“请继续”无效的根本原因，以及多账号集群下后期仅派发 2-3 个子任务的吞吐瓶颈。严格遵循《AGENTS.md》开发与治理宪章（纯粹中立、黑盒抽象、正向引导、全量附件），将 `maxGenerations` 与 `maxAutonomousHandoffHops` 默认提升至 50，实现代次超标时自主触发无缝接力归档与连续接续；引入集群并发容量事实注入，引导主控模型满额利用账号池算力。全量 651 项单元、集成与 E2E 测试保持 100% 绿灯全通。

### 变更分类明细

#### 1. 核心调度核与 CLI 连续自主接力解脱 (`src/agent/orchestrator.ts`, `src/cli.ts`, `src/cli/args.ts`)
- **根因**:
  - `orchestrator.ts` 默认 `maxGenerations = 10`。运行 6 小时进入 Gen 11 后，第 944 行直接返回未完成且遗漏了 `handedOff: true`，导致 `cli.ts` 退出自动接力循环并返回 `cph-pi>` 交互提示符；
  - 用户在终端输入“请继续”时，由于 `orchestrator.generation` 已累积至 11+ 且 `maxGenerations` 仍为 10，再次派发子代理立即再次触发阻断；
  - `turn = 0` 的重置逻辑被包裹在 `if (this.generation <= this.maxGenerations)` 守卫内，导致跨代后推理轮数未清零，累积溢出至 133/30；
  - `cli.ts` 在 `constructor` 与 `initSession` 中实例化 `CopilotOrchestrator` 时遗漏了透传 `maxGenerations: this.maxAutonomousHandoffHops`。
- **改动**:
  - `src/agent/orchestrator.ts`: 提升 `maxGenerations` 默认至 50；当 `generation > maxGenerations` 时，自动生成五维阶段性成果交接快照（`generateHandoffSnapshot`）并返回 `handedOff: true, handoffSnapshot, handoffDocPath`，驱动 CLI 自动创建后继会话接力跃迁；后继代次无条件重置 `turn = 0`，确保全新 30 轮推理预算兑现；
  - `src/cli.ts`: 提升 `maxAutonomousHandoffHops` 默认至 50，并向 `CopilotOrchestrator` 构造函数显式传递 `maxGenerations: this.maxAutonomousHandoffHops`；
  - `src/cli/args.ts`: 同步更新 CLI `--hops` 帮助文档默认值为 50。

#### 2. 账号池集群容量客观事实注入 (`src/protocol/prompt-builder.ts`, `src/session/main-plan-snapshot.ts`)
- **根因**:
  - 此前 Orchestrator 向主控注入的提示词仅包含工作区骨架与物理文件大小，缺乏当前账号池物理集群容量事实，导致模型仅按单文件 ≤300 行规则保守切片为 2-3 个子任务，无法获知底层 4 账号并发资源。
- **改动**:
  - `src/agent/orchestrator.ts`: 新增 `getConcurrencyWorkerCount()` 私有辅助方法，动态读取当前账号池可用/白名单账号总数；
  - `src/protocol/prompt-builder.ts`: 在 `buildDirectAgentPrompt`、`buildTurn2TaskPrompt`、`buildTurn2TaskPromptWithAttachment` 中增加可选 `concurrencyWorkers?: number`，若 >0 注入 `- 并发集群容量: N 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`；
  - `src/session/main-plan-snapshot.ts`: `formatSuccessorTurn1Prompt` 支持透传并注入集群并发容量事实，确保后继代次主控会话持续感知集群算力。

#### 3. 主控认知塑形与正向集群并发指引 (`cph-main-agent-prompt.txt`, `skills/subagent/SKILL.md`)
- **改动**:
  - 严格遵循《AGENTS.md》准则 3（摒弃负面禁止词，全正向引导），在主控系统提示词 Section 8 与工作区专属技能 `subagent` 核心原则中，增设“集群并发匹配与满载吞吐建议”：在存在多个待攻坚业务切片或正交模块时，推荐单批派发与 Worker 数量匹配的正交子任务，实现多账号集群满负荷并行吞吐。

---

## [2026-10-19] 传输层权威消息恢复与工具执行生命周期链路修复

### 概述
修复 ChatHub 传输层错误保留 `writeAtCursor` 局部光标增量而压制权威 `m.text` 的缺陷。全面对齐《AGENTS.md》准则 1（Harness 纯粹与中立原则），不在调度层为残缺流打特化补丁，直接向 Orchestrator 交付包含完整 Markdown 栅格与字段结构的权威消息体，彻底恢复工具执行状态（`onToolStart` / `onToolEnd`）与终端/日志中 `⚡ 正在执行` 与 `✔ 执行成功` 的客观反馈。全量 648 项测试保持 100% 绿灯全通。

### 变更分类明细

#### 1. 传输层权威终态帧契约归正 (`src/transport/chathub-client.ts`)
- **根因**: 此前为避免 Sydney Markdown 方括号转义 `[foo\]`，错误地以 `!fullText` 条件阻止了权威帧 `m.text` 的覆盖。由于 `writeAtCursor` 增量流已先期填充 `fullText`，导致结构完整的 `m.text` 被丢弃，下游 `ResilientParser` 将无反引号与标签的流式碎片判定为 `invalid_chatter`，造成工具调度完全中断与终端日志执行结果丢失。
- **改动**: 收到 `m.author === "bot" && m.text` 时，统一将 `fullText` 设置为权威完整的 `m.text`，回归标准协议物理契约。转义处理交由 `ToolBridge` 执行层常规规范化处理，避免分层越权。
- **测试**: 更新 `tests/transport/chathub-client.test.ts` 中的断言，确保权威 `m.text` 优先于局部 `writeAtCursor` 交付。

---

## [2026-10-14] 对抗性代码审查安全整改与拓扑解耦 (Adversarial Remediation & Decoupling: CR-1 ~ CR-4)

### 概述
基于对 `CPH-PI` 全量代码库的对抗性代码审查（`FINAL-AUDIT-REPORT.md`，8 组初审与复审子代理闭环穿透），全面执行方案 A 安全整改流水线。严格遵循《AGENTS.md》开发与治理宪章（Harness 纯粹中立、正向引导、黑盒抽象、持久化与视口正交分层），通过四阶段 TDD 红绿循环彻底拔除 5 大系统级矛盾，实现全工程 **572 项单元与集成测试 100% 绿灯全通**。

### 变更分类明细

#### 1. CR-1: 固化底层协议解析、强类型契约与账本保真度 (P0/P1 契约固化)
- **问题根因**:
  - `ResilientParser` 在解析 `invoke_subagent` 动作块时遗漏了 `stage` 属性提取，导致模型规划的串行多阶段任务全部降级为 Stage 1 并发抢跑；YAML `content:` 正则贪婪匹配到末尾，吞噬位于其后的 `path:` 等元数据；
  - `PromptBuilder.buildTurn2TaskPrompt` 依赖 `includes("Skill")` 启发式嗅探推测参数位置，当工具输出或报错包含 "Skill" 时导致工具结果与技能文档发生灾难性反转；
  - `main-plan-snapshot.ts` 动态调用 CommonJS `require` 挂载执行账本，在纯 Node.js ESM 环境下抛 `ReferenceError` 并静默丢失物理账本挂载头；
  - `ToolBridge.recordToLedger` 内部硬编码 `role: "main", sessionId: "main"`，抹杀多子代理责任审计。
- **改动详情**:
  - `src/protocol/resilient-parser.ts`: JSON 与 YAML 解析分支中完整提取 `stage: Number(s.stage) || 1`；YAML `content:` 正则增加同级前瞻断言 `(?=\r?\n\s*(?:path|tool|file|action)\s*:|$)`，杜绝贪婪吞噬；
  - `src/protocol/prompt-builder.ts`: 引入强类型配置接口 `Turn2TaskPromptOptions`，重构 `buildTurn2TaskPrompt` 彻底废除字符串包含嗅探，强类型锁定参数槽位并兼容旧签名；
  - `src/session/main-plan-snapshot.ts`: 改用顶层静态导入 `import { ExecutionLedger }`，消除动态 `require` 运行时风险；
  - `src/protocol/tool-bridge.ts`: `recordToLedger` 接收外部 `context?: { role?: string; sessionId?: string }` 并透传至账本。
- **新增特征测试**:
  - `tests/protocol/subagent-parser-stage.test.ts`
  - `tests/protocol/prompt-builder-order.test.ts`
  - `tests/protocol/yaml-content-lookahead.test.ts`
  - `tests/session/snapshot-static-import.test.ts`

#### 2. CR-2: 调度并发容灾加固、限流误杀拦截与无锁竞态防护 (P0/P1 调度加固)
- **问题根因**:
  - `Orchestrator.isRateLimitResponseText` 粗暴采用 `lower.includes("429")`，将探讨 429 错误码、限流策略或包含 "Line 429" 的普通技术长文误判为平台限流强行自杀并冻结健康账号 3 分钟；
  - `SubagentRunner` 在容量计算中使用 `0 || poolStatus.length`，当全池账号限流时（长度为 0，JS 假值）错误回退为总池大小，反而在限流期以最大并发冲击；
  - `AccountPool.getNextAvailableToken` 在异步 `await getAccessToken` 期间无锁竞态，多个并发 worker 瞬间挤占同一账号；
  - `SessionManager.rebuildIndex` 自愈重建索引时遗漏了 `generation` 与 `handoffCount` 拷贝。
- **改动详情**:
  - `src/agent/orchestrator.ts`: 废除无边界的 `lower.includes("429")`，引入超 300 字符长文熔断守卫（判定为分析长文），并限定仅在行首/状态码错误信令与特定报错行触发；
  - `src/agent/subagent-runner.ts`: 修复容量计算，当全部可用账号限流时平滑降级为单并发保底执行（1），杜绝假值溢出；
  - `src/auth/account-pool.ts`: 引入 `inFlightLeases: Set<string>` 租约隔离，在异步 I/O 挂起前原子标记租约并立即推进 `this.currentIndex`，并在 `finally` 块中严格释放，彻底消除并发挤占；
  - `src/session/session-manager.ts`: `rebuildIndex` 补齐 `generation` 与 `handoffCount` 拷贝，保全代际关系。
- **新增特征测试**:
  - `tests/agent/ratelimit-text-filter.test.ts`
  - `tests/agent/subagent-capacity-zero.test.ts`
  - `tests/auth/account-pool-concurrency-lease.test.ts`
  - `tests/session/session-manager-rebuild-metadata.test.ts`

#### 3. CR-3: 彻底清除违宪特化补丁，恢复 Harness 纯粹中立 (P1 宪章归正)
- **问题根因**:
  - `orchestrator.ts` 硬编码特化 .NET SDK / winget / 0x80070005 异常诊断，并在交接文档中强行注入“切勿盲目重复调用 winget”负面禁止词，严重违反《AGENTS.md》准则 1（Harness 纯粹中立）、准则 3（正向引导）与准则 6（黑盒抽象），在非 .NET 项目中引发严重模型幻觉；
  - `ToolBridge` 通用工具桥接层无差别抓取测试状态徽章，任意含 "password"、"bypass" 等输出均被误抓为测试通过；
  - 两轮滑动微压实逻辑存在死代码，且未在启用时回填替换 `history`。
- **改动详情**:
  - `src/agent/orchestrator.ts`: 彻底物理删除针对 .NET/winget 的特化异常诊断与负面词指引，保持纯粹通用的客观报错呈现与模型思考分析；在滑动压实分支中补充 `history.splice(...)` 真实回填；
  - `src/protocol/tool-bridge.ts`: 限定测试徽章嗅探仅在命令目标显式属于测试框架（`test|spec|jest|vitest|pytest|bun test|npm test` 等）时触发，并采用精确词边界，杜绝抽象泄漏与字串误抓。
- **新增特征测试**:
  - `tests/agent/orchestrator-governance-cleanliness.test.ts`
  - `tests/protocol/tool-bridge-badge-sniffing.test.ts`

#### 4. CR-4: 上帝类职责拓扑解耦与代码柔道精炼 (P2 架构重构)
- **问题根因**:
  - `src/cli.ts` (2,122 行) 上帝单体集聚了 6 大职责，且外部暴力篡改 `orchestrator.isHandshakePending` 内部状态；
  - `tui-renderer.ts` 视图类混合了 140 行复杂的词级 Intra-line Word Diff 比较与高亮算法。
- **改动详情**:
  - `src/cli/args.ts`: 抽离 `ParsedCliArgs`、`parseCliArgs`、`getHelpText`，严格完整保留 `-t`（数字超时 vs 任务描述）多态重载与 `--debug [path]` 可选值特性，并在 `src/cli.ts` 中 re-export 确保全部既有单测 100% 零修改零破坏；
  - `src/cli/commands.ts`: 抽离 350+ 行 Slash 命令表与命令分发器，完善 `/clear` 与 `/audit` 指令；
  - `src/ui/diff-highlighter.ts`: 封装独立 `DiffHighlighter` 类，收敛词级 Diff 算法，`tui-renderer.ts` 瘦身 140 行并委托调用；
  - `src/agent/orchestrator.ts`: 封装显式自治方法 `completeHandshake()` 与 `setHandshakePending(pending: boolean)`，彻底消除外部暴力篡改。
- **新增特征测试**:
  - `tests/cli/args-polymorphism.test.ts`
  - `tests/ui/diff-highlighter.test.ts`

### 验证指标
- **单元与集成测试**: **84 个测试文件，572 项用例全部绿色通过（2,451 个断言），100% 绿灯**。
- **打包与编译验证**: `bun run build:package` 成功构建 `package/bin/cph-pi.js` (0.95 MB) 与 `check-accounts.js` (59.65 KB)，744 个模块零报错打包。

---

## [Baseline] - 2026-10-14: 安全整改流水线实施 (Safe Remediation Pipeline: CR-1 ~ CR-5)

### 概述
基于多代理对抗性代码审查（`FINAL-AUDIT-REPORT.md`）对 `cph-terminal-2026-10-13T13-00-34.log` 运行日志暴露的 5 项确凿核心缺陷进行全面安全整改。通过 TDD 红绿循环（特征测试锁死缺陷 ➔ 源码最小化修复 ➔ 全量回归），实现 508 项单元与集成测试 100% 绿灯通行。

### 变更分类明细

#### 1. CR-1: 修复子代理并发熔断稀疏数组空洞引发的运行时崩溃 (P0 缺陷修复)
- **问题根因**: `src/agent/subagent-runner.ts` 使用 `new Array(tasks.length)` 初始化，在并发 worker 触发熔断（`circuitBreakerTriggered`）或超时取消提前退出时产生 V8 稀疏数组空洞（holes）；在后续 `formatReportSummary` 中索引遍历访问 `r.success` 触发未捕获 `TypeError: undefined is not an object` 闪退。
- **改动详情**:
  - `src/agent/subagent-runner.ts`:
    - 在 Stage worker 提前退出/熔断分支中，显式补齐未执行任务为 `STAGE_CIRCUIT_BREAKER` 状态；
    - 在 `formatReportSummary` 增加对元素未定义或空槽的防御守卫：`if (!r) continue;`；
    - 在 `executeBatch` 结果解构成报告时增加空项保护，确保向外部返回的报告数组 100% 密集无空洞。
- **特征测试**: `tests/agent/subagent-sparse-array.test.ts` (新增，验证取消与熔断场景无空洞无崩溃)。

#### 2. CR-2: 修复传输层空响应引发的 30 轮闪电纠偏死循环 (P0 缺陷修复)
- **问题根因**: SignalR 上游因长思考或纯进度帧返回空载荷 `""` 时，`ResilientParser` 将其归类为 `invalid_chatter` 并注水纠偏提示词，`Orchestrator` 机械累加 `turn++` 并回射注水提示词，导致 1 秒内刷尽 30 轮推理预算。
- **改动详情**:
  - `src/protocol/resilient-parser.ts`:
    - `ParsedTurn` 联合类型新增 `{ type: "empty_response"; thought: string }`；
    - 文本为空（`!trimmed`）时直接返回 `empty_response` 类型，隔离普通闲聊。
  - `src/agent/orchestrator.ts`:
    - 针对 `empty_response` 增加最多 2 次指数退避重试，不递增正式 `turn` 计数；
    - 连续空响应超限后优先触发账号池轮换（Switch Account）或平滑抛出可捕获异常，阻断秒级刷爆轮次。
- **特征测试**: `tests/protocol/empty-response-handling.test.ts` (新增，验证空响应分流与防抖重试)。

#### 3. CR-3: 调优云端附件上传阈值并恢复 Prompt 物理事实指纹 (P1 架构治理)
- **问题根因**: `cloudAttachmentThresholdChars` 默认硬编码为 0，导致任何大于 0 字符的工具输出（如微小命令）全量上传 OneDrive，Prompt 中工具结果被全量剥离为纯占位符；叠加 OneDrive 回读权限同步延迟，导致模型陷入严重认知失明与盲目空转。
- **改动详情**:
  - `src/agent/orchestrator.ts`:
    - 默认 `cloudAttachmentThresholdChars` 调优为 `12000` 字符，`cloudAttachmentThresholdLines` 调优为 `200` 行；
    - 上传附件时提取原始输出首尾各 25 行（Head-Tail Excerpt）事实指纹传入提示词构建器。
  - `src/protocol/prompt-builder.ts`:
    - `buildAttachedToolResultPrompt` 新增 `excerpt` 参数，在附件提示中嵌入【物理执行指纹摘要 (Head-Tail Fingerprint)】与状态码，确保模型具备完整情境感知。
  - `tests/agent/full-file-delivery.test.ts`:
    - 同步更新对默认阈值演进至 12,000 / 200 的断言。
- **特征测试**: `tests/agent/cloud-attachment-threshold.test.ts` (新增，验证内联送达与超限时的物理指纹保留)。

#### 4. CR-4: 全面消除提示词负面禁止词并正向塑形 Shell 认知 (P1 宪章归正)
- **问题根因**: 内置提示词与执行日志账本存在“严禁输出工具块”、“严禁在对话流中全量回放日志”等负面禁止词，违背《AGENTS.md》准则 3，引发模型粉色大象效应与过度防御；Windows 下 Git Bash 环境将双引号 PowerShell 变量提前展开致使命令语法崩溃。
- **改动详情**:
  - `src/protocol/prompt-builder.ts`:
    - `PROTOCOL_REMINDER` 全面转为建设性正向指引：任务完成时直接在独立行输出 `FINAL_ANSWER: <任务交付总结说明>`；
  - `src/session/ledger/execution-ledger.ts`:
    - 重构日志调阅指引为“通过调阅物理账本或关键指纹获取执行事实”；
  - `cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`cph-coder-agent-prompt.txt`:
    - 正向声明终端调度环境为 POSIX 规范（Git Bash），执行 PowerShell 命令时使用单引号字面量包裹代码块（如 `powershell.exe -NoProfile -Command '...'`），防止内部变量被提前求值展开。
- **特征测试**: `tests/protocol/prompt-builder-governance.test.ts` (新增，正则扫描断言零负面禁用词并验证 Git Bash 指引)。

#### 5. CR-5: 解耦 TUI 交互渲染与磁盘文件日志 (P1 展现层解耦)
- **问题根因**: `TerminalLogger` 全局拦截 stdout 将全量 ASCII 矩阵看板写入磁盘日志 `cph-terminal-*.log`，刷入 1200+ 次全量重绘（超 22,000 行 ANSI 边框噪音，占总行数 82%），严重淹没模型思维与实际报错。
- **改动详情**:
  - `src/ui/tui-renderer.ts`:
    - 新增 `formatSubagentMatrixEvent` 输出紧凑单行结构化事件流；
    - `renderSubagentMatrix` 增强紧凑模式支持。
  - `src/ui/terminal-logger.ts`:
    - 新增 `isTuiMatrixRedrawFrame` 检测看板重绘帧；
    - 在写入磁盘日志时过滤全量重绘方框，压缩记录为单行结构化看板同步事件或防抖去重，磁盘日志体积降低 80% 以上。
- **特征测试**: `tests/ui/tui-logger-decoupling.test.ts` (新增，验证屏幕 ANSI 看板与磁盘纯净日志解耦)。

### 验证指标
- **单元与集成测试**: 72 个测试文件，508 项用例全部绿色通过（2235 个断言），耗时 20.14s。
- **零回归事故**: 现有 492 项历史基线测试 100% 保持通过，无破坏性变更。

