# 斥候领航与蜂群攻坚双轨调度及受控 Plan 调整实施计划
(Two-Stage Scout & Swarm Protocol with Controlled Plan Refinement Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现单文件斥候（Scout）内联等待调度、首轮全量附件自动挂载、主控 Plan 范围守恒律（只拆不增）与全量附件优先提示词升级，彻底消除子代理 40 行分块空转与 Runaway Handoff。

**Architecture:** 
1. 调度核（`orchestrator.ts`）增加双轨判定：单个轻量调研任务走内联等待轨（主控保持在线，从账号池借调独立账号），多任务/编码任务走虚拟化归档轨；
2. 子任务执行器（`subagent-runner.ts`）在单文件任务开局自动将目标文件预上传为云端附件，通过 `initialAnnotations` 直传首轮；
3. 系统提示词与工作区专属技能（`cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`skills/subagent/SKILL.md`）全面注入两阶段领航工单模板、范围守恒律与全量附件通读规范。

**Tech Stack:** TypeScript, Bun, Microsoft Graph/Substrate REST API, ChatHub SignalR WebSocket, Pi Engine.

**Reference Design:** [`CPH-PI/.docs/specs/2026-10-18-scout-swarm-and-plan-refinement-design.md`](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-18-scout-swarm-and-plan-refinement-design.md)

## Global Constraints
- `AGENTS.md` Rule 1: 所有代码与文档必须存放在二级子目录（`CPH-PI/`）内；
- `AGENTS.md` Rule 3: 提示词与技能中全面使用正向引导，杜绝使用负面禁止词；
- `AGENTS.md` Rule 5: 严格在工作区内部定制与打包，严禁修改宿主全局技能；
- `AGENTS.md` Rule 7 & 9: 成果传引用落盘（TOC），100% 全量云端附件投递；
- 保持 622+ 个既有单元与集成测试 100% 绿灯。

---

## 冲击面扫描 (Impact Surface Scan)

| 制品类型 | 生产方 (Upstream) | 消费方 (Downstream) | 潜在冲击与防护 |
|---|---|---|---|
| **调度函数** | `orchestrator.ts` (invoke_subagent) | 主会话轮次生命周期 | 内联等待模式下不能生成 Gen 2，且必须安全释放借调账号；Swarm 模式继续虚拟化 |
| **账号池** | `account-pool.ts` (lease/release) | `subagent-runner.ts` & `orchestrator.ts` | 内联 Scout 必须租借非当前主控账号的 Token，任务结束后必须即刻归还租约 |
| **附件上传** | `subagent-runner.ts` (SubstrateUploader) | 子代理第一轮 `sendMessage` | 目标文件若不存在或读取失败时需降级优雅容错，不阻断子代理启动 |
| **系统提示词** | `cph-main-agent-prompt.txt` | M365 Copilot Agent (云端) | 引导正向动作，消除禁止词，保证 M365 审查与模型认知纯粹 |
| **工作区技能** | `skills/subagent/SKILL.md` | 主控 Agent 内部技能 | 增加 Scout 工单模板与 Plan 守恒律，保持与云端提示词的一致性 |

---

## Agent-Friendly 切片与文件映射

- **Task 1**: `src/agent/orchestrator.ts` & `tests/agent/orchestrator.test.ts` (内联等待与账号隔离)
- **Task 2**: `src/agent/subagent-runner.ts` & `tests/agent/subagent-runner.test.ts` (开局目标文件全量附件挂载)
- **Task 3**: `cph-main-agent-prompt.txt` & `cph-researcher-agent-prompt.txt` & `tests/skills/tri-agent-prompts.test.ts` (系统提示词升级)
- **Task 4**: `skills/subagent/SKILL.md` (工作区专属技能升级)
- **Task 5**: 全量测试回归与分发包打包 (`bun test tests/`, `bun run build:package`, `bun run package`)

---

## 实施步骤 (Task Breakdown)

### Task 1: 调度核支持 Scout 内联等待模式 (Inline Wait Mode) 与账号物理隔离

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Test: `CPH-PI/tests/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes: `AccountPool.getNextAvailableToken`, `SubagentRunner.executeBatch`
- Produces: `isInlineScoutTask(subagents: any[]): boolean`

- [ ] **Step 1: 编写内联模式失败测试用例**

在 `tests/agent/orchestrator.test.ts` 中添加测试：
当 `subagents.length === 1 && subagents[0].role === 'researcher' && subagents[0].isScout === true`（或描述包含大纲/斥候/scout）时，验证主控不触发 `onMainSessionVirtualized`，会话代次保持为当前代次（不自增 `generation`），且子代理完成后直接作为 tool call 的输出回传。

- [ ] **Step 2: 运行测试确认红灯**

运行命令:
```bash
bun test tests/agent/orchestrator.test.ts
```
预期: 失败（当前无内联等待分支，默认全量虚拟化）。

- [ ] **Step 3: 实现 Orchestrator 内联等待分支**

在 `src/agent/orchestrator.ts` 中：
1. 增加判定辅助函数 `isInlineScoutTask(subagents)`：
   - 条件：`subagents.length === 1`，角色为 `researcher` 或 `searcher`，且其 `description` 或 `prompt` 明确标记为架构探查/大纲梳理/scout/斥候。
2. 在 `parsed.action.tool === "invoke_subagent"` 中：
   - 若命中 `isInlineScoutTask`：
     - 跳过 `createMainPlanSnapshot` 和 `events?.onMainSessionVirtualized`；
     - 主控保持当前客户端连接活跃；
     - 启动 `SubagentRunner.executeBatch`，由 runner 租借非当前主控账号的独立 Token 执行；
     - 执行完毕后，格式化简报作为 `toolResult`，**不**递增 `this.generation`，**不**更新 `this.sessionId` 为 `_gen2`；
     - 主会话直接进入下一轮（Turn 3），直接在同会话中消费 Scout 大纲。
   - 若不命中（批量攻坚或含 Coder）：
     - 维持既有的虚拟化归档与代际交接逻辑不变。

- [ ] **Step 4: 运行测试确认绿灯**

运行命令:
```bash
bun test tests/agent/orchestrator.test.ts
```
预期: PASS。

- [ ] **Step 5: Git 提交**

```bash
git add src/agent/orchestrator.ts tests/agent/orchestrator.test.ts
git commit -m "feat(orchestrator): add inline wait mode for single scout researcher tasks"
```

---

### Task 2: SubagentRunner 支持单文件任务“开局全量附件自动挂载”

**Files:**
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Test: `CPH-PI/tests/agent/subagent-runner.test.ts`

**Interfaces:**
- Consumes: `SubstrateUploader.uploadSourceFile`
- Produces: `extractTargetFilePath(prompt: string): string | null`, 自动注入 `initialAnnotations` 到子会话

- [ ] **Step 1: 编写开局附件注入失败测试用例**

在 `tests/agent/subagent-runner.test.ts` 中添加测试：
当派发单文件子任务且提示词中声明目标文件路径时，验证 `SubagentRunner` 在调用 `orchestrator.run` 时传入了包含该文件 OneDrive 信息的 `initialAnnotations`。

- [ ] **Step 2: 运行测试确认红灯**

运行命令:
```bash
bun test tests/agent/subagent-runner.test.ts
```
预期: 失败（当前未提取目标文件预传附件）。

- [ ] **Step 3: 实现目标文件提取与自动挂载逻辑**

在 `src/agent/subagent-runner.ts` 中：
1. 增加路径探测辅助函数 `extractTargetFilePath(taskSpec: SubagentTaskSpec, workspaceRoot: string): string | null`；
2. 在 `runSingleSubagent` 启动前：
   - 若探测到有效的目标源文件且文件存在：
     - 调用 `SubstrateUploader.uploadSourceFile` 将该文件上传至 OneDrive；
     - 构造对应的 `AttachmentAnnotation` 对象并放入 `initialAnnotations`；
   - 将 `initialAnnotations` 传入 `orchestrator.run({ task: currentTaskPrompt, initialAnnotations, ... })`；
   - 在日志中记录 `☁️ [开局附件已直传挂载] <文件路径>`。

- [ ] **Step 4: 运行测试确认绿灯**

运行命令:
```bash
bun test tests/agent/subagent-runner.test.ts
```
预期: PASS。

- [ ] **Step 5: Git 提交**

```bash
git add src/agent/subagent-runner.ts tests/agent/subagent-runner.test.ts
git commit -m "feat(subagent-runner): automatically upload and mount target file as initial attachment"
```

---

### Task 3: 系统提示词升级（主控 Scout 领航与 Plan 守恒律，Researcher 附件优先）

**Files:**
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-researcher-agent-prompt.txt`
- Test: `CPH-PI/tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: `AGENTS.md` 纯粹正向引导规则
- Produces: 更新后的 `cph-main-agent-prompt.txt`, `cph-researcher-agent-prompt.txt`

- [ ] **Step 1: 检查既有提示词测试基线**

运行命令:
```bash
bun test tests/skills/tri-agent-prompts.test.ts
```

- [ ] **Step 2: 更新 `cph-main-agent-prompt.txt`**
1. 注入**两阶段斥候领航（Two-Stage Scout & Swarm）工作法**：
   - 面对未知大文件时，优先派发单个 Researcher 斥候（内联等待），在 Turn 3 获取结构化大纲后再立桩精细的 `plan.md`；
2. 注入**Plan 调整规范与范围守恒律（Conservation of Scope）**：
   - 允许后继主控对部分成功（Partial Success）的大任务进行纵向切片与定向补缺；
   - 恪守战役目标范围守恒，严禁横向发散新增无关顶层任务；
3. 升级**子任务切片物理指标**：单任务关注点聚焦于 ≤300 行代码或单一逻辑子系统。

- [ ] **Step 3: 更新 `cph-researcher-agent-prompt.txt`**
1. 强化**全量附件直通与宏观语义块审阅心智**：
   - 明确指出工作区与源文件均已通过附件完整提供，直接通读并定位函数定义与数据流，摒弃通过命令分块切片读取文件的做法；
2. 强化**单 Hop 闭环交付心智**：
   - 证据闭环后立即输出 `FINAL_ANSWER` 结题，以原生单会话交付为主导。

- [ ] **Step 4: 运行提示词合规性与无负面词校验测试**

运行命令:
```bash
bun test tests/skills/tri-agent-prompts.test.ts
```
预期: PASS（100% 正向引导，无负面词，各三元组职责清晰）。

- [ ] **Step 5: Git 提交**

```bash
git add cph-main-agent-prompt.txt cph-researcher-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts
git commit -m "docs(prompts): update main and researcher prompts with scout protocol and scope conservation"
```

---

### Task 4: 工作区专属技能升级 (`skills/subagent/SKILL.md`)

**Files:**
- Modify: `CPH-PI/skills/subagent/SKILL.md`

**Interfaces:**
- Produces: 规范化的 Scout 斥候工单模板与双轨调度门禁指南

- [ ] **Step 1: 升级 `skills/subagent/SKILL.md` 核心内容**
1. 增加 **Scout 斥候模式工单标准模板**（说明其内联等待机制、首轮附件挂载与大纲输出要求）；
2. 明确 **双轨调度门禁 (Dual-Track Scheduling Gate)**（单 Scout 内联等待 vs 批量 Swarm 虚拟化归档）；
3. 增加 **后继主控 Plan 范围守恒律与 Partial Success 纵向切片指引**。

- [ ] **Step 2: 校验技能内容符合正向引导**

检查是否有违背正向引导规范的词汇，确保语言积极专业。

- [ ] **Step 3: Git 提交**

```bash
git add skills/subagent/SKILL.md
git commit -m "docs(skills): update subagent skill with scout template and dual-track scheduling rules"
```

---

### Task 5: 全量回归测试与分发包打包校验

**Files:**
- Verify: 全部 86 个测试套件
- Build: `dist/copilot-agent-bundle.zip`

- [ ] **Step 1: 运行全量测试套件**

运行命令:
```bash
bun test tests/
```
预期: 622+ 个测试 100% PASS。

- [ ] **Step 2: 重新构建与打包 Agent 分发包**

运行命令:
```bash
bun run build:package
bun run package
```
预期: 生成更新后的 `dist/copilot-agent-bundle.zip` 及 `dist/copilot-agent-bundle/` 解压目录。

- [ ] **Step 3: 检查打包产物完整性**

核对 `dist/copilot-agent-bundle/` 下的 `cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`skills/subagent/SKILL.md` 与工作区完全一致。

- [ ] **Step 4: Git 提交**

```bash
git add .
git commit -m "chore: verify tests and rebuild distribution bundle"
```

---

## 自检检查单 (Self-Review Checklist)
- [x] **Spec 覆盖度**: 完整覆盖了 Design Spec 中的双轨调度、首轮附件直传、Plan 范围守恒律与附件通读心智；
- [x] **无占位符**: 所有步骤均有具体的函数名、判定逻辑与运行命令，无 TBD/TODO；
- [x] **类型一致性**: `isInlineScoutTask`、`initialAnnotations` 与 `AttachmentAnnotation` 类型接口前后对应；
- [x] **Agent-Friendly 切片**: 任务按底层调度（Task 1）、执行器（Task 2）、提示词（Task 3）、技能（Task 4）、打包（Task 5）分层正交拆分，利于单点突破。
