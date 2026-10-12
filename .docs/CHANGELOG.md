# CPH-PI 变更日志 (CHANGELOG.md)

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 2026-10-12 (安全整改专项流水线 fix/audit-remediation-20261012)

### 🛠️ 架构重构与上帝类解构 (CR-05)
- **解构 `src/cli.ts` (2082 -> 1413 行，缩减 333 行)**:
  - 抽离 `src/cli/args.ts`: 独立声明式参数解析器与帮助文档生成器，导出 `parseCliArgs`, `getHelpText` 与 `estimateTokens`；
  - 抽离 `src/cli/command-dispatcher.ts`: 提取 `CommandDispatcher` 类，解耦 15 组交互式 Slash 命令的分发注册；
  - 根除猴子补丁: 移除所有 `(this.orchestrator as any)...` 私有属性强行篡改，正规化公开接口 `getModelTone()`, `setModelTone()`, `setCustomAgentId()`, `resetHandshake()`；删除无效幽灵属性 `timeoutMs` 的注入。
- **解构 `src/agent/orchestrator.ts` (1646 -> 1062 行，缩减 584 行)**:
  - 抽离 `src/agent/handoff-generator.ts`: 封装 375 行独立快照与接力文档生成服务；
  - 抽离 `src/agent/disaster-arbitrator.ts`: 封装 355 行 Session A -> B -> C 三段式容灾仲裁服务；
  - 修复轮次单调性: 区分单代循环预算 `turn` 与历史记录全局单调索引 `globalTurn`，消除代际接力时轮次倒退错位。
- **消除样板代码克隆**:
  - `src/protocol/tool-bridge.ts`: 提炼 `createErrorResult` 统一错误构造与结果格式化，消除 4 处重复 20 行样板代码；
  - 统一诊断卡与状态栏的 Token 估算纯函数 `estimateTokens`。

### 🏛️ 分层净化与血缘持久化 (CR-04)
- **解耦 Auth ➔ Transport 反向依赖**:
  - 创建 `src/utils/url-utils.ts`，实现并导出 `normalizeAgentId`；
  - `src/auth/account-pool.ts` 移除对 `ChatHubClient` 的直接导入；保持 `ChatHubClient.normalizeAgentId` 静态别名 100% 向后兼容。
- **解耦 Agent ➔ UI 反向依赖**:
  - `src/agent/subagent-runner.ts` 移除对 `../ui/terminal-logger.ts` 的导入，提炼本地轻量日志接口 `ISubagentLoggerStream` 与 `ISubagentLoggerTree`。
- **解除循环依赖与循环 Barrel**:
  - `subagent-runner.ts` 改为动态按需引入 `CopilotOrchestrator`，消除与 `orchestrator.ts` 的顶层 ESM 闭环；
  - `blackbox-compactor.ts` 直接声明导出 `TurnRecord`；`compaction.ts` 移除 `export { BlackboxCompactor, ... }` 循环 Barrel 导出。
- **血缘追踪磁盘落盘持久化**:
  - `src/session/lineage-tracker.ts`: 增加 `serialize()` 与 `deserialize()`；
  - `src/session/session-manager.ts`: `SessionRecord` 增加 `lineage?: Record<string, SessionLineage>` 字段，支持会话持久化与跨生命周期恢复。

### 🔒 认证并发安全与网络健壮性 (CR-03)
- **并发轮询指针碰撞修复**:
  - `src/auth/account-pool.ts`: 在异步 `getAccessToken` 之前同步原子递增 `this.currentIndex`，并发子代理调度平滑轮换无账号冲突。
- **Single-Flight 刷新并发去重**:
  - `src/auth/token-manager.ts`: 引入 `inFlightRefreshes` 缓存，并发请求共享同一刷新 Promise，彻底杜绝 Azure AD Refresh Token 轮转作废 (`invalid_grant`)。
- **异常断连状态透传**:
  - `src/transport/chathub-client.ts`: 1006 / 1008 断开且未接收完整数据时坚决调用 `settleReject` 并触发 `onRateLimitDetected`，杜绝伪装空成功导致上游容灾失效。

### ⚖️ 治理宪章对齐与中立性复归 (CR-02)
- **清除业务特化补丁**:
  - 彻底切除 `orchestrator.ts` 中针对 `.NET SDK/dotnet/winget/[System.IO.Path]` 的专用正则匹配与故障判断。
- **摒弃负面禁止词**:
  - 删除“切勿盲目重复调用 winget”；
  - `PromptBuilder.PROTOCOL_REMINDER` 中的“严禁输出工具块”重构为建设性正向指引：“若全部步骤已完成且无需后续动作，请直接输出任务交付总结”。
- **拒答哨兵保护**:
  - `src/agent/refusal-guard.ts`: 净化过于宽泛的规则，避免代码审计与技术分析被误判为沙箱拒答；拒答切号不再误调 `markThrottled` 错封正常账号。

### 🛠️ 协议解析与上下文坚固化 (CR-01)
- **嵌套代码块解析加固**:
  - `src/protocol/resilient-parser.ts`: 支持按层级匹配 Markdown 代码围栏，杜绝嵌套 ``` 代码提前截断丢失；
  - 局部编辑 `oldStrMatch`/`newStrMatch` 前瞻移除 `|path`，修复 `\npath:` 属性截断导致 Patch 失败的问题；
  - `ALL_TASKS_COMPLETED` 收紧为独立行首标记或标头，杜绝技术讨论正文误触发。
- **参数嗅探反模式消除**:
  - `src/protocol/prompt-builder.ts`: `buildTurn2TaskPrompt` 引入 `Turn2TaskPromptOptions` 强类型对象，彻底删除 `includes("Skill")` 模糊反推。
- **上下文失明与路径逃逸修复**:
  - `src/agent/orchestrator.ts`: 恢复 Sydney 默认云附件阈值为 120,000 字符与 3,000 行，消除工具输出被误清空；
  - `generateHandoffSnapshot` 中引入 `path.basename` 与字符清洗，杜绝文件名路径逃逸。

---
