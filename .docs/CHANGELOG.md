# CPH-PI 变更日志 (CHANGELOG)

本文档记录 CPH-PI 核心调度核、协议层、会话治理与展现层的关键变更历史，严格遵循《AGENTS.md》开发与治理准则。

---

## [Unreleased] - 2026-10-14: 安全整改流水线实施 (Safe Remediation Pipeline: CR-1 ~ CR-5)

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

