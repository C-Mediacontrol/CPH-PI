# CPH-PI 自适应流式保活与超时容灾自治接力架构设计 (Adaptive Streaming Keepalive & Disaster Recovery Design)

- **作者**: CPH-PI 核心架构组
- **状态**: 方案已批准 (Approved)
- **日期**: 2026-10-11
- **关联问题**: `E:\test\.cph\logs\cph-terminal-2026-10-11T13-58-55.log` (Turn 23 超时导致任务丢弃)

---

## 1. 背景与问题诊断 (Context & Problem Statement)

### 1.1 现状与故障案发现场
在代码审查长任务（`ses_20261011_2158_mkkv`，执行至 Turn 23）中，模型正在分析并流式输出 `run_command` 操作，终端突然报错退出：
```text
❌ 出错: ChatHub request timed out after 120s without completion
```
随后整个任务中断，进程退回交互提示符 `cph-pi>`，任务停滞。

### 1.2 根因定位 (Root Cause Analysis)
经过对源码的深度审计，发现两个关键架构缺陷：

1. **传输层：绝对墙钟硬超时 (Absolute Wall-Clock Timeout)**：
   - 在 [`src/transport/chathub-client.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/transport/chathub-client.ts#L26) 中，构造函数写死了 `timeoutMs: 120_000`；
   - 计时器从发起请求的那一刻起无情倒计时 120 秒，**完全不感知流式输出活跃度**；
   - GPT-6.1 Sol Reasoning 模型在长上下文下推理 40~60 秒，再开始流式输出 action 代码，导致单轮总耗时跨越 120 秒，哪怕 WebSocket 连接完全健康且正在持续流式吐字，也会被强行掐断。
2. **调度层：容灾范围狭隘，未覆盖超时与网络断连**：
   - 在 [`src/agent/orchestrator.ts`](file:///E:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L408) 中，现有的“三段式灾难恢复机制 (Disaster Recovery)”仅绑定了 `isRateLimitError`（429 频控）；
   - 一旦遇到超时或传输层断连，Orchestrator 直接 `throw err`，CLI 捕获后仅打印红字报错并退出执行，未能将断点黑匣子与阶段性草稿（`.cph/review_draft.md`）聚合成交接文档并唤起接力智能体。

---

## 2. 核心架构设计 (Architecture Design)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ChatHub Transport Layer                         │
│  [Activity Keepalive Watchdog] ─── (每收到数据帧重置 90s 空闲计时器)  │
│  [Max Turn Safety Deadline]    ─── (默认 600s 或由 CLI --timeout 配置) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 发生网络异常 / 超时 / 429
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Orchestrator Agent Layer                        │
│  [isRecoverableTransportError] ─── 统一捕获超时、断连、429              │
│  [Disaster Recovery Stage 1]   ─── 提取事故现场黑匣子 + review_draft.md│
│  [Disaster Recovery Stage 2]   ─── 自动生成交接文档并落盘              │
│  [Disaster Recovery Stage 3]   ─── 返回 handedOff: true, recovered: true│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            CLI Application                             │
│  [Autonomous Successor Agent]  ─── 零人工干预自动启动接力会话 (接力 1)  │
│  [Context Transfer]            ─── 注入黑匣子断点，从 Turn 23 继续推进 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 详细设计与模块职责 (Detailed Component Specifications)

### 3.1 传输层：双轨活跃保活机制 (`src/transport/chathub-client.ts`)

#### 1. 废除硬编码 120s，建立双轨计时器
- **流式活跃看门狗 (`idleTimeoutMs`, 默认 90 秒)**：
  - 仅用于检测**静默挂死**；
  - 每当 WebSocket 收到任意消息、SignalR 心跳、握手帧、或在 `onDelta` 分发 `reasoning` / `text` 时，立即重置看门狗：
    ```ts
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (isSettled) return;
      idleTimer = setTimeout(() => {
        settleReject(new Error(`ChatHub connection idle timeout: no data received from server for ${Math.round(idleTimeoutMs / 1000)}s`));
      }, idleTimeoutMs);
    };
    ```
- **单轮绝对兜底上限 (`timeoutMs`, 默认提升至 600 秒 / 10 分钟)**：
  - 防止极端服务端死循环流式空包；
  - 允许通过构造函数参数 `options.timeoutMs` 自由注入覆盖。

#### 2. 配置项扩充
```ts
export interface ChatHubOptions {
  modelTone?: string;
  scenario?: string;
  licenseType?: string;
  agentHost?: string;
  locale?: string;
  timeZone?: string;
  timeoutMs?: number;        // 单轮总兜底超时（默认 600_000ms）
  idleTimeoutMs?: number;    // 静默无数据流超时（默认 90_000ms）
  customAgentId?: string;
  wsBaseUrl?: string;
}
```

---

### 3.2 调度层：统一可恢复传输灾难感知 (`src/agent/orchestrator.ts`)

#### 1. 扩展可恢复异常判定方法 (`isRecoverableTransportError`)
替代原有的单一 `isRateLimitError`：
```ts
public isRecoverableTransportError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err || "").toLowerCase();
  
  // 1. 429 频控类
  const isRateLimit = msg.includes("429") || msg.includes("throttled") || msg.includes("rate limit") || msg.includes("quota") || msg.includes("exceeded") || msg.includes("too many requests");
  
  // 2. 超时类
  const isTimeout = msg.includes("timed out") || msg.includes("timeout") || msg.includes("idle timeout");
  
  // 3. 网络与套接字中断类
  const isNetBreak = msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("epipe") || msg.includes("closed before") || msg.includes("premature close") || msg.includes("socket hang up");

  return isRateLimit || isTimeout || isNetBreak;
}
```

#### 2. 灾难发生时的自动三段式容灾流转
在 `orchestrator.run` 的 `catch (err)` 块中：
```ts
if (this.isRecoverableTransportError(err)) {
  return await this.executeDisasterRecoveryArbitration({
    task,
    history,
    client,
    lastError: String(err?.message || err),
    signal,
    events,
    sessionId,
    arbitratorChatClient: options.arbitratorChatClient,
    partialReasoning: turnReasoningText,
    partialResponse: turnResponseText,
  });
}
```
- 自动提取当前崩溃轮次未完成的部分输出；
- 聚合工作区 `.cph/review_draft.md`；
- 生成高保真接力交接文档落盘到 `.cph/handoffs/handoff-<sessionId>.md`；
- 返回 `{ handedOff: true, disasterRecovered: true, disasterBlackbox: ... }`。

---

### 3.3 交互层：CLI 参数与自治续跑 (`src/cli.ts`)

#### 1. 命令行参数支持 `--timeout <seconds>`
- 支持 `--timeout <n>` 或 `-t <n>`，单位为秒；
- 默认值为 600 秒（10 分钟）；
- 解析后传递至 `CopilotOrchestrator` 与 `ChatHubClient`。

#### 2. 无人值守接力执行
在 `cli.executeTask` 中：
- 当捕获到 `result.handedOff && result.disasterRecovered`：
  - 自动渲染灾难恢复接力 Banner；
  - 自动创建并切换至 `newSession`（如 `接力 1`）；
  - 自动将黑匣子成果注入新会话背景；
  - `while` 循环直接进入下一阶段 `continue`，**无需人工敲击键盘，任务自动继续跑完**。

---

## 4. 测试与验证计划 (TDD Verification)

1. **传输层保活与空闲超时测试** ([`tests/transport/activity-keepalive.test.ts`](file:///E:/copilot-web%20proxy/CPH-PI/tests/transport/activity-keepalive.test.ts))：
   - 验证持续收到 Delta 帧时，即使总时间超过 90 秒，连接依然保持活跃不超时；
   - 验证在静默无任何数据超过 `idleTimeoutMs` 时，精确触发空闲超时；
   - 验证默认超时参数为 600s，且支持自定义覆盖。
2. **调度层可恢复灾难判定与接力测试** ([`tests/agent/timeout-disaster-recovery.test.ts`](file:///E:/copilot-web%20proxy/CPH-PI/tests/agent/timeout-disaster-recovery.test.ts))：
   - 验证 `isRecoverableTransportError` 正确识别超时、429 与网络异常；
   - 验证当 `client.sendMessage` 抛出超时错误时，Orchestrator 自动触发灾难黑匣子快照并返回 `disasterRecovered: true`。
3. **CLI 参数解析与全量回归**：
   - 验证 `--timeout 300` 参数正常解析；
   - 运行全量测试套件，保证 0 破坏、0 回归。

