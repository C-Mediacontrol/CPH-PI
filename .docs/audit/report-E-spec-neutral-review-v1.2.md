# 复评报告：全工作区快照增压 / 分块直传 / PnP 镜像架构规范 v1.2.0

- **复评对象**: [`2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)（v1.2.0，571 行）
- **历史报告**: [`report-C-spec-neutral-review.md`](./report-C-spec-neutral-review.md)（v1.0.0）、[`report-D-spec-neutral-review-v1.1.md`](./report-D-spec-neutral-review-v1.1.md)（v1.1.0）
- **复评日期**: 2026-10-19
- **复评立场**: 绝对中立。只核对「文档断言」与「仓库事实 / 证据文件 / 外部规范」是否一致，单列理想化假设与偏向性表述。
- **复评方法**:
  1. 逐项复核 report-D 的 N1–N8 闭环状态；
  2. 按文档伪代码在本地仓库实测快照文件数、体积与被排除项；
  3. 核对证据文件的脱敏状态、Git 可达性与远端同步状态；
  4. 核对 Vendored 模块的来源、哈希与可移植性。
- **只读声明**: 未修改生产代码，未执行任何上传或云端调用。**本报告不复制任何令牌值**，仅记录存在性、数量与过期时间等结构性事实。

---

## 0. 复评结论

v1.2 继续明显收敛：report-D 的 8 项新增问题中 **4 项已闭环、2 项部分闭环**；`report-C` 遗留的"最终一致"表述、合成干草堆标注、半自动化标注、`git ls-files` 工程细节、哈希字节语义均已修正。

但本轮出现 **1 个高危功能缺陷**（快照过滤器静默丢弃核心源码）和 **1 个高危残留**（含真实 JWT 的旧提交仍留在本地对象库 / Reflog）。

**判定：`Fully Audited & Hardened` 目前不成立，仍不建议按"批准待实施"放行。**

---

## 1. report-D 问题闭环状态

| 编号 | 上轮问题 | 状态 | 本轮复核依据 |
|---|---|---|---|
| N1 | 证据库含真实 JWT | 部分 | HEAD 已脱敏（17 条 Authorization 收敛为 1 个 30 字符的 `Bearer <REDACTED>`，无 JWT 头）；但 `550c23e` 仍在 Reflog / 对象库中且含真实 JWT（见 §3） |
| N2 | Phase 1 依赖未版本化模块 | 已闭环 | `scripts/lib/PnPSession.psm1` 已入库，与 `Library/LTK/` 副本 SHA256 完全一致 |
| N3 | 429 / 503 无限重试 | 已闭环 | `MAX_CHUNK_ATTEMPTS` 熔断、`AbortError` 立即上抛、`Retry-After` 支持 HTTP-Date、上限 60s |
| N4 | 快照组成错误 | 部分 | 已排除 `package/`、`.docs/`，纳入 `.txt`（4 个提示词确已包含）；但新增子串过滤器误删核心源码（N10），自报数字与实测不符（N11） |
| N5 | `git ls-files` 工程缺口 | 已闭环 | 改用 `-z`、`maxBuffer: 10MB`、`lstatSync` 并跳过软链接 |
| N6 | 哈希字节语义不一致 | 已闭环 | 改为对原始 Buffer 计算 SHA，`Bytes` 与哈希同源 |
| N7 | Phase 1 集成测试不可 CI | 未处理 | 仍依赖真实租户与真实 cookie，无 mock / 录放 |
| N8 | RAG 脚本"自动化"含水分 | 已闭环 | 已改称"半自动化" |

旧问题中：I7（"绝对一致"）已改为"最终一致"；I2 已如实写"合成代码干草堆"；I5（指纹头仍用 `Commit 9c42b1`）、I6（并发约束）、F10（增量清单）、F11（两处"毫秒级"）仍未处理。

---

## 2. 本轮新增问题

### N9（高）含真实 JWT 的旧提交仍可恢复

- 当前 HEAD `00301e8` 的 trace 已脱敏：17 条 `Authorization` 收敛为 1 个唯一值，长度 30，含 `REDACTED`，不含 `eyJ0eXAi`。
- 但 `00301e8` 由 **amend** 产生：`550c23e` 仍在 `git reflog`（`HEAD@{1}`）与对象库中，其 blob 仍含 `eyJ0eXAi`。
- 远端 `origin/main` 为 `e578f7b`，**该提交未被推送**；这是唯一的好消息。本地 Reflog 默认保留约 90 天，任何拿到本机仓库或备份的人都可恢复。
- 抽样解码的一个 `exp` 约为 **2026-10-19 19:47 +08:00**，现已过期；3 个令牌是否全部过期、是否轮换，文档未说明。

处置：

```powershell
git reflog expire --expire=now --all
git gc --prune=now
```

确认 3 个令牌均已失效或轮换，并增加 pre-commit 密钥扫描。文档的"已安全脱敏"应改为"HEAD 已脱敏，历史待清理"。

### N10（高）子串过滤器静默丢弃核心源码

L379：

```ts
if (relPath.includes("token") || relPath.includes(".env") || relPath.includes("session")) return false;
```

实测本仓库被误删 **18 个文件 / 103.9 KB / 约 2,570 行**：

| 类别 | 被误删文件 |
|---|---|
| 会话核心 | `src/session/session-manager.ts` |
| 账本 | `src/session/ledger/execution-ledger.ts`、`ledger-entry.ts` |
| 世系 / 快照 | `src/session/lineage-tracker.ts`、`src/session/main-plan-snapshot.ts`、`src/session/index.ts` |
| 鉴权 | `src/auth/token-manager.ts` |
| 测试 | 10 个 `tests/session`、`tests/cli`、`tests/e2e`、`tests/ui` 用例 |
| 受控依赖 | `scripts/lib/PnPSession.psm1`（文件名含 session） |

这正好是 Handoff、物理账本、指纹头、鉴权所依赖的核心子系统。快照"信噪比"提高了，代价是删掉了信号本身；"全景视野"与 Phase 3 的集成目标因此自相矛盾。

正确做法：

1. 使用显式敏感路径模式：`**/*tokens.json`、`.env*`、`secrets/`、`*.pem`、`*.key`、`id_rsa*`；
2. 对保留文本做内容级密钥扫描（`Bearer eyJ`、PEM 私钥头、`sig=`、`Cookie`），命中即失败或脱敏；
3. 在 manifest 中记录被排除项，并对"必须存在的核心文件"做断言。

### N11（中）"1.25 MB / 150 文件"与所交付的过滤器不符

| 状态 | 文件数 | 体积 |
|---|---|---|
| 加上 `token/.env/session` 过滤（文档当前代码） | **133** | **1.16 MB（1,218,014 字节）** |
| 去掉该过滤（即上一版逻辑） | **151** | **1.26 MB** |
| 文档自报（L342 / L386 / L452 / L556） | 150 | 1.25 MB |

即：文档数字对应的是**加过滤器之前**的测量结果，最后一次修改后没有重测。数字本身不大，但"实测精准落入"的表述因此不成立。

### N12（中高）主流程实际走的是未加固的简易上传

快照约 1.16 MB，**低于 4 MB 阈值** → 首轮全景快照始终走 `uploadSimple`。而本轮新增的重试 / 退避 / 断点 / 取消全部只在 `uploadResumable` 中；`uploadSimple` 没有 429 / 503 重试，也没有超时。

结果是：本架构最关键的"首轮投递"仍走最脆弱的一条路径，Phase 0 的测试也只覆盖分块路径。

建议：给 `uploadSimple` 补同等级的重试与退避，并在 Phase 0 同时覆盖两条路径。

### N13（中）4MB 仍是"结论先行、验证后置"

L29 已从"客户端代码硬编码"改为"在 100MB 抓包中观测到文件较大时必定分块"，这更诚实；但紧接的"Harness 遵循相同的 4MB 策略阈值"仍是无依据的断言。Phase 0 已计划 3.9 MB / 4.1 MB 边界实验——**在实验完成前，应把 4MB 标为假设**。

### N14（中）"5~10 秒专有即时切片优先级"仍无证据

L43 / L77 未变。抓包只证明上传 24 秒与 `unfurl` 返回 200；RAG 脚本记录的是"附件卡片就绪"，不是索引完成。应改为"附件卡片就绪约 N 秒（待测），索引延迟待验证"。

### N15（中）没有迁移调用点，新引擎可能是死代码

全仓仍调用 `uploadDocumentToOneDrive`（[`orchestrator.ts`](../../src/agent/orchestrator.ts)、[`subagent-runner.ts`](../../src/agent/subagent-runner.ts)），文档只提供 `uploadDocumentAuto`。Phase 3 未提"替换调用点 / 保留兼容层"。

需要明确迁移步骤，否则 Phase 0 交付后主流程仍走旧单次 PUT。

### N16（中）Vendored 模块把租户路径与旧项目缓存一起带进仓库

`scripts/lib/PnPSession.psm1` 与源文件字节一致，因此也继承了：

- `Join-Path $env:USERPROFILE 'OneDrive - CMA CGM\Documents\WindowsPowerShell\Modules\PnP.PowerShell'`（公司 / 租户专属目录名）
- `~/.ltk-shipschedule-session.json`（另一个项目的 cookie 缓存，跨项目共享）

"受控 Vendored"应去掉组织专属路径，改为 `$env:PSModulePath` + 配置项；缓存应命名空间到 CPH-PI（如 `~/.cph/pnp-session.json`）并做 ACL，避免与其他工具共享 cookie 边界。

### N17（中低）"已安全脱敏"只覆盖令牌

trace 仍保留个人站点主机、`drives/b!...`、`items/01...` 等租户元数据。建议连同主机与 ID 一起替换为稳定占位符。

### N18（中）Phase 1 集成测试仍不可 CI

与 report-D 的 N7 相同：仍要求真实 SharePoint。至少应增加 CSOM / WebRequest 层的录放或 fake。

### N19（低）其他精确性问题

- `EXCLUDED_DIR_PREFIXES` 只匹配顶层前缀，嵌套的 `packages/*/dist` 不会被排除；`scripts/archive` 的 12 个 CDP 探针（40.4 KB）反而被纳入。
- `fileCount: files.length` 统计发生在 `lstat` 过滤之前，可能高于实际写入数。
- §2 写"排除构建与文档"，但只排除了 `.docs/`，根 `docs/`、`README.md` 仍在快照内。
- L25、L410 仍写"毫秒级"。
- CR 状态仍为"批准待实施"，与 N9 / N10 未关闭冲突；版本头 `Fully Audited & Hardened` 同样过度声明。

---

## 3. 证据核对（中立结论）

### 3.1 已确认属实

- HEAD 的 trace 中 17 条 `Authorization` 收敛为 1 个 30 字符的 `Bearer <REDACTED>`，无 JWT 头；
- 分块仍为 13 块 × 8,192,000，12×202 + 1×201，总耗时 24.42 秒；`unfurl` POST 返回 200；分块携带 `Prefer: ExtractTextOnCommit`；
- Vendored `PnPSession.psm1` 与 `Library/LTK/` 副本 SHA256 完全一致（`F51DAB44…4BE93`）；
- 快照确实包含 4 个根级 `cph-*-agent-prompt.txt`。

### 3.2 不能确认

| 文档断言 | 证据边界 |
|---|---|
| 4MB 是客户端阈值 | 只有 100MB 一次观测，没有任何 `/content` 简易上传请求，无 3.9 / 4.1 MB 边界对比 |
| 5~10 秒索引优先级 | 无索引耗时数据；`unfurl` 是卡片服务，不等于索引完成 |
| 3 个令牌全部过期 / 已轮换 | 仅抽样解码 1 个 `exp` |
| 增量同步的"文件清单" | 仍无 ETag / LastModified / 清单定义 |

### 3.3 Git 可达性

| 事实 | 结论 |
|---|---|
| 当前 HEAD | `00301e8`（amend 后的脱敏版本） |
| 旧提交 `550c23e` | 在 Reflog / 对象库中，仍含真实 JWT |
| 远端 `origin/main` | `e578f7b`，未包含该提交 |
| 处置 | 过期 Reflog + GC + 轮换令牌 + pre-commit 扫描 |

---

## 4. 修订优先级

### P0（放行前必须关闭）

1. 清理 Reflog / 对象库中的 `550c23e`，确认 3 个令牌失效或轮换，加 pre-commit 密钥扫描。
2. 用显式敏感路径 + 内容扫描替换 `includes("token"/"session")`，并断言核心文件（`src/session/**`、`src/auth/**`）必在快照内。
3. 给 `uploadSimple` 补重试 / 退避，Phase 0 同时覆盖简易与分块路径。
4. 4MB 改为"待 Phase 0 边界实验确认"；"5~10 秒"改为待测。
5. 重测并修正"1.25 MB / 150 文件"为 1.16 MB / 133 文件（或修好过滤后重测）。
6. 明确 `uploadDocumentAuto` 的调用点迁移方案。

### P1

- Vendored 模块参数化（去 `OneDrive - CMA CGM`，缓存命名空间化 + ACL）；
- 指纹头改为 `snapshotHash + 变更清单 + dirty`；
- 增量清单（本地 SHA vs 服务端 ETag）、删除 / 重命名、单写者队列；
- Phase 1 增加 mock / 录放测试；
- trace 的租户元数据一并脱敏。

### P2

- 前缀排除改为路径段匹配；`fileCount` 按实际写入统计；统一"毫秒级"措辞；
- CR 与版本头状态改为"待 P0 关闭后批准"。

---

## 5. 应肯定的部分

- N2 / N3 / N5 / N6 是干净利落的修复，不是文字游戏；
- 证据脱敏在 HEAD 上确实执行了，且保留了可核对的结构（分块范围、状态码、时间戳）；
- 把"合成代码干草堆""半自动化""最终一致"这些容易夸大的表述改准了，是审计响应的正确姿态；
- 新增 Phase 0 边界实验、Phase 1 受控依赖，说明文档开始把"待验证"写进路线图，而不是只写在结论里。

**一句话结论**：v1.2 把上一轮的"大问题"基本按住了，但过滤器用两个裸词误删了整个 `src/session` 子系统，历史里还留着一个未推送的真实令牌提交。修掉这两项、再补上简易上传的重试，"批准待实施"才站得住。

---

## 6. 附录

### A. 安全复现命令（不打印令牌值）

```powershell
$p = 'CPH-PI'
$trace = 'CPH-PI/.docs/evidence/upload-network-trace.json'
$raw = Get-Content $trace -Raw

"contains Bearer : $([bool]($raw -match 'Bearer '))"
"contains JWT    : $([bool]($raw -match 'eyJ0eXAi'))"

$j = $raw | ConvertFrom-Json
$auth = @($j | Where-Object { $_.type -eq 'request' -and $_.headers.Authorization })
"auth requests: $($auth.Count), unique: $(($auth | ForEach-Object { $_.headers.Authorization } | Sort-Object -Unique).Count)"
"lengths: $(($auth | ForEach-Object { $_.headers.Authorization.Length } | Sort-Object -Unique) -join ', ')"

# 确认旧提交仍在对象库（仅布尔判定）
$old = git -C $p show 550c23e:.docs/evidence/upload-network-trace.json 2>$null
"old commit still contains JWT: $([bool]($old -match 'eyJ0eXAi'))"
```

### B. 快照过滤器复现

```powershell
$p = 'CPH-PI'
$files = git -C $p ls-files --cached --others --exclude-standard
$prefix = @('package/','.docs/','dist/','.cph/','node_modules/')
$ext = @('.ts','.tsx','.js','.jsx','.cs','.py','.ps1','.psm1','.psd1','.json','.md','.sql','.html','.css','.yaml','.yml','.toml','.sh','.txt')

$kept = @(); $dropped = @()
foreach ($f in $files) {
  if ($prefix | Where-Object { $f.StartsWith($_) }) { continue }
  if ($ext -notcontains [IO.Path]::GetExtension($f).ToLower()) { continue }
  if ($f -match 'package-lock\.json$|bun\.lock$|bun\.lockb$') { continue }
  if ($f -match 'token|\.env|session') { $dropped += $f; continue }
  $abs = Join-Path $p $f
  if (-not (Test-Path $abs)) { continue }
  $st = Get-Item $abs -Force
  if ($st.PSIsContainer -or $st.LinkType) { continue }
  $kept += $f
}
$sum = 0; $kept | ForEach-Object { $sum += (Get-Item (Join-Path $p $_)).Length }
"kept=$($kept.Count) bytes=$sum MB=$([math]::Round($sum/1MB,2))"
$dropped
```

### C. 证据索引

| 证据 | 位置 |
|---|---|
| 分块上传抓包（HEAD 已脱敏） | [`upload-network-trace.json`](../evidence/upload-network-trace.json) |
| RAG 盲测原始结果 | [`rag-boundary-experiment-results.json`](../evidence/rag-boundary-experiment-results.json) |
| RAG 半自动复现脚本（CDP 驱动 UI） | [`run-rag-boundary-test.ts`](../evidence/run-rag-boundary-test.ts) |
| 合成快照生成器 | [`generate-rag-snapshot.ts`](../evidence/generate-rag-snapshot.ts) |
| 受控 Vendored 认证模块 | [`scripts/lib/PnPSession.psm1`](../../scripts/lib/PnPSession.psm1) |
| 原始认证模块（git-ignored） | [`Library/LTK/PnPSession.psm1`](../../../Library/LTK/PnPSession.psm1) |
| 变更登记 | [`CHANGE-REQUEST.md`](../CHANGE-REQUEST.md) |

### D. 审阅边界

- 未复算云端真实索引延迟与 RAG 召回率；
- 未对真实租户执行任何上传或删除；
- 未验证 `unfurl` 是否为索引的必要步骤（Phase 0 已列待验证）；
- 未评估具体模型能力，仅评估"以现有证据推导架构结论"的推理强度；
- 本报告不包含、也不应包含任何令牌明文。
