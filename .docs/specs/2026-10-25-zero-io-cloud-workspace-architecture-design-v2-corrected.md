# 全云端零本地读往返工作区架构与智能体认知体系重构设计规范（修订版 v2-corrected）

- **文档状态**: `Draft for Review`
- **制定日期**: 2026-10-25
- **修订日期**: 2026-10-25
- **适用工程**: `CPH-PI`
- **文档性质**: 本文件是 `2026-10-25-zero-io-cloud-workspace-architecture-design.md` 的**副本 + 纠偏版**，不替代原文件的归档价值；实现以本文件的结论为准。
- **关联前序规范**:
  - `2026-10-20-pnp-sharepoint-cloud-repo-sync-design.md`
  - `2026-10-24-cloud-workspace-folder-dual-track-sync-design.md`
  - `2026-10-19-workspace-snapshot-supercharger-and-pipeline-architecture-design.md`

---

## 0. 修订说明与证据等级定义

### 0.1 为什么要出修订版

原报告的四条根因中，有两条（`Library` 排除、`virtual-repo-map.md` 只生成未注入）与提示词/Skill 旧范式，**在代码与日志中可以直接验证**；而另外两条（`cwc_flux_v3` 缺失导致企业搜索失败、`T+0.00s` 瞬时生效）在引用材料中**找不到对应证据**，却被写成"已确认的物理定律"并据此推导出"1~3 轮内生吞任意规模代码库"的架构结论。

以未验证的因果链为地基去裁剪子代理体系，风险不对称：一旦检索接地在实际租户/实际文件类型上不成立，架构会同时失去"本地读"和"子代理隔离"两条退路。因此本修订版做三件事：

1. 把每条结论重新标注**证据等级**，并为未验证项设计可证伪实验；
2. 保留原报告中被证实的技术修复项，补齐实现细节与失败语义；
3. 把"单一路径（云端直读替代一切）"改为"分层降级 + 覆盖对账"的纵深模型。

### 0.2 证据等级

| 标记 | 含义 | 判定标准 |
|---|---|---|
| 【实证】 | 代码或日志可直接复核 | 给出 `file:line` 或日志词频 |
| 【部分实证】 | 现象为真，因果未闭合 | 有症状证据，但归因是推断 |
| 【假设】 | 未验证的机制性断言 | 需专门实验，禁止作为设计前提 |
| 【已推翻】 | 与原报告表述冲突 | 见附录 A |

---

## 1. 背景与实证基线（重估）

### 1.1 四个候选根因的实证等级

| 编号 | 原报告根因 | 重估等级 | 依据 |
|---|---|---|---|
| R1 | `ChatHubClient` 缺 `cwc_flux_v3` + 首轮未传 `isStartOfSession`，导致企业搜索返回 `NO CONTENT AVAILABLE` | 【部分实证】代码事实成立；**因果与"0 条结果"表述无证据** | `src/transport/chathub-client.ts:257-268` 的 `optionsSets` 默认数组确无 `cwc_flux_v3`（存在 `flux_v3_references` 系列）；`:280` `isStartOfSession: payload.isStartOfSession ?? false`，而 `Orchestrator` / `SubagentRunner` 均未传该字段。【已推翻】`NO CONTENT AVAILABLE` 在三份日志中出现 **0 次**；`cwc_flux_v3` 在日志中 0 次，且 `git log -S cwc_flux_v3 -- src/` 无任何提交 |
| R2 | `sp-sync-engine.ps1` 硬编码排除 `Library`，孤儿清理误删云端参考库 | 【实证】（机制细节需更正） | `scripts/sp-sync-engine.ps1:259`、`:398` 的正则含 `Library`；`:380` 使用 `git ls-files --cached --others --exclude-standard`，而 `E:\test\.gitignore` 含 `Library/`；`E:\test\.cph\state\sync-manifest.json` 现存仅 3 个文件（`.gitignore`、`AGENTS.md`、`.vscode/mcp.json`），与"云端仅剩 3 个根配置"吻合。**更正**：见附录 A-4、A-5 |
| R3 | `virtual-repo-map.md` 只生成未注入，且 URL 未编码 | 【实证】 | 生成点 `src/workspace/pnp-sync-engine.ts:281-289`；`PromptBuilder`、`main-plan-snapshot.ts`、`orchestrator.ts`、`subagent-runner.ts` 中 `virtual-repo-map` 词频为 0；`generateVirtualRepoMap()`（`:491-560`）无任何 `encodeURIComponent`，`E:\test\.cph\state\virtual-repo-map.md` 实测含未编码空格 |
| R4 | 提示词与 Skill 停留在"本地 `read_file` + 微切片子代理"旧范式 | 【实证】 | `skills/subagent/SKILL.md:3,17,23,161,175` 确含 `Scout`、`>500 行独占`、`≤300 行` 规则；`cph-main-agent-prompt.txt` 中 `read_file` 3 处、`researcher` / `Scout` / `斥候` 合计 9 处；`cph-terminal-2026-10-24T13-07-26.log` 中 `researcher` 320 次、`Scout` 137 次 |

**重估后的主次排序**：R4（轮次被微切片派发耗尽）与 R2（云端工作区被回收）是本次失败中**证据最硬**的两条；R3 是放大因素；R1 目前只能作为"待 A/B 验证的次要假设"，不能承担架构裁剪的依据。

### 1.2 SharePoint 热覆写时效：从"物理定律"降级为"待受控实验的行为假设"

原报告结论（存量热覆写 `T+0.00s` 生效、冷创建约 15 分钟）当前证据基础如下：

- 探测脚本 `scripts/test-main-ask-overwrite.ts` 通过 CDP 驱动 **`m365.cloud.microsoft` 网页界面**（输入框 `insertText` + 点击"发送" + DOM 轮询），走的是**浏览器前端链路**，不是 CPH-PI 的 WebSocket/chathub 链路。
- 该脚本的提示词是自然语言检索请求（"请重新检索并阅读该 SharePoint 目录下的最新代码…"），并显式列出了 `BASE_PRICE` / `KERNEL_MULTIPLIER` / `SECURITY_OFFSET` 三个变量名，属于**强词法锚点**的小文本/小脚本场景。
- 冷创建时长在 `scripts/probe-crawler-poll.ts` 中由人工传入的 `elapsedMin` 决定，仓库内未见多轮次轮询结果落盘，因此"约 15 分钟"是一个观测值而非分布。

因此正确表述为【假设】：

> S1：在**同一租户、已建立索引的存量文件**上，CSOM `SaveBinaryDirect(overwrite=true)` 完成后，M365 Copilot 的检索式接地**有可能**在数秒内返回最新内容。该行为与浏览器通道还是 WebSocket 通道的关系、与文件类型的关系、与并发编辑的关系，均未验证。

必须补测的实验（E0，见 §5.1）：
1. **通道对照**：同一文件、同一问题，分别经 Web UI 与 `ChatHubClient` 各 5 次，比较命中率与数值正确率。
2. **重复性**：同一场景 N=10，记录命中/未命中/返回旧值的次数，给出分布而非单次耗时。
3. **文件类型**：`.py` / `.ts` / `.md` / `.xlsx` 各一组，验证 SharePoint 搜索抽取链路对**纯代码文件**的可检索性（这是本架构成立与否的关键未知项）。
4. **规模**：单文件 5KB / 200KB / 2MB 各一组，测量"返回内容是否完整"与"是否只返回片段"。

### 1.3 架构目标的重述

原报告的目标"主控在单轮思考内精读任意数量或 100MB 级源码"属于【假设】且与检索式接地的机制冲突（召回是片段级、受相关性排序与每轮预算约束，客户端无法"指定读取某文件全文"）。修订后的目标是一个**可度量的工程目标**：

> G1：对给定工作区与给定任务，使"**检索接地覆盖的文件集**"可被记录、可被对账、可被补读，从而让报告类任务的**单位结论成本**（轮次 + 本地 IO 次数）显著下降，同时在接地不足时自动降级而非产出幻觉结论。

---

## 2. 架构演进：分层降级 + 覆盖对账

### 2.1 术语纠正："零 IO" → "零本地读往返"

架构中写侧全部是本地 IO（`patch_file` / `write_file` / `run_command`），`[LOCAL-NEW]` 文件与测试产物仍需 `read_file`。对外表述统一为 **Zero Local Read Round-trip（零本地读往返）**，避免以绝对化表述掩盖真实数据流。

### 2.2 能力边界：检索式接地 ≠ URL 定点读取

| 维度 | 检索式接地（真实机制） | 原报告隐含假设 |
|---|---|---|
| 谁决定读哪些文件 | 服务端检索规划 + 相关性排序 | 模型按 URL 清单点名读取 |
| 返回粒度 | 片段/摘要，受每轮预算约束 | 完整文件、可到 100MB |
| 文件类型覆盖 | 取决于 SharePoint 搜索抽取链路，Office/PDF 最强，**纯代码文件待验证** | 与文件类型无关 |
| 生效时延 | 索引新鲜度 + 检索缓存，非确定 | `T+0.00s` 确定生效 |
| 可观测性 | 模型通常给出引用，但不保证覆盖全集 | 隐含"读了就是全部" |

由此产生的两条设计约束：

1. `[CLOUD-READY]` 标签只能表达"**该文件已在云端建立索引，值得尝试接地**"，不能表达"模型已读过"。
2. 任何依赖"读全"的结论（完备性审查、全量重构方案）都必须经过 §2.4 的覆盖对账，否则降级到本地读或子代理。

### 2.3 双角色矩阵（保留方向，调整边界）

保留 `Main` + `Coder` 双角色，但把 `Researcher` 从"永久退役"改为"**按需降级轨道**"。理由不是流程偏好，而是两条硬约束：子代理提供**上下文隔离**与**并行**，主控直读把"多路并行 + 隔离"换成"串行 + 单点上下文"，在超大仓库上净收益可能为负。

| 角色 | 定位 | 读路径（按优先级） | 触发条件 |
|---|---|---|---|
| `Main Agent` | 架构统帅、审查/诊断直出、编排 | ① 云端接地（`[CLOUD-READY]` 且文件数 ≤ 接地预算）→ ② 覆盖不足时本地 `read_file` 补读 → ③ 仍不足时降级派发分析型子代理 | 常驻 |
| `Coder Agent` | 外科手术式实现 + 单测闭环 | ① 云端接地读目标文件与既有测试 → ② `[LOCAL-NEW]` 或接地未命中时本地 `read_file` | 多文件/多子系统实现 |
| `Researcher`（保留） | 大范围只读调查、根因诊断、机械穷举 | 本地只读工具 + 云端接地 | 目标文件数 > `groundingFileBudget`，或需要并行穷举，或需要产出可复用的调研中间物 |

> 说明：`Researcher` 的**角色定义与工具白名单**保留在 Harness 中，但**默认不再由主控主动派发**；`skills/subagent` 的门禁改为"默认主控直读，超出接地预算才启用调研轨道"。

### 2.4 新增核心机制：接地覆盖对账（Grounding Ledger）

这是原报告缺失、且决定架构可信度的组件。

**问题**：模型拿到"文件名 + 大小 + URL"清单后，完全可以在未真正读取的情况下产出带行号的审查结论。当前设计中没有任何机制能发现这一点。

**机制**：
1. 首轮注入的 `[SHAREPOINT REMOTE WORKSPACE]` 附带一份**机器可读路径清单**（`.cph/state/grounding-targets.json`，与 map 同源），记录 `expectedPaths`。
2. 提示词要求模型在 `FINAL_ANSWER` 中输出结构化引用块：
   ```
   <cph_grounding>
   cited: ["src/a.ts", "src/b.ts"]
   unread: ["src/c.ts"]
   basis: ["cloud", "local"]
   </cph_grounding>
   ```
3. `Orchestrator` 解析该块，计算 `expectedPaths − cited`：
   - 差集为空 → 报告标记 `[GROUNDING: COMPLETE]`；
   - 差集非空且任务属"完备性任务"（全量审查/跨模块重构）→ 插入一条系统提示，要求模型对差集执行补读或显式声明 `unread` 并降级结论强度；
   - 无法解析该块 → 报告标记 `[GROUNDING: UNVERIFIED]`，不视为合格交付。
4. 该账本同时作为 §5 实验的度量口径：**接地覆盖率** = `cited / expectedPaths`。

**这一机制的独立性**：即使 S1 假设最终被推翻（云端接地不成立），覆盖对账仍然有效——它约束的是"结论是否可追溯"，与读路径无关。

### 2.5 轮次与提示预算模型（替代"1~3 轮"口号）

`Orchestrator.maxTurns` 默认 30（`src/agent/orchestrator.ts:223`）。原报告"1~3 轮完结"忽略单轮输出上限与报告长度下界。修订为按任务形态给出预算：

| 任务形态 | 轮次预算 | 收敛策略 |
|---|---|---|
| 单点问答 / 单文件诊断 | 1–2 | 一轮接地 + 一轮 `FINAL_ANSWER` |
| 多文件审查（≤ `groundingFileBudget`） | 3–6 | 首轮接地 → 次轮补读差集 → 分节 `write_file` 落盘 → `FINAL_ANSWER` 只放摘要与文件指针 |
| 大范围审查（> 预算） | 6–15 或派发 | 按模块切片 → 每片落盘一节 → 末轮合稿 |
| 多模块编码 | 主控 2 + Coder 各自 2–3 | `plan.md` 对账 |

关键修正：**长报告一律"分节落盘 + 末轮给指针"，不在单轮内联输出全文**（与 `AGENTS.md` 准则 8/9 一致）。

### 2.6 提示预算与 map 体积控制

原设计对每个工作区都把完整文件清单注入轮首提示，与"认知极简"和 token 预算直接冲突：`E:\test\Library` 实测 **135 个文件 / 211.7MB**，全量入表即可撑爆首轮。

修订设计：
- `[SHAREPOINT REMOTE WORKSPACE]` 只注入**摘要头**（站点、文档库、根路径、文件总数、按目录聚合的统计）+ **Top-N 热点文件**（默认 N=60，可按任务路径前缀过滤）；
- 完整清单落盘为 `.cph/state/grounding-targets.json`，提示词给出路径与"按需检索"指令；
- 提供 `--grounding-scope <prefix>` 让主控在派发工单时收窄范围。

---

## 3. Harness 侧改动清单

严格遵循 `AGENTS.md` 的 Harness 中立原则：本节所有改动都是**协议/工程缺陷修复**与**可观测性补齐**，不含任何面向特定模型输出的特化补丁。

### 3.1 修复 1（降级为可回滚实验）：`ChatHubClient` 选项集与首轮标记

- **改动**：在 `src/transport/chathub-client.ts:257` 的默认 `optionsSets` 中新增 `"cwc_flux_v3"`，并支持由调用方覆盖；`Orchestrator` / `SubagentRunner` 首轮传 `isStartOfSession: turn === 1`。
- **状态**：该项**不以前置结论为依据**，而以 §5.1 的 E0-1 对照实验为验收依据。实现时以开关形式引入（例如 `enableTenantSearchOptions`，默认 `false`），实验确认增益后再翻转默认值，避免把未验证的因果固化进协议层。
- **语义澄清**：`isStartOfSession` 在 ChatHub 协议中承担会话起始语义（语气/插件/会话态初始化）。把它当作"企业检索开关"是过度归因；两者应分别验证。

### 3.2 修复 2：`sp-sync-engine.ps1` 纳入 `Library/` + 治理门禁

原报告只解除了排除，缺少治理约束。修订后：

1. **解除排除**：`scripts/sp-sync-engine.ps1:259`、`:398` 的正则去掉 `Library`。
2. **补入本地文件集**：`git ls-files --cached --others --exclude-standard`（`:380`）会因 `.gitignore` 中的 `Library/` 而漏掉该目录，需在 git 枚举之后追加 `Library/**` 的递归枚举并合并去重。
3. **治理门禁（新增，必须同时落地）**：
   - `Library` 同步受 `librarySyncMaxBytes`（默认 256MB）与 `librarySyncAllowGlobs` 白名单约束，超限时**只同步白名单内类型**并输出 `[LIBRARY-BUDGET-EXCEEDED]` 报告条目；
   - 同步前经租户 DLP 前置检查（或至少输出待上传清单供人工确认），因为 `Library/` 常含第三方源码与授权材料；
   - 记录单库条目数，接近 SharePoint 列表视图阈值（5000 项）时告警并建议分库。
4. **孤儿回收语义更正**：
   - 现状是 `SyncWorkspace` 阶段 2 **无条件**执行孤儿回收（`scripts/sp-sync-engine.ps1:546-596`），不存在原报告所说的 `PruneOrphans` 开关；删除方式为 `$file.Recycle()`，对象进入回收站**可恢复**。
   - 修订：新增 `-PruneOrphans` 显式开关（默认关闭），并在回收前把待回收清单写入 `.cph/state/prune-preview.json` 并打印摘要；`SyncSingleFile` 路径**永不**触发回收。
5. **真实云端元数据**：`Push-FileToSharePoint` 与 `Prewarm` 对账时写入 CSOM `$file.UniqueId`（真实 GUID 格式）与 `ServerRelativeUrl`，并记录 `firstCreatedAt`。
   - 现状核对：脚本在 `SyncSingleFile`（`:749`）与 `Prewarm`（`:508`）中都以 `$uniqueId = "guid-$([System.Guid]::NewGuid().ToString().Substring(0,8))"` **本地伪造**唯一 ID；`E:\test\.cph\state\sync-manifest.json` 中实存的 `guid-35de2792` 即由此产生，**不是** CSOM GUID。manifest 亦无 `serverRelativeUrl` 与 `firstCreatedAt` 字段。因此原报告"`UniqueId` 恒定"的前提在当前实现与数据中均无法成立，本项为**必须修复**而非"锦上添花"。

### 3.3 修复 3：`virtual-repo-map.md` 生成与注入

1. **编码与身份（更正原表述）**：`generateVirtualRepoMap()`（`src/workspace/pnp-sync-engine.ts:491-560`）当前输出的是纯文本 `(Web: <url>)`，并未构造 Markdown 链接语法；真正缺陷是路径未做百分号编码（实测 map 中含未编码空格），且因 manifest 缺 `serverRelativeUrl` 而恒走 fallback 分支。修订为：
   - 逐段 `encodeURIComponent` 拼接，或直接使用服务端返回的 `ServerRelativeUrl`；
   - 头部输出站点名、文档库名、云端根路径、目录浏览 URL；
   - 每条目附 `[CLOUD-READY]` / `[LOCAL-NEW]`（依据 `firstCreatedAt` 与索引等待窗口）。
2. **体积控制**：支持 `--scope`/Top-N 摘要模式，完整清单另存 JSON（见 §2.6）。
3. **注入点**：`Orchestrator`（`buildTurn1Prompt` / `buildDirectAgentPrompt`）、`formatSuccessorTurn1Prompt`、`SubagentRunner` 首轮，读取 map 摘要并作为 `[SHAREPOINT REMOTE WORKSPACE]` 块注入。
4. **与既有快照通道去重（原报告遗漏）**：`Orchestrator` 已有 `enableWorkspaceSnapshot` → `SnapshotGenerator.generateWorkspaceSnapshot()` → 上传 `workspace-vN.txt` 作为云端附件的通道（`src/agent/orchestrator.ts:541-625`）。新 map 与旧快照在"文件清单"上高度重叠，必须明确分工：**快照负责目录结构与变更概览（附件形态），map 负责可接地 URL 索引（提示词形态）**，二者共用同一 manifest 源，且总注入体积设上限。

### 3.4 修复 4：写后同步屏障（补齐失败语义）

1. 移除 `Orchestrator` 中 `isGreenTestResult` 才触发的静默 spawn（`src/agent/orchestrator.ts:1067-1095`）。
   - 更正原表述：不只是"路径不存在"。该调用 `spawn("powershell.exe", [... "-File", join(workspaceRoot,"scripts","sp-sync-engine.ps1"), ...])`，在外部工作区下 `fs.existsSync` 直接跳过；**即便路径存在**，`SyncSingleFile` 会把 `-SiteUrl` 继续传给 `Push-FileToSharePoint`，后者在非 `MockTransport` 下因 `SiteUrl` 为空 `throw`（`scripts/sp-sync-engine.ps1:225`），而该 `throw` 又被 `SyncSingleFile` 内的 `catch { $status = 'failed' }`（`:773`）吞掉，进程最终**以退出码 0 结束并只在 stdout 打印 `[ERROR] Failed to sync …`**；再叠加 `stdio: "ignore"` + `detached` + `unref()`，该失败在 Harness 侧完全不可见。
2. 统一改由 `PnPWorkspaceSyncEngine.syncFile()`（已存在于 `src/workspace/pnp-sync-engine.ts:323`）处理，并补齐：
   - **超时**：单文件 `syncTimeoutMs`（默认 15s），超时视为 `pending` 而非失败；
   - **退避**：CSOM 429/503 指数退避重试，复用既有 `dirty-sync.jsonl` 作为失败队列；
   - **不阻断**：同步失败时编辑仍然成功，`toolResult` 附加 `[Cloud Mirror: PENDING (queued for retry)]`；
   - **并发**：多 `Coder` 并发写时按 `siteUrl+folder` 串行化，避免同上下文并发 CSOM。
3. **措辞更正**：`toolResult` 中不使用"`T+0.00s Hot-Overwrite Ready`"这类客户端无法验证的可检索性断言，改为可验证事实："`Uploaded to <serverRelativeUrl> (HTTP 200, {ms}ms)`"。

### 3.5 新增修复 5：角色面收敛（原报告遗漏）

原报告要求提示词与 Skill"0 处 `researcher` 残留"，但 Harness 仍完整保留该角色，两者不闭合。收敛项：

| 位置 | 现状 | 修订 |
|---|---|---|
| `src/agent/subagent-runner.ts:160` | `role: "researcher" \| "coder"` | 改为 `role: "researcher" \| "coder" \| "analyst"`，或保留 researcher 但标注为"降级轨道"并加 `dispatchPolicy` |
| `src/agent/subagent-runner.ts:287/305/383` | 非 `coder` 一律回退为 `researcher` | 改为显式校验，未知角色报错而非静默归类 |
| `src/agent/subagent-runner.ts:472` | `isInlineScoutTask([spec])` 内联斥候轨道 | 保留（作为降级轨道的调度实现），由 Skill 决定是否使用 |
| `src/agent/subagent-runner.ts:140` `DEFAULT_RESEARCHER_AGENT_ID` | 常驻 | 保留，但仅在 researcher 被派发时才需要 |
| `cph-researcher-agent-prompt.txt` | 存在 | 保留，作为降级轨道资产；验收口径改为"**默认路径不引用**"而非"零残留" |

### 3.6 新增修复 6：接地覆盖对账落地

新增 `src/agent/grounding-ledger.ts`：解析 `<cph_grounding>` 块、与 `grounding-targets.json` 求差、产出 `[GROUNDING: COMPLETE|PARTIAL|UNVERIFIED]` 并写 `execution-ledger`。解析失败按 `UNVERIFIED` 处理（对应 `resilient-parser` 的容错风格，不抛错中断会话）。

---

## 4. 认知资产重写规范

重写遵循 `AGENTS.md` 准则 3（正向引导）与准则 6（黑盒抽象）。本修订版在此基础上增加一条**取证要求**：

> 任何基于云端接地的结论，必须在交付物中给出"我实际引用了哪些路径"的结构化清单；接入云端失败或未命中时，按 §2.3 的优先级降级，并在交付物中说明降级路径。

### 4.1 主控系统提示词（`cph-main-agent-prompt.txt`）

- **角色**：`CPH-Main`，具备云端工作区索引视图的软件架构师、代码质量终审官与工程调度者。
- **工作流**：
  1. **云端优先取证**：首轮 `[SHAREPOINT REMOTE WORKSPACE]` 给出站点、文档库、根路径、文件摘要与可接地 URL。需要审阅源码时，优先通过企业检索精读 `[CLOUD-READY]` 文件；每完成一段分析，记录已引用路径。
  2. **缺口补读**：对未覆盖路径，优先按路径前缀收窄后再检索；仍失败则用 `read_file` 本地补读（本地读是合法且必要的一等路径，不是异常分支）。
  3. **完备性任务**：全量审查/跨模块重构类任务，必须输出 `<cph_grounding>` 清单；`unread` 非空时在报告头部标注覆盖范围与未覆盖风险。
  4. **编码任务**：单点修改 → 主控直接 `patch_file` + `run_command`；多模块 → `plan.md` 立桩 + 派发 `coder`（按 §4.3 四门禁）。
  5. **报告落盘**：长报告分节 `write_file` 落盘，`FINAL_ANSWER` 只放摘要与文件指针。
- **工具集**：`invoke_subagent`（`coder` 默认；`researcher` 在超预算时可用）、`patch_file`、`write_file`、`run_command`、`read_file`（补读与 `[LOCAL-NEW]`）。

### 4.2 编码智能体系统提示词（`cph-coder-agent-prompt.txt`）

- **角色**：`CPH-Coder`，外科手术级实现与测试闭环专家。
- **三步闭环**：
  1. **上下文锚定**：按工单给定路径 + 云端 URL 接地读取目标源码与既有测试；接地未命中或 `[LOCAL-NEW]` 时 `read_file`。
  2. **精准补丁**：存量文件 `patch_file`，新文件 `write_file`；写后同步由系统处理，失败进入重试队列，不阻断本步。
  3. **绿灯结题**：`run_command` 跑工单指定测试/构建；通过后输出 `FINAL_ANSWER`，附修改文件、变更摘要、测试输出证据与 `<cph_grounding>`。

### 4.3 子代理调度技能（`skills/subagent/SKILL.md`）

从"两阶段斥候 + 微切片"重构为"**默认直读 + 超预算降级 + 四门禁派发**"：

1. **默认轨道（主控直读）**：`expectedPaths.count ≤ groundingFileBudget`（默认 60）时，主控自行完成理解与结论，不派发子代理。
2. **降级轨道（调研派发）**：超出预算、需要并行穷举、或需要产出可复用中间调研物时，派发 `researcher`，工单包含路径前缀范围与期望证据结构。原报告"全面移除 Scout/Researcher"在此改为"保留但收敛触发条件"。
3. **编码派发四门禁**：
   - Gate 1 云端认知先行：工单给出函数签名、修改位置、预期行为；
   - Gate 2 文件正交隔离：同 `stage` 内目标文件集合互不重叠，共享契约文件置于前置 `stage`；
   - Gate 3 指令具象化：内化 TDD/重构规范为具体路径、逻辑描述、验证命令；
   - Gate 4 `plan.md` 对账收敛：逐项勾选，全部通过后汇总 `FINAL_ANSWER`。
4. **删除项**：`>500 行独占`、`≤300 行微切片`（这两条是本轮轮次耗尽的直接诱因，日志中 `researcher` 出现 320 次可佐证），以及"单文件必须独立工单"的机械约束。

### 4.4 交接技能（`skills/handoff/SKILL.md`）

1. **双角色适配**：`Main`（阶段成果交接）与 `Coder`（补丁/单测断点交接）；`researcher` 仅在降级轨道被使用时出现。
2. **沉淀"结论与证据"而非"读过什么"**：模块结论、缺陷证据链（路径 + 行号 + 根因 + 建议）、架构决策；同时记录 `<cph_grounding>` 的覆盖状态，让后继会话知道哪些结论有取证支撑。
3. **同步状态对齐**：区分 `[CLOUD-READY]`、`[LOCAL-NEW]`、`[PENDING]`（已编辑但同步待重试，必须显式交接，否则后继会话会读到旧内容）。
4. **`P0/P1` 待办**：`P0` 为第 1 轮可直接执行的动作；`P1` 为 `plan.md` 剩余项与终局交付。
5. **与既有快照的关系**：`workspace-vN.txt` 快照由系统自动投递（`enableWorkspaceSnapshot`），交接文档描述语义而非重复搬运清单。

### 4.5 打包分发（`scripts/package-agent-bundle.ts`）

打包配置更新为 Dual-Agent + 可选调研轨道；同步输出 `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`cph-researcher-agent-prompt.txt`、`skills/subagent/SKILL.md`、`skills/handoff/SKILL.md` 至 `dist/copilot-agent-bundle/` 与 `package/agent-bundle/`。

---

## 5. 验收矩阵（可证伪实验）

原报告的验收标准（`bun test` 通过 + 文本扫描 0 残留）只能证明"代码与文案改完了"，无法证明架构目标 G1 成立。修订为"实验 + 断言"双层。

### 5.1 架构性实验

| 编号 | 实验 | 通过判据 | 失败时的处置 |
|---|---|---|---|
| **E0-1** | 通道对照（§1.2）：同文件同问题，Web UI 与 `ChatHubClient` 各 5 次，`enableTenantSearchOptions` on/off 矩阵 | WebSocket 通道命中率 ≥ 80%，且 on/off 差异显著 | S1 降级为不成立；`cwc_flux_v3` 保持 `false` 默认，架构退回"本地读为主 + 云端为辅" |
| **E0-2** | 文件类型可检索性：`.py`/`.ts`/`.md`/`.xlsx` 各 5 文件 | 代码文件命中率 ≥ 80% | 代码类任务默认本地读，`[CLOUD-READY]` 仅对 Office/PDF 生效 |
| **E0-3** | 规模完整性：5KB / 200KB / 2MB 文件 | 能返回关键常量且无截断错答 | 设 `groundingMaxFileBytes`，超限强制本地读 |
| **E1** | 覆盖对账有效性：构造"清单 20 文件、只读 5 文件"的受控场景 | 系统输出 `GROUNDING: PARTIAL` 且列出 15 个未读 | 对账机制需修正解析或提示词约束 |
| **E2** | 端到端回归：`E:\test` 真实仓库，任务 = 全量代码审查 | 轮次 ≤ 预算；`cited/expectedPaths` ≥ 0.9 或显式声明未读；报告含可核对的行号证据 | 保留 Researcher 降级轨道并调整预算 |
| **E3** | 同步屏障：20 次连续 `patch_file` + 人为注入 429 | 编辑全部成功；失败项进入 `dirty-sync.jsonl`；无丢失 | 屏障设计需改异步/批量提交 |

### 5.2 代码与数据断言

1. `bun test` 全量通过，新增覆盖：`optionsSets` 开关、`isStartOfSession` 首轮传值、URL 编码、map 体积上限、`grounding-ledger` 解析、同步退避。
2. `sp-sync-engine.ps1`：对 `E:\test` 执行 `SyncWorkspace` 后，`E:\test\Library\CNNJI QUERY` 下文件完整出现在 `WorkSpace/test/Library/CNNJI QUERY`；manifest 中 `uniqueId` 为合法 GUID（36 位）、含 `serverRelativeUrl` 与 `firstCreatedAt`。
3. `-PruneOrphans` 默认关闭：缺省执行 `SyncWorkspace` 时，云端多余文件**不被回收**；开启时先产出 `prune-preview.json`。
4. 提示词与 Skill 扫描：默认路径（主控/编码/Skill 主干）不含 `Scout`、`>500 行独占`、`≤300 行`；`researcher` 仅出现在显式标注的降级轨道章节。
5. `bun run package` 成功，产物含 5 个资产。

---

## 6. 风险登记册

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| K1 | 代码文件在 SharePoint 检索链路不可接地（E0-2 失败） | 云端直读对源码任务失效，架构核心价值落空 | 保留本地读为主路径；`[CLOUD-READY]` 按文件类型分级 |
| K2 | 检索召回片段化导致"读全"幻觉 | 报告结论不可信 | §2.4 覆盖对账 + `unread` 显式降级 |
| K3 | 云端 `Library/` 触碰合规/配额/5000 项阈值 | 同步失败或数据治理事故 | §3.2 治理门禁 + 白名单 + 分库告警 |
| K4 | 写后同步阻塞放大任务耗时（每编辑 3–4s） | 多文件任务被同步拖慢 | 超时 + 队列 + 批量提交；同步不阻断编辑 |
| K5 | 并发 `Coder` 触发 CSOM 限流 | 补丁写入成功但云端滞后 | 按站点串行化 + 退避；`[PENDING]` 显式交接 |
| K6 | map 全量注入撑爆首轮 prompt（§2.6） | 首轮即超预算 | Top-N 摘要 + 落盘 JSON + scope 收窄 |
| K7 | 退役 Researcher 丢失并行与隔离 | 超大仓库任务反而更慢 | §2.3 保留降级轨道 |
| K8 | 未验证的 `cwc_flux_v3` 被固化进协议层 | 后续排查被误导 | 开关默认关闭，以 E0-1 为准 |

---

## 附录 A：对原报告的具体更正清单

| 编号 | 原报告位置 | 原表述 | 更正 | 证据 |
|---|---|---|---|---|
| A-1 | §1.1 根因 1 | 导致企业搜索"返回 `NO CONTENT AVAILABLE`（0 条结果）" | 该字符串在引用日志中**不存在**；代码缺项为真，因果为推断 | 三份日志（`13-07-26`、`16-37-40`、`22T15-29-42`）该串命中数均为 0（不区分大小写）；全仓库仅本设计文档命中 |
| A-2 | §1.2 前提 | "在补齐 `cwc_flux_v3` 与 `isStartOfSession: true` 后…实测" | 代码从未包含 `cwc_flux_v3`，与 §3.1 将其列为待修复项矛盾 | `git log -S "cwc_flux_v3" -- src/` 无提交；`chathub-client.ts:257-268` 无该项 |
| A-3 | §1.2 实测 | 结论被称作"核心物理定律" | 实为通过 CDP 驱动 `m365.cloud.microsoft` **网页 UI**、n=2、含强词法锚点的小文本场景；不能外推到 WebSocket 通道与代码文件 | `scripts/test-main-ask-overwrite.ts`（CDP + DOM 轮询）；`scripts/probe-crawler-poll.ts` 的 `elapsedMin` 为人工参数 |
| A-4 | §1.1 根因 2 | "在开启孤儿清理（`PruneOrphans`）时" | 脚本 param 块无 `PruneOrphans` 开关；孤儿回收在 `SyncWorkspace` 阶段 2 **无条件**执行 | `sp-sync-engine.ps1:11-22`（param）、`:546-596`（回收逻辑） |
| A-5 | §1.1 根因 2 | "直接从云端删除" | 实为 `$file.Recycle()` 移入回收站，可恢复 | `sp-sync-engine.ps1:578`、`:582` |
| A-6 | §1.1 根因 3 | "拼接含空格路径时未做 URL 编码，导致 Markdown 链接断裂" | 输出为纯文本 `(Web: url)`，无 Markdown 链接语法；缺陷是 URL 未百分号编码 + manifest 缺 `serverRelativeUrl` 恒走 fallback | `pnp-sync-engine.ts:491-560`；`E:\test\.cph\state\virtual-repo-map.md` 含未编码空格 |
| A-7 | §1.2 前提 | "`UniqueId` 与 Web URL 100% 恒定" | 当前 manifest 记录的是本地伪造串（`guid-35de2792`），非 CSOM GUID，该前提无法复核 | `sp-sync-engine.ps1:508`、`:749`（`"guid-" + Guid.Substring(0,8)`）；`E:\test\.cph\state\sync-manifest.json` 的 `files[".gitignore"].uniqueId` |
| A-8 | §2.1 | "彻底退役 `Researcher`" | Harness 仍保留角色与内联斥候轨道；且退役丢失并行与上下文隔离收益 | `subagent-runner.ts:140,160,287,305,383,472`；`cph-researcher-agent-prompt.txt` 存在 |
| A-9 | §2.1 第 1 条 | "单轮思考内精读任意数量或 100MB 级源码" | 与检索式接地的片段召回机制冲突，且无实验支撑；改为覆盖可对账的工程目标 | §2.2 能力边界表；E0-2/E0-3 待测 |
| A-10 | §3.4 第 1 条 | "该路径在外部工作区下根本不存在" | 表述不完整：路径解析 + `fs.existsSync` 静默跳过；即便存在，`Push-FileToSharePoint` 缺 `-SiteUrl` 会 `throw`，却被 `catch { $status='failed' }` 吞掉并以退出码 0 结束，而 `stdio:"ignore"` 使该失败彻底不可见 | `orchestrator.ts:1067-1095`；`sp-sync-engine.ps1:225`、`:773` |
| A-11 | §3.4 第 2 条 | toolResult 附 "`T+0.00s Hot-Overwrite Ready`" | 客户端只能确认 HTTP PUT 完成，无法确认云端可检索；改为可验证事实陈述 | §3.4 第 3 点 |
| A-12 | §4.4 | 移除 `workspace-vN.txt` 快照描述 | 快照通道仍在运行（`enableWorkspaceSnapshot`），需与新 map 明确分工而非仅删文案 | `orchestrator.ts:541-625`；`src/workspace/snapshot-generator.ts` |
| A-13 | §5 第 3 条 | "确认 0 处 `researcher` 残留" | 验收口径与 §3 改动范围不闭合；改为"默认路径不引用" | 同 A-8 |
| A-14 | 文档头 | `文档状态: Approved` | §3 全部改动未实施、§5 未经执行，应标 `Draft for Review` | 仓库既有 `-v2-verified.md` 命名惯例要求"verified"须有验证记录 |

---

## 附录 B：可直接复用的事实基线（供后续实现者免于二次踩坑）

1. `E:\test\.cph\state\sync-manifest.json` 当前 **3 个文件**：`.gitignore`、`AGENTS.md`、`.vscode/mcp.json`；`folders` 仅 `.vscode`、`test`。
2. `E:\test\.gitignore` 第 2 行 `Library/` → 因 `git ls-files --others --exclude-standard` 语义，`Library` 天然被排除。
3. `E:\test\Library` 实测 **135 文件 / 211.7 MB** → 全量同步与全量入表都需要预算控制。
4. `Orchestrator` 默认 `maxTurns = 30`；云端附件阈值 `12000 chars / 200 lines`（`orchestrator.ts:204-205`）。
5. `PnPWorkspaceSyncEngine.syncFile()` 已存在（`pnp-sync-engine.ts:323`），§3.4 不需要新造同步 API。
6. `sp-sync-engine.ps1` 强绑定 Windows PowerShell 5.1（`:26` 版本硬断言），并硬编码 `SaveBinaryDirect(..., $true)`（`:238`），即 overwrite 语义已具备。
