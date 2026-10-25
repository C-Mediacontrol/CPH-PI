# CPH-PI 子代理独立视窗、Debug 落盘与 Handoff 接力：核验修订版

> **原始文档**: [2026-10-22-deepseek-subagent-ui-and-handoff-continuity-design.md](./2026-10-22-deepseek-subagent-ui-and-handoff-continuity-design.md)
> **文档标识**: `CPH-PI-SPEC-2026-10-22-SUBAGENT-UI-HANDOFF-CONTINUITY-V2`
> **修订日期**: 2026-10-22
> **修订依据**: 对 CPH-PI 仓库逐条实测（`rpc-handler.ts`、`orchestrator.ts`、`subagent-runner.ts`、`session-manager.ts`、`lineage-tracker.ts`、`terminal-logger.ts`、`tui-renderer.ts`、`web/src/**`）
> **状态**: 【核验修订稿 / Evidence-Verified Draft】—— 可作实施依据，不可作验收依据

---

## 0. 修订说明

原文档（下称 v1）的**问题定位基本准确**：子代理事件确实未被 `RpcHandler` 接线，`ToolCard` 确实把 `invoke_subagent` 当普通工具渲染，Handoff 备忘确实没有进入 Web 侧下一轮 Prompt。这三条经实测成立，是本设计的真实价值所在。

但 v1 的**技术说明层**有 9 处与代码不符，**方案层**有 5 处引入了与既有架构冲突的重复建设。最关键的一点：v1 完全不知道 `TerminalLogger` 已经具备**按会话分目录 + 子代理独立日志流**的能力（`initSessionTree`），并且**已经被 orchestrator 和 subagent-runner 在调用**。v1 提出的扁平日志文件方案会与其并行分叉。

| # | v1 陈述 | 实测结果 | 严重度 |
|---|---|---|---|
| F1 | `onSubagentStart` 接线签名 `(subId, role, spec, account)` | 实际为 `(id, role, spec, hop?, account?)`，v1 省略 `hop` 导致参数错位 | 🔴 |
| F2 | `sessionManager.saveTurn(...)` | **该方法不存在**；SessionManager 只有 create/save/load/list | 🔴 |
| F3 | `RpcHandler.handleSessionSwitch` | **该方法不存在**；实际为 `handleSessionSelect` + `loadSessionTurns` | 🟠 |
| F4 | 子代理落盘 `.cph/sessions/subagent-<id>.json` | 会被 `rebuildIndex()` 吸收入主会话索引（扫描所有含 id+title 的 json） | 🔴 |
| F5 | 日志落盘 `.cph/logs/cph-web-<ts>.log` | 与既有 `.cph/logs/<sessionId>/{main,timeline,subagents/*}` 分叉 | 🟠 |
| F6 | "Web 事件未写入 `process.stdout`" | 实际写入 stdout，但 `reasoning:chunk` / `assistant:chunk` 被**显式过滤**（`rpc-handler.ts:299`） | 🟡 |
| F7 | `Turn` 状态含 `handed_off` | `Turn.status` 无此值；`SessionRecord.status` 才有 | 🟡 |
| F8 | 新增 `session:handoff` 事件 | `OrchestratorEvents.onSuccessorAwakened(newSessionId, generation)` **已存在**且正是该钩子 | 🟠 |
| F9 | 新增 `SubagentItemState` | `tui-renderer.ts:24` 已有 `SubagentLiveState`，字段高度重叠 | 🟠 |

**v1 判断正确并予以保留的部分**（无需重新验证）：

- `RpcHandler` 的 `orchestrator.run` 事件对象里确实没有 `onSubagentStart/End/Progress`。
- `ToolCard.tsx` 无 `invoke_subagent` 分支，回落为 `命令正在执行中...`。
- `TerminalLogger` 确实通过改写 `process.stdout.write` / `process.stderr.write` 落盘。
- Web 侧确实没有 `pendingHandoffSnapshot` 的接线。
- 会话 ID 的 `_genN` 后缀真实存在（`orchestrator.ts:949`）。
- `-d/--debug`、`npm run web:build` 均存在。
- `Library/deepseek-harness/` 基准参考真实存在。

---

## 1. 问题背景（去修辞版）

### 1.1 三个断层的精确表述

**断层一：子代理事件未接线（属实）**

`rpc-handler.ts:987-1110` 的 `orchestrator.run({ events })` 只提供了 `onDelta`、`onReasoning`、`onTurnStart`、`onAccountSwitched`、`onHandoff`、`onCompleted`、`onError`、`onAttachmentUploaded`。`OrchestratorEvents`（`orchestrator.ts:94-116`）中已定义的 `onSubagentStart`、`onSubagentEnd`、`onSubagentProgress` 全部缺席。

后果：`SubagentRunner.executeBatch` 的内部事件被 Orchestrator 接收后无处输出，前端只能看到一个笼统的工具执行态。

**断层二：Debug 落盘不完整（v1 的归因需修正）**

实测 `rpc-handler.ts:293-310`：

```ts
if (this.debug) {
  if (type === "terminal:chunk" && ...) {
    process.stdout.write(payload.content);          // 会落盘
  } else if (type !== "reasoning:chunk" && type !== "assistant:chunk") {
    process.stdout.write(`[time] [Web RPC ==> ${type}] ...`);  // 其余事件会落盘
  }
}
```

也就是说：Web 模式下 `debug` **并非完全失效**——`terminal:chunk`、`turn:end`、`accounts:update` 等都会经 stdout 被 `TerminalLogger` 捕获。真正缺失的是 **`reasoning:chunk` 与 `assistant:chunk` 被显式排除**，加上子代理事件根本没被接线（断层一的连带结果）。

v1 的表述「未写入 `process.stdout`」会误导实现者去新建一套旁路，而正确的修法是**删掉那个排除条件并补充子代理写入点**。

**断层三：Handoff 未跨代接线（属实，但钩子已存在）**

- `SessionRecord` 已含 `generation`、`handoffSnapshot`、`handoffDocPath`、`handoffCount`、`status: "handed_off"`（`session-manager.ts`）。
- `Orchestrator` 已含 `generation`、`maxGenerations=50`、`linkSuccessor()`、`getGeneration()`。
- `OrchestratorEvents.onSuccessorAwakened?(newSessionId, generation)` 已存在，但 `RpcHandler` **完全没有接管**。
- `SessionLineageTracker` 已提供 `linkSuccessor` / `linkSubagent` / `getGenerationInfo` / `resolveActiveHead`，Web 侧零使用。
- `pendingHandoffSnapshot` 机制**已存在**，但只活在 `cli.ts`（`getPendingHandoffSnapshot` / `setPendingHandoffSnapshot`，并在 `cli.ts:1255` 拼进 `【前序会话脱困成果快照】` 前缀）。

因此这一断层的正确描述是：**能力齐备，仅 Web 侧未接线**。v1 把它写成「机制缺失」，会导致重复实现。

### 1.2 目标（改为可验收表述）

| 编号 | 目标 | 验收锚点 |
|---|---|---|
| **A** | 子代理生命周期事件可被前端消费 | 三个事件在 `protocol.ts` 有类型，在 `rpc-handler` 有发送点，前端 store 有落点 |
| **B** | 子代理可按视角独立查看（中央聚焦 + 侧栏并排） | 两种模式互不干扰，切回主会话不丢流 |
| **C** | Web 模式 Debug 覆盖 CoT / 输出 / 子代理 / 工具 / Handoff | 与既有 `TerminalLogger` 目录结构兼容，不新建平行体系 |
| **D** | Handoff 后代际无缝续接 | 新一轮 Prompt 携带前序快照，`generation` 与 lineage 同步 |

### 1.3 明确不在本版范围

- DeepSeek-Harness 的视觉还原度（微光扫光动画等）作为**可选增强**，不列入验收门槛。
- 子代理会话的正向分叉（在子代理视图里继续对话）。本版只读。
- 跨工作区的会话迁移。

---

## 2. 现状盘点（v1 缺失，排期唯一依据）

### 2.1 已存在、必须复用

| 能力 | 位置 | 说明 |
|---|---|---|
| 子代理事件签名 | `subagent-runner.ts:212-216` | `onSubagentStart(id, role, spec, hop?, account?)`、`onSubagentEnd(report)`、`onSubagentProgress(id, turn, delta?, action?, hopCount?, account?)` |
| 子代理报告结构 | `subagent-runner.ts:158-172` | `SubagentTaskReport` 含 `targetSessionId`、`hopCount`、`deliverablePath` |
| 分阶段并发调度 | `subagent-runner.ts:209-250` | 并发度 = 可用账号池容量；按 `stage` 升序分批；含 `circuitBreakerTriggered` |
| 子代理日志树 | `terminal-logger.ts:56-89` `initSessionTree` | 产出 `.cph/logs/<sid>/main.log`、`timeline.jsonl`、`subagents/<id>-<role>.log` |
| 日志树已在用 | `orchestrator.ts:922`、`subagent-runner.ts:197` | 非空设计，已在生产路径调用 |
| 子代理成果报告落盘 | `subagent-runner.ts:770` | `.cph/reports/report-<role>-<id>.md` |
| TUI 子代理状态模型 | `tui-renderer.ts:24-37` `SubagentLiveState` | 字段：id/role/account/description/status/currentTurn/durationMs/lastAction/hopCount/handoffCount |
| 代际与谱系 | `orchestrator.ts:206/949`、`lineage-tracker.ts` | `_genN` 命名、`linkSuccessor`、`getGenerationInfo` |
| Web debug 开关通路 | `rpc-handler.ts:133/192`、`cli.ts:1713` | `debug` 与 `debugLogPath` 已注入 |
| Web 会话加载 | `rpc-handler.ts:488` `loadSessionTurns` | 已能从物理 JSON 还原 Turn |
| 会话持久化布局 | `.cph/sessions/<sessionId>.json` + `index.json` | 含自愈 `rebuildIndex()` |
| 会话快照下发 | `rpc-handler.ts:565` `session:snapshot` | 已存在 |
| WS 重连退避 | `client-ws.ts:6-7/86` | 已有 `backoffMs` 与 `scheduleReconnect` |

### 2.2 已存在、但 v1 误判为缺失

| v1 认为缺失 | 实际 |
|---|---|
| Handoff 备忘注入机制 | `cli.ts` 已实现（`pendingHandoffSnapshot` + 前缀注入） |
| 代际接力事件 | `onSuccessorAwakened` 已定义，只是未接线 |
| 子代理独立日志 | `initSessionTree` 已实现并在用 |
| 子代理状态模型 | `SubagentLiveState` 已存在 |
| Debug 落盘通路 | `send()` 已写 stdout（仅排除两类 chunk） |

### 2.3 确实缺失（需本版实现）

- `RpcHandler` 对三个子代理事件的接线与前端派发
- 前端 `subagent:*` 协议类型与 store 状态
- Web 侧 Handoff 记忆接力（复用 CLI 的 `pendingHandoffSnapshot` 同名机制）
- Web 侧 `/debug` 指令（**注意与技能选择器冲突，见 §5.2**）
- `RightbarTab` 扩展与 `SubagentInspector` 面板
- Turn 级持久化（`RpcHandler` 当前**从不调用** `saveSession`，Turn 只活在内存）

---

## 3. 协议定义（修正后）

### 3.1 事件签名必须与后端一致

v1 的 `onSubagentStart(subId, role, spec, account)` 少了第 4 个参数 `hop`。直接照此接线会把 `hop`（number）当作 `account`（string）传下去，产生静默错位。

正确映射：

```ts
onSubagentStart: (id, role, spec, hop, account) => {
  this.send("subagent:start", {
    toolId: this.activeToolIdForSubagent,   // 见 §3.3：需额外维护
    subagentId: id,
    role: role as "researcher" | "coder",
    spec,
    hopCount: hop ?? 0,
    account,
  });
},

onSubagentProgress: (id, turn, delta, action, hopCount, account) => {
  this.send("subagent:progress", {
    subagentId: id, turn, delta, action, hopCount: hopCount ?? 0, account,
  });
},

onSubagentEnd: (report) => {
  this.send("subagent:end", { subagentId: report.id, report });
},
```

### 3.2 报告结构：复用而非重声明

`SubagentTaskReport` 已含 v1 遗漏的 `targetSessionId`。要么直接 `import type` 复用，要么在 `protocol.ts` 中做**字段映射**并显式标注「新增字段需要同步后端接口」。

```ts
// 推荐：直接复用，前端只做展示投影
import type { SubagentTaskReport } from "../../../src/agent/subagent-runner";
export type SubagentReportView = SubagentTaskReport;
```

若因前后端目录隔离无法共享类型，最低要求是：**`targetSessionId` 必须保留**，否则前端无法把子代理报告关联回其分叉会话。

### 3.3 `toolId` 关联是未解决项（v1 忽略）

v1 的 `SubagentStartPayload` 含 `toolId`（"关联主会话 invoke_subagent toolId"），但 **`executeBatch` 的 `onSubagentStart` 并不传递 toolId**。子代理事件与工具卡片之间当前**没有任何关联键**。

可选方案：

| 方案 | 做法 | 代价 |
|---|---|---|
| A | `RpcHandler` 在 `onToolStart` 时记录 `activeToolId`，`onSubagentStart` 期间归属该 id | 若存在工具嵌套/并行会误归属 |
| B | 在 `SubagentRunnerOptions` 增加 `batchId`，由 Orchestrator 在调用 `executeBatch` 时传入 | 需要改后端签名（小改动，语义最清晰） |
| C | 用 `stage` + 启动顺序做弱关联 | 不可靠 |

**推荐 B**。v1 把 `toolId` 当作已存在的关联，是本设计最容易被实现成「看起来能跑但会错配」的地方。

### 3.4 状态模型：扩展 `SubagentLiveState`

v1 的 `SubagentItemState` 与 `tui-renderer.ts` 的 `SubagentLiveState` 字段重叠 8 项。建议在共享类型层扩展后者（新增 `reasoning`、`actions`、`report`、`startTime`），避免 TUI 与 Web 两套模型漂移。

---

## 4. 前端组件（修正挂载点）

### 4.1 `SubagentBatchCard`

- 挂载点成立：`ToolCard.tsx` 需新增 `tool.name === "invoke_subagent"` 分支（当前无此分支，属实）。
- **进度文案不可硬编码**：v1 示例 `Stage 1 · 2/2 已完成` 假设总是 2 个子代理、单阶段。实际 `executeBatch` 支持任意 stage 数与非均匀并发，进度必须由事件流推导。
- **必须呈现「排队」态**：`maxConcurrency` 受账号池可用容量限制（`subagent-runner.ts:218-228`）。当池内可用账号为 1 时，5 个子任务会串行排队。v1 只有 pending/running/completed/failed 四态，缺少 `queued` 会让用户误以为卡死——这正是本设计要解决的原始痛点，不能在实现中重现。

### 4.2 `SubagentHeaderLineage`

- 挂载点成立：`ChatView.tsx:87` 的 `<header className={css.chatHeader}>` 内 `headerLeft` 区域。
- v1 的 `[返回主会话]` 面包屑可复用 `sessionTitle` 位置，但需注意 `headerRight` 已有智能体与账号按钮，横向空间有限，需定义折叠阈值。

### 4.3 双视窗模式

v1 的两种模式设计合理。需要补充的实现约束：

1. **中央聚焦模式会卸载主会话 DOM**。若流式仍在进行，切回时必须能从 store 重放。当前 `store` 的 turn 累积方式支持这一点，但需确认 `assistant:chunk` 在非聚焦期间仍写入 store（建议：**永远写入**，仅渲染层过滤）。
2. **侧栏模式需扩展 `RightbarTab` 联合类型**（当前仅 `files|terminal|diff|ledger|context`），并同步 `Rightbar.tsx:14-19` 的 tabs 数组与 store 的 `activeRightbarTab`。v1 未提及这三处联动。
3. `SubagentReadOnlyComposer` 的只读框合理；但需定义「主会话已完成而子代理视图仍打开」时的状态（应允许自动回主会话或显示终态）。

### 4.4 `HandoffAnchorCard`

- **触发条件需修正**：v1 写「`session:handoff` 事件，或 `Turn` 状态为 `handed_off`」。实测 `Turn.status` 只有 `streaming|completed|interrupted|error`，**没有 `handed_off`**；`SessionRecord.status` 才有。
- 正确触发源：`orchestrator` 的 `onSuccessorAwakened(newSessionId, generation)`（已定义、未接线）+ `session:snapshot` 中的 `handoffDocPath` 回填。
- 交接文档目录需按实际约定：`.cph/handoffs/` 需先确认（`cli.ts` 中 handoff 相关路径由 orchestrator 生成，v1 示例的 `.cph/handoffs/handoff-xxx.md` 应实测后写死或改为读取字段）。

---

## 5. 后端持久化与 Debug（修正后的关键节）

### 5.1 Turn 持久化

v1 的 `this.sessionManager.saveTurn(...)` **不存在**。`SessionManager` 公开 API 仅：

```
createSession / saveSession / loadSession / listSessions / getLatestActiveSession / rebuildIndex
```

两种落地方式：

| 方案 | 做法 | 评价 |
|---|---|---|
| A（推荐） | `RpcHandler` 维护 `SessionRecord`，每轮结束更新 `turns[]` / `turnCount` / `updatedAt` 后调 `saveSession(record)` | 零新 API，复用既有自愈索引 |
| B | 在 `SessionManager` 新增 `upsertTurn(sessionId, turn)` | 语义更细，但需处理并发写与索引同步 |

v1 应按 A 描述，否则实现者会去创造一个不存在的方法。

### 5.2 `/debug` 指令与技能选择器冲突（v1 完全忽略）

实测 `Composer.tsx:30-33`：输入 `/` 会触发**技能候选浮层**，`slashQuery` 用于过滤 `availableSkills`。因此输入 `/debug` 时：

- 浮层会显示"无匹配技能"或过滤掉所有项；
- 提交时该文本会作为普通 Prompt 发给模型，而非本地指令。

v1 把它描述为"在 `handleUserSubmit` 中识别 `/debug` 系列指令"的简单分支。实际需要：

1. 定义**保留命令命名空间**（如 `debug`、`clear`、`compact`），在 `Composer` 的过滤逻辑中优先匹配命令，再匹配技能；
2. 命令命中时**不发送到后端 Prompt**，而是发本地 RPC（如 `debug:set`）；
3. 需要明确：`/debug` 是只在 Web 生效，还是与 CLI 的 `/debug [on|off|path]`（`cli/commands.ts:366`）共用语义。**建议共用**，避免两套行为。

### 5.3 日志落盘：与既有树兼容（v1 的扁平文件方案会造成分叉）

v1 提议 `.cph/logs/cph-web-<timestamp>.log`。既有架构是：

```
.cph/logs/<sessionId>/
    main.log           # 全会话输出
    timeline.jsonl     # 结构化事件流
    subagents/
        <id>-<role>.log
```

`initSessionTree` 已在 `orchestrator.ts:922` 与 `subagent-runner.ts:197` 被调用。

**结论**：Web 侧应复用该树（例如复用 `sessionDir/main.log` 与 `createSubagentLogStream`），仅补充缺失的 `[MODEL_THINKING]` / `[MODEL_OUTPUT]` / `[SUBAGENT_*]` 写入点；不应另建时间戳扁平文件，否则同一会话的日志会分散在两处，破坏"按会话追溯"的核心价值。

若确需一个"本次进程"的快速入口，可加一个软链/指针文件（如 `.cph/logs/latest`），而不是第二套写入器。

### 5.4 子代理会话落盘位置（v1 会污染主会话索引）

v1 提议 `.cph/sessions/subagent-<id>.json`。实测 `rebuildIndex()`（`session-manager.ts:167-200`）会遍历目录内**所有** `.json`（除 `index.json`），凡是含 `id` + `title` 的对象都会被收进主会话索引。

因此该位置会导致：**子代理记录出现在会话列表里，被误当作可切换的主会话。**

正确做法（择一）：

| 方案 | 路径 | 说明 |
|---|---|---|
| A（推荐） | `.cph/sessions/<mainSessionId>/subagents/<id>.json` | 子目录天然隔离，`readdirSync` 不递归 |
| B | `.cph/subagents/<mainSessionId>/<id>.json` | 独立根目录，语义最清晰 |
| C | 仍在 `.cph/sessions/` 但文件名前缀排除 + 修改 `rebuildIndex` | 改动既有自愈逻辑，风险最高 |

### 5.5 `metrics.tps` 是硬编码假值（v1 未发现）

`rpc-handler.ts:1092-1096`：

```ts
turn.metrics = {
  durationMs,
  model: "copilot-substrate",
  tps: 42,          // 硬编码
};
```

v1 在 `SubagentEndPayload.report` 与 `SubagentItemState` 中大量使用「耗时 / token 量」做展示（如 `1.2K tok`），但 Turn 层 `tps` 本就是假的。若不修正，子代理卡片的性能数字会同样不可信。

**要求**：要么真实统计（chunk 计数 / durationMs），要么**不展示**。禁止在 UI 中呈现虚构指标。

---

## 6. 错误处理与边界（补充 v1 缺失项）

v1 的三条（子代理失败隔离、断连恢复、只读保护）方向正确，但遗漏了运行时真实存在的机制：

1. **熔断器**：`executeBatch` 内有 `circuitBreakerTriggered`，会在账号池全面不可用时中止整批。前端必须能呈现「批次被熔断」这一状态，否则会停留在"运行中"假象。v1 的四种状态不够用。
2. **队列等待**：见 §4.1，需 `queued` 状态与"等待账号释放"提示。
3. **重连与快照的循环依赖**：v1 称「重连后通过 `session:snapshot` 拉取水合数据」。但 `session:snapshot` 的数据源是 `SessionRecord.turns`，而 RpcHandler **当前从不写盘**。若不先完成 §5.1，重连恢复拿到的仍是空 turns。**顺序上 §5.1 必须先于断连恢复**。
4. **中断态**：`turn.status` 有 `interrupted`，子代理批量在用户按停止时的状态需明确（建议标记 `cancelled`，与 `failed` 区分）。

---

## 7. 验证矩阵（目标 + 当前状态）

v1 的矩阵是"预期结果"口吻，且把新增测试写成既有测试。以下每行给出**当前实测状态**。

| ID | 验证项 | 判定方式 | 目标 | 当前 |
|---|---|---|---|---|
| **G0** | 基线测试 | `bun test tests/` | 0 fail | ❌ 732 pass / 8 fail（既有基线，见前序修订稿） |
| **G1** | Web 构建 | `npm run web:build` | 0 error | ✅ 通过 |
| G-A1 | 子代理事件接线 | 代码断言：`rpc-handler` 中三个 `onSubagent*` 存在 | 存在 | ❌ 全缺 |
| G-A2 | 参数不错位 | 单测：`onSubagentStart(id,role,spec,5,"a@b")` → `hopCount=5, account="a@b"` | 正确 | ⬜ 待实现 |
| G-A3 | toolId 关联 | 单测：并行两个 `invoke_subagent` 时事件归属正确 | 无错配 | ⬜ 待实现 |
| G-B1 | 聚焦切换不丢流 | E2E：运行中切换，返回后文本完整 | 完整 | ⬜ 待实现 |
| G-B2 | 侧栏联动 | 断言 `RightbarTab` 含 `subagent`，tabs 数组与面板均已注册 | 三处一致 | ⬜ 待实现 |
| G-B3 | 队列态可见 | E2E：池容量 1、4 个子任务 → 出现"排队" | 可见 | ⬜ 待实现 |
| G-C1 | CoT 落盘 | 集成：`reasoning:chunk` 排除条件已移除，日志含 `[MODEL_THINKING]` | 有内容 | ❌ 被 `rpc-handler.ts:299` 排除 |
| G-C2 | 子代理日志入树 | 断言写入 `.cph/logs/<sid>/subagents/*.log` | 复用既有树 | ❌ 无写入点 |
| G-C3 | `/debug` 不与技能冲突 | E2E：输入 `/debug` 不出现技能浮层，不发送到模型 | 命令优先 | ❌ 当前走技能过滤 |
| G-D1 | Turn 持久化 | 集成：运行一轮后 `.cph/sessions/<id>.json` 的 `turnCount` 增加 | 落盘 | ❌ 无 `saveSession` 调用 |
| G-D2 | 子代理不污染索引 | 集成：写子代理记录后 `listSessions()` 不新增条目 | 隔离 | ⬜ 待实现（当前若写则必污染） |
| G-D3 | Handoff 记忆接力 | 集成：换代后下一轮 Prompt 含前序快照 | 含 | ❌ Web 侧缺失 |
| G-D4 | 代际事件 | 断言接线 `onSuccessorAwakened` | 已接线 | ❌ 未接线 |
| G-E1 | 指标非虚构 | 代码断言：无硬编码 `tps: 42` 展示到 UI | 真实或隐藏 | ❌ 硬编码存在 |

---

## 8. 实施顺序（依赖关系决定，不可跳跃）

| 阶段 | 内容 | 准入条件 |
|---|---|---|
| **P0** | 修正 `Turn` 持久化（§5.1，方案 A） | G-D1 通过。**这是断连恢复的前提** |
| **P1** | 子代理事件接线 + 参数签名对齐（§3.1） | G-A1/A2 通过 |
| **P2** | `batchId` 关联（§3.3 方案 B） | G-A3 通过 |
| **P3** | 共享状态模型（扩展 `SubagentLiveState`） | TUI 与 Web 同源 |
| **P4** | Debug 补齐（§5.3/5.4：移除排除条件、补子代理写入、子代理会话隔离存放） | G-C1/C2 通过，G-D2 通过 |
| **P5** | `/debug` 命令命名空间（§5.2） | G-C3 通过 |
| **P6** | 前端卡片与谱系（§4.1/4.2） | G-B3 通过 |
| **P7** | 双视窗（§4.3，含 `RightbarTab` 三处联动） | G-B1/B2 通过 |
| **P8** | Handoff 接力（§4.4，接 `onSuccessorAwakened` + 复用 `pendingHandoffSnapshot`） | G-D3/D4 通过 |
| **P9** | 指标真实化（§5.5） | G-E1 通过 |

**为什么 P0 必须先做**：v1 把「刷新 100% 还原」与「断连恢复」写成收益，但两者都依赖 Turn 落盘。当前 `RpcHandler` 一次 `saveSession` 都不调用，先做 UI 会让"还原"在验收时必然失败，且难以判断是 UI 还是持久化的问题。

---

## 附录 A：事实核验记录

| # | 断言 | 核验位置 | 观测 |
|---|---|---|---|
| A1 | 三个子代理事件未接线 | `rpc-handler.ts:992-1110` | 仅 8 个事件，无 `onSubagent*` |
| A2 | 事件签名含 `hop` | `subagent-runner.ts:213-215` | `(id, role, spec, hop?, account?)` |
| A3 | 报告含 `targetSessionId` | `subagent-runner.ts:158-172` | 存在，v1 未列 |
| A4 | 无 `saveTurn` | `session-manager.ts` 公开方法 | 仅 create/save/load/list/getLatest/rebuild |
| A5 | 无 `handleSessionSwitch` | `rpc-handler.ts` | 实为 `handleSessionSelect` + `loadSessionTurns:488` |
| A6 | RpcHandler 不写盘 | grep `saveSession` | 零命中 |
| A7 | `rebuildIndex` 吸收所有 json | `session-manager.ts:178-200` | `endsWith(".json") && id && title` 即收录 |
| A8 | 日志树已实现 | `terminal-logger.ts:56-89` | `main.log` / `timeline.jsonl` / `subagents/` |
| A9 | 日志树已在用 | `orchestrator.ts:922`、`subagent-runner.ts:197` | `initSessionTree(...)` |
| A10 | CoT 被显式排除 | `rpc-handler.ts:299` | `type !== "reasoning:chunk" && type !== "assistant:chunk"` |
| A11 | `SessionRecord.status` 含 `handed_off` | `session-manager.ts` | 有；`Turn.status` 无 |
| A12 | `onSuccessorAwakened` 已定义 | `orchestrator.ts:116` | `(newSessionId, generation) => void` |
| A13 | `_genN` 后缀真实 | `orchestrator.ts:949` | `${base}_gen${generation}` |
| A14 | `pendingHandoffSnapshot` 仅在 CLI | `cli.ts:152/405/1255` | Web 侧零引用 |
| A15 | `SubagentLiveState` 已存在 | `tui-renderer.ts:24-37` | 8 字段与 v1 重叠 |
| A16 | `RightbarTab` 仅 5 值 | `protocol.ts:68` | 无 `subagent` |
| A17 | `/` 绑定技能浮层 | `Composer.tsx:30-33` | `slashQuery` 过滤 `availableSkills` |
| A18 | CLI 已有 `/debug` | `cli/commands.ts:366` | `/debug [on|off|path]` |
| A19 | `tps` 硬编码 | `rpc-handler.ts:1095` | `tps: 42` |
| A20 | 并发受账号池容量约束 | `subagent-runner.ts:218-228` | `maxConcurrency = min(capacity, tasks)` |
| A21 | 存在熔断器 | `subagent-runner.ts:248/250+` | `circuitBreakerTriggered` |
| A22 | 报告落盘路径 | `subagent-runner.ts:770` | `.cph/reports/report-<role>-<id>.md` |
| A23 | WS 退避已存在 | `client-ws.ts:6-7/86` | `backoffMs` + `scheduleReconnect` |
| A24 | `session:snapshot` 已存在 | `rpc-handler.ts:565` | 已实现 |
| A25 | `web:build` 存在 | `package.json` | `npm --prefix web run build` |
| A26 | DeepSeek 基准存在 | `Library/deepseek-harness` | `True` |

## 附录 B：本次未处理（仅记录）

1. `tests/web/` 已有 3 个测试文件（`cli-web`/`cloud-workspace-rpc`/`server`），v1 新增的 3 个单测应标注为"新增"，避免与既有混同。
2. `metrics.tps` 之外，`metrics.model` 亦为固定字符串 `"copilot-substrate"`，真实模型标识未回传。
3. `orchestrator.ts` 的 `onTurnEnd` 有 5 处触发点，若在 Web 侧据此做 Turn 落盘，需确认不会重复保存同一轮。

---

**结论**：v1 的三个问题定位准确，UI 设计方向可采纳；但其技术说明层有 4 处会直接导致实现错误（事件参数错位、不存在的 API、子代理落盘污染主索引、`handed_off` 状态归属错误），方案层有 2 处重复建设（日志体系、子代理状态模型），并遗漏了 3 个已存在却未被利用的关键能力（`onSuccessorAwakened`、`initSessionTree`、CLI 的 `pendingHandoffSnapshot`）。本版将这些逐一落回可核验状态，并补充了 v1 未覆盖的队列态、熔断态与指标真实性问题。
