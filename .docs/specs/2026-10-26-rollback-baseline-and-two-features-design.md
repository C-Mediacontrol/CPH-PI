# 回滚到 30d22da 基线并最小重放两个功能（自动落盘 + 目录附件化）设计规范

- 状态：已获用户口头批准（2026-10-26，brainstorming 流程）
- 适用仓库：`E:\copilot-web proxy\CPH-PI`
- 行为对照基线：`30d22da`（好日志对应版本）
- 问题版本基线：`de2fd20`（坏日志对应版本，仅作模块取材来源）

---

## 0. 决策记录

| ID | 决策 | 依据 |
|---|---|---|
| D1 | 代码与提示词行为基线回滚到 `30d22da` | 旧日志（`cph-terminal-2026-10-25T10-41-13.log`）表现：Turn1 0 个工具调用、2 轮结束、549s 出报告 |
| D2 | `de2fd20` 只作为“模块取材来源”，不整体合并 | 坏日志（`cph-terminal-2026-10-25T20-26-42.log`）：Turn1 13 个本地命令，后续追问空转 7~15 轮 |
| D3 | 读取主通道 = 精简内联索引 + 云端 URL 接地；不做内容快照附件 | 用户选择 B；用户已实测即使 100MB 单体 txt 模型也能召回关键字，瓶颈在引导而不在召回容量 |
| D4 | 两个功能 = ① 文件链接自动落盘；② 目录清单附件化（作为内联清单的补充，不替代） | 用户确认 |
| D5 | 内联映射表硬上限默认 24000 字符，可用环境变量/参数覆盖 | 旧版全量约 32KB 已被验证可用；每行含完整 URL 约 380 字符，24KB 约容纳 60 个文件，既能覆盖典型项目又留出输入余量；超大工作区截断并指向附件 |
| D6 | 两个失败尝试的痕迹（脏工作区、`.worktrees/fix-audit-remediation`、未跟踪脚本）只保全、不删除 | 用户强调“基线要干净”，但保全可追溯 |
| D7 | FilePorter 保留安全加固，但下载路径永不自动执行；`autoExecute` 默认 false | `de2fd20` 的安全审查结论（P0-8） |
| D8 | 不改 Web UI、不新增 Agent 角色、不引入内容快照 | 控制变更面，聚焦回归修复 |

---

## 1. 背景与证据（摘要）

### 1.1 版本与日志对应

| 项 | 好版本 | 坏版本 |
|---|---|---|
| 日志 | `E:\test_workspace\.cph\logs\cph-terminal-2026-10-25T10-41-13.log` | `E:\test_workspace\.cph\logs\cph-terminal-2026-10-25T20-26-42.log` |
| 代码 | `30d22da`（2026-10-25 06:29） | `de2fd20`（2026-10-26 04:24） |
| 工作区 | `E:\test` | `E:\test_workspace` |
| Turn1 工具调用 | 0 | 13（本地扫盘/写脚本/跑 PowerShell） |
| 收敛 | 2 轮、549s、850 tokens | Turn1 被中断；追问轮 7~15 轮空转 |

`30d22da..de2fd20` 之间 18 个提交，核心是 `5ab4e3d`（把内联映射表改为 catalog 附件）与 `c44b84a`（orchestrator 集成）。

### 1.2 已确认的回归机制

1. **首轮内联索引被整段删除（主因）**：`5ab4e3d` 从 `buildTurn1Prompt` / `buildDirectAgentPrompt` / `buildHandshakePrompt` / `buildReGroundingPrompt` 中删除 `dirTree + virtualRepoMap`，只保留一句“索引已作为附件挂载”。坏版本首轮模型没有任何文件名/URL 锚点，只能走本地终端。
2. **附件不能承担“唯一索引”角色**：catalog 上传 `20:29:09`、首轮发送 `20:29:12`；提示词、技能、工具回执没有一条链告诉模型“附件就是索引、下一步怎么读”。模型退回本地。
3. **四板块契约脱节**（用户诊断）：
   - `skills/handoff`、`skills/subagent` 仍引用 `[SHAREPOINT REMOTE WORKSPACE]` 内联映射表（Harness 已不再发）；
   - `cph-dev-agent-prompt.txt` 仍承诺 `workspace-v1.txt` 全景快照（`enableWorkspaceSnapshot` 默认 false）；
   - 系统提示词工具协议为 JSON `{"tool": ...}`，Harness 续轮模板为 YAML `tool: ...`，坏日志出现 `patch_file` 失败后改 `edit` 的来回；
   - 工具回执模板宣称“云端文档引擎已全量解析附件”，但不给附件名/来源/新鲜度；
   - `ask_question` 在 Web 非交互模式返回假确认 `[Non-interactive fallback: Auto-confirmed default]`（`src/cli.ts` 的交互提问回退分支）；
   - catalog 文件内部标题仍为 `[SHAREPOINT REMOTE WORKSPACE]`，与提示词所称 `remote-workspace-catalog.md` 不一致。
4. **云端 URL 映射失真（Harness bug）**：工作区迁移后，`sync-manifest.json` 83 条中 80 条 `serverRelativeUrl` 仍指向旧目录 `.../WorkSpace/test/`，而 `targetFolder` 已是 `.../WorkSpace/test_workspace`；`scripts/sp-sync-engine.ps1` 的 SKIP 分支只在 URL 缺失时才补写，导致 catalog 与内联映射表都输出旧链接。
5. **终止协议空转**：用户改问“为什么”时，模型每轮先写回答再附 `read_file plan.md`（`plan.md` 是系统提示词示例路径），Harness 逐轮执行 ENOENT；Turn4 同一动作重复 7 次。大工具结果继续走附件回传，加剧“看不到内容 → 重试”。

### 1.3 结论

不是模型能力退化，也不是云端检索不可用；是**首轮接地载体被删除 + 四板块契约失配 + 云端映射错误**三者叠加。修复策略应先恢复已验证的行为基线，再以最小补丁加入两个新功能，并把必要契约对齐到同一套说法。

---

## 2. 目标与非目标

### 2.1 目标

1. `E:\copilot-web proxy\CPH-PI` 的代码、提示词、skills、bundle 行为回到 `30d22da` 基线。
2. 在基线上加入**自动落盘**：模型在 `FINAL_ANSWER` 交付段或 `write_file(url)` 中给出文件链接时，Harness 自动下载、落盘到模型声明路径、同步云端，并给出可对账回执。
3. 在基线上加入**目录附件化（补充式）**：首轮挂载 `remote-workspace-catalog.md` 完整清单附件；**保留**内联映射表并加 12KB 上限，溢出时指向附件。
4. 修复 sync manifest 的 URL 刷新缺陷，确保 catalog/内联清单链接属于当前 `targetFolder`。
5. 加入最小防回归：契约测试、能力登记表、调试指纹（agentId / prompt hash / 附件清单 / 每轮工具数）。

### 2.2 非目标

- 不重新设计读取架构，不做内容快照附件。
- 不改 Web UI 的交互形态；不新增 Agent 角色或子代理角色。
- 不整体回滚或删除 `.worktrees/fix-audit-remediation` 与未跟踪实验脚本。
- 不引入自动执行下载文件（`autoExecute` 默认 false）。
- 不修改用户工作区 `E:\test_workspace` 中的业务文件（仅允许修复其 `.cph` 状态/云端映射）。

---

## 3. 基线与回滚方案

### 3.1 WIP 保全（不丢任何现场）

1. 停掉正在运行的 CPH-PI 进程（若在跑）。
2. 在当前分支 `feat/unified-supercharger-execution` 上提交全部改动与未跟踪文件：

```powershell
git add -A
git commit -m "wip: preserve pre-rollback workspace (incl. two prior remediation attempts)"
git tag wip/pre-rollback-20261026
```

3. 记录 `git show --stat wip/pre-rollback-20261026` 摘要到 `.docs/reports/2026-10-26-pre-rollback-wip.md`。切到新分支后从 WIP 分支取回该摘要与本设计文档并单独提交（`git checkout wip/pre-rollback-20261026 -- .docs/...`）。

### 3.2 干净修复分支

```powershell
git checkout -b fix/rollback-30d22da-plus-features 30d22da
git tag baseline/30d22da-behavior
```

- 工作区应回到 `30d22da` 的干净状态；未跟踪文件随 WIP 提交已进入 WIP 分支，不再残留。
- 若 `bun install` 因 `package.json` 变化需要更新依赖（`30d22da` 无 `adm-zip`），在加入自动落盘时再补依赖并锁文件。

### 3.3 基线验证（回滚后、改代码前）

1. `git status --porcelain` 为空。
2. `bun test tests/` 跑通，记录 `pass/fail` 数与已知失败（`tests/scripts/sp-sync-engine.test.ts` 的 ACL 断言按环境 quarantine）。
3. `bun run package` 能生成 `package/agent-bundle/copilot-agent-bundle.zip`。
4. 把测试基线写入 `.docs/reports/2026-10-26-baseline-test-report.md`（后续“相对基线无新增失败”的判据）。

### 3.4 回滚后的已知必要修复（不属新功能，但必须做）

- `sp-sync-engine.ps1` 的 SKIP 分支刷新 `serverRelativeUrl`（见 §5.5）。
- 工作区 `E:\test_workspace` 执行一次 reconcile，让 manifest 指向 `WorkSpace/test_workspace`。

---

## 4. 功能一：文件链接自动落盘

### 4.1 用户故事与触发点

- 模型在 `FINAL_ANSWER` 顶部按交付契约声明：

```markdown
【交付文件与落盘指引 / Deliverables】
- `test/review-report.md` <- [review-report.md](https://fr-prod.asyncgw.teams.microsoft.com/...)
```

- 或中间轮次调用 `write_file` 时传入 `path` + `url`（`content` 与 `url` 二选一）。
- Harness 自动下载并落盘到声明路径；若声明是目录且产物为 zip，则安全解压；随后把可索引文本文件同步到 SharePoint，并生成回执。

### 4.2 组件与数据流

```text
模型输出
  → ResilientParser：FINAL_ANSWER / write_file(url)
  → DeliverablesParser：解析【交付文件与落盘指引】条目（严格语法）
  → DeliveryService.land():
      校验目标路径（工作区内、无覆盖关键文件）
      → FilePorter.fetchAndDeliver()（IC3/Graph 鉴权、host allowlist、大小上限）
      → 保存/解压（zip 安全规则）
      → SyncEngine.syncFile()（文本可索引文件；批量 API 若基线缺失则逐文件循环）
      → 生成 deliveryReport + 回执
  → UI/日志可见：已落盘 N 个 / 云端同步 M 个 / 失败 K 个
```

### 4.3 安全边界（沿用 `de2fd20` 审查结论）

- host allowlist：`*.asyncgw.teams.microsoft.com`、`*.sharepoint.com`、`graph.microsoft.com`；拒绝私有 IP、`localhost`、`file:`、重定向逐跳校验。
- 下载大小上限 100MB；解压条目 ≤ 2000、总大小 ≤ 200MB、单条 ≤ 50MB；拒绝 `..`、绝对路径、符号链接、Windows ADS。
- 落盘默认 `overwrite: false`；关键文件 deny list（`cph-*-agent-prompt.txt`、`AGENTS.md`、`package.json`、`bun.lock`、`scripts/sp-sync-engine.ps1`、`src/auth/**`、`src/protocol/**`、`.git/**`、`.cph/state/*.json`）只对“下载/解压落盘”生效，不影响正常 `write_file`/`patch_file`。
- 下载路径永不自动执行；`autoExecute` 默认 false。
- IC3 下载必须使用“生成链接的账号”的 token；账号不可用时显式失败，不静默换号。

### 4.4 提示词登记

- 在 Main/Coder 提示词中加入正向交付契约（不写负面禁词）：
  - 格式：`- \`<相对路径>\` <- [文件名](<下载链接>)`；
  - `.zip` 目标以 `.zip` 结尾时原样保存，以目录结尾时解压；
  - 交付段落放在 `FINAL_ANSWER` 最顶部。
- Harness 与提示词必须同时登记到 `capability-registry.md`（§6.6）。

### 4.5 错误处理

- 下载/解压/同步失败：不阻断 `FINAL_ANSWER` 完成，但必须写入 `.cph/state/delivery-report.json` 并在 UI/日志输出一行状态；不得静默。
- 目标路径已存在且 hash 不同：默认失败并提示，或加 `.1` 后缀（选择“失败并提示”，避免覆盖用户文件）。
- 解析失败：不把普通 Markdown 链接误判为下载动作（FINAL_ANSWER 优先级最高）。

### 4.6 测试

- `DeliverablesParser`：箭头/反引号/裸冒号、中文文件名、zip 目标语义。
- `ResilientParser`：`FINAL_ANSWER` 中含链接时仍判为 `final_answer`，不生成 `file_porter` action。
- FilePorter：host allowlist、SSRF、ZIP 穿越/炸弹、100MB 上限、覆盖保护、同账号 token。
- Orchestrator：mock 下载 → 落盘路径正确 → 同步回执字段正确 → 失败可见。
- 契约测试：提示词包含交付契约关键字；`buildFileSavedAndSyncedReceipt` 输出格式稳定。

---

## 5. 功能二：目录附件化（补充式）

### 5.1 catalog 规格

`remote-workspace-catalog.md`：

```markdown
# Remote Workspace Catalog

- 工作区绝对路径: <local root>
- 云端工作区根直链: <remote root url>
- 统计: 工作区文件 N | 已同步可索引 M | 本地独有 K | 不可索引 L
- 生成时间 / 会话

## 1. 目录结构（2 层，来自文件系统）

## 2. 文件映射清单
| 本地相对路径 | 体积 | 同步状态 | 云端 WebUrl |
（CLOUD-READY / LOCAL-NEW / LOCAL-ONLY / CLOUD-UNINDEXABLE）
```

- 生成源以文件系统（`git ls-files --cached --others --exclude-standard` + `Library/` 补充）为准；`sync-manifest.json` 只作为状态列。
- 所有 `WebUrl` 必须属于当前 `targetFolder`。
- 大工作区分片：单文件超过 200KB 或 2000 行时生成 `catalog-part-1.md` 等分片或 CSV 附件。

### 5.2 挂载策略

- Turn 1 按当前账号挂载 catalog 附件；换号/接力后先移除旧账号 annotation，再按新账号重传。
- 缓存 key = `账号邮箱 + 内容 hash`；旧 cache（无 email 字段）一律视为未命中。
- 会话内新写文件不重传 catalog，使用落盘回执里的 URL 作为发现途径。

### 5.3 内联映射表上限与选择算法

- **保留** `[SHAREPOINT REMOTE WORKSPACE]` 内联映射表（回滚后的原有能力）。
- 新增 `buildBoundedRepoMap()`：
  1. 解析用户任务中的 SharePoint URL / 路径前缀（如 `.../WorkSpace/test_workspace/Library/CNNJI QUERY`），得到工作区相对前缀集合；
  2. 生成 2 层目录骨架（目录 + 每目录文件数）；
  3. 生成文件行：`- <relpath> (<size> | [STATUS] | <WebUrl>)`；
  4. 排序：任务前缀内 → 源码/配置类 → 最近修改 → 其余；
  5. 硬上限 `CPH_TURN1_INDEX_MAX_CHARS`（默认 24000）：超出时截断文件行，追加 `...（其余 N 个文件见附件 remote-workspace-catalog.md）`；
  6. 无任务前缀时按全工作区排序取前 N；目录骨架始终保留（体积小）。
- 结果注入 `buildTurn1Prompt` / `buildDirectAgentPrompt` / `buildReGroundingPrompt`。

### 5.4 提示词文案（正向引导）

在首轮事实区增加：

> 工作区目录与云端文件索引：内联为精简版；完整清单见随本轮消息挂载的附件 `remote-workspace-catalog.md`（含 2 层目录树与逐文件直链）。
> 搜索/审查类任务：先从索引中选定目标文件，通过其 SharePoint WebUrl 云端直读；需要精确行号、刚写入的文件或标记 `LOCAL-ONLY` 的文件，用 `read_file` 本地补读。

### 5.5 sync URL 刷新修复

`scripts/sp-sync-engine.ps1` SKIP 分支：

```powershell
# 旧：仅在缺失时补写
if (-not $existing.serverRelativeUrl) { ... }
# 新：云端实体的 ServerRelativeUrl 与 manifest 不一致时刷新
if ($cf.ServerRelativeUrl -and $existing.serverRelativeUrl -ne [string]$cf.ServerRelativeUrl) {
    $existing["serverRelativeUrl"] = [string]$cf.ServerRelativeUrl
}
```

- 增加“链接必须落在当前 `TargetFolder` 前缀内”的断言与测试。
- 提供一次性校正入口：优先复用基线已有的 sync CLI/脚本；若基线没有可用入口，则在 `scripts/` 新增最小 `reconcile-cloud-urls.ts`（读取当前 targetFolder、重算 manifest URL、不删除云端文件），在 `E:\test_workspace` 上运行后校验 catalog 全部链接属于 `WorkSpace/test_workspace`。

### 5.6 测试

- catalog 生成：目录树存在、LOCAL-ONLY 可见、统计分类正确、URL 前缀正确。
- 缓存：同账号同 hash 复用；不同账号重传；换号移除旧 annotation。
- 内联上限：构造 2000 文件工作区，断言内联 ≤ 24000 字符且含截断提示；任务前缀过滤生效。
- 契约：首轮提示词同时包含内联映射表与 catalog 附件说明。

---

## 6. 契约对齐与防回归（最小必要）

### 6.1 名称统一

- 内联：`[SHAREPOINT REMOTE WORKSPACE]`
- 附件：`remote-workspace-catalog.md`
- catalog 内部标题与提示词、skills 引用一致；更新 `skills/handoff`、`skills/subagent`（工作区 + bundle 两份）。

### 6.2 过期承诺清理

- `cph-dev-agent-prompt.txt` / `Instructions-系统提示词.txt` 中 `workspace-v1.txt` 的承诺统一改为“按需 `read_file` 或查阅 `remote-workspace-catalog.md`”。基线 `enableWorkspaceSnapshot` 保持 false，不在提示词中承诺快照存在。

### 6.3 工具回执字段

- 回执统一包含：`toolName`、`status`（success/failed/attached）、`source`（local/cloud-attachment）、`freshness`（just-written/synced）、`attachment`（文件名/id，如有）、失败时的 `error` 与解析后的路径。
- 大结果保留头尾指纹（现有 `generateHeadTailExcerpt`）。

### 6.4 `ask_question` 诚实回退

- Web 非交互模式返回：`[QUESTION_UNAVAILABLE] 当前通道无法交互。请基于现有信息继续推进，或在 FINAL_ANSWER 中列出待确认点。`
- 禁止返回假确认。

### 6.5 无进展保护

- Orchestrator 记录最近 `tool + args` 指纹；同一动作连续两次同错 → 注入一次纠正提示（换路径/换工具/总结）；第三次 → 中止该动作并在回执中说明。

### 6.6 调试指纹与能力登记

- Debug 日志每轮输出：`effectiveAgentId`、`promptHash`、`attachmentList`、`toolCallCount`。
- 新增 `.docs/capability-registry.md`：能力 | 提示词登记位置 | Harness 实现点 | 测试 | owner。
- 契约测试：提示词关键字与实现存在性双向断言。

---

## 7. 验收矩阵

### 7.1 自动化

| 层 | 命令 | 通过标准 |
|---|---|---|
| 单元/契约 | `bun test tests/` | 相对基线无新增失败 |
| 构建 | `bun run package` | 产出 bundle zip，提示词文件一致 |
| 静态 | `bunx tsc --noEmit`（若本机可用；不可用时以 `bun build src/cli.ts` 代替） | 无新增类型错误 |

### 7.2 真实任务验收（旧任务重放）

任务：`/thermo-nuclear-code-quality-review` + 同一 SharePoint 目录（`.../WorkSpace/test_workspace/Library/CNNJI QUERY`），输出到 `E:\test_workspace\test`。

| 指标 | 目标 | 对照 |
|---|---|---|
| Turn1 本地扫描类工具调用 | ≤ 1（允许写入/验证） | 旧日志 0；坏日志 13 |
| 收敛轮次 | ≤ 3 | 旧日志 2；坏日志 Turn1 未收敛 |
| 首轮提示词体积 | ≤ 30KB（含内联索引 ≤ 24KB） | 旧版约 32KB 可正常工作 |
| catalog 附件 | 已挂载，链接属于 `test_workspace` | 坏日志链接指向 `test/` |
| 报告落盘 | 文件在声明路径存在，大小 > 0 | 旧日志：链接未落盘 |
| 云端同步回执 | 回执含“已落盘/已同步/失败”真实状态 | — |
| 空转 | 无重复同一失败动作 ≥ 2 次 | 坏日志 7 次 |

### 7.3 回退方案

- `enableAutoLanding` / `enableWorkspaceCatalog` / `enableBoundedRepoMap` 三个开关可独立关闭，回到 `30d22da` 行为。
- 任何改动引入新测试失败 → 回退到 `baseline/30d22da-behavior` 标签。

---

## 8. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 移植 `de2fd20` 模块带出隐藏依赖（`adm-zip`、web scripts） | 构建/测试失败 | 只取独立模块；在 `30d22da` 的 package.json 下补齐依赖并跑全量测试 |
| 内联上限选择算法漏掉关键文件 | 审查覆盖不足 | 任务前缀优先 + 目录骨架 + 附件兜底；契约测试覆盖 2000 文件场景 |
| 真实账号额度消耗 | 验收受限 | 先 mock 全测；真实任务只跑 1 次；失败可换账号 |
| sync 修复影响既有同步行为 | 云端状态异常 | 只改 SKIP 分支 URL 刷新；先 dry-run，再在 `E:\test_workspace` 验证 |
| 用户未重新上传 Agent bundle | 验收不可信 | 输出 zip + UPLOAD-GUIDE；验收前确认 effectiveAgentId |
| 旧工作区 `E:\test` 的 state 与新工作区混用 | catalog 链接错误 | 修复后对 `E:\test_workspace` 做一次 reconcile 并断言 URL 前缀 |

---

## 9. 变更清单（文件级，实施计划展开）

- `src/protocol/deliverables-parser.ts`（新增）
- `src/protocol/resilient-parser.ts`（优先级/回执兼容）
- `src/transport/file-porter.ts`（取 `de2fd20` 加固版 + `adm-zip`）
- `src/transport/substrate-uploader.ts`（如需 per-account 上传）
- `src/auth/token-manager.ts`（IC3 token）
- `src/delivery/landing-service.ts`（新增，隔离落盘逻辑）
- `src/agent/orchestrator.ts`（三个钩子 + 开关 + 无进展保护 + 调试指纹）
- `src/protocol/prompt-builder.ts`（有界映射表 + catalog 说明 + 回执模板）
- `src/workspace/pnp-sync-engine.ts`（catalog 生成 + 状态列 + 分片）
- `scripts/sp-sync-engine.ps1`（URL 刷新）
- `skills/handoff/SKILL.md`、`skills/subagent/SKILL.md`、`package/agent-bundle/` 对应副本
- `cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt`、`cph-dev-agent-prompt.txt` 与 bundle 指令文件
- `.docs/capability-registry.md`（新增）
- `tests/...`（契约/单测/集成）

---

## 10. 开放问题（实施中确认）

1. `write_file(url)` 的 URL 来源是否总是 asyncgw？若出现 SharePoint 直链，直接用 Graph/IC3 下载还是走已同步文件？
2. 交付落盘默认根目录：全工作区默认 `deliverables/`，但读取该工作区 `AGENTS.md` 明确要求时用 `test/`；需要在实现时读取策略文件。
3. 用户需要重新上传 bundle 的时机：建议在功能一、二都完成并通过 mock 测试后一次性上传，避免多次切换。
