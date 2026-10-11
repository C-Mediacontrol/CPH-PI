# CPH-PI 智能交接双保险、交互式问答与全量代码直传规范设计

## 1. 背景与问题定义 (Problem Statement)

在超长工况测试日志（`Library/LOGS3`）中，系统暴露了 4 个相互关联的核心瓶颈：

1. **交接文档缺乏 AI 核心思考与架构洞察 (LOGS3 704–795)**：
   - 现状：交接文档由 Harness 静态代码模板机械拼装，只记录了物理工具调用次数和命令行，毫无对被审查代码的主观观点与缺陷见解。
   - 根因：`cph-dev-agent-prompt.txt` 中严格限制 Thought 为单行且禁止长篇推理，Agent 被实质性禁言；Harness 达到单次会话上限时粗暴切断，未留出交接总结轮；且缺乏阶段性笔记落盘机制。
2. **`ask_question` 被模型调用却未获 Harness 响应 (LOGS3 954–965)**：
   - 现状：模型因无法看到附件源码而调用 `ask_question` 绝望抗议，但 Harness 瞬间回执假成功 `[Question prompted]: ...`，终端没有停顿，用户未见提示。
   - 根因：`cli.ts` 实例化 `ToolBridge` 时未挂载 `onQuestion` 回调函数，降级回退为静默字符串。
3. **会话接力挂起后难以继续，且默认接力轮次过少 (LOGS3 4921–4932)**：
   - 现状：连续接力达到上限（3 次）后挂起，用户输入提示的 `/resume <id>` 仅切换了指针并未继续推演；默认 3 次接力在超长任务中过早中断。
   - 根因：`cli.ts` 硬编码 `maxAutonomousHandoffHops = 3`，且 `/resume` 未包含自动恢复执行逻辑。
4. **AI 被迫使用 Python 游标分段切片读取文件 (LOGS3 580–770)**：
   - 现状：AI 编写脚本以每批 80–120 行翻页读取 1433 行的 `JsygtBatch.psm1`，消耗几十轮。
   - 根因：Harness 云端附件阈值过苛（超过 20 行或 800 字符即上传 OneDrive 并截断正文），而云端 Copilot 无法即时读取附件正文导致失明；同时 Agent 提示词给出了 `limit: 100` 切片诱导。

---

## 2. 生态方案调研与借鉴 (Ecosystem Benchmarks)

参考开放代理技能生态（Open Agent Skills Ecosystem）中安装量最大的方案：
- **`mattpocock/skills@handoff` (95.4万次安装)**
- **`rohitg00/agentmemory@handoff` (1.2万次安装)**

提炼出 4 项交接黄金原则：
1. **严格分离客观事实与主观心智模型 (Facts vs Mental Model)**：机械工具列表与命令只作为审计基线；必须建立专属区域承载 Agent 对工程的系统性认知与架构判断。
2. **产物引用代替全量文本内联 (Artifact References)**：中间阶段性成果沉淀为工作区文件（如 `.cph/review_draft.md`），交接文档通过路径引用与核心摘要建立锚点，避免下一会话上下文爆炸。
3. **明示已发现的反模式与暗坑 (Caveats & Anti-Patterns)**：明确告知接力 Agent 已探明的死胡同与代码漏洞。
4. **上下文封闭的明确首要动作 (Immediate Actionable Next Steps)**：新会话开局无需重新探索，直接基于前序结论切入指定行或模块。

---

## 3. 设计原则 (Design Principles)

1. **双端协同改造原则（硬门槛）**：严禁只改本地 Harness 或只改云端 Agent Prompt。Prompt、Skill 与本地 Harness 必须同步演进、语义对齐。
2. **充分释放大模型上下文红利**：现代模型具备 128k+ 窗口，代码审阅必须以整文件全景阅读优先，消除病态截断。
3. **人机协同透明可控**：破坏性操作或语义提问必须接管终端，保证真实用户知情与交互响应。

---

## 4. 详细模块设计 (Detailed Design)

### 模块一：AI 深度思考交接双保险 (Smart Handoff Dual-Insurance)

#### 1. 过程保险（增量落盘契约）
- **Agent Prompt & Skill 规范**：
  在 `cph-dev-agent-prompt.txt` 与 `thermo-nuclear-code-quality-review/SKILL.md` 中增加规定：
  在代码审查或大规模重构任务中，每当审阅完一个模块或得到关键证据，Agent 必须通过 `patch_file` 或 `write_file` 向工作区 `.cph/review_draft.md` 中追加其真实的主观审查见解、已发现反模式与待深入线索。
- **Harness 自动聚合**：
  `orchestrator.ts` 在合成交接文档时，若检测到工作区存在 `.cph/review_draft.md`，提取其最新内容注入到交接文档的 `## 2. 【阶段性技术审计发现与核心见解 (Review Draft)】` 章节。

#### 2. 终局保险（预交接总结轮，Turn `maxTurns - 1`）
- **触发机制**：
  在 `orchestrator.ts` 的推演循环中，当 `turn === this.maxTurns - 1` 时：
  Harness 不再下发普通的下一步提示，而是向模型发出带有高优先级标记的【交接准备信号】：
  ```text
  [SYSTEM NOTICE]: 当前会话即将在下一轮达到单次推理上限。请暂停常规工具调用，基于已读源码和前序探索，输出你的【深度技术总结与接力备忘录】（包含对当前项目的整体架构意见、关键缺陷与下一会话优先任务），格式以 HANDOFF_MEMO: 开头。
  ```
- **备忘录捕获与装配**：
  模型在最后一轮输出 `HANDOFF_MEMO: ...` 总结。
  Harness 解析并提取该文本，直接作为交接文档的 `## 3. 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】`，使得接力会话无缝继承前任 Agent 的完整心智。

---

### 模块二：交互式 `ask_question` 终端打通

1. **接口挂载**：
   在 `src/cli.ts` 构造 `CopilotOrchestrator` 时，实例化 `ToolBridge` 并注入 `onQuestion` 回调：
   ```typescript
   onQuestion: async (qArgs) => {
     return await this.handleInteractiveQuestion(qArgs);
   }
   ```
2. **终端交互与卡片渲染**：
   - 当检测到 `qArgs.question` 时，TUI 渲染醒目的提问卡片；
   - 若附带 `qArgs.options`，自动格式化为数字选项（如 `[1] 是  [2] 否`）；
   - 挂起推理循环，调用 `readline.question` 监听用户键盘输入；
   - 用户回车后，格式化为标准输入格式：
     `[USER_RESPONSE for ask_question]: ${userAnswer}`
     回传给模型。

---

### 模块三：10 次自主接力跃迁与智能自动续跑 (`/resume` & `/continue`)

1. **默认跃迁上限提升**：
   - 将 `cli.ts` 中的 `maxAutonomousHandoffHops` 默认值从 `3` 改为 `10`；
   - 支持命令行参数 `--max-hops <n>` 动态调整。
2. **`/resume` 智能续跑**：
   - 修改 `cli.ts` 的 `/resume <id>` 命令：
     若恢复的会话包含未消费的 `handoffSnapshot` 或处于挂起接力态，在重置上下文后**直接自动调用 `executeTask()` 恢复推演**，并在终端提示 `✔ 已恢复并继续执行接力任务...`。
3. **新增 `/continue`（别名 `/relay`）命令**：
   - 允许用户直接输入 `/continue` 或 `/relay`，无需记住长 ID，自动选取最新挂起的接力快照就地激活推演。

---

## 模块四：源码全量投喂与防爆阈值 (Full-File Delivery Policy)

1. **Harness 阈值大幅拓宽**：
   - 修改 `src/agent/orchestrator.ts`：
     - `cloudAttachmentThresholdChars`: `800` → `120,000`（120 KB）
     - `cloudAttachmentThresholdLines`: `20` → `3,000` 行
   - 常规代码文件（1,000–2,500 行）100% 完整内联，模型 1 轮内获得全局视野。
   - 仅对超过 3,000 行的超大型日志保留保护性截断或附件隔离。
2. **Agent 提示词与 Skill 修正**：
   - 更新 `cph-dev-agent-prompt.txt`：
     - 删除 `limit: 100` 示例；
     - 增加硬性规则：“**代码审阅必须使用 `tool: read_file` 一次性读取完整源文件。严禁编写 Python 游标或切片脚本**；仅在遇到超过 3,000 行的巨型日志且 Harness 明确提示超限时，方可按需切片”。
   - 更新 `thermo-nuclear-code-quality-review/SKILL.md`，强化全景审阅契约。

---

## 5. 影响范围与修改文件 (File Impact Scope)

| 文件路径 | 改动性质 | 职责说明 |
| :--- | :--- | :--- |
| `cph-dev-agent-prompt.txt` | Prompt | 解除单行 Thought 禁言；建立全量读取法则；建立 `HANDOFF_MEMO` 契约 |
| `~/.gemini/config/skills/thermo-nuclear-code-quality-review/SKILL.md` | Skill | 确立 `.cph/review_draft.md` 阶段性落盘与全量审阅指引 |
| `src/agent/orchestrator.ts` | Harness | 放宽阈值至 120k字/3k行；加入第 `maxTurns - 1` 轮预交接召唤；注入 AI 思考与草稿至交接文档 |
| `src/protocol/prompt-builder.ts` | Harness | 新增预交接召唤 Prompt 模板与增强型交接快照格式 |
| `src/protocol/tool-bridge.ts` | Harness | 完善 `ask_question` 动作流与参数映射 |
| `src/cli.ts` | Harness | 挂载真实 `onQuestion`；默认跃迁上限设为 10；`/resume` 智能续跑与 `/continue` 支持 |
| `src/ui/tui-renderer.ts` | Harness | 渲染交互式 `ask_question` 卡片与接力续跑状态 |

---

## 6. 验证与测试方案 (Verification Plan)

1. **自动化单元测试**：
   - 编写 `tests/agent/smart-handoff.test.ts`：验证预交接召唤（Turn `maxTurns - 1`）能正确生成提示并提取 `HANDOFF_MEMO`；
   - 编写 `tests/protocol/interactive-question.test.ts`：验证 `ToolBridge` 在传入 `onQuestion` 回调时能正确调用并返回结果；
   - 编写 `tests/cli/resume-continuation.test.ts`：验证 `/resume` 和 `/continue` 在存在 `handoffSnapshot` 时能自动触发执行。
2. **端到端长任务场景验证**：
   - 针对 `JsygtBatch.psm1`（1433 行）执行读取，确认 1 轮内完整返回正文且不触发 OneDrive 附件截断；
   - 模拟触发 `ask_question`，确认终端呈现黄色卡片并能接收键盘输入；
   - 运行 30 轮审查，确认交接文档完整包含 AI 对源码的实质性分析和 `.cph/review_draft.md` 引用；
   - 验证接力会话自动继承，单次任务可稳定推进至 10 次接力。

