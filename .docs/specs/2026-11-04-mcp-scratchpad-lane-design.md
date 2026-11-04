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

### 4.5 纯 WS 授权调查（阶段性结论）

- 浏览器 `localStorage` 中只有 MSAL 缓存（`sydney`、`graph`、`search` 等 scope 的 access/id/refresh token），没有 MCP 连接器的授权材料；`sessionStorage`/`IndexedDB` 也没有相关 token。
- 前端 JS 中存在 `TriggerPluginAuth` / `ResumePluginAuth` 消息类型与连接器授权 UI（`registerConnectionFormInlineHost` 等），说明授权动作由 **UI/连接器层** 发起。
- 未授权时用纯 WS 调用：响应只有文本"需要授权"，**没有 adaptive card、授权 URL 或可用的 auth actionId**；授权完成后新会话可直接复用（用户级授权）。
- 阶段性结论：**未找到纯 WS 完成首次授权的入口**；首次/重新授权需要浏览器 OAuth（可作为一次性 bootstrap，由 Harness 用 CDP 自动化或引导用户完成）。若后续能触发未授权连接器的 `TriggerPluginAuth` 卡片，可进一步验证是否能从协议层拿到授权 URL。

**决策（2026-11-04）**：放弃纯 WS 授权探索。授权是连接器/用户级的一次性前置条件；Harness 不尝试自动授权，只在能力探测失败时提示用户去浏览器完成授权，之后纯 WS 会话可复用。
- 新增列表不会触发再授权（见 5.10）；因此"换列表触发授权"路径不成立。
- List 附件无法被 Copilot 读取（见 5.9），不能作为数据面。

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

### 5.6 多行 Command/Result 列 + 10 条批量

- 在原列表上新增两个多行明文列（SharePoint REST，`FieldTypeKind=3`，`NumberOfLines=20`）：
  - `Command`（A 列）：Copilot 写入的输入命令；
  - `Result`（B 列）：worker 写回的执行结果。
- `S-a13aae` 实验：Copilot 创建一条 `Title=REQ|S-a13aae|1`、`Command` 含 10 条 `echo CMD-01..10` 的列表项；worker 读取 `Command`，执行后写 `Title=RES|S-a13aae|1`、`Result` 为 10 行结果（69 字符，落盘耗时 719ms）；Copilot 同轮读回全部 10 个结果（引用 `turn11search111`）。
- 时间线：13:33:21 启动 → 13:33:29 确认卡 → 13:33:34 RES 落盘 → 13:33:42 最终回答；首条服务消息到末条约 11.6 秒。
- 证明：**多行 A/B 列可以同时承载"命令下行"与"结果上行"**，且 10 条批量命令可在同轮完成。
- 待验证：更长 `Result`（KB 级）的列容量、搜索片段截断、以及 10 条以上批量的上限。

---

### 5.7 延迟/掉线注入

- **延迟 15 秒**：`S-2ce84c` 实验中 worker 在检测到 REQ 后故意等待 15,000ms 再写 RES；Copilot 仍持续读取并在最终回答中返回全部 10 条结果（引用 `turn12search121`）。
  - 结论：Copilot 的读取重试窗口至少可覆盖 15 秒级抖动；短暂延迟可以被吸收。
- **完全掉线**：早期 worker 误用令牌导致 Graph 401、始终不写 RES；Copilot 重试约 12 次后如实回答"未读到 RES"，未编造 token。
  - 结论：瞬时延迟可容忍，永久失败必须由 Harness 显式处理；模型的重试有上限，不能依赖其无限等待。

### 5.8 长 Result 读取（文件读取的关键证据）

- `S-678d41`：worker 写入 300 行、2,699 字符的 `Result`（`LINE-001`…`LINE-300`）。
- Copilot 在同一轮内读取完整 `Result`，正确回答 **第 250 行 = `LINE-250`**、**总行数 = 300**（引用 `turn13search134`）。
- 结论：列表 `Result` 列 + Work IQ 搜索可以承载并精确读取至少 **2.7KB / 300 行** 的文本；这使"小文本文件分块经列表传输"成为可行方向。更大文本（几十 KB）与二进制/编码内容仍待验证。

### 5.9 List 附件实验（结论：不能作为 Copilot 数据面）

- 通过 SharePoint REST 在 Item 21 上创建并上传附件 `attach-test-1793802425544.txt`，REST 读回内容正确（200，38 字节）。
- Copilot 直接读取附件 URL：失败（无法访问该附件内容）。
- 企业搜索检索附件文件名/内容：失败（"未检索到列表附件"）。
- 带 siteId/listId 用纯 WS 让 Copilot 调 MCP 读取：成功读取 Item 21 字段（`Attachments=true`），但 MCP 暴露的读取工具只有列表项/文件元数据，**没有附件内容下载工具**；Copilot 明确说明无法读出附件正文。
- 结论：List 附件可用于 worker/用户侧存储与审计，但**不能作为 Copilot 的文件数据面**。

### 5.10 新建列表是否触发再授权（结论：不会）

- 新建列表 `copilot_scratchpad_auth_1793802961089`（listId `8f821d87-7f0e-4fd2-a26b-574a77db59ba`），用同一 GSC.VFU2 账号、纯 WS 对其实施 MCP create：**无 `TriggerPluginAuth`、无授权卡，直接成功**（Item 1）。
- 结论：当前的 MCP 授权是**连接器/用户级**，不是列表级；新建列表不会触发重新授权。要捕获首次 OAuth 流程，仍需撤销连接器授权或换用户/租户。

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
| `Command` | 多行文本 | **A 列：输入命令**（每行一条/批量） |
| `Result` | 多行文本 | **B 列：输出结果**（长内容） |
| `Session` | 单行文本 | 会话/任务标识 |
| `Seq` | 数字 | 批次序号 |
| `Kind` | 单行文本 | `REQ` / `RES` / `STATUS` |
| `Status` | 单行文本 | `pending` / `running` / `done` / `error` |
| `Nonce` | 单行文本 | HMAC 防注入 |
| `UpdatedAt` | 日期时间 | TTL / 清理 |

> `Command` / `Result` 已在实验中创建为多行明文列（`linesForEditing=20`）；它们是 A/B 两列的业务语义。列表标题列只做紧凑标识，不承载内容。

> 待验证：MCP `create item` 的 `fields` 是否支持多行文本列与自定义列；列容量上限；搜索能否返回长 `Body` 内容（可能只返回片段）。

### 6.5 自动确认策略（必须显式审批）

- 只对**白名单列表 ID** + **白名单命令类型**自动确认；
- 记录每次确认的 `actionId`、命令、目标列表、时间；
- 确认次数上限、单轮总时长上限；
- 若收到 `TriggerPluginAuth`（首次授权/重新授权）→ 停止自动处理，提示用户到 UI 完成授权；
- 生产上默认关闭自动确认，由用户显式开启。

### 6.6 Agent / 提示词 / Skill 协议约定

列表是"人可读、模型可写、worker 可执行"的三方契约，必须同时登记到系统提示词与技能：

- **列语义契约（A/B）**：`Command` = 输入命令（每行一条，或批量分隔），`Result` = 执行结果；`Title` 只放 `REQ|session|seq` / `RES|session|seq`；`Status` 表达 pending/running/done/error。
- **Agent 提示词**：明确"写入 REQ 时填 Command 列；读到 RES 后读 Result 列；最多重试 N 次；不得伪造 token/结果；批量命令用换行分隔"。
- **Skill**：新增 `skills/mcp-scratchpad/SKILL.md`（或等价技能），描述信封格式、批次、错误处理、清理与安全边界；与 `handoff` / `subagent` 同级登记。
- **Harness 回执**：worker 写 RES 成功后，应在列表/日志中留可追踪状态；确认卡、命令、结果均进入审计。
- **版本化**：`Session` 或 `Title` 前缀带协议版本（如 `v1`），便于后续演进与回退。
- **一致性检查**：Agent 侧协议变更必须同步 Harness 解析与 `package/agent-bundle` 分发（AGENTS.md 准则 11）。

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
  - 已验证：多行 A/B 列可承载 10 条命令与 69 字符结果；300 行 / 2,699 字符的 Result 也能被完整读取（见 5.8）。因此小/中文本可以走分片；几十 KB 以上、二进制与编码内容仍不适合。
- 附件已排除：Copilot 不能读取 List 附件内容（见 5.9），文件数据面应使用文档库/云端文件或由 worker 搬运，而不是 List 附件。

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

1. ~~多行文本列~~（已完成）：`Command` / `Result` 多行明文列已创建；10 条命令 + 69 字符结果、300 行 / 2,699 字符结果均成功读回（见 5.6、5.8）。
2. ~~延迟/掉线注入~~（已完成）：15 秒延迟仍成功；永久掉线时模型重试约 12 次后失败（见 5.7）。
3. ~~10 条批量命令~~（已完成）：10 条命令在一轮内完成，确认卡 1 次，worker 719ms（见 5.6）。
4. ~~纯 WS 授权~~（已放弃）：确认授权为连接器/用户级一次性前置条件；Harness 不做自动授权，只在能力探测失败时提示用户到浏览器授权。
5. **文件数据面**：在 5.8 基础上继续测试更大 Result（如 1,000 行 / 50KB）、二进制/编码、SharePoint 文件热覆写 + Work IQ 读取；设计行号切片协议。
7. ~~List 附件~~（已完成）：REST 可上传/读回，但 Copilot 无读取附件内容能力（见 5.9）。
8. ~~新建列表触发再授权~~（已完成）：不会触发；授权是连接器/用户级（见 5.10）。
9. **首次授权捕获**：需要撤销连接器授权或换用户/租户，属于下一步高价值实验。
6. **能力探测**：设计一次 create + search 的探测流程与回退判定。

---

## 11. 决策与下一步

- Phase 0 已完成：可行性、协议、批量与失败语义均有实测证据。
- 本文件**不是**最终实施规格；Phase 1 实验完成后再产出正式设计/实施计划。
- 不建议立即改产品代码；先用探针脚本完成 Phase 1，并把结果回填本文件。
- 现有 action-block 通道保持默认；Scratchpad 通道默认关闭，显式启用。
- 2026-11-04 决策：放弃纯 WS 授权探索；授权按用户级一次性前置条件处理（能力探测失败 → 提示 UI 授权）。

---

## 附录 A：实验资产

- 探针脚本：`.cph/state/probe/pure-ws-mcp.ts`、`pure-loop.ts`、`pure-fresh.ts`、`cdp-*.ts`
- 模板：`.cph/state/probe/pure/{ws-params,initial-invocation,confirmation-invocation,trigger-confirmation}.json`
- 运行日志：`.cph/state/probe/loop-run-*`、`pure-run-*`
- 列表证据：Item 2–16（含 REQ/RES 与 PURE 测试；可清理）
