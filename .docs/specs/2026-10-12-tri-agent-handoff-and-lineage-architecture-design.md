# CPH-PI 三 Agent 提示词重塑、子代理自主透明接力与会话单向继承链条设计规范

## 1. 概述与背景

在 CPH-PI 的多会话并发架构中，系统已成功打通 `invoke_subagent` 协议与三专属 Agent（Main 协调者、Coder 编码者、Researcher 调研者）物理分发机制。但在实际工业级长期运行与面对复杂工程时，暴露出以下关键架构演进需求：

1. **单任务 30 轮上限与子代理接力穿透**：Copilot 单会话具备 30 轮硬上限。当单项复杂子任务（如大型模块重构）单次消耗逼近 30 轮时，子代理必须具备调用 `handoff` 技能向后代接力子代理（例如 Coder-1 ➔ Coder-2）透明传递现场的能力，对主会话保持黑盒内聚与最终交付确定性。
2. **任务规模控制与防溢出认知引导**：主控 Agent 需要在系统提示词与 `subagent` 技能中建立清晰的“任务体量认知（Task Right-Sizing）”，将子任务控制在 10~20 轮黄金工作区间，避免无边界巨型需求造成轮数失控。
3. **并发容灾与会话单向继承链条 (Unidirectional Lineage Chain)**：在极端调度场景下（例如主会话所用账号遭遇 429 频控触发黑匣子交接迁移至新账号，而两个子代理仍在异步攻坚），系统必须解耦“物理账号”与“逻辑会话”，维护实时的单向继承血缘指针（`successorId`），使子代理成果始终精准回流至当前处于 `active` 状态的最新主会话。
4. **子代理 429 频控与全局容灾联动**：确立子代理内部静默轮换与全池耗尽向上逐级上报的分级熔断机制。

---

## 2. 三大 Agent 系统提示词重新设计规范

### 2.1 主控智能体 (Main Coordinator Agent) — `cph-main-agent-prompt.txt`
- **定位**：系统总架构师与全局调度核心（Master Coordinator）。
- **职责范式**：
  1. **双轨决策权**：
     - 轻量即时闭环 (1~3 轮)：针对单文件小修、配置调整或快速验证，就地调用工具快速交付；
     - 复杂工程拆解：跨文件协同、底层逆向探索，通过 `invoke_subagent` 调派专项子代理。
  2. **任务体量与防溢出引导**：以垂直功能切片为边界设计子任务，将子任务预期消耗引导在 10~20 轮，建议单任务修改核心文件数不超过 3 个；需求过大时拆为“调研 ➔ 分模块并行”的流水线。
  3. **宏观项目交接契约 (Macro Handoff)**：第 29 轮收到交接准备通知时，调用 `handoff` 技能生成全局宏观交接文档，沉淀至 `.cph/handoffs/handoff-<主会话ID>.md`。

### 2.2 代码实现子智能体 (Coder Subagent) — `cph-coder-agent-prompt.txt`
- **定位**：工程攻坚手（Code Implementer & Tester）。
- **职责范式**：
  1. **全套读改写测工具**：具备 `read_file`, `patch_file`, `write_file`, `run_command`；
  2. **物理剔除孙代理**：不挂载 `invoke_subagent` 工具与技能，消除递归调用风险；
  3. **微观代码交接契约 (Micro Sub-Handoff)**：挂载 `handoff` 技能。当单项任务触及第 29 轮上限时，调用 `handoff` 技能提炼当前改动文件清单、失败用例与断点精确行号，写入 `.cph/handoffs/handoff-<子会话ID>.md`，交由 Harness 自动唤起 Coder-2 接力。

### 2.3 深度调研子智能体 (Researcher Subagent) — `cph-researcher-agent-prompt.txt`
- **定位**：技术情报与静态分析专员（Read-only Investigator）。
- **职责范式**：
  1. **只读探查与分析**：具备 `read_file`, `cat`, 只读 `run_command`（如 grep, test 走查），物理剔除写文件工具与 `invoke_subagent`；
  2. **探索情报交接契约**：挂载 `handoff` 技能。若大型代码库探查触及第 29 轮上限，调用 `handoff` 技能提炼已验证事实、排查盲区与推荐下步探测文件，写入 `.cph/handoffs/handoff-<子会话ID>.md`。

---

## 3. Skill 规范改造与任务规模控制

### 3.1 `subagent` 技能增强 (`skills/subagent/SKILL.md`)
仅挂载于 **Main Agent**。在原有门禁基础上强化防溢出准则：
- **Gate 1: 角色定位门禁 (Role Gate)**：显式声明 `role: "researcher"` 或 `role: "coder"`；
- **Gate 2: 任务规模与 30 轮防溢出门禁 (Task Right-Sizing Gate)**：
  - 子任务设计遵循 10~20 轮黄金区间；
  - 核心修改文件建议 1~3 个；
  - 严禁将全系统重构塞入单个子任务，必须按依赖层级进行阶段性切片拆解；
- **Gate 3: 正交文件隔离门禁 (Disjoint Files Gate)**：并发派发多个 Coder 时，文件集合严格互斥；
- **Gate 4: 自包含首轮提示词门禁 (First-Turn Self-Contained Prompt Gate)**：包含背景上下文、限定目标文件与明确交付验收标准。

### 3.2 `handoff` 技能双模态适用性 (`skills/handoff/SKILL.md`)
挂载于 **全部三大 Agent (Main / Coder / Researcher)**。保持中立规范，由提示词驱动模态适配：
- **宏观工程交接 (Macro Handoff)**：针对全局架构与多子任务协同进度；
- **微观局部交接 (Micro Sub-Handoff)**：针对局部代码断点或探索线索。

---

## 4. Harness 调度核与单向继承链条架构

### 4.1 会话血缘元数据与单向继承链条 (Lineage Chain)

在 `SessionManager` 与内存中维护继承血缘：
```typescript
export interface SessionLineage {
  sessionId: string;
  role: "main" | "coder" | "researcher";
  status: "active" | "handed_off" | "throttled" | "completed";
  parentSessionId?: string;       // 父会话 ID（子代理指向派发它的主会话）
  predecessorId?: string;         // 前序会话 ID（接力会话指向上一任）
  successorId?: string;           // 后继会话 ID（发生交接时，指向新会话）
  subagentSessionIds?: string[];  // 绑定的全部子代理会话 ID
}
```

**解析活动端点 (Resolve Active Head)**：
```typescript
export function resolveActiveHead(startSessionId: string, getLineage: (id: string) => SessionLineage | undefined): string {
  let currentId = startSessionId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const lineage = getLineage(currentId);
    if (!lineage) break;
    if (lineage.successorId && lineage.status === "handed_off") {
      currentId = lineage.successorId;
    } else {
      break;
    }
  }
  return currentId;
}
```

### 4.2 主会话容灾迁移下的子代理动态回流机制

```
[Main_A (Account A)]  ── 429 容灾交接 ──> [Main_D (Account D 接棒)]
       │                                         ▲
       ├── Subagent_1 (Account B) ── 结题成果 ───┤ (自动解析 Active Head 路由至 Main_D)
       └── Subagent_2 (Account C) ── 结题成果 ───┘
```

1. 当主会话 `Main_A` 触发 429 容灾或轮数上限交接时：
   - 登记 `Main_A.status = "handed_off"`, `Main_A.successorId = "Main_D"`；
2. 当子代理 `Subagent_1` 完成任务时：
   - 调用 `const activeMainId = resolveActiveHead(parentSessionId)`；
   - 若主会话已迁移，结题成果直接回流至 `activeMainId` 下一轮上下文，并在时间线日志落盘 `SUBAGENT_REROUTED_TO_SUCCESSOR` 事件。

### 4.3 子代理内部自主透明接力循环 (Subagent Continuation Loop)

在 `SubagentRunner` 中为单个子任务实现连续接力调度：
1. 子代理实例配置 `maxTurns = 30`；
2. 运行中若第 29 轮产出交接文档（`handoffDocPath`）：
   - `SubagentRunner` 自动生成后继会话 ID（例如 `sub-1-coder-hop2`）；
   - 更新血缘关系 `sub_1.successorId = "sub_1_hop2"`；
   - 以该交接文档为 Turn 1 输入拉起 Successor 子代理；
   - 外部主会话对内部接力过程保持透明，直至最终子代理输出 `FINAL_ANSWER`。

### 4.4 子代理 429 频控与全局容灾联动

1. **第一级（账号池静默轮换）**：单次遇 429，通过 `AccountPool` 切换可用 Token 重试；
2. **第二级（全池耗尽逐级上报）**：全池无可用账号时，子代理保存黑匣子断点并返回特定错误代码（`ALL_ACCOUNTS_THROTTLED`），`SubagentRunner` 向上通知主会话触发全局降级或等待。

---

## 5. 打包构建与分发更新

修改 `CPH-PI/scripts/package-agent-bundle.ts`：
1. 分别打包 3 份最新系统提示词：
   - `Instructions-Main-主协调智能体.txt`
   - `Instructions-Coder-代码实现智能体.txt`
   - `Instructions-Researcher-深度调研智能体.txt`
2. 分别打包 `skills/subagent` 与 `skills/handoff`；
3. 更新 `UPLOAD-GUIDE.md` 说明三大 Agent 的技能挂载矩阵：
   - Main 智能体：挂载 `subagent` + `handoff`
   - Coder 智能体：挂载 `handoff`
   - Researcher 智能体：挂载 `handoff`
4. 运行 `bun run package` 生成 `dist/copilot-agent-bundle.zip`。
