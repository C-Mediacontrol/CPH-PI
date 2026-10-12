# Harness 物理立桩账本与 Stage Barrier 阶段调度实施计划
(Harness Physical Ledger & Stage Barrier Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Harness 层零 Token 预写日志物理账本（WAL）、传引用指纹挂载（Pass-by-Reference Mounting），以及子代理 Stage Barrier 阶段屏障并发调度与因果时序防护，彻底消除大文本倾倒与多任务并发时序反转缺陷。

**Architecture:** 
- **物理立桩层 (`src/session/ledger/`)**：`ExecutionLedger` 在工具回调处以 0 Token 开销追加写 `.cph/state/execution-ledger.jsonl` 并生成 Markdown 投影 `.md`，生成 ≤ 150 Tokens 的挂载指纹；
- **调度屏障层 (`src/agent/subagent-runner.ts`)**：支持 `stage?: number`，按 stage 升序分批执行，只有 Stage $K$ 全部成功后才放行 Stage $K+1$，并在前置阶段失败时自动熔断；
- **提示词与技能契约 (`skills/subagent/SKILL.md`, `cph-main-agent-prompt.txt`)**：增加 Gate 5 阶段屏障门禁，正向引导跨角色信息依赖分轮次推进、执行依赖分 Stage。

**Tech Stack:** TypeScript, Node.js `fs` / Bun, Bun Test.

## Global Constraints
- 必须保持既有 476 个单元测试 100% 绿灯通过，无回归破坏；
- 严禁在工作区根目录写入任何非规范文件，所有物理状态归档至 `.cph/state/`；
- 挂载指纹 Token 开销严格锁定在 150 Tokens 以内；
- 账本写入失败仅发出非致命警告，绝不中断主业务工具执行。

---

## 冲击面扫描 (Impact Matrix)

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 风险等级与应对 |
|---|---|---|---|
| **工具桥接协议 (`SubagentTaskSpec`)** | `PromptBuilder` / `ToolBridge` 解析主控参数 | `SubagentRunner.executeBatch` 消费任务配置 | 🟡 中：增加可选 `stage?: number`，缺省防御回退为 1，完全向后兼容。 |
| **子代理并发池 (`SubagentRunner`)** | `ToolBridge` 传入任务数组 | `cli.ts` / `Live Matrix Dashboard` 渲染与主控审阅 | 🔴 高：改造滑动窗口为分阶段屏障，需增加失败阶段熔断保护，防止任务雪崩。 |
| **物理立桩存储 (`ExecutionLedger`)** | `cli.ts` 工具执行拦截器调用 `recordStep` | 接力会话、主控快照 `formatSuccessorTurn1Prompt` | 🔴 高：必须使用原子追加写（`appendFileSync`），确保并发写不损坏 JSONL。 |
| **主控规划快照 (`main-plan-snapshot.ts`)** | `MainPlanSnapshot` 保存与加载 | `formatSuccessorTurn1Prompt` 生成首轮提示词 | 🟡 中：切除机械 raw text dump，替换为轻量指纹挂载，需更新测试用例。 |
| **系统提示词与 Skill** | `PromptBuilder` / `SkillLoader` 注入 | Main / Researcher / Coder 大模型认知 | 🟢 低：全面强化正向目标引导，消除负面词。 |

---

## 任务结构与依赖拓扑 (Task Breakdown)

```text
Task 1: 物理账本核心实现 (ExecutionLedger & LedgerEntry)
  │
  ├──> Task 2: 工具管道透明立桩埋点与快照指纹重构 (cli.ts & main-plan-snapshot.ts)
  │
Task 3: Stage Barrier 阶段屏障并发调度与熔断 (subagent-runner.ts)
  │
Task 4: 系统提示词与 Subagent Skill Gate 5 门禁固化
  │
Task 5: 全量回归测试与端到端集成验证 (bun test)
```

---

### Task 1: 物理账本核心数据模型与写入器 (ExecutionLedger)

**Files:**
- Create: `src/session/ledger/ledger-entry.ts`
- Create: `src/session/ledger/execution-ledger.ts`
- Test: `tests/session/execution-ledger.test.ts`

**Interfaces:**
- Consumes: Node.js `fs`, `path`
- Produces:
  ```typescript
  export interface LedgerEntry {
    stepIndex: number;
    timestamp: number;
    role: 'main' | 'researcher' | 'coder';
    sessionId: string;
    tool: string;
    target: string;
    status: 'SUCCESS' | 'FAILURE';
    modifiedFiles?: string[];
    statusBadge?: string;
    briefSummary: string;
  }
  export class ExecutionLedger {
    constructor(workspaceRoot: string);
    recordStep(entry: Omit<LedgerEntry, 'stepIndex' | 'timestamp'>): LedgerEntry;
    formatMountHeader(): string;
    getLatestEntries(limit?: number): LedgerEntry[];
    getPaths(): { jsonlPath: string; mdPath: string };
  }
  ```

- [x] **Step 1: 编写失败的单元测试 (`tests/session/execution-ledger.test.ts`)**
  覆盖：追加写 JSONL、增量更新 Markdown 表格视图、格式化挂载头（验证 Token/字符长度 < 150 tokens）、非法路径容错。

- [x] **Step 2: 运行测试验证失败**
  运行：`bun test tests/session/execution-ledger.test.ts`
  期望：FAIL with "Cannot find module ExecutionLedger"

- [x] **Step 3: 实现 `ledger-entry.ts` 与 `execution-ledger.ts`**
  实现原子追加写、单行 JSON 序列化、Markdown 表格增量格式化与 ≤ 150 Tokens 的挂载指纹生成器。

- [x] **Step 4: 运行测试验证绿灯**
  运行：`bun test tests/session/execution-ledger.test.ts`
  期望：PASS

- [x] **Step 5: 提交代码**
  ```bash
  git add src/session/ledger/ tests/session/execution-ledger.test.ts
  git commit -m "feat(ledger): implement ExecutionLedger with append-only WAL and mount header"
  ```

---

### Task 2: 工具管道无感立桩埋点与主控快照指纹重构

**Files:**
- Modify: `src/cli.ts:400-500` (或工具执行分发处)
- Modify: `src/session/main-plan-snapshot.ts:95-117`
- Test: `tests/session/main-plan-snapshot.test.ts`

**Interfaces:**
- Consumes: `ExecutionLedger` from Task 1
- Produces: `formatSuccessorTurn1Prompt` 采用挂载指纹而非大文本拼接

- [x] **Step 1: 编写测试断言 `formatSuccessorTurn1Prompt` 输出结构精简**
  在 `tests/session/main-plan-snapshot.test.ts` 中验证首轮 Prompt 包含账本挂载路径指针，且长度大幅压缩（无冗余 dump）。

- [x] **Step 2: 运行测试验证现有行为或调整**
  运行：`bun test tests/session/main-plan-snapshot.test.ts`

- [x] **Step 3: 改造 `main-plan-snapshot.ts` 与 `cli.ts` 拦截点**
  - 在 `src/cli.ts`（或 `CommandDispatcher`）的工具执行回调处实例化/注入 `ExecutionLedger`，每次工具返回结果时同步记录；
  - 改造 `formatSuccessorTurn1Prompt`，剔除原有的 raw `reportsSummary` 倾倒，接入挂载指纹与按需查阅引导。

- [x] **Step 4: 运行测试验证绿灯**
  运行：`bun test tests/session/main-plan-snapshot.test.ts`
  期望：PASS

- [x] **Step 5: 提交代码**
  ```bash
  git add src/session/main-plan-snapshot.ts src/cli.ts tests/session/main-plan-snapshot.test.ts
  git commit -m "refactor(snapshot): replace raw report dump with pass-by-reference ledger mount"
  ```

---

### Task 3: Stage Barrier 阶段屏障并发调度与熔断保护

**Files:**
- Modify: `src/protocol/tool-bridge.ts:38-44`
- Modify: `src/agent/subagent-runner.ts:118-160`
- Test: `tests/agent/subagent-stage-barrier.test.ts` (新建)

**Interfaces:**
- Consumes: `SubagentTaskSpec.stage?: number`
- Produces: `SubagentRunner.executeBatch` 保证 Stage 升序串行、Stage 内并发滑窗、前置失败自动熔断后续 Stage

- [x] **Step 1: 编写 Stage Barrier 单元测试 (`tests/agent/subagent-stage-barrier.test.ts`)**
  覆盖：
  1. `stage: 1` 与 `stage: 2` 混合时，Stage 1 的 2 个任务与 Stage 2 的 1 个任务严格按阶段执行（即便 Stage 1 某个任务提前结束，Stage 2 也不抢占执行）；
  2. 若 Stage 1 中出现失败，Stage 2 任务被自动熔断标记为 `CANCELLED_DUE_TO_STAGE_FAILURE`；
  3. 未传 `stage` 字段时自动归一化为 `stage: 1`，向后兼容。

- [x] **Step 2: 运行测试验证失败**
  运行：`bun test tests/agent/subagent-stage-barrier.test.ts`
  期望：FAIL with stage ordering violations

- [x] **Step 3: 实现 `SubagentTaskSpec.stage` 字段与 `SubagentRunner` 阶段屏障算法**
  - 在 `tool-bridge.ts` 中向 `SubagentTaskSpec` 增加 `stage?: number`；
  - 在 `subagent-runner.ts` 的 `executeBatch` 中，先按 `stage` 归一化升序分组为 `Map<number, SubagentTaskSpec[]>`；
  - 遍历阶段批次：对每个阶段执行并发滑动窗口；若该阶段有失败任务，后续阶段直接熔断并记录断点报告。

- [x] **Step 4: 运行测试验证绿灯**
  运行：`bun test tests/agent/subagent-stage-barrier.test.ts`
  期望：PASS

- [x] **Step 5: 提交代码**
  ```bash
  git add src/protocol/tool-bridge.ts src/agent/subagent-runner.ts tests/agent/subagent-stage-barrier.test.ts
  git commit -m "feat(subagent): implement Stage Barrier concurrent execution and circuit breaker"
  ```

---

### Task 4: 提示词与 Subagent Skill 的 Gate 5 门禁固化

**Files:**
- Modify: `skills/subagent/SKILL.md:25-75, 140-165`
- Modify: `cph-main-agent-prompt.txt:12-21`
- Test: `tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: 阶段屏障契约与信息依赖分阶段规则
- Produces: 完备的正向指引，模型在调度时自发遵循因果隔离

- [x] **Step 1: 在 `tests/skills/tri-agent-prompts.test.ts` 补充 Gate 5 与 stage 字段断言**
  验证 Prompt 和 Skill 文件包含 Gate 5 阶段屏障与分轮次要求。

- [x] **Step 2: 更新 `skills/subagent/SKILL.md` 与 `cph-main-agent-prompt.txt`**
  - 在 `skills/subagent/SKILL.md` 派发前置门禁中增加 【Gate 5: 因果依赖与阶段屏障门禁 (Causality & Stage Barrier Gate)】；
  - 明确规则：跨角色信息依赖（调研 ➔ 编码）必须分轮次等待回传；同批次任务若有执行先后顺序，显式声明 `stage: 1` 和 `stage: 2`；
  - 在调用示例中补充 `stage: 1` 与 `stage: 2` 范例；
  - 在 `cph-main-agent-prompt.txt` 第 7 条中明确阶段调度规则。

- [x] **Step 3: 运行测试验证绿灯**
  运行：`bun test tests/skills/tri-agent-prompts.test.ts`
  期望：PASS

- [x] **Step 4: 提交代码**
  ```bash
  git add skills/subagent/SKILL.md cph-main-agent-prompt.txt tests/skills/tri-agent-prompts.test.ts
  git commit -m "docs(prompts): add Gate 5 causality isolation and Stage Barrier contract"
  ```


---

### Task 5: 全量回归测试与端到端闭环验证

**Files:**
- Test: 全量 `tests/` 目录

- [x] **Step 1: 运行全量测试套件**
  运行：`bun test`
  期望：476+ 个测试全部通过（0 fail） -> 实测：485 pass, 0 fail (65 files)

- [x] **Step 2: 验证打包构建产物**
  运行：`bun run package`
  验证 `dist/` 下打包出的系统提示词和 Skill 均包含最新的 Stage Barrier 与物理账本规范。

- [x] **Step 3: 最终 Git 状态审计与提交**
  确保工作树保持干净，无遗留未跟踪垃圾文件。

