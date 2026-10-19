# 中立审计报告 H：实施计划 v2 复评

> **审计对象**: [`.docs/plans/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-plan.md`](../plans/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-plan.md)（338 行，mtime 23:06:11）
> **审计日期**: 2026-10-19
> **审计立场**: 绝对中立。只判四件事——修复是否真闭环、数字是否成立、任务是否指向真实缺口、代码片段能否直接运行。
> **审计方法**: 对 report-G 的 15 项逐条复核；实跑计划中的 PowerShell ACL 片段（两种顺序）；实测快照规模与产物目录；核对打包脚本对四个提示词的处理；复核 `PnPSession.psm1` 的**当前真实状态**与计划描述的差异。
> **前序报告**: [C](./report-C-spec-neutral-review.md) / [D](./report-D-spec-neutral-review-v1.1.md) / [E](./report-E-spec-neutral-review-v1.2.md) / [F](./report-F-spec-neutral-review-v1.3.md) / [G](./report-G-plan-neutral-review.md)

---

## 0. 判定摘要

| 维度 | 结论 |
|---|---|
| report-G 的 15 项中，**真闭环** | **9 项**（P2、P3、P5、M1、M4、M5、I16、B11–B14 合并计） |
| **部分闭环** | **5 项**（P1、P6、M2、M6、I13、I15） |
| **本轮新发现** | **10 项**（P7–P10、M7–M10、I18–I20、B15–B16） |
| 其中**最高优先级** | **P7**：Phase 1 的核心改造在计划写成之前就已落地，按计划字面执行会造成两处回退 |
| 可直接派工的任务 | Phase 0.1 / 0.2 / 0.3、Phase 2、Phase 4.2 |

**一句话结论**：这一版把 report-G 里所有"记账类"问题都改对了——门禁改成实测基线、快照断言改成区间 + 幂等、边界实验改成真实 CDP 探针、矩阵修掉了 FilePorter 与 prompt-builder、双快照正交分工写清楚了、增量基线也定义了。但它暴露了一个更根本的问题：**计划是在代码已经跑在前面之后写的，却仍按"待实现"叙述**，于是 Phase 1 最重要的一步（PS 模块隔离 + ACL）描述的是一个已经存在、且比计划写法更稳健的实现。

---

## 1. report-G 各项复核

| G 编号 | 原问题 | 本版处置 | 我的复核 |
|---|---|---|---|
| P1 | 门禁 520/2300 低于现状 655/2847 | 改为 ≥655 / ≥2847 / fail==0 | **部分闭环**：数值已换成实测值，但仍是"起点值即门禁"，可被删测试绕过（I19） |
| P2 | 151 / 1.30 MiB 自指断言必红 | 改"核心 9 项硬门禁 + 区间 [151,175] / [1.25,1.60] MiB + 两次幂等" | **闭环**。我验算：Phase 2 执行时实际 157 文件、产物 1.30 MiB，均落在区间内；`.cph/` 在排除表且被 gitignore，两次生成必然同 hash |
| P3 | 边界实验自证 | 改为 CDP 探针 + 新增"离线研究实验豁免"约束 | **闭环**。约束冲突（B14）也随之消解 |
| P4 | Goal 写"突破 4MB 限制" | 改"对 4MB 客户端假说的弹性覆盖" | **闭环**（但新增"无上限传输"过度，见 B15） |
| P5 | 矩阵误列 FilePorter | 已移除 | **闭环** |
| P6 | 矩阵误指 prompt-builder；bundle 不同步 | 矩阵改注 `package-agent-bundle.ts`；Step 4.1.3 增 `bun run package` | **部分闭环**：本地 bundle 会同步，但无"部署到 Copilot Agent 并验证生效"；且第 4 个提示词成孤儿（P10） |
| M1 | 未提既有 snapshot 链路 | 新增 `Architecture Boundary` 双快照正交分工；Phase 3 引 `main-plan-snapshot.ts`；3.1.3 列出 4 个存量测试 | **闭环**，且分工描述准确 |
| M2 | Turn 1 上传静默吞错 | 新增"TUI 黄色告警 + `.cph/state/upload-error.log` + 内联降级"；测试断言不崩溃 | **部分闭环**：告警与日志对，但"内联降级"对 1.3 MiB 物理不可行，且模型不知情（I20） |
| M3 | ACL / 去租户化无任务 | 新增 Step 1.1.1，含 ACL 代码片段 | **已被代码抢跑**，且计划写法比现状更差（P7） |
| M4 | 增量基线未定义 | 新增 `.cph/state/sync-manifest.json` + SHA256 比对 + 测试断言 | **闭环**（云端漂移未覆盖，M10） |
| M5 | outputDir 未指定 | 锁定 `.cph/snapshots/` + 幂等断言 | **闭环**（目录不存在需创建，M7） |
| M6 | "实战对账"名不副实 | Step 5.1.4 增全链路 mock 对账 | **部分闭环**：仍是 mock（M8） |
| I13 | Turn 1 无成本模型 | 新增"未变更哈希复用 webUrl" | **部分闭环**：复用对象不足（P8） |
| I14 | 绝对数字当门禁 | 改区间 | **闭环**（655 例外，I19） |
| I15 | 词面断言 | 改称"DAG 结构契约 + 行为边界" | **部分闭环**：断言形式仍是子串包含（I18） |
| I16 | "完整落入"规范逻辑 | Step 0.2.2 增 4xx 快速失败 + `sleepInterruptible` | **闭环** |
| B11–B14 | 矩阵单向 / 基线过期 / 无视既有能力 / 约束自撞 | 全部已改 | **闭环** |

**净结果**：report-G 的 15 项，9 项真闭环，6 项部分闭环，0 项未动。这是一个诚实且有效的修订。

---

## 2. 本轮新发现

### P7【最高优先级·事实错误】Phase 1 的核心改造已经落地，且计划写法会造成两处回退

计划 Step 1.1.1 要求：
> "彻底移除 `PnPSession.psm1` 中的跨项目遗留回退（清退 `~/.ltk-shipschedule-session.json`），强绑定单一入口 `~/.cph/pnp-session.json`" + 给出 ACL 代码片段。

实测 [`scripts/lib/PnPSession.psm1`](../../scripts/lib/PnPSession.psm1)：**mtime 22:23:55，早于计划 23:06:11**，内容已经是：

```powershell
# L61-65：单一入口，遗留回退已从默认路径移除
function Get-DpsSessionCacheFile {
    param([object]$Config)
    if ($Config -and $Config.SharePoint -and $Config.SharePoint.SessionCacheFile) { return [string]$Config.SharePoint.SessionCacheFile }
    return (Join-Path $env:USERPROFILE '.cph\pnp-session.json')
}

# L67-81：遗留回退改为显式 opt-in
function Read-DpsSessionCache {
    param([string]$CacheFile, [switch]$AllowLegacyFallback)
    ...
}

# L98-103：先建目录，再写文件
$dir = [System.IO.Path]::GetDirectoryName($CacheFile)
if (-not (Test-Path $dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
[System.IO.File]::WriteAllText(...)

# L105-116：ACL 在写完之后施加，且包在 try/catch 里
try {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    ...
    $fileInfo.SetAccessControl($acl)
} catch {
    # 在非 NTFS 文件系统或受限权限环境中平滑保持
}
```

也就是说：**M3 在计划写成之前就已经闭环了，而且实现质量高于计划描述。** 直接后果有三条：

**(a) Step 1.1.1 无法产生 RED。** TDD 步序的第一步"写红灯"是不存在的——功能已在。执行者要么伪造一个红灯，要么跳过这一步，两种都会破坏计划的 TDD 纪律。

**(b) 计划给的 ACL 片段与现有实现有两处实质差异，且都是回退：**

| 项 | 现有实现 | 计划片段 | 后果 |
|---|---|---|---|
| 异常处理 | `try/catch` 平滑降级 | **无** `try/catch` | 在非 NTFS（网络盘 / FAT32 / 受限 ACL 环境）会抛异常，把整个 Cookie 缓存写入打断 |
| 施加时机 | 明确在 `WriteAllText` **之后** | 未声明顺序 | 若放在写之前，我实测**直接抛异常** |

我实跑了计划里那段原样代码，两种顺序的结果：

```
=== CASE A: 目标文件不存在 ===
Exception calling "SetAccessControl" with "1" argument(s): "...acl-probe-....json"
+ $fileInfo.SetAccessControl($acl)

=== CASE B: 目标文件已存在 ===
（无输出，成功）
inheritance_protected: True
  rule: LAPTOP-...\951901 / FullControl / Allow
owner: LAPTOP-...\951901
```

结论：**片段本身逻辑正确（CASE B 的隔离效果属实：继承已断开、仅当前用户 FullControl、owner 保留），但缺两句必要注解——"必须在 WriteAllText 之后施加"与"必须 try/catch"。**

**(c) "彻底移除"会删掉一个更好的东西。** 现有 L70-81 的 `-AllowLegacyFallback` 开关，把遗留回退从"默认生效"降级为"显式请求"，既达成"强绑定单一入口"，又保留了存量用户迁移通道。计划写"彻底移除（清退）"，字面执行会删掉这个开关。当前仓库内该开关**无调用者**，所以删除不影响运行，但它把一个"默认安全 + 可迁移"的设计改回"一刀切"，属于净损失。

**建议**：把 Step 1.1.1 从"实现"改为"验收确认"，内容为——核对 L61-65 单一入口、L70-81 opt-in 开关存在、L105-116 ACL 在写后施加且有 try/catch；补齐模块头注释（L3 仍写 `~/.dps-session.json`，与 L64 的 `.cph\pnp-session.json` 不一致）；若决定删除 `-AllowLegacyFallback`，需在计划中写明"故意移除迁移通道"及理由。

---

### P8【事实错误】"复用 webUrl" 不足以重建附件注解

Phase 3 写"若无变更复用上次缓存 `webUrl`（解决 I13 避免重复 20s 延迟）"。

但附件注解不是 webUrl 一个字段。实测 [`substrate-uploader.ts:182`](../../src/transport/substrate-uploader.ts) 的 `assembleUploadResult` 返回：

```ts
{
  driveItemId, webUrl, driveId, fileName,
  annotation: {
    id: `SPO_${spoBase64}_${data.id}`,   // ← 需要 resolveSpoBase64 的站点三元组
    text: fileName,
    url: data.webUrl,
    messageAnnotationType: "LocalFile",
    messageAnnotationMetadata: { "@type": "File", annotationType: "File", fileName, webUrl, driveId, fileType },
  },
}
```

而 `orchestrator` 实际使用的是 `uploadedAttachment.annotation`（L885 `currentAnnotations = [uploadedAttachment.annotation]`），**不是 webUrl**。要跨会话复用，必须持久化整个 `annotation` 对象（含 `SPO_<base64>_<itemId>` 与 `driveId`），单存 webUrl 无法拼回。

计划同时没有指定这个缓存放哪（`.cph/state/` 下文件名未给出），也没有定义缓存失效条件（driveItem 被删、站点变更、token 换租户）。

另外"检测代码树哈希"这个动作也未定义：是 `git rev-parse HEAD` + dirty 标志，还是快照内容 sha256？两者语义不同（前者漏掉未提交改动，后者要先生成快照）。

---

### P9【事实错误·口径】同一份计划里快照产物有两个名字，且"单调递增"与内容寻址互斥

| 位置 | 命名 |
|---|---|
| L24 Global Constraints | `workspace-v1.txt` |
| L225 Step 2.1.2 | `workspace-snapshot-<sha256>.txt` |
| L247 Architecture Boundary | `workspace-snapshot-<hash>.txt` |
| L253 Phase 3 | `workspace-snapshot-<hash>.txt` |

同一交付件、同一天、同一文档内两个名字。更实质的冲突是 L253 的"Handoff 时**单调递增**生成并投递下一版本快照"：内容寻址（hash）与版本单调递增（v1→v2→v3）是两套语义——hash 命名下没有"版本号"，回退或内容相同时文件名会重复。

规范 §6 的 §Lifecycle 图用的是 `workspace-v1.txt` / `workspace-v2.txt`，说明设计意图是**单调版本**。计划改用 hash 命名却没说明是"废弃版本语义"还是"两者并存（hash 文件名 + vN 别名）"。

---

### P10【事实错误】Phase 4 只改 3 个提示词，但 bundle 会发布第 4 个当"系统提示词"

`CRITICAL_CORE_FILES` 含 **4 个**提示词（`cph-main` / `cph-coder` / `cph-researcher` / `cph-dev`），Step 2.1.1 原文也写"以及 4 个提示词等"。

但 Phase 4 只 Modify 前三个，`cph-dev-agent-prompt.txt` **全文零出现**。

而 [`package-agent-bundle.ts:64-72`](../../scripts/package-agent-bundle.ts) 明确把它作为兼容产物发布：

```ts
// Backward-compatible Instructions-系统提示词.txt
const devPromptPath = path.join(projectRoot, "cph-dev-agent-prompt.txt");
const legacySrc = fs.existsSync(devPromptPath) ? devPromptPath : fallbackMainPromptPath;
if (fs.existsSync(legacySrc)) {
  const content = fs.readFileSync(legacySrc, "utf8");
  fs.writeFileSync(path.join(bundleDir, "Instructions-系统提示词.txt"), content, "utf8");
}
```

`promptMappings`（L28-50）只有 main / coder / researcher 三项，dev **不在**其中——它只出现在这个 legacy 通道。

后果：Phase 4 完成后，bundle 里会有一个**没被 Tri-Agent 重构过的 `Instructions-系统提示词.txt`**，而它恰恰是"系统提示词"这个名字。计划的 Step 4.1.3 断言"四个提示词与 skills 完整打包"——它确实会打得进去，但打进的是旧的。

三选一必须明确：①Phase 4 一并重构 dev；②废弃 dev 并把 legacy 通道指向 main；③保留 dev 但在计划中注明"legacy 通道沿用旧内容，不参与 Tri-Agent"。当前计划是默认沉默，执行者会踩空。

---

### M7【缺失】`.cph/snapshots/` 目录不存在，Step 2.1.2 未要求创建

实测 `Test-Path 'E:\copilot-web proxy\CPH-PI\.cph\snapshots'` → **False**（`.cph/` 下现有 artifacts / evidence / handoffs / logs / probe-files / probe-reports / reports / sessions / state / test-handoffs，**没有 snapshots**）。

Step 2.1.2 只写"输出目录强制锁定为 `path.join(workspaceRoot, '.cph', 'snapshots')`"，没有 `mkdirSync(recursive)`。`fs.writeFileSync` 到不存在的目录会抛 `ENOENT`。补一句即可，但不补就是第一次运行即失败。

---

### M8【缺失】"实战对账"仍无真实端到端

Phase 5 标题仍是"全量回归、构建打包与**实战对账**"，但：

- Step 5.1.4 是"离线 Mock 模拟集成对账"；
- Phase 0.3 虽然改成真实 CDP，验的是 **3.9MB / 4.1MB 附件卡片是否就绪**，不是 **1.30 MiB 快照能否被模型理解**；
- 全计划没有任何一步验证"模型确实收到了 151 个文件的上下文"（这正是规范 §1.2 那条 n=1 证据的薄弱处）。

最需要真实验证的一条（"模型是否真的看到全景"），仍是唯一没有验证步骤的一条。

---

### M9【缺失】ACL 只断言"调用"，不断言"生效"；且该断言在非 Windows CI 会挂

Step 1.1.3 写"断言 Windows ACL 权限加固调用与禁用跨项目 `.ltk-*` 遗留回退"。

- "断言调用"——mock 层面的调用计数，无法证明权限真的收紧了。可验证的断言是写完后 `Get-Acl` 读回 `AreAccessRulesProtected -eq $true` 且 `Access.Count -eq 1`（我已在本机实测该组合成立）。
- 平台问题——`FileSystemAccessRule` / `SetAccessControl` 在 Linux/macOS 上不存在。若 CI 跑 Linux，这条断言必挂；若 CI 跑 Windows，则需明确 workflow。计划未提 CI 平台。

---

### M10【缺失】`sync-manifest.json` 是"本地信任型"增量，无云端漂移检测

Step 1.1.2 定义 `.cph/state/sync-manifest.json` 记 `relativePath -> { sha256, lastSyncedAt }`，推送前比对本地 SHA256，未变则跳过。

这是**单向本地信任**：云端文件被他人删除或改动后，manifest 仍记"已同步"，本地永远跳过 → 镜像与云端静默分叉，而 `dirty-sync.jsonl` 只记失败、不记"云端不一致"。至少需要一条"定期全量校验"或"服务端 eTag 比对"的策略，或明确声明"本地为唯一真源，云端分叉由人工处置"。

---

### I18 "行为契约断言"仍是子串包含

Step 4.1.1 标注"解决 I15，由单纯禁词检查升级为**行为契约断言**"，但四条断言的实际形式是：

> "断言 `cph-main-agent-prompt.txt` **包含**全景快照认知输入契约与 DAG 因果时序屏障"
> "断言 `cph-researcher-agent-prompt.txt` **专注于**……"
> "断言提示词全文**无**破坏性指令"

仍是 `content.includes(...)` 级别的文本检查，只是换了名字。真正的行为断言应当是：给定一份 mock 工单，能从中解析出 `targetFiles` / `stage` 字段并得出合法拓扑序——这需要解析器，而非子串匹配。

这不影响交付，但它把"已升级"写在了没升级的地方，属于自我评价高于事实。

### I19 Phase 5 门禁仍可被"删掉新增测试"绕过

门禁 ≥655 / ≥2847 等于**当前起点值**。Phase 5 执行时仓库应有约 690 用例（新增 4 个测试文件），若届时删掉这 4 个文件，计数回到 655，门禁**照样通过**。

正确做法：Phase 5 执行"当下的实测值"作为门禁（先跑一次、记录、再断言不低于该值），或直接写成 ≥690。

### I20 上传失败后的"内联降级"对 1.3 MiB 物理不可行，且模型不知情

Phase 3 的容错链是：`TUI 黄色告警 → 记 upload-error.log → 激活内联降级兜底`。

前两步成立（TUI 有 `this.c.yellow(...)`，可直接复用）。第三步不成立：1,365,870 字节的全景快照**无法内联进 prompt**——现网 `cloudAttachmentThresholdChars = 12000` / `Lines = 200`（[`orchestrator.ts:197-198`](../../src/agent/orchestrator.ts)），内联路径正是它当初要绕开的东西。

更关键的是：**模型不会被告知自己处于降级态**。整份架构的地基是"模型已看到全景"，一旦上传失败，模型会在完全没有全景的情况下按"我有全景"的前提工作——这正是 M2 想防的"盲跑"，只是从"静默失败"变成了"有告警的静默失败"。降级必须同时写入 Turn 1 prompt 的一句显式声明（例如"本轮未挂载全景快照，请先自行探查"），否则告警只对人不 log 对模型。

---

### B15 Goal "无上限传输"过度

新 Goal 写"实现对 4MB 客户端假说的弹性覆盖与**无上限传输**"。4MB 已正确降级为假说，但"无上限"换成 Graph 侧的硬事实就不成立：`createUploadSession` 的文档上限是 **250 GB**，且单块 ≤60 MiB、总块数、超时都有限。改成"分块续传支撑至 Graph 上限（250 GB）"即可，成本为零。

### B16 未声明 vendored 模块已偏离 Library 源

`scripts/lib/PnPSession.psm1` 现已与 `Library/LTK/PnPSession.psm1` **不同**：

| 路径 | SHA256 |
|---|---|
| `CPH-PI/scripts/lib/PnPSession.psm1` | `63A6B5C05FFD72E9100E61F328E77629D67140E5506241233485199B42576049` |
| `Library/LTK/PnPSession.psm1` | `F51DAB44FB3978668A3021EAB3DE9A5B44EAC6B5EA713A631A6EE5BB65C4BE93` |

规范 §4.1 称其为"受控 Vendored 副本"，但计划既没记录"本副本已本地化改造（去租户化 + ACL + opt-in 回退）"，也没规定再 vendoring 时的合并策略。下次有人从 Library 重新拷一份，这三处修复会全部丢失且无台账可查。建议在模块头加 `# LOCAL DIVERGENCE: ...` 段落，并在 Phase 1 增加一条"记录差异清单"。

---

## 3. 处置优先级

**P0（不改则 Phase 1/3 会走偏）**
1. **重写 Step 1.1.1**：从"实现"改为"验收确认"，并补三句——ACL 必须在 `WriteAllText` 之后施加、必须 `try/catch` 平滑降级、`-AllowLegacyFallback` 保留还是删除需明确理由（P7）。
2. **明确附件复用对象**：持久化完整 `annotation`（含 `SPO_<base64>_<itemId>`、`driveId`）到具名文件（如 `.cph/state/snapshot-annotation-cache.json`），并定义失效条件；同时定义"代码树哈希"的取值方式（P8）。
3. **统一快照产物命名**：在 `workspace-snapshot-<hash>.txt` 与 `workspace-vN.txt` 之间二选一，或明确"hash 为文件名、vN 为会话内版本别名"，并删掉 L24 的 `workspace-v1.txt`（P9）。
4. **Phase 4 处理第 4 个提示词**：一并重构 `cph-dev` / 废弃并重指 legacy 通道 / 明确标注"保留旧内容"。当前 Step 4.1.3 的"四个提示词完整打包"断言会掩盖这个问题（P10）。
5. **Step 2.1.2 补 `fs.mkdirSync(outputDir, { recursive: true })`**（M7）。

**P1**
6. **I20 降级改为"对模型可见"**：上传失败时把"本轮无全景快照"写进 Turn 1 prompt，而不是只打 TUI 告警。
7. **ACL 断言改为读回生效**（`Get-Acl` → `AreAccessRulesProtected == $true` 且单条规则），并声明 CI 平台（M9）。
8. **Phase 5 门禁改为"执行时实测值"**（先测、再断言不低于），而非写死 655（I19）。
9. **声明 `sync-manifest` 的单向信任语义**，补全量校验周期或明确"人工处置云端分叉"（M10）。
10. **B16**：在模块头记录本地差异清单；Phase 1 增"记录与 Library 源的差异"步骤。

**P2**
11. Goal 把"无上限传输"改为"至 Graph 250 GB 上限"（B15）。
12. Step 4.1.1 的断言要么真做成解析式行为断言，要么改回"文本契约检查"的诚实叫法（I18）。
13. 补模块头注释 `~/.dps-session.json` → `~/.cph/pnp-session.json`（P7 附带）。
14. `scripts/test-upload-boundary.ts` 是一次性实验脚本，`scripts/` 不在排除表内，会进入全景快照；考虑加 `tests/`、`scripts/test-*` 的显式取舍说明（信噪比）。

---

## 4. 复现命令

```powershell
# P7：模块当前状态（mtime 应早于计划 mtime）
$v='E:\copilot-web proxy\CPH-PI\scripts\lib\PnPSession.psm1'
(Get-Item $v).LastWriteTime
Select-String $v -Pattern 'Get-DpsSessionCacheFile|AllowLegacyFallback|SetAccessRuleProtection|catch'
(Get-FileHash $v).Hash; (Get-FileHash 'E:\copilot-web proxy\Library\LTK\PnPSession.psm1').Hash   # 两者已不同

# P7：计划片段在两种顺序下的行为
#   文件不存在时 SetAccessControl 抛异常；已存在时成功并断开继承

# M7：.cph/snapshots 是否存在
Test-Path 'E:\copilot-web proxy\CPH-PI\.cph\snapshots'          # 期望 False

# P8：注解字段
Select-String 'E:\copilot-web proxy\CPH-PI\src\transport\substrate-uploader.ts' -Pattern 'annotation:|SPO_|driveId'

# P10：dev 提示词的打包通道
Get-Content 'E:\copilot-web proxy\CPH-PI\scripts\package-agent-bundle.ts' | Select-Object -Skip 63 -First 10

# I19：当前真实基线
cd 'E:\copilot-web proxy\CPH-PI'; bun test tests/               # 655 pass / 2847 expect / 86 files
```

---

## 5. 结语

从 report-G 到这一版，改动的方向完全正确：所有能被"核一下"的问题都核了，所有能写成区间的地方都写成了区间，矩阵的两处失真也修干净了。这是五轮迭代里第一次出现"计划本身经得起逐条复现"的状态。

剩下的问题里，真正要紧的只有一条，但它很要紧：**Phase 1 描述的那件事，代码已经做完了，而且做得比计划好。** 一份计划如果让执行者去"实现"一个已存在的东西，执行者只会得到两种结果——把好的改坏，或者跳过并留下一条假的勾选。

另外三条（P8 复用对象、P9 命名冲突、P10 孤儿提示词）都是"少写了一句"，补上就闭环，但漏掉都会在集成阶段变成真 bug。

把 P0 五条改完，这份计划就可以直接派工了。
