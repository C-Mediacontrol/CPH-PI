# M365 账号治理自治增强与交互式 PKCE 凭据刷新体系 Implementation Plan (v2 核验修正版)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建零外部依赖、双端同构（Web + CLI）的 M365 账号治理与自治接力闭环，彻底修复状态机反噬（F1）、租约多点泄漏（F5）、0 字节交接空转（F3）、Web 断线与字段错名（F4, F6）等缺陷，恪守 Harness 中立与 100% 附件原始字节保真准则（B1），提供对齐 `auth.go` 的 RFC 7636 PKCE 凭据刷新服务。

**Architecture:** 
1. **OAuthPkceService**: RFC 7636 原生 TypeScript 引擎，微软公共客户端授权流，`response_mode=query`，S256 挑战码，Base64URL JWT 双 Token 提取 `oid`/`tid`，支持错误参数提取与防 CSRF State 校验，错位检测（`emailMismatch`）。
2. **AccountPool 状态机全链路硬门禁**: 致命鉴权错误（`invalid_grant`, `AADSTS700082`, `AADSTS50173`, `AADSTS50076` 等）精准识别；在 `acquireSessionLease`、`getNextAvailableToken`、`getGraphAccessToken`、`getAvailableCapacity` 及 `SubagentRunner` 全部门禁检查 `status.authExpired || !status.isAvailable || status.isThrottled`，杜绝 0 秒无冷却死循环；提供 `resetCooldown` 对接 Web 端。
3. **Orchestrator 0 字节双点封堵与租约全生命周期释放**: 封堵 L854 模型空块直接落盘与 L2154 容灾仲裁产物跳过兜底，强制 `>= 50` 字节门禁并清除破损文件；`run()` 终态 `finally` 强制释放会话租约；主会话世代虚拟化（L966）释放前代租约并正确传入 `sessionId`；彻底移除 `ToolBridge` 主观 `Notice` 拼接，守住 Harness 中立与 OneDrive 附件原始字节保真。
4. **Web 前端与 RPC 接力连续性闭环**: 跨代接力调用 `resetHandshake()`，广播 `turn:start` 与 `session:created`；前端 `store.ts` 使用真实字段 `activeSessionId`；`AccountDialog.tsx` 实现 PKCE 两步交互授权面板与错位提示。
5. **CLI 双轨支持**: `args.ts` 精确消费 `auth` 子命令参数防 `positional` 污染；支持终端 `cph-pi auth login [email]` 与 TUI 交互内 `/accounts login [email]`。

**Tech Stack:** TypeScript, Bun, React 18, Vite, WebSocket, Microsoft Azure AD OAuth PKCE, node:crypto, AES-256-GCM.

## Global Constraints

- **AGENTS.md Rule 1 (Harness Neutrality):** Harness 本身保持绝对中立，严禁在 `ToolBridge` 中植入连续读取拦截器或注入主观说教 `Notice`。
- **AGENTS.md Rule 3 (Constructive Guidance):** 全面消除“严禁……”、“切勿……”、“不要……”等负面禁止词，转为建设性正向引导。
- **AGENTS.md Rule 5 (Workspace Packaging):** 严禁修改用户全局目录（`C:\Users\UserX\...`）；所有技能和配置仅在工作区内修改。
- **AGENTS.md Rule 7 (Orthogonal Persistence):** 传引用挂载而非传值倾倒，物理账本路径严格使用真实存在的 `.cph/state/execution-ledger.jsonl` 与 `execution-ledger.md`。
- **AGENTS.md Rule 9 (Full Attachment Fidelity):** 文本与代码 100% 原始字节保真，确保上传至 OneDrive 的附件与本地文件严格一致。

---

## 冲击面扫描（Impact Surface Scan - v2 修正版）

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 应对策略 |
|---|---|---|---|
| **选号循环: `AccountPool`** | `acquireSessionLease`, `getNextAvailableToken`, `getGraphAccessToken`, `getAvailableCapacity` | `Orchestrator`, `SubagentRunner`, `RpcHandler`, OneDrive 上传 | **修复 F1**: 全部门禁强制检查 `status.authExpired \|\| !status.isAvailable \|\| status.isThrottled`，杜绝失效账号以 0s 间隔无限循环选中。 |
| **异常判定: `isFatalAuthGrantError`** | `tokenManager.getAccessToken` 抛出的标准 `Error` | `AccountPool.catch(err)` | **修复 F2**: 不依赖不存在的 `err.code`，正则匹配 `err.message` 中的 `invalid_grant`、`interaction_required`、`AADSTS` 错误码；`getGraphAccessToken` 遍历健康账号。 |
| **会话租约: `sessionLeases`** | `Orchestrator.run()`, 世代虚拟化 L966, 容灾移交, `RpcHandler` | 账号池容量管理 | **修复 F5**: 在 `orchestrator.run()` 终态 `finally`、L966 世代虚拟化、以及 `RpcHandler` 接力循环中对称调用 `releaseSessionLease`，彻底封堵 CLI 与 Web 跨代泄漏。 |
| **交接文档: 0 字节落盘** | `Orchestrator` L854 & L2154 | 继任会话读取、上下文恢复 | **修复 F3**: 在 L854（模型内联空块）与 L2154（容灾仲裁产物）双点封堵，未达 50 字节强制清除并走 `generateHandoffSnapshot` 账本合成。引用真实路径 `.cph/state/execution-ledger.jsonl`。 |
| **工具输出: `ToolBridge`** | `ToolBridge.executeAction` | 模型上下文、OneDrive 附件上传 | **修复 B1**: **彻底废除 `ToolBridge` 连续读取拦截器**，保持 100% 原始字节保真与 Harness 中立，由 F3 根除空转诱因。 |
| **Web RPC & Store** | `RpcHandler` 广播、`store.ts` 监听 | Web 前端界面渲染 | **修复 F4 & F6**: `store.ts` 使用真实字段 `activeSessionId`；`RpcHandler` 跨代调用 `resetHandshake()`；`AccountPool` 正式实现 `resetCooldown`。 |
| **PKCE 契约与错位防范** | `OAuthPkceService`, Azure AD | `TokenManager`, 前端, CLI | **修复 C1-C4**: 常量坚持采用 `auth.go` 源码的 `c0ab8ce9-e9a0-42e7-b064-33d422df41f1` 与 `/common`；补齐 `oid`/`tid` 解析、`graphTokens` 清理、`notes/cookies` 保留、`error_description` 拦截与 `emailMismatch` 错位检测。 |

---

## File Structure

- **新增文件**:
  - `CPH-PI/src/auth/oauth-pkce-service.ts` - 原生 TypeScript RFC 7636 PKCE 认证引擎（含 `oid`/`tid`、`emailMismatch` 与多格式回调解析）
  - `CPH-PI/tests/auth/oauth-pkce-service.test.ts` - PKCE 核心功能单元测试
  - `CPH-PI/tests/auth/account-pool-auth-error-classification.test.ts` - 账号错误分类、全入口硬门禁（F1）与凭据更新测试
  - `CPH-PI/tests/agent/orchestrator-governance-cleanliness.test.ts` - 0 字节双点封堵（F3）、租约释放（F5）与正向引导测试
  - `CPH-PI/tests/web/auto-handoff-lease-and-turn-start.test.ts` - 跨代接力租约释放、握手重置（F4）与 Web 事件广播测试
  - `CPH-PI/tests/cli/auth-cli.test.ts` - CLI auth 子命令解析与 TUI `/accounts login` 测试
- **修改文件**:
  - `CPH-PI/src/auth/account-pool.ts` - 增加 `authExpired`/`authErrorReason`、全入口硬门禁、`isFatalAuthGrantError`、`getGraphAccessToken` 遍历、`resetCooldown` 与 PKCE 会话管理
  - `CPH-PI/src/auth/token-manager.ts` - `setCachedToken` 清除 `graphTokens`，`upsertAccountFromPkce` 保留 `notes`/`cookies`
  - `CPH-PI/src/agent/orchestrator.ts` - `run()` `finally` 租约释放、L854 & L2154 0 字节交接物理硬门禁、L966 世代虚拟化租约释放与传参、提示词清洗
  - `CPH-PI/src/agent/subagent-runner.ts` - 过滤账号增加 `!a.authExpired && a.isAvailable` 门禁，清洗负面禁止词
  - `CPH-PI/src/protocol/prompt-builder.ts` - 正向引导约束，清洗负面词
  - `CPH-PI/skills/handoff/SKILL.md` - 正向交接引导约束
  - `CPH-PI/src/web/rpc-handler.ts` - 接力循环释放租约、调用 `resetHandshake()`、广播 `turn:start` 与 `session:created`、PKCE RPC 路由
  - `CPH-PI/web/src/types/protocol.ts` - 扩展 `AccountInfo` (authExpired, authErrorReason) 与 PKCE 协议类型
  - `CPH-PI/web/src/services/store.ts` - 使用 `activeSessionId`，监听 `turn:start`，打通 PKCE 状态
  - `CPH-PI/web/src/components/layout/AccountDialog.tsx` - 凭据失效红标、三态徽章、PKCE 两步授权面板、`emailMismatch` 提示
  - `CPH-PI/web/src/components/layout/AccountDialog.module.css` - PKCE 授权面板样式
  - `CPH-PI/src/cli/args.ts` - 精准消费 `authAction` 与 `authTargetEmail`，防推入 `positional`
  - `CPH-PI/src/cli.ts` - 终端 `cph-pi auth login` 与交互式 `/accounts login`
  - `CPH-PI/.docs/CHANGE-REQUEST.md` - 登记 CR-2026-10-24-01

---

## Tasks

### Task 1: 原生 TypeScript RFC 7636 PKCE 引擎 (`OAuthPkceService`)

**Files:**
- Create: `CPH-PI/src/auth/oauth-pkce-service.ts`
- Modify: `CPH-PI/src/auth/token-manager.ts`
- Create: `CPH-PI/tests/auth/oauth-pkce-service.test.ts`

**Interfaces:**
- Consumes: `TokenManager`, `crypto`
- Produces: `OAuthPkceService`
  - `startAuthSession(targetEmail?: string): { authSessionId: string; authUrl: string; state: string }`
  - `extractCodeAndState(redirectUrlOrCode: string, expectedState?: string): { code: string; state?: string }`
  - `exchangeCode(authSessionId: string, redirectUrlOrCode: string, expectedEmail?: string): Promise<PkceExchangeResult>`
  - 核心常量对齐 `Library/m365-auth-helper/auth.go:21`：
    `ClientID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1"`
    `Authority = "https://login.microsoftonline.com/common"`
    `RedirectURI = "https://login.microsoftonline.com/common/oauth2/nativeclient"`
    `Scope = "openid profile offline_access https://substrate.office.com/sydney/.default"`

- [ ] **Step 1: 编写失败的单元测试**

新建 `CPH-PI/tests/auth/oauth-pkce-service.test.ts`，验证：
1. S256 挑战码、URL 参数（包含 `response_mode=query` 与 `login_hint`）；
2. 提取 `code` 时若包含 `error=access_denied&error_description=...` 抛出明确可读错误；
3. 解析完整 URL、查询串与裸授权码，State 不一致时抛出 CSRF 异常；
4. 双 Token 解析提取 `oid`、`tid` 与 `email`；
5. 账号错位检测：实际登录账号与预期账号不一致时返回 `emailMismatch: true`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { OAuthPkceService } from "../../src/auth/oauth-pkce-service.ts";
import { TokenManager } from "../../src/auth/token-manager.ts";

describe("OAuthPkceService RFC 7636 Unit Tests", () => {
  let tempDir: string;
  let tempAccountsPath: string;
  let tokenManager: TokenManager;
  let pkceService: OAuthPkceService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pkce-test-"));
    tempAccountsPath = path.join(tempDir, "accounts.json");
    tokenManager = new TokenManager(tempAccountsPath);
    tokenManager.saveAccounts([
      { email: "target@contoso.com", refreshToken: "old_rt_123", notes: "vip" }
    ]);
    pkceService = new OAuthPkceService(tokenManager);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should generate valid PKCE session with response_mode=query and login_hint", () => {
    const session = pkceService.startAuthSession("target@contoso.com");
    expect(session.authSessionId).toBeDefined();
    expect(session.authUrl).toContain("login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(session.authUrl).toContain("client_id=c0ab8ce9-e9a0-42e7-b064-33d422df41f1");
    expect(session.authUrl).toContain("response_type=code");
    expect(session.authUrl).toContain("response_mode=query");
    expect(session.authUrl).toContain("code_challenge_method=S256");
    expect(session.authUrl).toContain("login_hint=target%40contoso.com");
  });

  it("should extract error and error_description from redirect URL", () => {
    const errorUrl = "https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied&error_description=User+declined";
    expect(() => pkceService.extractCodeAndState(errorUrl)).toThrow("Azure AD authorization failed (access_denied): User declined");
  });

  it("should extract code and validate state CSRF safely across full URL, query string, and raw code", () => {
    const session = pkceService.startAuthSession();
    const state = session.state;

    // Full URL
    const fullUrl = `https://login.microsoftonline.com/common/oauth2/nativeclient?code=code_123&state=${state}`;
    expect(pkceService.extractCodeAndState(fullUrl, state)).toEqual({ code: "code_123", state });

    // Query string only
    const queryOnly = `?code=code_456&state=${state}`;
    expect(pkceService.extractCodeAndState(queryOnly, state)).toEqual({ code: "code_456", state });

    // Raw code
    const rawCode = "raw_code_789";
    expect(pkceService.extractCodeAndState(rawCode)).toEqual({ code: "raw_code_789", state: undefined });

    // State mismatch
    expect(() => pkceService.extractCodeAndState(fullUrl, "different_state")).toThrow("State mismatch");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/auth/oauth-pkce-service.test.ts`
预期: FAIL - `Cannot find module '../../src/auth/oauth-pkce-service.ts'`

- [ ] **Step 3: 编写 `OAuthPkceService` 与 `TokenManager` 增强**

在 `CPH-PI/src/auth/token-manager.ts`：
1. 在 `setCachedToken(email, token)` 中加入 `this.graphTokens.delete(email.toLowerCase());`，确保旧 GraphToken 缓存即时失效。
2. 增加 `upsertAccountFromPkce(email, refreshToken, oid, tid)`：保留已存在的 `notes` 与 `cookies`。

在 `CPH-PI/src/auth/oauth-pkce-service.ts` 实现：
- 完整常量定义（对齐 `auth.go`）
- Base64URL 编解码（支持字符替换与 padding 补齐）
- 错误参数拦截与多格式输入解析
- Token 换票与双 Token Claims 解析（提取 `oid`, `tid`, `email`）
- `emailMismatch` 账号错位检测与返回

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/auth/oauth-pkce-service.test.ts`
预期: PASS

- [ ] **Step 5: 提交代码检查点**

```powershell
git add CPH-PI/src/auth/oauth-pkce-service.ts CPH-PI/src/auth/token-manager.ts CPH-PI/tests/auth/oauth-pkce-service.test.ts
git commit -m "feat(auth): implement RFC 7636 OAuthPkceService with full claim extraction and error interception"
```

---

### Task 2: 账号池健康分类、全入口硬门禁与 Web 重置修复 (`AccountPool`)

**Files:**
- Modify: `CPH-PI/src/auth/account-pool.ts`
- Modify: `CPH-PI/src/agent/subagent-runner.ts:218-225`
- Create: `CPH-PI/tests/auth/account-pool-auth-error-classification.test.ts`

**Interfaces:**
- Consumes: `TokenManager`, `OAuthPkceService`
- Produces:
  - `AccountStatus.authExpired?: boolean`
  - `AccountStatus.authErrorReason?: string`
  - `AccountPool.isFatalAuthGrantError(err: unknown): boolean`
  - `AccountPool.markAuthExpired(email: string, reason: string): void`
  - `AccountPool.resetCooldown(email: string): boolean`
  - 四大选号入口门禁：`status.authExpired || !status.isAvailable || status.isThrottled`
  - `getGraphAccessToken` 健康账号遍历

- [ ] **Step 1: 编写失败的单元测试**

新建 `CPH-PI/tests/auth/account-pool-auth-error-classification.test.ts`，验证：
1. 致命错误（`invalid_grant`, `AADSTS50173`, `AADSTS700082`, `AADSTS50076`）标记 `authExpired: true`，且 `throttledCount` 为 0，`cooldownUntil` 为 0；
2. **核心防反噬断言 (F1)**：处于 `authExpired` 的账号在 `acquireSessionLease`、`getNextAvailableToken`、`getAvailableCapacity` 中被 100% 跳过，绝不触发二次获取；
3. `resetCooldown` 对 `authExpired` 账号返回 `false`，防止误恢复；对普通限流账号恢复可用；
4. `getGraphAccessToken` 自动跳过失效账号，选取健康账号。

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/auth/account-pool-auth-error-classification.test.ts`
预期: FAIL

- [ ] **Step 3: 修改 `AccountPool` 与 `SubagentRunner`**

1. 在 `AccountPool` 实现 `isFatalAuthGrantError(err)`，匹配 `invalid_grant`、`interaction_required` 及 `AADSTS` 系列错误码；
2. 在 `acquireSessionLease` (L305)、`getNextAvailableToken` (L542)、`getAvailableCapacity` (L248) 统一增加：
   ```typescript
   if (status.authExpired || !status.isAvailable || status.isThrottled) {
     continue;
   }
   ```
3. 在 `catch` 块中区分 `isFatalAuthGrantError` -> `this.markAuthExpired(email, msg)` 与普通异常 -> `reportThrottle`；
4. 重构 `getGraphAccessToken`，遍历寻找首个健康账号；
5. 实现 `resetCooldown(email: string): boolean`（修复 F6）：若 `status.authExpired` 返回 `false`，否则调用 `unthrottle` 返回 `true`；
6. 在 `subagent-runner.ts:220` 增加过滤：`!acc.isThrottled && !acc.authExpired && acc.isAvailable !== false`。

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/auth/account-pool-auth-error-classification.test.ts`
预期: PASS

- [ ] **Step 5: 提交代码检查点**

```powershell
git add CPH-PI/src/auth/account-pool.ts CPH-PI/src/agent/subagent-runner.ts CPH-PI/tests/auth/account-pool-auth-error-classification.test.ts
git commit -m "fix(auth): enforce strict authExpired gate across all pool entries and implement resetCooldown"
```

---

### Task 3: 编排器 0 字节双点封堵、租约生命周期全释放与正向认知塑形

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts:430-470`, `850-865`, `945-975`, `1315-1330`, `2145-2170`
- Modify: `CPH-PI/src/agent/subagent-runner.ts:925-930`
- Modify: `CPH-PI/src/protocol/prompt-builder.ts`
- Modify: `CPH-PI/skills/handoff/SKILL.md`
- Create: `CPH-PI/tests/agent/orchestrator-governance-cleanliness.test.ts`

**Interfaces:**
- Consumes: `AccountPool.releaseSessionLease`
- Produces:
  - 封堵点 A：L854 模型内联空块直接落盘拦截（`length < 50` 自动清除并触发账本合成）
  - 封堵点 B：L2154 容灾仲裁产物 0 字节拦截（`< 50` 强制覆写为 `disasterBlackbox`）
  - 账本回退读取真实路径 `.cph/state/execution-ledger.jsonl`（修复 F3）
  - `orchestrator.run()` 终态 `finally` 强制释放 `sessionId` 租约（修复 F5）
  - L966 世代虚拟化释放前代租约并正确传入 `sessionId: nextSessionId`（修复 F5）
  - **彻底移除 `ToolBridge` 拦截器**，守住 Rule 1（Harness 中立）与 Rule 9（100% 原始字节保真）（修复 B1）
  - 清洗提示词与技能中的负面禁止词，替换为正向建设性指引（Rule 3）

- [ ] **Step 1: 编写失败的单元测试**

新建 `CPH-PI/tests/agent/orchestrator-governance-cleanliness.test.ts`，验证：
1. 模型输出空内联块或磁盘存在 0 字节交接文件时，强制合成有效交接文档（`>= 50` 字节）；
2. 容灾仲裁产出 0 字节时强制覆写；
3. `orchestrator.run()` 退出后租约被成功释放；
4. 提示词与 `handoff` 技能中零“严禁/切勿/不要”负面禁止词；
5. `ToolBridge` 输出不包含任何主观 `Notice` 拼接。

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/agent/orchestrator-governance-cleanliness.test.ts`
预期: FAIL

- [ ] **Step 3: 实现修改**

1. 在 `orchestrator.ts:850-865`：
   ```typescript
   const inlineHandoffText = (parsed.handoffDoc || "").trim();
   if (inlineHandoffText.length >= 50) {
     fs.writeFileSync(docPath, inlineHandoffText, "utf8");
     this.lastHandoffDocPath = docPath;
   } else {
     if (fs.existsSync(docPath)) {
       try { fs.unlinkSync(docPath); } catch {}
     }
     docPath = this.generateHandoffSnapshot(task, history, targetSessionId);
   }
   ```
2. 在 `orchestrator.ts:2154`：
   ```typescript
   const existingArbitrationDoc = fs.existsSync(targetHandoffAbsolutePath)
     ? fs.readFileSync(targetHandoffAbsolutePath, "utf8").trim()
     : "";
   if (existingArbitrationDoc.length < 50) {
     fs.writeFileSync(targetHandoffAbsolutePath, disasterBlackbox, "utf8");
   }
   ```
3. 在 `orchestrator.ts:947-968`（世代虚拟化）：
   ```typescript
   const prevSessionId = this.sessionId;
   if (this.pool && prevSessionId) {
     this.pool.releaseSessionLease(prevSessionId);
   }
   // ...
   const token = await this.pool.getNextAvailableToken({
     sessionId: nextSessionId,
     ...(this.customAgentId ? { forAgentId: this.customAgentId } : {}),
   });
   ```
4. 在 `orchestrator.run()` 外层包裹 `try ... finally`:
   ```typescript
   } finally {
     if (this.pool && this.sessionId) {
       this.pool.releaseSessionLease(this.sessionId);
     }
   }
   ```
5. 全面清洗负面禁止词，强化正向行动指引。**确保不对 `ToolBridge.ts` 注入任何 `Notice`。**

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/agent/orchestrator-governance-cleanliness.test.ts`
预期: PASS

- [ ] **Step 5: 提交代码检查点**

```powershell
git add CPH-PI/src/agent/orchestrator.ts CPH-PI/src/agent/subagent-runner.ts CPH-PI/src/protocol/prompt-builder.ts CPH-PI/skills/handoff/SKILL.md CPH-PI/tests/agent/orchestrator-governance-cleanliness.test.ts
git commit -m "fix(agent): seal 0-byte handoff files, release session leases, and enforce constructive guidance"
```

---

### Task 4: Web RPC 跨代接力广播、握手重置与 PKCE 协议集成 (`RpcHandler`)

**Files:**
- Modify: `CPH-PI/src/web/rpc-handler.ts`
- Create: `CPH-PI/tests/web/auto-handoff-lease-and-turn-start.test.ts`

**Interfaces:**
- Consumes: `OAuthPkceService`, `AccountPool`
- Produces:
  - 跨代接力广播 `turn:start` 与 `session:created`
  - 跨代接力调用 `this.orchestrator.resetHandshake()`（修复 F4）
  - 显式释放前代会话租约（修复 F5）
  - 响应 `account:pkce_start` 与 `account:pkce_complete` RPC

- [ ] **Step 1: 编写失败的单元测试**

新建 `CPH-PI/tests/web/auto-handoff-lease-and-turn-start.test.ts`，验证：
1. 跨代接力触发 `turn:start` 事件广播；
2. 跨代接力前序租约被释放；
3. `account:pkce_start` 与 `account:pkce_complete` 协议响应正常。

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/auto-handoff-lease-and-turn-start.test.ts`
预期: FAIL

- [ ] **Step 3: 修改 `RpcHandler`**

在 `CPH-PI/src/web/rpc-handler.ts`：
1. 跨代接力处释放 `prevSessionId` 租约；
2. 调用 `this.orchestrator.resetHandshake()`；
3. 广播 `turn:start` 与 `session:created`；
4. 注册 `account:pkce_start` 与 `account:pkce_complete` RPC，对接 `OAuthPkceService`。

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/auto-handoff-lease-and-turn-start.test.ts`
预期: PASS

- [ ] **Step 5: 提交代码检查点**

```powershell
git add CPH-PI/src/web/rpc-handler.ts CPH-PI/tests/web/auto-handoff-lease-and-turn-start.test.ts
git commit -m "feat(web): broadcast turn:start on auto-handoff, reset handshake, and wire PKCE RPC"
```

---

### Task 5: Web 前端协议类型与全局 Store 接力响应

**Files:**
- Modify: `CPH-PI/web/src/types/protocol.ts`
- Modify: `CPH-PI/web/src/services/store.ts`

**Interfaces:**
- Consumes: `turn:start`, `account:pkce_*`
- Produces:
  - `AccountInfo.authExpired?: boolean`
  - `AccountInfo.authErrorReason?: string`
  - `store.ts` 严格使用真实状态字段 `activeSessionId`（修复 F4）
  - `store.ts` 监听 `turn:start` 驱动接力 UI，提供 PKCE 动作方法

- [ ] **Step 1: 修改 `protocol.ts` 与 `store.ts`**

在 `protocol.ts` 增加 `authExpired` 与 `authErrorReason`；
在 `store.ts` 中：
- `turn:start` 处理器更新 `activeSessionId: data.activeSessionId` 与追加 `nextTurn`；
- 暴露 `startPkceAuth` 与 `completePkceAuth` 方法。

- [ ] **Step 2: 验证编译**

运行: `cd "E:\copilot-web proxy\CPH-PI"; npm run web:build`
预期: 0 错误

- [ ] **Step 3: 提交代码检查点**

```powershell
git add CPH-PI/web/src/types/protocol.ts CPH-PI/web/src/services/store.ts
git commit -m "feat(web): update protocol types and store state aligning with activeSessionId"
```

---

### Task 6: Web 前端账号治理弹窗与 PKCE 交互界面 (`AccountDialog`)

**Files:**
- Modify: `CPH-PI/web/src/components/layout/AccountDialog.tsx`
- Modify: `CPH-PI/web/src/components/layout/AccountDialog.module.css`

**Interfaces:**
- Consumes: `useAppStore`
- Produces:
  - 三态状态徽章（正常 / 限流中 / 凭据失效需重登）
  - 凭据失效时展示 `authErrorReason` 与高亮「🔑 重新授权」
  - 内嵌 PKCE 两步面板（展示 `authUrl`、复制、在新标签打开、粘贴验证）
  - 账号错位提示（`emailMismatch` 提示原账号仍需单独授权）

- [ ] **Step 1: 实现组件与样式**

修改 `AccountDialog.tsx` 与 `AccountDialog.module.css`，完善交互面板与错位提示。

- [ ] **Step 2: 运行前端构建验证**

运行: `cd "E:\copilot-web proxy\CPH-PI"; npm run web:build`
预期: Vite 构建成功，0 错误

- [ ] **Step 3: 提交代码检查点**

```powershell
git add CPH-PI/web/src/components/layout/AccountDialog.tsx CPH-PI/web/src/components/layout/AccountDialog.module.css
git commit -m "feat(web): render tri-state account badges and two-step PKCE auth panel with mismatch alert"
```

---

### Task 7: CLI 双轨支持 (`args.ts`, `cli.ts`)

**Files:**
- Modify: `CPH-PI/src/cli/args.ts`
- Modify: `CPH-PI/src/cli.ts`
- Create: `CPH-PI/tests/cli/auth-cli.test.ts`

**Interfaces:**
- Consumes: `OAuthPkceService`, `AccountPool`
- Produces:
  - `args.ts` 精确消费 `authAction` 与 `authTargetEmail`，防污染 `positional`（修复 C3）
  - 独立终端命令 `cph-pi auth login [email]`
  - 交互式 TUI 斜杠命令 `/accounts login [email]`（修复 C3）

- [ ] **Step 1: 编写 CLI 单元测试**

新建 `CPH-PI/tests/cli/auth-cli.test.ts`，验证 `parseCliArgs` 不将 `login` 与邮箱推入 `positional`，且正确设置 `subcommand: "auth"`。

- [ ] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/cli/auth-cli.test.ts`
预期: FAIL

- [ ] **Step 3: 实现 CLI 解析与命令支持**

在 `args.ts` 中消费 `auth` 参数；在 `cli.ts` 实现独立执行流与 `/accounts login` 分支。

- [ ] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/cli/auth-cli.test.ts`
预期: PASS

- [ ] **Step 5: 提交代码检查点**

```powershell
git add CPH-PI/src/cli/args.ts CPH-PI/src/cli.ts CPH-PI/tests/cli/auth-cli.test.ts
git commit -m "feat(cli): add dual-track PKCE auth support for standalone CLI and interactive REPL"
```

---

### Task 8: 全量测试套件回归验证与变更文档归档

**Files:**
- Modify: `CPH-PI/.docs/CHANGE-REQUEST.md`
- Verify: Full Test Suite (`bun test`), Web Production Build (`npm run web:build`)

- [x] **Step 1: 运行全仓自动化测试**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test`
预期: 现有 102 个测试文件、789 个测试用例 100% PASS，新增测试全部 PASS，0 fail。

- [x] **Step 2: 运行前端生产编译**

运行: `cd "E:\copilot-web proxy\CPH-PI"; npm run web:build`
预期: Vite 构建无报错。

- [x] **Step 3: 登记变更文档 `CPH-PI/.docs/CHANGE-REQUEST.md`**

追加 CR-2026-10-24-01 完整交付记录。

- [x] **Step 4: 最终提交**

```powershell
git add CPH-PI/.docs/CHANGE-REQUEST.md
git commit -m "docs: finalize CR-2026-10-24-01 implementation and full verification"
```
