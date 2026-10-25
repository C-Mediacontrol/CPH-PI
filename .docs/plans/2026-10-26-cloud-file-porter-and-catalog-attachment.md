# Cloud File Porter, Post-Write Sync Receipt, and Pure Catalog Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the clean `30d22da` baseline for the file porter / catalog modules, update root `AGENTS.md` (Rules 10 & 11), and implement authenticated headless `asyncgw` file downloading (`FilePorter` + IC3 token), path-semantic `.zip` handling, pure cloud attachment for workspace directory catalogs (`remote-workspace-catalog.md`) with per-account isolation, immediate post-write SharePoint synchronization with honest status receipts, and synchronized System Prompts (`cph-main-agent-prompt.txt` & `cph-coder-agent-prompt.txt`).

**Architecture:**
1. **Auth Layer (`TokenManager` & `AccountPool`)**: Acquire and cache `https://ic3.teams.office.com/.default` tokens (`getIc3AccessToken`) per account (`email`) without an `Origin` header, alongside per-account `getGraphAccessToken(email)`.
2. **Protocol Layer (`DeliverablesParser`, `ResilientParser`, `PromptBuilder`)**: Parse top-pinned `【交付文件与落盘指引 / Deliverables】` in `FINAL_ANSWER` and `url`/`downloadUrl` in `write_file`; fix `ResilientParser` so `FINAL_ANSWER`/`handoff` take precedence over generic code fences and Markdown links are never auto-executed; strip all inline `dirTree`/`dirSkeleton`/`virtualRepoMap` dumps from prompts.
3. **Transport & Workspace Layer (`FilePorter`, `PnPWorkspaceSyncEngine`)**: Normalize `asyncgw` URLs (extract filename first, preserve query string, strip trailing `/<filename>` after `/views/original`), enforce an SSRF host allowlist, download with IC3 Bearer token, save `.zip` as-is when target ends with `.zip` or safely extract when target is a directory, generate a 2-section `remote-workspace-catalog.md` (2-level directory skeleton + all workspace files), and fix `buildSharePointWebUrl` / `resolveCloudTarget`.
4. **Orchestration & Prompt Layer (`Orchestrator`, `SubagentRunner`, Agent Prompts)**: Mount `remote-workspace-catalog.md` as a OneDrive/Substrate attachment isolated by leased account email across Turn 1, 429 switches, successor sessions, and subagents; sync newly landed files to SharePoint with `AbortController` timeout cleanup; send honest status receipts only on intermediate turns (never on `FINAL_ANSWER`); co-register all capabilities in `cph-main-agent-prompt.txt` and `cph-coder-agent-prompt.txt`.

**Tech Stack:** Bun, TypeScript, Node `fs`/`path`/`crypto`/`child_process`, `adm-zip`, PowerShell (`sp-sync-engine.ps1`).

**Design Spec:** `CPH-PI/.docs/specs/2026-10-26-cloud-file-porter-and-catalog-attachment-design.md`

---

## File Structure & Responsibility Map

| File Path | Action | Responsibility |
|---|---|---|
| `e:\copilot-web proxy\AGENTS.md` | Modify | Add Rule 10 (Work IQ enterprise data access invariant) and Rule 11 (Harness & System Prompt co-design registration invariant). |
| `CPH-PI/src/auth/token-manager.ts` | Modify | Add `IC3_SCOPE`, `ic3Tokens` cache map, `getIc3AccessToken(email, forceRefresh)`, and `setCachedIc3Token`. |
| `CPH-PI/src/auth/account-pool.ts` | Modify | Add `getIc3AccessToken(email?: string)` with specified-account priority and pool fallback. |
| `CPH-PI/src/protocol/deliverables-parser.ts` | Create | Parse top-pinned `【交付文件与落盘指引 / Deliverables】` lines (`- <path> <- <url>`) with path traversal validation and `.zip` extension detection. |
| `CPH-PI/src/protocol/resilient-parser.ts` | Modify | Evaluate `handoff` and `FINAL_ANSWER` before generic ``` blocks; restrict step 2c to `<a download>` / `blob:` and default `autoExecute: false`; support `url` in `write_file`. |
| `CPH-PI/src/transport/file-porter.ts` | Modify | Implement `normalizeAsyncGwUrl`, `assertAllowedDownloadUrl`, IC3 token fetch + fallback, `deliverToWorkspace` (`.zip` file vs directory extraction with Zip-Slip & size/entry guards), and `autoExecute: false` default. |
| `CPH-PI/src/workspace/pnp-sync-engine.ts` | Modify | Add `resolveCloudTarget` (no silent fallback to personal folder), `buildSharePointWebUrl` (deduplicate `/sites/<name>`), and `generateCatalogMarkdown` (2-level directory skeleton + full file table). |
| `CPH-PI/src/protocol/prompt-builder.ts` | Modify | Remove inline `dirTree`, `dirSkeleton`, and `virtualRepoMap` from `buildTurn1Prompt`, `buildDirectAgentPrompt`, `buildHandshakePrompt`, and `buildReGroundingPrompt`; add `buildFileSavedAndSyncedReceipt`. |
| `CPH-PI/src/session/main-plan-snapshot.ts` | Modify | Remove inline `dirSkeleton` and `virtualRepoMap` from `formatSuccessorTurn1Prompt` and point to attached `remote-workspace-catalog.md`. |
| `CPH-PI/src/agent/orchestrator.ts` | Modify | Add `activeAccountEmail` tracking, `acquireGraphToken(email)`, `acquireIc3Token(email)`, per-account `ensureWorkspaceCatalogAttachment`, per-account `workspace-snapshot-cache.json`, intermediate `write_file(url)` + `syncAndFormatReceipt`, and `FINAL_ANSWER` ordered landing/sync/delivery-report without model receipt. |
| `CPH-PI/src/agent/subagent-runner.ts` | Modify | Pass `subagentAccount` into `this.pool.getGraphAccessToken(subagentAccount)` when uploading initial slice/target-file attachments. |
| `CPH-PI/package/agent-bundle/cph-main-agent-prompt.txt` | Modify | Register `remote-workspace-catalog.md` attachment, cloud-first + local fallback reading, `write_file(path, url)`, `.zip` path semantics, and `FINAL_ANSWER` deliverables header. |
| `CPH-PI/package/agent-bundle/cph-coder-agent-prompt.txt` | Modify | Register `remote-workspace-catalog.md` attachment, cloud-first + local fallback reading, `write_file(path, url)`, `.zip` path semantics, and `FINAL_ANSWER` deliverables header. |

---

### Task 1: Clean Git Baseline Restoration (`30d22da`) & Root `AGENTS.md` Rules 10 & 11

**Files:**
- Modify: `e:\copilot-web proxy\AGENTS.md`
- Restore to `30d22da` in `e:\copilot-web proxy\CPH-PI`:
  - `cph-coder-agent-prompt.txt`
  - `cph-main-agent-prompt.txt`
  - `package/agent-bundle/Instructions-Coder-代码实现智能体.txt`
  - `package/agent-bundle/Instructions-Main-主协调智能体.txt`
  - `package/agent-bundle/cph-coder-agent-prompt.txt`
  - `package/agent-bundle/cph-main-agent-prompt.txt`
  - `src/agent/orchestrator.ts`
  - `src/protocol/prompt-builder.ts`
  - `src/protocol/resilient-parser.ts`
  - `src/transport/file-porter.ts`
  - `src/workspace/pnp-sync-engine.ts`
  - `tests/protocol/prompt-builder.test.ts`
  - `tests/skills/tri-agent-prompts.test.ts`
- Delete leftover files from `9363948..b62a037`:
  - `src/protocol/deliverables-parser.ts`
  - `tests/agent/orchestrator-file-porter-sync.test.ts`
  - `tests/agent/remote-workspace-catalog.test.ts`
  - `tests/protocol/deliverables-parser.test.ts`
  - `tests/transport/file-porter-extract.test.ts`

**Interfaces:**
- Consumes: Git commit `30d22da` in `CPH-PI`
- Produces: Clean working baseline in `CPH-PI` + updated governance rules 10 & 11 in `e:\copilot-web proxy\AGENTS.md`

- [ ] **Step 1: Create backup branch and restore `9363948..b62a037` files to `30d22da`**

Run in `e:\copilot-web proxy\CPH-PI`:
```powershell
git -C "e:\copilot-web proxy\CPH-PI" branch -f backup/pre-v2-clean-restore HEAD
git -C "e:\copilot-web proxy\CPH-PI" checkout 30d22da -- `
  cph-coder-agent-prompt.txt `
  cph-main-agent-prompt.txt `
  "package/agent-bundle/Instructions-Coder-代码实现智能体.txt" `
  "package/agent-bundle/Instructions-Main-主协调智能体.txt" `
  package/agent-bundle/cph-coder-agent-prompt.txt `
  package/agent-bundle/cph-main-agent-prompt.txt `
  src/agent/orchestrator.ts `
  src/protocol/prompt-builder.ts `
  src/protocol/resilient-parser.ts `
  src/transport/file-porter.ts `
  src/workspace/pnp-sync-engine.ts `
  tests/protocol/prompt-builder.test.ts `
  tests/skills/tri-agent-prompts.test.ts `
  .gitmodules
```

- [ ] **Step 2: Remove leftover untracked/added test and parser files from the reverted commits**

Run in `e:\copilot-web proxy\CPH-PI`:
```powershell
Remove-Item -Force -ErrorAction SilentlyContinue `
  "e:\copilot-web proxy\CPH-PI\src\protocol\deliverables-parser.ts", `
  "e:\copilot-web proxy\CPH-PI\tests\agent\orchestrator-file-porter-sync.test.ts", `
  "e:\copilot-web proxy\CPH-PI\tests\agent\remote-workspace-catalog.test.ts", `
  "e:\copilot-web proxy\CPH-PI\tests\protocol\deliverables-parser.test.ts", `
  "e:\copilot-web proxy\CPH-PI\tests\transport\file-porter-extract.test.ts"
```

- [ ] **Step 3: Verify `30d22da` baseline tests pass**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/protocol/prompt-builder.test.ts tests/skills/tri-agent-prompts.test.ts
```
Expected: All tests in both files PASS.

- [ ] **Step 4: Add Rules 10 and 11 to root `e:\copilot-web proxy\AGENTS.md`**

Edit `e:\copilot-web proxy\AGENTS.md` to append Rules 10 and 11 under `## 核心开发与治理准则 (Core Development & Governance Principles)`:
```markdown
10. **Work IQ 企业内部数据访问与底座调用准则 (Work IQ & Enterprise Data Grounding Invariant)**
    - **企业内部数据与云端工作区访问底座**：在 CPH-PI 与 Copilot 交互架构中，模型访问企业内部数据（SharePoint 站点文档、OneDrive 附件、Teams 消息对象、企业知识库与 Graph 图谱索引）的核心引擎是 **Work IQ（M365 Substrate Enterprise Search / Enterprise Grounding）**。
    - **如何调用与激活 Work IQ**：
      1. **Agent 身份与模式绑定**：WebSocket 连接（`ChatHubClient`）必须绑定已开启企业工作区权限的声明式 Custom Agent ID（如 `DEFAULT_MAIN_AGENT_ID` / `DEFAULT_CODER_AGENT_ID`），使请求走 `agent: "Agent"`（BizChat 企业租户路由），而非缺失企业数据权限的普通个人 Web 模式（`agent: "web"`）。
      2. **会话初始化契约**：建立新会话或发起首轮查询时，必须生成标准 UUID 格式的 `conversationId`、`sessionId` 与 `requestId`，且首轮必须显式携带 `isStartOfSession: true`。
      3. **云端附件与 URL 规范**：通过 `SubstrateUploader`（Graph API OneDrive 上传）生成的 `File` 注释（`annotation`）挂载在消息帧 `annotations` 数组中；当通过提示词向模型提供 SharePoint 文件直链时，必须将路径中的空格等特殊字符严格编码为 `%20`（使用 `encodeUrlPathSegments`），使 Work IQ 的 `turn1search` 检索器能够精准解析并拉取企业文档原文。
    - **演进硬性前提**：后续所有架构修改、功能更新、基准实验与集成验证，**必须默认在启用 Work IQ（即绑定企业 Agent ID + 标准会话握手 + 合法编码 URL / 云端附件挂载）的基础上开展操作**。

11. **Harness 能力与系统提示词协同登记铁律 (Harness-Prompt Co-Design & Registration Invariant)**
    - **双向契约对齐**：Harness 底层实现的任何模型交互能力、工具扩展、状态回执或协议解析规则，与 Agent 系统提示词（`cph-main-agent-prompt.txt`、`cph-coder-agent-prompt.txt` 等）是一个不可分割的整体。
    - **有功能必有登记**：凡是在 Harness 中新增或调整了涉及模型输入/输出的功能（例如：新增 `remote-workspace-catalog.md` 附件挂载、支持 `write_file` 传入 `url` 下载链接、要求 `FINAL_ANSWER` 置顶声明落盘路径、回传文件落盘与云端同步回执等），**必须在系统提示词中同步完成明确的引导、协议登记与使用介绍**，并同步更新 `package/agent-bundle/` 下的分发包。绝不允许出现“Harness 写了拦截逻辑但系统提示词未告知模型怎么用”或“系统提示词教了某种格式但 Harness 未实现解析”的脱节现象。
```

---

### Task 2: IC3 Token Acquisition & Per-Account Token Routing (`TokenManager` & `AccountPool`)

**Files:**
- Modify: `CPH-PI/src/auth/token-manager.ts`
- Modify: `CPH-PI/src/auth/account-pool.ts`
- Create: `CPH-PI/tests/auth/ic3-token.test.ts`

**Interfaces:**
- Consumes: `StoredAccount.refreshToken`, `DEFAULT_CLIENT_ID`, `this.fetchFn`
- Produces:
  - `TokenManager.IC3_SCOPE` (`"openid profile offline_access https://ic3.teams.office.com/.default"`)
  - `TokenManager.getIc3AccessToken(email: string, forceRefresh?: boolean): Promise<string>`
  - `TokenManager.setCachedIc3Token(email: string, token: string, expiresAt?: number): void`
  - `AccountPool.getIc3AccessToken(email?: string): Promise<string>`

- [ ] **Step 1: Write the failing unit test `tests/auth/ic3-token.test.ts`**

Create `e:\copilot-web proxy\CPH-PI\tests\auth\ic3-token.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TokenManager, IC3_SCOPE } from "../../src/auth/token-manager.ts";
import { AccountPool } from "../../src/auth/account-pool.ts";
import { encryptToken } from "../../src/auth/crypto.ts";

describe("TokenManager & AccountPool IC3 Token Acquisition", () => {
  test("requests IC3_SCOPE without Origin header and caches token per account", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-ic3-test-"));
    const configPath = path.join(tmpDir, "accounts.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        accounts: [
          { email: "user1@example.com", refreshToken: encryptToken("rt_user1") },
          { email: "user2@example.com", refreshToken: encryptToken("rt_user2") },
        ],
      }),
      "utf8"
    );

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      const bodyStr = String(init?.body || "");
      const isUser2 = bodyStr.includes("rt_user2");
      return new Response(
        JSON.stringify({
          access_token: isUser2 ? "ic3_tok_user2" : "ic3_tok_user1",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const tm = new TokenManager(configPath, { fetchFn: mockFetch });
    const pool = new AccountPool(tm);

    expect(IC3_SCOPE).toBe("openid profile offline_access https://ic3.teams.office.com/.default");

    const tok1 = await pool.getIc3AccessToken("user2@example.com");
    expect(tok1).toBe("ic3_tok_user2");
    expect(calls.length).toBe(1);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Origin"]).toBeUndefined();
    expect(String(calls[0].init.body)).toContain(encodeURIComponent("https://ic3.teams.office.com/.default"));

    // Cached on second call
    const tok1Cached = await pool.getIc3AccessToken("user2@example.com");
    expect(tok1Cached).toBe("ic3_tok_user2");
    expect(calls.length).toBe(1);

    // Fallback when no email passed
    const tokDefault = await pool.getIc3AccessToken();
    expect(tokDefault).toBe("ic3_tok_user1");
    expect(calls.length).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/auth/ic3-token.test.ts
```
Expected: FAIL (`IC3_SCOPE` / `getIc3AccessToken` not exported/defined).

- [ ] **Step 3: Implement `IC3_SCOPE` and `getIc3AccessToken` in `src/auth/token-manager.ts` and `src/auth/account-pool.ts`**

In `e:\copilot-web proxy\CPH-PI\src\auth\token-manager.ts`:
1. Export `IC3_SCOPE`:
```typescript
export const GRAPH_SCOPE =
  "openid profile offline_access https://graph.microsoft.com/.default";
export const IC3_SCOPE =
  "openid profile offline_access https://ic3.teams.office.com/.default";
```
2. Add `public static IC3_SCOPE = IC3_SCOPE;` and `private ic3Tokens: Map<string, { token: string; expiresAt: number }> = new Map();` to `TokenManager`.
3. Clear `this.ic3Tokens` in `setCachedToken` and `clearCache`.
4. Add `getIc3AccessToken(email: string, forceRefresh = false): Promise<string>` and `setCachedIc3Token(email: string, token: string, expiresAt?: number): void`:
```typescript
  /**
   * Acquire an IC3 Teams asyncgw access token for downloading generated files
   */
  public async getIc3AccessToken(
    email: string,
    forceRefresh = false
  ): Promise<string> {
    const key = email.toLowerCase();
    const existing = this.ic3Tokens.get(key);
    const now = Date.now();

    if (!forceRefresh && existing && existing.expiresAt - now > 5 * 60 * 1000) {
      return existing.token;
    }

    const accounts = this.loadAccounts();
    const target = accounts.find((a) => a.email.toLowerCase() === key);
    if (!target) {
      throw new Error(`Account not found in accounts.json: ${email}`);
    }

    const plainRt = decryptToken(target.refreshToken);
    if (!plainRt) {
      throw new Error(`Empty refresh token for account: ${email}`);
    }

    const params = new URLSearchParams({
      client_id: DEFAULT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: plainRt,
      scope: TokenManager.IC3_SCOPE,
    });

    const res = await this.fetchFn(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Azure AD IC3 token refresh failed (${res.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    const expiresAt = now + (data.expires_in || 3600) * 1000;
    this.ic3Tokens.set(key, { token: data.access_token, expiresAt });
    return data.access_token;
  }

  /**
   * Cache an IC3 token (useful for mocking/testing)
   */
  public setCachedIc3Token(email: string, token: string, expiresAt?: number): void {
    this.ic3Tokens.set(email.toLowerCase(), {
      token,
      expiresAt: expiresAt ?? Date.now() + 3600_000,
    });
  }
```

In `e:\copilot-web proxy\CPH-PI\src\auth\account-pool.ts`, add `getIc3AccessToken(email?: string): Promise<string>` right below `getGraphAccessToken`:
```typescript
  /**
   * Acquire an IC3 Teams access token from the specified account or first healthy account in pool.
   */
  public async getIc3AccessToken(email?: string): Promise<string> {
    if (email) {
      try {
        return await this.manager.getIc3AccessToken(email);
      } catch {
        // Fall through to pool scan if specified account fails
      }
    }
    const accounts = this.refreshAccountList();
    if (accounts.length === 0) {
      throw new Error(`No accounts configured in ${this.manager.getConfigPath()}`);
    }

    const now = Date.now();
    const total = accounts.length;
    const startIndex = this.currentIndex;

    for (let i = 0; i < total; i++) {
      const idx = (startIndex + i) % total;
      const acc = accounts[idx];
      const key = acc.email.toLowerCase();
      const status = this.statuses.get(key);
      if (!status) continue;
      if (status.authExpired || status.isAvailable === false) continue;
      if (status.isThrottled && now >= status.cooldownUntil) {
        status.isThrottled = false;
        status.cooldownUntil = 0;
      }
      if (status.isThrottled) continue;

      try {
        return await this.manager.getIc3AccessToken(acc.email);
      } catch (err) {
        if (this.isFatalAuthGrantError(err)) {
          this.markAuthExpired(acc.email, String((err as any)?.message || err));
        }
      }
    }

    throw new Error("No healthy accounts available in pool for IC3 access token");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/auth/ic3-token.test.ts
```
Expected: PASS.

---

### Task 3: `DeliverablesParser` & `ResilientParser` Priority & Auto-Execution Hardening

**Files:**
- Create: `CPH-PI/src/protocol/deliverables-parser.ts`
- Modify: `CPH-PI/src/protocol/resilient-parser.ts`
- Create: `CPH-PI/tests/protocol/deliverables-parser.test.ts`
- Create: `CPH-PI/tests/protocol/resilient-parser-precedence.test.ts`

**Interfaces:**
- Consumes: Raw model turn text (`string`)
- Produces:
  - `DeliverablesParser.extractDeliverables(text: string, workspaceRoot?: string): DeliverableSpec[]`
  - `DeliverableSpec`: `{ targetPath: string; downloadUrl: string; isDirectory: boolean; isZip: boolean }`
  - `ResilientParser.parse(text: string): ParsedTurn` (evaluating `handoff` and `FINAL_ANSWER` before generic ``` blocks, supporting `url` in `write_file`, and never auto-executing Markdown links)

- [ ] **Step 1: Write the failing unit tests for `DeliverablesParser` and `ResilientParser`**

Create `e:\copilot-web proxy\CPH-PI\tests\protocol\deliverables-parser.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { DeliverablesParser } from "../../src/protocol/deliverables-parser.ts";

describe("DeliverablesParser", () => {
  test("extracts deliverables with <- and -> separators, markdown links, and zip semantics", () => {
    const text = `FINAL_ANSWER:
【交付文件与落盘指引 / Deliverables】
- \`test/CNNJI-QUERY-review-2026-10-25.md\` <- [下载审查报告](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-123/views/original/CNNJI-QUERY-review-2026-10-25.md)
- \`test/package.zip\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/CNNJI-QUERY-review-package-2026-10-25.zip
- \`test/extracted/\` -> [下载压缩包](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/pkg.zip)

# 审查报告正文
普通参考链接: [参考文档](https://cmacgmgroup.sharepoint.com/sites/test/doc.md)
- 普通冒号说明: https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/should-not-match/views/original/ignore.md
`;

    const items = DeliverablesParser.extractDeliverables(text, "E:/test");
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual({
      targetPath: "test/CNNJI-QUERY-review-2026-10-25.md",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-123/views/original/CNNJI-QUERY-review-2026-10-25.md",
      isDirectory: false,
      isZip: false,
    });

    // Target path ends with .zip -> isDirectory: false, isZip: true
    expect(items[1]).toEqual({
      targetPath: "test/package.zip",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/CNNJI-QUERY-review-package-2026-10-25.zip",
      isDirectory: false,
      isZip: true,
    });

    // Target path ends with / -> isDirectory: true, isZip: true
    expect(items[2]).toEqual({
      targetPath: "test/extracted/",
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-456/views/original/pkg.zip",
      isDirectory: true,
      isZip: true,
    });
  });

  test("rejects path traversal and absolute paths outside workspace", () => {
    const text = `【交付文件与落盘指引 / Deliverables】
- \`../outside/evil.sh\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/1/views/original/evil.sh
- \`C:/Windows/System32/cmd.exe\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/2/views/original/cmd.exe
- \`valid/report.md\` <- https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/3/views/original/report.md
`;
    const items = DeliverablesParser.extractDeliverables(text, "E:/test");
    expect(items).toHaveLength(1);
    expect(items[0].targetPath).toBe("valid/report.md");
  });
});
```

Create `e:\copilot-web proxy\CPH-PI\tests\protocol\resilient-parser-precedence.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { ResilientParser } from "../../src/protocol/resilient-parser.ts";

describe("ResilientParser Precedence & File Porter Safety", () => {
  test("FINAL_ANSWER with code blocks Containing 'tool:' or 'path:' is parsed as final_answer, not action", () => {
    const response = `FINAL_ANSWER:
【交付文件与落盘指引 / Deliverables】
- \`test/report.md\` <- [report.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-1/views/original/report.md)

# 代码审查结论
我们在配置中看到了如下片段：
\`\`\`yaml
tool: read_file
path: src/index.ts
\`\`\`
全部审查已完成。`;

    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("final_answer");
  });

  test("write_file action with url field is parsed with downloadUrl and path", () => {
    const response = `THOUGHT: 我已生成脚本文件，现在通过 write_file 落盘。
\`\`\`json:action
{
  "tool": "write_file",
  "path": "src/generated/helper.ts",
  "url": "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/helper.ts"
}
\`\`\``;

    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("action");
    if (parsed.type === "action") {
      expect(parsed.action.tool).toBe("write_file");
      expect(parsed.action.path).toBe("src/generated/helper.ts");
      expect(parsed.action.downloadUrl).toBe(
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/helper.ts"
      );
      expect(parsed.action.autoExecute).toBe(false);
    }
  });

  test("plain markdown https link in conversational text is NOT hijacked into auto-executing file_porter", () => {
    const response = `请参考 [deploy.py](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-99/views/original/deploy.py)`;
    const parsed = ResilientParser.parse(response);
    expect(parsed.type).toBe("invalid_chatter");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/protocol/deliverables-parser.test.ts tests/protocol/resilient-parser-precedence.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/protocol/deliverables-parser.ts` and update `src/protocol/resilient-parser.ts`**

Create `e:\copilot-web proxy\CPH-PI\src\protocol\deliverables-parser.ts`:
```typescript
import path from "node:path";

export interface DeliverableSpec {
  targetPath: string;
  downloadUrl: string;
  isDirectory: boolean;
  isZip: boolean;
}

export class DeliverablesParser {
  /**
   * Extracts structured deliverable mappings from the top-pinned
   * 【交付文件与落盘指引 / Deliverables】 section (or explicit `<-` / `->` / `←` / `→` lines).
   * Bare colons `:` are intentionally NOT matched to prevent false positives in prose.
   */
  public static extractDeliverables(
    text: string,
    workspaceRoot?: string
  ): DeliverableSpec[] {
    if (!text || typeof text !== "string") return [];

    // Limit scan to the Deliverables block if header is present, or first 60 lines of text
    let scopeText = text;
    const headerMatch = text.match(
      /【\s*交付文件与落盘指引\s*(?:\/\s*Deliverables)?\s*】([\s\S]*?)(?:\n\s*#{1,6}\s+|\n\s*---|\n\n\n|$)/i
    );
    if (headerMatch) {
      scopeText = headerMatch[1];
    } else {
      scopeText = text.split(/\r?\n/).slice(0, 60).join("\n");
    }

    const lines = scopeText.split(/\r?\n/);
    const results: DeliverableSpec[] = [];
    const seen = new Set<string>();

    // Matches: - `target/path` <- [label](https://...) or - target/path <- https://...
    const lineRegex =
      /^\s*[-*+]\s+`?([^`<\->←→\r\n]+?)`?\s*(?:<-|->|←|→)\s*(?:\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/\S+))/i;

    for (const line of lines) {
      const m = line.match(lineRegex);
      if (!m) continue;

      const rawTarget = m[1].trim().replace(/^['"`]|['"`]$/g, "");
      const rawUrl = (m[2] || m[3] || "").trim().replace(/[).,;]+$/, "");
      if (!rawTarget || !rawUrl) continue;

      // Validate target path safety (reject absolute paths and `..` traversal)
      const normTarget = rawTarget.replace(/\\/g, "/");
      if (
        normTarget.startsWith("/") ||
        /^[a-zA-Z]:/.test(normTarget) ||
        normTarget.split("/").some((seg) => seg === "..")
      ) {
        continue;
      }

      if (workspaceRoot) {
        const absRoot = path.resolve(workspaceRoot);
        const absTarget = path.resolve(absRoot, normTarget);
        const rel = path.relative(absRoot, absTarget);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          continue;
        }
      }

      const isDirectory = normTarget.endsWith("/");
      let urlPathname = "";
      try {
        urlPathname = new URL(rawUrl).pathname.toLowerCase();
      } catch {
        urlPathname = rawUrl.toLowerCase();
      }
      const isZip =
        urlPathname.endsWith(".zip") || normTarget.toLowerCase().endsWith(".zip");

      const dedupeKey = `${normTarget}::${rawUrl}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({
        targetPath: normTarget,
        downloadUrl: rawUrl,
        isDirectory,
        isZip,
      });
    }

    return results;
  }
}
```

Update `e:\copilot-web proxy\CPH-PI\src\protocol\resilient-parser.ts`:
1. In `ResilientParser.parse(text: string)`:
   - Keep step `0` (`handoff` fenced block).
   - Check explicit `action` fenced blocks (` ```action `, ` ```json:action `, ` ```yaml:action `) first; if there is NO explicit action fence, check `FINAL_ANSWER` (`/(?:^|\n)\s*(?:```(?:markdown:)?FINAL_?ANSWER\b:?|FINAL_?ANSWER\b:?|_ANSWER\b:?|ALL_TASKS_COMPLETED|【已完成交付】)([\s\S]*)$/i`) **before** falling back to generic ` ```json ` or ` ``` ` blocks! That way, `FINAL_ANSWER` reports containing sample ` ```yaml ` or ` ```json ` blocks are never misclassified as `action`.
   - In step `2c` (HTML anchor / blob link fallback), match only explicit `<a ... download="..." href="...">` or `blob:` links (remove generic `https?://` Markdown link matching so normal Markdown links in responses are not hijacked into `file_porter`), and set `autoExecute: false` by default.
   - In `extractActionFields`, default `autoExecute` to `Boolean(obj.autoExecute ?? obj.auto_execute ?? false)` (never auto-true based solely on file extension).

- [ ] **Step 4: Run tests to verify they pass**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/protocol/deliverables-parser.test.ts tests/protocol/resilient-parser-precedence.test.ts tests/protocol/
```
Expected: All protocol tests PASS.

---

### Task 4: `FilePorter` Authenticated `asyncgw` Download & Path-Semantic `.zip` Extraction

**Files:**
- Modify: `CPH-PI/src/transport/file-porter.ts`
- Create: `CPH-PI/tests/transport/file-porter.test.ts`

**Interfaces:**
- Consumes: `ic3TokenProvider?: () => Promise<string | undefined>`, `graphTokenProvider?: () => Promise<string | undefined>`, `adm-zip`
- Produces:
  - `FilePorter.normalizeAsyncGwUrl(rawUrl: string): { fetchUrl: string; fileNameFromUrl?: string }`
  - `FilePorter.assertAllowedDownloadUrl(rawUrl: string): URL`
  - `FilePorter.deliverToWorkspace(params: DeliverToWorkspaceParams): Promise<DeliverToWorkspaceResult>`
  - `DeliverToWorkspaceParams`: `{ downloadUrl: string; destinationPath: string; isDirectory?: boolean; isZip?: boolean }`
  - `DeliverToWorkspaceResult`: `{ landedFiles: string[]; extractedFromZip: boolean }`

- [ ] **Step 1: Write the failing unit test `tests/transport/file-porter.test.ts`**

Create `e:\copilot-web proxy\CPH-PI\tests\transport\file-porter.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { FilePorter } from "../../src/transport/file-porter.ts";

describe("FilePorter asyncgw normalization, SSRF guard, and zip semantics", () => {
  test("normalizeAsyncGwUrl extracts filename, preserves query params, and strips trailing filename after /views/original", () => {
    const raw =
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-f6c040c7/views/original/CNNJI-QUERY-review-2026-10-25.md?version=1";
    const norm = FilePorter.normalizeAsyncGwUrl(raw);
    expect(norm.fileNameFromUrl).toBe("CNNJI-QUERY-review-2026-10-25.md");
    expect(norm.fetchUrl).toBe(
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frc-d3-f6c040c7/views/original?version=1"
    );
  });

  test("rejects disallowed hosts (SSRF guard)", () => {
    expect(() =>
      FilePorter.assertAllowedDownloadUrl("http://169.254.169.254/latest/meta-data")
    ).toThrow(/Disallowed download host/i);
    expect(() =>
      FilePorter.assertAllowedDownloadUrl(
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/123/views/original"
      )
    ).not.toThrow();
  });

  test("downloads with IC3 token and saves .zip as-is when destinationPath ends with .zip, or extracts with prefix dedup when destinationPath is a directory", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cph-porter-ws-"));

    // Build an in-memory zip with top-level folder `test/`
    const zip = new AdmZip();
    zip.addFile("test/report.md", Buffer.from("# Review Report\n", "utf8"));
    zip.addFile("test/sub/detail.txt", Buffer.from("detail content", "utf8"));
    const zipBuffer = zip.toBuffer();

    const authHeadersSeen: string[] = [];
    const urlsSeen: string[] = [];

    const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urlsSeen.push(String(input));
      const headers = (init?.headers || {}) as Record<string, string>;
      authHeadersSeen.push(headers["Authorization"] || "");
      return new Response(zipBuffer, { status: 200 });
    }) as typeof fetch;

    const porter = new FilePorter({
      cwd: tmpWorkspace,
      ic3TokenProvider: async () => "ic3_secret_token",
      fetchFn: mockFetch,
    });

    // Case A: destinationPath ends with .zip -> save .zip file as-is
    const resZipFile = await porter.deliverToWorkspace({
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original/pkg.zip",
      destinationPath: "test/my-archive.zip",
    });

    expect(urlsSeen[0]).toBe(
      "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original"
    );
    expect(authHeadersSeen[0]).toBe("Bearer ic3_secret_token");
    expect(resZipFile.extractedFromZip).toBe(false);
    expect(resZipFile.landedFiles).toEqual(["test/my-archive.zip"]);
    expect(fs.existsSync(path.join(tmpWorkspace, "test/my-archive.zip"))).toBe(true);

    // Case B: destinationPath is directory "test/" -> extract and deduplicate leading "test/"
    const resExtract = await porter.deliverToWorkspace({
      downloadUrl:
        "https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/0-frs-d4-111/views/original/pkg.zip",
      destinationPath: "test/",
    });

    expect(resExtract.extractedFromZip).toBe(true);
    expect(resExtract.landedFiles.sort()).toEqual(["test/report.md", "test/sub/detail.txt"]);
    expect(
      fs.readFileSync(path.join(tmpWorkspace, "test/report.md"), "utf8")
    ).toBe("# Review Report\n");
    // Ensure no double test/test/report.md
    expect(fs.existsSync(path.join(tmpWorkspace, "test/test/report.md"))).toBe(false);

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/transport/file-porter.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `FilePorter` enhancements in `src/transport/file-porter.ts`**

Update `e:\copilot-web proxy\CPH-PI\src\transport\file-porter.ts`:
- Add `ic3TokenProvider?: () => Promise<string | undefined>`, `graphTokenProvider?: () => Promise<string | undefined>`, and `fetchFn?: typeof fetch` to `FilePorterOptions`.
- Implement `public static normalizeAsyncGwUrl(rawUrl: string): { fetchUrl: string; fileNameFromUrl?: string }`:
  ```typescript
  public static normalizeAsyncGwUrl(rawUrl: string): {
    fetchUrl: string;
    fileNameFromUrl?: string;
  } {
    try {
      const u = new URL(rawUrl);
      if (u.hostname.endsWith(".asyncgw.teams.microsoft.com")) {
        const match = u.pathname.match(
          /^(\/v1\/objects\/[^/]+\/views\/[^/]+)(?:\/([^/]+))?$/i
        );
        if (match) {
          const fileNameFromUrl = match[2]
            ? decodeURIComponent(match[2])
            : undefined;
          u.pathname = match[1];
          return { fetchUrl: u.toString(), fileNameFromUrl };
        }
      }
      const base = path.posix.basename(u.pathname);
      return {
        fetchUrl: rawUrl,
        fileNameFromUrl: base && base !== "/" ? decodeURIComponent(base) : undefined,
      };
    } catch {
      return { fetchUrl: rawUrl };
    }
  }
  ```
- Implement `public static assertAllowedDownloadUrl(rawUrl: string): URL` allowing only `*.asyncgw.teams.microsoft.com`, `*.sharepoint.com`, `*.1drv.com`, `graph.microsoft.com`, `*.office.com`, `*.cloud.microsoft`.
- Implement `private async downloadBinary(rawUrl: string): Promise<{ buffer: Buffer; fileNameFromUrl?: string }>` using `ic3TokenProvider` for `asyncgw` hosts (falling back to `graphTokenProvider` if 401/403) and enforcing a 100 MB response size limit.
- Implement `public async deliverToWorkspace(params: DeliverToWorkspaceParams): Promise<DeliverToWorkspaceResult>`:
  - Verify `destinationPath` resolves strictly inside `this.cwd`.
  - Determine `isDirTarget = Boolean(params.isDirectory || /[\\/]$/.test(params.destinationPath))`.
  - Determine `isExplicitZipFile = params.destinationPath.toLowerCase().endsWith(".zip")`.
  - Determine `isZipPayload = Boolean(params.isZip || fileNameFromUrl?.toLowerCase().endsWith(".zip") || isExplicitZipFile)`.
  - If `isZipPayload && !isExplicitZipFile` (i.e. target is a directory): open with `AdmZip(buffer)`, check `entries.length <= 200`, total uncompressed bytes `<= 100 * 1024 * 1024`, reject any entry with `..` or absolute path, strip redundant top-level folder prefix if it matches `path.basename(targetDir)`, write each file, and return `landedFiles` (relative to `this.cwd` with `/` separators) and `extractedFromZip: true`.
  - Otherwise (single file OR `isExplicitZipFile`): if `isDirTarget`, append `fileNameFromUrl || "downloaded_file"`; write `buffer` directly to disk and return `landedFiles: [relPath]`, `extractedFromZip: false`.
- In `saveAndExecute`, change `const shouldExecute = params.autoExecute === true;` (default `false`), and use `this.downloadBinary(params.downloadUrl)` for HTTP(S) URLs.

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/transport/file-porter.test.ts
```
Expected: PASS.

---

### Task 5: `PnPWorkspaceSyncEngine`, `PromptBuilder`, & `main-plan-snapshot` (Pure Catalog Attachment & URL Deduplication)

**Files:**
- Modify: `CPH-PI/src/workspace/pnp-sync-engine.ts`
- Modify: `CPH-PI/src/protocol/prompt-builder.ts`
- Modify: `CPH-PI/src/session/main-plan-snapshot.ts`
- Modify: `CPH-PI/tests/protocol/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `SyncManifest`, `workspaceRoot`
- Produces:
  - `PnPWorkspaceSyncEngine.resolveCloudTarget(workspaceRoot: string, manifest?: SyncManifest | null): { siteUrl: string; targetFolder: string } | null`
  - `PnPWorkspaceSyncEngine.buildSharePointWebUrl(siteUrl: string, targetFolder: string, relPath?: string, serverRelativeUrl?: string): string`
  - `PnPWorkspaceSyncEngine.generateCatalogMarkdown(workspaceRoot: string, manifest?: SyncManifest | null, siteUrl?: string, targetFolder?: string): string`
  - `PromptBuilder.buildFileSavedAndSyncedReceipt(params: { toolName: string; landedFiles: Array<{ relPath: string; cloudWebUrl?: string }>; taskInvariant?: string }): string`

- [ ] **Step 1: Write unit tests in `tests/protocol/prompt-builder.test.ts` for catalog generation, URL deduplication, and inline-free prompts**

Add tests to `e:\copilot-web proxy\CPH-PI\tests\protocol\prompt-builder.test.ts` testing:
1. `PnPWorkspaceSyncEngine.buildSharePointWebUrl` does NOT duplicate `/sites/CMA-GBSC_BKGDOMAIN` whether `targetFolder` starts with `AFRASIA/...` or `/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/...`, and encodes spaces as `%20`.
2. `PnPWorkspaceSyncEngine.resolveCloudTarget` returns `null` when neither `manifest.targetFolder` nor `process.env.CPH_SP_TARGET_FOLDER` is configured (never falling back to personal `Vincent Fu/WorkSpace/live test`).
3. `PnPWorkspaceSyncEngine.generateCatalogMarkdown` produces both `## 1. 工作区目录结构 (Directory Skeleton)` and `## 2. 文件映射清单 (File Mapping Index)` including `[CLOUD-READY]`, `[LOCAL-NEW]`, and `[LOCAL-ONLY]` files.
4. `PromptBuilder.buildDirectAgentPrompt` and `formatSuccessorTurn1Prompt` do NOT inline `dirSkeleton` or `[SHAREPOINT REMOTE WORKSPACE]`, and instead reference the attached `remote-workspace-catalog.md`.
5. `PromptBuilder.buildFileSavedAndSyncedReceipt` emits `已同步至云端工作区: <url>` when `cloudWebUrl` is present, and `文件已落盘至本地: <relPath>` when `cloudWebUrl` is undefined (e.g. `.zip` binary or unconfigured cloud target).

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/protocol/prompt-builder.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `resolveCloudTarget`, `buildSharePointWebUrl`, `generateCatalogMarkdown`, and prompt updates**

1. In `e:\copilot-web proxy\CPH-PI\src\workspace\pnp-sync-engine.ts`:
   - Add `resolveCloudTarget(workspaceRoot: string, manifest?: SyncManifest | null)`:
     ```typescript
     public static resolveCloudTarget(
       workspaceRoot: string,
       manifest?: SyncManifest | null
     ): { siteUrl: string; targetFolder: string } | null {
       const loaded =
         manifest ??
         this.loadManifest(path.join(workspaceRoot, ".cph", "state", "sync-manifest.json"));
       const targetFolder =
         loaded?.targetFolder?.trim() || process.env.CPH_SP_TARGET_FOLDER?.trim() || "";
       if (!targetFolder) {
         return null;
       }
       const siteUrl =
         loaded?.siteUrl?.trim() ||
         process.env.CPH_SP_SITE_URL?.trim() ||
         this.DEFAULT_SITE_URL;
       return { siteUrl, targetFolder };
     }
     ```
   - Add `buildSharePointWebUrl(siteUrl: string, targetFolder: string, relPath?: string, serverRelativeUrl?: string): string`:
     ```typescript
     public static buildSharePointWebUrl(
       siteUrl: string,
       targetFolder: string,
       relPath?: string,
       serverRelativeUrl?: string
     ): string {
       const cleanSite = siteUrl.replace(/\/+$/, "");
       let origin = cleanSite;
       let sitePathPrefix = "";
       try {
         const u = new URL(cleanSite);
         origin = u.origin;
         sitePathPrefix = u.pathname.replace(/\/+$/, "");
       } catch {}

       if (serverRelativeUrl) {
         const normSrv = serverRelativeUrl.startsWith("/")
           ? serverRelativeUrl
           : `/${serverRelativeUrl}`;
         const encodedSrv = encodeUrlPathSegments(normSrv);
         if (sitePathPrefix && normSrv.toLowerCase().startsWith(sitePathPrefix.toLowerCase() + "/")) {
           return `${origin}/${encodedSrv}`;
         }
         return `${cleanSite}/${encodedSrv}`;
       }

       let cleanFolder = targetFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
       const sitePrefixNoSlash = sitePathPrefix.replace(/^\/+/, "");
       if (
         sitePrefixNoSlash &&
         cleanFolder.toLowerCase().startsWith(sitePrefixNoSlash.toLowerCase() + "/")
       ) {
         cleanFolder = cleanFolder.slice(sitePrefixNoSlash.length + 1);
       }
       const encodedFolder = encodeUrlPathSegments(cleanFolder);
       const baseUrl = encodedFolder ? `${cleanSite}/${encodedFolder}` : cleanSite;
       if (!relPath) return baseUrl;
       const encodedRel = encodeUrlPathSegments(relPath);
       return encodedRel ? `${baseUrl}/${encodedRel}` : baseUrl;
     }
     ```
   - Add `generateCatalogMarkdown(workspaceRoot: string, manifest?: SyncManifest | null, siteUrl?: string, targetFolder?: string): string` which scans the 2-level directory skeleton and all non-ignored workspace files (excluding `.git`, `.cph`, `node_modules`, `dist`, `build`, `.next`), rendering:
     - Header with Workspace Root, Remote Root URL (if cloud target configured), and timestamp
     - `## 1. 工作区目录结构 (Directory Skeleton)`
     - `## 2. 文件映射清单 (File Mapping Index)` with `[CLOUD-READY]`, `[LOCAL-NEW]`, or `[LOCAL-ONLY]` status per file.
   - Ensure `syncFile` registers `options.signal?.addEventListener("abort", () => { try { child.kill(); } catch {} }, { once: true })` so `AbortController.abort()` immediately terminates the PowerShell process on timeout.

2. In `e:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts`:
   - Remove inline `dirTree`, `dirSkeleton`, and `virtualRepoMap` from `buildTurn1Prompt`, `buildDirectAgentPrompt`, `buildHandshakePrompt`, and `buildReGroundingPrompt`. Replace with a concise pointer:
     `- 工作区目录与云端文件索引: 已作为云端附件【remote-workspace-catalog.md】随本轮消息挂载（含 2 层目录树与 SharePoint 文件直链清单）`
   - Add `buildFileSavedAndSyncedReceipt`:
     ```typescript
     public static buildFileSavedAndSyncedReceipt(params: {
       toolName: string;
       landedFiles: Array<{ relPath: string; cloudWebUrl?: string }>;
       taskInvariant?: string;
     }): string {
       const lines = params.landedFiles.map((item) =>
         item.cloudWebUrl
           ? `✔ 文件已落盘至本地: ${item.relPath}\n✔ 已同步至云端工作区: ${item.cloudWebUrl}`
           : `✔ 文件已落盘至本地: ${item.relPath}`
       );
       const invariantBlock =
         params.taskInvariant && params.taskInvariant.trim() !== ""
           ? `\n【当前推进战役北极星 (Task Invariant)】:\n${params.taskInvariant.trim()}\n`
           : "";
       return `[TOOL_RESULT for ${params.toolName} - SUCCESS]:\n${lines.join("\n")}\n${invariantBlock}\n${this.PROTOCOL_REMINDER}`;
     }
     ```

3. In `e:\copilot-web proxy\CPH-PI\src\session\main-plan-snapshot.ts`:
   - In `formatSuccessorTurn1Prompt`, remove inline `skeletonFact` and `repoMapFact`, and include:
     `- **工作区目录与云端文件索引**: 已作为云端附件 \`remote-workspace-catalog.md\` 随本轮消息挂载`

- [ ] **Step 4: Run tests to verify they pass**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/protocol/prompt-builder.test.ts tests/scripts/sp-sync-engine.test.ts tests/workspace/mirror-guard.test.ts
```
Expected: PASS.

---

### Task 6: `Orchestrator` & `SubagentRunner` Per-Account Attachment Lifecycle, `FilePorter` Interception & `FINAL_ANSWER` Sync

**Files:**
- Modify: `CPH-PI/src/agent/orchestrator.ts`
- Modify: `CPH-PI/src/agent/subagent-runner.ts`
- Create: `CPH-PI/tests/agent/catalog-attachment-and-porter.test.ts`

**Interfaces:**
- Consumes: `DeliverablesParser`, `FilePorter`, `PnPWorkspaceSyncEngine`, `SubstrateUploader`, `PromptBuilder`
- Produces:
  - Per-account `ensureWorkspaceCatalogAttachment(email: string, signal?: AbortSignal): Promise<AttachmentAnnotation | null>` cached in `.cph/state/workspace-catalog-cache.json` (`entries[email]`)
  - Per-account `workspace-snapshot-cache.json` (`entries[email]`)
  - Intermediate `write_file` URL interception (`action.downloadUrl || action.url`) -> `FilePorter.deliverToWorkspace` -> `syncAndFormatReceipt`
  - Post-write (`write_file`, `edit`, `patch_file`, `file_porter`) SharePoint sync with `AbortController` 15s timeout and honest receipt (`synced`/`skipped` -> cloud URL; binary/failed -> local-only)
  - `FINAL_ANSWER` deliverables landing + SharePoint sync + `.cph/state/delivery-report.json` before `onTurnEnd` / `onCompleted` without sending a model receipt

- [ ] **Step 1: Write integration test `tests/agent/catalog-attachment-and-porter.test.ts`**

Create `e:\copilot-web proxy\CPH-PI\tests\agent\catalog-attachment-and-porter.test.ts` covering:
1. Turn 1 mounts `remote-workspace-catalog.md` annotation using the active leased account's Graph token, and caches by `entries[email]`; switching account on 429 or awakening a successor session (`generation++`) re-uploads/re-resolves `remote-workspace-catalog.md` for the new account and preserves `options.initialAnnotations`.
2. Intermediate turn `write_file` with `url` downloads via `FilePorter`, syncs to SharePoint, and sends `PromptBuilder.buildFileSavedAndSyncedReceipt` in the next turn prompt; if the landed file is a `.zip` (skipped by SharePoint sync), the receipt states `✔ 文件已落盘至本地: ...` without claiming a SharePoint URL.
3. `FINAL_ANSWER` containing `【交付文件与落盘指引 / Deliverables】` downloads all deliverables via `FilePorter`, syncs indexable files to SharePoint, writes `.cph/state/delivery-report.json`, and terminates the session (`completed: true`, `turnsCount: 1`) **without** sending a follow-up receipt message to the model.

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/agent/catalog-attachment-and-porter.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `Orchestrator` and `SubagentRunner` lifecycle & porter integration**

1. In `e:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts`:
   - Track `private activeAccountEmail: string = "";` whenever a token is acquired (`token.email`) or switched (`nextToken.email`), or read from `(client as any)?.token?.email`.
   - Update `acquireGraphToken(email?: string): Promise<string | undefined>` to pass `email || this.activeAccountEmail || undefined` to `(this.pool as any).getGraphAccessToken(targetEmail)`.
   - Add `acquireIc3Token(email?: string): Promise<string | undefined>` calling `(this.pool as any).getIc3AccessToken(email || this.activeAccountEmail || undefined)`.
   - Implement `private async ensureWorkspaceCatalogAttachment(email?: string, signal?: AbortSignal, events?: OrchestratorEvents): Promise<AttachmentAnnotation | null>`:
     - Generates `remote-workspace-catalog.md` via `PnPWorkspaceSyncEngine.generateCatalogMarkdown(this.workspaceRoot)` and writes to `.cph/state/remote-workspace-catalog.md`.
     - Computes SHA-256 hash and checks `.cph/state/workspace-catalog-cache.json` under `entries[(email || "default").toLowerCase()]`.
     - If hash matches, returns cached `uploadResult.annotation`; otherwise uploads via `SubstrateUploader.uploadDocumentToOneDrive(graphToken, catalogMd, "remote-workspace-catalog.md")` and saves cache entry.
   - Update `workspace-snapshot-cache.json` lookup/persistence to also key under `entries[(this.activeAccountEmail || "default").toLowerCase()]` (preserving backward compatibility if top-level `snapshotHash` exists in mock tests when `activeAccountEmail` is empty).
   - Mount `catalogAnnotation` at Turn 1 alongside `options.initialAnnotations` (`currentAnnotations = [...initialAnnotations, catalogAnnotation]`).
   - When `onRateLimitDetected` switches to `nextToken.email`, update `this.activeAccountEmail = nextToken.email`; when `invoke_subagent` transitions to a successor session (`this.generation++`), update `this.activeAccountEmail` from the successor's token and call `ensureWorkspaceCatalogAttachment(this.activeAccountEmail, signal, events)` so the successor Turn 1 receives the catalog attachment for its leased account.
   - In Case 3c (`parsed.type === "action"`):
     - If `parsed.action.tool === "write_file"` and `(parsed.action.downloadUrl || (parsed.action as any).url)` is present without inline `content`, execute `FilePorter.deliverToWorkspace` to land the file(s) locally, then run the post-write SharePoint sync & receipt builder.
     - For any successful `write_file`, `edit`, `patch_file`, or `file_porter`, run `syncLandedFilesToCloud(landedRelPaths)` (which uses `PnPWorkspaceSyncEngine.resolveCloudTarget` and `AbortController` 15s timeout), regenerate `.cph/state/remote-workspace-catalog.md`, and for `write_file` / `file_porter` use `PromptBuilder.buildFileSavedAndSyncedReceipt` as the next turn prompt (honestly reporting `cloudWebUrl` only when `syncRes.status === "synced" || syncRes.status === "skipped"` and `!isNonIndexableBinary(relPath)`).
   - In Case 3a (`parsed.type === "final_answer"`):
     - Before calling `events?.onTurnEnd` and `events?.onCompleted`, call `DeliverablesParser.extractDeliverables(turnResponseText, this.workspaceRoot)`.
     - For each deliverable spec, invoke `FilePorter.deliverToWorkspace`, then sync landed files via `syncLandedFilesToCloud`, write `.cph/state/delivery-report.json`, and append a user-facing summary block `【Harness 物理落盘与云端同步核验】` to `finalAnswer`. Do **not** send any message back to `client.sendMessage`.

2. In `e:\copilot-web proxy\CPH-PI\src\agent\subagent-runner.ts`:
   - In lines 495 and 528, pass `subagentAccount || undefined` into `this.pool.getGraphAccessToken(subagentAccount || undefined)`.

- [ ] **Step 4: Run integration and regression tests**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/agent/catalog-attachment-and-porter.test.ts tests/agent/subagent-runner.test.ts
```
Expected: PASS.

---

### Task 7: System Prompts Co-Design Registration (`cph-main-agent-prompt.txt` & `cph-coder-agent-prompt.txt`) & Bundle Packaging

**Files:**
- Modify: `CPH-PI/package/agent-bundle/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/package/agent-bundle/cph-coder-agent-prompt.txt`
- Modify: `CPH-PI/cph-main-agent-prompt.txt`
- Modify: `CPH-PI/cph-coder-agent-prompt.txt`
- Modify: `CPH-PI/package/agent-bundle/Instructions-Main-主协调智能体.txt`
- Modify: `CPH-PI/package/agent-bundle/Instructions-Coder-代码实现智能体.txt`
- Modify: `CPH-PI/tests/skills/tri-agent-prompts.test.ts`

**Interfaces:**
- Consumes: Rules 3, 6, 8, 9, 10, 11 from `AGENTS.md`
- Produces: Synchronized Main & Coder system prompts + rebuilt `package/agent-bundle/copilot-agent-bundle.zip`

- [ ] **Step 1: Update `tests/skills/tri-agent-prompts.test.ts` to assert prompt registration invariants**

Add assertions in `e:\copilot-web proxy\CPH-PI\tests\skills\tri-agent-prompts.test.ts` verifying that both `cph-main-agent-prompt.txt` and `cph-coder-agent-prompt.txt`:
- Register the cloud attachment `remote-workspace-catalog.md`
- State the reading strategy: cloud-first via SharePoint URL, with `read_file` as local fallback
- Register `url` in `write_file` (`"url": "当使用云端文件生成能力产出文件时，填入下载链接..."`)
- Register `【交付文件与落盘指引 / Deliverables】` at the top of `FINAL_ANSWER` with `- \`<目标路径>\` <- [文件名称](<下载链接>)` and `.zip` path semantics
- Contain zero negative prohibition words (`严禁`, `切勿`, `禁止`, `不要`, `不得`, `绝不`).

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/skills/tri-agent-prompts.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Update `cph-main-agent-prompt.txt` and `cph-coder-agent-prompt.txt` and run `bun run package`**

Update `package/agent-bundle/cph-main-agent-prompt.txt` and `package/agent-bundle/cph-coder-agent-prompt.txt` (and mirror to root `cph-main-agent-prompt.txt`, `cph-coder-agent-prompt.txt`, and `Instructions-*.txt` via `bun run package`) with the constructive guidance from Section 5 of the design spec:
1. **Cloud Workspace Catalog Attachment & Reading Priority**:
   - System attaches `remote-workspace-catalog.md` containing the 2-level directory skeleton and full SharePoint URL mapping table.
   - Read files **cloud-first via SharePoint URLs**; when a file is marked `[LOCAL-NEW]` / `[LOCAL-ONLY]` or requires exact local line context, use `read_file` as local fallback.
2. **File Creation, Download Link Landing & Automatic Cloud Sync**:
   - In intermediate turns, pass `"url": "<downloadUrl>"` and `"path": "<targetRelativePath>"` in `write_file` (or `"content"` for small files); the system downloads the file to `<path>`, syncs it to SharePoint, and returns a local + cloud receipt.
   - Prefer generating individual files directly; if a `.zip` archive is generated, set target path to `<path/to/archive.zip>` to save the `.zip` file as-is, or set target path to a directory `<target/dir/>` to extract into that directory.
3. **`FINAL_ANSWER` Top-Pinned Deliverables Declaration**:
   ```markdown:FINAL_ANSWER
   【交付文件与落盘指引 / Deliverables】
   - `相对工作区目录路径/文件名.ext` <- [文件名称](https://fr-prod.asyncgw.teams.microsoft.com/...)

   # 任务交付报告
   ...
   ```

Run packaging script:
```powershell
bun --cwd "e:\copilot-web proxy\CPH-PI" run package
```

- [ ] **Step 4: Run full test suite verification**

Run:
```powershell
bun test --cwd "e:\copilot-web proxy\CPH-PI" tests/skills/tri-agent-prompts.test.ts tests/auth/ic3-token.test.ts tests/protocol/ tests/transport/ tests/agent/ tests/workspace/
```
Expected: All test suites PASS with 0 failures.

