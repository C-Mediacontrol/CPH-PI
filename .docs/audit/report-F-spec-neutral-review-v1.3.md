# 中立审计报告 F：v1.3.0 规范复评

> **审计对象**: [`.docs/specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md) v1.3.0（668 行）
> **审计日期**: 2026-10-19
> **审计立场**: 绝对中立。只判三件事——事实是否成立、结论是否超出证据、表述是否单向有利。
> **审计方法**: 逐条重跑文档中的"实测"声明；用独立脚本复算快照规模；核对仓库代码、证据件与 Git 对象库；不接受文档自述作为证据。
> **前序报告**: [report-C](./report-C-spec-neutral-review.md) / [report-D](./report-D-spec-neutral-review-v1.1.md) / [report-E](./report-E-spec-neutral-review-v1.2.md)

---

## 0. 判定摘要

| 维度 | 结论 |
|---|---|
| 真实闭环的修复 | **7 项**（含前轮最严重的 4 项） |
| 部分闭环 | **4 项** |
| 新增/残留事实错误 | **6 项**（N20–N25） |
| 过度理想化 | **5 项**（I8–I12） |
| 有失偏颇 | **4 项**（B7–B10） |
| 可直接采信的硬结论 | 快照枚举规则、核心文件门禁、仓库内无令牌、别名零改动适配 3 参调用 |

**一句话结论**：v1.3.0 是本轮迭代中实质进步最大的一版——最严重的"证据件含真实令牌""快照误删自身核心源码""4MB 被当成官方硬限"三项均已真实修复且可独立复现。但它仍把三个未经持久化的控制台观测量写成"实测"数字（含一处字节口径错误），并把一处仍在生效的跨项目 Cookie 复用写成"彻底去租户化"。

---

## 1. 已真实闭环（独立复现通过）

| # | 前轮问题 | v1.3.0 处置 | 我的复现 |
|---|---|---|---|
| N9 | `550c23e` 提交含真实 JWT | 历史重写 | `git cat-file -t 550c23e` → `Not a valid object name`；`git reflog --all` 命中 **0** 次；当前仓库 68 个提交、**无 remote** |
| N10 | 4MB 被当成微软官方硬限 | 改为"经验假说区间"，常量改名 `CLIENT_SPLIT_THRESHOLD_HYPOTHESIS`（L99），并承诺 Phase 0 做 3.9MB/4.1MB 边界实验 | 表述已合规：250MB 明确归给 Graph 文档，4MB 明确归给客户端行为假说（L27–L30） |
| N12 | `uploadSimple` 无重试（429 无限重试风险） | 新增 `MAX_SIMPLE_ATTEMPTS = 5`、`Retry-After` 秒数与 HTTP-Date 双解析、退避、AbortSignal | §3.1 L151–L181 逻辑完整，熔断路径成立 |
| N13 | 4MB 阈值无证据 | 同 N10 | 同上 |
| N17 | 抓包证据含 22 条 Authorization 与真实租户 | 全量占位化 | 文件从 83KB 降至 **36,393 字节**；`eyJ…` 形态命中 **0**；`CMA CGM` 命中 **0**；Authorization 值长度 30（`Bearer <REDACTED>`）；URL 为 `contoso-my.sharepoint.com/personal/user_redacted/...` |
| N18 | 无 CI 可复现路径 | 新增 §4.4 `ISharePointSyncClient` / `MockSharePointSyncClient` | 设计层闭环，代码尚未落地（见 N25） |
| N19 | 快照过滤器误删 `src/session/**`、`src/auth/**`、10 个测试与 vendored 模块 | 改精确正则，并新增 `CRITICAL_CORE_FILES` 硬门禁 | 我用独立脚本按 §5.1 规则重跑：命中 **151 文件**（与文档一致）；`SENSITIVE_FILE_PATTERNS` 命中 **0** 个受控文件；9 项核心文件 **9/9 存在且未被过滤** |

补充确认：`git ls-files --cached --others --exclude-standard` 里的 untracked 项在本仓库**全部**落在 `.docs/` 或被扩展名白名单挡掉，因此当前 151 个文件全部为 git 跟踪文件，"git-aware 真实源码"这一说法今天成立（但该 flag 组合本身允许未跟踪文件入快照，见 I12）。

---

## 2. 新增/残留事实错误

### N20【事实错误·必须改】快照字节数与文档自身代码矛盾

文档三处宣称"151 文件 / 1.26 MB (**1,324,834 字节**)"（L396、L465、L652），并称由 §5.1 代码"实测精准对账"。

我按 §5.1 代码逐字节复算（含 manifest、含每文件 banner、SHA 取 12 位十六进制、UTF-8 编码）：

| 分量 | 字节 |
|---|---|
| 151 个文件原始字节和 | **1,324,834**（= 文档引用值） |
| manifest 段 | 12,689 |
| 源码内容段（含 banner） | 1,353,181 |
| **`workspace-vN.txt` 实际大小** | **1,365,870** |

结论：**1,324,834 是"源文件原始字节和"，不是快照文件大小**。真实快照大 41,036 字节（+3.1%），而 §5.1 的返回值 `bytes: Buffer.byteLength(fullText, "utf-8")` 恰好会给 1,365,870。文档把一个中间量当成了产物量，且与自己的代码语义直接冲突。

不影响功能（1.30 MiB 与 1.26 MiB 都远低于 4MB 假说阈值），但"实测精准对账"的措辞因此不成立。

### N21【事实错误·算术】`baseline * 3，即 90 秒`

L632 写"依据项目基线自适应设定超时（默认 `baseline * 3`，即 90 秒）"。

[`CHANGELOG.md`](../CHANGELOG.md) L185 记录的基线是 **72 个测试文件 / 508 用例 / 20.14s**。20.14 × 3 = **60.4s**，不是 90s。90s 对应的是 baseline ≈ 30s——正是上一轮被否掉的常数。要么基线取错，要么公式与数值二选一。

### N22【事实错误·证据边界】两个"实测"时延数字都没有落盘

- L39 "深度思考 **58.5 秒**"：`rag-boundary-experiment-results.json` 的顶层键只有 `testTime / snapshotSize / model / phases`，全文对 `elapsed|duration|ms|token|usage|58` 的匹配次数均为 **0**。
- L44、L78 "实测约 **20~25s** 附件卡片就绪"：`run-rag-boundary-test.ts` 用 **1 秒轮询**打印 `[Upload] 附件已完全就绪: ... (耗时约 ${i + 1}s)`，这个数字既未写入结果 JSON，也不存在于任何提交的证据件中。

两者都是"单次控制台输出"，被写成"实测"。RAG 结果 JSON 的 `analysis` 字段只有三个布尔命中项，没有时间轴。**把这两个数字补进证据 JSON，或把它们降级为"本轮单次观测，未持久化"**——二者选一即可。

### N23【事实错误·证据边界残留】逐块 `nextExpectedRanges` 仍无观测支撑

L31–L33 陈述"服务端基于 `nextExpectedRanges` 驱动续传，中间分块返回 202、末尾返回 201（或 200）"。

抓包 46 条记录中**只有 3 条响应带 body**：`createUploadSession` 的 200（`nextExpectedRanges:["0-"]`）、`suggestions`、`unfurl`。**13 个分块 PUT 的响应本身没有 body**，因此"逐块由 `nextExpectedRanges` 驱动"只能来自 Graph 文档，不是本次抓包观测。状态码 202/201 有据，驱动机制无据。

这条已连续三轮未闭合；本轮修复成本极低——重抓一次并保留 202 响应体即可。

### N24【事实错误/行为回归】别名"零破坏性平移"只对 3 参调用成立

现网 [`substrate-uploader.ts`](../../src/transport/substrate-uploader.ts) 的真实签名（L128–L133）：

```ts
uploadDocumentToOneDrive(graphAccessToken, content, fileName, customBaseUrl?: string)
```

并有两条实际逻辑：
1. **content/filename 交换启发式**（L136–L143）：当 `content` 看起来像文件名且 `fileName` 含换行或超 255 字符时互换了两个参数——这是对模型参数错序的兜底；
2. **`customBaseUrl`**（L146–L153）覆盖 Graph base URL，并被传给 `resolveSpoBase64(token, customBaseUrl)`（L182）。

v1.3.0 的别名（L121–L127）第 4 参改成了 `signal?: AbortSignal`：

- 两处调用点 `orchestrator.ts:880`、`subagent-runner.ts:489` 都只传 3 参，故**编译不破**——这点文档猜对了；
- 但 **4 参调用方语义被替换**（字符串 → AbortSignal）、**`customBaseUrl` 能力被删除**、**参数错序兜底被静默移除**。文档 L657 的"零破坏性平移"把"当前调用点不改"说成了"行为不变"。

移除兜底本身可能是对的（模型侧已修），但必须写明"刻意移除"，否则下次遇到参数错序会当成新 bug 重新排查。

### N25【事实错误·现状描述】"已彻底去租户化 + ACL 保护"两处不实

L355 称受控模块"**已彻底去租户化**……Cookie 磁盘缓存严格命名空间化至 `~/.cph/pnp-session.json`（**支持仅当前 Windows 用户 ACL 权限**）"。

实测 [`scripts/lib/PnPSession.psm1`](../../scripts/lib/PnPSession.psm1)（14,188 字节，SHA256 `AFC10E6A…5923B3`）：

- `CMA CGM` 命中 **0**（去硬编码 ✔）；
- `~/.cph/pnp-session.json` 存在 ✔；
- 但 L64–L68：

```powershell
$cphCache = Join-Path $env:USERPROFILE '.cph\pnp-session.json'
if (Test-Path $cphCache) { return $cphCache }
$legacyCache = Join-Path $env:USERPROFILE '.ltk-shipschedule-session.json'
if (Test-Path $legacyCache) { return $legacyCache }   # ← 跨项目共享
return $cphCache
```

- 且 `Write-DpsSessionCache`（L82–L93）用**同一个 getter** 取路径，因此首次运行会**读写** LTK 项目的 Cookie 缓存文件——CPH-PI 与 LTK 共用同一份企业会话 Cookie；
- 全模块 `icacls|Set-Acl|Get-Acl|FileSystemAccessRule` 命中 **0**：**ACL 一行都没实现**。

"命名空间化"与"留一条通往共享命名空间的回退路径"是互斥的。建议：回退改为显式 `-AllowLegacyLtkSession` 开关（默认关），ACL 要么写进 Phase 1 交付项，要么把 §4.1/§9 的措辞改成"计划施加 ACL"。

---

## 3. 过度理想化

### I8 `毫秒级` 残留，与同文档的 24 秒实测量级冲突

L536 仍写"由 `SubstrateUploader` **毫秒级直传**为专有附件"。而 L43 自己记录 100MB 耗时 24 秒、L44 记录小快照附件卡片 20~25s。同一文档内出现 10³ 与 10⁴ 两个量级的时延叙事，读者无法判断该信哪个。

### I9 "秒级即时挂载"与 20~25s 的修辞落差

L43 把"实测约 20~25s"包装成"云端**秒级**即时挂载"，并与 SharePoint 的 3~15 分钟对比。对比本身是对的（20s vs 900s），但"秒级"在中文语境里默认 ≤ 数秒；20~25s 已属"十秒级"。数字诚实、形容词不诚实。

### I10 内容级密钥扫描是全局单点否决

§5.1 对每个文件跑 `Bearer\s+eyJ…` 与 PEM 头检测，命中即 `throw`，整批快照失败。当前仓库命中 **0**（我已复算），安全方向正确；但缺少：豁免清单、命中后"脱敏替换并继续"的降级路径、以及"哪个文件被拦"以外的最小可用信息。任何未来的 auth 单测夹具写入 `Bearer eyJ...` 示例，就会让整个增压管线停摆，且错误发生在"生成快照"这一最不该失败的环节。

### I11 4MB 假说虽已诚实，但下游仍按硬阈值设计

§3 的路由是 `buffer.length <= 4MB → simple`。文档已承认 4MB 是假说，然而 §2 架构图（L69）仍无条件写"≤4MB: 单次 PUT"、Phase 0 实验只验"云端切片与 unfurl 触发"，没有定义"若实验发现真实阈值是 2MB 或 8MB，路由常量与验证策略如何回滚"。假说的价值在于可被推翻，文档没有写推翻后的处置。

### I12 CI Mock 只覆盖了一半

§4.4 的 `MockSharePointSyncClient` 解决了"离线可复现"，但 Phase 2/3 的 `snapshot-generator.test.ts`、`dual-layer-lifecycle.test.ts` 仍依赖真实 `git ls-files` 与真实工作区状态。而 §5.1 用 `--others --exclude-standard`，意味着**未跟踪文件会进快照**：本地留一个 `scratch.ts` 就会改变快照内容与指纹。测试因此不能对"文件集合"做精确断言，只能对"某些文件在其中"做断言——§5.1 的"实测精准对账"在 CI 上不可稳定复现。

---

## 4. 有失偏颇

### B7 §9 异常矩阵漏掉本轮最严重的事故类别

矩阵列了 PnP 抖动、Cookie 过期、预授权 URL 脱敏、分块中断、单测挂起、补丁失败——**唯独没有"仓库内证据件泄露凭据"**。而这正是本规范前两轮被真实击穿的唯一类别（22 条 Authorization、真实 JWT、真实租户路径）。矩阵只覆盖运行时凭据卫生，不覆盖仓库卫生，读者会得出"凭据风险已被矩阵穷尽"的错误印象。

### B8 "对抗审计终审闭环版 / Fully Audited & Hardened"

L4 的自我标签。本轮实测仍新增 6 项事实错误（含 1 项与自身代码矛盾的字节口径）。"终审闭环"在语义上应指"审计项全部关闭"，而当前是"审计项全部响应、部分关闭"。

### B9 注释里留有审计对抗痕迹

§5.1 的注释"**坚决不误杀** session/token 源码"、"**仅排除真正的**凭据与私钥"，是对上一轮审计意见的直接回声。信息无害，但这些是"给审计者看的辩解"，不是"给维护者看的规格"。规范文本越少混入对话史，越经得起下一轮阅读。

### B10 文档口径与 AGENTS.md 规则 3 冲突

全文 `严禁` **4** 处、`杜绝` **2** 处。其中 L355 的 `throw` 文案属脚本错误信息，可接受；但 §4.2/§5.1 的叙述性表述与工作区规则 3（建设性正向引导，不用禁止词）口径不一。同一仓库里两套语言纪律，长期会让规则 3 失去约束力。

---

## 5. 证据边界表（本轮更新）

| 文档结论 | 证据支持度 | 依据 |
|---|---|---|
| 100MB 走分块、13×8,192,000、202/201、24.4s、unfurl 200 | **强** | 抓包 46 条、13 条 PUT、`Content-Range` 连续、`Prefer: ExtractTextOnCommit` 在请求头 |
| `uploadUrl` 为 SharePoint 预授权地址 | **强** | `createUploadSession` 200 响应体（已占位化） |
| 逐块由 `nextExpectedRanges` 驱动 | **弱** | 只有会话级 `["0-"]`；分块 202 无 body（N23） |
| 4MB 是客户端切换点 | **假说** | 无 `/content` 对照请求；文档已自行降级为假说（本轮合规） |
| 100MB 吞吐 4.2 MB/s | **可算** | 104,857,600 ÷ 24.42s ≈ 4.2 MB/s |
| RapidGPT 多跳检索能力存在 | **弱-中** | n=1、模型自述"检索到三个实际代码片段"、`analysis` 仅布尔命中；文档已声明将做 n≥5 |
| 推理耗时 58.5s | **无** | 结果 JSON 无时长字段（N22） |
| 附件卡片 20~25s 就绪 | **无（仅控制台）** | 1s 轮询日志未入库（N22） |
| 快照 151 文件 | **强** | 我独立重算 = 151，核心 9 项全在 |
| 快照 1,324,834 字节 | **错** | 该值 = 源文件原始字节和；实际产物 1,365,870（N20） |
| 仓库内无令牌/无租户 | **强** | 抓包 `eyJ…` 0 命中、`CMA CGM` 0 命中、无 remote、`550c23e` 不可解析 |
| 模块已 ACL 保护 | **错** | 无任何 ACL 代码（N25） |

---

## 6. 建议处置优先级

**P0（事实错误，改动即闭环）**
1. 修正快照字节口径：写明 1,324,834 为"源文件原始字节和"，产物为 1,365,870 字节（或直接把 `bytes` 返回值写进文档）。
2. 移除/显式门控 `~/.ltk-shipschedule-session.json` 回退；`Write-DpsSessionCache` 不得写入共享路径。
3. 把 58.5s、20~25s 写入 `rag-boundary-experiment-results.json`，或降级为"单次观测、未持久化"。

**P1（诚实性/行为）**
4. 修 `baseline * 3` 的算术（20.14s → 60.4s）或改基线定义。
5. 删掉 L536 的"毫秒级"。
6. 退避 `setTimeout` 接入 `signal`（现在 Abort 最长会被 `min(Retry-After,60)s` 或 `attempts*2s` 挡住，与"Abort 立即上抛"不符）；`uploadSimple` 只对 429/503/5xx/网络错误重试，4xx 直接失败。
7. 写明 `customBaseUrl` 与参数错序兜底是**刻意移除**，并给出替代（否则"零破坏性平移"不成立）。
8. ACL 要么进 Phase 1 交付清单，要么把 §4.1/§9 改成"计划施加"。

**P2（表述/一致性）**
9. §2 架构图与 §3 常量均标注"假说"，并补一句"实验若推翻 4MB，路由常量与 Phase 0 结论如何回滚"。
10. §9 增补一行"证据件凭据/租户卫生"。
11. 统一"实测"用词：区分"抓包观测""单次控制台观测""文档推导"三档。
12. 收敛 `严禁/杜绝`，与 AGENTS.md 规则 3 对齐。

---

## 7. 复现命令（不打印任何凭据）

```powershell
# 1) 历史与远端
git -C 'E:\copilot-web proxy' cat-file -t 550c23e      # 期望：Not a valid object name
git -C 'E:\copilot-web proxy' reflog --all | Select-String 550c23e   # 期望：0 命中
git -C 'E:\copilot-web proxy' remote -v                # 期望：空

# 2) 证据件卫生（只输出布尔）
$t = Get-Content 'E:\copilot-web proxy\CPH-PI\.docs\evidence\upload-network-trace.json' -Raw
($t -match 'eyJ[A-Za-z0-9_\-]{10,}\.'); $t.Contains('CMA CGM')

# 3) 快照规模（原始字节和 vs 产物大小）
$root = 'E:\copilot-web proxy\CPH-PI'
git -C $root ls-files --cached --others --exclude-standard | Measure-Object

# 4) 模块租户隔离状态
Select-String 'E:\copilot-web proxy\CPH-PI\scripts\lib\PnPSession.psm1' -Pattern 'ltk-shipschedule-session|icacls|Set-Acl'
```

---

## 8. 结语

前三轮最刺眼的问题——真实令牌入库、快照误删自身核心源码、把 4MB 当官方硬限——在 v1.3.0 全部真实关闭，且我每一条都独立复现过。剩下的 6 项事实错误里，5 项是"数字与措辞"层面（口径、算术、未落盘的观测），1 项（跨项目 Cookie 回退）是真实行为隐患。

也就是说：这份规范现在的问题已经不在架构，而在**记账**。它反复用"实测""精准""终审闭环"这类词去抬高结论等级，而实际证据强度参差。把每个数字标注到它的证据档位，这份文档会立刻变得难以反驳——那才是"终审"该有的样子。
