# CPH-PI Agent 开发与治理规范 (AGENTS.md)

本文件定义了针对 CPH-PI（Copilot M365 x Pi Autonomous Coding Terminal）的自主编程与工程协作规则。所有参与本项目的 AI 智能体与开发者必须严格遵守。

---

## 核心开发与治理准则

## 核心开发与治理准则 (Core Development & Governance Principles)

1. **Harness 纯粹与中立原则 (Harness Neutrality)**
   - Harness 本身必须保持绝对中立与纯粹：无论 Copilot 模型返回什么内容、内容是对是错，Harness 只管按统一既定协议进行客观处理与调度，严禁在 Harness 代码中给模型打特化补丁或“替模型擦屁股”。
   - 当模型输出不符合预期时，排查与改进的首要对象是 **Agent 系统提示词** 与 **专属 Skill**；除非确认是 Harness 自身存在物理实现缺陷或工程 Bug，否则绝不轻易修改 Harness。

2. **认知塑形与正向引导优先 (Agent Meta-Cognition & Focus)**
   - 模型行为异常的根本解法，是让 Copilot Agent 建立清晰的自我认知与情境感知：明确自身所处的任务阶段、当前首要目标、正确的行动方案以及期望的输出格式。
   - 所有精力与重构重心应当放在 Copilot Agent 的系统提示词设计上，通过清晰的认知边界引导模型自主做出正确决策，而不是在 Harness 调度层做妥协。

3. **正向引导铁律：摒弃负面禁止词 (Constructive Guidance Over Prohibitions)**
   - 编写系统提示词与 Skill 时，杜绝使用“严禁……”、“切勿……”、“不要……”等负面禁止词，全面转为建设性的正向引导。
   - 负面词极易引发“粉色大象”效应（注意力分散、诱发模型复读禁用关键词进而导致协议解析冲突）。在绝大多数情况下，模型出现偏离是因为我们在提示词或 Skill 中没有讲清楚“正确的方式应该怎么做”。

4. **通用 Skill 绝对中立与定制隔离 (Skill Neutrality & Customization Isolation)**
   - 绝大多数通用工作流 Skill（如代码质量审查、系统化排错、TDD 等）都是跨 Harness 中立的通用工程规范，绝不是为 Copilot 单独定制的。严禁为了适配 Copilot 或 CPH-PI 的局部实现去篡改这些通用 Skill 的内容。
   - 若要增强模型表现，应通过优化 Agent 系统提示词让其成为真正的 Coding Agent；唯有像 `handoff` 这样明确为 Copilot 跨会话接力与容灾特性专门研发的专属技能，才允许在工作区内做针对性演进。

5. **用户全局配置隔离与工作区打包分发规范 (User Isolation & Workspace Packaging)**
   - 严禁直接修改宿主用户目录（`C:\Users\UserX\...`）下的全局 Skill！
   - 若当前项目确实需要修改或定制某个 Skill，必须将其完整拷贝至当前工作区目录（如 `CPH-PI/skills/<skill-name>/`）进行版本化定制开发，工作区内部定制优先于全局。
   - 修改完成后必须提供标准打包机制，将提示词与定制 Skill 打包整理至分发目录，方便用户直接上传部署至 Copilot / M365 Agent。

6. **行动导向与认知极简准则 (Action-Oriented & Cognitive Minimalism / Black-Box Abstraction)**
   - **操作者视角而非运维者视角**：Agent 是工作区内的专业攻坚者与操作者，绝非 Harness 底层管道的运维者。系统提示词与 Skill 的唯一使命，是明确 Agent 的“角色定位、当前输入事实、可用工具清单以及行动交付标准（应该怎么做）”。
   - **严格隔绝 Harness 底层物理实现细节**：严禁在 Agent 系统提示词或 Skill 中向模型解释底层 Harness 是如何运转的（例如：底层 WebSocket 如何连接与断开、本地快照在哪个底层 JSON 文件如何序列化、底层账号池队列并发度是 1 还是多账号、SignalR 帧解析机制等）。
   - **杜绝认知污染与幻觉噪音**：将底层管道机制泄露给 Agent 会严重污染大模型的注意力上下文，诱发模型去臆测、复读或试图操作底层基础设施。提示词与 Skill 必须保持纯粹的黑盒契约：“模型只需专注于标准行动输出，底层调度由系统自动保障”。

7. **状态持久化与工作内存正交分层准则 (Orthogonal Separation of Persistence and Working Memory)**
   - **内存修剪与预写日志严格解耦**：大模型的上下文窗口是极其宝贵的推理工作内存（Working Memory），关注点是在有限窗口内维持极高的决策信噪比；物理世界的状态持久化、工具执行事实与历史证据，由宿主/Harness 底层以零 Token 成本自动追加写入磁盘预写日志（`.cph/state/` 下的 Ledger / WAL）。两者生命周期正交，严禁混为一谈。
   - **传引用挂载而非传值倾倒 (Pass-by-Reference over Raw Value Dump)**：在多会话调度、跨会话接力、灾备恢复或成果审阅时，严禁向聊天窗口/Prompt 机械倾倒成千上万行的执行日志或大段报告文本；必须以物理文件形式挂载，Prompt 仅注入包含文件路径、总执行步数、核心文件变更与关键状态码的极简物理指纹（TOC / Fingerprint Header），引导模型使用工具按需定向调阅。
   - **杜绝向业务 Agent 转嫁容灾草稿**：严禁要求模型在业务执行过程中“在工作区打临时草稿用于底层故障接力”。业务 Agent 必须全神贯注于交付真正的业务代码、审查报告或架构文档；系统故障容灾与断点状态接力由 Harness 底层物理立桩全权兜底。

8. **大文件写操作治理与原生文件生成/搬运准则 (Native File Generation & File Porter Paradigm)**
   - **摒弃内联大代码倾倒**：在对话流或工具参数（如 `write_file(content=...)`）中直接倾倒长篇代码极易遭遇微软单轮 Token 截断、尖括号剥离、转义损坏与 WAF 审查拦截，是高风险操作。
   - **存量代码小步精准打补丁**：对已存在的文件，全面采用基于唯一匹配的局部编辑（`edit` / `patch_file`），实现最小变更面与零截断。
   - **新增脚本与长文件强制走原生生成 + File Porter 搬运**：当需要新建独立代码文件、完整模块或长篇技术文档时，引导 Agent 采用 Copilot 原生文件生成服务，产出带有 `download` 属性的可下载文件卡片；由外部 Harness 充当纯粹的搬运工（File Porter），在宿主侧秒级拉取该下载链接并安全落盘至本地目标路径或执行，构建“云端原生生成 ➔ 本地无损搬运 ➔ 宿主执行对账”的高韧性交付闭环。

9. **全量附件投递与杜绝内联倾倒准则 (Full Cloud Attachment & Lossless File Delivery)**
   - **文本与代码全量附件化**：无论是文件读取（`read_file`）、复杂日志、多行数据还是代码交付，无论体积大小（即便 ≤32KB），统一通过云端附件（OneDrive/SharePoint）或工作区物理文件挂载形式交付给模型，杜绝直接在聊天 WebSocket 消息流中内联倾倒多行文本。
   - **彻底终结编码与格式损毁**：通过独立文件二进制流传输，从根源上隔绝 Windows 控制台（GBK/UTF-16LE）转码失真、HTML/XML 尖括号 `<T>` 被前端 DOM 清洗吞噬、转义损坏以及 Sydney 网关 WAF 审查拦截，确保 100% 原始字节保真与结构完整。
   - **废弃虚假截断与分页死循环**：Copilot 底层由 Substrate 云端 RAG 引擎驱动，附件无论多大均由云端建立索引并按需精准召回，绝不会因文件体积打爆模型上下文。全面废弃本地 50KB / 2MB 等人为截断与分页式（offset/limit）读取模式，仅保留系统物理内存硬边界（如 100MB），从源头斩断模型因局部截断而在分页读取中反复空转的死循环。

10. **Work IQ 企业内部数据访问与底座调用准则 (Work IQ & Enterprise Data Grounding Invariant)**
    - **企业内部数据与云端工作区访问底座**：在 CPH-PI 与 Copilot 交互架构中，模型访问企业内部数据（SharePoint 站点文档、OneDrive 附件、Teams 消息对象、企业知识库与 Graph 图谱索引）的核心引擎是 **Work IQ（M365 Substrate Enterprise Search / Enterprise Grounding）**。
    - **如何调用与激活 Work IQ**：
      1. **Agent 身份与模式绑定**：WebSocket 连接（`ChatHubClient`）必须绑定已开启企业工作区权限的声明式 Custom Agent ID（如 `DEFAULT_MAIN_AGENT_ID` / `DEFAULT_CODER_AGENT_ID`），使请求走 `agent: "Agent"`（BizChat 企业租户路由），而非缺失企业数据权限的普通个人 Web 模式（`agent: "web"`）。
      2. **会话初始化契约**：建立新会话或发起首轮查询时，必须生成标准 UUID 格式的 `conversationId`、`sessionId` 与 `requestId`，且首轮必须显式携带 `isStartOfSession: true`。
      3. **云端附件与 URL 规范**：通过 `SubstrateUploader`（Graph API OneDrive 上传）生成的 `File` 注释（`annotation`）挂载在消息帧 `annotations` 数组中；当通过提示词向模型提供 SharePoint 文件直链时，必须将路径中的空格等特殊字符严格编码为 `%20`（使用 `encodeUrlPathSegments`），使 Work IQ 的 `turn1search` 检索器能够精准解析并拉取企业文档原文。
    - **演进硬性前提**：后续所有架构修改、功能更新、基准实验与集成验证，**必须默认在启用 Work IQ（即绑定企业 Agent ID + 标准会话握手 + 合法编码 URL / 云端附件挂载）的基础上开展操作**。

11. **Harness 能力与系统提示词协同登记铁律 (Harness-Prompt Co-Design & Registration Invariant)**
    - **双向契约对齐**：Harness 底层实现的任何模型交互能力、工具扩展、状态回执或协议解析规则，与 Agent 系统提示词（`cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt` 等）是一个不可分割的整体。
    - **有功能必有登记**：凡是在 Harness 中新增或调整了涉及模型输入/输出的功能（例如：新增 `remote-workspace-catalog.md` 附件挂载、支持 `write_file` 传入 `url` 下载链接、要求 `FINAL_ANSWER` 置顶声明落盘路径、回传文件落盘与云端同步回执等），**必须在系统提示词中同步完成明确的引导、协议登记与使用介绍**，并同步更新 `package/agent-bundle/` 下的分发包。绝不允许出现“Harness 写了拦截逻辑但系统提示词未告知模型怎么用”或“系统提示词教了某种格式但 Harness 未实现解析”的脱节现象。

12. **工作区变更即时入库与清洁树铁律 (Atomic Git Hygiene & Clean Working Tree)**
    - **原子提交**：任何对工作区文件的修改（新增、编辑、删除、重命名、生成物更新）完成后，立即以一次意图清晰的提交纳入 Git；提交信息写清“改了什么、为什么改、影响面”。
    - **清洁树检查点**：每次任务收尾、切换分支、交接或交付前，运行 `git status --porcelain` 并保持输出为空。需要长期存在的源码、测试、提示词、技能、构建脚本、Web 配置与设计文档全部纳入跟踪；临时日志、截图、缓存只放在 `.gitignore` 覆盖的目录。
    - **幽灵依赖零容忍**：新建模块（例如 `src/tools/`、`src/web/static-handler.ts`、`web/` 构建配置）必须与首次引用它的提交同批入库。任何历史 tag 都必须能独立 `git checkout` 后构建成功，杜绝“能跑但没跟踪”的情况。
    - **先保全后施工**：需要回滚或大改时，先把当前现场提交为 WIP 分支/tag，再在干净基线上施工；同一工作区内按“改动 → 验证 → 提交”闭环推进，避免多任务未提交改动互相叠加。
    - **实验与产物**：基准实验脚本与结果需要复现时一并提交（或放入受跟踪的 `.docs/experiments/`）；一次性调试脚本在结束前清理或移入 `.gitignore` 覆盖目录。


---

## 常用开发命令与资产指引
- **系统提示词主文件**：`cph-dev-agent-prompt.txt`
- **专属定制技能目录**：`skills/handoff/SKILL.md`
- **打包部署命令**：`bun run package`
- **自动化测试套件**：`bun test tests/`

