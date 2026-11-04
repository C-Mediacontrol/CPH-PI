# MCP 草稿纸通道（Work 模式 SharePoint MCP）研究与设计

- **状态**: Phase 0 可行性验证完成；Phase 1 设计草案，**尚未批准实施**
- **日期**: 2026-11-04
- **适用项目**: CPH-PI（Microsoft Copilot 工作区同步与自主编程终端）
- **实验脚本与原始证据**: `.cph/state/probe/`（本地、gitignored，含脱敏后的帧与日志）

---

## 1. 摘要

本方案研究一条**可选的第二工具通道**：利用 M365 Copilot（Work 模式 / Premium）内置的 **SharePoint MCP tools for DeepWork**，把 SharePoint List 当作"草稿纸"：

1. Copilot 在一次回答内把命令写入列表；
2. 本地 worker 轮询列表、执行命令，把结果写回列表；
3. Copilot 在同一轮内通过 Work IQ 企业搜索读到结果，继续下一步。

**核心结论（已实测）**：

- 纯 WebSocket 协议可以复现 UI 行为，包括 MCP 写工具与 `TriggerConfirmation` 自动确认；
- 一次用户提问内部可以完成多轮"写 REQ → worker 执行 → 读 RES"，无需额外 Copilot 回合；
- 批量命令（一条 REQ 携带多条真实本地命令）可显著减少确认次数；
- 新会话可复用用户级授权，但**首次授权与重新授权必须经由浏览器 UI**；
- 这条通道不适合承载大文件/长文本的读写；文件 I/O 必须有独立的数据面设计（见 §8）。

**定位**：作为现有 action-block 主通道的**可选补充**，只在任务满足能力与合规条件时启用；不作为默认通道，也不替代云端工作区同步。

---

## 2. 背景与目标

现有 CPH-PI 通过 ChatHub 把模型输出的 `action` 块解析为本地工具调用，工具结果作为**下一轮用户消息**回传给 Copilot。每个工具调用消耗一个 Copilot 回合，长任务容易耗尽轮次预算。

目标：验证能否把"工具结果回传"从"新回合"改为"同一轮内的侧信道"，从而让 Copilot 在一轮内完成多次工具调用。

前提（用户确认并在实验中观察到）：普通 Copilot chat（Work 模式）具备 SharePoint MCP 工具，首次写入会弹出授权/确认卡，确认后可对指定 List 执行创建操作。

---

## 3. 实验环境与关键事实

| 项 | 值 |
| --- | --- |
| 账号 | FU Vincent（Work 帐户，M365 Copilot 高级版） |
| 聊天表面 | `https://m365.cloud.microsoft/chat`，Work 模式，模型 Auto |
| 工具来源 | `CopilotPlugins.OpenAIPlugin.sharepoint_mcp_tools`（BuiltInPlugin，动态选择） |
| 工具名 | `SharePoint MCP tools for DeepWork`，实测工具函数 `sharepointmcp_createListItem` |
| 测试列表 | 个人 OneDrive 站点 `/personal/gsc_vfu2_cma-cgm_com`，列表 `copilot_command_draft`（`ab70e1e7-439b-4fe2-9442-a03fbf1e6037`） |
| 列表结构 | 初始仅有默认 `Title` 单行文本列（maxLength 255）；所有实验通过 Graph/CSOM 可直接读写 |
| 令牌 | harness 的 Substrate 令牌 scope 与浏览器一致（含 `CopilotPlatformSites.Read.All`、`M365Chat.Read`、`sydney.readwrite`） |
| 读取路径 | **不是 MCP 读工具**；Copilot 使用 Work IQ 企业搜索（引用形如 `turnNsearchM`） |

---

## 4. 协议逆向结果

### 4.1 WebSocket 连接参数

真实 Work 模式 UI 的连接形如：

```text
wss://substrate.office.com/m365Copilot/Chathub/{oid}@{tid}
  ?chatsessionid={hex32}
  &XRoutingParameterSessionKey={oid}
  &clientrequestid={hex32}
  &X-SessionId={uuid}
  &ConversationId={uuid}
  &access_token={jwt}
  &source=%22officeweb%22
  &product=Office
  &agentHost=Bizchat.FullScreen
  &isEdu=false
  &licenseType=Premium
  &agent=work
  &scenario=officeweb
  &variants={约 4KB 的特性开关串}
```

关键点：

- 普通 web 模式是 `agent=web`、`licenseType=Starter`、`scenario=OfficeWebIncludedCopilot`；**Work 模式必须使用上表参数**，否则 MCP 工具不可见。
- `variants` 中包含 `EnableMcpServerWidgets`、`feature.EnableMcpServerWidgets`、`EnableRequestPlugins`、`feature.EnableInlineAuthForFCCInMainline`、`feature.EnableConfirmationDialogEnhancedUXForFCC`、`EnableWorkIQToggle` 等开关。
- 声明式 Custom Agent（`agent=Agent` + `gptId`）实测**没有**这些 MCP 工具。

### 4.2 Chat invocation 负载

真实 UI 的 `type=4,target=chat` 帧包含（与现有 ChatHubClient 的差异）：

- `optionsSets`：约 50 项（含 `enable_plugin_auth_interstitial`、`enable_confirmation_interstitial` 等）；
- `allowedMessageTypes`：含 `TriggerConfirmation`、`TriggerPluginAuth`、`ResumeInvokeAction`、`ResumePluginAuth`、`ConfirmationCard` 等；
- `gpts: [{ id: "bizchat-as-gpt-scenario", source: "BuiltInAgents", clientOverrides: { capabilities: [GraphConnectors, WebSearch, WorkSearch] } }]`；
- `plugins: [{ Id: "BingWebSearch", Source: "BuiltIn" }]`；
- `tone: "Magic"`（Auto 模型）、`renderReferencesBehindEOS: true`、`disconnectBehavior: "continue"`；
- `message.clientPreferences.executionControls`、`connectedFederatedConnections`、`clientInfo` 等。

> 这些字段不是全部必需，但按原样复现是当前验证通过的基线。

### 4.3 确认卡与自动确认（最关键）

MCP 写操作返回：

```json
{
  "messageType": "TriggerConfirmation",
  "turnState": "InputRequired",
  "isConsequential": true,
  "actionId": "[{\"function\":{\"arguments\":\"{...}\",\"name\":\"sharepointmcp_createListItem\"},\"id\":\"call_...\",\"type\":\"function\"}]",
  "messageId": "...",
  "requestId": "...",
  "pluginInfo": { ... },
  "adaptiveCards": [ ... ]
}
```

客户端确认方式（实测 UI 行为）：**新开一条 WS**，发送 `type=4,target=chat` 的 invocation，其中：

- 外层 `sessionId`、`ConversationId` 保持同一会话；
- `message.messageType = "ResumeInvokeAction"`；
- `message.sourceRequestId` = 确认卡的 `requestId`；
- `message.actionId` = 确认卡的 `actionId`；
- `message.invokeActionMessages[0]` 包含：
  - `actionId` / `action`（同 actionId）
  - `sourceRequestId`（同 requestId）
  - `confirmationOption: 1`
  - `isCancelOption: false`
  - `isConsequential: true`
  - `pauseResumeStoreRegion`
  - `text`（确认卡描述文本）
  - `messageId`（确认卡 messageId）
  - `messageType: "InvokeAction"`
  - `author: "user"`、`contentOrigin: "TuringBot"`
  - `pluginInfo`（来自确认卡）
- `clientPreferences`、`connectedFederatedConnections`、`clientInfo` 复制自确认卡。

发送后，服务器继续原任务；可能再次返回 `TriggerConfirmation`（下一条写命令），直到最终 `Chat` 回答。

### 4.4 读取路径

- 实测没有可用的 MCP"读取列表项"工具；Copilot 通过 Work IQ 企业搜索读取列表。
- 搜索能看到刚写入的列表项，但**不是强一致**：实测 RES 写入后约 8 秒，最终回答中出现对应 token。
- 因此读取必须设计为**带重试的轮询**，并接受秒级延迟。

---

## 5. 已完成实验与证据

### 5.1 纯 WS 写入（单次）

- 使用真实 UI 提取的 WS 参数 + invocation 模板 + 自动确认；
- 成功创建列表项 **Item 5**，标题 `PURE WS 2026-11-04T12:01:42.555Z`；
- 证明：**纯 WebSocket 可以驱动 MCP 写工具**。

### 5.2 全新会话复用授权

- 新建独立 `ConversationId` / `X-SessionId`，`isStartOfSession=true`；
- 成功创建 **Item 12**（`PURE FRESH ...`），**无需任何 UI 交互**；
- 证明：MCP 授权是**用户级**的，不是会话级；但首次授权仍必须走浏览器 UI。

### 5.3 一轮内双轮闭环

- 会话 `S-f83132`：
  - 12:15:46 Copilot 写 `REQ|S-f83132|1|compute`；
  - 12:15:47 worker 写 `RES|S-f83132|1|TKN-3c7a3606`（570ms）；
  - 12:15:58 Copilot 写 `REQ|S-f83132|2|compute`；
  - 12:15:59 worker 写 `RES|S-f83132|2|TKN-32e11127`；
  - 最终一条回答同时列出两个 token，引用 `turn9search90/92`。
- 证明：**一次用户提问内可完成多轮工具往返**。

### 5.4 批量真实命令

- `S-b13615`，一条 REQ 携带 3 条真实命令：

```text
REQ|S-b13615|1|echo BATCH-OK;;node --version;;git rev-parse --short HEAD
```

- worker 执行后写回：

```text
RES|S-b13615|1|BATCH-OK|v22.23.2|006d675
```

- worker 检测 + 执行 + 写回耗时 **456ms**；
- 首条服务消息到末条约 **13.4 秒**；
- Copilot 最终回答正确列出三个结果，引用 `turn10search100`。
- 证明：**批量命令 + 真实本地工具 + 同轮读回**成立，批量可摊薄确认成本。

### 5.5 失败样本（重要的失败语义）

- 早期 worker 误用 Substrate 令牌导致 Graph 401，worker 未写 RES；
- Copilot 在同一轮内重试读取约 12 次后放弃，如实回答"未读到 RES"，未编造 token；
- 该失败样本说明：**模型会重试但有上限；超时/失败必须由 Harness 显式处理，不能依赖模型无限等待**。

---

## 6. 拟议架构（草案）

### 6.1 双通道并存

```text
任务 → CapabilityProbe → 选择通道
                         ├─ Legacy lane（默认）：Custom Agent + action-block + 本地工具
                         └─ Scratchpad lane（可选）：Work 模式 + MCP 写列表 + worker
```

**默认仍是 Legacy lane**；Scratchpad lane 只在以下条件同时满足时启用：

- 租户/账号具备 Premium Work 模式与 SharePoint MCP 工具；
- MCP 连接已由用户在 UI 完成授权，且授权未过期；
- 任务可编码为短文本命令、可批量、结果可压缩；
- 合规允许对白名单列表的写操作自动确认。

### 6.2 组件划分

1. **WorkModeClient**：构建 Work 模式 WS URL 与 invocation 负载；维护 `ConversationId`/`X-SessionId`；处理流式帧。
2. **ConfirmationManager**：识别 `TriggerConfirmation` / `TriggerPluginAuth`；按策略自动发送 `ResumeInvokeAction`；设置最大确认次数、超时、审计日志。
3. **ScratchpadWorker**：轮询列表（Graph 或 PnP），认领 REQ，执行命令，写回 RES/STATUS；负责幂等、HMAC 校验、TTL 清理。
4. **Envelope/Protocol**：REQ/RES 信封、批量命令、结果分片、会话标识。
5. **CapabilityProbe**：会话开始前做一次能力探测（例如一次 create + 一次搜索读取），判断通道可用性；失败回退 Legacy lane。
6. **Audit & Policy**：记录自动确认、执行命令、写入结果；限制列表 ID、命令类型、结果大小。

### 6.3 数据流（目标协议）

```text
Copilot ──create item(REQ: Seq, Commands)──▶ SharePoint List
                                              │
ScratchpadWorker ──poll──▶ 认领 REQ ──执行──▶ RES/STATUS item
                                              │
Copilot ──Work IQ search 读取 RES──▶ 继续下一批/最终回答
```

### 6.4 列表结构建议

当前列表只有 `Title`（255 字符），不足以承载命令与长结果。建议扩展列：

| 列 | 类型 | 用途 |
| --- | --- | --- |
| `Title` | 单行文本 | 紧凑标识：`REQ|<session>|<seq>` / `RES|<session>|<seq>` |
| `Session` | 单行文本 | 会话/任务标识 |
| `Seq` | 数字 | 批次序号 |
| `Kind` | 单行文本 | `REQ` / `RES` / `STATUS` |
| `Body` | 多行文本 | JSON 命令或结果（长内容） |
| `Status` | 单行文本 | `pending` / `running` / `done` / `error` |
| `Nonce` | 单行文本 | HMAC 防注入 |
| `UpdatedAt` | 日期时间 | TTL / 清理 |

> 待验证：MCP `create item` 的 `fields` 是否支持多行文本列与自定义列；列容量上限；搜索能否返回长 `Body` 内容（可能只返回片段）。

### 6.5 自动确认策略（必须显式审批）

- 只对**白名单列表 ID** + **白名单命令类型**自动确认；
- 记录每次确认的 `actionId`、命令、目标列表、时间；
- 确认次数上限、单轮总时长上限；
- 若收到 `TriggerPluginAuth`（首次授权/重新授权）→ 停止自动处理，提示用户到 UI 完成授权；
- 生产上默认关闭自动确认，由用户显式开启。

---

## 7. 安全、合规与审计

- **命令注入**：任何能写列表的人都能注入 REQ；必须使用会话密钥 HMAC + 专用列表 + 最小权限。
- **本地执行**：命令 allowlist + 超时 + 沙箱；默认拒绝任意 shell。
- **敏感数据**：结果写入云端列表会留下审计/留存；必须脱敏、限制体积、避免 secret 入列。
- **自动确认责任**：Harness 替用户确认 consequential 写操作，属于重要权限动作；必须用户知情、可关闭、可审计。
- **多账号**：MCP 授权是 per-user；账号池轮转会导致失效，需绑定已授权账号或逐账号授权。
- **租户策略**：DLP、Copilot 功能开关、MCP/DeepWork 灰度都可能禁用该通道。

---

## 8. 文件命令（read_file / write / edit）重新设计

这是本方案最大的设计缺口：**列表不是文件数据面**。

### 8.1 问题

- `Title` 仅 255 字符；多行文本列容量有限；
- 无 MCP 读工具，读取依赖企业搜索，返回的是片段/摘要，不能保证逐行精确；
- 文件可能是二进制、超大、需要行号切片；
- 搜索结果有延迟且非强一致；
- 列表项上限与吞吐限制不适合作为大文件传输。

### 8.2 可选方案

**方案 A：多行文本列分片（仅小文本）**

- worker 把文件切成固定大小块（如 20–40KB），每块一个列表项（`Kind=CHUNK`, `Seq`）；
- Copilot 通过搜索结果逐块读取；行号范围由 worker 切片生成；
- 优点：无需额外文件通道；
- 缺点：列表项数量/搜索延迟/片段截断；只适合小文本，不适合二进制与大文件。

**方案 B：控制面/数据面分离（推荐）**

- 列表只承载**命令与状态**（小文本）；
- 文件内容走 **SharePoint 文档库热覆写** 或 **云端附件**：
  - worker 把读取结果写入云端文件（已证实文件热覆写后 Copilot `T+0` 可读）；
  - Copilot 通过文件 URL / Work IQ 读取完整内容；
  - 写入/编辑：命令中传 `path + patch`；大内容由 Copilot 原生文件生成服务产出下载链接，worker 用 FilePorter 搬运；
- 优点：数据面成熟、可承载大文件、与现有零 IO 工作区架构一致；
- 缺点：需要文件通道与列表通道协同；多一次写文件/索引。

**方案 C：文件 I/O 留在 Legacy lane**

- Scratchpad lane 只做控制/调度；`read_file`/`write_file`/`edit` 仍走 action-block + 本地工具；
- 优点：改动最小、行为可控；
- 缺点：文件类工具仍消耗回合，未完全实现"一轮内工具循环"。

### 8.3 建议

- **读**：优先方案 B（云端文件 + Work IQ），把 `read_file` 改写为"worker 生成/更新云端文件，Copilot 直接读文件"，避免列表承载内容；
- **写/改**：小补丁走方案 A（列表 Body）；大文件/新建文件走方案 B（原生文件生成 + FilePorter）；
- **兜底**：方案 C 保证不支持场景仍可用；
- 所有文件命令需要重新定义：`path`、`offset/limit`（行号）、`encoding`、`maxBytes`、结果引用（文件 URL/附件 ID），而不是把内容塞进列表。

---

## 9. 边缘情况矩阵

### 硬边界（不可用）

1. 首次/重新授权（必须浏览器 OAuth，纯 WS 无法完成）。
2. 非 Premium、非 Work 模式、声明式 Custom Agent、租户关闭 MCP/DeepWork、DLP 拦截。
3. 无 Work IQ 搜索权限或列表不可搜索（读取路径失效）。
4. 命令/结果超过列表列容量（Title 255；长文本列待验证）。
5. 需要强一致、低延迟、事务性的场景。
6. 合规禁止自动确认 consequential 写操作。
7. 多账号轮转中未授权的账号。

### 软边界（需兜底）

1. 搜索可见性延迟/丢失：重试上限、状态项、超时降级。
2. 确认往返成本：批量、限制确认次数。
3. 列表累积/5,000 项阈值/限流：TTL、清理、专用列表。
4. 命令注入/本地执行安全：HMAC、allowlist、sandbox。
5. 模型行为方差：能力探测、回退 Legacy lane。
6. 长任务：命令短小、异步状态机、结果分段。
7. 会话语义：一次用户轮次内含多次 WS invocation；防丢卡/重复确认。
8. 审计与用户知情。

---

## 10. 待验证实验（Phase 1）

1. **多行文本列**：新增 `Body` 列，验证 MCP `fields` 支持、容量上限、搜索能否读取长内容；用 10 条命令 + 长结果测试。
2. **延迟/掉线注入**：worker 延迟 5/15/30 秒、进程中途退出、重复写；观察 Copilot 重试上限与失败语义。
3. **10 条批量命令上限**：吞吐、执行时间、结果长度、确认次数。
4. **纯 WS 授权**：捕获首次 OAuth 流程（另用未授权账号/new list 触发），寻找可程序化完成的授权端点与 token 缓存；若不可行，明确"首次/过期必须 UI 授权"。
5. **文件数据面**：验证 SharePoint 文件热覆写 + Work IQ 读取的时延与容量；行号切片协议。
6. **能力探测**：设计一次 create + search 的探测流程与回退判定。

---

## 11. 决策与下一步

- Phase 0 已完成：可行性、协议、批量与失败语义均有实测证据。
- 本文件**不是**最终实施规格；Phase 1 实验完成后再产出正式设计/实施计划。
- 不建议立即改产品代码；先用探针脚本完成 Phase 1，并把结果回填本文件。
- 现有 action-block 通道保持默认；Scratchpad 通道默认关闭，显式启用。

---

## 附录 A：实验资产

- 探针脚本：`.cph/state/probe/pure-ws-mcp.ts`、`pure-loop.ts`、`pure-fresh.ts`、`cdp-*.ts`
- 模板：`.cph/state/probe/pure/{ws-params,initial-invocation,confirmation-invocation,trigger-confirmation}.json`
- 运行日志：`.cph/state/probe/loop-run-*`、`pure-run-*`
- 列表证据：Item 2–16（含 REQ/RES 与 PURE 测试；可清理）
