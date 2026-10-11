# CPH-PI 原生 Skill 注入、容灾黑匣子与三阶接力 (A->B->C) 设计规范

## 1. 架构定位与最高原则

在经受多轮现网实测（包含 35 轮超大上下文 13.8 万字符实测通过、以及遭遇 429 频控断连实测）后，本规范确立了 CPH-PI 核心架构定位：
1. **Copilot 原生优先原则**：严禁在本地 Harness 重复手搓 Copilot 云端已具备的能力。充分发挥专属智能体（`CPH-Dev`，`Gpt_61_Sol_Reasoning`）的系统指令、知识库与上传技能包能力，本地专注于协议双工直连与工业级物理工具链桥接。
2. **正常会话免裁剪原则**：实测已证明云端具备容纳 14 万+ 字符的超大上下文窗口，正常多轮会话中本地不进行任何主动剪枝，保持纯净自然的“工具执行 -> 结果贴回 -> 下一步行动”对话流。
3. **本地滑动剪枝定位：事故容灾黑匣子 (Disaster Recovery Blackbox)**：本地两轮滑动压实的核心价值是在会话突发 429 频控或异常中断猝死时，将几十万字符的原始日志安全浓缩为 5k~8k 字符的事故现场精炼快照，供后续会话消化与交接。

---

## 2. 双轨交接体系 (Dual-Track Handoff Architecture)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        CphPiCli / Orchestrator                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼ [分支 1: 正常平稳交接]                                  ▼ [分支 2: 突发 429 事故容灾]
┌───────────────────────────────┐               ┌───────────────────────────────┐
│ 会话 A (健康运行至 30+ 轮)     │               │ 会话 A (突发 429 / 连接断开)   │
└──────────────┬────────────────┘               └──────────────┬────────────────┘
               │ 主动下发交接指引                              │ 云端连接猝死，无法继续发消息
               ▼                                               ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│ 会话 A 触发原生 handoff skill │               │ 本地黑匣子滑动压实器          │
│ (自主调用 write_file 落盘)    │               │ (10万字符历史 -> 6k精炼快照)  │
└──────────────┬────────────────┘               └──────────────┬────────────────┘
               │                                               │ 账号池自动轮转至下一个可用账号
               │                                               ▼
               │                                ┌───────────────────────────────┐
               │                                │ 会话 B (交接仲裁者, 1轮快照)  │
               │                                │ (注入 handoff skill 生成文档) │
               │                                └──────────────┬────────────────┘
               │                                               │ 产出标准交接文档
               └───────────────────────┬───────────────────────┘
                                       ▼
                        ┌───────────────────────────────┐
                        │ 会话 C (接力执行者)           │
                        │ - 携带标准交接文档            │
                        │ - 零冗余历史，全速接手攻坚    │
                        └───────────────────────────────┘
```

### 2.1 分支 1：平稳交接 (Graceful Handoff)
- **触发时机**：会话健康运行达到预设上限（如 30~32 轮时）；
- **执行方式**：向当前健康的会话 A 下达交接指示：`请执行你的 handoff 技能，对当前全部成果进行阶段性总结，调用 write_file 保存至 .cph/handoffs/handoff-<sessionId>.md`；
- **后续接力**：会话 A 落盘文档后，归档会话 A，直接启动会话 C 载入该交接文档接续攻坚。

### 2.2 分支 2：三阶事故容灾交接 (Disaster Recovery Pipeline: A -> B -> C)
- **步骤 1（会话 A 遇险）**：捕获 429、`Throttled` 或连接中断，标记 `sessionA.status = "throttled_aborted"`；
- **步骤 2（黑匣子压实）**：调用 `BlackboxCompactor`，将会话 A 的全量历史裁剪为 5k~8k 字符的结构化黑匣子快照（保留 $1 \sim N-2$ 轮的行动摘要，100% 完整保留最后两轮的思考链与错误详情）；
- **步骤 3（账号池热轮换）**：当前账号置入 3 分钟冷却，`AccountPool.getNextAvailableToken()` 自动提取下一个健康账号；
- **步骤 4（会话 B 仲裁）**：开启单轮微型会话 B，注入黑匣子快照并触发 `handoff` 技能，会话 B 调用 `write_file` 落盘交接文档并立即归档；
- **步骤 5（会话 C 接力）**：开启接力会话 C，注入标准交接文档，无缝恢复剩余业务任务推进，直至产出 `FINAL_ANSWER`。

---

## 3. 核心模块规范与接口设计

### 3.1 黑匣子压实器 (`src/agent/compaction.ts`)
```typescript
export interface BlackboxSnapshotOptions {
  preserveRecentTurns?: number; // 默认 2
  maxSnapshotChars?: number;     // 默认 8000
}

export class BlackboxCompactor {
  public static extractSnapshot(history: TurnRecord[], options?: BlackboxSnapshotOptions): string;
}
```

### 3.2 专属 Agent 的 `handoff` 技能包 (`Library/skills-upload/handoff.zip`)
- **文件组成**：`handoff/SKILL.md`
- **技能规范**：
  - 角色：任务交接与审计仲裁专家；
  - 交付物：包含 1. 任务原始目标与已验证事实；2. 关键文件与环境变更；3. 关键卡点、报错与根因研判；4. 接力第一优先级待办事项 (Actionable Next Steps)；
  - 强制动作：必须调用 `write_file` 工具将交接 Markdown 写入 `.cph/handoffs/handoff-<sessionId>.md`。

### 3.3 账号池 429 感知与故障切换 (`src/auth/account-pool.ts`)
```typescript
export class AccountPool {
  public markThrottled(email: string, durationMs?: number): void;
  public getNextAvailableToken(): Promise<ActiveSessionToken>;
}
```
- 当收到 429 时，自动将当前账号置入冷却队列；
- 支持 7 账号池全自动 Round-Robin 容灾切换。

---

## 4. 测试与验证门禁
1. **测试套件**：`tests/agent/disaster-recovery-handoff.test.ts`
   - 验证 `BlackboxCompactor` 对 30 轮超长历史的极限压缩比率与最后两轮保真度；
   - 验证会话 A 模拟 429 异常后，自动触发黑匣子提炼；
   - 验证账号池自动切换到 Account 2 并驱动会话 B 单轮产出交接文档；
   - 验证会话 C 正确加载交接文档并顺利完成最终交付；
2. **全量回归**：保持全量 313+ 项测试 100% 绿灯全通。

