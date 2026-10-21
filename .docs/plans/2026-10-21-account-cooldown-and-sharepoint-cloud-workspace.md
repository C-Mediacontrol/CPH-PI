# 账号池智能冷却分级与 SharePoint 云端工作区实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底升级 CPH-PI 的账号池冷却与恢复生命周期管理（支持每日上限次日 UTC 零点重置、单调不减防反向缩短、非配额错误豁免），落地 SharePoint 云端工作区双端镜像（两段式向导、持久化成对记忆、可恢复回收站删除、防误删镜像门禁、手动一键同步），并彻底修复 Web 输入框 `/` 技能候选浮层裁切问题。

**Architecture:** 
1. 账号池层在现有 `orchestrator.ts:1752` 的 `isRateLimitResponseText` 基础上原地扩充中英双语限流特征，结合 `AccountPool` 实现基于 `Math.max` 的单调合并与次日 00:00 UTC（北京时间 08:00）自动计算；
2. SharePoint 同步层强锁定 Windows PowerShell 5.1 + PnP 1.12.0（依托 `PnPSession.psm1` 企业 SSO Cookie 穿透），将孤儿清理从硬物理删除重构为 `Recycle()` 入回收站，建立基于相对路径重合度的镜像合法性门禁；
3. Web UI 层解除 `.composerCard` 溢出裁切，在 `WorkspaceDialog.tsx` 扩展两段式向导，支持 `workspaceRoot === null` 欢迎引导态与顶栏【🔄 立即同步】快捷按钮。

**Tech Stack:** Bun 1.4.2, TypeScript (Strict Mode), Windows PowerShell 5.1 (`powershell.exe`), PnP.PowerShell 1.12.0, React 18, Vite 6, WebSocket JSON-RPC.

## Global Constraints

- 严禁在工作区根目录写任何代码或文档文件，所有变更严格限制在 `CPH-PI/` 目录内（《AGENTS.md》准则 1）。
- 绝不使用负面禁止词，全面采用建设性正向引导（《AGENTS.md》准则 3）。
- 状态持久化与工作内存严格解耦，零 Token 成本追加写入磁盘（《AGENTS.md》准则 7）。
- 严禁破坏已实测打通的 `PnPSession.psm1` 三级 Cookie 认证体系，禁止引入脱离企业内网实际的 Entra App-Only 改造。
- 所有 `.ps1` 和 `.psm1` 文件在保存时必须强制带有 UTF-8 BOM (`\uFEFF`)，防止 Windows PowerShell 5.1 出现 ANSI/GBK 解码解析错误。
- 实施全程保持全量回归单测通过（740+ pass, 0 fail）。

---

### Task 1: 根治 Composer 输入框 `/` 候选浮层裁切

**Files:**
- Modify: `CPH-PI/web/src/components/chat/Composer.module.css:10-25`
- Test: `CPH-PI/web/src/components/chat/Composer.tsx`

**Interfaces:**
- Consumes: `.composerCard`, `.suggestionsPopover`
- Produces: CSS overflow visibility that lets `.suggestionsPopover` float unclipped above `.composerCard`

- [x] **Step 1: 修改 Composer.module.css 解除父级溢出裁切**

在 `CPH-PI/web/src/components/chat/Composer.module.css` 中：
将 `.composerCard` 中的 `overflow: hidden;` 改为 `overflow: visible;`，同时确保内部 textarea 区域与附件列表保持正确的内层背景与间距：

```css
.composerCard {
  position: relative;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-surface-base, #ffffff);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  transition: border-color var(--ds-transition-duration, 0.2s),
    box-shadow var(--ds-transition-duration, 0.2s);
  overflow: visible; /* 关键：允许浮层在输入框上方完整显示，绝不硬裁切 */
}
```

- [x] **Step 2: 验证 Web 构建与样式**

运行：`npm run web:build`
预期：TypeScript 编译与 Vite 构建成功，0 error。

- [x] **Step 3: 提交代码**

```bash
git add web/src/components/chat/Composer.module.css
git commit -m "fix(web): allow suggestions popover to float unclipped above composer card"
```

---

### Task 2: 账号池智能分级冷却与单调不减防反向缩短

**Files:**
- Modify: `CPH-PI/src/auth/account-pool.ts:5-18, 350-380`
- Modify: `CPH-PI/src/agent/orchestrator.ts:1750-1785`
- Create: `CPH-PI/tests/auth/account-pool-cooldown.test.ts`

**Interfaces:**
- Consumes: `AccountStatus`, `isRateLimitResponseText`
- Produces:
  - `accountPool.markThrottled(email, durationMs?, reason?)`
  - `accountPool.getNextUtcMidnight(): number`
  - `orchestrator.isRateLimitResponseText(text): { isRateLimit: boolean; kind: 'daily' | 'burst' | 'none' }`

- [x] **Step 1: 编写失败测试用例**

创建 `CPH-PI/tests/auth/account-pool-cooldown.test.ts`：
测试不变量：
1. 单日上限计算：`getNextUtcMidnight()` 返回次日 00:00 UTC，且带有最小冷却下限 `now + 15 * 60 * 1000`；
2. 单调不减原则：当账号已标记为次日重置后，后续调用 120 秒 `burst` 冷却绝不将 `cooldownUntil` 反向缩短；
3. 文本限流特征分类：准确区分“已达到今天的消息上限”（daily）与“请求过于频繁/429”（burst），且排除代码块和长文交付。

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/auth/account-pool-cooldown.test.ts`
预期：测试失败（方法未定义或字段缺失）。

- [x] **Step 3: 扩展 AccountPool 与 Orchestrator 文本判据**

在 `CPH-PI/src/auth/account-pool.ts`：
1. 扩展 `AccountStatus`：增加 `throttleReason?: 'daily' | 'burst' | 'agent_ineligible'` 与 `consecutiveFailures?: number`；
2. 实现 `getNextUtcMidnight(floorMs = 15 * 60 * 1000): number`；
3. 重构 `markThrottled(email: string, durationMs?: number, reason: 'daily' | 'burst' = 'burst'): void`：
   - 采用 `status.cooldownUntil = Math.max(status.cooldownUntil ?? 0, target);` 确保单调不减；
   - 若当前已为 `daily`，保持 `daily` 标识不被降级。

在 `CPH-PI/src/agent/orchestrator.ts`：
1. 增强现有 `isRateLimitResponseText(text: string)`，返回结构化 `{ isRateLimit: boolean; kind: 'daily' | 'burst' | 'none' }`；
2. 扩充每日上限关键词（`reached your daily limit`、`daily message limit`、`已达到今天的消息上限`、`达到今天的消息上限`、`每日消息上限`、`今日上限` 等）；
3. 在 `onTurnEnd` 与错误归因流程中，严格区分异常类型：用户主动中断（`AbortError`）与工具执行异常绝不触发冷却。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/auth/account-pool-cooldown.test.ts`
预期：PASS，所有不变量断言通过。

- [x] **Step 5: 提交代码**

```bash
git add src/auth/account-pool.ts src/agent/orchestrator.ts tests/auth/account-pool-cooldown.test.ts
git commit -m "feat(auth): implement tiered monotonic account cooldown with next UTC midnight reset"
```

---

### Task 3: SharePoint 同步引擎可恢复删除与镜像合法性门禁

**Files:**
- Modify: `CPH-PI/scripts/sp-sync-engine.ps1:240-340`
- Modify: `CPH-PI/src/workspace/pnp-sync-engine.ts`
- Modify: `CPH-PI/.gitignore`
- Create: `CPH-PI/tests/workspace/mirror-guard.test.ts`

**Interfaces:**
- Consumes: `sp-sync-engine.ps1 Prewarm`, `PnP.PowerShell 1.12.0`
- Produces:
  - `pnpSyncEngine.verifyMirror(options): Promise<MirrorCheckResult>`
  - `pnpSyncEngine.prewarm(options): Promise<PrewarmReport>`
  - Recycle bin deletion contract (可恢复删除)

- [x] **Step 1: 将 .cph-mirror.json 加入 .gitignore**

在 `CPH-PI/.gitignore` 追加：
```
.cph-mirror.json
```
避免门禁标记文件被 Git 当成业务待同步文件上传。

- [x] **Step 2: 编写镜像门禁与删除安全测试**

创建 `CPH-PI/tests/workspace/mirror-guard.test.ts`：
1. 验证空远端目录被判定为合法全新镜像；
2. 验证与本地相对路径重合度超过 50% 被判定为合法镜像；
3. 验证完全无重合的外部目录被安全拦截并中止；
4. 验证删除操作标记为 `recycled`（安全回收）。

- [x] **Step 3: 运行测试验证失败**

运行：`bun test tests/workspace/mirror-guard.test.ts`
预期：测试失败。

- [x] **Step 4: 升级 sp-sync-engine.ps1 与 TS 封装层**

1. 保持 `sp-sync-engine.ps1` 开头为 UTF-8 BOM (`\uFEFF`)；
2. 在 `sp-sync-engine.ps1` 的孤儿清理逻辑中：
   - 增加相对路径重合度校验：若远端条目 > 0 且与本地相对路径重合度为 0，输出明确阻断信号并停止删除；
   - 在真实传输模式（`-MockTransport:$false`）下，调用 `$file.Recycle()` 进入回收站替代硬物理删除；
   - 支持空文件夹清理与递归建目录。
3. 在 `src/workspace/pnp-sync-engine.ts` 中暴露 `verifyMirror` 方法并捕获阻断错误。

- [x] **Step 5: 运行单测验证**

运行：`bun test tests/workspace/mirror-guard.test.ts tests/scripts/sp-sync-engine.test.ts`
预期：全部用例 PASS。

- [x] **Step 6: 提交代码**

```bash
git add .gitignore scripts/sp-sync-engine.ps1 src/workspace/pnp-sync-engine.ts tests/workspace/mirror-guard.test.ts
git commit -m "feat(sync): add cloud mirror guard and recycle bin deletion safety"
```

---

### Task 4: RpcHandler 云端工作区双向配置与协议扩展

**Files:**
- Modify: `CPH-PI/src/web/rpc-handler.ts:400-530, 870-920`
- Create: `CPH-PI/tests/web/cloud-workspace-rpc.test.ts`

**Interfaces:**
- Consumes: `pnpSyncEngine`, `AccountPool`
- Produces:
  - WebSocket packet `workspace:verify-cloud`
  - WebSocket packet `workspace:sync-cloud`
  - `.cph/config.json` 中的 `cloudWorkspace` 持久化读写

- [x] **Step 1: 编写 RPC 契约测试**

创建 `CPH-PI/tests/web/cloud-workspace-rpc.test.ts`：
1. 验证 `workspace:verify-cloud` 接收 `sharepointUrl` 并返回有效性校验结果；
2. 验证 `workspace:sync-cloud` 触发增量对账并推送终端与对账报告；
3. 验证 `cloudWorkspace` 配置在 `.cph/config.json` 中完整持久化并在下一次会话初始化时自愈加载。

- [x] **Step 2: 运行测试验证失败**

运行：`bun test tests/web/cloud-workspace-rpc.test.ts`
预期：失败（尚未注册相关 RPC 类型）。

- [x] **Step 3: 实现 RpcHandler 中的云端工作区处理逻辑**

在 `CPH-PI/src/web/rpc-handler.ts`：
1. 在 `loadAgentConfig` / `saveWorkspaceConfig` 中增加对 `cloudWorkspace` 的序列化与反序列化；
2. 增加 `case "workspace:verify-cloud"`：调用 `pnpSyncEngine.verifyMirror`，验证成功后持久化配置；
3. 增加 `case "workspace:sync-cloud"`：触发 `pnpSyncEngine.prewarm`，流式推送终端日志并在对账完成后发送 `workspace:sync-report`；
4. 在 `sendSnapshot` 中推送 `cloudWorkspace` 状态与对账信息。

- [x] **Step 4: 运行测试验证通过**

运行：`bun test tests/web/cloud-workspace-rpc.test.ts tests/web/server.test.ts`
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add src/web/rpc-handler.ts tests/web/cloud-workspace-rpc.test.ts
git commit -m "feat(rpc): add cloud workspace pairing and synchronization handlers"
```

---

### Task 5: Web 前端两段式工作区向导与无工作区引导态

**Files:**
- Modify: `CPH-PI/web/src/types/protocol.ts`
- Modify: `CPH-PI/web/src/services/store.ts`
- Modify: `CPH-PI/web/src/components/layout/WorkspaceDialog.tsx` & `.module.css`
- Modify: `CPH-PI/web/src/components/chat/ChatView.tsx` & `.module.css`

**Interfaces:**
- Consumes: `AppState.workspaceRoot`, `AppState.cloudWorkspace`
- Produces: Two-stage WorkspaceDialog UI (Step 1 Local -> Step 2 Cloud), Welcome Screen when no workspace

- [x] **Step 1: 扩展前端协议契约与初始状态**

在 `CPH-PI/web/src/types/protocol.ts` 与 `CPH-PI/web/src/services/store.ts` 中：
1. 增加 `CloudWorkspaceConfig` 接口定义；
2. 将 `initialState.workspaceRoot` 调整为支持 `null`（若初始未传入且无历史记录，表示等待用户选择）；
3. 增加 `verifyCloudWorkspace(url)` 与 `syncCloudWorkspace()` 动作。

- [x] **Step 2: 改造 WorkspaceDialog.tsx 实现两段式向导**

在 `CPH-PI/web/src/components/layout/WorkspaceDialog.tsx` 中：
1. 阶段一：本地物理路径选择与格式校验；
2. 阶段二：若目标路径尚未绑定云端，展开卡片“是否为此工作区关联 SharePoint 云端镜像？”，提供 SharePoint URL 文本框与【验证并关联】、【暂不需要（纯本地）】按钮。

- [x] **Step 3: 增加 ChatView 未选择工作区欢迎引导卡片**

在 `CPH-PI/web/src/components/chat/ChatView.tsx` 中：
当 `workspaceRoot === null` 时，中央对话流展示 DeepSeek 风格的“欢迎使用 CPH-PI”卡片，居中高亮按钮“打开本地工作区”，一键唤起 `WorkspaceDialog`。

- [x] **Step 4: 运行前端构建验证**

运行：`npm run web:build`
预期：编译成功，无类型与样式错误。

- [x] **Step 5: 提交代码**

```bash
git add web/src/types/protocol.ts web/src/services/store.ts web/src/components/layout/WorkspaceDialog.tsx web/src/components/layout/WorkspaceDialog.module.css web/src/components/chat/ChatView.tsx web/src/components/chat/ChatView.module.css
git commit -m "feat(web): add two-stage workspace dialog and initial empty welcome screen"
```

---

### Task 6: 顶栏云端状态指示、手动【🔄 立即同步】与账号面板精度升级

**Files:**
- Modify: `CPH-PI/web/src/components/layout/Sidebar.tsx`
- Modify: `CPH-PI/web/src/components/panels/FileExplorer.tsx`
- Modify: `CPH-PI/web/src/components/layout/AccountDialog.tsx`

**Interfaces:**
- Consumes: `cloudWorkspace`, `accounts[].throttleReason`, `accounts[].cooldownUntil`
- Produces: Real-time Cloud Workspace Status badge, Manual Sync Button, Tiered Cooldown Tag in AccountDialog

- [x] **Step 1: 在顶栏与文件树面板集成【🔄 立即同步】按钮**

1. 在 `FileExplorer.tsx` 表头增加【🔄 立即同步】按钮，并在 `Sidebar.tsx` 底部工作区信息处展示 `☁️ SharePoint 已连接 (已同步 38 项)` 状态；
2. 点击同步时，图标呈现旋转动画，禁用重复点击；同步完成后通过状态显示最新同步时间戳。

- [x] **Step 2: 升级 AccountDialog 展示分级冷却标签**

在 `AccountDialog.tsx` 中：
1. 对冷却账号根据 `throttleReason` 区分渲染：
   - `daily`: 橙红标签 `今日上限 (次日 08:00 UTC 重置)`；
   - `burst`: 琥珀黄标签 `短时限流 (剩余 Xs)`；
2. 保留并优化每行的【⚡ 立即探活/解冻】快捷操作。

- [x] **Step 3: 全量构建与回归测试验证**

1. 执行前端打包：`npm run web:build`
2. 执行独立 Node 包构建：`bun run build:package`
3. 执行全量单元测试：`bun test tests/`
预期：前端构建 0 错误，全量 740+ 单元测试 100% 通过（0 失败）。

- [x] **Step 4: 提交代码**

```bash
git add web/src/components/layout/Sidebar.tsx web/src/components/panels/FileExplorer.tsx web/src/components/layout/AccountDialog.tsx
git commit -m "feat(web): add manual sync button and tiered account cooldown inspector"
```

