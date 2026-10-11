# CPH-PI Sub-agent 多会话并发执行与三 Agent 专属协作架构设计 (Sub-agent Execution & Tri-Agent Architecture Design)

- **作者**: CPH-PI 核心架构组
- **状态**: 方案已批准 (Approved)
- **日期**: 2026-10-12
- **适用工程**: `CPH-PI/` (基于 Pi 极简基座的 Copilot 自主编程 Agent)
- **准则遵循**: `E:\copilot-web proxy\AGENTS.md` (五大核心开发与治理准则)

---

## 1. 背景与核心动机 (Context & Motivation)

### 1.1 现状与物理现实挑战
在构建复杂工程或进行多模块协同重构时，单会话 Agent 体系面临两个致命的物理瓶颈：
1. **Copilot Web 30 轮硬上限与注意力耗散**：
   - 微软 M365 Copilot（Sydney / ChatHub 协议）对单主题会话施加了严格的 **30 轮硬上限**，到达后会话强制终结；
   - 随着轮次深入（超过 12~15 轮），中间堆叠的工具输出和历史代码会导致严重的上下文污染与注意力漂移（Lost in the Middle），推理质量急剧下滑。
2. **单轮输出 Token 截断与大文件重写风险**：
   - Copilot Web 端单轮存在严格的物理输出限制（通常约 2000~3000 Token）。如果 Agent 试图通过 `write_file` 一次性重写整个大文件，极易中途腰斩，导致文件破损与工程崩坏。

### 1.2 破局关键：Sub-agent 多会话并发调度
引入 **Sub-agent（子代理）独立会话执行体系**：
- **算力与配额倍增**：将大任务拆分为 $N$ 个独立的子任务，每个子代理拥有干净的上下文环境和独立的 30 轮黄金推理配额；
- **职责明晰与分工**：主会话充当“总架构师与指挥官”，负责前期快速走查、任务拆分、并发派发与终局裁决；子会话充当“专项攻坚工人”，负责深入单点模块、局部微补丁（Patch）与测试验证；
- **账号池（AccountPool）并发加速**：借助 CPH-PI 现有的多账号凭据池，支持多个子代理并发连接 ChatHub，大幅缩短端到端等待时间。

---

## 2. 核心治理与准则对照 (AGENTS.md Governance)

本架构严格遵循 `AGENTS.md` 的五大黄金法则：

| 准则编号与名称 | 架构落地方式与保障 |
|---|---|
| **准则 1：Harness 纯粹与中立原则 (Harness Neutrality)** | Harness 仅扮演客观的基础设施：提供中立的 `invoke_subagent` 工具执行容器与多会话调度核。**严禁在 Harness 中硬编码流水线状态机（如强制拦截用户输入进入固定阶段）**，任务是否拆分、何时调派完全由 Agent 自主决策。 |
| **准则 2：认知塑形与正向引导优先 (Agent Meta-Cognition)** | 通过独立的系统提示词为 Agent 注入清晰的“架构师 vs 工人”元认知；正向引导 Agent 面对复杂任务时主动拆分子任务以最大化利用 30 轮配额。 |
| **准则 3：正向引导铁律，摒弃负面词 (Constructive Guidance)** | 提示词中杜绝使用“严禁/切勿/不要”等负面词，通过正向示范告诉 Agent 正确的拆解方法论和结题标准。 |
| **准则 4：通用 Skill 绝对中立与定制隔离 (Customization Isolation)** | 通用工程技能保持原样；专门为多代理协作研发的技能存放在工作区内部专属路径 `CPH-PI/skills/subagent/SKILL.md`，与宿主全局环境隔离。 |
| **准则 5：用户全局配置隔离与工作区打包 (Packaging & Deployment)** | 提示词与专有技能均纳入版本控制，通过 `bun run package` 自动化打包至 `dist/`，生成可直接导入 Copilot Studio 的独立资产包。 |

---

## 3. 三 Agent 专属分立认知架构 (Tri-Agent Meta-Cognition Architecture)

为彻底阻断“子代理套娃调用孙代理”引发的失控与解析异常，并确保各角色认知边界绝对干净，系统采用**分立式三 Agent 提示词与工具隔离体系**：

```
                    ┌──────────────────────────────────────────────┐
                    │               用户任务输入                    │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. 主控 Agent (Main Coordinator Agent)                                                  │
│ - 系统提示词: CPH-PI/cph-main-agent-prompt.txt                                           │
│ - 核心心智: 架构规划与多会话调度，兼具就地单步敏捷作战能力                                │
│ - 注入工具: read, patch_file, run_command, ask_question, invoke_subagent                │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           │ 1. 拆解正交子任务
                                           │ 2. 派发 invoke_subagent
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Harness 调度核: SubagentRunner                                                          │
│ - 实例化独立 Orchestrator 会话 (独立 sessionId, 独立上下文, 独立 30 轮配额)             │
│ - 轮询 AccountPool 分配可用 Token 驱动 ChatHub WebSocket                                │
│ - 物理级工具隔离: 严禁向所有子代理注入 invoke_subagent (从根本上杜绝递归套娃)             │
└──────────────────────────┬──────────────────────────────────────────────┬───────────────┘
                           │ 并发拉起 (role: researcher)                  │ 并发拉起 (role: coder)
                           ▼                                              ▼
┌──────────────────────────────────────────────┐ ┌────────────────────────────────────────┐
│ 2. 调研 Agent: Researcher (子会话 A)         │ │ 3. 编码 Agent: Coder (子会话 B)        │
│ - 提示词: cph-researcher-agent-prompt.txt    │ │ - 提示词: cph-coder-agent-prompt.txt   │
│ - 角色: 只读走查、链路逆向、测试复现、方案论证│ │ - 角色: 局部微补丁修改、运行单测验证   │
│ - 认知定位: 探明事实、分析根因，绝对不改代码  │ │ - 认知定位: 专注按规划精准 Patch、跑测 │
│ - 工具集: read, (只读 bash)                  │ │ - 工具集: read, edit, write, bash      │
│ - 交付物: 深度调研分析与建议报告 (.md)        │ │ - 交付物: 代码微补丁与测试通过证据报告 │
└──────────────────────────┬───────────────────┘ └────────────────────────┬───────────────┘
                           │                                              │
                           └──────────────────────┬───────────────────────┘
                                                  │ 汇总 FINAL_ANSWER 报告
                                                  ▼
                               ┌─────────────────────────────────────┐
                               │ ToolResult 回传主控 Agent 做终局裁决│
                               └─────────────────────────────────────┘
```

### 3.1 主控 Agent (`cph-main-agent-prompt.txt`)
- **核心定位**：全功能自主编程主控，兼具就地单步敏捷作战与多会话调度能力。
- **正向行为模式与决策分水岭 (Autonomous Decision Threshold)**：
  1. **轻量单步任务（1~3 轮内）**：针对局部微调、单文件修复或快速跑测，主 Agent 拥有完全的就地执行权，直接调用 `read`、`patch_file`、`run_command` 敏捷闭环，就地完成验证与交付，零额外会话开销；
  2. **复杂多模块任务**：清醒感知 30 轮配额限制，主动调用 `invoke_subagent` 拆分子任务（优先派发 Researcher 调研，再派发 Coder 施工），利用子代理独立 30 轮配额并发攻坚；
  3. **审阅与裁决**：审查子代理汇报的成果与测试日志，做出综合决策：若全部达成则输出 `FINAL_ANSWER`，若有未决项则就地补充微调或继续发起针对性微任务。

### 3.2 调研 Agent (`cph-researcher-agent-prompt.txt`)
- **核心定位**：极度敏锐的代码侦探与技术分析师。
- **物理与认知双重保障**：
  - **物理隔离**：其工具集仅包含 `read` 与只读检查类命令，**彻底剔除 `edit`、`write` 和 `invoke_subagent`**，底层不具备修改代码的物理能力；
  - **心智塑形**：提示词中明确告知其已被指派专项调研，要求其“*深入阅读相关模块源码、梳理函数调用链与数据流、运行只读测试或重现故障、输出包含确切文件路径与根因分析的详尽调研报告，不进行任何代码变更*”。

### 3.3 编码 Agent (`cph-coder-agent-prompt.txt`)
- **核心定位**：外科手术级精准实现的施工工人。
- **物理与认知双重保障**：
  - **物理隔离**：其可用工具列表中包含 `read`, `edit` / `patch_file`, `bash`，但**严格剔除 `invoke_subagent`**，底层 Parser 与 Bridge 拒绝孙代理调用；
  - **心智塑形**：提示词中明确告知其已被指派专项编码任务，要求其“*迅速阅读被指定的文件、严格利用局部微补丁（Search/Replace）精准实现需求、运行单元测试命令验证通过证据、最后输出包含修改清单与测试结果的标准结题报告*”。

---

## 4. Harness 底层执行核设计 (`SubagentRunner`)

### 4.1 工具协议定义 (`src/protocol/tool-bridge.ts`)
扩展 `CopilotAction` 与工具注册表：

```typescript
export interface SubagentTaskSpec {
  role: "researcher" | "coder" | "custom";
  description: string;
  prompt: string;
  maxTurns?: number; // 默认 15 轮，防止死循环并留出安全余量
}

export interface InvokeSubagentAction extends CopilotAction {
  tool: "invoke_subagent" | "subagent";
  subagents: SubagentTaskSpec[];
}
```

### 4.2 执行核架构 (`src/agent/subagent-runner.ts`)
新建 `SubagentRunner` 类，由主 `Orchestrator` 调用：

```typescript
export interface SubagentRunnerOptions {
  workspaceRoot: string;
  accountPool: IAccountPool;
  chatClientFactory: (token: any, options: any) => IOrchestratorChatClient;
  events?: SubagentRunnerEvents;
}

export interface SubagentTaskReport {
  index: number;
  role: string;
  description: string;
  success: boolean;
  finalAnswer: string;
  turnsUsed: number;
  durationMs: number;
  error?: string;
  reportFilePath?: string;
}
```

#### 关键实现逻辑：
1. **并发拉起与账号调度**：
   ```typescript
   public async executeBatch(tasks: SubagentTaskSpec[], signal?: AbortSignal): Promise<SubagentTaskReport[]> {
     const runPromises = tasks.map((task, idx) => this.executeSingle(task, idx, signal));
     const results = await Promise.allSettled(runPromises);
     return results.map((res, idx) => {
       if (res.status === "fulfilled") return res.value;
       return {
         index: idx,
         role: tasks[idx].role,
         description: tasks[idx].description,
         success: false,
         finalAnswer: "",
         turnsUsed: 0,
         durationMs: 0,
         error: res.reason?.message || "Subagent execution failed",
       };
     });
   }
   ```
2. **独立的 Orchestrator 实例与工具集裁剪**：
   - 为每个子任务分配独立的 `sessionId: sub-${Date.now()}-${idx}`；
   - 根据 `task.role` 构造独立的 `ToolBridge`：
     - 若 `role === "researcher"`：仅开放只读工具；
     - 若 `role === "coder"`：开放 `read`, `edit`, `write`, `bash`；
     - **两者的工具集中均彻底剥离 `invoke_subagent`**。
3. **输出汇总为 Markdown 交付给主会话**：
   - 提取各子任务的 `finalAnswer` 与变更文件清单，拼装为结构化报告文本，作为工具执行结果返回给主会话模型。

---

## 5. 写操作治理与原生文件生成机制 (File Porter 架构与实测确证)

### 5.1 严格限制直接 `write_file`，强制局部 `patch`
为了杜绝流式 Token 溢出与整文件写入破损：
1. **存量代码改动**：强制引导使用基于精准匹配的 `edit` / `patch_file` 局部补丁，禁止全量覆盖写；
2. **新文件新建**：严格限制 Agent 在对话流中通过 `write_file` 吐出数百行大文件代码，转由 Copilot 原生文件生成服务产出，Harness 充当搬运工落盘。

### 5.2 端口 9222 真实浏览器实测确证数据 (Empirical Validation)
在 2026-10-12 对 Chrome 9222 端口运行的 M365 Copilot（Sydney / Web 前端）进行了现场 CDP 物理探针验证，确证了以下核心物理事实：
1. **单轮多文件并发生成能力：100% 支持**
   - 注入测试 Prompt：“*请帮我生成两个独立的代码文件：1. test_math.py 2. test_readme.md，请直接以文件形式生成并提供下载链接。*”
   - Copilot 仅用 1 秒推理，即在同一轮回复中同时生成并输出了这两个独立文件的下载卡片。
2. **下载 URL 的 DOM 物理特征**：
   - 元素结构：标准 HTML 锚点 `<a role="link" download="test_math.py" href="blob:https://m365.cloud.microsoft/<uuid>" target="_blank">`；
   - 包含明确的 `download="<filename>"` 属性与页面同源的 `blob:` URL。
3. **零损耗数据提取通道**：
   - 经测试，在当前页面上下文中直接执行 `await (await fetch(anchor.href)).text()`，无需任何额外鉴权即可瞬间提取到完整、100% 保真的文件源码与 Markdown 文本（实测成功捕获 157 字节的 `test_math.py` 与 192 字节的 `test_readme.md`）。
4. **原生文件逆向挂载通道**：
   - 输入框区域探明存在原生附件上传控件：`<input type="file" id="upload-file-button" multiple="true" accept="...">`，支持 `.md, .py, .ts, .json, .txt, .docx, .sh` 等格式；
   - **CDP 模式**：可通过 `DOM.setFileInputFiles({ files: [absPath], nodeId })` 实现秒级本地文件上传注入；
   - **WebSocket 模式**：可通过现有的 `SubstrateUploader.uploadDocumentToOneDrive` 生成 `AttachmentAnnotation`，以 `messageAnnotations` 原生注入为 Sydney 会话上下文。

### 5.3 File Porter 行为闭环与生命周期状态机
综合实测结果，确立完整闭环：
```
[主 Agent 生成规划文件需求] ──► [Copilot 生成 a[download] blob 链接] ──► [File Porter 执行 fetch(blob) 提取]
                                                                                       │
                                                                                       ▼
[子会话以附件形式无损读取] ◄── [通过 CDP / Substrate 挂载注入新会话] ◄── [Harness 安全落盘至 .cph/tasks/task-*.md]
          │
          ▼
[子 Agent 仅执行 read/patch/bash 攻坚] ──► [子 Agent 生成结题报告] ──► [File Porter 归档至 .cph/reports/ 供主会话裁决]
```

---

## 6. 可观测性与界面渲染方案 (UI & Observability)

### 6.1 当前落地基准：TUI 动态多任务看板与分会话树状隔离日志（方案 A）
在终端环境下实现多子代理并行运行的高保真可观测性与精准对账：

#### 1. 终端屏幕状态矩阵看板 (Live Status Matrix)
- 固定在终端活跃区域渲染各子代理看板，每秒动态刷新（ANSI 行覆盖）；
- 实时展示：`[子代理编号/角色]`、`[状态: RUNNING/COMPLETED/ERROR]`、`[耗时与轮次]`、`[当前执行的具体工具及目标文件]`；
- 子代理完成时折叠展示摘要与结题报告。

#### 2. 分会话树状隔离日志架构 (Per-Session Log Hierarchy)
彻底颠覆单全局文件的串行截获模式，避免并发多代理流式交错污染：
```
.cph/logs/session-<timestamp>/
├── main.log                   # 1. 主会话主线日志 (用户交互、顶层规划、派发决策、终局裁决)
├── subagents/
│   ├── sub-1-researcher.log   # 2. 调研子代理专属全量日志 (CoT、代码阅读链路、诊断结论)
│   └── sub-2-coder.log        # 3. 编码子代理专属全量日志 (微补丁 Diff、测试命令输出、测试证据)
└── timeline.jsonl             # 4. 结构化事件流水 (纳秒级时间戳: 派发、状态变迁、耗时、异常)
```
- **物理流隔离**：每个子代理 `Orchestrator` 实例绑定独立的 `logStream`，零竞争直接写入各自的子日志文件；
- **全链路可追溯**：主会话派发时仅打印精炼索引（例如 `[Dispatch] 任务 #1 已派发 -> 日志: .cph/logs/.../sub-1-researcher.log`），调试复盘时可点对点直接查阅具体子代理的完整 1~15 轮轨迹。

### 6.2 远期演进规划：内嵌轻量 Web 可视化工作台（方案 B）
- 在 `CPH-PI/.docs/specs/` 中留存独立的 Web UI 架构设计；
- 在 `Orchestrator` 与 `SubagentRunner` 中内置标准 `EventBus`，支持后续平滑通过 `--ui web` 启动单页应用（多会话分屏、拓扑树图与实时文档预览）。

---

## 7. 工作区专属 Skill 与自动化打包分发

### 7.1 定制 Skill：`CPH-PI/skills/subagent/SKILL.md`
定义正向拆解指南、正交文件划分标准（避免并发写同一文件冲突）、以及子代理结构化报告模版。

### 7.2 打包构建集成：`CPH-PI/scripts/package-agent-bundle.ts`
更新打包脚本，执行 `bun run package` 时自动完成：
1. 分别提取与验证三份独立系统提示词：`cph-main-agent-prompt.txt`、`cph-researcher-agent-prompt.txt` 与 `cph-coder-agent-prompt.txt`；
2. 打包 `skills/subagent/` 及其配置；
3. 输出至 `dist/agent-bundle/`，生成三 Agent（主控/调研/编码）独立部署与配置说明文档。

---

## 8. 测试与验证计划 (Test & Verification Plan)

1. **单元测试 (`tests/agent/subagent-runner.test.ts`)**：
   - 验证 `invoke_subagent` 接收单任务与批量任务时的参数合法性校验；
   - 验证 Researcher 角色与 Coder 角色的工具集过滤正确（确保工人无 `invoke_subagent`）；
   - 验证 `Promise.allSettled` 并发聚合与单任务异常时的容错降级。
2. **协议与解析测试 (`tests/protocol/subagent-parser.test.ts`)**：
   - 测试 `ResilientParser` 对 `invoke_subagent` 动作指令的解析鲁棒性（Markdown 代码块、纯 JSON、简写格式）。
3. **真实端到端集成验证**：
   - 在多账号配置下运行复杂多文件任务，观察主会话自动调研、拆解派发、多子代理并发执行以及主会话汇总最终结论的全流程。

