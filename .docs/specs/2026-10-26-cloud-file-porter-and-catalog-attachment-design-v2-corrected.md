# 云端文件无头搬运、落盘回执与工作区目录附件化架构设计规范（v2 更正版）

- **文档编号**: SPEC-2026-10-26-CLOUD-PORTER-CATALOG-V2
- **状态**: Corrected Draft for User Review
- **原文档**: [`2026-10-26-cloud-file-porter-and-catalog-attachment-design.md`](./2026-10-26-cloud-file-porter-and-catalog-attachment-design.md)
- **更正日期**: 2026-10-26
- **核查基线**: `30d22da`（原报告声明的干净基线）、当前工作树、`feat/unified-supercharger-execution`
- **核查方法**: Git 历史与工作树逐文件核对；原报告实验台账复算；关键 API 签名与调用点核对；全量测试
- **标注约定**: `【已核实】` 仓库内有证据；`【假设】` 未验证；`【未复现】` 仓库内无证据或与证据冲突；`【更正】` 本版对原报告的修改

> 本文是原报告的**更正副本**，不是另起一套方案。方向（无头落盘、落盘回执、目录附件化）保留；事实性断言、因果解释、实现顺序与安全边界按仓库证据修正。原报告不被修改，二者可并排审阅。

---

## 0. 审查结论

### 0.1 一句话结论

方案方向成立，但不能按原文直接实施。原报告把**一次 happy path 观测**写成了**物理定律**，并在 8 个位置会直接产生错误行为；其中 3 个是数据正确性问题（跨账号附件、云端读到旧版本、catalog 不是全量目录），2 个是交付完整性问题（ZIP 不上云、FINAL_ANSWER 被解析成下载动作），3 个是工程/安全问题（多源 targetFolder、同步超时与并发、任意 URL 下载与覆盖写入）。

### 0.2 阻断级问题（P0，必须先修正）

| ID | 问题 | 仓库证据 | 后果 | 更正方向 |
|---|---|---|---|---|
| P0-1 | **FINAL_ANSWER 交付段可能被 legacy `file_porter` 抢先解析** | `src/protocol/resilient-parser.ts` 的 2c 分支：未命中 `FINAL_ANSWER`/`handoff` 时，ASCII 文件名 Markdown 链接 + `http/blob` URL → `file_porter` action；`.py/.ts/.js/.ps1/.sh` 还会带 `autoExecute: true`。中文文件名不匹配，英文文件名匹配，行为随语言漂移 | 模型漏写 `FINAL_ANSWER` 标记时，报告链接被当成工具动作；`.py` 交付物被自动执行；`parsed.type === "final_answer"` 分支不会进入 | 在 parser 层写死优先级：`FINAL_ANSWER`/`handoff` 先判；2c 只对显式 `download` 属性或 `blob:` 生效；任何 Markdown 链接都不得自动执行；补中英文文件名测试 |
| P0-2 | **跨账号下载用错账号** | 原报告 §2.1 自证：只有生成文件的账号返回 `200`，池内其他账号 `403`。但 §5.2 用 `(client as any)?.token?.email`（**当前**会话账号）取 IC3 Token；`generation++` 且 `!this.chatClient` 时还会 `getNextAvailableToken()`（可能换到不同账号） | 按原报告自证的 403 规则，429/接力换号后 FINAL_ANSWER 的交付物会 403；证据包丢失；回执仍可能写“已落盘” | 生成链接时记录 `ownerEmail`（URL → 账号）；下载时用 owner 的 IC3 Token；owner 不可用时用 CDP 兜底或**显式失败**，不得静默换用当前账号 |
| P0-3 | **附件跨账号隔离只修了 catalog** | `E:\test\.cph\state\workspace-catalog-cache.json` 只有 `catalogHash`，没有 email；annotation 的 `webUrl` 在 `gsc_miymao_cma-cgm_com` 的个人 OneDrive，而会话日志账号是 `GSC.VFU2@cma-cgm.com`；`src/agent/subagent-runner.ts` 用 `getGraphAccessToken()`（无 email）上传 slice/target；后继主会话继续携带旧的 `currentAnnotations` | B 账号无法读取 A 账号的 OneDrive 附件；换到不同账号的 successor/429 后模型看不到目录或快照；并发子代理互相覆盖 | 建**统一附件账本**（`accountEmail + kind + hash`），覆盖 snapshot / catalog / slice；换号或 successor 时先移除旧账号 annotation，再按新账号重传；子代理显式传当前租约 email |
| P0-4 | **“所有落盘文件同步 SharePoint”不成立** | `scripts/sp-sync-engine.ps1` 的 `Test-IsIndexableSyncFile` 明确排除 `.zip/.tar/.gz/.7z/.rar/...`；被 `.gitignore` 忽略的文件不同步；`.cph/` 不同步 | FINAL_ANSWER 的证据包 `.zip` 根本不会上传；catalog 也不列 `.zip`；回执模板却无条件写“已同步至云端工作区” | 回执必须读 `SyncFileResult.status`（`synced/skipped/failed`）；二进制/压缩包要么走独立 Graph 上传，要么明确标 `LOCAL-ONLY`；catalog 增加二进制行与状态列 |
| P0-5 | **catalog 不是“全量目录树”** | `src/workspace/pnp-sync-engine.ts` 的 `generateCatalogMarkdown` 只读 `sync-manifest.json` 的 `files`，过滤 `isNonIndexableBinary`，**没有目录树章节**；`E:\test\.cph\state\remote-workspace-catalog.md` 25 KB，开头只有 Root URL/Total Files/表格，`Total Files: 80`，manifest 实际 83 个（3 个二进制被过滤） | prompt 删掉内联 `dirTree` 后，模型失去目录结构；本地未同步文件（如刚落的 ZIP、`Library/` 外的新文件）在 catalog 中不可见 | catalog 从**文件系统/`git ls-files`** 生成，而不是从同步清单；包含 2 层目录树；包含 `LOCAL-ONLY`、`CLOUD-UNINDEXABLE` 行；明确 `Total Files` 是“可索引同步文件”还是“工作区文件” |
| P0-6 | **targetFolder/URL 有四个来源，且默认值指向个人目录** | RPC 用 `payload/cloudWorkspace/DEFAULT`；orchestrator 用 `manifest/DEFAULT`；`DEFAULT_TARGET_FOLDER` 是 `/sites/CMA-GBSC_BKGDOMAIN/.../Vincent Fu/WorkSpace/live test`；`CPH-PI/.cph/state/sync-manifest.json` 没有 `targetFolder`，`E:\test` 的 manifest 是相对路径 `AFRASIA/.../test`；原报告公式 `${siteUrl}/${targetFolder}/${relPath}` 在 `/sites/...` 形式下会产生双 `/sites/` | manifest 缺 `targetFolder` 时：按原报告的条件会整段跳过（功能静默失效）；按当前实现会回退到个人 DEFAULT（URL 指到 `live test`）。两种都不可接受；`/sites/...` 形式还会产生双 `/sites/` | 单一 `CloudTarget` 解析器：显式会话配置 > manifest > **失败关闭并提示配置**（不得静默用 DEFAULT）；URL 统一用 `generateCatalogMarkdown` 的 `/sites/` 兼容构造；补两种 targetFolder 形式的测试 |
| P0-7 | **“云端优先”会让模型读到旧版本** | `[LOCAL-NEW]` 阈值是 **60s**（`pnp-sync-engine.ts`），原报告自己的冷创建观测是 **180–240s**；catalog 只在 Turn 1 生成，会话内新写文件不在表里；`E:\test\.cph\state\perception-latency-benchmark.md` 记录 `.txt` 文件 30 分钟 10 轮全部 `NOT_READY`；热覆写只在 Web UI 单次观测 | 模型把旧的云端内容当权威，审查/修改基于过期代码；刚写的文件云端读不到，模型误判“不存在” | 读策略按新鲜度分层：**本会话写过的文件 local-first**；`LOCAL-NEW/CLOUD-STALE` 一律 local-first；`CLOUD-READY` 且未被本会话改写的文件才 cloud-first；阈值 ≥ 300s 或直接用 dirty set；prompt 不写“保证最新” |
| P0-8 | **安全边界缺失** | `FilePorter.fetchBlobOrBuffer` 可请求任意 `http/https`；`extractZipSafely` 没有条目数/解压大小上限；落盘只挡“工作区根目录”，可覆盖 `src/...`、`cph-*-agent-prompt.txt`、`scripts/sp-sync-engine.ps1`；`saveAndExecute` 对 `.py/.ts/.js/.ps1/.sh` 默认自动执行 | SSRF/内网/metadata 访问；ZIP bomb；模型（或被注入的工作区内容）覆盖 Harness 代码/提示词并持久化；RCE | 主机 allowlist + 私有 IP 拒绝；重定向逐跳校验；下载大小/时间上限；临时文件 + 原子 rename；默认 `overwrite: false`；关键文件 deny list；下载路径**永不执行**；`file_porter` 默认 `autoExecute: false` |

### 0.3 重要问题（P1）

| ID | 问题 | 说明 | 更正 |
|---|---|---|---|
| P1-1 | 15s 超时没有终止子进程 | `syncFile` 只有 `signal`，没有内置 timeout；`Promise.race` 超时后 PowerShell 子进程仍在跑，可能继续写 manifest | 用 `AbortController` 触发 `syncFile` 的 `signal`；超时即 kill；失败进 pending 队列 |
| P1-2 | “写后同步队列”不存在 | 基线/HEAD 都是动作后即时 sync；`ToolBridgeResult` 没有 `modifiedFiles`，只有 ledger 内部记录 | 明确新建 `.cph/state/pending-sync.jsonl`，定义 schema、重试、drain 时机；或删掉“队列”措辞，只做即时 sync + 失败回执 |
| P1-3 | FINAL_ANSWER 顺序未写明 | 基线 `onCompleted` 在 final_answer 分支一开始就调用；HEAD 残留实现把下载/同步插在 `onTurnEnd/onCompleted` 之前。原报告没写顺序，实施者若按基线位置插入就会“先完成、后落盘” | 明确规定：解析 → 下载/解压 → 同步 → 用户可见交付报告 → `onTurnEnd` → `onCompleted` |
| P1-4 | FINAL_ANSWER 失败静默 | 原报告只说“无回执”，未定义失败可见性；HEAD 用 `catch {}`/`console.warn`，UI 仍显示 completed | `OrchestratorRunResult` 增加 `deliveryStatus: "ok/partial/failed"` 与 `deliveryReport`；UI 显示一行状态；不得只写 console |
| P1-5 | 子代理附件冲突 | `subagent-runner.ts` 已有 `initialAnnotations = [uploaded.annotation]`（slice 或 target file），直接覆盖；orchestrator 再挂 catalog 会二选一 | 统一由 runner 组装 annotations：slice/target + catalog 追加、去重；同一账号上传；定义优先级 |
| P1-6 | 429 换号没有重挂 hook | `onRateLimitDetected` 只 `markThrottled` + new `ChatHubClient`；annotation 不换；当前轮 prompt 已发出 | 换号后下一轮重建 annotations；若必须当前轮，重发带新 annotation 的 prompt；记录旧账号附件失效 |
| P1-7 | “100% 测试绿灯”不现实 | 本次全量：`952 pass / 1 fail / 953 tests / 115 files / 89.77s`；失败是 `tests/scripts/sp-sync-engine.test.ts:117` 的 Windows ACL 断言（`AreAccessRulesProtected` 为空） | 验收改为“相对基线无新增失败”；ACL 测试标注环境条件或 quarantine；新增测试必须有 fixtures 与哈希 |
| P1-8 | “30d22da + 有效改动”未定义 | 工作树有 20+ 修改、`.gitmodules` 删除、`package/bin/check-accounts.js` 修改、bundle zip 修改；`tests/scripts/sp-sync-engine.test.ts` **同时**在残留区间和未提交改动中；`package.json` 的 web scripts 与 `adm-zip` 是区间新增但与 porter 无关 | 先做 WIP 分支/提交保全；按 `git diff --name-status 30d22da b62a037` 逐文件处理；明确排除 `package.json` 的 web scripts、`adm-zip`、sp-sync 测试、`.gitmodules`；不要一句“精准恢复”带过 |
| P1-9 | 真实链接验收不可重复 | `E:\test\CNNJI-QUERY-review-2026-10-25.md` 存在（24,006 bytes，命中 §2.1 的 md 大小）；**405,336 bytes 的 zip 不在盘上**；`E:\test` 只有 `thermo-nuclear-code-quality-review.zip`（5,112 bytes）；asyncgw 链接会过期 | 用本地 mock HTTP + fixtures 做 CI；真实链接只做手动 smoke（`CPH_LIVE_ASYNCGW=1`），断言 SHA-256，不承诺 100% |
| P1-10 | `AADSTS9002326` 解释不准确 | 该错误是“跨源兑换只允许 SPA client-type”，与 client 注册类型/redirect URI 相关，不是“带 Origin 头”本身；基线 `getGraphAccessToken` 本来就不发 Origin | 改为“使用公共客户端 refresh_token 流程；若遇 9002326，核对 client-type 与 redirect URI，不要归因于 Origin” |
| P1-11 | “四要素都是必要条件”没有 ablation | `cwc_flux_v3` 等 6 个 optionsSet、`customAgentId`、`isStartOfSession` 在 `chathub-client.ts` 里已是默认/已实现（`cwc_flux_v3` 由 `b699bf7` 加入）；`%20` 编码是 URL 卫生，不是数据访问开关 | 规则 10 拆成“ChatHub 企业接地不变量”与“IC3 媒体访问不变量”；用单测断言默认 options 不被调用方覆盖；不要用未做 ablation 的“四要素”叙事 |
| P1-12 | catalog “每个文件”与二进制过滤矛盾 | `isNonIndexableBinary` 排除 `.zip/.dll/.exe/...`；`Test-IsIndexableSyncFile` 也排除；catalog 的 `Total Files` 是过滤后的数量 | 明确“可索引文本文件索引”而非“全量文件”；二进制单列状态；或提供第二种附件（清单 CSV） |
| P1-13 | `.zip` 目标以 `.zip` 结尾并未原样保存 | `FilePorter.fetchAndDeliver` 只要 `item.isZip` 就 `extractZipSafely`，即使 `destinationPath = test/package.zip`；测试只覆盖 `test/` 目录目标 | 补 `test/package.zip` 分支：以 `.zip` 结尾 → 保存 zip；以 `/` 结尾 → 解压；补测试 |
| P1-14 | 目录目标文件名来自 anchor text | `fetchAndDeliver` 用 `path.basename(item.name)`；`item.name` 是链接文字（可能是“详细审查文档.md”），不是 URL 文件名 | 目录目标优先 URL pathname basename；anchor 只作显示名；sanitize + 冲突后缀 |
| P1-15 | `:` 分隔符会产生垃圾文件 | `DeliverablesParser` 的 `separatorRegex` 接受裸冒号；`- [报告.md](url): 这是说明` 会把“这是说明”当目标路径 → `test/这是说明` | 只接受箭头/`目标落盘路径:` + 反引号路径；裸冒号仅在 tail 形似路径（含 `/` 或扩展名）时接受 |
| P1-16 | 每次写文件都全量重生成 catalog | `generateCatalogMarkdown` 遍历全部 manifest；每个 `syncFile` 后调用一次；attachment cache 以 hash 为 key，任何一次写都 miss | 每轮 debounce 一次；或把 catalog 生成放到 turn 结束；attachment 不在会话内重传（回执给 URL 即可） |

### 0.4 原报告中可以保留的部分

- `asyncgw` 同账号 IC3 下载的**方向**正确；但必须补 owner 追踪与 403 兜底。
- 中间轮次 `write_file(path, url)` 落盘 + 极简回执的**交互设计**正确；需补 parser 优先级、状态回执、安全边界。
- `FINAL_ANSWER` 顶部结构化交付段的**格式**正确；需补严格语法、目标根目录、失败可见性。
- 用 catalog 附件替代内联 `virtual-repo-map` 的**方向**正确；需把 catalog 改成真正的“目录树 + 工作区清单 + 同步状态”。
- per-account cache 的**方向**正确；需扩展到所有附件，并迁移旧 cache。
- Harness 能力与提示词双向登记的**治理方向**正确；需可测试、可盘点，而不是口号。

---

## 1. 事实核查

### 1.1 已核实成立

| 断言 | 证据 | 结论 |
|---|---|---|
| 会话在 2 轮内结束 | `E:\test\.cph\logs\cph-terminal-2026-10-25T10-41-13.log`：Turn 1 `10:41:42`，Turn 2 `10:50:08`，`turn:end 10:50:52` | 【已核实】轮次=2 |
| 产出 `24,006 bytes` 的 md | `E:\test\CNNJI-QUERY-review-2026-10-25.md` 长度 24,006 | 【已核实】 |
| 工作区目录/映射表被内联 | 基线 `prompt-builder.ts` 的 `buildDirectAgentPrompt`/`buildTurn1Prompt`/`buildHandshakePrompt`/`buildReGroundingPrompt` 都拼接 `dirSkeleton`/`dirTree`/`virtualRepoMap`；`main-plan-snapshot.ts` 也拼接 | 【已核实】 |
| `generation++`、`turn = 0`、后继同 Orchestrator | `orchestrator.ts` 的 `invoke_subagent` 分支：`this.generation++`、`this.sessionId = nextSessionId`、`currentPrompt = formatSuccessorTurn1Prompt(...)`、`turn = 0` | 【已核实】但 successor 不是新 Orchestrator，`currentAnnotations` 会延续 |
| `syncFile(workspaceRoot, relPath, targetFolder, { siteUrl, signal })` 签名成立 | `SyncFileOptions` 有 `siteUrl/mockTransport/manifestPath/dirtyLogPath/signal` | 【已核实】 |
| `customAgentId`/6 个 optionsSet/`isStartOfSession` 已在代码中 | `chathub-client.ts` 的 `optionsSets` 默认数组、`agent: customAgentId ? "Agent" : "web"`、`isStartOfSession: options.isStartOfSession ?? false`；`cwc_flux_v3` 由 `b699bf7` 加入 | 【已核实】规则 10 主要是“保持默认 + 不被调用方覆盖”，不是从零新增 |
| `bun run package`/`bun test` 可用 | `package.json` scripts；`bun 1.4.2`；全量测试可跑 | 【已核实】 |

### 1.2 部分成立、被夸大或混淆

| 原报告断言 | 核查 | 更正写法 |
|---|---|---|
| “主控 2 轮内**精读**完云端项目源码” | 日志只有 2 轮 + `reasoning:chunk`，**没有 tool 调用**；`turn:end` 只有 850 tokens；24 KB 报告更像文件生成/代码解释器产物，而不是聊天正文。无法区分模型读的是云端 URL、Turn 1 的 workspace snapshot 附件，还是生成时的上下文 | “2 轮内产出了 24 KB 报告；读取通道无法从现有日志归因。需 E0 通道对照才能说云端直读带来了效率” |
| “冷创建最短 T+240s” | 表中 180s 仍 `NOT_READY`，240s 成功，故首次可感知时间落在 **(180s, 240s]**；单文件、单账号、单次；查询本身 12–18s；无重复/分布 | “单次观测：180s 未命中、240s 命中；只能写区间，不能写‘最短 240s’，更不能写‘3–4 分钟物理定律’” |
| “热覆写 T+0.0s 瞬时” | 既有更正版 spec（`2026-10-25-zero-io-cloud-workspace-architecture-design-v2-corrected.md` §1.2）已把它降级为“有可能在数秒内”，并指出 `test-main-ask-overwrite.ts` 走的是 **Web UI/CDP**，不是 ChatHub WebSocket；小脚本 + 强词法锚点 | “【假设】同一租户、已索引存量文件，经 Web UI 可能在数秒内返回最新内容；与通道、文件类型、并发编辑的关系未验证。不得作为‘云端优先’的物理依据” |
| “池内其他账号 403，无头裸请求 401/404” | 仓库内 `scripts/test-probe-asyncgw.ts` 只测 M365/Graph Token 和 Cookie，**不测 IC3 Token**；循环遇到第一个成功就 `return`，没有完成跨账号矩阵；没有原始输出落盘 | “跨账号 403 是**待复现假设**；需 E1 矩阵（3 账号 × 有/无文件名 × IC3/M365/Graph/Cookie），记录 status/bytes/hash，不得 early return” |
| “catalog 含目录结构树 + 全量文件” | `generateCatalogMarkdown` 无树；从 manifest 读，过滤二进制；`E:\test` 生成物 80/83；catalog 只有 Root URL/Total/表格 | “catalog 当前是‘可索引同步文件映射表’，不是目录树/全量清单；需按 §3.3 重做” |
| “所有落盘文件立即上云” | `Test-IsIndexableSyncFile` 排除 `.zip` 等；`.gitignore` 文件不同步 | “文本/代码可同步；二进制/压缩包默认不同步；回执按实际状态” |
| “100% 测试绿灯” | 本次全量 952 pass / 1 fail；失败在 `tests/scripts/sp-sync-engine.test.ts:117`（ACL） | “相对基线无新增失败；ACL 测试按环境 quarantine” |

### 1.3 未复现或不成立

| 原报告断言 | 核查 | 结论 |
|---|---|---|
| URL 尾部 `/<filename>` 导致 404，截断到 `/views/original` 即 200 | 仓库内没有 `normalizeAsyncGwUrl`；`fetchBlobOrBuffer` 原样使用 URL；`scripts/test-probe-asyncgw.ts` 用的就是**带文件名**的 URL，且没有截断对照；测试 `file-porter-extract.test.ts` 的 URL 也没有尾部文件名 | 【未复现】因果未用 A/B 证明。更正：先用同一 Token 做“带/不带文件名、带/不带 query”的四格实验，再决定是否截断；截断必须保留 `search` |
| “AADSTS9002326 由 Origin 头触发，不发 Origin 即可避免” | 基线 `getGraphAccessToken` 不发 Origin；仓库无 9002326 记录；该错误语义是 SPA client-type 的跨源兑换限制 | 【更正】归因不准确；见 P1-10 |
| “`405,336 bytes` 的 zip 已下载并 100% 完整” | 该 zip 不在 `E:\test`；只有 5,112 bytes 的另一个 zip | 【未复现】数字无法对账；不要写“100% 完整” |
| “模型未结构化声明落盘路径” | `E:\test\CNNJI-QUERY-review-2026-10-25.md` 确实在**工作区根目录**（无法从现有日志区分是 harness 落盘还是人工保存，但至少说明根目录污染没有被阻止）；终端日志没有 FINAL_ANSWER 正文，无法判断模型是否声明 | 【部分】“未声明”无法从日志证明；“根目录有文件”有证据 |
| “`test/` 是安全的默认二级目录” | `E:\test\AGENTS.md` 确实规定所有文件放 `test/`；但这是**该工作区的约定**，不是通用规则；`CPH-PI` 根工作区的二级目录是 `CPH-PI/`，`test/` 反而是源码测试目录 | 【更正】`test/` 只能是“读取工作区策略后的结果”，不能硬编码为通用 fallback |
| “`FINAL_ANSWER` 的 `.zip` 目标以 `.zip` 结尾时原样保存” | `fetchAndDeliver` 只要 `isZip` 就解压；没有该分支测试 | 【不成立】当前实现相反；见 P1-13 |

### 1.4 已有反例：30 分钟的 `.txt` 未命中

`E:\test\.cph\state\perception-latency-benchmark.md` 记录：

- 测试文件：`test/perception-benchmark-1792933647018.txt`
- 目标路径：`.../WorkSpace/test/test/perception-benchmark-1792933647018.txt`（双 `test/` 嵌套）
- 唯一秘钥：`PERCEPTION_BENCHMARK_1792933647018_CMA_CGM`
- 10 轮：1/2/3/5/8/11/15/20/25/30 分钟，**全部 `NOT_READY`**

这条记录不能直接证明 `.txt` 永远不可索引（双 `test/` 路径本身可能就是失败原因），但它足以否定“冷创建 3–4 分钟是物理定律”的写法。原报告没有引用这条同工作区反例，证据集不完整；在把 240s 写成通用结论前，至少应解释这条反例或将其排除。

---

## 2. 实验基线更正

### 2.1 冷创建 240s 实验的 5 个缺陷

1. **秘钥在文件名里（污染）**：探针文件叫 `test/direct-url-latency-exact-1792946218578.md`，期望内容是 `EXACT_LATENCY_SECRET_1792946218578_VERIFIED`。数字 `1792946218578` 在**文件名/路径**中；模型只要看到目录或搜索结果标题，就能复述数字，不需要读取正文。必须把秘钥只放在正文，文件名用随机无意义串，且 prompt 不出现秘钥。
2. **单样本、区间不是点值**：180s `NOT_READY`、240s 成功 → 首次可感知时间在 (180s, 240s]；没有 N=10、没有不同时间点重复、没有失败分布。
3. **通道混淆**：`probe-crawler-poll.ts` 走 `m365.cloud.microsoft` 的 CDP/Web UI；Harness 走 `ChatHubClient` WebSocket。两者检索规划、缓存、租户策略可能不同。原报告没有做通道对照。
4. **文件类型/路径混淆**：只测 `.md`，且路径是单层 `test/`；同工作区的 `.txt` 在双层 `test/test/` 下 30 分钟未命中。纯代码 `.py/.ts`、`.xlsx`、大文件（200KB/2MB）都未测。
5. **没有原始证据**：仓库内没有这次 240s 实验的脚本/输出；`perception-latency-benchmark.md` 是另一组 `.txt` 数据；`test-probe-asyncgw.ts` 不测 IC3/截断。报告应给出可重跑的脚本与 raw JSONL。

### 2.2 热覆写 0s 的更正

- 既有更正版 spec（[`2026-10-25-zero-io-cloud-workspace-architecture-design-v2-corrected.md`](./2026-10-25-zero-io-cloud-workspace-architecture-design-v2-corrected.md) §1.2）已明确：`test-main-ask-overwrite.ts` 通过 CDP 驱动 Web UI，输入框 `insertText` + 点击发送 + DOM 轮询；不是 ChatHub 通道。
- 测试是小脚本（`BASE_PRICE`/`KERNEL_MULTIPLIER`/`SECURITY_OFFSET`），prompt 里带了强词法锚点；这有利于检索命中，不能外推到“任意源码、任意文件”。
- 结论应写成：**【假设】在同一租户、已索引的存量文件上，Web UI 可能在数秒内返回最新内容；ChatHub 通道、文件类型、并发编辑、缓存命中均未验证。**
- 因此，“云端检索到的文件保证为最新的权威版本”这句话必须从提示词和 spec 中删除。

### 2.3 跨账号 403 的更正

- `scripts/test-probe-asyncgw.ts` 的循环：对每个账号先取 M365/Graph Token，试 4 种 header + Cookie；**第一个 `res.ok` 就 `return`**。这无法证明“其他账号都 403”，也无法证明“裸请求 401/404”。
- 该脚本没有 `IC3_SCOPE`、没有 `ic3.teams.office.com`、没有截断 URL，因此不能支撑 §2.1 的 IC3 结论。
- 更正：跑 E1 矩阵；每个组合都记录 `status`、`content-length`、`sha256`、`www-authenticate`；不要 early return；把 raw 结果写 `.cph/state/asyncgw-matrix.jsonl`。

### 2.4 真实链接验收的更正

- `E:\test\CNNJI-QUERY-review-2026-10-25.md` 存在且 24,006 bytes；但 `405,336 bytes` 的 zip 不在盘上。
- asyncgw 链接依赖 IC3 Token/对象生命周期，不能作为 CI 的稳定 fixture。
- 更正：CI 用本地 `http.createServer` + 固定 fixtures（md/zip/bin），断言落盘 SHA-256；真实链接只做手动 smoke，且 `CPH_LIVE_ASYNCGW=1` 才跑。

### 2.5 建议的最小可信实验矩阵

| 编号 | 目的 | 变量 | 样本 | 通过标准 |
|---|---|---|---|---|
| E0 | 通道对照 | Web UI vs ChatHub；冷/热；`.md/.py/.ts/.xlsx`；5KB/200KB/2MB | 每格 N=10 | 记录 hit/miss/old/new 分布；给出 p50/p95；不把单次当定律 |
| E1 | 跨账号矩阵 | 3 账号 × 有/无文件名 × IC3/M365/Graph/Cookie | 每格 1 次，全部记录 | 200 的账号集合、403/401/404 分布、bytes/hash；不 early return |
| E2 | URL 规范化 A/B | 同一 Token：带/不带 `/<filename>`、带/不带 query | 每格 N=5 | 证明 404 的真实原因；截断后仍 200 且 hash 一致 |
| E3 | catalog 可检索性 | 80/379/2000 行；指定 5 个路径 | 每规模 N=5 | 精确行命中率；不是“附件里有就算读到” |
| E4 | 同步吞吐/并发 | 1/10/50 文件；1/4 子代理并发 | 每格 N=3 | p50/p95；manifest/cache 无损坏；无重复上传 |
| E5 | ZIP 安全 | 10k 条目、2GB 解压、`../`、绝对路径、symlink、ADS | 每类 1 次 | 拒绝或安全截断；不写出工作区；不覆盖关键文件 |
| E6 | Parser 优先级 | `FINAL_ANSWER` 有/无标记；中/英文文件名；`.md/.zip/.py` | 每类 1 次 | 不产生 `file_porter` action；`.py` 不执行 |
| E7 | 换号交付 | A 账号生成链接 → 换 B → FINAL_ANSWER | 1 次 | 用 owner 账号成功；或显式失败并给出可操作错误 |

---

## 3. 更正后的架构

### 3.1 目标与非目标

**目标**

1. 模型给出的 `asyncgw` 文件链接，能在宿主侧无头落盘；落盘路径可预测、可对账。
2. 中间轮次落盘后，模型收到“本地路径 + 云端 URL + 实际同步状态”的极简回执。
3. `FINAL_ANSWER` 的结构化交付段自动落盘/解压/同步，用户能看到交付状态。
4. 工作区目录不再整段拼进聊天框；改为首轮附件 + 单行提示。
5. 附件与账号绑定；换号/接力后仍可读。
6. 上述能力都有正向提示词登记与自动化测试。

**非目标**

- 不承诺“云端检索能定点读全文”；检索式接地是片段级、相关性排序，URL 只是提示。
- 不承诺“所有文件都能上 SharePoint”；二进制/压缩包默认不参与索引同步。
- 不承诺“所有工作区都适用 `test/`”；输出根目录必须可配置/可读策略。
- 不把 `file_porter` 的自动执行能力扩展到新的交付路径。

### 3.2 读取模型：按新鲜度分层，而不是“云端优先”

原报告把读取策略写成“云端优先、本地兜底”。更正为三层：

| 文件状态 | 判定 | 读取顺序 | 提示词写法 |
|---|---|---|---|
| **本会话写过 / dirty** | `sessionWritten` 集合（内存 + `.cph/state/session-written.json`）命中 | **本地 `read_file` 优先**；云端只作交叉核对 | “本会话写过的文件以本地为准；云端可能滞后” |
| **LOCAL-NEW / CLOUD-STALE** | `firstCreatedAt == lastSyncedAt` 且 `now - lastSyncedAt < 300s`，或 dirty | 本地优先；云端可选 | “该文件刚同步，云端索引可能未就绪” |
| **CLOUD-READY 且未被本会话改写** | manifest 有记录、hash 匹配、非 dirty | 云端检索优先；需要精确行号/全文时本地补读 | “可先云端检索；需要逐行核对时用 `read_file`” |
| **UNKNOWN / 不在 catalog** | 无记录 | 本地 `read_file` / `ls`；不要假设不存在 | “catalog 未收录不等于文件不存在” |

关键更正：

- 删除“云端检索到的文件保证为最新的权威版本”。
- 删除“模型在云端暂未读到新文件时**自然会**回退”；回退要靠提示词明确 + dirty 标记，不能靠“自然”。
- `[LOCAL-NEW]` 阈值从 60s 改为 **≥300s**（覆盖原报告 240s 观测 + 余量），并优先使用 `sessionWritten` 而不是纯时间窗。
- catalog 在 Turn 1 生成后，会话内新写的文件不在表里；回执里的 URL 是这些文件的主要发现途径，不要指望模型从旧 catalog 查到它们。
- 模型侧的脏集来源：每次写后回执 + 每轮一行 `sessionWritten: <最多 10 个路径>` 摘要（或等价的状态行）；不要只靠 Turn 1 的 catalog 快照。

### 3.3 目录附件：工作区清单 + 同步状态，不是同步清单

catalog 的生成源改为：

1. `git ls-files --cached --others --exclude-standard`（与 `SnapshotGenerator` 一致）；
2. 对 `Library/` 等 gitignored 但需要展示的目录做显式补充（与 `sp-sync-engine.ps1` 的 Library 特判一致）；
3. 以 `sync-manifest.json` 作为**状态列**，而不是文件清单的唯一来源。

建议结构：

```markdown
# Remote Workspace Catalog

- Remote Root URL: ...
- Local SSOT: ...
- Workspace Files: 412 | Synced+Indexable: 379 | Local-only: 21 | Cloud-unindexable: 12
- Generated at: ... | Session: ...

## 1. Directory Skeleton (2 levels)
（真正的 2 层目录树，来自文件系统）

## 2. File Mapping Index
| 本地相对路径 | 体积 | 同步状态 | 云端 WebUrl | 索引状态 |
|---|---|---|---|---|
| `src/a.ts` | 12.3KB | SYNCED | https://.../src/a.ts | CLOUD-READY |
| `deliverables/report.zip` | 405KB | LOCAL-ONLY | — | CLOUD-UNINDEXABLE |
| `src/new.ts` | 2.1KB | PENDING | — | LOCAL-NEW |
```

要点：

- **目录树**必须真的存在；原报告说“第 1 节：2 层目录结构树”，当前 `generateCatalogMarkdown` 没有。
- **LOCAL-ONLY / CLOUD-UNINDEXABLE** 必须可见；否则删掉内联 dirTree 后，模型看不到未同步文件。
- `Total Files` 拆成“工作区文件 / 已同步可索引 / 本地-only / 不可索引”，避免 80 vs 83 的歧义。
- 大工作区分页/分片：单文件超过 ~200 KB 或 2000 行时，生成 `catalog-part-1.md`/`part-2.md` 或 CSV 附件；不要假装 RAG 一定能召回第 1500 行。
- URL 统一复用 `generateCatalogMarkdown` 的 `serverRelativeUrl`/`/sites/` 兼容逻辑；不要在每个调用点手拼。

### 3.4 统一附件账本：所有附件，不只 catalog

新增 `.cph/state/attachment-ledger.json`：

```json
{
  "entries": {
    "gsc.vfu2@cma-cgm.com": {
      "catalog": { "hash": "...", "annotationId": "...", "webUrl": "...", "updatedAt": "..." },
      "snapshot": { "hash": "...", "annotationId": "...", "webUrl": "...", "updatedAt": "..." },
      "slice:<subId>": { "hash": "...", "annotationId": "...", "webUrl": "...", "updatedAt": "..." }
    }
  }
}
```

规则：

- **key = `email.toLowerCase()` + kind + contentHash**；三者任一不匹配就重传。
- 旧 `workspace-catalog-cache.json`/`workspace-snapshot-cache.json` 做一次性迁移；旧格式没有 email，**一律视为未命中**，不要复用。
- successor/429 时：先 `currentAnnotations = currentAnnotations.filter(a => ledger.owner(a) === currentEmail)`，再按新账号重传需要的 kind；不要继续携带旧账号 annotation。
- 子代理：`SubagentRunner` 用当前租约 `email` 调 `getGraphAccessToken(email)`；`initialAnnotations` 改为“追加 + 去重”，不要覆盖 slice/target。
- 所有上传走同一把 `(workspaceRoot, kind, hash, email)` 的 single-flight 锁（进程内 Promise map + 跨进程文件锁），避免 4 个并发子代理各传一份。

### 3.5 同步：批量、可中止、状态可读

- **批量**：每个 turn 结束收集 `landedPaths`，走新增的 `syncFiles` 批量方法（或串行循环但只起一个 PowerShell 进程）；不要每个文件 `Promise.race`。
- **可中止**：`AbortController` + `syncFile({ signal })`；超时/用户取消即 kill 子进程；不要只 race。
- **单写者**：manifest/cache 写入加文件锁；并发子代理串行化，或每个子代理用独立 manifest 再合并。
- **状态回执**：`SyncFileResult.status` 映射：
  - `synced` → `已同步至云端工作区: <url>`
  - `skipped` → `云端已存在且未变更: <url>`
  - `failed` → `已落盘至本地: <relPath>；云端同步失败: <reason>（已加入待同步队列）`
  - 二进制/压缩包 → `已落盘至本地: <relPath>；该类型不参与 SharePoint 索引同步`
- **pending 队列**：`.cph/state/pending-sync.jsonl`，字段 `{relPath, sha256, targetFolder, siteUrl, attempts, lastError, createdAt}`；下个 turn 开始 drain，最多 3 次；失败在 prompt 里一行提示，不阻断主流程。
- **catalog 刷新**：每 turn 最多一次，debounce 500ms；不要每个文件都 `generateCatalogMarkdown`（O(N²)）；会话内不重新上传 catalog 附件（回执里的 URL 已足够），除非模型明确要求。

### 3.6 终局交付：顺序、状态、边界

正确顺序（基线代码是把 `onCompleted` 放在最前面，实施时不要照抄）：

```text
parse FINAL_ANSWER
  → DeliverablesParser.parse（严格语法）
  → 逐个 fetchAndDeliver（全局 deadline 120s，单项 60s）
  → 汇总 landedPaths / failures
  → 文本/代码批量 sync；二进制按策略 Graph 上传或标记 LOCAL-ONLY
  → 生成 deliveryReport（用户可见）
  → onTurnEnd
  → onCompleted
  → return { completed: true, deliveryStatus, deliveryReport }
```

规则：

- **不向模型发回执**（终局没有下一轮），但**必须向用户可见**：`completed: true` + `deliveryStatus: "ok/partial/failed"` + 一行“已落盘 N 个，云端同步 M 个，失败 K 个”。
- 失败不阻断 `completed`，但不能静默；至少写 `.cph/state/delivery-report.json`。
- 每个交付项记录 `url/ownerEmail/destination/status/bytes/sha256/error`，便于对账。
- 目标根目录：`deliverablesRoot` 配置项；默认 `<workspace>/deliverables/`；若工作区 `AGENTS.md` 明确要求 `test/`（如 `E:\test`），读取策略后用 `test/`；不要在所有工作区硬编码 `test/`。
- 覆盖策略：默认 `overwrite: false`；目标已存在且 hash 不同 → 加 `.1` 后缀或失败并提示；关键文件 deny list 见 §5。

### 3.7 安全边界（原报告缺失）

| 威胁 | 当前/原报告状态 | 必需控制 | 测试 |
|---|---|---|---|
| SSRF / 内网 / metadata | `fetchBlobOrBuffer` 任意 `http/https` | 主机 allowlist（`*.asyncgw.teams.microsoft.com`、`*.sharepoint.com`、`graph.microsoft.com` 等）；拒绝 IP 字面量/私有网段/`localhost`/`file:`；重定向逐跳校验 | E5：`http://127.0.0.1`、`http://169.254.169.254`、`file://` 必须拒绝 |
| 覆盖 Harness 代码/提示词 | 只挡工作区根目录 | 关键文件 deny list：`cph-*-agent-prompt.txt`、`AGENTS.md`、`package.json`、`bun.lock`、`scripts/sp-sync-engine.ps1`、`src/auth/**`、`src/protocol/**`、`.git/**`、`.cph/state/*.json`；**仅对下载/解压落盘生效**，正常的 `write_file`/`patch_file` 编码编辑不受影响；命中 → 重定向到 deliverables 根或失败 | 目标 `src/auth/token-manager.ts` 必须不覆盖；正常编辑仍可写 |
| ZIP bomb / 路径穿越 | `extractZipSafely` 有 root containment，但无条目/大小上限 | 条目数 ≤ 2000；解压总大小 ≤ 200MB；单条目 ≤ 50MB；拒绝 `..`/绝对路径/符号链接/Windows ADS（`:`）；解压前计算总量 | E5：10k 条目、2GB 解压必须拒绝 |
| 自动执行 | `saveAndExecute` 对脚本默认执行；`resilient-parser` 2c 也会带 `autoExecute` | 新的下载路径永不执行；`file_porter` 默认 `autoExecute: false`；执行需显式用户确认/白名单 | `.py` 交付物落盘后不得产生子进程 |
| Token 泄漏 | IC3/Graph token 可能进日志/异常 | 日志/回执/错误信息统一 redact `Authorization`/`Bearer`/`refresh_token`；缓存只存 annotation，不存 token | 日志 grep 不得出现 token |
| 租户合规 | 用 refresh_token 换 IC3 scope；文件进个人 OneDrive | 明确这是租户策略允许的内部使用；记录账号/用途；不跨租户复用；失败时降级而非绕过 | 安全评审签字 |

### 3.8 治理：规则 10/11 的可测试化

- **规则 10a（ChatHub 企业接地）**：`buildInvocationPayload` 的默认 `optionsSets` 必须包含 `cwc_flux_v3`/`flux_v3_references*`/`cwc_fileupload_odb`/`add_filestore_filetype`；首轮 `isStartOfSession: true`；`customAgentId` 存在时 `agent=Agent&agentHost=Bizchat.FullScreen&gptId=...`，载荷有 `threadLevelGptId`/`gpts`。用单测断言，不靠叙述。
- **规则 10b（IC3 媒体访问）**：`IC3_SCOPE` 常量、同账号 token、host allowlist、owner tracking、403 兜底。用单测 + E1 矩阵断言。
- **规则 11（Harness-Prompt 双向登记）**：维护一张 `capability-registry.md` 表：能力 | 提示词位置 | parser/执行点 | 测试 | owner。新增能力必须同时改三处；CI 检查提示词包含登记关键字。
- 删除“缺省时无法访问任何企业内部数据”这类未做 ablation 的绝对因果；改为“该配置下企业接地未启用，需用 E0 验证”。

---

## 4. 组件更正版

### 4.1 `FilePorter`

**`normalizeAsyncGwUrl(rawUrl)`**

```ts
// 伪代码，关键是语义
const u = new URL(rawUrl);
if (!isAllowedHost(u.hostname)) throw new Error("host not allowed");
const m = u.pathname.match(/^\/v1\/objects\/([^/]+)\/views\/original(?:\/(.+))?$/);
if (!m) return { url: u.toString(), fileName: null };
const fileName = m[2] ? decodeURIComponent(m[2].split("/").pop()!) : null;
u.pathname = `/v1/objects/${m[1]}/views/original`;
return { url: u.toString(), fileName }; // 保留 search/hash
```

- 精确 host 后缀匹配，不用 `[^/]*asyncgw` 这种可被 `evil-asyncgw...` 绕过的正则。
- 保留 `search`；不要粗暴 `slice` 到 `/views/original`。
- 单独返回 `fileName`，供目录目标使用；不要从截断后的 URL 再取文件名（原报告 §5.1 的顺序会丢文件名）。
- 先做 E2 A/B，再决定是否默认截断；若服务端接受带文件名，优先不截断。

**`fetchFileBuffer`**

- allowlist + 私有 IP 拒绝；`redirect: "manual"` 或逐跳校验；最多 5 跳。
- 大小上限（默认 100MB，可配）；`Content-Length` 预检 + 流式读取硬上限；超限 abort。
- 流式写临时文件（同目录 `.part`），完成后 `fs.rename`；中途失败删除 `.part`。
- 计算 SHA-256；与 `Content-Length`/期望 hash 对账；回执/报告带 hash。

**`deliverToWorkspace`（替代原报告 `downloadToWorkspace` 的模糊签名）**

```ts
deliverToWorkspace(item: DeliverableItem, opts: {
  workspaceRoot: string;
  deliverablesRoot: string;
  ic3Token?: string;
  cdpClient?: any;
  allowOverwrite?: boolean;
  signal?: AbortSignal;
}): Promise<DeliveryResult>
```

- 目录目标：用 `item.fileNameFromUrl ?? sanitize(item.name)`；不是 anchor text 优先。
- `.zip` 且目标以 `.zip` 结尾：保存 zip，不解压。
- `.zip` 且目标以 `/` 结尾：解压；只剥离与目标目录同名的**唯一**顶层前缀；不要“平铺一切”。
- 非 `.zip` 且目标以 `/` 结尾：拼文件名；以文件路径结尾：直接写。
- 不执行任何下载内容；`saveAndExecute` 保持独立，默认不自动执行。

### 4.2 `DeliverablesParser`

- **严格语法**：只解析 `【交付文件与落盘指引 / Deliverables】` 块内，或 `FINAL_ANSWER` 顶部该块开始到下一个空行/标题/`---` 为止的 `- [name](url) -> \`path\``；不要全文扫描，也不要设固定 10 行上限。
- **分隔符**：只接受 `->`/`→`/`➔`/`目标落盘路径:` + 反引号；裸冒号仅在 tail 匹配 `^(?:[\w.-]+/)+[\w.-]+$` 或 `\.[a-z0-9]{1,10}$` 时接受。
- **禁止相邻上下文推断**：不要“从同一行或相邻上下文提取目标子目录”；推断错会把文件写到源码目录。缺路径就报错/跳过，并在回执提示模型补写。
- **路径**：拒绝 `..`（不要静默 strip）；拒绝绝对路径（或仅允许在 workspace 内）；拒绝关键文件；默认 `deliverablesRoot`。
- **isZip**：只看 URL pathname/query 的 `.zip`，不看 anchor 文案里的“压缩包/自动解压”；否则说明文字会把 `.md` 误判为 zip。
- **文件名**：目录目标优先 URL basename；anchor 只作显示名；sanitize Windows 非法字符；冲突加后缀。
- **解析优先级**：`FINAL_ANSWER`/`handoff` 先于 2c；2c 只对显式 `download` 属性或 `blob:`；Markdown 链接不再自动生成 `file_porter` action。
- **测试**：中/英文文件名、`.md/.zip/.py`、裸冒号、缺路径、`../`、重复 URL、同一文件多链接。

### 4.3 `Orchestrator`

**中间轮次 `write_file(url)`**

- 在 `toolBridge.executeAction` **之前**拦截：`tool === "write_file" && (url || downloadUrl)`。
- 取 owner：若 URL 是本次会话刚生成的（可从 `delivery-ledger` 查），用 owner；否则用当前账号并记录“unknown owner”警告。
- 下载 → 落盘 → 收集 `landedPaths`。
- 同步：批量；回执用实际 status；失败进 pending。
- 回执文本不要包含“已同步”除非 status 是 `synced/skipped`；不要把多个 `landedPaths` 只写一个 `path`。
- 不把 `url` 字段传给 `ToolBridge` 的 `write_file`（否则 `content=""` 会先写空文件）；应在 Orchestrator 分支直接处理。

**终局**

- 见 §3.6 的顺序。
- `deliveryReport` 写入 `.cph/state/delivery-report.json`，`OrchestratorRunResult` 带 `deliveryStatus`。
- 失败时 `completed: true` 但 `deliveryStatus: "partial/failed"`；UI/CLI 必须显示。

**账号**

- `client.token.email` 是当前账号；owner 是生成链接的账号；两者不是一回事。
- 429/empty-response 换号后，下一轮重建 annotations；不要继续用旧 annotation。
- 子代理用 `getGraphAccessToken(email)`；不要无参调用。

### 4.4 `PnPWorkspaceSyncEngine` / catalog

- **`CloudTarget` 单一来源**：

```ts
type CloudTarget = { siteUrl: string; targetFolder: string };
resolveCloudTarget({ workspaceRoot, explicit }): CloudTarget
// 优先级：explicit > manifest.siteUrl/targetFolder > throw
// 永不静默回退到 DEFAULT_TARGET_FOLDER（那是个人目录）
```

- `DEFAULT_SITE_URL`/`DEFAULT_TARGET_FOLDER` 只用于测试/mock；生产路径缺配置就失败并提示用户配置。
- `generateCatalogMarkdown(workspaceRoot, { cloudTarget, generatedAt, sessionId })`：
  - 文件源：`git ls-files` + 显式补充目录；
  - 状态：`SYNCED/INDEXED/LOCAL-NEW/PENDING/LOCAL-ONLY/CLOUD-UNINDEXABLE/FAILED`；
  - 第 1 节：2 层目录树；第 2 节：映射表；第 3 节：二进制/本地-only 清单（可选）；
  - URL：`serverRelativeUrl` 优先；否则 `buildRemoteUrl(siteUrl, targetFolder, relPath)`，处理 `/sites/` 与相对路径；
  - 大小：超过 ~200KB 分片；`Total` 分项统计。
- `refreshCatalog`：debounce；每 turn 最多一次；不要每个文件都调用。
- cache：`attachment-ledger.json`；旧 cache 迁移；single-flight；TTL（例如 24h）或每次 Turn 1 校验。

### 4.5 提示词

**主控/编码智能体的读取段（正向、分层）**

```text
首轮附件 remote-workspace-catalog.md 包含工作区目录树、文件本地路径、云端 WebUrl 与同步/索引状态。
读取时按状态选择：
- 标记 LOCAL-NEW / CLOUD-STALE / LOCAL-ONLY，或本会话刚写过的文件：先用 read_file 读本地；云端结果只作交叉核对。
- 标记 CLOUD-READY 且本会话未改写的文件：可先用云端检索；需要完整代码段/精确行号时再用 read_file。
- catalog 未收录：不代表文件不存在；用 read_file 或列目录确认。
云端检索可能返回片段或旧版本；涉及逐行结论时以本地文件为准。
```

**`write_file` 契约**

```json
{"tool":"write_file","path":"deliverables/report.md","url":"https://.../views/original"}
{"tool":"write_file","path":"src/a.ts","content":"..."}
```

- `content` 与 `url` 二选一；同时出现 → 报错，不写空文件。
- 落盘后系统自动同步文本/代码；回执给本地路径、云端 URL、实际状态；二进制/压缩包按策略处理。
- 不要把 `file_porter` 作为交付路径；它是执行脚本的工具，默认不自动执行。

**FINAL_ANSWER 交付段**

```text
【交付文件与落盘指引 / Deliverables】
- [review.md](https://.../views/original/review.md) -> 目标落盘路径: `deliverables/review.md`
- [package.zip](https://.../views/original/package.zip) -> 目标落盘路径: `deliverables/package.zip`
```

- 路径必须在 `deliverablesRoot` 下；缺路径的项会被跳过并提示。
- 不要用裸冒号分隔；不要把说明文字当路径。
- 终局不期待回执，但用户会看到交付状态。

**条件挂载**

- 只有实际注入了 catalog annotation 才写“已挂载”；上传失败时写“目录附件暂不可用，使用本地 read_file/列目录”，并保留一个**精简**2 层树（不要整段 42KB map）。
- 不要把“保证最新”写进提示词。

### 4.6 根级 `AGENTS.md` 规则 10/11（更正措辞）

**规则 10：企业接地与 IC3 媒体访问不变量**

- 10a：ChatHub 企业接地默认值不被覆盖；首轮 `isStartOfSession: true`；`customAgentId` 存在时启用 Agent 模式；单测断言。
- 10b：IC3 下载必须同账号、owner 可追踪、host allowlist、403 有兜底；单测 + E1。
- 10c：SharePoint 路径段编码统一用 `encodeUrlPathSegments`；单测覆盖空格/`#`/`?`/中文。
- 措辞避免“无法访问任何企业内部数据”这类未验证绝对因果。

**规则 11：Harness-Prompt 能力登记**

- 新增/调整模型可见能力时，必须同时更新：提示词、parser/执行点、测试、`capability-registry.md`。
- CI 检查：提示词中出现的 `tool` 名称必须在 registry 中；registry 中的能力必须有测试。
- 现有 `file_porter` 未在提示词登记，属于反例；本规则落地时要先补登记或退役。

### 4.7 基线还原的可执行步骤（替代原报告 §3 的模糊三步）

1. **保全**：`git switch -c wip/pre-porter-restore`；`git add -A && git commit -m "wip: preserve working tree before restore"`（或 `git stash push -u`）。不要直接在工作树上 `checkout`。
2. **列清单**：`git diff --name-status 30d22da b62a037 > .cph/state/restore-list.txt`。
3. **分类**：
   - `M` 且属于 porter 功能：`git restore --source=30d22da --staged --worktree -- <path>`。
   - `A` 且属于 porter 功能：`git rm --cached <path>` + 删除文件。
   - `D`：从 `30d22da` 恢复。
   - **排除**：`package.json` **整文件保留、不 restore**（该区间只加了 `web`/`web:dev`/`web:build` scripts 与 `adm-zip`/`@types/adm-zip`；前者与 porter 无关且 web 工作树依赖，后者是新 ZIP 功能需要）；`tests/scripts/sp-sync-engine.test.ts`（有未提交改动）；`.gitmodules`/`pi`（子模块删除）；`package/agent-bundle/*`（最后重新打包）。
4. **保留工作树有效改动**：`src/skills/skill-registry.ts`、`src/web/rpc-handler.ts`、`src/session/session-manager.ts`、`src/agent/subagent-runner.ts`、`web/src/*`、`tests/...`（逐项 `git diff` 确认）。
5. **验证**：`git status` 与预期清单逐项对齐；`bun test` 记录基线（当前 952 pass / 1 fail）；不要用“干净”这种不可验证的词。

---

## 5. 错误处理与边界

| 场景 | 行为 | 用户/模型可见性 |
|---|---|---|
| 下载 401/403（owner 不对） | 用 owner token 重试一次；仍失败 → 尝试 CDP（若可用）→ 仍失败则 `failed`，不落空文件 | 回执/交付报告写明“生成账号不可用，需重新生成链接”；不要静默换当前账号 |
| 下载 404（URL 截断错/过期） | 用原始 URL 再试一次；记录两个 URL 的 status；仍失败 → `failed` | 写明“链接可能过期或需要保留文件名”；不要无限重试 |
| 下载超时/超限 | abort；删除 `.part`；不覆盖旧文件 | `failed` + 原因；可重试 |
| 同步超时 | abort 子进程；本地文件保留；入 pending | 回执只写“本地已落盘，云端待同步”；下轮 drain |
| 同步 403/429 | 指数退避 3 次；仍失败入 pending；429 交给账号池 | 不阻断主流程；不写“已同步” |
| 二进制/zip | 默认不同步；按策略 Graph 上传或 LOCAL-ONLY | 明确“不参与索引同步” |
| 目标已存在且 hash 不同 | 默认不覆盖；加后缀或失败 | 提示冲突；需要用户确认 `overwrite` |
| 目标命中关键文件 | 拒绝；重定向或失败 | 明确“受保护文件，不允许覆盖” |
| ZIP 超限/穿越 | 拒绝整个 ZIP，不部分解压 | `failed` + 原因 |
| catalog 上传失败 | 保留内联精简树 + 一行降级提示 | 不写“已挂载” |
| successor/429 | 替换旧账号 annotation；失败则降级本地 | 模型看到“附件已切换/不可用”提示 |
| FINAL_ANSWER 部分失败 | `completed: true` + `deliveryStatus: partial` | UI/CLI 显示 N/M/K；写 delivery-report.json |

---

## 6. 测试与验收

### 6.1 单元/集成（必须）

| 文件 | 覆盖 |
|---|---|
| `tests/auth/ic3-token.test.ts` | `IC3_SCOPE`；refresh_token 交换；缓存/提前刷新；错误分类；不泄漏 token |
| `tests/transport/file-porter.test.ts` | `normalizeAsyncGwUrl`（带/不带文件名、query、恶意 host）；allowlist；大小上限；原子写；覆盖策略；关键文件 deny |
| `tests/transport/file-porter-extract.test.ts` | `.zip` 保存 vs 解压；前缀剥离；`../`/绝对路径/symlink/ADS；条目/大小上限；不覆盖 |
| `tests/protocol/deliverables-parser.test.ts` | 严格语法；裸冒号；缺路径；中/英文文件名；`.zip` 判定；`../`；重复 URL |
| `tests/protocol/parser-precedence.test.ts` | `FINAL_ANSWER` 有/无标记；英文 `.md` 不产生 `file_porter`；`.py` 不执行 |
| `tests/agent/catalog-attachment.test.ts` | 目录树存在；LOCAL-ONLY/二进制行；`Total` 分项；`/sites/` 与相对 targetFolder 的 URL；per-email cache；successor 换号替换 |
| `tests/agent/orchestrator-porter-sync.test.ts` | 中间轮次 `write_file(url)`；回执状态；批量 sync；pending 队列；FINAL_ANSWER 顺序；部分失败 |
| `tests/agent/subagent-attachments.test.ts` | slice/target + catalog 追加去重；同账号 token；并发 single-flight |
| `tests/workspace/catalog-freshness.test.ts` | 60s vs 300s；sessionWritten；CLOUD-STALE；不在 catalog 的文件 |
| `tests/protocol/prompt-contract.test.ts` | 条件挂载提示；无“保证最新”；`url` 在 action schema；`file_porter` 默认不执行 |
| `tests/security/ssrf.test.ts` | localhost/169.254/`file:`/重定向到内网；必须拒绝 |

### 6.2 真实链接（可选、手动）

- 使用手动 smoke 时新生成的两个链接；先 `deliverables/` 落盘；断言 md 24,006 bytes 与 zip 的 SHA-256；zip 不在盘上时跳过并记录。
- `CPH_LIVE_ASYNCGW=1` 才跑；CI 不跑；不承诺 100%。
- 失败时保存 raw response headers/status 到 `.cph/state/asyncgw-smoke.jsonl`。

### 6.3 全量回归与打包

```bash
bun test tests/            # 记录基线：952 pass / 1 fail（ACL）
bun run package            # 重新生成 package/agent-bundle/*
```

验收标准改为：

- 相对基线**无新增失败**；
- 新增测试全部通过；
- ACL 测试标注 Windows 环境条件（或 quarantine），不让它阻塞功能验收；
- 提示词分包与源码提示词一致（`package-agent-bundle.test.ts`）。

---

## 7. 原报告 → 本版变更清单

| 原报告 | 本版 | 原因 |
|---|---|---|
| “物理定律基线” | “单次观测 + 待验证假设” | 通道/样本/污染/反例 |
| “冷创建最短 240s” | “(180s, 240s] 单次区间；需 E0” | 数据只支持区间 |
| “热覆写 0s” | “Web UI 单次假设；ChatHub 未验证” | 既有更正版 spec + 通道混淆 |
| “同账号 200，其他账号 403” | “待 E1 矩阵复现” | 探针 early return，不测 IC3 |
| “云端优先、本地兜底” | “按新鲜度三层；本会话写过的 local-first” | 60s vs 240s；旧版本风险 |
| “catalog 含目录树 + 全量文件” | “从文件系统生成；树 + 状态列 + LOCAL-ONLY/二进制” | 当前生成物无树、80/83 |
| “所有落盘文件同步 SharePoint” | “文本/代码同步；二进制按策略；回执按 status” | `.zip` 被过滤 |
| “15s 超时保护” | “AbortController + kill + pending 队列” | race 不杀子进程 |
| “写后同步队列” | “明确新建 JSONL 队列/重试/drain” | 既有代码没有队列 |
| “subagent 自动挂载” | “追加去重 + 同账号 + single-flight” | 现有 runner 覆盖 annotations |
| “successor nextAccountEmail” | “同 Orchestrator + 租约 email + 替换 ledger” | 没有 nextAccountEmail 参数 |
| “100% 测试绿灯” | “相对基线无新增失败” | 当前 952/1 fail |
| “精准恢复 30d22da” | “WIP 保全 + 逐文件分类 + 排除无关改动” | 工作树冲突/package.json/web scripts |
| “真实链接 100% 完整” | “本地 fixtures + 可选 smoke + SHA-256” | 链接过期、zip 缺失 |
| “四要素硬性契约” | “10a/10b 可测试不变量” | 两项已是默认；无 ablation |
| “`test/` 安全 fallback” | “读工作区策略 + deliverablesRoot” | 仅 E:\test 适用 |
| “zip 目标以 .zip 结尾原样保存” | “保存 zip；目录目标才解压” | 当前实现相反 |
| “裸冒号兼容” | “仅路径形 tail 接受” | 会把说明文字当路径 |
| “FINAL_ANSWER 无回执” | “用户可见 deliveryStatus；失败不静默” | 静默失败不可接受 |
| “`file_porter` 未提及” | “默认不自动执行；登记或退役” | 现有 RCE 面 |

---

## 8. 仍需用户确认的决策

1. **交付根目录**：`deliverables/`（推荐，跨工作区一致）还是读取每个工作区的 `AGENTS.md`（`E:\test` 会得到 `test/`）？
2. **云端读取范围**：只对 `CLOUD-READY` 且本会话未改写的文件 cloud-first（推荐），还是所有文件都先试云端？
3. **`file_porter` 自动执行**：保留（有 RCE 面，需用户确认）还是默认关闭（推荐）？
4. **二进制/压缩包上云**：走独立 Graph 上传（推荐，证据包可分享）还是明确 `LOCAL-ONLY`（实现简单）？
5. **catalog 规模**：单文件上限 200KB/2000 行，超出分片；是否接受多附件？
6. **基线还原**：用 WIP 分支 + 逐文件 restore（推荐），还是 `git reset --hard 30d22da`（会丢工作树，需先备份）？

---

## 9. 结论

原报告的**交互方向**（无头落盘、极简回执、catalog 附件、FINAL_ANSWER 交付段）值得保留；但**证据强度**和**实现边界**需要按本版降级与补齐。最重要的三条：

1. **不要把单次 happy path 写成物理定律**；先跑 E0/E1/E2，再决定读取策略。
2. **账号归属是数据正确性问题**，不是“兜底细节”；owner tracking 必须进设计。
3. **附件/目录/同步三者是一个账本**；只修 catalog 会留下 snapshot/slice 的跨账号坑。

按本版的 P0 修正后再进入实施，避免“回执说成功、模型读旧版、证据包没上云、交付段被当工具调用”这四类返工。
