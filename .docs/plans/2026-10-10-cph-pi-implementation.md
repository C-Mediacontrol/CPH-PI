# CPH-PI 实施计划 (Implementation Plan - 源码级二次开发路线)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 克隆官方完整开源项目 `earendil-works/pi` 到 `CPH-PI/pi/`，在真实、完整的 Pi 源码基座上进行二次开发与定制，将 Copilot M365 专有调度核（Turn 1 接地、两轮压实、RefusalGuard、7 账号透明轮转）与 Pi 的 TUI 和 4 大工业级工具深度融合。

**Architecture:**
1. **完整基座克隆**：保留官方 `earendil-works/pi` 完整 monorepo 源码于 `CPH-PI/pi/`；
2. **源码级注入**：在 Pi 的 agent/provider 与工具层直接植入 Copilot 原生适配，而不是外部拼凑；
3. **工具双向映射**：Copilot Action (`read_file`, `patch_file`/`edit`, `run_command`, `ask_question`) 与 Pi 原生核心工具类实现物理级对接。

**Tech Stack:** TypeScript, Node.js 22+ / Bun, `@earendil-works/pi` upstream monorepo, WebSocket (ws).

**Reference Spec:** [`CPH-PI/.docs/specs/2026-10-10-cph-pi-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-10-cph-pi-design.md)

---

## 任务拆解与执行顺序

### Task 1: 克隆官方 Pi 源码并验证基础构建 (Clone Upstream & Verify Build)

**Files:**
- Create / Clone: `CPH-PI/pi/` (from `https://github.com/earendil-works/pi.git`)
- Create: `CPH-PI/.gitignore`
- Test: upstream build & tests in `CPH-PI/pi/`

**Interfaces:**
- Consumes: `https://github.com/earendil-works/pi.git`
- Produces: 完整且可编译的 `CPH-PI/pi/` monorepo 环境

- [ ] **Step 1: 克隆官方源码仓库到 CPH-PI/pi**

Run: `git clone https://github.com/earendil-works/pi.git CPH-PI/pi`  
Expected: 成功克隆官方仓库

- [ ] **Step 2: 检查 Pi 依赖并安装/编译**

Run: `cd CPH-PI/pi; npm install (或 bun install)`  
Expected: 依赖安装完成，无破坏性报错

- [ ] **Step 3: 运行 Pi 官方现有测试集验证基座健康度**

Run: `npm test (或 bun test)` in `CPH-PI/pi`  
Expected: 官方单测通过

- [ ] **Step 4: 提交克隆与基线配置**

```bash
git add CPH-PI/.gitignore CPH-PI/pi
git commit -m "chore(pi): clone upstream earendil-works/pi as development foundation"
```

---

### Task 2: 源码架构剖析与注入锚点定位 (Architecture Inspection & Injection Mapping)

**Files:**
- Inspect: `CPH-PI/pi/packages/` 或 `CPH-PI/pi/src/` 中的 Agent Loop、Tools、TUI 入口
- Create: `CPH-PI/.docs/notes/pi-architecture-audit.md`

**Interfaces:**
- Consumes: `CPH-PI/pi` 源码
- Produces: 核心类接口签名映射表（确定 Pi Tool 调用方式与 Agent Loop 拦截点）

- [ ] **Step 1: 审查 Pi 的 4 大工具实现与参数类型**

定位 `read`, `write`, `edit`, `bash` 的确切文件与入参结构（如 `filePath`, `oldString`, `newString`, `offset`, `limit` 等）。

- [ ] **Step 2: 审查 Pi 的 Agent Loop 与 TUI 事件通道**

分析 Pi 如何消费 LLM 流式输出、如何挂载工具执行事件、如何触发 Diff 预览。

- [ ] **Step 3: 产出架构审计笔记并提交**

```bash
git add CPH-PI/.docs/notes/pi-architecture-audit.md
git commit -m "docs: audit pi internals and identify copilot injection points"
```

---

### Task 3: 编写 ToolBridge 与 Pi 原生工具双向映射 (ToolBridge Integration)

**Files:**
- Create: `CPH-PI/src/protocol/tool-bridge.ts`
- Test: `CPH-PI/tests/protocol/tool-bridge.test.ts`

**Interfaces:**
- Consumes: Copilot Action (`read_file`, `patch_file`, `write_file`, `run_command`, `ask_question`)
- Produces: 对 Pi 实际 Tool 实例的直接调用，带有 100 行切片限制、唯一性 Patch 校验、超限截断保护

- [ ] **Step 1: 编写对接 Pi 原生工具的 ToolBridge 单元测试**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现 ToolBridge 转换器与切片/补丁守卫**
- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: 提交代码**

---

### Task 4: 移植 M365 原生 ChatHub 传输与 7 账号透明调度池

**Files:**
- Create: `CPH-PI/src/transport/chathub-client.ts`
- Create: `CPH-PI/src/transport/substrate-uploader.ts`
- Create: `CPH-PI/src/auth/account-pool.ts`
- Test: `CPH-PI/tests/auth/account-pool.test.ts`

**Interfaces:**
- Consumes: M365 凭证与 WebSocket 握手
- Produces: `ChatHubClient`, `AccountPool`（支持 429 频控感知、账号无感接力轮转）

- [ ] **Step 1: 编写 7 账号调度池单测**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 移植并适配 ChatHubClient 与 AccountPool**
- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: 提交代码**

---

### Task 5: 植入 Copilot 状态机核 (Turn 1 接地、两轮压实、RefusalGuard)

**Files:**
- Create: `CPH-PI/src/agent/orchestrator.ts`
- Create: `CPH-PI/src/agent/compaction.ts`
- Create: `CPH-PI/src/agent/refusal-guard.ts`
- Test: `CPH-PI/tests/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes: M365 流式响应与 ToolBridge
- Produces: Ephemeral Worker 状态机循环（接管 Pi 原生 Agent 循环）

- [ ] **Step 1: 编写 Orchestrator 闭环单测**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现两轮滑动压实与 RefusalGuard 自纠机制**
- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: 提交代码**

---

### Task 6: 接入 Pi TUI 终端渲染与两段式安全中断

**Files:**
- Create / Modify: `CPH-PI/src/cli.ts` (或改造 `CPH-PI/pi` 源码主入口)
- Create: `CPH-PI/src/agent/interrupt.ts`
- Test: `CPH-PI/tests/e2e/interrupt.test.ts`

**Interfaces:**
- Consumes: Pi TUI 渲染管道
- Produces: 具有彩色 Markdown 流式输出、Diff 视窗与单次 Ctrl+C 安全中断的终端

- [ ] **Step 1: 编写两段式中断测试**
- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 桥接 TUI 差异化渲染并绑定中断控制器**
- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: 提交代码**

---

### Task 7: 快捷启动脚本与全链路冒烟测试

**Files:**
- Create: `CPH-PI/cph-pi.bat`
- Create: `CPH-PI/cph-pi.ps1`
- Create: `CPH-PI/README.md`
- Test: `CPH-PI/tests/e2e/smoke.test.ts`

- [ ] **Step 1: 编写快捷启动脚本**
- [ ] **Step 2: 运行全量测试套件验证全绿**
- [ ] **Step 3: 编写 CPH-PI 专属 README.md 说明文档**
- [ ] **Step 4: 最终提交与交付**
