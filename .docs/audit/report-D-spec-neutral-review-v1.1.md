# 复评报告：全工作区快照增压 / 分块直传 / PnP 镜像架构规范 v1.1.0

- **复评对象**: [`2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)（v1.1.0，537 行）
- **上轮报告**: [`report-C-spec-neutral-review.md`](./report-C-spec-neutral-review.md)（v1.0.0，362 行）
- **复评日期**: 2026-10-19
- **复评立场**: 与上轮一致，绝对中立。只核对「文档断言」与「仓库事实 / 证据文件 / 外部规范」是否一致，单列理想化假设与偏向性表述。
- **复评方法**:
  1. 逐项复核上轮 20 项问题的闭环状态；
  2. 解析新增的 4 份证据文件，核对文档数字是否被证据支持；
  3. 按文档伪代码在本地仓库实测快照体积、文件构成与路径行为；
  4. 核对 `CHANGE-REQUEST.md`、废稿标注与 Git 提交事实。
- **只读声明**: 未修改生产代码，未执行任何上传或云端调用。**本报告不复制任何令牌值**，仅记录其存在性与数量特征。

---

## 0. 复评结论

v1.1 是一次实质改进：上轮 20 项问题中 **7 项已闭环、9 项部分闭环、3 项仍未处理**，证据库从"不存在"变为"可核对"，且我复核的核心抓包数字全部属实。

但本轮同时发现：

- **1 项致命安全问题**：入库的抓包证据包含 3 个真实 JWT；
- **2 项高危实现缺陷**：持续限流触发无限重试；Phase 1 依赖一个不在版本控制内的模块；
- **1 项中高危事实偏差**：快照实测 3.15 MB / 207 文件（自报约 2 MB），且遗漏全部 Tri-Agent `.txt` 提示词。

**判定：仍不建议按"批准待实施"进入实施；应先关闭 §5 的 P0 项。**

---

## 1. 上轮问题闭环状态

| 编号 | 上轮问题 | 状态 | 本轮复核依据 |
|---|---|---|---|
| F1 | 4MB 被说成服务端物理边界 | 部分 | 已正确写明 Graph 服务端 250 MB；但 L27 的"客户端代码硬编码 4MB""必定切入"仍无证据（见 §3） |
| F2 | `pwsh` 与 PnP 1.12 / PS5.1 矛盾 | 已闭环 | L276-L282 增加版本硬断言；调用改为 `powershell.exe` |
| F3 | 代码未实现断点续传 | 部分 | 已实现 `nextExpectedRanges` 驱动、429/503 退避、空值防护；但新增无限重试缺陷（N3） |
| F4 | unfurl 无实现 / 无验证 | 部分 | 抓包证实 `POST unfurl → 200`；Phase 0 已改为隔离验证；但 L41 / L75 仍把"5~10 秒专有切片优先级"当作既成事实 |
| F5 | "全链路零 CDP" | 已闭环 | 明确限定为 scoped fallback，承认 `file-porter` 的 blob 分支 |
| F6 | SIGKILL / 30s | 基本闭环 | 改为 `baseline × 3 = 90s` + `taskkill /F /T`；但 baseline 的测量与存储方式未定义 |
| F7 | 实测证据文件缺失 | 已闭环 | 4 份证据已入库并提交（`550c23e`）——但引入 N1 |
| F8 | "WinINet 注册表 Cookie" | 已闭环 | 改为"WinINet Cookie 存储文件" |
| F9 | "无限容量" | 已闭环 | 改为"企业级 TB 容量" |
| F10 | 增量镜像 / `SaveBinaryDirect` | 部分 | 已改称单向推送并给出 1~3s；但"文件清单比对"的清单仍无定义，无删除/重命名传播，L493 仍写"绝对一致" |
| F11 | "毫秒级" | 部分 | 多数已改秒级；L25、L410 仍写"毫秒级" |
| F12 | 依赖链风险 | 部分 | 已加 ACL / 脱敏；仍未提 PnP 1.12 已停止维护，且 `PnPSession.psm1` 不在版本控制内（N2） |
| F13 | 治理状态不符 | 基本闭环 | `CR-2026-10-19-01` 已登记；但"批准待实施"与未关闭的 P0 冲突 |
| I1 | n=1 写成 100% | 已闭环 | L37 明确 n=1，并计划 n≥5 重复试验与负样本 |
| I2 | 4MB → 100MB 外推 | 部分 | 快照改 git-aware；但实测体积不符（N4），实验干草堆为合成模板（N8），100MB 仍未验证 |
| I3 | Turn 1 产出完整 plan | 部分 | L460 改为"初始 plan + 动态演进"；缺版本化与依赖重算机制 |
| I4 | 300 行做热核审查 | 部分 | 移除硬性行数并增加接口闭包；跨文件盲区未解决，闭包实现未定义 |
| I5 | 指纹头代表真实状态 | 未处理 | 仍用 `Commit 9c42b1`，无 dirty 标记、无内容哈希 |
| I6 | 满额并发 | 未处理 | 仍无单账号并发、共享工作区写冲突、镜像单写者约束 |
| I7 | 绿灯=正确 / 绝对一致 | 未处理 | 红灯期间云端必然滞后，与"绝对一致"矛盾 |

偏向性方面：B1（只呈现有利证据）与 B2（因果跳跃）有改善——n=1 已如实标注、抓包已入库；B4（威胁模型）因新增 ACL / 脱敏有所改善；B3（注意力双标）、B5（硬编码模型名与魔法常量）、B6（选择性命名）基本未动。

---

## 2. 新增问题

### N1（致命）证据库提交了真实 Bearer Token

`upload-network-trace.json` 已提交到 Git（`550c23e`），其中：

- 46 条记录（23 request + 23 response）；
- **17 条请求携带 `Authorization`，共 3 个唯一 JWT**；
- JWT 可正常解码，含 `exp`、`aud=https://graph.microsoft.com`、`oid`；长度 2481–3063 字符，是真实访问令牌而非占位符；
- 文件还包含个人 OneDrive 站点路径（`.../personal/<upn>/...`）与 drive / item ID。

这直接违反文档自己在 L504 写下的"预授权 URL 脱敏"原则。**更严重的是它与 N4 形成闭环**：快照白名单包含 `.json`，`.docs/evidence/` 未被排除，因此每轮首轮快照都会把这个 token 文件打进附件上传到 Copilot / SharePoint。

处置建议（P0）：

1. 从 Git 历史中彻底移除该文件（`git filter-repo` / BFG），而非仅删除工作区文件；
2. 轮换相关令牌，即使已过期也按泄露处理；
3. 重新生成脱敏夹具：删除 `Authorization`、抹掉主机 / 站点 / 条目 ID，仅保留 URL 形态、`Content-Range`、状态码、时间戳；
4. 增加 pre-commit 密钥扫描（Bearer / JWT / `sig=` / Cookie）。

### N2（高）Phase 1 依赖一个不在版本控制内的模块

L283 / L519 要求脚本"引入 `PnPSession.psm1`"，但全仓只有一份：

```text
E:\copilot-web proxy\Library\LTK\PnPSession.psm1
```

而根 [`.gitignore`](../../../.gitignore) 排除了 `Library/`。**新克隆的仓库无法运行 Phase 1**；同时 PnP 1.12.0 已是停止维护的钉死版本。

需要：把模块 vendor 进 `CPH-PI/scripts/lib/`（附来源与哈希），或将其声明为受控依赖；并补一个 PnP 1.x 退出计划。

### N3（高）持续限流会触发无限重试

L189-L220 的结构是：

```text
外层 while (nextRanges.length > 0 && !driveItemData)
  内层 while (!success && attempts < 5)
```

当 5 次尝试全部为 429 / 503 时，内层以 `success = false` 退出，**既不 throw 也不 break**；外层重新进入后 `attempts` 归零、`nextRanges` 未变，形成**永久循环**。另外：

- `Retry-After` 若为 HTTP-date（`Wed, 21 Oct ...`），`parseInt` 得 `NaN` → `setTimeout(NaN)` 立即重试；
- 调用方 `signal.abort()` 触发的 `AbortError` 会进入 `catch` 并被重试 5 次，取消被延迟约 20 秒。

### N4（中高）快照组成与自报数字不符，且遗漏关键文件

按文档算法（`git ls-files --cached --others --exclude-standard` + 扩展名白名单）实测本仓库：

| 指标 | 文档自报 | 实测 |
|---|---|---|
| 体积 | 约 2 MB（L355、L523） | **3.15 MB / 207 文件** |
| 最大单文件 | 未提 | `package/bin/cph-pi.js` **970 KB 构建产物** |
| 目录占比 | 未提 | `package/` 1.05 MB、`.docs/` 0.94 MB、`tests/` 0.61 MB、**`src/` 仅 0.43 MB（13.7%）** |
| Tri-Agent 提示词 | 应属"全景" | **全部被排除**（白名单无 `.txt`）：`cph-main/researcher/coder/dev-agent-prompt.txt`、`docs/PowerShell-Agent-Guide.txt` |

即：git-aware 枚举确实解决了 `pi/` 膨胀，但**丢掉了 v1.0 的目录排除**，导致构建产物与审计文档挤占预算；同时把 Phase 4 要重写的提示词排除在外。此外 `--others` 会把本地未跟踪但未被忽略的文件（如 `scratch.ts`、`notes.md`）一并上传，缺少敏感内容过滤。

### N5（中）`git ls-files` 的三个工程缺口

- **路径转义**：默认 `core.quotepath=true` 会把非 ASCII 路径输出为 `"\344\270\255..."`，`fs.existsSync` 失败后被 `continue` **静默跳过**——"全景"会无声缺文件。本仓库当前无此类路径（已核实 0 条），但作为通用 Harness 必须使用 `-z` + `core.quotepath=false`。
- **`execSync` 默认 `maxBuffer` 1 MB**：大仓库路径列表会触发 `ENOBUFS`；本仓库仅约 9.2 KB，暂无风险。
- **符号链接**：`statSync` 跟随链接，可能读到工作区外的文件；应使用 `lstat` 并对链接单独处理。

### N6（中）"物理指纹"的字节语义不一致

L372 使用 `readFileSync(..., "utf-8")` 读文本，随后对**解码后的字符串**计算 SHA，而 `Bytes` 取自 `stat.size`。对带 UTF-8 BOM 的 `.ps1` / `.psm1`（仓库明确要求 BOM）会多出一个 `\uFEFF`，导致 SHA 与磁盘字节不一致；GBK 编码文件会被静默替换为 U+FFFD。应改为对原始 Buffer 计算 SHA，再单独做 UTF-8 解码。

### N7（中）Phase 1 集成测试不可在 CI 复现

L519 的"集成测试"仍依赖真实租户与真实 cookie，没有 CSOM / PnP 的 mock 或录放层。它只能作为人工验收，不能作为回归门禁。

### N8（低）RAG 复现脚本的"自动化"含水分

`run-rag-boundary-test.ts` 通过 CDP 驱动真实 UI（`DOM.setFileInputFiles`、等待 `.fx-Attachment` 就绪），依赖已登录浏览器、特定 DOM 选择器和模型选择器；结果 JSON 只保存回复与 `includes()` 判分，**不保存 58.5s 延迟、token 用量与附件就绪耗时**。结论本身成立，但"自动化复现"应标注为"半自动实验"。

---

## 3. 新证据的证明边界

### 3.1 `upload-network-trace.json` 能证明

| 断言 | 证据 | 结论 |
|---|---|---|
| 13 个分块，步长 8,192,000 | 13 条 PUT，`Content-Range` 精确递增 | 成立 |
| 12×202 + 1×201 | 响应状态逐条核对 | 成立 |
| 24 秒 / 约 4.2 MB/s | 首末时间戳差 24.42s | 成立 |
| `createUploadSession` 成功 | 响应 200 | 成立 |
| 上传后调用 unfurl | `POST /searchservice/api/v1/unfurl` → 200 | 观测到 |
| 分块携带 `Prefer: ExtractTextOnCommit` | 请求头存在 | 成立，且优于 v1.0 的遗漏 |

### 3.2 不能证明

| 文档断言 | 实际证据边界 |
|---|---|
| "客户端硬编码 4MB 分水岭"、"超 4MB 必定分块" | 抓包中只有 100MB 一次上传，没有任何 `/content` 简易上传请求，没有 3.9MB vs 4.1MB 边界对比。"4MB"是推断，不是观测 |
| "服务端基于 `nextExpectedRanges` 驱动" | 抓包只记录 `status`，没有响应体；该行为来自 Graph 文档，不是这份证据 |
| "5~10 秒完成 Substrate 会话切片" | 抓包无索引耗时；RAG 脚本日志有"附件卡片就绪"耗时，但结果 JSON 未保存，且卡片就绪不等于索引完成 |
| "12 万行代码干草堆" | 生成器是模板化合成代码（`TelemetryEventDispatcher_${idx}` 等）插入 3 个人工模块（15% / 50% / 85%），不是真实仓库；"12 万行"未写入结果文件 |

### 3.3 `rag-boundary-experiment-results.json` 能证明

- n=1，模型确实推演出完整链路与异常码；Phase 1 提示词只给入口符号（`PaymentGatewayService.settleInvoice` + `ENTERPRISE_CUSTOM_TIER_99`），未给下游符号与异常码 → **多跳检索能力的存在性成立**；
- 但这是**合成、低语义噪声**的干草堆，且三个模块都带真实 `import` 语句。它与"真实 12 万行工程"的检索难度不可等同，外推到"极高架构理解可行性"仍偏乐观。

---

## 4. 仍未关闭的旧问题（P1）

1. **指纹头不是状态真值**（I5）：建议改为 `snapshotHash + 逐文件 manifest 变更列表 + dirty 标记`，而不是 commit 号。
2. **"绝对一致"与异步 / 红灯门禁矛盾**（I7）：改为"最终一致的只读归档"，并给出最大滞后时间承诺。
3. **满额并发缺约束**（I6）：至少定义单写者队列、账号并发上限、工作区写锁。
4. **增量同步缺清单**（F10 残留）：明确清单位置、比较键（本地 SHA vs 服务端 ETag）、删除 / 重命名传播。
5. **闭包补全未定义**（I4 残留）：TS import 图解析（tsconfig paths、barrel re-export、type-only、动态 import）不是正则能可靠完成的；10–30KB 上限在依赖图较大时会溢出，需要降级策略。
6. **魔法常量**（B5）：模型名、4MB、90s 应外置为可配置项，并记录其测量来源。

---

## 5. 修订优先级

### P0（阻塞实施）

1. 清除并轮换 `upload-network-trace.json` 中的真实 JWT；重做为脱敏夹具；快照增加敏感路径排除。
2. 修复 429 / 503 无限重试；对 `AbortError` 立即上抛；正确处理 HTTP-date 形式的 `Retry-After`。
3. Vendor `PnPSession.psm1`（或声明受控依赖），否则 Phase 1 在新 clone 上不可运行。
4. 修正快照白名单：排除 `package/`、`.docs/` 等生成 / 审计内容；纳入 `.txt` 提示词；补 `-z`、`maxBuffer`、`lstat`；SHA 改为原始字节。
5. 重测并更新"约 2MB"为实测值；Phase 2 验收改为"src 占比 ≥ X%、构建产物 0 个、提示词全部在内"。
6. 4MB 阈值补一次真实边界实验；否则把 L27 的"硬编码 / 必定"改为"观测到 100MB 走分块，阈值待测"。

### P1

- 指纹头改为内容哈希 + 变更清单 + dirty；
- 增量清单、删除 / 重命名、单写者队列；
- RAG 结果保存延迟 / token，并补 n≥5 与负样本；
- Phase 1 增加 mock / 录放测试；
- 补 DLP、数据分级与 PnP 退出计划。

### P2

- 保持同日草稿的废止标注（已完成）；
- 把"批准待实施"改为"待 P0 关闭后批准"；
- 常量外置与测量来源登记。

---

## 6. 应肯定的部分

- 证据从"不可审计"变为"可审计"，我核对的核心数字（13 块、202/201、24 秒、unfurl）全部属实；
- `Prefer: ExtractTextOnCommit` 在分块请求中确实保留，比 v1.0 严谨；
- PS5.1 硬断言、`taskkill /F /T`、ACL / 脱敏、n=1 如实标注、"初始 plan + 动态演进"、移除 300 行硬限制——都是对审计意见的实质响应；
- git-aware 枚举方向正确，确实规避了 `pi/` 的 16.6MB 膨胀；
- 同日 3 份草稿已标注废止，`CR-2026-10-19-01` 已登记。

---

## 7. 附录

### A. 安全复现命令（不打印令牌值）

```powershell
$p = 'CPH-PI'
$trace = 'CPH-PI/.docs/evidence/upload-network-trace.json'
$raw = Get-Content $trace -Raw

# 仅做存在性判定，绝不输出凭据内容
"contains Bearer : $([bool]($raw -match 'Bearer '))"
"contains JWT    : $([bool]($raw -match 'eyJ0eXAi'))"

$j = $raw | ConvertFrom-Json
"requests with Authorization: $(@($j | Where-Object { $_.type -eq 'request' -and $_.headers.Authorization }).Count)"
"unique Authorization values: $(@($j | Where-Object { $_.type -eq 'request' -and $_.headers.Authorization } | ForEach-Object { $_.headers.Authorization } | Sort-Object -Unique).Count)"

# 抓包结构与分块范围
$puts = $j | Where-Object { $_.type -eq 'request' -and $_.method -eq 'PUT' }
"PUT chunks: $($puts.Count)"
$puts | ForEach-Object { $_.headers.'Content-Range' }
```

### B. 快照组成复现

```powershell
$p = 'CPH-PI'
$ext = @('.ts','.tsx','.js','.jsx','.cs','.py','.ps1','.psm1','.psd1','.json','.md','.sql','.html','.css','.yaml','.yml','.toml','.sh')
$files = git -C $p ls-files | Where-Object {
  $e = [IO.Path]::GetExtension($_).ToLower()
  ($ext -contains $e) -and ($_ -notmatch 'package-lock\.json$|bun\.lock')
}
$sum = 0
$files | ForEach-Object { $f = Join-Path $p $_; if (Test-Path $f) { $sum += (Get-Item $f).Length } }
"files=$($files.Count) bytes=$sum MB=$([math]::Round($sum/1MB,2))"

# 被白名单遗漏的 .txt
git -C $p ls-files | Where-Object { $_ -match '\.txt$' }
```

### C. 证据索引

| 证据 | 位置 |
|---|---|
| 分块上传抓包（含需脱敏的 Authorization） | [`upload-network-trace.json`](../evidence/upload-network-trace.json) |
| RAG 盲测原始结果 | [`rag-boundary-experiment-results.json`](../evidence/rag-boundary-experiment-results.json) |
| RAG 复现脚本（CDP 驱动 UI） | [`run-rag-boundary-test.ts`](../evidence/run-rag-boundary-test.ts) |
| 合成快照生成器 | [`generate-rag-snapshot.ts`](../evidence/generate-rag-snapshot.ts) |
| 认证模块（唯一副本在 git-ignored 目录） | [`PnPSession.psm1`](../../../Library/LTK/PnPSession.psm1) |
| 变更登记 | [`CHANGE-REQUEST.md`](../CHANGE-REQUEST.md) |

### D. 审阅边界

- 未复算云端真实索引延迟与 RAG 召回率；
- 未对真实租户执行任何上传或删除；
- 未验证 `unfurl` 是否为索引的必要步骤（Phase 0 已将其列为待验证项）；
- 未评估具体模型能力，仅评估"以现有证据推导架构结论"的推理强度；
- 本报告不包含、也不应包含任何令牌明文。
