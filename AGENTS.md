# CPH-PI Agent 开发与治理规范 (AGENTS.md)

本文件定义了针对 CPH-PI（Copilot M365 x Pi Autonomous Coding Terminal）的自主编程与工程协作规则。所有参与本项目的 AI 智能体与开发者必须严格遵守。

---

## 核心开发与治理准则

### 1. Harness 纯粹与中立原则 (Harness Neutrality)
- **调度纯粹性**：Harness 本身应当保持中立与协议纯粹。无论 Copilot 模型返回何种内容（不论对错），Harness 只管按统一既定协议进行客观处理、工具路由与流式渲染。
- **严禁替模型“擦屁股”**：严禁在 Harness 中引入特化的容错补丁（例如否定词过滤、模糊猜测试图帮模型纠偏）。如果模型输出了期望以外的内容，**应该调整的是系统提示词与专属 Skill 内容**；只有在确认 Harness 本身存在物理实现缺陷或工程 Bug 时，方可修改 Harness 源码。

### 2. 认知塑形与正向引导优先 (Agent Meta-Cognition & Focus)
- **元认知定位**：当模型行为或输出与预期不符时，根本解法是让 Copilot Agent 建立清晰的自我认知与情境感知：明确自身所处的任务阶段、当前首要目标、正确的行动方案以及期望的输出格式。
- **提示词优先**：所有解决模型偏离的着力点，必须聚焦在 Copilot Agent 的系统提示词（`cph-dev-agent-prompt.txt`）以及协议提示词构建器上，而非在底层 Harness 逻辑上打补丁。

### 3. 正向引导铁律：摒弃负面禁止词 (Constructive Guidance Over Prohibitions)
- **避免粉色大象效应**：给 Copilot Agent 编写系统提示词与 Skill 时，尽量不要使用“严禁……”、“切勿……”、“不要……”等负面禁止词，全面转为建设性的正向目标引导。
- **告诉模型什么是对的**：负面词会分散模型的注意力，甚至引发模型在回复中复读禁止语句（导致协议标记意外冲突）。绝大多数情况下，模型出现偏离是因为我们在提示词或 Skill 中没有讲清楚“正确的方式应该怎么做”。明确告知其当前目标与正确行动路径即可。

### 4. 通用 Skill 绝对中立与定制隔离 (Skill Neutrality & Customization Isolation)
- **工作流 Skill 中立性**：绝大多数通用工作流 Skill（如代码质量审查、系统化排错、TDD、方案设计等）都是跨 Harness、跨平台的通用工程实践规范，绝对不是为 Copilot 单独定制的。严禁为了适配 Copilot 或 CPH-PI 的特定机制去篡改通用 Skill 的内容。
- **职责分工明确**：若要让模型更像一个专业的 Coding Agent，应通过系统提示词（System Prompt）进行能力强化与心智建模；唯有像 `handoff` 这样明确为 Copilot 跨会话接力与容灾特性专门研发的专属技能，才允许在工作区内做针对性演进。

### 5. 用户全局配置隔离与工作区打包分发规范 (User Isolation & Workspace Packaging)
- **严禁破坏宿主全局配置**：绝对不要直接修改宿主用户目录（`C:\Users\UserX\...`）下的全局 Skill！
- **工作区就地定制优先**：若当前项目确实需要修改或定制某个 Skill，必须将其完整复制一份到当前工作区目录（`CPH-PI/skills/<skill-name>/`）进行版本化定制。Harness 的 SkillLoader 保证工作区 Skill 优先级高于全局 Skill。
- **一键打包分发**：修改完成后，提供自动化打包脚本将系统提示词与工作区定制 Skill 打包整理至 `dist/` 分发目录，生成可直接导入/上传至 Copilot Studio 或 M365 Agent 的压缩包与文档。

### 6. 行动导向与认知极简准则 (Action-Oriented & Cognitive Minimalism / Black-Box Abstraction)
- **操作者视角而非运维者视角**：Agent 是工作区内的专业攻坚者与操作者，绝非 Harness 底层管道的运维者。系统提示词与 Skill 的唯一使命，是明确 Agent 的“角色定位、当前输入事实、可用工具清单以及行动交付标准（应该怎么做）”。
- **严格隔绝 Harness 底层物理实现细节**：严禁在 Agent 系统提示词或 Skill 中向模型解释底层 Harness 是如何运转的（例如：底层 WebSocket 如何连接与断开、本地快照在哪个底层 JSON 文件如何序列化、底层账号池队列并发度是 1 还是多账号、SignalR 帧解析机制等）。
- **杜绝认知污染与幻觉噪音**：将底层管道机制泄露给 Agent 会严重污染大模型的注意力上下文，诱发模型去臆测、复读或试图操作底层基础设施。提示词与 Skill 必须保持纯粹的黑盒契约：“模型只需专注于标准行动输出，底层调度由系统自动保障”。

### 7. 状态持久化与工作内存正交分层准则 (Orthogonal Separation of Persistence and Working Memory)
- **内存修剪与预写日志严格解耦**：大模型的上下文窗口是极其宝贵的推理工作内存（Working Memory），关注点是在有限窗口内维持极高的决策信噪比；物理世界的状态持久化、工具执行事实与历史证据，由宿主/Harness 底层以零 Token 成本自动追加写入磁盘预写日志（`.cph/state/` 下的 Ledger / WAL）。两者生命周期正交，严禁混为一谈。
- **传引用挂载而非传值倾倒 (Pass-by-Reference over Raw Value Dump)**：在多会话调度、跨会话接力、灾备恢复或成果审阅时，严禁向聊天窗口/Prompt 机械倾倒成千上万行的执行日志或大段报告文本；必须以物理文件形式挂载，Prompt 仅注入包含文件路径、总执行步数、核心文件变更与关键状态码的极简物理指纹（TOC / Fingerprint Header），引导模型使用工具按需定向调阅。
- **杜绝向业务 Agent 转嫁容灾草稿**：严禁要求模型在业务执行过程中“在工作区打临时草稿用于底层故障接力”。业务 Agent 必须全神贯注于交付真正的业务代码、审查报告或架构文档；系统故障容灾与断点状态接力由 Harness 底层物理立桩全权兜底。

---

## 常用开发命令与资产指引
- **系统提示词主文件**：`cph-dev-agent-prompt.txt`
- **专属定制技能目录**：`skills/handoff/SKILL.md`
- **打包部署命令**：`bun run package`
- **自动化测试套件**：`bun test tests/`

