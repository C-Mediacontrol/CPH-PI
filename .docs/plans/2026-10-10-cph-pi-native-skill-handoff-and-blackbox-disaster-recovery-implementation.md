# CPH-PI 原生 Skill 注入、容灾黑匣子与三阶接力 (A->B->C) 实施计划

## 1. 概述与设计基准

- **设计规范依据**: [CPH-PI/.docs/specs/2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md](file:///e:/copilot-web%20proxy/CPH-PI/.docs/specs/2026-10-10-cph-pi-native-skill-handoff-and-blackbox-disaster-recovery-design.md)
- **核心原则**:
  1. **Copilot 原生优先**: 充分复用云端 `CPH-Dev` 专属 Agent 及已上传的 `handoff` 技能，严禁在本地 Harness 重复手搓伪模型逻辑；
  2. **正常会话免裁剪**: 探针实测已证实 Sydney 具备容纳 13.8 万+ 字符的大上下文能力，正常运行轮次不执行本地主动裁剪；
  3. **事故容灾黑匣子 (Disaster Recovery Blackbox)**: 仅在 429 频控或异常猝死时，将全量会话历史浓缩提炼为 5k~8k 字符的高密度黑匣子快照；
  4. **三阶接力管道 (A -> B -> C)**:
     - **会话 A (遇险受害者)**: 遭遇 429 猝死 -> 自动提取黑匣子快照；
     - **会话 B (交接仲裁者)**: 7 账号池自动切换账号 -> 单轮微任务唤起云端 `handoff` 技能产出 5 维交接文档并落盘；
     - **会话 C (接力执行者)**: 挂载交接文档 -> 无缝接续攻坚原始业务需求。

---

## 2. 现网多账号权限实测结果输入

在计划编写前，已对 6 个已登记账号进行直连探测，结果如下：
- `GSC.VFU2@cma-cgm.com`: ✅ **创建者/拥有者**，正常双工通信并成功执行工具指令；
- `GSC.DDAI@cma-cgm.com`: ✅ **已授权访问**，成功双工通信并具备 `FINAL_ANSWER` 自主交付能力；
- `GSC.LISLIU@cma-cgm.com`: ❌ `GptAccessForbidden`（需要所有者/管理员授权）；
- `GSC.MLU`, `GSC.CYLI`, `GSC.MIYMAO`: ❌ `GptNotAvailable`（未对该账号启用/未共享成功）。

**工程启示**:
- `CPH-Dev` 专属 Agent 模式下，目前具备 `VFU2` 与 `DDAI` 双账号即时容灾互备能力；
- `AccountPool` 需具备感知账号对 `customAgentId` 权限状态的能力，遇到 `GptAccessForbidden` / `GptNotAvailable` 时自动标记并平滑轮转。

---

## 3. 冲击面扫描 (Impact Surface Analysis)

| 制品类型 | 生产方 (Upstream) | 消费方 (Downstream) | 冲击面与防护对策 |
|---|---|---|---|
| **黑匣子压实** | `BlackboxCompactor` | `Orchestrator`, `SessionRecord` | 正常会话不主动剪枝；仅 429 遇险时输出 5k~8k 字符快照，格式兼容现有 Markdown |
| **账号池轮转** | `AccountPool` | `ChatHubClient`, `Orchestrator` | 增加 `markAgentUnavailable(email, agentId)`，避免轮转到无权限账号；429 自动冷却 |
| **编排状态机** | `CopilotOrchestrator` | `CphPiCli`, TUI 渲染 | 增加 `runDisasterRecovery(blackbox)` 触发 B 会话；返回结构携带 `disasterRecovered` 标记 |
| **CLI 接力循环** | `CphPiCli` | 用户交互, TUI 终端 | 区分平稳交接与 A->B->C 灾备接力，输出三色高亮接力横幅 |

---

## 4. 任务分解清单 (Task Breakdown)

### Task 1: 事故容灾黑匣子提炼器 (`BlackboxCompactor`)
- **目标**: 将原本在正常轮次运行的滑动剪枝重构为事故专用黑匣子压实器。
- **文件**:
  - 新增/重构: `CPH-PI/src/agent/blackbox-compactor.ts`
  - 测试文件: `CPH-PI/tests/agent/blackbox-compactor.test.ts`
- **职责契约**:
  - `extractDisasterBlackbox(history: TurnRecord[], lastError?: string): string`
  - 最新 2 轮保持 100% 原始输入、工具调用、思考链与错误信息无损；
  - 历史 > 2 轮折叠为结构化时间线（包含轮次、执行动作名、执行目标、是否成功、关键输出摘要）；
  - 严格将超大历史（例如 10 万字符）浓缩压实至 5k~8k 字符范围内，杜绝溢出。

### Task 2: 账号池 Agent 权限感知与敏捷容灾轮转 (`AccountPool`)
- **目标**: 升级账号池，使其具备 429 频控与 Agent 专属权限异常（`GptNotAvailable` / `GptAccessForbidden`）的双重敏捷感知能力。
- **文件**:
  - 修改: `CPH-PI/src/auth/account-pool.ts`
  - 修改: `CPH-PI/src/transport/chathub-client.ts`（捕获 `GptNotAvailable` / `GptAccessForbidden` 并派发事件）
  - 测试文件: `CPH-PI/tests/auth/account-pool-resilience.test.ts`
- **职责契约**:
  - 当收到 429 时，`markThrottled(email, 180000)` 进入 3 分钟冷却；
  - 当收到 Agent 权限错误时，`markAgentIneligible(email, agentId)` 永久/长期跳过该账号访问该 Agent；
  - `getNextAvailableAccount(forAgentId?: string)` 自动挑选下一个完全健康的可用账号。

### Task 3: 编排器三阶自动容灾接力管道 (`Orchestrator`)
- **目标**: 在 `CopilotOrchestrator` 中实现 A $\rightarrow$ B $\rightarrow$ C 容灾管道。
- **文件**:
  - 修改: `CPH-PI/src/agent/orchestrator.ts`
  - 测试文件: `CPH-PI/tests/agent/disaster-recovery-relay.test.ts`
- **职责契约**:
  - 会话 A 遭遇 429 时，捕获异常并不直接崩溃，提炼事故黑匣子；
  - 触发会话 B（Handoff Arbitrator）：切换到池中下一个可用账号（如 `DDAI`），构造交接专用任务：
    `"【前序会话事故黑匣子快照】... 请调用 handoff 技能生成标准交接文档并写入 .cph/handoffs/handoff-<id>.md"`；
  - 确保会话 B 执行 1 轮微任务完成交接文档落盘；
  - 产出并校验交接文档后，启动会话 C（Successor Executor）接手后续任务。

### Task 4: CLI 终端展示与全链路集成验证 (`CphPiCli` & E2E)
- **目标**: CLI 主循环接入三阶容灾事件渲染与端到端模拟测试。
- **文件**:
  - 修改: `CPH-PI/src/cli.ts`
  - 修改: `CPH-PI/src/ui/tui-renderer.ts`
  - 新增测试: `CPH-PI/tests/e2e/disaster-recovery-e2e.test.ts`
- **职责契约**:
  - 渲染三阶接力 ANSI 徽章（⚡ 遇险黑匣子 -> 📑 换号仲裁 -> 🚀 接力攻坚）；
  - 模拟测试端到端 A->B->C 自动换号容灾全链路；
  - 运行全量测试套件（目标 330+ 项测试 100% 绿灯）。

---

## 5. 验收标准 (Definition of Done)

1. **测试全通**: 全量单元测试与 E2E 测试 100% 绿灯，无任何 regression。
2. **免裁剪验证**: 正常运行状态下会话历史 100% 完整透传，不执行伪压实。
3. **黑匣子达标**: 遭遇 429 时，10 万字符原始历史被精准提炼为 5k~8k 字符黑匣子。
4. **换号闭环**: 自动跨越 `VFU2` -> `DDAI`（或后续补充授权的账号）完成 B/C 会话接力。
5. **Git 交付**: 代码和测试干净提交，严禁污染工作区根目录。

