# CPH-PI 分支与发布拓扑台账 (BRANCHES.md)

> **单一事实源**：本文件记录每一条分支/标签的**存在原因、证据文档、处置结论与恢复方式**。
> 新增、归档、删除分支或标签时，在本文件同步登记；配套规则见 `AGENTS.md` 准则 13。

- **最近整理**：2026-11-04
- **整理前快照**：`.cph/state/cleanup-20261104/`（refs / branches / worktrees / remote 清单 + 废弃 worktree 未提交改动）
- **离线兜底备份**：`../CPH-PI-pre-cleanup-20261104.bundle`（`git bundle --all`，约 3.2 MB）

---

## 1. 当前规范状态

| 项目 | 值 |
|---|---|
| 唯一长期分支 | `main` |
| main 当前提交 | `e865ac9` — `chore(release): rebuild distributable CLI from HEAD (handshake/Turn2 grounding + audit fixes)`（2026-11-03） |
| 远程 | `origin` = `https://github.com/C-Mediacontrol/CPH-PI.git`；远程仅保留 `main` + 标签 |
| 本地保留标签 | 9 个：3 个语义基线 tag + 6 个归档 tag（见 §3） |
| 工作树 | 仅主工作树；临时 worktree 已全部移除 |
| 分支策略 | 见 `AGENTS.md` 准则 13（短命分支 + tag 归档 + main 单一主干） |

---

## 2. 分支考古表（按创建时间排序）

> "已删除"指 2026-11-04 整理动作；删除前均已由归档 tag 保全，可用 §5 命令完整恢复。

### 2.1 保留

| 分支 | 生命周期 | 起因 / 证据 | 处置 |
|---|---|---|---|
| **`main`** | 2026-10-12 初始提交 `b8ad75a` → 至今 | 主干发布线。2026-10-15 以对抗整改末端 `e578f7b` 推到远程；10/16–10/19 本地直接推进 13 个提交（`582c174`，自动接力/集群架构，未推送）；此后开发转入特性分支，main 停更 | ✅ 保留（唯一长期分支）；2026-11-04 快进到 `e865ac9` 并推远程 |

### 2.2 已删除（归档保全）

| 分支 | 生命周期 | 起因 / 证据 | 归档 tag |
|---|---|---|---|
| `fix/rollback-30d22da-plus-features` | 2026-10-26 05:55 → 2026-11-04 | 真机回归抢救线：把行为回滚到 `30d22da` 好基线，再最小重放"文件自动落盘 + 目录清单附件化"两功能，补 URL 映射/契约加固与 AGENTS 规则 12。见 `.docs/plans/2026-10-26-rollback-baseline-and-two-features.md`、`.docs/reports/2026-10-26-rollback-fix-summary.md` | 无独立 tag（尖端 `e865ac9` 即当前 `main`，永久可达） |
| `feat/unified-supercharger-execution` | 2026-10-19 23:18 → 2026-11-04 | `CR-2026-10-19-01` 执行线（快照增压/分块直传/SharePoint 镜像），之后承载 10/21 账号冷却、10/22 Web RPC 对齐、10/24 云工作区双轨、10/25 零 IO 架构、10/26 cloud file porter 等；尖端即 WIP 现场 `5cdb0fc`。见 `.docs/CHANGELOG.md`（10/20 条目）、`.docs/reports/2026-10-26-pre-rollback-wip.md` | `archive/branch-2026-10-20-unified-supercharger`（`5cdb0fc`，与 `wip/pre-rollback-20261026` 同点） |
| `feat/workspace-snapshot-supercharger` | 2026-10-19 → 2026-11-04 | `CR-2026-10-19-01` 的 **spec/plan 审计分支**：report-C~H 六轮中立对抗审计，把快照增压架构规范 v1.3.x 硬化到 v2；只产文档，实现移去 `feat/unified`。见 `.docs/plans/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-plan.md`、`.docs/audit/report-H-plan-neutral-review-v2.md` | `archive/branch-2026-10-19-workspace-snapshot`（`2577b5b`） |
| `fix/adversarial-audit-remediation-20261014` | 2026-10-14 → 10/15（删除于 2026-11-04） | 基于 `.docs/audit/FINAL-AUDIT-REPORT.md` 的正式对抗性整改（CR-1~CR-4，572 项测试），10/15 完成 Code Mode + File Porter；尖端 `e578f7b` 曾作为远程 `main` 发布点（直至 2026-11-03） | `archive/branch-2026-10-14-adversarial-remediation`（`e578f7b`） |
| `backup-before-web-gui-revert` | 2026-10-21 01:18 → 2026-11-04 | 回退**第一版 Web GUI + Node.js 运行时**前的备份：10/21 01:18 将 `feat/unified` 从 `4cbb776` reset 回 `ebbc3c2`，丢弃 2026-10-20~21 的 18 个提交（Node 运行时、DeepSeek-Harness 设计系统、Web GUI Task 1–8）。此后前端换另一套实现（当前 `web/`）。见 `.docs/plans/2026-10-21-deepseek-style-web-frontend.md` | `archive/branch-2026-10-21-web-gui-v1-dropped`（`4cbb776`） |
| `backup/pre-v2-clean-restore` | 2026-10-26 02:23 → 2026-11-04 | 尝试"按 `30d22da` 逐文件 clean restore + v2 设计"方案前的现场备份；该方案 3.5 小时后被 rollback 基线方案取代。见 `.docs/specs/2026-10-26-cloud-file-porter-and-catalog-attachment-design-v2-corrected.md` | `archive/branch-2026-10-26-pre-v2-restore`（`d73b7a1`） |
| `fix/audit-remediation-20261012` | 2026-10-12（fork `67b9cf3`）→ 2026-11-04 | **第一轮安全整改专项流水线**（change-protocol 试验）：解构 CLI/Orchestrator 上帝类、去 .NET 特化、并发安全、血缘持久化，并新增 `CHANGELOG.md`/`MODULE-REGISTRY.md`。被 10/14 基线锁定 + 新一轮整改取代，6 个提交未回主线（`command-dispatcher.ts`/`handoff-generator.ts`/`disaster-arbitrator.ts`/`url-utils.ts` 方案未采纳，仅 `args.ts` 在 10/14 以另一实现出现） | `archive/branch-2026-10-12-audit-remediation`（`b5c1b90`） |

**附注**：`fix/audit-remediation-20261012` 的 `.worktrees/fix-audit-remediation` 移除前有未提交文档改动，已保全至
`.cph/state/cleanup-20261104/worktree-fix-audit-remediation.diff`、`worktree-fix-audit-remediation.status.txt` 与 `worktree-remediation-plan.md`。

---

## 3. 标签清单

### 3.1 语义基线 tag（长期保留）

| Tag | 指向提交 | 含义 |
|---|---|---|
| `baseline/30d22da-behavior` | `30d22da` | 好行为快照（首轮内联索引完整、Turn1 零本地扫盘）；因依赖当时未入库模块，**仅作代码对照，不可独立构建** |
| `baseline/reconstructed-good-20261026` | `728b891` | 补齐未跟踪的 Web/工具支撑模块后**可独立构建**的好基线 |
| `wip/pre-rollback-20261026` | `5cdb0fc` | 回滚前完整现场（含两次失败修复尝试的产物），永久保全 |

### 3.2 归档 tag（2026-11-04 建立）

`archive/branch-<yyyy-mm-dd>-<slug>`：命名可排序、可读；tag message 记录用途、依据文档与替代者。

| Tag | 指向提交 |
|---|---|
| `archive/branch-2026-10-12-audit-remediation` | `b5c1b90` |
| `archive/branch-2026-10-14-adversarial-remediation` | `e578f7b` |
| `archive/branch-2026-10-19-workspace-snapshot` | `2577b5b` |
| `archive/branch-2026-10-20-unified-supercharger` | `5cdb0fc` |
| `archive/branch-2026-10-21-web-gui-v1-dropped` | `4cbb776` |
| `archive/branch-2026-10-26-pre-v2-restore` | `d73b7a1` |

---

## 4. 2026-11-04 整理执行记录

| 步骤 | 动作 | 结果 |
|---|---|---|
| 0-a | refs/分支/worktree/remote 清单快照 | `.cph/state/cleanup-20261104/` |
| 0-b | 6 个 annotated 归档 tag | 全部指向预期 commit（已核验） |
| 0-c | `git bundle --all` 离线备份 | `../CPH-PI-pre-cleanup-20261104.bundle`（3.2 MB） |
| 0-d | 保全废弃 worktree 未提交改动 | 3 个文件已落 `.cph/state/cleanup-20261104/` |
| 1 | 移除 `.worktrees/fix-audit-remediation` + `git worktree prune` | ✅ 仅剩主工作树 |
| 2 | 删除 7 条本地分支 | ✅ 本地仅 `main` |
| 3 | 推送 9 个 tag 到远程 | ✅ `refs/tags/*` 已同步 |
| 4 | 删除 7 条远程分支 | ✅ 远程仅 `main` + 标签 |
| 5 | `git fetch --all --prune` | ✅ 远程跟踪引用已收敛 |

**整理前后对比**

| 维度 | 整理前 | 整理后 |
|---|---|---|
| 本地分支 | 8 | **1（`main`）** |
| 远程分支 | 8 | **1（`main`）** |
| 标签 | 3（仅本地） | **9（本地+远程）** |
| worktree | 2 | **1** |

---

## 5. 恢复方式

```powershell
# 查看某条归档分支的历史
git log --oneline archive/branch-2026-10-21-web-gui-v1-dropped

# 恢复为本地分支（任意命名）
git checkout -b web-gui-v1 archive/branch-2026-10-21-web-gui-v1-dropped

# 恢复为远程分支
git push origin archive/branch-2026-10-21-web-gui-v1-dropped:refs/heads/web-gui-v1

# 灾难场景：从离线 bundle 全量恢复
git clone "../CPH-PI-pre-cleanup-20261104.bundle" CPH-PI-restored
```

> 说明：被删的 4 条"已包含在 main 内"的分支（adversarial / workspace-snapshot / unified / pre-v2）即使不恢复，其提交也已在 `main` 历史中可达；2 条分叉分支（web-gui-v1、10-12 audit）的唯一提交只在对应归档 tag 内。

---

## 6. 后续约定（与 AGENTS.md 准则 13 配套）

1. **单一主干**：`main` 始终最新、可构建、可发布；特性/整改走短命分支，合并后删除。
2. **命名**：`feat/<CR-ID>-<slug>`、`fix/<CR-ID>-<slug>`、`chore/<slug>`；分支名体现 CR 或目标，不使用 `backup-*` 这类一次性名称。
3. **备份即标签**：需要保留现场时建 annotated tag `archive/branch-<yyyy-mm-dd>-<slug>`，message 写清用途、依据文档、替代者；远程分支集合保持精简。
4. **登记闭环**：开分支时在 `.docs/CHANGE-REQUEST.md` 登记关联分支；CR 完成时登记合并提交、分支处置与归档 tag；本文件同步更新。
5. **发布标记**：交付版本在 `main` 打 `release/<yyyy-mm-dd>` 标签（后续启用）。
6. **收尾核对**：`git status --porcelain` 为空、`git branch --merged main` 无遗留、`git worktree list` 无临时工作树、远程分支集合符合预期。
