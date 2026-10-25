# 回滚到 30d22da 并重放两功能：交付总结

- 日期：2026-10-26
- 分支：`fix/rollback-30d22da-plus-features`
- 相关 tag：
  - `wip/pre-rollback-20261026`：修复前现场（含两次 AI 尝试的产物），永久保全
  - `baseline/30d22da-behavior`：原始好版本 commit 快照（不可独立构建，仅作代码对照）
  - `baseline/reconstructed-good-20261026`：**可独立构建**的好版本基线（补齐未跟踪模块）

## 1. 问题根因（证据见设计规格 §1）

1. **首轮内联索引被整段删除**（`5ab4e3d`）：好版本首轮提示词内联约 32KB `virtual-repo-map`（含逐文件 SharePoint URL），坏版本只剩一句“索引已作为附件挂载”。模型失去首轮接地锚点，只能本地扫盘（Turn1 13 个本地命令 vs 好版本 0 个）。
2. **附件不能单独承担索引角色**：catalog 在上传后 3 秒即发首轮，且提示词/技能/回执没有一条链说明“附件就是索引、下一步怎么读”；模型退回本地。
3. **云端 URL 映射失真**：工作区迁移后 80/83 条 manifest URL 仍指向旧目录；SKIP 分支只在 URL 缺失时才补写。
4. **终止协议空转**：问答轮模型每轮写回答后附加 `read_file plan.md`，Harness 逐轮执行 ENOENT，重复 7~15 轮。
5. **既有好版本不可复现**：`30d22da` 依赖大量未入库支撑模块（web 构建配置、`src/tools/*`、`src/web/static-handler.ts` 等），直接 checkout 无法构建。

## 2. 本次交付内容

### 2.1 基线重建与治理

- 从 WIP 工作区保留全部支撑模块，行为文件回滚到 `30d22da`；
- 新增 `AGENTS.md` 规则 12：**工作区变更即时入库 + 清洁树铁律 + 幽灵依赖零容忍**；
- 重建基线测试：910 pass / 1 环境失败（ACL）。

### 2.2 功能一：文件链接自动落盘

- 新增 `DeliverablesParser`（严格解析 `【交付文件与落盘指引 / Deliverables】`）；
- 升级 `FilePorter`：IC3/Graph 鉴权、host allowlist、SSRF 防护、ZIP 安全解压（2000 条/200MB/单条 50MB）、关键文件 deny list、默认不覆盖；
- 新增 `LandingService`（落盘 + 云端同步 + 回执），Orchestrator 两个钩子：
  - `FINAL_ANSWER` 交付段；
  - `write_file(path, url)`；
- 产出 `.cph/state/delivery-report.json`，用户可见“已落盘/已同步/失败”回执；
- 开关：`enableAutoLanding`（默认 true）。

### 2.3 功能二：目录清单附件化（补充式）

- catalog 生成改为“文件系统真值 + manifest 只做状态列”，含 2 层目录树、CLOUD-READY / CLOUD-STALE / LOCAL-ONLY / CLOUD-UNINDEXABLE、当前 targetFolder 下的 URL；
- 按账号 + 内容 hash 缓存，换号自动重挂；
- **保留**内联 `[SHAREPOINT REMOTE WORKSPACE]` 映射表，新增任务范围优先 + 24KB 硬上限（`CPH_TURN1_INDEX_MAX_CHARS`），溢出指向 catalog 附件；
- 开关：`enableWorkspaceCatalog`（默认 true）。

### 2.4 云端映射修复

- `sp-sync-engine.ps1` SKIP 分支：云端实体 URL 与 manifest 不一致时刷新；
- 新增 `ReconcileUrls` action（纯本地、不访问网络）；
- 已在 `E:\test_workspace` 执行：`stale=0`；真实 sync `skipped=83 / synced=62 / pruned=0 / failed=0`；catalog 抽查 URL 全部属于 `WorkSpace/test_workspace`。

### 2.5 契约加固

- 工具回执增加 `source / status / freshness` 字段；
- `ask_question` 非交互诚实回退（`[QUESTION_UNAVAILABLE]`，不再伪造用户确认）；
- 无进展保护：同一失败动作第 3 次跳过并提示收敛；
- 调试指纹：`CPH_DEBUG=1` 时每轮输出 `[CPH-FINGERPRINT] agentId / promptHash / attachments`；
- 技能/提示词/bundle 统一引用 `remote-workspace-catalog.md`，dev 提示词移除不存在的 `workspace-v1.txt` 承诺；
- 新增 `.docs/capability-registry.md` 与提示词-bundle 一致性契约测试（规则 11）。

## 3. 验证结果

独立只读审计结论为“有条件交付”，其 P0/P1 问题已全部修复（2 个 P0、7 个 P1、5 个 P2），修复明细见测试报告第 7 节。修复后：

| 项 | 结果 |
|---|---|
| `bun test tests/` | 965 pass / 1 fail（仅历史 ACL 环境失败），123 files / 966 tests |
| `bun run build:package` | 成功 |
| `bun run package` | 成功；提示词/技能/bundle 一致性测试通过 |
| Web 冒烟（3999） | HTTP 200 |
| 真实工作区 catalog | 203 文件 / 145 CLOUD-READY / URL 全部指向 `test_workspace` |

## 4. 如何使用

1. `bun run package`，按 `package/agent-bundle/UPLOAD-GUIDE.md` 上传 bundle；
2. `bun run src/cli.ts web`，工作区选 `E:\test_workspace`；
3. 按 `.docs/reports/2026-10-26-live-acceptance-checklist.md` 执行真实任务验收。

## 5. 如何回退

- 功能级：`enableAutoLanding=false`、`enableWorkspaceCatalog=false`；
- 代码级：`git checkout baseline/reconstructed-good-20261026`（可独立构建）；
- 现场恢复：`git checkout wip/pre-rollback-20261026`（含两次 AI 尝试的全部痕迹）。

## 6. 已知限制

- 真实 Copilot 任务验收需要用户上传 bundle 后执行（自动化环境无法代替）；
- ACL 测试在未保护 ACL 的临时目录上失败，属历史环境问题；
- 超大工作区内联索引会截断（设计如此），依赖 catalog 附件与 `read_file` 补读。
