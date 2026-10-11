# CPH-PI 主会话虚拟化、本地无损快照与单账号并发保护设计规范

## 1. 概述与背景

在 Microsoft Copilot (M365 BizChat / MOS3) 实际测试与工业级运行中，暴露出一项关键的平台特性：
- **云端会话保留窗口极小**：单个用户账号在微软云端通常仅保留最新 2~3 条活动会话，稍早前的会话会被激进淘汰清理；
- **并发冲突导致主控丢失**：当主会话（Main-1）派发多个子代理异步攻坚时，若主会话在云端长期挂起，后续子代理建立的新连接会迅速将主会话挤出保留窗口，造成主会话在微软端丢失或失效；
- **单账号多并发加剧 429**：如果用户仅配置 1 个账号，盲目发起 3~4 个子代理并行连接不仅会导致会话被删，还会瞬间触发微软 429 频控。

为彻底根治此问题，本设计提出**主会话虚拟化 (Main Session Virtualization)** 与**账号自适应并发度队列 (Account-aware Concurrency Queue)** 架构。

---

## 2. 核心架构设计

### 2.1 主会话虚拟化与本地无损快照 (Local Lossless Snapshot)

主会话在派发子任务后，其第一阶段历史任务已经完成，不需要在云端长期挂起。Harness 在拦截到 `invoke_subagent` 时，将其状态原子化持久化到本地：

```typescript
export interface MainPlanSnapshot {
  snapshotId: string;              // snap_<timestamp>
  originalSessionId: string;       // 主会话 ID (如 main_1)
  originalTask: string;            // 用户原始业务需求
  thought: string;                 // 主控在派发时的架构推演
  workspaceRoot: string;
  gitBaseline: string;             // 基准 commit
  plannedSubagents: SubagentTaskSpec[]; // 本次派发的全部子任务规格
  createdAt: number;
}
```

- **持久化路径**：
  - JSON 结构体：`<workspaceRoot>/.cph/handoffs/main-plan-<mainSessionId>.json`
  - 易读 Markdown：`<workspaceRoot>/.cph/handoffs/main-plan-<mainSessionId>.md`
- **瞬时安全释放**：
  落盘完成后，Harness 标记 `main_1` 状态为 `handed_off`，主动关闭 `main_1` 的网络连接并释放会话句柄。主会话在云端无论是否被微软清理，本地状态 100% 完好无损。

### 2.2 账号自适应并发度队列 (Adaptive Concurrency Queue)

在 `SubagentRunner` 中引入账号感知调度机制，确保单账号模式下永远不突破微软 2~3 条会话的上限红线：

```text
               [主控派发 N 个子任务]
                         │
                         ▼
        [查询当前账号池可用账号数 (pool.getPoolStatus())]
       /                                                \
 [账号数 == 1 (单账号模式)]                    [账号数 >= N (多账号模式)]
        │                                                │
 [设置并发度上限 = 1 (严格排队)]               [按账号数分配，全并行推进]
 Task 1 运行 ➔ 结题并断开 ➔                     Task 1 (Account A) \
 Task 2 运行 ➔ 结题并断开 ➔                     Task 2 (Account B)  ──> 完全并发
 Task 3 运行 ➔ 结题并断开                       Task 3 (Account C) /
        │                                                │
        └───────────────────────┬────────────────────────┘
                                ▼
                    [汇聚全部报告 ➔ 拉起新主会话]
```

- **单账号保活不变量 (Active Session Invariant = 1)**：
  单账号环境下强制串行（并发度 = 1），一个子代理完成并释放连接后才启动下一个。任意物理时刻，该账号在微软云端最多只有 1 个活动会话，彻底消除被挤压淘汰的风险。
- **多账号物理并发**：
  当账号池包含多个独立账号时，自动映射至不同物理账号实现并发加速。

### 2.3 新主会话代际接棒与成果注入 (Successor Main Session Turn 1)

当所有子代理全部结题后：
1. Harness 实例化全新主会话 `main_2`（并在 `lineageTracker` 中登记 `main_1.successorId = "main_2"`）；
2. `main_2` 享有全新、干净的 **完整 30 轮推理预算**；
3. Harness 构造 Turn 1 提示词：
   ```text
   【主控接力与成果审阅】
   前序主控会话已完成工程规划并调度专项子代理完成了攻坚，以下为前序规划快照与各子代理的交付成果：

   ### 1. 原始任务与前序规划蓝图
   <原始目标与前序主控的 Thought 推演>

   ### 2. 子任务攻坚结题成果 (共 N 个子任务全部完成)
   #### [Sub-1] [researcher] <description>
   - 交付结论: ...
   #### [Sub-2] [coder] <description>
   - 交付结论: ...

   请你作为主控智能体，综合审阅上述交付物，执行交叉验证与必要测试。若全部达成目标请输出 FINAL_ANSWER；若需后续阶段攻坚，可继续派发后续子任务。
   ```

### 2.4 全自动流水线闭环与终端 TUI 透明度

- **全自动流转**：从 `Main-1 派发 ➔ 子代理队列 ➔ Main-2 审阅`，端到端自动推进，无多余阻塞；若 `Main-2` 决定继续派发第二阶段子任务，则自动递归流转至 `Main-3`；
- **终端状态通知**：
  - 主控归档时输出：`📌 [主控会话已虚拟化归档] 成功捕获宏观规划快照，账号已腾空，进入子任务攻坚队列...`；
  - 队列执行时输出：`[排队执行中 1/3]`（单账号）或 `[并发推进中 3/3]`（多账号）；
  - 主控唤醒时输出：`🚀 [拉起第 2 代主控会话] 注入前序架构快照与 3 项子任务结题成果，进入交叉验证阶段...`。

---

## 3. 冲击面分析与组件协同

| 组件模块 | 职责变更与增强 |
|---|---|
| `CPH-PI/src/agent/orchestrator.ts` | 增加主会话虚拟化调度：拦截 `invoke_subagent` 时落盘快照，释放旧会话；子代理完工后自动实例化新主会话运行 Turn 1 |
| `CPH-PI/src/agent/subagent-runner.ts` | 增加自适应并发控制：根据账号池大小限制单账号并发度为 1，支持按队列异步调度 |
| `CPH-PI/src/session/lineage-tracker.ts` | 记录 `main_1 ➔ main_2 ➔ main_3` 跨代继任血缘 |
| `CPH-PI/cph-main-agent-prompt.txt` | 正向引导主控感知会话虚拟化生命周期（派发后自动快照，新主控满配额审阅） |
| `CPH-PI/skills/subagent/SKILL.md` | 文档说明主会话虚拟化与自适应排队契约 |

