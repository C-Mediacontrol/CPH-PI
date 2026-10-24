# CHANGE-REQUEST (变更请求台账)

## 进行中的变更请求

*暂无进行中的变更请求。*

---

## 已完成的变更请求

### CR-2026-10-24-02: 云端工作区目录双轨对齐与拓扑生命周期

- **发起日期**: 2026-10-24
- **完成日期**: 2026-10-24
- **状态**: ✅ 已完成并全量测试通过 (Completed & Verified)
- **类型**: 🐛 严重缺陷修复 & 📁 云端镜像双轨拓扑生命周期架构增强
- **设计规范**: [`.docs/specs/2026-10-24-cloud-workspace-folder-dual-track-sync-design.md`](./specs/2026-10-24-cloud-workspace-folder-dual-track-sync-design.md)
- **实施计划**: [`.docs/plans/2026-10-24-cloud-workspace-folder-dual-track-sync.md`](./plans/2026-10-24-cloud-workspace-folder-dual-track-sync.md)

#### 摘要
彻底解决工作区云端同步时本地空文件夹被无差别误删，以及本地新建空目录无法主动同步上云的架构缺陷，达成云端与本地 1:1 严格镜像：
1. **文件与目录双轨抽象与状态解耦**：彻底摒弃单轨仅查文件的盲区，新增 `Get-LocalFolders`（集成 Git 忽略规则）与 `Get-SharePointCloudEntities`（递归收集并排除 SharePoint 保留目录），实现文件与目录独立纳管。
2. **清单 Manifest 升级 v2**：升级 `.cph/state/sync-manifest.json` 为版本 2，引入 `folders` 映射字典，无损向后兼容旧版清单。
3. **三阶段拓扑流水线 (3-Phase Pipeline)**：
   - **阶段 1 (Top-Down Pre-creation)**：按路径深度升序自顶向下，在上传文件前先行在云端补齐本地所有的业务目录（含纯空目录）。
   - **阶段 2 (Files Data Track)**：保持既有文件的 SHA-256 增量流转与孤儿文件回收。
   - **阶段 3 (Bottom-Up Safe Pruning)**：彻底废除旧版无差别清空空目录的代码，按路径深度降序自底向上遍历孤儿目录候选集，严格施加**本地存续硬门禁（本地若存在则绝对保留）**与**云端空闲硬门禁（云端无文件与子目录才回收）**，彻底根除误删。
4. **独立目录热同步与地图感知**：
   - PowerShell 引擎新增 `-Action EnsureFolder`；
   - TypeScript 引擎导出 `FolderManifestEntry` 与 `SyncFolderResult`，并实现 `PnPWorkspaceSyncEngine.syncFolder()`；
   - `generateVirtualRepoMap()` 新增渲染 `[DIRECTORIES / EMPTY FOLDERS]` 节点，确保 Copilot Agent 具备完整的云端目录结构语义感知。
5. **镜像守卫修复**：在 `VerifyCloudMirror` 中加载并校验 `Files.Count` 与 `Folders.Count`，避免仅有子目录时被误判为全空。

#### 验证结果
- 全仓测试套件: **106 个测试文件、846 项测试用例全部 100% 绿灯通过，0 失败**。
- Web 前端构建: `npm run web:build` 编译打包 0 错误。
- 零负面禁止词，工作区二级目录物理隔离。

---

### CR-2026-10-24-01: M365 账号治理自治增强、交互式 PKCE 凭据刷新与跨代接力连续性架构重构

- **发起日期**: 2026-10-24
- **完成日期**: 2026-10-24
- **状态**: ✅ 已完成并全量测试通过 (Completed & Verified)
- **类型**: 🐛 严重缺陷修复 & 🔐 账号自治与 PKCE 认证架构增强
- **设计规范**: [`.docs/specs/2026-10-24-m365-account-governance-and-pkce-auth-refresh-design-v2-verified.md`](./specs/2026-10-24-m365-account-governance-and-pkce-auth-refresh-design-v2-verified.md)
- **实施计划**: [`.docs/plans/2026-10-24-m365-account-governance-and-pkce-auth-refresh.md`](./plans/2026-10-24-m365-account-governance-and-pkce-auth-refresh.md)

#### 摘要
彻底解决长程多跳自主接力与长会话运行中的 5 大连锁架构缺陷：
1. **修复状态机门禁反噬 (F1)**：在 `AccountPool` 选号与容量计算全入口（`acquireSessionLease`、`getNextAvailableToken`、`getGraphAccessToken`、`getAvailableCapacity`）强制施加 `status.authExpired || !status.isAvailable || status.isThrottled` 硬门禁，彻底杜绝失效账号以 0 秒无冷却死循环狂选打爆接口。
2. **精准错误分流与 Graph 盲取重构 (F2)**：抽象 `isFatalAuthGrantError` 识别 `invalid_grant`、`interaction_required` 及 `AADSTS700082/50173/50076/50079` 等致命鉴权错误，将其转为 `authExpired: true` 并停止无效的 60 秒自动探测重试；`getGraphAccessToken` 重构为遍历选取健康账号，防止首账号失效导致 OneDrive 附件上传崩溃。
3. **0 字节交接文件双点封堵 (F3)**：在模型内联空块落盘（`orchestrator.ts:854`）与容灾仲裁产物写入（`orchestrator.ts:2154`）施加 `>= 50` 字节硬门禁，破损文件强制清除并触发账本保底合成；更正预写账本路径为真实存在的 `.cph/state/execution-ledger.jsonl`。
4. **会话租约生命周期全释放 (F5)**：在 `orchestrator.run()` 终态 `finally` 强制释放会话租约，封堵 CLI 模式跨代租约泄漏；在主会话世代虚拟化（L966）中对称释放前代租约并正确传入 `sessionId` 绑定；在 `RpcHandler` 接力循环中释放前代租约解除容量死锁。
5. **Web 前端与 RPC 接力连续性闭环 (F4 & F6)**：自主接力时调用 `this.orchestrator.resetHandshake()` 重置握手与会话隔离；广播 `session:created` 与 `turn:start` 事件；前端 Store 严格采用真实字段 `activeSessionId`，驱动界面无缝流式渲染后续代际；修复 `AccountPool.resetCooldown` 调用断线并防止误解除失效账号。
6. **恪守 Harness 中立与全量附件原始字节保真 (B1 / 准则 1 & 9)**：坚决废除在 `ToolBridge` 中拼接 Notice 的侵入性补丁，保持工具原始输出 100% 保真与 Harness 绝对中立；清洗系统提示词与 `handoff` 技能中的负面禁止词，转为建设性正向引导。
7. **原生 TypeScript RFC 7636 PKCE 认证引擎 (OAuthPkceService)**：对齐 `Library/m365-auth-helper/auth.go` 源码规范，支持 S256 挑战码、`response_mode=query`、双 Token Claims 解析（`oid/tid/email`）、错误参数先行拦截与 `emailMismatch` 错位检测。
8. **双端同构（Web + CLI）快捷重登通道**：Web 端提供三态徽章与两步 PKCE 交互授权弹窗；终端支持独立命令 `cph-pi auth login [email]` 与 TUI 交互内 `/accounts login [email]`。

#### 验证结果
- 全仓测试套件: **106 个测试文件、838 项测试用例全部 100% 绿灯通过，0 失败**。
- Web 前端构建: `npm run web:build` 编译打包 0 错误。
- 零负面禁止词扫描通过，工作区边界 100% 隔离守卫。

---

### CR-2026-10-22-01: Web RPC 与 CLI 工业级执行管线全量对齐、Handoff 自主接力闭环与云端无损附件直传治理

- **发起日期**: 2026-10-22
- **完成日期**: 2026-10-22
- **状态**: ✅ 已完成并全量测试通过 (Completed & Verified)
- **类型**: 🐛 Bug 修复 & 工业级韧性对齐

#### 摘要
全面对齐 Web RPC 模式与 CLI 模式的执行管线差异：引入自主多跳接力循环（`maxAutonomousHandoffHops`），废除 ToolBridge 3000 字符虚假截断与诱导读 log 提示并统一走无损云端附件，修复 Slash 技能剥离常驻技能缺陷，补全 invoke_subagent 协议契约，实现交接资产云端无损挂载（`initialAnnotations`）、终极目标锁定（`rootUserPrompt`）、Sydney 拦截告警（`onRefusalIntercepted`）、历史压实通知（`onCompacted`）、交互式提问（`onQuestion`）及消除元数据硬编码。全量通过 788 项单元与集成测试（102 个测试文件），前端 Vite 构建 0 错误。

#### 根因 / 背景
1. **Handoff 后无下文**: RpcHandler 仅执行单轮请求-响应，在 `runResult.handedOff` 时直接结束本轮并置 `running = false`，缺失 CLI 模式的 `while (hopCount < maxAutonomousHandoffHops)` 自主接力续跑循环。
2. **工具重复调用死循环**:
   - `ToolBridge` 在输出 >3000 字符或 >50 行时强行截断，并注入提示诱导模型去读取 `.cph/artifacts/tool-output-xxx.log`；
   - `Orchestrator` 附件上传阈值高达 12000 字符，导致 3000~12000 字符的目录清单（如 10767 字符）既被本地虚假截断又未走云端附件，诱发模型陷入连续 28 轮读取临时 log 和 `plan.md` 的死循环（严重违背 AGENTS.md 规则 9）；
   - Slash 指令解析独占 `skillsToUse`，冲刷了 `subagent` 与 `handoff` 等常驻 Agent 技能；
   - `PromptBuilder.PROTOCOL_REMINDER` 未定义 `invoke_subagent` 调用规范，且 Turn 1 提示词局限性要求“每次最多读取 100 行”。
3. **Web 与 CLI 管线架构漂移**: Web 端缺少 `initialAnnotations` 云端挂载（违背规则 7 & 9 硬塞纯文本到 Prompt）、遗漏 `rootUserPrompt` 导致长程目标失真、未接入 `onRefusalIntercepted` 与 `onCompacted`、未打通 Web 端 `onQuestion` 提问、会话创建时硬编码覆盖了 `maxTurns: 25` 与 `modelTone: "Creative"`。

#### 方案
- **新逻辑实现**:
  1. **自主接力闭环**: RpcHandler 引入 `while (hopCount < maxAutonomousHandoffHops)` 循环，Handoff 发生时自动创建新会话、广播接力事件、无缝追加接力桩卡片并自主续跑阶段 2。
  2. **消除虚假截断**: 废除 ToolBridge 的 3000 字符截断陷阱与读 log 提示；保持 100% 原始输出交付，超出边界由 Orchestrator 全量上传至 OneDrive/SharePoint，Substrate RAG 无损送达。
  3. **交接成果 pass-by-reference 挂载**: Handoff 触发时将 snapshot 上传至 OneDrive，以 `initialAnnotations` 挂载给下一代 Orchestrator，彻底杜绝在 Prompt 字符串前倾倒长文本。
  4. **终极目标锁定**: `orchestrator.run` 显式传入 `rootUserPrompt: rootTaskPrompt`，保持长程目标对账基线。
  5. **常驻核心技能保活**: RpcHandler 智能合并技能，触发 Slash 技能时强制保留 `subagent` 与 `handoff`。
  6. **协议契约升级**: `PromptBuilder.PROTOCOL_REMINDER` 补全 `invoke_subagent` 规范，移除 100 行限制。
  7. **事件全量接线**: 补齐 `onRefusalIntercepted`、`onCompacted`、`onAccountSwitched` 回调与持久化对账。
  8. **提问通道打通**: ToolBridge 接入 Web 端 `onQuestion` 回调，支持交互式选择确认。
  9. **配置动态继承**: 消除硬编码，SessionRecord 动态继承 `cliApp` 与实际配置的 `modelTone`（默认 `Gpt_61_Sol_Reasoning`）与 `maxTurns`（默认 30）。
  10. **内建核心技能搜索保障**: `SkillLoader.getSearchPaths()` 注入 CPH-PI 内建核心技能路径，保证在任意外部工作区均可无损识别 `subagent` 与 `handoff`。

#### 验证结果
- 专用回归测试 `tests/web/pipeline-alignment-and-handoff-loop.test.ts` 6 项用例 100% 绿灯全通。
- 全仓测试套件: **102 个测试文件、788 项测试、3587 个断言 100% 绿灯全通，零破坏零失败**。
- Web 前端构建: `npm run web:build` 编译打包 0 错误。

---

### CR-2026-10-19-01: 全工作区源码快照增压、大文件分块直传、SharePoint 物理镜像与子代理微切片隔离体系
- **发起日期**: 2026-10-19
- **完成日期**: 2026-10-20
- **状态**: 实施完成并通过全部实战对账 (Completed & Verified)
- **关联分支**: `feat/unified-supercharger-execution` (基于 `feat/workspace-snapshot-supercharger` 独立开工)
- **唯一权威技术规范**: [`.docs/specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md`](./specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)
- **审查与审计报告**: [report-C (v1.0.0)](./audit/report-C-spec-neutral-review.md), [report-D (v1.1.0)](./audit/report-D-spec-neutral-review-v1.1.md), [report-E (v1.2.0)](./audit/report-E-spec-neutral-review-v1.2.md), [report-F (v1.3.0)](./audit/report-F-spec-neutral-review-v1.3.md), [report-G (plan)](./audit/report-G-plan-neutral-review.md), [report-H (v2)](./audit/report-H-plan-neutral-review-v2.md)
- **端到端实战对账指南**: [`.docs/evidence/e2e-live-verification-guide.md`](./evidence/e2e-live-verification-guide.md)
- **最终测试验证硬基线**:
  - 全仓测试套件: **91 个测试文件、710 项测试、3189 个断言 100% 绿灯全通，零破坏零失败** (严格超出硬门禁 ≥ 680 用例 / ≥ 2900 断言)；
  - 打包流水线: `bun run package` 与 `bun run build:package` 成功输出 `dist/copilot-agent-bundle.zip`、`package/agent-bundle/` 及 `package/bin/cph-pi.js`；
  - 核心模块就绪: `SubstrateUploader` (自适应分块/直传)、`SnapshotGenerator` (Git全景/微切片/防膨胀)、`sp-sync-engine.ps1` (PS5.1 物理镜像/增量基线)、`Orchestrator` (双层流/注解复用/模型可见降级/物理指纹头)。
