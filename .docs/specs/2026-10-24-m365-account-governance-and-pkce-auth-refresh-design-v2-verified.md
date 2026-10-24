# M365 账号池全生命周期治理、PKCE 快捷重登与跨代会话连续性架构设计规范（v2 事实核验修正版）

> **日期**：2026-10-24
> **状态**：Review Verified (v2 — 基于源码实测、`Library/m365-auth-helper` 对照与 `AGENTS.md` 治理准则修正)
> **前序文档**：`CPH-PI/.docs/specs/2026-10-24-m365-account-governance-and-pkce-auth-refresh-design.md` (v1)
> **关联计划**：`CPH-PI/.docs/plans/2026-10-24-m365-account-governance-and-pkce-auth-refresh.md`
> **适用范围**：`CPH-PI`（Auth / AccountPool / Orchestrator / SubagentRunner / Web RPC & UI / CLI / Prompt & Handoff Skill）

---

## 0. 修订说明（v1 审查结论：事实性错误、理想化假设与架构偏颇纠偏）

对 v1 设计报告及配套实施计划进行全量源码级交叉核验后，发现 **7 处事实性代码错误（F1–F7）**、**1 处严重违背 `AGENTS.md` 核心准则的架构偏颇（B1）** 以及 **4 处过于理想的协议/交互假设（C1–C4）**。若直接按 v1 落地，不仅无法修复「60 秒无效轮询」与「0 字节交接空转」，反而会引发**0 秒无冷却死循环打爆微软接口**、**污染 OneDrive 上传附件原始字节流**以及**前端状态与后端方法调用斷裂**等严重事故。

### 0.1 核心偏差对照总表

| 编号 | 类别 | v1 原报告表述 / 假设 | 源码实测事实与根因验证 | v2 修正方案 |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | 🔴 **事实性错误**<br>（致命逻辑反噬） | §3.2 声称捕获 `invalid_grant` 后只需设 `status.authExpired = true`、`status.isAvailable = false`、`status.cooldownUntil = 0`、`status.isThrottled = false` 即可停止 60s 轮询。 | 实测 `account-pool.ts` 的选号循环（`acquireSessionLease` L305-327、`getNextAvailableToken` L542-565）、容量计算（`getAvailableCapacity` L248-264）以及 `subagent-runner.ts`（L219-221）**完全不检查 `status.isAvailable` 或 `status.authExpired`，只检查 `status.isThrottled`**！若按 v1 将 `isThrottled` 置为 `false` 且 `cooldownUntil = 0`，失效账号不仅不会隔离，反而会**从 60s 冷却退化为 0s 无冷却高频死循环选中**。 | 在 `AccountPool` 所有选号入口（`acquireSessionLease`、`getNextAvailableToken`、`getGraphAccessToken`）与容量统计（`getAvailableCapacity`、`SubagentRunner.executeBatch`）中统一增加 `if (status.authExpired \|\| !status.isAvailable \|\| status.isThrottled)` 硬门禁。 |
| **F2** | 🔴 **事实性错误**<br>（异常契约失配） | §1.1 / §3.2 假设捕获的错误带 `err.code === "invalid_grant"`，且仅拦截 `getNextAvailableToken` 与 `acquireSessionLease`。 | 1. `token-manager.ts:235-240` 与 `289-294` 抛出的是普通 `Error(\`Azure AD token refresh failed (${res.status}): ${errBody.slice(0, 300)}\`)`，无 `.code` 属性。<br>2. 除 `invalid_grant` / `AADSTS700082` 外，企业租户常见的 `AADSTS50076` / `AADSTS50079`（MFA 变更）、`AADSTS50173`（密码修改/吊销）、`AADSTS70008`、`AADSTS70000` 均属需交互重登的凭据失效。<br>3. `AccountPool.getGraphAccessToken()`（`account-pool.ts:687-698`）盲取 `(this.currentIndex - 1)` 账号且不检查 `authExpired`，首个账号过期时仍会令 OneDrive 附件上传崩溃。 | 1. 抽出统一的 `isFatalAuthGrantError(err)` 判定函数，覆盖 `invalid_grant`、`interaction_required` 及上述 `AADSTS` 错误码。<br>2. `getGraphAccessToken()` 改为遍历选择首个 `!status.authExpired && !status.isThrottled && status.isAvailable` 的健康账号，并在捕获致命鉴权错误时同样触发 `markAuthExpired(email, reason)`。 |
| **F3** | 🔴 **事实性错误**<br>（路径幻觉与真凶漏判） | §3.5 声称“从 `.cph/state/wal.jsonl` 与 `execution-ledger.md` 提取指纹”，并认为 0 字节文件是因为 `generateHandoffSnapshot` 兜底不严。 | 1. **路径幻觉**：仓库中根本不存在 `.cph/state/wal.jsonl`！真实预写日志路径为 `.cph/state/execution-ledger.jsonl` 与 `.cph/state/execution-ledger.md`（见 `execution-ledger.ts:27-28`）。<br>2. **真凶漏判**：`generateHandoffSnapshot`（`orchestrator.ts:1319`）**本来就有** `if (existingDoc.length > 50)` 校验！真正写出 0 字节文件并绕过兜底的漏洞在另外两处：<br>① `orchestrator.ts:850-859`：模型输出空 ` ```handoff\n``` ` 块时，`parsed.handoffDoc` 为 `""`，L857 `fs.writeFileSync(docPath, parsed.handoffDoc)` **无长度校验直接将 0 字节写入磁盘**；<br>② `orchestrator.ts:2147-2169`（容灾仲裁 Session B）：若仲裁会话写了 0 字节文件，L2154 `if (!fs.existsSync(targetHandoffAbsolutePath))` 因文件已存在而跳过兜底写入，L2167 三元表达式直接读出 `""` 赋给 `finalDocContent`！ | 1. 修正所有文档与代码引用为真实路径 `.cph/state/execution-ledger.jsonl`。<br>2. 封堵 `orchestrator.ts:854`（仅当 `parsed.handoffDoc.trim().length >= 50` 时才直接落盘，否则统一走 `generateHandoffSnapshot` 账本合成）与 `orchestrator.ts:2154-2169`（对仲裁产物执行 `trim().length < 50` 校验，不足 50 字符强制覆写为 `disasterBlackbox`）。 |
| **F4** | 🟠 **事实性错误**<br>（前端字段错名与跨代握手残留） | §3.3 计划在 `store.ts` 的 `turn:start` 中更新 `currentSessionId`；在 `rpc-handler.ts` 接力循环中仅更新 `sessionId` 與 `userText`。 | 1. 实测 `web/src/services/store.ts:499`：Store 的真实字段名为 `activeSessionId`，**根本不存在 `currentSessionId`**！<br>2. 实测 `rpc-handler.ts:1460-1540` 对比 `cli.ts:1491`：CLI 在跨代接力进入下一跳前调用了 `this.orchestrator.resetHandshake()`，而 `RpcHandler` **未调用 `resetHandshake()`**。由于 `this.orchestrator` 是复用实例，其内部 `this.conversationId` 仍保留上一代旧值，导致新会话 `newSessionId` 在部分分支误复用死会话 ID。 | 1. 前端 `store.ts` 严格使用真实状态字段 `activeSessionId`（配合 `selectSession` 或状态同步）。<br>2. `RpcHandler` 跨代接力切换 `newSessionId` 时，必须同步调用 `this.orchestrator.resetHandshake()`。 |
| **F5** | 🟠 **事实性错误**<br>（租约泄漏冲击面不全） | §1.2 / §3.3 认为只有 `RpcHandler` 接力循环漏调了 `releaseSessionLease`。 | 实测存在 **4 处**租约生命周期漏洞：<br>1. `orchestrator.ts:459`：`orchestrator.run()` 内部在 `!this.chatClient` 时调用 `getNextAvailableToken({ sessionId: this.sessionId })`（内部触发 `acquireSessionLease`），但 `run()` 结束时无 `finally` 释放租约——这意味着 **CLI 模式自主接力（`cli.ts:1474`）同样会泄漏每一代旧会话租约**！<br>2. `orchestrator.ts:966`：主会话世代虚拟化（`!isInlineScout`）切换 `nextSessionId` 时，调用 `getNextAvailableToken` **漏传了 `sessionId: nextSessionId`**，且未释放旧 `this.sessionId` 租约。<br>3. `orchestrator.ts:478, 711, 737`：转入 `executeDisasterRecoveryArbitration` 前未释放原故障会话租约。<br>4. `rpc-handler.ts:1456-1535`：单跳结束或中断退出时未释放当前代租约。 | 将租约获取与释放收口为对称生命周期：<br>1. 在 `orchestrator.run()` 的 `finally` 块中或世代切换点（L966、容灾移交点、`RpcHandler`/`CLI` 接力跳点）确保旧 `sessionId` 调用 `pool.releaseSessionLease(oldSessionId)`。<br>2. 在 `orchestrator.ts:966` 世代虚拟化时显式传入 `{ sessionId: nextSessionId, forAgentId }`。 |
| **F6** | 🟠 **事实性错误**<br>（现存 Web 重置按钮断线） | v1 声称完善 Web 账号治理闭环，但未检查现有 `account:reset_cooldown` 链路。 | 实测 `rpc-handler.ts:1813`：`handleAccountResetCooldown` 调用了 `(this.pool as any).resetCooldown(payload.email)`，但 `AccountPool`（`account-pool.ts:430`）中真实方法名为 `unthrottle(email)`，**根本没有 `resetCooldown` 方法**！Web 端点击「重置冷却」会直接抛出 `TypeError` 并被静默吞掉。 | 在 `AccountPool` 中正式提供语义明确的 `resetCooldown(email: string)`（内部委托 `unthrottle(email)`，但仅对 `!status.authExpired` 账号恢复可用，防止将 `authExpired` 账号误重置为可用），打通 `rpc-handler.ts:1813`。 |
| **F7** | 🟡 **事实性错误**<br>（测试基线失真） | §4.2 声称“确保现有 102+ 测试文件、800+ 测试用例零回归”。 | 实测当前 `bun test --timeout 15000` 基线为：**102 个测试文件、789 个测试用例、3588 个 `expect()` 断言，全部通过（0 fail）**。 | 以实测数据 `102 files / 789 tests / 3588 assertions` 作为精确回归基线。 |
| **B1** | 🔴 **有失偏颇**<br>（违背 `AGENTS.md` 准则 1 & 9） | §1.4 / §3.5 提议在 `ToolBridge` 中增加 `lastReadRecord` 拦截器，当连续 2 次读取同一文件时在返回文本末尾拼接 `Notice: You have read this file consecutively... Do not read it again...`。 | 1. **直接违背 `AGENTS.md` 核心准则 1（Harness 纯粹与中立原则）**与 `2026-10-19-harness-neutrality-and-powershell-knowledge-design.md` 决议：严禁在 Harness 层给模型打特化补丁或注入主观说教。<br>2. **直接违背 `AGENTS.md` 核心准则 3（摒弃负面禁止词）**：注入 `"Do not read it again"` 属于典型负面禁止词。<br>3. **直接违背 `AGENTS.md` 核心准则 9（全量附件 100% 原始字节保真）**：在 `orchestrator.ts:1078-1114` 中，`read_file` 的 `toolResult.output` 会被 `SubstrateUploader` 直接写入临时文件并上传至 OneDrive 作为源码/文档附件！在 `ToolBridge` 输出末尾拼接 `Notice` 会**直接篡改上传到云端的文件字节内容**！<br>4. **根因错判**：模型之所以反复读取 `plan.md` / `review.md`，根本原因是**上一跳交接文档为 0 字节**（见 F3），导致模型丢失进度锚点而陷入排查循环。 | **彻底废除 `ToolBridge` 连续只读拦截器设计**，保持 `ToolBridge` 100% 原始字节输出与绝对中立。通过修复 F3（0 字节交接门禁）+ 准则 3（清洗提示词与 `handoff` 技能中的负面禁止词，强化交接锚点正向引导）从根源消除空转。 |
| **C1** | 🔴 **理想化假设**<br>（PKCE 换票缓存与协议细节残缺） | §3.1 假设 PKCE 换票后只需提取 `email`、更新 `RefreshToken` 并设 `setCachedToken({ accessToken, expiresAt, email })`。 | 对照 `Library/m365-auth-helper/auth.go` 与 `src/auth/token-manager.ts`：<br>1. `ActiveSessionToken` 接口（`token-manager.ts:16-23`）强制要求 `oid: string` 与 `tid: string`。漏传会导致类型失配及下游依赖 `oid`/`tid` 的组件异常。<br>2. 未同步清理 `TokenManager` 的 `graphTokens` 缓存（`clearCache(email)`），若此前缓存了异常状态会残留。<br>3. 解析 JWT payload 若直接用 `Buffer.from(parts[1], "base64")` 而不做 Base64URL 字符替换（`-`→`+`, `_`→`/`）与 padding 补齐（见 `token-manager.ts:167-177`），遇到特定边界字符会解码失败。<br>4. `StoredAccount`（`token-manager.ts:6-14`）包含 `tenantId`、`userId`、`lastRefresh`、`notes`、`cookies`，换票覆写时若不保留原 `notes`/`cookies` 并更新 `tenantId`/`userId` 会丢失账号资产元数据。 | 1. 严格对齐 `Library/m365-auth-helper/auth.go`：授权 URL 显式包含 `response_mode=query`；JWT 解析复用 Base64URL 标准解码，优先从 `access_token` 提取 `upn / unique_name / preferred_username / email` 及 `oid / tid`，再回退 `id_token`。<br>2. 换票成功后：调用 `tokenManager.clearCache(email)`，填充完整 `ActiveSessionToken`（含 `oid`, `tid`），并在 `saveAccount` 时保留已有账号的 `notes` 与 `cookies`。 |
| **C2** | 🟠 **理想化假设**<br>（目标账号与实际登录账号一致假设） | §3.1 / §3.3 假设用户点击失效账号 A 的「重新授权」时，浏览器返回的一定是账号 A 的凭据。 | 现实中用户的系统浏览器可能已挂着账号 B 的 SSO 会话。若用户在浏览器中直接点了已登录的账号 B 并复制回调 URL：后端从 JWT 解析出的是 B，更新了 B 的 Token，但**账号 A 依然处于 `authExpired: true`**，前端却提示“重登成功”并关闭弹窗，造成严重认知错位。 | `completePkceAuth` 接收可选 `expectedEmail`。当 `expectedEmail && actualEmail.toLowerCase() !== expectedEmail.toLowerCase()` 时：正常保存 `actualEmail` 的新凭据，但返回 `{ email: actualEmail, expectedEmail, emailMismatch: true }`，前端与 CLI 显式告警：“检测到实际登录账号为 B，原目标账号 A 仍处于待重登状态”。 |
| **C3** | 🟠 **理想化假设**<br>（CLI 路由无冲突且无需交互内命令） | §3.4 假设在 `src/cli/args.ts` 里简单识别 `auth` 即可，且只提供独立进程命令 `cph-pi auth login`。 | 1. 实测 `src/cli/args.ts:288-340`：未消费的 `login` 与 `[email]` 会落入 `positional` 数组，被后续逻辑当成工作区目录或 `result.task`！且 `ParsedCliArgs.subcommand` 与 `RunCliResult.mode` 类型需同步扩展。<br>2. 用户在交互式 TUI 运行中途遇到账号过期时，现有 `/accounts` 斜杠命令（`src/cli.ts:1160-1237`）只有 `set|enable|disable|reset`，没有 `login`，若不扩展 `/accounts login [email]`，用户必须中断退回 Shell 才能重登。 | 1. 在 `src/cli/args.ts` 中当识别到 `subcommand === "auth"` 时，精确消费后续 `authAction`（如 `login`）与可选 `[email]` 参数，不推入 `positional`。<br>2. 在交互式 `/accounts` 斜杠命令中同步新增 `/accounts login [email]` 子命令，复用同一套 PKCE 交互流。 |
| **C4** | 🟡 **理想化假设**<br>（回调输入无错误参数与 State 校验边界） | §3.1 假设用户输入要么带 `code=...&state=...`，要么是裸 `code`，且用 `input.includes("://")` 判断是否为 URL。 | 1. 若用户在浏览器授权页点击拒绝或租户拦截，重定向 URL 为 `https://.../nativeclient?error=access_denied&error_description=...`，v1 只报“未找到 code 参数”，吞掉了微软返回的真实 `error_description`。<br>2. 用户可能只复制了查询串 `?code=...&state=...`（不含 `://`），`includes("://")` 会将其误判为裸 `code` 并把整个查询串当成 `code` 发给微软！ | 1. 优先识别输入中的 `error` 与 `error_description` 参数并透传明确错误原因。<br>2. 支持完整 URL、相对查询串（`?code=...` 或含 `code=`）及纯授权码三种格式：凡含 `code=` 均按 URLSearchParams 解析并**强制校验 `state`（若存在）与 `pkceSession.state` 一致**；纯授权码则校验不含空白与 URL 分隔符。 |

---

## 1. 业务背景与问题定义（去修辞核验版）

在对 `2026-10-24T04-37-51-193Z_session.jsonl`（约 127 分钟长程执行日志）进行全链路复盘并与现有代码逐行比对后，确认系统当前存在 4 个需要工程根治的核心问题：

### 1.1 致命鉴权失效（`invalid_grant` / `AADSTS700082`）与临时限流（`429`）状态混淆
* **运行期实测表现**：日志中 `yanhua.he@cma-cgm.com` 与 `stephen.tang@cma-cgm.com` 的 Refresh Token 因过期或会话策略变更返回 HTTP 400 `invalid_grant`（如 `AADSTS700082: The refresh token has expired due to inactivity`）。
* **代码根因**：
  * `AccountPool.acquireSessionLease`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L337-L343)）与 `getNextAvailableToken`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L574-L580)）在 `catch` 块中，将一切 `tokenManager.getAccessToken` 抛出的异常无差别调用 `this.reportThrottle(account.email, undefined, undefined, "auth_error")`。
  * `reportThrottle` 将该账号置为 `isThrottled = true` 并设置 60 秒冷却（`DEFAULT_COOLDOWN_MS = 60_000`）。60 秒到期后，`unthrottleIfExpired()`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L604-L619)）自动将其恢复为可用，引发下一轮必败的 OAuth 刷新请求（整场会话累计产生 399+ 次无效重试）。

### 1.2 跨代接力与内部世代虚拟化的会话租约（Session Lease）泄漏
* **运行期实测表现**：在持续自主接力（Autonomous Handoff）与子代理并发派发后，即便池中仍有健康账号，系统仍频繁误报 `Account pool capacity exhausted`。
* **代码根因**：
  * `Orchestrator.run()`（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L458-L462)）通过 `pool.getNextAvailableToken({ sessionId: this.sessionId })` 为当前会话绑定独占租约（写入 `AccountPool.sessionLeases` 与 `status.activeBySessions`）。
  * 当 `Orchestrator.run()` 因原生 `handoff`、轮次耗尽 `handoff`、异常容灾仲裁或正常结束退出时，**既没有在 `Orchestrator` 内部释放旧 `sessionId` 租约，也没有在 `RpcHandler`（[`src/web/rpc-handler.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/web/rpc-handler.ts#L1460-L1540)）或 `CLI`（[`src/cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts#L1474-L1500)）的接力循环中调用 `pool.releaseSessionLease(oldSessionId)`**。
  * 此外，`Orchestrator` 内部世代虚拟化（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L949-L968)）在切换至 `nextSessionId` 时未释放前代租约，且调用 `getNextAvailableToken` 时漏传了 `sessionId: nextSessionId`。
  * 同时，Web 端在跨代接力创建 `newSessionId` 时未向前端广播 `session:created`，且未调用 `this.orchestrator.resetHandshake()`，造成前端会话列表脱节与握手状态残留。

### 1.3 PKCE 原生刷新能力缺失与手工提取 Token 链路繁琐
* **现状痛点**：仓库参考目录 [`Library/m365-auth-helper/auth.go`](file:///e:/copilot-web%20proxy/Library/m365-auth-helper/auth.go#L1-L255) 已验证了完整的 Azure AD v2.0 + PKCE（S256）原生客户端（Client ID `d3590ed6-52b3-4102-aeff-aad2292ab01c`）换票流程，支持复制授權 URL 到任意浏览器登录并粘贴回调 URL 秒级换取全新 `RefreshToken` + `AccessToken`。但 `CPH-PI` 尚未内建该能力，且 Web 端的「重置冷却」按钮因调用不存在的 `this.pool.resetCooldown`（[`src/web/rpc-handler.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/web/rpc-handler.ts#L1813)）处于断线状态。

### 1.4 0 字节交接文档（`handoff-ses_...md`）导致跨代接力丢失锚点
* **运行期实测表现**：在 Session 3 → Session 4 接力时，`.cph/handoff-ses_1776999453887_j6v6n.md` 在磁盘上为 **0 字节**。继任会话读取到空文件后丢失前序任务进度，只能在工作区反复读取 `plan.md` 与 `review.md` 试图重建上下文。
* **代码根因**：
  1. [`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L850-L859)：当模型输出空 ` ```handoff\n``` ` 块时，`parsed.handoffDoc` 为 `""`，第 857 行 `fs.writeFileSync(docPath, parsed.handoffDoc, "utf8")` 未做任何长度校验，直接将 0 字节写入磁盘并跳过 `generateHandoffSnapshot`。
  2. [`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L2147-L2169)：容灾仲裁会话（Session B）若创建了 0 字节交接文件，第 2154 行 `if (!fs.existsSync(targetHandoffAbsolutePath))` 因文件已存在而跳过 `disasterBlackbox` 兜底写入，第 2167 行直接读出空字符串 `""` 作为最终交接内容。

---

## 2. 现状盘点（已存在 / 认知偏差 / 真实缺口）

### 2.1 仓库中已存在的基础设施（直接复用，避免重复造轮子）
1. **AES-256-GCM 凭据加密存储**：[`src/auth/crypto.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/crypto.ts#L1-L74) 与 `TokenManager.saveAccount`（[`src/auth/token-manager.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/token-manager.ts#L60-L120)）已实现基于机器指纹的 `~/.cph-pi/accounts.enc` 加密读写与原子覆写。
2. **Base64URL JWT 解析逻辑**：[`src/auth/token-manager.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/token-manager.ts#L164-L185) 的 `extractJwtClaims` 已实现标准的 Base64URL 转码与 padding 补齐，可直接提升为公共辅助函数供 PKCE 模块复用。
3. **预写式执行账本（Execution Ledger）**：[`src/agent/execution-ledger.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/execution-ledger.ts#L24-L165) 已在 `.cph/state/execution-ledger.jsonl` 与 `.cph/state/execution-ledger.md` 中实时持久化所有工具调用事实，且 `Orchestrator.generateHandoffSnapshot`（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1314-L1385)）已实现从 `this.ledger` 提取工具轨迹生成结构化 Markdown 快照。
4. **Go 版 PKCE 生产级参考实现**：[`Library/m365-auth-helper/auth.go`](file:///e:/copilot-web%20proxy/Library/m365-auth-helper/auth.go#L1-L255) 已完整验证了 `CLIENT_ID`、`REDIRECT_URI`、`SCOPE`、S256 挑战码生成、回调 URL 解析及双 Token（`access_token` 优先、`id_token` 兜底）身份提取逻辑。

### 2.2 必须坚守的架构治理红线（对齐 `AGENTS.md`）
* **红线 1（准则 1：Harness 纯粹与中立原则）**：`ToolBridge` 只负责客观执行工具与返回 100% 原始结果，**绝不在 `ToolBridge` 中植入 `lastReadRecord` 连续读取计数器或向工具输出文本拼接主观警告 `Notice: ...`**。
* **红线 2（准则 3：正向引导铁律，摒弃负面禁止词）**：系统提示词（`cph-main-agent-prompt.txt`、`prompt-builder.ts`）与 `CPH-PI/skills/handoff/SKILL.md` 的修订必须全部采用建设性正向陈述，消除 `"严禁"`、`"禁止"`、`"切勿"`、`"不要"`、`"Do not"`、`"Never"` 等负面词汇。
* **红线 3（准则 5：用户全局配置隔离与工作区打包分发规范）**：严禁触碰 `C:\Users\UserX\...` 全局技能目录；仅修改工作区内的 `CPH-PI/skills/handoff/SKILL.md` 与提示词文件，并同步更新 `CPH-PI/dist-agent-bundle/` 下的分发制品。
* **红线 4（准则 9：全量附件投递与 100% 原始字节保真）**：保持 `read_file` 返回内容零篡改，确保 `SubstrateUploader` 上传至 OneDrive 的附件与磁盘文件字节完全一致。

---

## 3. 详细设计与实现规格（修正后）

### 3.1 模块一：OAuth2 PKCE 原生重登引擎（`src/auth/pkce-auth.ts` & `src/auth/token-manager.ts`）

#### 3.1.1 协议常量（严格对齐 `Library/m365-auth-helper/auth.go`）
在 [`src/auth/pkce-auth.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/pkce-auth.ts) 中定义标准常量：
* `CLIENT_ID`: `"d3590ed6-52b3-4102-aeff-aad2292ab01c"`（Microsoft Office 公共客户端 ID）
* `REDIRECT_URI`: `"https://login.microsoftonline.com/common/oauth2/nativeclient"`
* `AUTH_ENDPOINT`: `"https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize"`
* `TOKEN_ENDPOINT`: `"https://login.microsoftonline.com/organizations/oauth2/v2.0/token"`
* `SCOPE`: `"https://substrate.office.com/sydney/.default openid profile offline_access"`
* `PKCE_SESSION_TTL_MS`: `10 * 60 * 1000`（10 分钟有效期，超时自动失效清理）

#### 3.1.2 核心数据结构与方法契约
```typescript
export interface PkceSession {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authUrl: string;
  targetEmail?: string;
  createdAt: number;
  expiresAt: number;
}

export interface PkceTokenResponse {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  email: string;
  oid: string;
  tid: string;
}
```

1. **`generatePkceSession(targetEmail?: string): PkceSession`**
   * `codeVerifier`：`crypto.randomBytes(32)` 经 Base64URL 编码（43 字符，无 `=` 号）。
   * `codeChallenge`：`crypto.createHash("sha256").update(codeVerifier).digest()` 经 Base64URL 编码。
   * `state`：`crypto.randomBytes(16).toString("hex")`。
   * `authUrl` 参数集合：
     * `client_id`: `CLIENT_ID`
     * `response_type`: `"code"`
     * `redirect_uri`: `REDIRECT_URI`
     * `scope`: `SCOPE`
     * `code_challenge`: `codeChallenge`
     * `code_challenge_method`: `"S256"`
     * `state`: `state`
     * `prompt`: `"select_account"`
     * `response_mode`: `"query"`（对齐 `auth.go:55`）
     * 若传入非空 `targetEmail`，附加 `login_hint: targetEmail.trim()`。

2. **`extractCodeFromRedirectInput(redirectUrlOrCode: string, expectedState?: string): { code: string; state?: string }`**
   * **错误参数先行拦截**：若输入包含 `error=`（例如用户点击拒绝或被 Conditional Access 拦截），解析 `error` 与 `error_description` 并立即抛出可读错误：`new Error(\`Azure AD authorization failed (${error}): ${decodeURIComponent(errorDescription)}\`)`。
   * **多格式兼容解析**：
     * 若输入包含 `://`、以 `?` 开头或包含 `code=` 查询键值对：提取查询串并通过 `URLSearchParams` 解析 `code` 与 `state`。
     * 若输入中带有 `#` fragment（如 `code=...#`），在解析前剥离 `#` 及其后缀。
     * **强制 CSRF State 校验**：若传入了 `expectedState` 且解析出了查询参数中的 `state`，当 `state !== expectedState` 时立即抛出 `new Error("PKCE state mismatch: the callback URL does not match the active authorization session")`。
     * 若输入为纯授权码字符串（不含 `://`、`?`、`&`、`=` 及空白字符）：直接作为 `code` 返回。
     * 若最终 `code` 为空，抛出 `new Error("No authorization code found in the provided input")`。

3. **`exchangeCodeForTokens(code: string, codeVerifier: string): Promise<PkceTokenResponse>`**
   * 向 `TOKEN_ENDPOINT` 发送 `POST`（`application/x-www-form-urlencoded`），请求体对齐 `auth.go:130-136`：
     * `client_id`: `CLIENT_ID`
     * `grant_type`: `"authorization_code"`
     * `code`: `code`
     * `redirect_uri`: `REDIRECT_URI`
     * `code_verifier`: `codeVerifier`
   * 校验响应：必须包含非空 `access_token` 与 `refresh_token`。
   * **双 Token 身份提取（对齐 `auth.go:100-118` 与 `token-manager.ts:164-185`）**：
     * 使用标准 Base64URL 解码函数依次解析 `access_token` 与 `id_token` 的 JWT Payload。
     * `email` 提取优先级：`accessClaims.upn || accessClaims.unique_name || accessClaims.preferred_username || accessClaims.email || idClaims.preferred_username || idClaims.upn || idClaims.unique_name || idClaims.email`。若仍为空且调用方未提供兜底标识，抛出明確异常而非静默写入 `"unknown@m365.local"`。
     * `oid` 提取：`accessClaims.oid || idClaims.oid || "unknown"`。
     * `tid` 提取：`accessClaims.tid || idClaims.tid || "unknown"`。

4. **`TokenManager` 缓存清理与无损持久化扩展（[`src/auth/token-manager.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/token-manager.ts)）**
   * 新增 `setCachedToken(email: string, token: ActiveSessionToken): void`：归一化 `email.toLowerCase()` 后写入 `this.activeTokens`，并同步清除 `this.graphTokens.delete(email.toLowerCase())`（确保后续 OneDrive 附件上传使用新 RefreshToken 派生 Graph Token）。
   * 新增 `upsertAccountFromPkce(pkceRes: PkceTokenResponse): StoredAccount`：读取现有账号列表，若已存在同邮箱账号，**完整保留其原有的 `notes` 与 `cookies`**，更新 `refreshToken`、`tenantId: pkceRes.tid`、`userId: pkceRes.oid`、`lastRefresh: new Date().toISOString()`，加密写回 `accounts.enc` 并更新内存缓存。

---

### 3.2 模块二：`AccountPool` 鉴权失效精准分流與租约生命周期治理（`src/auth/account-pool.ts`）

#### 3.2.1 `AccountStatus` 扩展字段
在 [`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L19-L36) 的 `AccountStatus` 接口中新增：
```typescript
export interface AccountStatus {
  // ... 现有字段保持不变 ...
  /** 标记该账号是否因 OAuth Refresh Token 过期/吊销/需交互验证而处于持久挂起状态 */
  authExpired?: boolean;
  /** 鉴权失效的具体错误原因摘要（用于 UI / CLI 诊断展示） */
  authErrorReason?: string;
}
```

#### 3.2.2 致命鉴权错误判定函数 `isFatalAuthGrantError(err: unknown): boolean`
判定规则（大小写不敏感匹配 `err.message`）：
* 包含 `"invalid_grant"` 或 `"interaction_required"`
* 或包含以下需人工重登的 Azure AD 错误码：
  * `AADSTS700082`（Refresh token expired due to inactivity）
  * `AADSTS70008`（Provided authorization code or refresh token has expired）
  * `AADSTS50173`（Fresh authentication needed / password changed）
  * `AADSTS50076` / `AADSTS50079`（MFA required by tenant policy）
  * `AADSTS50058`（Silent sign-in request was sent but no user is signed in）
  * `AADSTS70000`（Grant is invalid or malformed）

#### 3.2.3 永久隔离挂起与选号/容量全链路门禁（修复 F1 & F2）
1. **新增 `markAuthExpired(email: string, reason: string): void`**：
   * 定位目标账号 `status`：
     * `status.authExpired = true`
     * `status.authErrorReason = reason.slice(0, 300)`
     * `status.isAvailable = false`
     * `status.isThrottled = false`
     * `status.cooldownUntil = 0`
     * `status.throttleReason = "auth_error"`
   * 立即清理该账号关联的所有残留会话租约（遍历 `this.sessionLeases`，移除指向该 `email` 的键并清空 `status.activeBySessions`）。
   * 输出一条清晰告警日志：`[AccountPool] 🔒 账号 ${email} 刷新凭据已失效 (${reason.slice(0, 120)})，已挂起隔离，请通过 PKCE 重新授权。`

2. **在全部 4 处选号与容量入口施加统一门禁**：
   * `getAvailableCapacity()`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L248-L264)）：
     ```typescript
     if (status.authExpired || !status.isAvailable || status.isThrottled) continue;
     ```
   * `acquireSessionLease()`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L305-L345)）：
     * 既有租约复用检查（L291）：须满足 `existing && !existing.isThrottled && !existing.authExpired && existing.isAvailable`。
     * 轮询循环（L313）：`if (status.authExpired || !status.isAvailable || status.isThrottled) continue;`
     * `catch (err)` 分流（L337）：若 `isFatalAuthGrantError(err)` 为真，调用 `this.markAuthExpired(account.email, errMsg)`；否则维持原有 `this.reportThrottle(...)` 60 秒临时退避。
   * `getNextAvailableToken()`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L542-L582)）：
     * 轮询循环（L550）：`if (status.authExpired || !status.isAvailable || status.isThrottled) continue;`
     * `catch (err)` 分流（L574）：同样区分 `isFatalAuthGrantError(err)` -> `this.markAuthExpired(...)` 与普通异常 -> `this.reportThrottle(...)`。
   * `getGraphAccessToken()`（[`src/auth/account-pool.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/auth/account-pool.ts#L687-L698)）：
     * 废弃盲取 `(this.currentIndex - 1)` 的脆弱写法，改为从 `this.currentIndex - 1` 开始遍历寻找首个 `!status.authExpired && !status.isThrottled && status.isAvailable` 的账号获取 Graph Token；若捕获 `isFatalAuthGrantError(err)`，调用 `this.markAuthExpired` 并继续尝试下一个健康账号。
   * `SubagentRunner.executeBatch`（[`src/agent/subagent-runner.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/subagent-runner.ts#L219-L221)）：
     * 优先调用 `this.pool.getAvailableCapacity()`，或在过滤 `getPoolStatus()` 时统一检查 `!a.isThrottled && !a.authExpired && a.isAvailable`。

3. **修复 `resetCooldown` 方法缺失（修复 F6）**：
   * 在 `AccountPool` 中新增 `resetCooldown(email: string): boolean`：
     * 若目标账号处于 `status.authExpired === true`，拒绝通过普通重置冷却恢复（返回 `false` 并记录提示：需完成 PKCE 重新授权方可恢复），防止用户在 UI 误点「重置冷却」把凭据已死账号重新放回调度池。
     * 若非 `authExpired`，委托调用 `this.unthrottle(email)` 并返回 `true`。

4. **内建 PKCE 生命周期管理方法**：
   * 在 `AccountPool` 中维护 `private pkceSessions = new Map<string, PkceSession>()`。
   * `startPkceAuth(targetEmail?: string): { authUrl: string; state: string; expiresAt: number }`：清理过期 PKCE 会话后生成并缓存新 `PkceSession`。
   * `completePkceAuth(redirectUrlOrCode: string, state?: string, expectedEmail?: string): Promise<{ email: string; expectedEmail?: string; emailMismatch: boolean }>`：
     * 定位 `PkceSession`（按传入 `state` 查找，若用户粘贴的是完整 URL 则从 URL 提取 `state` 查找，若粘贴裸 `code` 且未传 `state` 则取最近一个未过期的 `PkceSession`）。
     * 调用 `extractCodeFromRedirectInput` 与 `exchangeCodeForTokens`。
     * 调用 `this.tokenManager.upsertAccountFromPkce(tokenRes)` 与 `this.tokenManager.setCachedToken(...)`。
     * 在 `this.accounts` 中更新或追加账号，并将对应 `actualEmail` 的 `AccountStatus` 恢复为：
       * `authExpired = false`
       * `authErrorReason = undefined`
       * `isAvailable = true`
       * `isThrottled = false`
       * `cooldownUntil = 0`
       * `throttleReason = undefined`
     * **账号错位检测（修复 C2）**：检查 `const target = expectedEmail || pkceSession.targetEmail`。若 `target && target.toLowerCase() !== tokenRes.email.toLowerCase()`，返回 `{ email: tokenRes.email, expectedEmail: target, emailMismatch: true }`（绝不错误清除 `target` 账号的 `authExpired` 标志）。

---

### 3.3 模块三：跨代接力租约释放、握手重置与 Web UI 闭环（修复 F4, F5, F6）

#### 3.3.1 全链路会话租约对称释放与世代虚拟化修复
1. **`Orchestrator` 内部世代虚拟化（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L949-L968)）**：
   * 在主会话虚拟化切换 `this.sessionId = nextSessionId` 前，先保存 `const prevSessionId = this.sessionId` 并调用 `this.pool.releaseSessionLease(prevSessionId)`。
   * 第 966 行申请继任代 Token 时，显式传入 `sessionId: nextSessionId`：
     ```typescript
     const tokenObj = await this.pool.getNextAvailableToken({
       sessionId: nextSessionId,
       ...(this.customAgentId ? { forAgentId: this.customAgentId } : {}),
     });
     ```
2. **`Orchestrator.run()` 退出时的租约释放兜底**：
   * 在 `Orchestrator.run()` 的外层 `try ... finally` 中（或当进入 `executeDisasterRecoveryArbitration` 及 `run()` 返回前），确保释放当前 `this.sessionId` 占用的会话租约 `this.pool.releaseSessionLease(this.sessionId)`，使无论是 Web 还是 CLI 模式，单跳会话结束时都不会遗留僵尸租约。
3. **`RpcHandler` 自主接力循环（[`src/web/rpc-handler.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/web/rpc-handler.ts#L1455-L1540)）**：
   * 在每跳 `await this.orchestrator.run(currentText)` 的 `finally` 中调用 `this.pool.releaseSessionLease(currentSessionId)`。
   * 当触发 `result.handoff && result.handoffDocPath` 创建 `newSessionId` 时：
     1. 调用 `this.orchestrator.resetHandshake()`（修复 F4：清除上一代残留的 `conversationId`，与 [`src/cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts#L1491) 保持严格一致）。
     2. 立即向前端广播 `this.broadcast("session:created", newMeta)`，使 Web 侧边栏实时挂载新接力会话。
     3. 在下一跳 `turn:start` 广播载荷中附带 `activeSessionId: currentSessionId`。

#### 3.3.2 Web RPC 协议扩展与前端 `AccountDialog.tsx` / `store.ts` 对齐
1. **RPC 路由新增（[`src/web/rpc-handler.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/web/rpc-handler.ts#L315-L345)）**：
   * `account:pkce_start`：调用 `this.pool.startPkceAuth(payload?.email)`，返回 `{ type: "account:pkce_started", data: { authUrl, state, expiresAt, targetEmail: payload?.email } }`。
   * `account:pkce_complete`：调用 `this.pool.completePkceAuth(payload.redirectUrl, payload.state, payload.expectedEmail)`，成功后调用 `this.broadcastAccountStatus()`，并返回 `{ type: "account:pkce_completed", data: { email, expectedEmail, emailMismatch } }`；失败时返回 `{ type: "account:pkce_error", data: { message: err.message } }`。
2. **前端 Store 状态同步（[`web/src/services/store.ts`](file:///e:/copilot-web%20proxy/CPH-PI/web/src/services/store.ts)）**：
   * 扩展前端 `AccountInfo` 接口，增加 `authExpired?: boolean` 与 `authErrorReason?: string`。
   * 在 `turn:start` 事件处理器中，若 `data?.activeSessionId` 存在且与当前 `s.activeSessionId` 不同，更新 **`activeSessionId: data.activeSessionId`**（严禁使用不存在的 `currentSessionId` 字段）。
   * 监听 `account:pkce_started`、`account:pkce_completed`、`account:pkce_error` 事件，驱动弹窗状态流转。
3. **前端 `AccountDialog.tsx` 交互重构（[`web/src/components/layout/AccountDialog.tsx`](file:///e:/copilot-web%20proxy/CPH-PI/web/src/components/layout/AccountDialog.tsx)）**：
   * **状态徽章三态区分**：
     * `account.authExpired === true`：展示深红/紫色徽章 `凭据已过期 (需重登)`，悬浮或副标题展示 `authErrorReason`，操作区显示高亮的「🔑 重新授权」按钮（隐藏无效的「重置冷却」按钮）。
     * `account.isThrottled === true`（且 `!account.authExpired`）：展示琥珀色徽章 `冷却中 (${remainingSec}s)`，保留「重置冷却」按钮。
     * 正常状态：展示翠绿色徽章 `正常 (活跃: ${activeSessionsCount})`。
   * **内嵌式「OAuth PKCE 快捷授权」两步面板**：
     * 点击「🔑 重新授权」或底部「⚡ OAuth 快捷登录 / 新增账号」后展开：
     * **Step 1**：展示生成的 `authUrl`，提供「📋 一键复制授权链接」按钮与 `<a href={authUrl} target="_blank" rel="noopener noreferrer">🌐 在新标签页打开</a>` 链接。
     * **Step 2**：提供输入框（支持粘贴完整 `https://login.microsoftonline.com/common/oauth2/nativeclient?code=...` URL 或授权码）与「完成验证」按钮。
     * 若后端返回 `emailMismatch: true`，在界面展示醒目黄底提示：`已成功更新账号 ${email} 的凭据，但与原定目标账号 ${expectedEmail} 不一致，原账号仍需单独授权。`

---

### 3.4 模块四：CLI 独立子命令与交互内 `/accounts login` 双轨支持（修复 C3）

1. **CLI 启动参数解析（[`src/cli/args.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli/args.ts#L280-L340)）**：
   * 扩展 `ParsedCliArgs` 接口：
     ```typescript
     subcommand?: "web" | "auth";
     authAction?: "login";
     authTargetEmail?: string;
     ```
   * 在 `parseCliArgs` 中，当首个非 flag 参数为 `"auth"` 时：
     * 设 `result.subcommand = "auth"`。
     * 消费下一个参数作为 `authAction`（默认 `"login"`），若再下一个参数非 `--` 开头则消费为 `result.authTargetEmail`，**不将它们推入 `positional` 数组**（避免被误判为工作区目录或 `result.task`）。
2. **CLI 独立执行流（[`src/cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts)）**：
   * `RunCliResult.mode` 联合类型扩展 `"auth"`。
   * 当 `parsed.subcommand === "auth"` 时，执行 `runCliPkceAuthFlow(pool, parsed.authTargetEmail)`：
     * 打印分隔线与完整授权 URL。
     * 通过 `readline` 提示用户粘贴重定向 URL 或授权码。
     * 调用 `pool.completePkceAuth(input, session.state, parsed.authTargetEmail)`。
     * 打印验证成功的邮箱（若 `emailMismatch` 则打印黄色提醒）并正常退出。
3. **TUI 交互内斜杠命令扩展（[`src/cli.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts#L1160-L1237)）**：
   * 在 `/accounts` 命令中新增 `login [email]` 子分支（即 `/accounts login` 或 `/accounts login user@contoso.com`），允许用户在长会话暂停间隙无需退出 CLI 进程即可原位完成 PKCE 重登。
   * 在 `/accounts` 列表渲染中，对 `acc.authExpired` 的账号打印 `🔒 凭据过期 (需执行 /accounts login ${acc.email})`。

---

### 3.5 模块五：0 字节交接文档硬门禁与正向认知塑形（修复 F3 & B1）

#### 3.5.1 0 字节交接文档双点封堵（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts)）
1. **封堵点 A：模型内联 `handoff` 块落盘门禁（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L850-L879)）**
   * 原逻辑在 `if (parsed.handoffDoc)`（甚至当 `parsed.handoffDoc.trim()` 极短或为空白时）直接 `writeFileSync` 而不校验有效载荷长度。
   * **修正逻辑**：
     ```typescript
     const inlineHandoffText = (parsed.handoffDoc || "").trim();
     if (inlineHandoffText.length >= 50) {
       docPath = path.join(this.workspaceDir, ".cph", `handoff-${this.sessionId}.md`);
       const dir = path.dirname(docPath);
       if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
       fs.writeFileSync(docPath, inlineHandoffText, "utf8");
     } else {
       // 若模型未附带有效内联正文，且磁盘上已有工具写入的同名文件但不足 50 字符，先予清除以触发账本兜底合成
       const candidatePath = path.join(this.workspaceDir, ".cph", `handoff-${this.sessionId}.md`);
       if (fs.existsSync(candidatePath)) {
         const existingText = fs.readFileSync(candidatePath, "utf8").trim();
         if (existingText.length < 50) {
           try { fs.unlinkSync(candidatePath); } catch {}
         }
       }
       docPath = await this.generateHandoffSnapshot(turnCount, "autonomous_handoff");
     }
     ```
2. **封堵点 B：容灾仲裁 Session B 产物门禁（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L2147-L2169)）**
   * 原逻辑仅检查 `if (!fs.existsSync(targetHandoffAbsolutePath))`，若存在 0 字节文件则跳过兜底。
   * **修正逻辑**：
     ```typescript
     const existingArbitrationDoc = fs.existsSync(targetHandoffAbsolutePath)
       ? fs.readFileSync(targetHandoffAbsolutePath, "utf8").trim()
       : "";
     if (existingArbitrationDoc.length < 50) {
       fs.writeFileSync(targetHandoffAbsolutePath, disasterBlackbox, "utf8");
     }
     const finalDocContent = fs.readFileSync(targetHandoffAbsolutePath, "utf8");
     ```
3. **增强 `generateHandoffSnapshot` 的结构化账本指纹（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1314-L1385)）**：
   * 当触发兜底合成时，不仅从内存 `this.ledger.getRecentEntries(15)` 提取记录，若内存账本为空还主动回退读取磁盘 `.cph/state/execution-ledger.jsonl` 的尾部记录（真实路径，非幻觉路径 `wal.jsonl`），并在生成的交接文档头部注入明确的「已完成事实摘要与下一跳直达行动锚点」，确保继任会话拿到交接文档即可立即推进，无需在工作区盲目重读文件。

#### 3.5.2 保持 `ToolBridge` 100% 纯粹中立（彻底移除 v1 的拦截器方案）
* **不对 [`src/protocol/tool-bridge.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/tool-bridge.ts) 做任何主观提示词拼接或连续只读计数拦截**。
* `read_file` 的输出维持 100% 原始文件字节，保障 OneDrive 附件上传链路（[`src/agent/orchestrator.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1078-L1114)）零污染。

#### 3.5.3 系统提示词与工作区 `handoff` 技能正向引导审计（遵循 `AGENTS.md` 准则 3 & 5）
* 审查并更新以下工作区文件（严禁修改用户全局目录）：
  * [`CPH-PI/cph-main-agent-prompt.txt`](file:///e:/copilot-web%20proxy/CPH-PI/cph-main-agent-prompt.txt)
  * [`CPH-PI/src/protocol/prompt-builder.ts`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/prompt-builder.ts)
  * [`CPH-PI/skills/handoff/SKILL.md`](file:///e:/copilot-web%20proxy/CPH-PI/skills/handoff/SKILL.md)
* **正向引导改造重点**：
  1. 在 `CPH-PI/skills/handoff/SKILL.md` 中明确：发起 `handoff` 时，先通过 `write_file` 将包含「已完成变更清单、验证结果、下一跳首个具体动作」的完整交接文档写入 `.cph/handoff-<sessionId>.md`（或在 `handoff` 代码块内输出完整交接正文），确保继任会话开局即拥有完备锚点。
  2. 在 `cph-main-agent-prompt.txt` 与 `prompt-builder.ts` 的接力恢复引导中，引导继任 Agent 信任交接文档与 `.cph/state/execution-ledger.md` 中已确认的事实，对已读取过的文件直接基于上下文记忆推进修改与验证。
  3. 全面排查并替换任何残留的负面禁止词（`严禁`、`禁止`、`切勿`、`不要`、`绝不`），并同步更新 `CPH-PI/dist-agent-bundle/` 下的打包产物。

---

## 4. 验证矩阵（目标 + 当前实测状态）

| 验证维度 | 验证命令 / 测试文件 | 关键断言指标 | 基线状态 |
| :--- | :--- | :--- | :--- |
| **PKCE 协议与双 Token 解析单元测试** | `bun test tests/pkce-auth.test.ts` | 1. `generatePkceSession` 产出的 `codeVerifier` 为 43 字符 Base64URL，`codeChallenge` 符合 S256 标准，`authUrl` 含 `response_mode=query` 与 `login_hint`。<br>2. `extractCodeFromRedirectInput` 支持完整回调 URL、查询串、裸 `code`；遇到 `?error=access_denied` 抛出可读错误；当 `state` 不匹配时抛出 CSRF 异常。<br>3. `exchangeCodeForTokens` 支持 Base64URL 边界字符解码，优先从 `access_token` 提取 `upn/unique_name` 及 `oid/tid`，回退 `id_token`。 | 待新增 |
| **AccountPool 鉴权挂起与容量隔离测试** | `bun test tests/account-pool-auth-expiry.test.ts` | 1. 模拟 `AADSTS700082` / `invalid_grant` / `AADSTS50076` 时，`status.authExpired === true`、`status.isAvailable === false`、`status.isThrottled === false`。<br>2. **核心防反噬断言**：处于 `authExpired` 的账号在 `acquireSessionLease`、`getNextAvailableToken`、`getGraphAccessToken` 与 `getAvailableCapacity` 中被 100% 跳过，绝不触发二次 `getAccessToken` 调用。<br>3. `resetCooldown(email)` 对 `authExpired` 账号返回 `false`，不错误恢复可用；唯有 `completePkceAuth` 成功后才恢复 `authExpired = false, isAvailable = true`。<br>4. 当 `expectedEmail` 与实际登录邮箱不一致时返回 `emailMismatch: true`，且不清除原目标账号的 `authExpired`。 | 待新增 |
| **跨代接力租约释放与 0 字节门禁测试** | `bun test tests/orchestrator-handoff-lease.test.ts` | 1. 模拟连续 3 代接力，验证每代退出及内部世代虚拟化时旧 `sessionId` 的租约均从 `sessionLeases` 中清除，新代 `nextSessionId` 正常建立新租约。<br>2. 模拟模型输出空 ` ```handoff\n``` ` 块或 0 字节文件，验证最终落盘的 `.cph/handoff-ses_*.md` 强制由 `generateHandoffSnapshot` 合成且长度 `>= 50` 字节。<br>3. 验证容灾仲裁 Session B 产出 0 字节文件时强制回退写入 `disasterBlackbox`。 | 待新增 |
| **正向提示词零负面词合规扫描** | `bun test tests/prompt-positive-guidance.test.ts` | 扫描 `cph-main-agent-prompt.txt`、`src/protocol/prompt-builder.ts`、`CPH-PI/skills/handoff/SKILL.md` 及 `dist-agent-bundle`，断言零负面禁止词且 `ToolBridge` 无主观 `Notice` 注入。 | 待新增 |
| **全量回归测试套件与前端构建** | `bun test --timeout 15000` & `cd web && bun run build` | 现有 **102 个测试文件、789 个测试用例（3588 个断言）** 100% 通过，新增测试全部通过，前端 TypeScript 编译与 Vite 打包零报错。 | 789 pass / 0 fail |

---

## 5. 实施顺序与准入条件

1. **Step 1：PKCE 鉴权核心模块与 `TokenManager` 扩展**
   * 新建 `src/auth/pkce-auth.ts`，扩展 `src/auth/token-manager.ts`（`setCachedToken`、`upsertAccountFromPkce`），编写 `tests/pkce-auth.test.ts`。
2. **Step 2：`AccountPool` 状态机分流、全入口门禁与 PKCE 集成**
   * 修改 `src/auth/account-pool.ts` 与 `src/agent/subagent-runner.ts`，补齐 `isFatalAuthGrantError`、`markAuthExpired`、四大选号/容量入口门禁、`resetCooldown` 以及 `startPkceAuth` / `completePkceAuth`，编写 `tests/account-pool-auth-expiry.test.ts`。
3. **Step 3：跨代接力租约对称释放、0 字节交接硬门禁与握手重置**
   * 修改 `src/agent/orchestrator.ts`（L854 空块门禁、L966 世代虚拟化租约、L2154 仲裁 0 字节门禁、`run()` 租约释放兜底）与 `src/web/rpc-handler.ts`（接力循环 `releaseSessionLease`、`resetHandshake`、`session:created` 广播、PKCE RPC 路由），编写 `tests/orchestrator-handoff-lease.test.ts`。
4. **Step 4：Web 前端状态对齐与 PKCE 交互弹窗 + CLI 双轨命令**
   * 修改 `web/src/services/store.ts`（修复 `activeSessionId` 同步与 PKCE 状态）、`web/src/components/layout/AccountDialog.tsx`、`src/cli/args.ts` 与 `src/cli.ts`（`cph-pi auth login [email]` 与 `/accounts login [email]`）。
5. **Step 5：提示词与 `handoff` 技能正向引导重构及分发包同步**
   * 更新 `CPH-PI/cph-main-agent-prompt.txt`、`CPH-PI/src/protocol/prompt-builder.ts`、`CPH-PI/skills/handoff/SKILL.md`，同步打包至 `CPH-PI/dist-agent-bundle/`，执行全量测试与前端构建验证。

---

## 附录 A：事实核验记录（Codebase Fact-Check Ledger）

1. **`Library/m365-auth-helper/auth.go` 对照核验**：
   * L18-24：`ClientID = "d3590ed6-52b3-4102-aeff-aad2292ab01c"`，`RedirectURI = "https://login.microsoftonline.com/common/oauth2/nativeclient"`，`Scope = "https://substrate.office.com/sydney/.default openid profile offline_access"`。
   * L55：显式设置 `v.Set("response_mode", "query")`。
   * L100-118：优先解析 `AccessToken` 提取 `unique_name / upn / preferred_username / email`，失败时回退解析 `IDToken`。
2. **`CPH-PI/src/auth/account-pool.ts` 对照核验**：
   * L248-264：`getAvailableCapacity()` 仅检查 `if (status.isThrottled) continue;`，未检查 `status.isAvailable` 或 `status.authExpired`。
   * L305-345：`acquireSessionLease()` 仅检查 `if (status.isThrottled) continue;`，异常块 L337 统一调用 `this.reportThrottle(..., "auth_error")`。
   * L430：`unthrottle(email: string)` 为真实方法名，不存在 `resetCooldown` 方法。
   * L542-582：`getNextAvailableToken()` 仅检查 `if (status.isThrottled) continue;`。
   * L687-698：`getGraphAccessToken()` 未检查 `isThrottled` 或 `authExpired`。
3. **`CPH-PI/src/agent/orchestrator.ts` 对照核验**：
   * L850-859：原生 `handoff` 分支在 `if (parsed.handoffDoc)` 分支外或空字符串时未设 `>= 50` 长度门槛，L857 直接 `fs.writeFileSync(docPath, parsed.handoffDoc, "utf8")`。
   * L949-968：主会话世代虚拟化切换 `this.sessionId = nextSessionId` 时未释放旧租约，L966 `getNextAvailableToken` 未传 `sessionId: nextSessionId`。
   * L1319：`generateHandoffSnapshot` 已存在 `if (existingDoc.length > 50) return docPath;`。
   * L2154-2167：`executeDisasterRecoveryArbitration` 仅检查 `!fs.existsSync(targetHandoffAbsolutePath)`，对已存在的 0 字节文件未触发 `disasterBlackbox` 覆写。
4. **`CPH-PI/src/web/rpc-handler.ts` & `web/src/services/store.ts` 对照核验**：
   * `rpc-handler.ts:1460-1540`：自主接力循环未调用 `this.pool.releaseSessionLease(currentSessionId)`，也未调用 `this.orchestrator.resetHandshake()`。
   * `rpc-handler.ts:1813`：调用了不存在的 `this.pool.resetCooldown(payload.email)`。
   * `store.ts:499`：当前活动会话字段名为 `activeSessionId`，不存在 `currentSessionId`。

