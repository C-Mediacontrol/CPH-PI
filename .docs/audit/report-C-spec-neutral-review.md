# 中立审阅报告：全工作区快照增压 / 分块直传 / PnP 镜像架构规范

- **审阅对象**: [`2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)
- **审阅日期**: 2026-10-19
- **审阅立场**: 绝对中立。不预设方案对错，只核对「文档断言」与「仓库事实 / 外部规范」是否一致，并单列理想化假设与偏向性表述。
- **审阅方法**:
  1. 逐条提取文档中的可证伪断言（文件路径、常量、协议行为、性能数字、机制因果）；
  2. 对照仓库真实代码、Git 索引、实测体积与既有变更日志；
  3. 对照 Microsoft Graph 官方上传规范与 PnP.PowerShell 版本生命周期；
  4. 对无法在工作区复现的"实测证据"单独标记为 **不可审计**，不臆测其真伪。
- **只读声明**: 本次审阅未修改任何生产代码、未执行任何上传或云端调用。

---

## 0. 审阅摘要

| 类别 | 条目数 | 最高等级 | 一句话结论 |
|---|---|---|---|
| 事实性错误 / 内部矛盾 | 13 | 高（3 项） | 至少 3 处按文档字面实现会直接失败或自相矛盾 |
| 过度理想化 | 7 | 高（2 项） | 单次实验被当成可靠率；4MB 结论被外推到 100MB |
| 偏向性表述 | 6 | 中 | 只呈现有利证据；机制因果未经隔离验证；缺威胁模型 |
| 成立且应保留 | 8 | — | 协议细节、PnP 复用、TDD 门禁思路基本正确 |

**总体判定：不建议按"终审已批准待实施"直接进入实施；应先关闭 P0 项（见 §6）。**

三条最关键的结论：

1. **4MB 不是微软 Graph 的物理硬边界**，而是 Copilot 客户端的策略阈值，文档（及其姊妹文档）把客户端策略写成了服务端事实。
2. **`pwsh` + PnP 1.12.0 + PS5.1 的组合自相矛盾**，仓库内的认证模块注释已经记录了"PS7 加载 PnP 3.x 会导致反射方法为 null、认证全挂"。
3. **文档的核心机制"Instant Unfurl 让云端 5~10 秒完成切片"在代码中不存在，也没有入选 Phase 0**；Phase 0 只实现了上传，没有实现让模型真正"看到"内容的最后一环。

---

## 1. 复核基座（可复现事实）

| 复核项 | 物理事实 | 来源 |
|---|---|---|
| 现有上传实现 | 仅单次 `PUT .../content`，无 `createUploadSession`、无分块、无重试 | [`substrate-uploader.ts`](../../src/transport/substrate-uploader.ts) |
| 现有实现携带的请求头 | `Prefer: ExtractTextOnCommit, pacToken=N`、`SdkVersion: graph-js/3.0.7` | 同上 |
| `unfurl` / `searchservice` | 全仓 `src` 无任何命中 | `rg 'unfurl|searchservice' src` |
| 剩余 CDP 依赖 | `file-porter.ts` 保留 `blob:` 下载的 CDP 分支 | [`file-porter.ts`](../../src/transport/file-porter.ts) |
| PnP 认证层级 | Tier1 磁盘缓存 `~/.ltk-shipschedule-session.json`；Tier2 PnP `CookieReader.GetCookie`；Tier3 反射 `GetWebLoginClientContext` | [`PnPSession.psm1`](../../../Library/LTK/PnPSession.psm1) |
| PnP 版本约束 | 模块显式强制加载 1.x，并记录 PS7 加载 3.x 会导致认证失败 | 同上（文件头注释） |
| `SaveBinaryDirect` | 存在于 ship-schedule 上传脚本，语义为整文件写入 | [`ShipScheduleSharePointUpload.ps1`](../../../Library/LTK/ShipScheduleSharePointUpload.ps1) |
| 测试基线 | 72 个测试文件 / 508 用例 / 20.14 秒 | [`CHANGELOG.md`](../CHANGELOG.md) |
| 构建脚本 | `package`、`build:package`、`test` 均存在 | [`package.json`](../../package.json) |
| 文档白名单下的快照体积 | 20.22 MB（2,2xx 文件）；其中 `pi/` 占 16.63 MB / 1,856 文件 | 按文档扩展名白名单实测 |
| Git 索引真实规模 | 父仓库 217 个条目；`pi` 仅为 1 个 gitlink | `git ls-files` |
| 文档引用的两份实测证据 | `upload-network-trace.json`、`rag-boundary-experiment-results.json` **在工作区不存在**（按文件名与实验符号均无命中） | 全盘检索 |

---

## 2. 事实性错误与内部矛盾

### F1（高）4MB 被描述为"物理硬边界"，实为客户端策略

- **文档位置**: [L19-L21](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L19-L21)
- **复核事实**: Microsoft Graph `PUT /items/{id}:/{name}:/content` 简易上传的服务端上限是 **250 MB**；上传会话上限 250 GB，单块上限 60 MiB，块大小须为 320 KiB 整数倍（Graph `driveitem-put-content` / `driveitem-createuploadsession` 文档）。
- **连带问题**: 同日姊妹文档 [`...resumable-upload-design.md`](../specs/2026-10-19-workspace-snapshot-supercharger-and-resumable-upload-design.md) 明确写"根据微软官方规范……硬性限制仅支持 ≤4MB……会报 HTTP 413"，并把"5MB~30MB 快照"作为必然失败场景。这是错误陈述。
- **影响**: >4MB 分支的立论前提不成立。文档未给出"对 simple 端点上传 >4MB 实际失败"的观测，因此 4MB 只能标注为"实测客户端阈值"，不能标注为"服务端边界"。
- **判定**: 事实错误（性质误述）+ 证据缺口。

### F2（高）`pwsh` 与 PnP 1.12.0 / PS5.1 自相矛盾，照写必挂

- **文档位置**: [L186-L187](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L186-L187) 规定 `System32\...\powershell.exe`（5.1）；[L212](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L212) 写"子进程异步触发 `pwsh -File sp-sync-engine.ps1`"。
- **复核事实**: `PnPSession.psm1` 头部注释记录：反射登录方法只存在于 PnP 1.x；PS7 会按模块路径加载 PnP 3.x，`GetMethod` 返回 null，导致认证链路整体失效。模块因此专门探测并强制导入 1.x。
- **影响**: 若子进程使用 `pwsh`，模块会回退到 `Import-Module PnP.PowerShell`（3.x），cookie 认证失败。这是全文最确定的"按文档实现必然失败"点。
- **判定**: 内部矛盾 + 实现级缺陷。

### F3（高）§3 代码未实现 §9 承诺的断点续传

- **文档位置**: [§3 上传循环](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L100) 与 [L329](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L329)
- **复核事实**:
  1. 循环只按本地 `offset = end` 推进，从不读取服务端返回的 `nextExpectedRanges`；
  2. 无 429/503 的 `Retry-After` 退避，无 `AbortSignal` 超时；
  3. 若服务端对收尾块返回 202，循环以 `offset == totalBytes` 退出，随后 `driveItemData.id` 抛 `TypeError`；
  4. 新路径未保留现有实现的 `Prefer: ExtractTextOnCommit` 与 `SdkVersion` 头；
  5. `Content-Length` 属于 Fetch 规范的 forbidden header，不同运行时可能忽略或校验，正确性不应依赖它。
- **判定**: 规范与代码不一致；"断点续传"目前只是标题。

### F4（高）Instant Unfurl 机制无实现、无归属、无验证

- **文档位置**: [L25](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L25)、[L35](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L35)、[L69](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L69)
- **复核事实**: `src` 内不存在 `unfurl` 或 `searchservice`；Phase 0 需求列表也未包含它。
- **概念问题**: `unfurl` 是链接卡片/元数据服务，把它等同于"启动云端 RAG 切片与预热"是未经隔离验证的因果推断。
- **影响**: 文档把"会话级附件卡片 5~10 秒完成切片"当作双层流体系的核心收益，但这一环既无代码，也无实验设计。
- **判定**: 机制缺口 + 因果未证。

### F5（中高）"全链路零 CDP"过度声明

- **文档位置**: [L9](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L9)、[L68](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L68)
- **复核事实**: [`file-porter.ts`](../../src/transport/file-porter.ts) 仍保留 `blob:` 下载的 CDP 分支；令牌获取由 provider/账号池负责，不在上传器内。
- **准确表述**: "上传链路零 CDP；文件搬运保留 blob 兜底"。
- **判定**: 范围夸大。

### F6（中）30 秒 SIGKILL 与 Windows 语义及测试基线冲突

- **文档位置**: [L330](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L330)
- **复核事实**:
  1. Windows 无 Unix `SIGKILL` 语义，运行时映射为 TerminateProcess，通常只终止直接子进程，测试 worker 可能残留；
  2. 当前全量基线为 20.14 秒（72 文件 / 508 用例），30 秒落在正常波动区间，冷启动或机器繁忙时必然误杀；
  3. 误杀在设计上会阻断云端同步，副作用被放大。
- **判定**: 平台语义错误 + 阈值不合理。

### F7（中）"实测证据基座"无法审计

- **文档位置**: [L7-L8](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L7-L8)
- **复核事实**: `upload-network-trace.json` 与 `rag-boundary-experiment-results.json` 在工作区内不存在；按实验符号 `CRITICAL_FAULT_ZERO_TRUST_QUORUM_LOST_0x992B` 检索也无命中。
- **影响**: 100MB/24s 与 4MB/3 跳 100% 这两个核心数字不可复现、不可审计。
- **判定**: 文档完整性缺陷。

### F8（中）"WinINet 注册表 Cookie"描述不准确

- **文档位置**: [L187](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L187)
- **复核事实**: Tier 2 是 PnP 程序集内的 `CookieReader.GetCookie`，读取 WinINet cookie 存储（文件），并非注册表键值。
- **判定**: 技术描述错误（功能路径本身成立）。

### F9（中）"无限容量"与 SharePoint 配额现实不符

- **文档位置**: [L35](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L35)、[L62](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L62)
- **复核事实**: SharePoint 使用租户池化配额，单站点集上限 25 TB；文档库还有版本数量限制。
- **影响**: 里程碑备份叠加每轮单文件覆盖，会持续产生版本膨胀，文档无清理策略。
- **判定**: 事实错误。

### F10（中）"增量镜像"与 `SaveBinaryDirect` 的能力被夸大

- **文档位置**: [L200-L205](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L200-L205)
- **复核事实**: `SaveBinaryDirect` 是整文件写入，不含增量语义。真正的增量需要本地清单 + 服务端 ETag/LastModified 比对；文档未定义清单，也未定义删除/重命名传播。
- **衍生问题**: §4.3 的异步重试与"红灯不同步"意味着云端必然滞后，但 [L319](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L319) 却写"确保交接文档与云端代码事实绝对一致"。
- **准确表述**: 这是"单向、最终一致的推送归档"，不是"镜像"。
- **判定**: 概念误用 + 内部矛盾。

### F11（低但遍布全文）"毫秒级"偏差约三个数量级

- **文档位置**: [L20](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L20)、[L205](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L205)、[L236](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L236)、[L261](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L261)
- **复核事实**: 按文档自报 4.2 MB/s，4MB 约 1 秒；PnP 每次调用要起新进程、导入模块、走认证，是秒级。
- **判定**: 性能描述失真，应统一改为"秒级"。

### F12（中）依赖链风险未纳入故障矩阵

- **复核事实**:
  - `Library/LTK/` 被根 [`.gitignore`](../../../.gitignore) 排除，属于未版本化、机器相关的代码；
  - PnP.PowerShell 1.12.0 是最后一个支持 PS5.1 的版本，已停止维护（1.x 为兼容性钉死版本，2.x 起要求 PS7.2+ 且移除了反射登录方法）；
  - `~/.ltk-shipschedule-session.json` 以明文存储 SharePoint cookie，文档未提 ACL / DPAPI / 轮换。
- **影响**: 供应链、可复现性、凭据安全三类风险均未出现在 [§9 故障矩阵](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L323) 中。
- **判定**: 风险覆盖缺口。

### F13（低）治理状态与仓库事实不符

- **复核事实**: [`CHANGE-REQUEST.md`](../CHANGE-REQUEST.md) 仍为"当前无进行中的变更请求"；同日存在 4 份高度重叠的快照/上传/PnP 文档，且无主从与废止标注。
- **影响**: "终审已批准待实施"缺乏仓库内可追溯的批准记录。
- **判定**: 流程一致性问题。

---

## 3. 过度理想化

### I1（高）n=1 的实验被写成"100%"

单次 4MB 盲测命中只能证明"该能力存在过"。缺少：

- 重复试验与成功率分布；
- 负样本（埋入不存在的符号，观察模型是否编造）；
- 检索精度与误召回统计；
- token 成本与延迟分布。

同时，"思考链日志证实模型自主发起多跳检索"是对 CoT 的解释，而 CoT 不是忠实的执行日志，不能作为机制证据。

### I2（高）4MB → 100MB 的外推没有验证

[L230](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L230) 允许 100MB，是唯一验证规模的 25 倍。检索精度、切片预算、上传可靠性、单轮成本全部未知。

更直接的矛盾：按文档白名单实测本仓库，快照为 **20.22 MB**，其中 `pi/` 占 16.63 MB——第一天就已是验证包络的 5 倍。

### I3（高）"Turn 1 产出完整 plan.md"不现实

[L286](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L286) 要求首轮依据快照产出"包含所有切片与依赖关系的完整计划"。4MB 约百万级 token，实验证明的是"能捞到一根埋好的针"，不是"能在一轮内正确理解 12 万行并产出可执行 DAG"。文档也没有计划修订协议——只有一行 `Next Action`，没有 plan 版本化与依赖重算。

### I4（中）300 行切片做"热核级审查"在结构上不可能

[L292](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L292) 要求 Researcher 在 ≤300 行切片上完成漏洞分析与竞争条件逆向。跨文件缺陷、隐式契约、全局状态竞争恰好落在切片边界之外。这与文档"全局视野是刚需"的立论自相矛盾，且没有做切片 vs 全量审查的质量对照。

### I5（中）"指纹头 = 最新真实事实"站不住

[L270](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L270) 用 5 行指纹头代表最新状态，但指纹头无法表达语义增量（重命名、移动、删除、依赖变化）。只要改动一个非目标文件，模型脑内的 v1 拓扑就已失真，且没有失效/重取机制。

### I6（中）"满额并发"忽略资源竞争

[§7.3](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md#L297) 主张正交满额并发，但未处理：单账号并发上限、共享工作区写冲突、`.cph` 账本并发写、以及 PnP 镜像需要的单写者队列。

### I7（中）"TDD 绿灯 → 同步"假设测试是完备的

绿灯只说明现有断言通过，不等于代码正确。把云状态绑在测试上会产生虚假安全感，并让镜像在红灯期间长期落后于磁盘真实状态；这与"绝对一致"的表述冲突。

---

## 4. 偏向性评估

1. **只呈现有利证据。** 一次 100MB 抓包与一次检索命中被抬升为"物理基座"，没有失败样本、边界样本或反向实验；"五大系统性难题"被逐一宣告"彻底解决"，全文缺少权衡、成本与不适用场景。
2. **因果跳跃被当作机制。** unfurl → RAG 高优先级、首轮快照 → 架构理解、指纹头 → 状态同步，三条均为相关性叙事，没有隔离变量。
3. **注意力的双标。** 姊妹文档用"注意力稀释"论证不许多轮探查，本文却假设 4MB 全景不会稀释注意力；同一批材料中存在两种相反的因果故事。
4. **缺少威胁模型。** 源码外流到租户、明文 cookie、预授权 `uploadUrl` 的日志泄露、DLP/留存策略均未讨论。尤其"遍历真实磁盘 + 解析 `.gitignore`"是安全红线：根 `.gitignore` 专门排除了 `**/*tokens.json` 与 `.env`，快照枚举的正确性直接决定凭据是否会进入附件。
5. **与"Harness 中立"存在张力。** 生命周期图硬编码具体模型名；4MB / 100MB / 30s 以魔法常量写死在 Harness 中。这些属于客户端行为常量，应可配置、可实测校准。
6. **选择性命名。** 把"单向推送归档"命名为"物理镜像"，把"客户端阈值"命名为"物理硬边界"，把"卡片服务"命名为"切片预热"。命名本身在放大结论的确定性。

---

## 5. 成立且应保留的部分

为公平起见，以下判断经复核成立：

- `8,192,000` 确实是 320 KiB 的整数倍（25×），且远低于 60 MiB 单块上限；
- 202 / 201 状态机与 Graph 语义一致；分块 PUT 不带 `Authorization`（预授权 URL）是正确的；
- `PnPSession` 三级 Cookie、`~/.ltk-shipschedule-session.json`、`SaveBinaryDirect`、`resolveSpoBase64` 均真实存在，功能描述基本对得上（除 F8 的措辞问题）；
- `bun run package` / `bun run build:package` 确实存在；
- "SharePoint 爬虫延迟不适合做实时知识库"的判断合理；
- "TDD 门禁 + Dirty Ledger + 不阻塞前台"是稳妥的容错形态；
- "单点轮次不重复上传全库"的取舍正确；
- 用 `SHA256` 为快照建立版本身份的方向正确（但需要升级为逐文件清单，见 P1）。

---

## 6. 修订清单

### P0（实施前必须关闭）

| 编号 | 修订项 | 可验证的通过条件 |
|---|---|---|
| P0-1 | 统一执行壳：全链路 `powershell.exe` 5.1，或整体迁移 PS7 + PnP 3.x 并放弃 cookie 认证 | 脚本启动时断言 PnP 主版本与 PowerShell 版本匹配，并用真实租户跑通一次单文件推送 |
| P0-2 | 将 4MB 改写为"客户端策略阈值" | 对 simple 端点做一次 >4MB 实测并记录真实响应；据实决定阈值 |
| P0-3 | 分块器补齐 `nextExpectedRanges` 驱动、429/503 `Retry-After`、超时、`driveItemData` 空值防护 | 注入式 mock 服务端覆盖：断流后续传、限流退避、收尾 202、超时中断 |
| P0-4 | 给 unfurl 指定实现归属并端到端验证，或删除"5~10 秒切片"的结论 | 可证伪验收：让模型引用仅存在于快照中的符号，并重复 n≥5 次统计命中率 |
| P0-5 | 快照枚举改为 `git ls-files` + `--others --exclude-standard`，显式排除嵌套项目与构建产物 | 本仓库快照体积与文件数落入预期（约 2MB / 200 级条目），且不包含 `pi/` |
| P0-6 | 测试超时改为按项目基线可配置（如 3× 实测基线），Windows 使用进程树终止 | 全量基线 20.14s 的机器上不误杀；人为死循环能连同 worker 一起清理 |
| P0-7 | 将两份实测证据纳入仓库或改为可复现脚本 | 任何人可按脚本复现核心数字 |

### P1（进入集成前）

- 检索可靠性做 n≥10 的重复试验与负样本，输出成功率、误召回、成本、延迟；
- 镜像补删除/重命名传播、版本裁剪、单写者队列；
- 交接身份用「逐文件哈希清单 + dirty 标记」替代仅 commit 号；
- 补 Windows 下补丁应用与 BOM/CRLF 处理，并设置有限重试次数；
- 对齐 snapshot 上限与 `read_file` 的 1MB 安全阈值（见 [`tool-bridge.ts`](../../src/protocol/tool-bridge.ts)），避免两套截断语义互相矛盾。

### P2（治理与长期）

- 合并同日 4 份重叠文档为唯一权威版本，并显式标注其余文档废止；
- 在 `CHANGE-REQUEST.md` 登记本次变更后再宣称"已批准"；
- 补安全小节：cookie 存储保护（ACL/DPAPI）、`uploadUrl` 日志脱敏、数据分级与 DLP；
- 给出 PnP 1.12.0 的退出计划与迁移窗口。

---

## 7. 附录

### A. 复现命令

```powershell
# 1) 确认 unfurl 不存在
rg "unfurl|searchservice" CPH-PI/src

# 2) 按文档白名单统计快照体积与顶层归属
$p='CPH-PI'; $ext=@('.ts','.tsx','.js','.jsx','.cs','.py','.ps1','.psm1','.json','.md','.sql','.html','.css','.yaml','.toml','.sh')
Get-ChildItem $p -Recurse -File | Where-Object { $ext -contains $_.Extension.ToLower() -and $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\\.cph\\|\\\.vscode\\|\\bin\\|\\obj\\|\\coverage\\|\\build\\|\\dist\\' } |
  Group-Object { ($_.FullName.Substring((Resolve-Path $p).Path.Length+1) -split '\\')[0] } |
  ForEach-Object { [pscustomobject]@{Top=$_.Name; MB=[math]::Round((($_.Group|Measure-Object Length -Sum).Sum)/1MB,2); Files=$_.Count} } |
  Sort-Object MB -Descending

# 3) 确认 pi 只是 gitlink
git -C CPH-PI ls-files pi

# 4) 确认 .worktrees 与凭据文件被 git 忽略
git -C CPH-PI check-ignore -v .worktrees
```

### B. 证据索引

| 证据 | 位置 |
|---|---|
| 现有上传实现与请求头 | [`src/transport/substrate-uploader.ts`](../../src/transport/substrate-uploader.ts) |
| CDP 兜底分支 | [`src/transport/file-porter.ts`](../../src/transport/file-porter.ts) |
| 读取安全阈值 | [`src/protocol/tool-bridge.ts`](../../src/protocol/tool-bridge.ts) |
| PnP 版本与 Cookie 层级 | [`Library/LTK/PnPSession.psm1`](../../../Library/LTK/PnPSession.psm1) |
| 测试基线与验证指标 | [`CHANGELOG.md`](../CHANGELOG.md) |
| 变更登记状态 | [`CHANGE-REQUEST.md`](../CHANGE-REQUEST.md) |
| 同日重叠文档 | [`resumable-upload-design`](../specs/2026-10-19-workspace-snapshot-supercharger-and-resumable-upload-design.md)、[`pnp-sharepoint-mirror-design`](../specs/2026-10-19-pnp-sharepoint-mirror-and-pure-protocol-subagent-design.md)、[`pipeline-architecture-design`](../specs/2026-10-19-workspace-snapshot-supercharger-and-pipeline-architecture-design.md)、[`pipeline-architecture plan`](../plans/2026-10-19-workspace-snapshot-supercharger-and-pipeline-architecture.md) |

### C. 审阅边界

- 未验证 9222 抓包与 RAG 盲测的真实性，仅确认其**证据文件不可得**；
- 未对 Microsoft 租户实际配额、DLP 策略、Copilot 附件摄取链路做线上实验；
- 未评估具体模型能力，仅评估"以单次实验推导架构结论"的推理强度；
- 未审查子代理 `annotations` 在云端是否真正被检索——该点需在 P0-4 的端到端实验中一并验证。
