# CPH-PI 自主长任务规划与全量无损架构设计规范

- **文档标识**: `CPH-PI-SPEC-20261016-AUTONOMOUS-ARCH`
- **日期**: 2026-10-16
- **状态**: 已批准 (Approved)
- **关联依据**:
  - `E:\test\.cph\logs\cph-terminal-2026-10-15T15-37-45.log` 执行复盘
  - 核心治理准则 (`e:\copilot-web proxy\AGENTS.md`)
  - 标杆项目 ARTEX 自主长任务规划闭环架构

---

## 1. 背景与复盘痛点分析

在长任务实战测试（`CNNJI QUERY` 代码审计，耗时 1.5 小时，跨越 5 代会话与 5 组子代理）中，系统取得了重大突破：成功沉淀了 20.7KB 的高水平审查报告（`CNNJI-review-report.md`）与多组复现沙盒脚本，并在遭遇多次 429 频控与连接中断时保持了物理资产不丢失。

然而，测试暴露出六大阻碍全流程自主交付的系统性断层：
1. **Harness 物理切片限死**：`tool-bridge.ts` 硬编码了 `MAX_READ_SLICE_LINES = 100`，与提示词宣告的“全量直通阅读”严重冲突。子代理被迫每轮仅读 40~100 行，读取 3 个千行文件耗尽 127 轮，导致无损云端附件管道（`SubstrateUploader`）完全无法被触发。
2. **黑匣子失忆与宏观目标丢失**：`blackbox-compactor.ts` 在事故压缩中只保留末尾案发现场，丢弃了用户第一轮输入的原始目标（`rootUserPrompt`）。仲裁会话（Arbitrator）在失去北极星目标后，凭有限的阅读片段生成了消极的防御性交接条款（“*若仅为交接，核验后即可交付*”）。
3. **工作内存被机械倾倒冲垮**：`cli.ts` 在跨会话接力时将 12KB 交接文档全文倾倒进 `currentTaskPrompt`，违反了 `AGENTS.md` 规则 7（传引用挂载原则），稀释了模型的决策注意力。
4. **缺乏客观收敛图谱，诱发提前早退**：接力模型忠实执行完交接文档的 P0 待办（核对基线与哈希）后，因缺少对全项目整体攻坚进度的感知，误以为战役已结束，提前输出了 `FINAL_ANSWER`。
5. **任务体量“轮数玄学”失效**：`subagent` 技能以模糊的“10~20 轮黄金区间”作为粒度指引，模型无法在派发前感知轮数，将 3500+ 行的 3 个大文件打包给单一子代理，导致子代理超时。
6. **子代理冷启动探路空转**：子代理首轮提示词未内化环境与规范，子代理前 5 轮全在到处找 `SKILL.md` 和测试 Shell 环境，造成严重轮次浪费。

---

## 2. 对标 ARTEX：自主长任务规划的核心架构精髓

参考在自动化渗透测试中展现卓越规划力的开源标杆项目 ARTEX，结合 Copilot M365 的 WebSocket / SignalR 长会话特征，确立以下架构演进范式：

| 核心维度 | 传统打补丁做法 (Anti-Pattern) | CPH-PI 目标架构 (ARTEX-Inspired) |
|---|---|---|
| **规划与执行分层** | 主控自己下场读写代码、调试命令，烧光轮次 | **主控纯粹化**：主控只做 Plan、拆解工单、审阅与对账，所有实施 100% 委派 |
| **收敛进度度量衡** | 依赖大模型的主观“感觉”，容易提前早退 | **物理任务清单 (Plan Checklist) 单一真实源**：只有物理清单全部 `[x]` 才允许收敛 |
| **跨会话状态沉淀** | 机械倾倒成千上万行长文本，污染 Working Memory | **附件挂载 + 极简指纹 (Pass-by-Reference)**：10KB 交接文档走附件，Prompt 只留 200 字指纹 |
| **故障容灾韧性** | 发生中断后丢失总目标，仲裁者猜疑消极退化 | **根目标不可变性穿透 (Root Invariant)**：无论经历多少次接力，用户终极目标永不丢失 |
| **子代理认知负担** | 让子代理去读大篇幅 Skill 哲学，前 5 轮全在找技能 | **Skill 彻底内化**：主控消化 Skill 并物理切片，子代理零 Skill 认知，Turn 1 直奔代码 |

---

## 3. 详细设计规范 (Design Specifications)

### 3.1 传输与阅读层：彻底废除硬编码，全量无损直通

1. **废除 `MAX_READ_SLICE_LINES`**：
   - 物理删除 [`CPH-PI/src/protocol/tool-bridge.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/tool-bridge.ts) 中的 `MAX_READ_SLICE_LINES = 100`；
   - 移除 `const limit = Math.min(requestedLines, MAX_READ_SLICE_LINES)` 限制逻辑。
2. **意图直通映射 (No-Surprise Protocol)**：
   - 当模型传了 `start_line` / `end_line`（局部切片意图）时，精准返回对应行区间；
   - 当模型未传切片参数（常规 `read_file(path)`）时，**不施加任何行数限制，底层直接全量读取整份文件**。
3. **激活无损附件交付管道**：
   - 当文件体量较大（>200 行或 >12000 字符）时，自然触发 [`orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts) 中已就绪的 `SubstrateUploader.uploadDocumentToOneDrive`；
   - 完整内容上传至 OneDrive 并作为原生 `LocalFile` 附件挂载，消息流仅回显状态提要，模型文档解析器直读全量数据。

---

### 3.2 角色定位层：主控纯统帅重塑与权限彻底剥离

1. **主控权限剥离**：
   - 从 [`cph-main-agent-prompt.txt`](file:///e:/copilot-web%20proxy/CPH-PI/cph-main-agent-prompt.txt) 移除 `patch_file` 与直接写业务代码的工具权限；
   - 主控仅保留：`read_file`（宏观探查与报告审阅）、`run_command`（全局状态检查）、`invoke_subagent`（调派攻坚）与 `write_file`（仅限创建与更新物理任务清单）。
2. **两阶段演进铁律**：
   - **Phase 1 探查与立桩（Turn 1~2）**：阅读需求与既有目录，在工作区创建物理计划书（如 `test/<task>-plan.md`）；
   - **Phase 2 纯调度与裁决（Turn 3+）**：主控严禁亲自修改业务代码。唯一行动是调派子代理、审阅回传结果并在 `plan.md` 打勾；若子代理失败，主控动作是“基于教训细化切片并重新调派”，绝不亲自下场肉搏。

---

### 3.3 收敛控制层：物理任务清单（Plan Checklist）驱动

1. **工作区物理立桩**：
   - 主控在 Turn 1~2 建立标准复选框清单：
     ```markdown
     # 工程攻坚任务计划书 (Task Plan)
     - 终极目标: <用户原始需求摘要>
     - 报告归宿: <报告文件绝对路径>

     ## 模块攻坚矩阵
     - [ ] 模块 A (关注点: ...)
     - [ ] 模块 B (关注点: ...)
     ```
2. **动态闭环重规划 (Re-planning Loop)**：
   - 子代理成功：主控局部编辑清单为 `- [x] 模块 A (已通过)`；
   - 子代理失败：主控记录原因，并在清单中将其拆解为 2 个更小的单一文件子项；
3. **终局门禁 (Convergence Gate)**：
   - 提示词硬性规定：只要物理清单上仍有未勾选的 `- [ ]`，主控在逻辑上**绝对不允许输出 `FINAL_ANSWER`**。

---

### 3.4 灾备与接力层：根目标穿透与两级 Handoff 契约

1. **根目标不可变性穿透 (Root Invariant)**：
   - 修改 [`blackbox-compactor.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/blackbox-compactor.ts)，将首轮 `rootUserPrompt` 提取为独立核心字段，在事故黑匣子中物理置顶，禁止参与任何压缩或折叠；
   - 仲裁会话和所有后继接力会话启动时，首行必须清晰显式展示用户原始终极目标。
2. **仲裁者提示词清洗**：
   - 修改 [`orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts) 中的 `arbitratorPrompt`，删除“核验后即可交付”等一切消极暗示；
   - 引导仲裁者聚焦两件事：提炼已完成的客观事实 + 列出物理 `plan.md` 中尚未完成的核心业务待办。
3. **Handoff 技能两级分化 ([`skills/handoff/SKILL.md`](file:///e:/copilot-web%20proxy/CPH-PI/skills/handoff/SKILL.md))**：
   - 待办事项强行拆解为两级：
     - **`P0 (断点现场恢复)`**：核对断点、回读报告；
     - **`P1 (战役核心推进)`**：明确指引接力主控接续调派子代理攻坚 `plan.md` 中未勾选的模块；
   - 严禁将 P0 跑完视作终局交付。
4. **接力载入轻量化 (Attachment-First)**：
   - 修改 [`cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts)，`handoff.md` 全文通过 `SubstrateUploader` 作为会话原生附件送达；
   - 用户消息输入（Prompt）仅注入 200 字高信噪比物理指纹头（根目标 + Plan 进度摘要 + 附件路径引导）。

---

### 3.5 子代理调度层：物理边界约束与 Skill 彻底内化

1. **三大物理指标取代“轮数玄学” ([`skills/subagent/SKILL.md`](file:///e:/copilot-web%20proxy/CPH-PI/skills/subagent/SKILL.md))**：
   - **单模块配额**：单个子任务核心目标源文件严格为 **1 个**（外加最多 1 个关联测试文件）；
   - **大文件独立化**：源文件 > 500 行必须独占一个子任务，严禁与其他模块拼车；
   - **单关注点原则**：子任务 Prompt 仅限 1~2 个明确排查假设或单点缺陷。
2. **Skill 彻底内化，子代理零 Skill 认知**：
   - 只有主控挂载并阅读 Skill；
   - 主控将 Skill 的宏观哲学转化为纯粹客观的物理工单，**派发给子代理的 Prompt 中严禁出现任何 Skill 名称或文件路径**；
   - 子代理（Researcher / Coder）提示词明确为纯执行者，Turn 1 直达目标源码，消除一切冷启动找环境、找技能的空转。

---

### 3.6 终端人机交互层：交付物自动展板 (Artifact Card)

1. **主控交付格式标准化**：
   - `FINAL_ANSWER` 必须以结构化文本输出 Executive Summary（核心发现 Top 3、关键漏洞、指标数据）以及交付报告路径。
2. **TUI 自动展板渲染 ([`tui-renderer.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/ui/tui-renderer.ts))**：
   - 渲染引擎捕捉到 `FINAL_ANSWER` 并探测到物理报告文件时，在终端自动渲染带框线的成果交付展板（展示文件路径、大小、章节提要与核心结论），使用户在终端直观审阅成果。

---

## 4. 物理文件变更清单 (Physical File Manifest)

| 目标文件 | 归属模块 | 核心变更内容 |
|---|---|---|
| [`CPH-PI/src/protocol/tool-bridge.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/tool-bridge.ts) | Harness 工具层 | 删除 `MAX_READ_SLICE_LINES = 100`，重构 `read_file` 为无硬编码截断 |
| [`CPH-PI/src/agent/blackbox-compactor.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/blackbox-compactor.ts) | 灾备容灾层 | 置顶不可变 `rootUserPrompt`，杜绝事故黑匣子失忆 |
| [`CPH-PI/src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts) | 调度核心层 | 净化仲裁者提示词，移除消极早退引导；确保附件安全挂载 |
| [`CPH-PI/src/cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts) | 交互驱动层 | 跨会话接力改用 LocalFile 附件挂载交接文档，Prompt 注入极简指纹头 |
| [`CPH-PI/src/ui/tui-renderer.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/ui/tui-renderer.ts) | 界面渲染层 | 增加 `renderFinalArtifactCard`，自动解析并高亮回显终局报告 |
| [`CPH-PI/cph-main-agent-prompt.txt`](file:///e:/copilot-web%20proxy/CPH-PI/cph-main-agent-prompt.txt) | 系统提示词 | 纯规划统帅重构，剥离写权限，引入物理 Plan 立桩与收敛门禁 |
| [`CPH-PI/cph-researcher-agent-prompt.txt`](file:///e:/copilot-web%20proxy/CPH-PI/cph-researcher-agent-prompt.txt) | 系统提示词 | 纯执行者认知，无 Skill 依赖，单文件专注排查 |
| [`CPH-PI/cph-coder-agent-prompt.txt`](file:///e:/copilot-web%20proxy/CPH-PI/cph-coder-agent-prompt.txt) | 系统提示词 | 纯单点微补丁执行者，无 Skill 依赖，单测试闭环 |
| [`CPH-PI/skills/subagent/SKILL.md`](file:///e:/copilot-web%20proxy/CPH-PI/skills/subagent/SKILL.md) | 工作区技能 | 废除轮数玄学换装三大物理指标，禁止子代理读 Skill，绑定物理 Plan |
| [`CPH-PI/skills/handoff/SKILL.md`](file:///e:/copilot-web%20proxy/CPH-PI/skills/handoff/SKILL.md) | 工作区技能 | 绑定物理 Plan 勾选状态，待办事项两级分化，严禁阶段恢复充当终局 |

