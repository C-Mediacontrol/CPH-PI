# 全云端零 IO 工作区架构与智能体认知体系重构设计规范 (Zero-IO Cloud Workspace & Agent Cognitive Overhaul)

- **文档状态**: Approved
- **制定日期**: 2026-10-25
- **适用工程**: `CPH-PI`
- **关联前序规范**:
  - `2026-10-20-pnp-sharepoint-cloud-repo-sync-design.md`
  - `2026-10-24-cloud-workspace-folder-dual-track-sync-design.md`

---

## 1. 背景、核心痛点与实证基线 (Context & Empirical Baseline)

### 1.1 长任务失败与轮次空转的四大根因
通过对 `E:\test` 工作区两轮真实长任务日志（`cph-terminal-2026-10-24T13-07-26.log` 与 `cph-terminal-2026-10-24T16-37-40.log`）的深度溯源，确认导致任务耗时 40+ 分钟仍无法产出最终报告、且云端工作区形同虚设的根本原因如下：

1. **WebSocket 协议缺失企业检索开关 (`cwc_flux_v3` & `isStartOfSession`)**：
   - `CPH-PI/src/transport/chathub-client.ts` 在组装 SignalR 帧时遗漏了 `"cwc_flux_v3"` 选项集，且 `Orchestrator` / `SubagentRunner` 首轮未传递 `isStartOfSession: true`，导致 M365 Copilot 在 WebSocket 会话中调用企业搜索时返回 `"NO CONTENT AVAILABLE"`（0 条结果）。
2. **`sp-sync-engine.ps1` 硬编码排除并误删 `Library/` 目录**：
   - `scripts/sp-sync-engine.ps1` 在目录与文件过滤正则中硬编码排除了 `Library`，且依赖 `git ls-files`（受 `.gitignore` 中 `Library/` 影响）。在开启孤儿清理（`PruneOrphans`）时，脚本将已上传至 SharePoint 的 `WorkSpace/test/Library/CNNJI QUERY` 判定为“云端孤儿”并直接从云端删除，导致云端工作区仅剩 3 个根目录配置文件。
3. **`virtual-repo-map.md` 断头路（只生成、未注入）**：
   - `PnPWorkspaceSyncEngine.prewarm()` 生成了 `.cph/state/virtual-repo-map.md`，但 `PromptBuilder`、`main-plan-snapshot.ts` 与 `SubagentRunner` 均未读取和注入该文件；同时 `generateVirtualRepoMap()` 拼接含空格路径时未做 URL 编码，导致 Markdown 链接断裂。
4. **提示词与专属 Skill 仍停留在“本地 `read_file` + 微切片子代理”旧范式**：
   - `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`skills/subagent/SKILL.md` 与 `skills/handoff/SKILL.md` 仍要求模型通过本地 `read_file` 读取源码，并强制规定“先派 Scout 斥候探路”、“单文件 >500 行独占工单并拆分为 ≤300 行微切片”。这导致一个 29 文件的项目被拆解为 30+ 个 `Researcher` 子任务，在本地命令与文件读取中耗尽全部轮次预算，始终无法进入终局报告合成。

### 1.2 SharePoint 热覆写延迟极限边界实测结论 (`T+0.00s` 瞬时生效)
在补齐 `cwc_flux_v3` 与 `isStartOfSession: true` 后，针对 SharePoint 已索引存量文件节点（`UniqueId` 恒定）开展了连续两轮 `SaveBinaryDirect` 热覆写极限边界实测：

| 测试轮次 | 覆写注入真值 | `SaveBinaryDirect` 推流耗时 | 覆写完成后等待时间 | Copilot (`GPT-6.1 Sol`) 检索结果 | 实测结论 |
|---|---|---|---|---|---|
| **Round 1** | `884811` | `4172 ms` | **`T+0.00s`（0ms 等待立即提问）** | 准确返回 `884811` 及新增末尾原文 | **零延迟瞬时穿透** |
| **Round 2** | `996222` | `3467 ms` | **`T+0.00s`（连续二次覆写后 0ms 提问）** | 准确从 `884811` 跃迁为 `996222` | **连续覆写同样零延迟生效** |

**核心物理定律**：
- **首次冷创建 (Cold Create)**：全新文件名首次上传至 SharePoint 需约 15 分钟建立检索索引节点（`UniqueId`）。
- **存量热覆写 (Hot Overwrite)**：一旦文件已在 SharePoint 建立索引节点，通过 CSOM `SaveBinaryDirect`（`overwrite=$true`）原地覆盖后，`UniqueId` 与 Web URL 100% 恒定；Copilot 在检索并打开该文件时直接读取底层最新二进制流，**更新时间下限为 `T+0.00s`（HTTP PUT 落盘完成即刻生效）**。

---

## 2. 核心架构演进：退役 `Researcher`，构建双角色全云端零 IO 架构

### 2.1 为什么彻底退役 `Researcher` 子代理
`Researcher` 子代理的历史定位是在本地 IO 时代替主控分担数十轮 `read_file` / `grep` 的轮次消耗与上下文膨胀。在全云端工作区架构下：
1. **单轮阅读零本地 IO**：Copilot 可在单轮内部思考（`Thought` / 企业搜索）中直接通过 `[SHAREPOINT REMOTE WORKSPACE]` 提供的文件级云端 URL 检索并精读任意数量或超大体积（100MB 级）的源码文件，不产生任何本地工具调用往返。
2. **检索过程零上下文污染**：云端检索与文档片段召回在微软 Substrate 服务端当轮推理内完成，不会像本地 `read_file` 那样将成千上万行源码倾倒进多轮对话历史。
3. **消除子代理调度官僚主义**：砍掉 `Researcher`（及 `Scout` 斥候阶段）后，所有代码审查、架构分析、全局搜索、根因诊断任务均由 **主控智能体 (`Main Agent`) 直接在云端精读并一步产出终局报告**，原本 30+ 轮仍无法收敛的任务可直接压缩至 **1~3 轮内高质量完结**。

### 2.2 极简双智能体（Dual-Agent）职责矩阵

```
+-----------------------------------------------------------------------------------+
|                        [SHAREPOINT REMOTE WORKSPACE]                              |
|  - 全量存量源码 + Library/ 参考库 (UniqueId 恒定, 完整 URL 映射)                   |
|  - 本地 patch_file / write_file 触发 SaveBinaryDirect 同步热覆写 (T+0.00s 生效)   |
+-----------------------------------------------------------------------------------+
                 ▲                                               ▲
   (1. 思考内云端全量直读/跨模块精读)               (2. 首轮思考内云端直读目标文件与上下文)
                 │                                               │
+----------------------------------------+      +-----------------------------------+
|      主控智能体 (CPH-Main Agent)        |      |     编码智能体 (CPH-Coder Agent)   |
| - 挂载技能: subagent + handoff         |      | - 挂载技能: handoff               |
| - 审查/分析/检索/诊断: 100% 主控直出   | ===> | - 专职负责: 多模块隔离代码修改    |
| - 单点轻量修改: 主控直接 patch_file    | 派发 | - 行动闭环: 云端读 -> patch_file  |
| - 复杂多模块实现: 立桩 plan.md 派 Coder| 工单 |   -> run_command 单测绿灯 -> 结题 |
+----------------------------------------+      +-----------------------------------+
```

| 智能体角色 | 核心职责定位 | 代码阅读方式 | 本地工具使用边界 | 挂载专属技能 |
|---|---|---|---|---|
| **`Main Agent` (`cph-main-agent-prompt.txt`)** | 全局架构统帅、代码审查与分析直出专家、复杂编码编排者 | 优先依据 `[SHAREPOINT REMOTE WORKSPACE]` 云端 URL 直读 `[CLOUD-READY]` 源码；对 `[LOCAL-NEW]` 或云端仅返回片段需核对完整锚点的文件调用 `read_file` 精准补读 | `write_file` / `patch_file`（写报告、`plan.md` 或单点补丁）、`run_command`（跑全局验证）、`read_file`（`[LOCAL-NEW]` 及局部缺口补读）、`invoke_subagent`（仅派发 `coder`） | `skills/subagent`<br>`skills/handoff` |
| **`Coder Agent` (`cph-coder-agent-prompt.txt`)** | 外科手术级代码实现与单元测试闭环专家 | 首轮依据 `[SHAREPOINT REMOTE WORKSPACE]` 云端 URL 直读目标文件与单测；对 `[LOCAL-NEW]` 或需补充完整行上下文的文件调用 `read_file` | `patch_file`（存量文件精准修改）、`write_file` / 原生文件生成（新建文件）、`run_command`（运行单测与构建验证）、`read_file`（读取 `[LOCAL-NEW]` 或补齐补丁上下文） | `skills/handoff` |

---

## 3. Harness 底层物理链路修复设计 (Harness Engineering Fixes)

严格遵循 `AGENTS.md` **Harness 纯粹与中立原则**，仅修复阻碍云端工作区运转的 4 处物理缺陷与遗漏功能：

### 3.1 修复 1：`ChatHubClient` 恢复 `"cwc_flux_v3"` 与首轮 `isStartOfSession`
- **修改文件**:
  - `src/transport/chathub-client.ts`
  - `src/agent/orchestrator.ts`
- **设计细节**:
  1. 在 `ChatHubClient.sendMessage()` 默认 `optionsSets` 数组中加入 `"cwc_flux_v3"`，确保 M365 Copilot 企业级 Graph / SharePoint 检索管线在 WebSocket 通道下始终激活（经 `probe-hot-overwrite-boundary.ts` 纯 WebSocket 实测验证）。
  2. 在 `Orchestrator` 主循环（同时驱动主控与 `SubagentRunner` 子会话）调用 `client.sendMessage()` 时，显式传递 `isStartOfSession: turn === 1`。

### 3.2 修复 2：`sp-sync-engine.ps1` 纳入 `Library/` 目录、增加二进制/大文件过滤门禁并提取真实云端元数据
- **修改文件**:
  - `scripts/sp-sync-engine.ps1`
- **设计细节**:
  1. **解除 `Library/` 封杀**：将 `Get-LocalFolders` 与 `Prewarm/SyncWorkspace` 中的防泄漏排除正则由 `(\.git|\.cph|node_modules|dist|package|Library)` 修正为 `(\.git|\.cph|node_modules|dist|package)`。
  2. **显式扫描 `Library/` 目录并设置二进制/体积过滤门禁**：当工作区使用 `git ls-files` 采集文件列表时，若存在 `Library/` 目录（通常在 `.gitignore` 中忽略），递归扫描 `Library/` 下的文件与子目录并合并至 `$localFiles` 与 `$localFolders`。同时通过 `Test-IsIndexableSyncFile` 过滤掉不可检索的编译二进制与压缩包扩展名（`.dll`, `.dylib`, `.so`, `.exe`, `.pdb`, `.lib`, `.obj`, `.o`, `.a`, `.zip`, `.tar`, `.gz`, `.7z`, `.rar`, `.aar`, `.jar`, `.war`, `.onnx`, `.bin`, `.dat`, `.pack`, `.idx`, `.cache`, `.Up2Date`）及超过 `20MB` 的超大二进制文件（例如 `E:\test\Library` 中 208.8MB 的二进制产物将被自动跳过，仅同步 2.8MB 的源码、补丁与文档）。
  3. **记录真实 SharePoint `UniqueId`、`ServerRelativeUrl` 与 `firstCreatedAt`**：消除原脚本硬编码伪造 `"guid-xxxxxxxx"` 的缺陷。在 `Push-FileToSharePoint` 执行 `SaveBinaryDirect` 后，通过 `$ctx.Web.GetFileByServerRelativeUrl($targetFileUrl)` 读取真实的 `$spFile.UniqueId`（36 位 GUID）与 `$spFile.ServerRelativeUrl` 写入 `sync-manifest.json`，并在文件首次上传时记录 `firstCreatedAt` 时间戳（用于区分 `[CLOUD-READY]` 与 `[LOCAL-NEW]`）。

### 3.3 修复 3：`virtual-repo-map.md` 格式升级、体积预算控制与会话首轮自动注入
- **修改文件**:
  - `src/workspace/pnp-sync-engine.ts`
  - `src/protocol/prompt-builder.ts`
  - `src/session/main-plan-snapshot.ts`
- **设计细节**:
  1. **`generateVirtualRepoMap()` 格式升级与体积控制**：
     - 解析 `siteUrl` 与 `targetFolder`，在头部显式输出站点名、文档库名、云端工作区根路径及经 URL 编码的完整目录地址。
     - 对每个文件条目，将路径按 `/` 分段执行 `encodeURIComponent` 构造合法的完整 SharePoint Web URL，过滤二进制扩展名，并对单文件 URL 列表设置预算上限（默认最多展示前 `120` 个核心源码/文档文件，超出部分按目录汇总展示文件夹 URL），附带状态标签与真实 `DocId`：
       - `[CLOUD-READY]`：存量已索引文件（含通过 `SaveBinaryDirect` 热覆写更新的文件）；
       - `[LOCAL-NEW: use read_file]`：当前会话内新建且距首次上传不足 60 秒的文件，提示模型调用本地 `read_file`。
  2. **会话首轮（Turn 1）全链路自动注入**：
     - 在 `PromptBuilder`（`buildDirectAgentPrompt`、`buildTurn1Prompt`、`buildTurn2TaskPrompt`、`buildTurn2TaskPromptWithAttachment`、`buildHandoffContinuationPrompt`）及 `formatSuccessorTurn1Prompt` 中自动读取 `<workspaceRoot>/.cph/state/virtual-repo-map.md` 注入首轮提示词；后续第 2~30 轮复用同一会话上下文，不再每轮重复拼接整表。

### 3.4 修复 4：`patch_file` / `write_file` 的带超时非阻塞写后热同步屏障
- **修改文件**:
  - `src/agent/orchestrator.ts`
  - `src/workspace/pnp-sync-engine.ts`
- **设计细节**:
  1. 移除 `Orchestrator` 中原来仅在 `isGreenTestResult` 时静默 spawn `path.join(this.workspaceRoot, "scripts", "sp-sync-engine.ps1")` 的无效逻辑。
  2. 统一通过 `PnPWorkspaceSyncEngine` 处理文件变更同步：当 `Main Agent` 或 `Coder Agent` 执行 `patch_file` / `edit` / `write_file` 成功修改工作区文件后，带 `15s` 超时保护与异常捕获调用 `pnpSyncEngine.syncFile()` 并刷新 `.cph/state/virtual-repo-map.md`：
     - 同步成功时：在当轮 `toolResult` 中附加 `[Cloud Mirror: Synced to <serverRelativeUrl> (${ms}ms)]`；
     - 超时或网络异常时：写入 `dirty-sync.jsonl` 并在 `toolResult` 中附加 `[Cloud Mirror: PENDING (local file updated; use read_file if re-reading)]`，绝不阻断本地编辑主流程。

---

## 4. 四大认知资产（2 组系统提示词 + 2 个核心 Skill）彻底重写规范

所有提示词与 Skill 的重写严格遵循 `AGENTS.md` 核心治理准则：
- **准则 3（正向引导铁律）**：全文 100% 采用建设性正向指令（“请……”、“直接……”、“通过……实现……”），彻底杜绝任何负面禁止词，避免“粉色大象”效应。
- **准则 6（行动导向与黑盒抽象）**：纯粹站在工作区专业研发者与架构师视角描述输入事实、可用工具与交付标准，完全隔绝底层 WebSocket、SignalR、JSON 序列化或账号池等物理实现细节。

### 4.1 重写资产一：主控系统提示词 (`cph-main-agent-prompt.txt`)
- **角色定位**：`CPH-Main`，具备云端工作区全景直读能力的软件架构师、代码质量终审官与复杂工程调度统帅。
- **核心工作流重构（三大正向闭环）**：
  1. **云端工作区全景直读 (Cloud-First Zero-IO Comprehension)**：
     - 首轮提示词中的 `[SHAREPOINT REMOTE WORKSPACE]` 提供了当前项目在 SharePoint 云端工作区的站点名、文档库、目录路径以及每个源文件的精确 Web URL 与状态标识。
     - 当需要审阅源码、梳理架构拓扑、追踪跨文件调用链或检索关键字时，直接在内部思考（`Thought`）中利用企业搜索检索并精读 `[SHAREPOINT REMOTE WORKSPACE]` 中标记为 `[CLOUD-READY]` 的云端文件。单轮思考即可完成多文件或大文件的全量阅读，省去本地文件读取工具往返。
  2. **分析、审查与诊断任务：主控一步直出闭环 (Direct Analytical Closure)**：
     - 面对代码质量审查（如热核级代码审查）、架构设计分析、技术问答或静态问题诊断任务，由主控直接通过云端工作区精读全部相关模块。
     - 完成全面分析后，若用户指定了报告落盘路径（或工作区约定输出目录），通过 `write_file`（或原生文件生成）将详实报告落盘，并立即在当前轮或下一轮输出 `<cph_protocol type="FINAL_ANSWER">`，在 1~3 轮内高质量交付完整终局报告。
  3. **复杂多模块编码任务：`plan.md` 立桩与 `Coder` 正交委派 (Orchestrated Coding Workflow)**：
     - 对于单文件或少量明确位置的轻量代码修改，主控在云端直读确认上下文后，直接调用 `patch_file` 实施修改并调用 `run_command` 运行验证，一步达成闭环。
     - 对于涉及多个独立子系统的复杂编码重构任务，主控先基于云端直读在工作区编写 `plan.md` 物理清单（格式为 `- [ ] 任务描述`），随后调用 `invoke_subagent` 委派 `coder` 子代理按互不重叠的文件边界并行实施代码修改与单元测试验证。
     - 收到 `coder` 返回的绿灯验证报告后，使用 `patch_file` 更新 `plan.md` 勾选状态（`- [x]`），全部完成后输出 `<cph_protocol type="FINAL_ANSWER">` 交付。
- **工具定义精简 (`<tool_protocol>`)**：
  - `invoke_subagent`：仅支持 `role: coder`，专注于隔离执行代码补丁与单元测试闭环；
  - `patch_file`：对存量文件进行基于唯一上下文匹配的精准局部修改（修改后系统自动实时热同步至 SharePoint 云端）；
  - `write_file`：创建新文件、写入 `plan.md` 或输出正式审查/架构报告；
  - `run_command`：在本地工作区执行构建、测试或诊断命令；
  - `read_file`：专门用于读取映射表中标记为 `[LOCAL-NEW]` 的会话内新建未索引文件，或读取本地测试动态生成的临时产物。

### 4.2 重写资产二：编码智能体系统提示词 (`cph-coder-agent-prompt.txt`)
- **角色定位**：`CPH-Coder`，专精外科手术级代码实现与测试验证的敏捷执行专家。
- **核心工作流重构（3 步极速闭环）**：
  1. **首轮云端直读定位 (Step 1: Cloud Context Grounding)**：
     - 根据工单指派的目标文件路径与首轮附带的 `[SHAREPOINT REMOTE WORKSPACE]` 云端 URL，直接在首轮内部思考（`Thought`）中通过企业搜索检索并阅读目标源码文件与现有单元测试文件，当轮即完成修改方案构建（若目标文件标记为 `[LOCAL-NEW]`，则调用 `read_file` 读取）。
  2. **精准补丁与同步热更新 (Step 2: Surgical Patching)**：
     - 对存量文件直接调用 `patch_file` 实施最小可行改动（系统底层在补丁落盘瞬间自动以 `T+0.00s` 热覆写同步回 SharePoint 云端）；对全新独立模块或脚本采用 `write_file` 或原生文件生成。
  3. **本地测试绿灯与极简结题 (Step 3: Green Verification & Final Answer)**：
     - 调用 `run_command` 运行工单指定的单元测试或构建检查命令；验证通过后，立即输出 `<cph_protocol type="FINAL_ANSWER">`，汇报修改文件、关键变更摘要与测试绿灯输出证据，在 2~3 轮内干净结案。

### 4.3 重写资产三：子代理并发编码调度技能 (`skills/subagent/SKILL.md`)
- **彻底重定位**：从原来的“两阶段斥候探查 + Researcher/Coder 混合微切片技能”重构为 **“多模块并行编码与 DAG 施工调度技能 (Orthogonal Coder Dispatch & DAG Execution Skill)”**。
- **核心重写内容**：
  1. **全面移除 `researcher` 与 `Scout` 相关内容**：删除 `role: researcher`、`searcher`、`isScout: true`、双轨内联斥候轨道、以及“>500 行独占 / ≤300 行微切片”等旧规则。
  2. **明确主控直读与 Coder 派发边界**：
     - 架构理解、代码走查、依赖分析与问题定位由主控自身通过 `[SHAREPOINT REMOTE WORKSPACE]` 云端直读直接完成；
     - 仅当工程实施涉及多个独立文件/子系统的代码编写与单测闭环时，启用 `invoke_subagent` 并发调派 `role: coder`。
  3. **确立 Coder 派发四大门禁 (Four Coder Dispatch Gates)**：
     - **Gate 1（云端认知先行）**：派发前主控已通过云端工作区读懂目标模块契约，在工单中直接给出清晰的函数签名、修改位置与预期行为；
     - **Gate 2（文件正交隔离）**：同一 `stage` 内并发派发的多个 `coder` 负责的目标修改文件集合完全互不重叠；共享底层契约文件的改动置于前置 `stage: 1`，上层消费模块置于 `stage: 2`；
     - **Gate 3（技能内化与具象指令）**：将 TDD、重构规范等内化为具体的目标文件路径、修改逻辑描述与明确的测试验证命令（如 `bun test tests/xxx.test.ts`）；
     - **Gate 4（`plan.md` 对账收敛）**：收到 `coder` 交付报告后，主控更新 `plan.md` 对应勾选状态，待全部编码项验证通过后立即汇总输出 `FINAL_ANSWER`。

### 4.4 重写资产四：跨会话自主交接技能 (`skills/handoff/SKILL.md`)
- **彻底重定位**：面向“全云端工作区 + 终局交付优先”工作流，重构为 **“云端状态锚定与终局收敛交接技能 (Cloud-Anchored & Deliverable-First Handoff Skill)”**。
- **核心重写内容**：
  1. **适配双智能体架构**：仅面向 `Main Agent`（宏观战役与阶段成果交接）与 `Coder Agent`（局部补丁与单测断点交接），移除所有 `Researcher` 相关描述与旧版 `workspace-vN.txt` 快照描述。
  2. **强化“已验证分析结论与审阅证据沉淀”**：
     - 在长分析/审查或大型重构任务发生跨会话接力时，交接文档的核心价值不再是罗列“读过哪些文件”（因为云端工作区随时可读），而是**高密度沉淀前序会话已经完成的模块分析结论、已核实的缺陷证据链（文件路径 + 精确行号 + 根因 + 建议）以及架构设计决策**。
     - 后继智能体接管后，直接继承前序已沉淀的模块结论，只需对剩余未完成的模块进行云端直读补充，即可直接合稿产出完整的终局报告。
  3. **明确云端工作区同步状态对齐 (`[CLOUD-READY]` vs `[LOCAL-NEW]`)**：
     - 在【已变更/生成文件清单】中，清晰区分已同步至 SharePoint 云端（`[CLOUD-READY]`，后继会话可直接云端检索）的存量修改文件，以及本会话内新创建的本地文件（`[LOCAL-NEW]`，后继会话按需通过本地 `read_file` 对账）。
  4. **终局交付导向的 `P0 / P1` 待办设计**：
     - `P0（立即恢复与闭环动作）`：给出后继会话第 1 轮即可直接执行的具体动作（例如：“直接在云端阅读剩余的 X 模块并立即合稿写入最终报告 `E:/test/test/review.md`”或“运行 `bun test` 验证刚打入的补丁”）；
     - `P1（剩余清单推进与终局交付）`：对照 `plan.md` 完成剩余 `- [ ]` 项，一鼓作气输出 `FINAL_ANSWER` 终局交付物。

### 4.5 打包分发脚本更新 (`scripts/package-agent-bundle.ts`)
- 更新 `scripts/package-agent-bundle.ts`：
  - 将主打包配置更新为 **Dual-Agent（`Main` + `Coder`）全云端架构**；
  - 同步将重写后的 `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`skills/subagent/SKILL.md`、`skills/handoff/SKILL.md` 打包输出至 `dist/copilot-agent-bundle/` 与 `package/agent-bundle/`（含 `copilot-agent-bundle.zip` 与更新后的 `UPLOAD-GUIDE.md`）。

---

## 5. 验收标准与验证矩阵 (Verification Matrix)

1. **单元测试与构建门禁**：
   - `bun test` 全量通过（涵盖 `ChatHubClient` `cwc_flux_v3` 与 `isStartOfSession` 断言、`PnPWorkspaceSyncEngine` URL 编码与 `virtual-repo-map.md` 生成断言、`PromptBuilder` / `Orchestrator` / `SubagentRunner` 云端映射注入断言）。
2. **`sp-sync-engine.ps1` 与 `E:\test` 真实云端同步验证**：
   - 对 `E:\test` 执行云端同步后，`E:\test\Library\CNNJI QUERY` 下的全部源码文件被完整推送至 SharePoint `WorkSpace/test/Library/CNNJI QUERY`，且生成的 `E:\test\.cph\state/virtual-repo-map.md` 包含所有文件的合法编码 SharePoint URL。
3. **提示词与 Skill 合规性检查**：
   - 对重写后的 `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`skills/subagent/SKILL.md`、`skills/handoff/SKILL.md` 进行全文扫描：确认 0 处 `researcher` / `searcher` / `isScout` 残留，0 处负面禁用词残留，0 处底层管道实现细节泄露，且 `bun run package` 成功构建最新分发包。

