# CPH-PI 最终方案：MCP 草稿纸通道（控制面 / 数据面分离）

- **状态**: Final v1（基于 Phase 0 实验结论，可进入实施计划）
- **日期**: 2026-11-04
- **取代**: [`2026-11-04-mcp-scratchpad-lane-design.md`](2026-11-04-mcp-scratchpad-lane-design.md)（研究记录）
- **范围**: M365 Copilot Work 模式 + SharePoint MCP 的可选 scratchpad lane

---

## 1. 最终决策（先看这一节）

1. **Scratchpad lane 是可选的控制面，不是数据面。**
   - List 只承载：命令、状态、短结果、文件引用（路径/URL/SHA）。
   - List **不承载**：源码、文件正文、二进制、大段日志。
2. **默认仍是 Legacy lane**（Custom Agent + action-block + 本地工具）。
   - Scratchpad lane 显式启用，按任务选择，失败自动回退。
3. **文件与代码操作继续走 Legacy / 数据面。**
   - `read_file` / `write_file` / `edit` 保留本地工具语义；
   - 大文件或新文件由 Copilot 原生文件生成 + FilePorter 搬运**原始字节**；
   - List 只传 artifact URL + SHA256，不传内容。
4. **授权是用户级一次性前置条件。**
   - 首次/重新授权必须走一次浏览器 OAuth；
   - Harness 不做自动授权；能力探测失败时提示用户到浏览器完成授权；
   - 授权完成后，纯 WS 新会话可直接复用（已实测）。
5. **List 附件不作为 Copilot 数据面。**
   - Copilot 只能读 item metadata，无附件内容工具；附件仅用于 worker/用户侧存储。
6. **纯 WS 授权不纳入范围。**
   - 已确认没有可靠的协议层授权入口；不再投入。

一句话：**用 List 换"一轮内多步执行/核验"，不用 List 换"文件传输"。**

---

## 2. 实验依据（支撑上述决策）

| 证据 | 结果 |
| --- | --- |
| 纯 WS MCP create | 成功；新会话复用用户级授权 |
| 一轮双轮闭环 | Copilot 写 REQ → worker 执行 → Copilot 同轮读 RES，两个随机 token 全部读回 |
| 10 条批量真实命令 | 1 条 REQ 带 10 条命令；worker 719ms；Copilot 同轮读回全部 10 个结果；确认卡仅 1 次 |
| 多行文本列（A/B） | `Command` / `Result` 多行明文列可写入、可读回 |
| 长 Result | 300 行 / 2,699 字符被完整读取（第 250 行、总行数均正确） |
| 延迟注入 | worker 延迟 15 秒仍成功；永久掉线时模型重试约 12 次后如实报错 |
| 新建列表授权 | 新建 list 不触发再授权；授权为连接器/用户级 |
| List 附件 | REST 可上传/读回；Copilot 无附件内容读取能力 |
| 文件数据面 | OneDrive 冷/既有文件、团队站点文件均无法可靠读取正文；附件同样失败 |

> 完整实验记录、协议帧与时间线见研究文档 §4–§5。

---

## 3. 总体架构

```text
                     ┌──────────────────────────────┐
                     │ Task / Agent Orchestrator     │
                     └──────────────┬───────────────┘
                                    │ capability probe
                    ┌───────────────┴────────────────┐
                    │                                │
           Legacy lane（默认）                Scratchpad lane（可选）
    Custom Agent + action-block          Work 模式 + SharePoint MCP
    read/write/edit/bash...              Command/Result List + Worker
                    │                                │
                    ▼                                ▼
            本地工具 / 文件系统               List（控制面）
                                                     │
                                            ScratchpadWorker
                                         （本地执行 + 数据面搬运）
                                                     │
                                    ┌────────────────┴────────────────┐
                                    │                                 │
                            exec / inspect 摘要              文件 artifact（URL+SHA）
                                    │                                 │
                                    └────────────► Legacy 本地工具 / FilePorter
```

### 3.1 通道选择

- 默认：Legacy lane。
- 启用 Scratchpad lane 的条件（全部满足）：
  1. 租户/账号具备 Work 模式与 SharePoint MCP（Premium）；
  2. 连接器已由用户完成一次性授权；
  3. 任务可拆成短命令 + 摘要结果（探查、测试、构建、批量核验）；
  4. 合规允许对白名单列表的 MCP 写操作自动确认。
- 任一探测失败 → 回退 Legacy lane，并记录原因。

### 3.2 组件

1. **WorkMcpTransport**
   - 复现 Work 模式 WS 参数与 invocation 负载（`agent=work`、`licenseType=Premium`、`scenario=officeweb`、variants、optionsSets、`gpts`、`plugins`、`tone`）；
   - 维持 `ConversationId` / `X-SessionId`；
   - 解析流式帧与最终回答。

2. **ConfirmationManager**
   - 识别 `TriggerConfirmation`，自动发送 `ResumeInvokeAction`；
   - 只对白名单列表 + 白名单动作自动确认；
   - 单轮确认次数上限；收到 `TriggerPluginAuth` 立即停止并提示用户授权；
   - 所有确认写入审计。

3. **ScratchpadWorker**
   - 轮询 List（Graph/PnP），认领 REQ；
   - 校验信封、会话、HMAC、幂等键；
   - 执行 `exec`/`inspect`，把**摘要**写入 RES；
   - 负责 TTL、清理、并发 claim、失败回执；
   - 大文件 artifact 由 worker 用 FilePorter 拉取原始字节后落盘/应用。

4. **Envelope / Protocol**
   - 严格的 JSON 信封（见 §4）；
   - 内容限制：命令/结果短小；禁止文件正文；
   - 版本化（`v: 1`）。

5. **CapabilityProbe**
   - 会话开始前：一次 MCP create + 一次读取验证；
   - 探测失败 → Legacy，并给出明确原因（授权/许可/策略/索引）。

6. **Audit & Policy**
   - 记录自动确认、列表 ID、命令、执行结果、文件 SHA、回退原因；
   - 白名单、命令 allowlist、大小/超时限制、沙箱。

---

## 4. 协议设计

### 4.1 List 列

| 列 | 类型 | 用途 |
| --- | --- | --- |
| `Title` | 单行文本 | `REQ|<session>|<seq>` / `RES|<session>|<seq>` |
| `Command`（A） | 多行文本 | 输入：JSON 命令信封（短小） |
| `Result`（B） | 多行文本 | 输出：JSON 摘要（短小） |
| `Session` | 单行文本 | 会话/任务标识 |
| `Seq` | 数字 | 批次序号 |
| `Kind` | 单行文本 | `REQ` / `RES` / `STATUS` |
| `Status` | 单行文本 | `pending` / `running` / `done` / `error` |
| `Nonce` | 单行文本 | HMAC 防注入 |
| `UpdatedAt` | 日期时间 | TTL / 清理 |

### 4.2 命令信封（`Command` 列）

```json
{
  "v": 1,
  "session": "S-abc123",
  "seq": 1,
  "op": "exec",
  "commands": [
    { "id": "c1", "cmd": "git status --short", "timeoutMs": 30000 },
    { "id": "c2", "cmd": "npm test -- --runInBand", "timeoutMs": 120000 }
  ],
  "reply": "summary"
}
```

允许的 `op`：

- `exec`：执行短命令（git/test/build/rg 等），返回退出码 + stdout/stderr 摘要；
- `inspect`：只读探查（行数、匹配摘要、符号列表），返回摘要，不返回源码全文；
- `put_file`：`{ "url": "<Copilot 生成的下载链接>", "path": "src/...", "sha256": "..." }`，worker 用 FilePorter 拉取原始字节并校验；
- `patch`：`{ "patch_url": "...", "path": "...", "base_sha256": "...", "patch_sha256": "..." }`，worker 下载 patch 字节并原子应用；**List 不传 patch 正文**。

`read_file` 不进入 List 协议：需要源码上下文时走 Legacy `read_file`；scratchpad 只通过 `inspect`/`exec` 返回摘要。

### 4.3 结果信封（`Result` 列）

```json
{
  "v": 1,
  "session": "S-abc123",
  "seq": 1,
  "status": "ok",
  "results": [
    { "id": "c1", "exit": 0, "stdout": " M src/...", "stderr": "", "truncated": false },
    { "id": "c2", "exit": 1, "stdout": "...", "stderr": "FAILED ...", "truncated": false }
  ],
  "ts": "2026-11-04T15:00:00Z"
}
```

限制（最终版硬约束）：

- 单批命令 ≤ **10 条**（已实测 10 条成功）；
- 单条命令超时 ≤ 120s；总批次 ≤ 300s；
- `Result` 建议 ≤ **4KB**；已验证 300 行 / 2.7KB 可读；
- **禁止**在 `Command` / `Result` 中出现源码全文、二进制、Base64 大文件；
- 超出限制 → 拆批或走 Legacy / artifact。

### 4.4 A/B 列与 Agent / 提示词 / Skill 契约

- Agent 提示词必须登记：
  - REQ：`Title=REQ|session|seq`，`Command` 写 JSON 信封；
  - 读取 RES：读 `Result`，按 `status`/`results` 继续；
  - 重试上限：最多 12 次读取；无结果必须如实报告，不伪造；
  - 批量命令用数组，不塞入文件内容。
- 新增 Skill：`skills/mcp-scratchpad/SKILL.md`，与 `handoff` / `subagent` 同级登记；描述协议、限制、错误处理、清理。
- `package/agent-bundle` 同步分发该 Skill 与提示词更新（AGENTS.md 准则 11）。
- 版本化：`v` 字段 + `Title` 前缀保留升级空间。

---

## 5. 自动确认与授权策略

- **首次/重新授权**：用户级、浏览器 OAuth、一次性；Harness 只提示，不自动授权。
- **自动确认**：仅针对白名单 List + 白名单动作（MCP create item 写 REQ/STATUS），并设置：
  - 单轮最大确认次数；
  - 单轮最大时长；
  - 审计记录（actionId、参数、列表、时间）。
- `TriggerPluginAuth` / 授权过期 → 停止自动处理，提示用户到浏览器授权，回退 Legacy。
- 生产默认关闭自动确认；用户显式开启后才对白名单列表生效。

---

## 6. 安全、合规与审计

- **命令注入**：List 任何写权限者都可能注入 REQ → 必须 HMAC + 专用列表 + ACL + 命令 allowlist。
- **本地执行**：命令白名单 + 超时 + 沙箱；默认拒绝任意 shell；禁止从 List 直接执行未经校验的脚本。
- **内容保真**：patch/put_file 必须带 SHA256；worker 校验字节后原子应用；失败回滚并报错。
- **敏感数据**：List 不留 secret、源码、大段日志；结果脱敏；遵守 DLP/留存策略。
- **自动确认责任**：Harness 替用户确认 consequential 写操作 → 必须用户知情、可关闭、可审计。
- **多账号**：MCP 授权 per-user；账号池不得轮转到未授权账号；Scratchpad lane 绑定已授权账号。
- **审计**：确认、命令、结果、文件 SHA、回退全部落 `.cph/state/` 账本。

---

## 7. 边界与不适用场景

**硬边界（不使用 Scratchpad lane）**

- 首次授权未完成 / 授权过期；
- 非 Premium、非 Work 模式、租户关闭 MCP/DeepWork、DLP 拦截；
- 需要传输文件正文、二进制、大文本；
- 需要强一致、低延迟、事务；
- 严格禁止自动确认 consequential 操作；
- 多账号轮转中未授权账号。

**软边界（需兜底）**

- 搜索可见性延迟（15 秒内可等；永久失败需回退）；
- 模型重试上限（约 12 次）；
- List 5,000 项阈值 / 限流 / 并发 → TTL、清理、专用列表；
- 模型行为方差 → 能力探测 + Legacy 回退；
- 单轮多次 WS invocation → 状态机需防丢卡。

---

## 8. 实施阶段（建议）

### Phase 1：MVP（控制面）
- WorkMcpTransport（Work 参数 + invocation 模板）；
- ConfirmationManager（白名单自动确认）；
- ScratchpadWorker（`exec` + `inspect`，摘要 Result）；
- List 列：Title/Command/Result/Session/Seq/Kind/Status/Nonce；
- CapabilityProbe + Legacy 回退；
- 能力开关（默认关闭）。

**验收**：
- 10 条 `exec` 批量在一轮内完成，结果正确；
- 1 次确认卡自动处理；
- 探测失败/授权失败能回退并给出清晰原因；
- 无源码/文件正文进入 List。

### Phase 2：可靠性与审计
- HMAC、幂等、TTL/清理、并发 claim；
- 审计、限流、失败回执；
- 15s 延迟/掉线注入测试；
- 提示词 + Skill + agent-bundle 同步。

### Phase 3：文件 artifact（可选）
- `put_file` / `patch` via artifact URL + FilePorter；
- SHA256 校验、原子应用、回滚；
- 不改变 "List 不传内容" 的原则。

---

## 9. 明确的非目标（Out of Scope）

- 用 List 传输源码/文件正文/二进制；
- 用 List 附件作为 Copilot 数据面；
- 纯 WS 自动授权；
- 自动处理 `TriggerPluginAuth`；
- 多账号未授权情况下强制使用 scratchpad lane；
- 替代现有云端工作区同步。

---

## 10. 待办与风险登记

| 项 | 状态 |
| --- | --- |
| 文件数据面（文档库/Work IQ） | 实验失败；暂不纳入，后续可单独研究 |
| List 文本容量上限 | 不做为文件通道；4KB 作为建议上限 |
| 纯 WS 授权 | 已放弃 |
| List 附件数据面 | 已排除 |
| MCP 协议/特性开关变更 | 需版本化探测与回退 |
| 自动确认合规审批 | 上线前需用户/安全确认 |

---

## 11. 证据与资产

- 研究记录：[`2026-11-04-mcp-scratchpad-lane-design.md`](2026-11-04-mcp-scratchpad-lane-design.md)
- 实验脚本/帧：`.cph/state/probe/`（本地，gitignored）
- 关键提交：
  - `ed50ad1` 初版设计
  - `11686f3` Command/Result + 10 条批量
  - `55c5c1a` 延迟/长结果/授权调查
  - `443f8df`、`b2436a4` 附件/新列表
  - `71c6c1d` 关闭纯 WS 授权
  - `6474e24` 文件数据面失败结论
