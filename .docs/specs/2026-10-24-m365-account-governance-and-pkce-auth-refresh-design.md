# M365 账号治理自治增强与交互式 PKCE 凭据刷新体系技术规范设计

- **日期**: 2026-10-24
- **状态**: ✅ 已批准设计 (Approved Design)
- **关联变更请求**: CR-2026-10-24-01
- **目标组件**: CPH-PI Runtime Engine (`src/auth/`, `src/agent/`, `src/web/`, `src/transport/`, `web/`)

---

## 1. 业务背景与问题定义

在长程自主接力任务及实际多账号运行中，发现了 5 项连锁影响自治可靠性的架构缺陷：

1. **账号租约跨代泄漏导致第 6 跳锁死 (`ALL_ACCOUNTS_LEASED`)**：
   `AccountPool` 在单轮会话中通过 `acquireSessionLease` 独占账号，但在自动触发跨会话交接（Auto-Handoff）及会话完成时，未显式调用 `releaseSessionLease` 释放前序会话租约。随着代际迭代（第 1 代至第 5 代），账号池内全部可用账号均被已结束的历史会话永久霸占，导致第 6 跳新会话启动时因容量为 0 抛出硬崩溃。
2. **Web 前端接力轮次事件缺失（界面假死停滞）**：
   `RpcHandler` 在自动开启下一代接力会话时，仅在 Node 内存中将新轮次对象加入 `this.turns`，未向 WebSocket 广播任何 `turn:start` 事件；前端收到上一轮的 `turn:end` 后将 `running` 置为 `false`，停滞在交接桩卡片，无法呈现后继新轮次的思考流与工具调用。
3. **0 字节损坏交接文件落盘失忆**：
   在异常分支或模型输出损坏时，系统直接写入了 0 字节的交接文档（如 `handoff-ses_...4nt7.md`），后继接力会话读取到空内容而丢失任务指针与前序审计结论。
4. **工具同参数重复调用与负面词干扰**：
   任务提示词中注入的“严禁仅做基线核验即提前退出”等负面禁止词诱发了模型的粉色大象效应；且 Harness 层缺少只读同一文件的连续幂等防护，导致模型在空文档背景下连续交替读取 `plan.md` 和 `review.md` 达 11 次。
5. **账号认证失效与 429 限流混淆误判（虚假 44 次限额）**：
   首个账号 `GSC.VFU2@cma-cgm.com` 的底层 Refresh Token 已过期（返回 `400 invalid_grant: AADSTS50173`），而 `AccountPool` 将所有刷新失败异常无差别捕获并判定为 429 频控，施加 60 秒临时退避并递增 `throttledCount`。每过 60 秒系统将其误判为自愈并重新尝试，周而复始累计了整整 44 次“虚假限额”，且未提供用户手动换票重新授权的闭环通道。

---

## 2. 总体架构与模块拓扑

本系统构建“零外部依赖、双端同构（Web + CLI）、状态精准隔离”的 M365 账号治理与自治接力闭环：

```
                    ┌───────────────────────────────────────────────┐
                    │               User Interaction                │
                    │   ┌─────────────────────┐  ┌──────────────┐   │
                    │   │ Web: AccountDialog  │  │ CLI: auth cmd│   │
                    │   └──────────┬──────────┘  └──────┬───────┘   │
                    └──────────────┼────────────────────┼───────────┘
                                   │ WebSocket          │ Direct Call
                                   ▼                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                      CPH-PI Runtime Engine                        │
│                                                                   │
│   ┌───────────────────────────┐    ┌───────────────────────────┐  │
│   │   OAuthPkceService (New)  │    │      RpcHandler (Enh)     │  │
│   │   - RFC 7636 PKCE 协议     │◄───┤   - auth:start/exchange   │  │
│   │   - 微软 NativeClient 换票  │    │   - turn:start 多跳广播   │  │
│   │   - JWT 解码与凭据原子落盘  │    │   - 接力上一代租约显式释放│  │
│   └─────────────┬─────────────┘    └─────────────┬─────────────┘  │
│                 │                                │                │
│                 ▼                                ▼                │
│   ┌───────────────────────────┐    ┌───────────────────────────┐  │
│   │      AccountPool (Enh)    │    │     Orchestrator (Enh)    │  │
│   │   - 租约生命周期全释放     │    │   - finally 强制租约释放  │  │
│   │   - AUTH_EXPIRED vs 429   │    │   - 0 字节交接文件物理门禁│  │
│   │   - 凭据失效停止 60s 轮询 │    │   - 同参数只读重复拦截    │  │
│   └─────────────┬─────────────┘    └─────────────┬─────────────┘  │
│                 │                                │                │
│                 ▼                                ▼                │
│   ┌───────────────────────────┐    ┌───────────────────────────┐  │
│   │     TokenManager (Core)   │    │    PromptBuilder (Core)   │  │
│   │   - AES-GCM (enc:v1:)     │    │   - 正向引导(摒弃严禁词)  │  │
│   │   - accounts.json 物理持久│    │   - 物理指纹与事实锚定    │  │
│   └───────────────────────────┘    └───────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. 详细设计与实现规格

### 3.1 原生 TypeScript 内嵌 PKCE 引擎 (`OAuthPkceService`)

在 `src/auth/oauth-pkce-service.ts` 实现 RFC 7636 标准授权码 PKCE 流程：
1. **常量契约**：
   - `ClientID`: `c0ab8ce9-e9a0-42e7-b064-33d422df41f1` (微软第一方客户端)
   - `Authority`: `https://login.microsoftonline.com/common`
   - `RedirectURI`: `https://login.microsoftonline.com/common/oauth2/nativeclient`
   - `Scope`: `openid profile offline_access https://substrate.office.com/sydney/.default`
2. **核心方法**：
   - `startAuthSession(targetEmail?: string)`:
     - 生成 32 字节密码学随机 `code_verifier` (Base64URL)；
     - 计算 `code_challenge = Base64URL(SHA256(code_verifier))`；
     - 生成 16 字节 `state`；
     - 构造微软登录 `authUrl`（`prompt=select_account`）；
     - 缓存会话（10 分钟 TTL），返回 `{ authSessionId, authUrl }`。
   - `exchangeCode(authSessionId: string, redirectUrlOrCode: string)`:
     - 校验 `authSessionId` 存在且未过期；
     - 解析用户提交的回调地址，提取 `code` 与 `state`，校验 `state` 防 CSRF 攻击；
     - 向 `https://login.microsoftonline.com/common/oauth2/v2.0/token` 发送 POST 换票（`grant_type=authorization_code`, `code_verifier`）；
     - 解码 `access_token` JWT 获取 `email`, `oid`, `tid`，验证凭据真实归属；
     - 驱动 `TokenManager.saveAccounts()` 将更新后的凭据以 `enc:v1:` AES-GCM 密文写回；
     - 立即销毁会话 `verifier` 保障一次性安全。

### 3.2 账号健康状态机与租约生命周期 (`AccountPool`)

1. **精准分流错误类别**：
   - 捕获 `TokenManager.getAccessToken` 抛出的错误：
     - 若包含 `invalid_grant`, `AADSTS50173`, `Account not found`, `Invalid credentials`：
       标记 `status.authExpired = true`, `status.isAvailable = false`, `status.throttleReason = "auth_expired"`;
       **严禁递增 `throttledCount`，严禁设置 60 秒冷却（保持 `cooldownUntil = 0`）**，彻底避免后台无效重试探测；
     - 若包含 429、`throttled` 或限流文本：
       标记 `status.isThrottled = true`，递增 `throttledCount`，计算阶梯退避或次日重置时间；
2. **租约即时释放与代际继任**：
   - `releaseSessionLease(sessionId: string)`：显式注销会话绑定的租约映射；
   - 在 `orchestrator.run()` 的 `finally` 块中加入租约回收门禁；
   - `RpcHandler` 在接力进入下一跳循环前，显式释放 `prevSessionId` 的租约。

### 3.3 Web RPC 与界面事件打通 (`RpcHandler` & `AccountDialog`)

1. **新增 Web RPC 消息类型**：
   - `auth:start-pkce` -> 返回 `auth:started { authSessionId, authUrl }`
   - `auth:exchange-code` -> 返回 `auth:complete { success, email }`
2. **多跳接力轮次全量事件化**：
   - 自动开启下一代接力时，向 WebSocket 广播 `turn:start`：
     ```typescript
     this.send("turn:start", {
       turn: nextTurn,
       activeSessionId: newSessionId,
       generation: nextStage,
     });
     ```
   - 前端 `store.ts` 监听 `turn:start`，将 `nextTurn` 追加至全局状态，置 `running = true`，自动滚动并呈现思考流占位。
3. **前端「账号治理」UI 增强**：
   - 增加红色的 `凭据失效 (需重新登录)` 状态徽章；
   - 提供「重新授权」与「添加账号」交互弹窗：
     - 步骤 1：展示微软登录链接，支持一键在系统默认浏览器打开或复制；
     - 步骤 2：提示用户在登录完成（页面显示空白或无法访问）后复制地址栏，粘贴入输入框；
     - 步骤 3：点击「确认换票」，展示加载微动画，换票成功后弹窗关闭，卡片秒级更新为绿色「就绪可用」。

### 3.4 终端交互子命令 (`cph-pi auth`)

CLI 支持原生命令：
```powershell
cph-pi auth login [email]
```
流程在命令行直接输出授权链接并提示在浏览器打开，监听用户在控制台粘贴的重定向地址，完成换票并在终端直接回显保存状态。

### 3.5 0 字节文件门禁与正向引导治理

1. **交接文档落盘硬门禁**：
   - 写入前校验 `content.trim().length >= 50`；
   - 若模型生成了空内容或损坏片段，强制从 `.cph/state/wal.jsonl` 与 `execution-ledger.md` 提取结构化物理指纹合成保底交接备忘录，杜绝 0 字节文件落盘；
   - 容灾分支若检测到磁盘已存在空文件，强制重写替换。
2. **工具同参数只读重复拦截**：
   - 若模型连续 2 次以上以完全相同的 path 执行 `read_file` 且目标未变动，追加客观提示指导其基于已有信息采取下一步行动，打破死循环；
   - 将 `Task Invariant` 中的“严禁仅做基线核验即提前退出”修改为建设性正向引导：“请依据前序交接清单与计划，主动读取目标模块源码切片并推进深入审查”。

---

## 4. 验证计划与测试矩阵

### 4.1 单元测试套件
1. `tests/auth/oauth-pkce-service.test.ts`：
   - 验证 S256 挑战码、State 生成与 URL 拼接完全符合微软 NativeClient 契约；
   - 验证回调 URL 的 `code` / `state` 正则提取与防 CSRF 拦截；
   - 模拟 Token 端点换票成功与 JWT Claims 解析。
2. `tests/auth/account-pool-auth-error-classification.test.ts`：
   - 验证凭据错误（`invalid_grant` / `AADSTS50173`）被分类为 `authExpired`，`throttledCount` 保持为 0，不施加 60 秒自动解冻；
   - 验证手动重新授权后账号状态恢复为 `READY`。
3. `tests/web/auto-handoff-lease-and-turn-start.test.ts`：
   - 模拟连续 6 次自主接力，验证每跳前序租约均被释放，可用容量维持恒定，无 `ALL_ACCOUNTS_LEASED` 异常；
   - 验证每跳接力均向 WebSocket 广播 `turn:start` 事件；
   - 验证 0 字节交接文件物理落盘拦截。

### 4.2 全量集成与回归基线
- 运行全仓自动化测试套件（102+ 测试文件，800+ 测试用例 100% 绿灯全通）；
- 前端生产构建 `npm run web:build` 0 编译错误。

