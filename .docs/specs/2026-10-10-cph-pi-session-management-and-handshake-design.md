# CPH-PI 会话管理与纯净两轮握手状态机架构设计规范

> **状态**：已批准 (Approved)  
> **创建日期**：2026-10-10  
> **目标工程**：`CPH-PI/`  
> **核心目标**：
> 1. 彻底根除首轮大文本透传 BUG，严格落实 **Turn 1 纯净基准探测握手 -> Turn 2 业务任务与技能注入** 的心智锚定状态机；
> 2. 为 `CPH-PI` 建立工业级**会话管理与持久化体系**（会话落盘存储、`/new`、`/sessions`、`/resume`、`--continue`、实时状态栏透视与 25 轮自动脱困接力）。

---

## 一、 问题背景与架构动机

在 `CPH-PI` 的前期实施中，发现了两个关键痛点与缺陷：
1. **两轮握手心智脱节 BUG**：
   原状态机实现直接调用了包含 `userTask` 与 `skillsSection` 的合并提示词，第一轮就将业务任务全部发送给 Copilot。这导致模型缺乏物理工具的真实具身初体验，直接退回到了“Office 办公助手/自然语言吹水”的聊天心智，规避了工具调用。
2. **缺乏系统级会话状态管理**：
   Copilot Web 具备 30 轮硬上限与 Web WAF 审查。若无持久化会话记录、轮次状态透视以及新旧会话平滑切换能力，长任务极易中断且不可恢复。

---

## 二、 纯净两轮握手状态机 (Two-Turn Handshake FSM)

### 1. 状态机迁移规范

```text
               用户输入任务或启动进程
                        │
                        ▼ (isNewSession 或 isHandshakePending = true)
        ┌──────────────────────────────────────────────┐
        │ 【Turn 1: 纯净基准探测握手】                 │
        │ • 绝对不发送 userTask，不发送 skillsSection   │
        │ • 下发宿主机绝对路径、工作区目录树、Git 事实  │
        │ • 严格要求模型输出物理探测 Action:           │
        │   ```action                                  │
        │   tool: run_command                          │
        │   command: git status                        │
        │   ```                                        │
        └───────────────────────┬──────────────────────┘
                                │
                                ▼ 模型输出 run_command (git status)
        ┌──────────────────────────────────────────────┐
        │ 【本地执行物理工具】                         │
        │ • Pi bash 原生执行 `git status` 并拿到真实输出│
        │ • isHandshakePending 标记置为 false          │
        └───────────────────────┬──────────────────────┘
                                │
                                ▼ 带着真实物理输出进入第 2 轮
        ┌──────────────────────────────────────────────┐
        │ 【Turn 2: 注入业务任务与技能】               │
        │ • 回填: [TOOL_RESULT for git status - SUCCESS]│
        │ • 提示: 【环境握手完成：本地工具与工作区已就绪】│
        │ • 注入: 【当前已激活的专业技能 (Skill)】     │
        │ • 注入: 【用户正式需求】                      │
        └───────────────────────┬──────────────────────┘
                                │
                                ▼
        [模型彻底摆脱“办公助手”心智，进入具身 Agent 状态开始修改代码]
```

### 2. 状态机规则铁律
- **初次启动 / `/new` / 会话自动脱困切换**：必须强制走 **Turn 1 纯净探测握手**；
- **同会话后续追问（Follow-up）**：模型已处于具身 Agent 心智状态，直接携带历史上下文推进，不重复握手；
- **未调工具直接回复防护**：若模型首轮未输出 action 试图直接解答，状态机拦截并回填：`[请先输出 action 块执行 git status 以验证本地物理工具连接]`。

---

## 三、 会话管理与持久化架构 (Session Management)

### 1. 数据模型与磁盘落盘结构

数据存储在目标工作区的二级目录 `<workspace>/.cph/sessions/` 下：

```text
<workspace>/.cph/
└── sessions/
    ├── index.json               # 会话索引表（元数据清单）
    ├── ses_20261010_1001.json   # 完整会话快照
    └── ses_20261010_1002.json
```

**会话数据契约 (`SessionRecord`)**：
```typescript
export interface SessionRecord {
  id: string;               // 如 ses_20261010_1420_a1b2
  title: string;            // 自动提炼的首个任务摘要（前40字）
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  workspaceRoot: string;    // 目标工作区绝对路径
  turnCount: number;        // 当前轮次数
  maxTurns: number;         // 默认 25 轮安全阈值
  modelTone: string;        // 模型风格
  currentAccount?: string;  // 当前调度的 M365 账号
  status: "active" | "completed" | "handed_off";
  turns: SessionTurnRecord[]; // 每一轮的输入、思考、工具调用与结果
}
```

### 2. 交互控制指令集与 CLI 选项

| 命令 / 选项 | 行为描述 |
| :--- | :--- |
| `/new` 或 `/reset` | 归档当前会话，新建会话 ID，轮次置 1，标记 `isHandshakePending = true`。 |
| `/sessions` | 格式化表格展示当前工作区历史会话列表（ID、标题、更新时间、轮次数、状态）。 |
| `/resume <id>` | 恢复指定会话，还原其轮次与上下文历史。 |
| `/status` | 打印当前会话的详细诊断卡（会话 ID、当前轮次、估算上下文、账号池状态）。 |
| `cph-pi --continue` | 命令行启动时自动接续最近活跃的会话。 |
| `cph-pi --resume <id>` | 命令行直接恢复指定 ID 的历史会话。 |

### 3. 实时状态透视 (TUI Status Bar)
在终端交互行上方常驻展示：
```text
┌─ [ 会话: ses_1001 | 轮次: 3/25 | 上下文: ~1.8k Token (压实率 86%) | 账号: dev1@m365 ]
cph-pi> 
```

### 4. 25 轮自动脱困与会话接力 (Auto-Handoff)
- 当会话轮次达到 25 轮（或检测到云端上下文上限提示）时，Orchestrator 强行介入；
- 提取阶段性成果摘要（已完成的工具操作清单与遗留待办）；
- 将当前会话状态更新为 `handed_off` 并落盘保存；
- 自动轮转账号池凭据并创建全新会话，携带成果摘要快速重接地接力推进。

---

## 四、 测试与验证计划

1. **两轮握手状态机单测 (`tests/agent/handshake-fsm.test.ts`)**：
   - 验证 Turn 1 严格为 `buildHandshakePrompt`（无任务、无技能）；
   - 验证工具返回后 Turn 2 准确注入 `[TOOL_RESULT]`、Skill 与用户正式需求；
   - 验证后续多轮对话不重复触发探测。
2. **会话管理器测试 (`tests/session/session-manager.test.ts`)**：
   - 验证会话自动创建、存盘落盘至 `<workspace>/.cph/sessions/` 与索引维护；
   - 验证 `/sessions` 列出、`/resume <id>` 还原；
   - 验证 `--continue` 自动选取最近会话。
3. **端到端冒烟集成测试 (`tests/e2e/session-flow.test.ts`)**：
   - 验证终端 `/new`、`/sessions`、`/status` 指令正常响应；
   - 验证 25 轮自动脱困平滑接力。

