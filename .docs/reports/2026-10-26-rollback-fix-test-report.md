# 回滚基线 + 两功能重放：自动化测试与验证报告

- 日期：2026-10-26
- 分支：`fix/rollback-30d22da-plus-features`
- 基线 tag：`baseline/reconstructed-good-20261026`（重建的可复现好版本）
- 原始好版本 tag：`baseline/30d22da-behavior`（不可独立构建，仅代码快照）
- 现场保全 tag：`wip/pre-rollback-20261026`

## 1. 基线重建结果

`30d22da` 的已跟踪代码引用了当时未入库的支撑模块（`web/` 构建配置与 UI、`src/tools/*`、`src/web/static-handler.ts`、`src/web/file-tree.ts`、`tests/web/*` 等），直接 checkout 会缺失模块（68 个测试失败）。重建方式：

1. 从 WIP 工作区保留全部支撑模块；
2. 把行为相关已跟踪文件回滚到 `30d22da` 版本（提示词、orchestrator、parser、sync engine、skills、bundle 等）；
3. 删除 `de2fd20` 引入的后续功能文件（由本次任务重新实现）；
4. 忽略临时测试日志与调试截图。

重建后基线与最终结果：

| 阶段 | pass | fail | 说明 |
|---|---|---|---|
| 重建基线（commit `728b891`） | 910 | 1 | 唯一失败为 `sp-sync-engine.test.ts` 的 Windows ACL 断言（环境相关，历史既有） |
| 独立审计后最终（HEAD） | 965 | 1 | 新增 55 个测试；仍是同一个 ACL 环境失败，无新增失败 |
| 测试规模 | 966 tests / 123 files | — | 约 110s（Windows，本地，`--timeout 30000`） |

## 2. 构建与打包

- `bun run build:package`：成功（`package/bin/cph-pi.js` 0.83MB、`check-accounts.js` 60.3KB）。
- `bun run package`：成功，`dist/copilot-agent-bundle.zip`、`package/agent-bundle/` 同步完成；提示词与 skills 契约测试通过（`tests/skills/prompt-bundle-consistency.test.ts`）。
- 说明：`package/agent-bundle/copilot-agent-bundle.zip` 因 zip 时间戳非确定，已改为构建产物（`.gitignore`），由 `bun run package` 生成。

## 3. Web 冒烟

- 命令：`bun run src/cli.ts web -p 3999 --no-open`
- 结果：HTTP 200（页面 741 bytes）。
- 端口 3000 上已有旧进程，未干扰；冒烟使用 3999。

## 4. 真实工作区云端映射修复（E:\test_workspace）

问题：`sync-manifest.json` 83 条中 80 条 `serverRelativeUrl` 指向旧目录 `.../WorkSpace/test/`，而 targetFolder 已是 `.../WorkSpace/test_workspace`。

修复动作：

1. 运行 `ReconcileUrls`：`updated=80 total=83`，`stale=0`。
2. 运行真实 `syncCloudWorkspace`（89.6s）：
   - `skipped=83`（云端已存在且未变更）
   - `synced=62`（本次新写入的 `test/` 证据文件）
   - `pruned=0`、`failed=0`
3. 用新 catalog 生成器校验 `E:\test_workspace`：
   - `工作区文件 203 | 已同步可索引 145 | 本地独有 14 | 不可索引 44`
   - 抽样 `Library/CNNJI QUERY/shared/modules/JsygtBatch.psm1` → `[CLOUD-READY]`，URL 属于 `WorkSpace/test_workspace`。

## 7. 独立审计发现与修复（commit `83a6154`、`11bc363`）

独立只读审计结论为“有条件交付”，以下问题已修复并补测试：

| 等级 | 问题 | 修复 |
|---|---|---|
| P0 | FilePorter 下载裸 `fetch` 无超时；落盘在 `onTurnEnd/onCompleted` 前 await，挂起会冻结会话 | 下载加入 `AbortSignal` + `timeoutMs`（默认 60s）；Orchestrator 落盘再包 120s 硬超时，失败只写回执不阻断完成 |
| P0 | `ReconcileUrls` 的 `-TargetFolder` 有默认值，只传 SiteUrl 会写坏 manifest | 未显式传 `-TargetFolder` 直接 throw；写入前输出 `[RECONCILE-DIFF]` 预览；补“不改 manifest”测试 |
| P1 | 指定账号 IC3 token 失败会静默借用其他账号 | AccountPool 对指定邮箱失败即抛错；FilePorter 对 asyncgw 无 token 显式失败，不再无鉴权请求 |
| P1 | `write_file` 的 `content` 里出现 `url:` 被误判为下载动作 | 下载分支要求 `!content`；补“普通 write_file 不被劫持”测试 |
| P1 | catalog 的 `CLOUD-STALE` 仍输出未验证 URL，与内联索引矛盾 | `CLOUD-STALE` 不输出 URL（改本地读取），测试断言 |
| P1 | 任务范围解析两个三元分支相同，且会用散文日期当 scope | 修正剩余段处理；兜底路径要求工作区内真实存在目录 |
| P1 | 无进展指纹不含 `old_string/new_string/content`，会误跳合法修正重试 | 指纹纳入编辑锚点/内容/窗口字段；补“不同锚点三次重试均执行”测试 |
| P1 | handoff 换号后未更新 `activeAccountEmail`、未重挂 catalog | 后继会话更新邮箱并按新账号重挂 catalog annotation |
| P1 | zip 载荷在非 `.zip` 文件目标上被当目录解压 | 仅 `isDirTarget` 时解压；补“zip 落成文件目标”测试 |
| P2 | 回执把 server-relative URL 当云端 URL | 落盘回执拼成绝对 URL |
| P2 | DeliverablesParser 全篇扫描、行尾过严 | 限定在 deliverables 段（到下一个标题）；允许行尾注释；补测试 |
| P2 | `buildFileSavedAndSyncedReceipt` 死代码却登记为实现点 | 删除该方法，能力台账改为 `LandingService.formatReceipt` |

**未修复（记录为已知限制）**：P2-10 每轮 `git ls-files` + 逐文件 `statSync` 的性能优化，留待后续单独评估（当前工作区 203 文件实测无感知）。

## 5. 真实工作区首轮提示词仿真（只读）

用 `E:\test_workspace` 与用户原任务（含 `.../test_workspace/Library/CNNJI QUERY` URL）调用 `PromptBuilder.buildTurn1Prompt`：

```json
{"chars":25605,"hasInlineMap":true,"hasCatalogNote":true,"hasTargetUrl":true,"hasScope":true,"hasTruncation":true}
```

- 首轮提示词 25.6KB（旧版约 32KB，目标 ≤30KB）；
- 内联映射表存在，包含目标文件 `JsygtBatch.psm1` 的 `test_workspace` URL；
- 任务范围识别为 `Library/CNNJI QUERY`，其余文件按 24KB 预算截断并指向 catalog 附件；
- catalog 附件说明存在。

## 6. 新增/变更测试清单

| 测试文件 | 覆盖能力 |
|---|---|
| `tests/protocol/deliverables-parser.test.ts` | 交付段解析、路径穿越/绝对路径拒绝、zip 语义、去重 |
| `tests/transport/file-porter-deliver.test.ts` | 下载落盘、host allowlist、关键文件保护、覆盖保护、zip 解压/Zip-Slip、IC3 token、`.zip` 原样保存 |
| `tests/auth/ic3-token.test.ts` | IC3 scope、缓存、AccountPool 取 token |
| `tests/delivery/landing-service.test.ts` | 落盘服务、部分失败、回执文案无 token |
| `tests/agent/auto-landing.test.ts` | `FINAL_ANSWER` 交付段自动落盘 + 回执 + `delivery-report.json` |
| `tests/protocol/resilient-parser-deliverables.test.ts` | FINAL_ANSWER 优先级不被链接劫持 |
| `tests/workspace/catalog.test.ts` | catalog 文件系统真值、状态列、当前 URL、陈旧 URL 不输出 |
| `tests/agent/catalog-attachment.test.ts` | per-account + hash 缓存、换号重传、首轮挂载 |
| `tests/protocol/prompt-builder-bounded-map.test.ts` | 24KB 上限、任务范围优先、截断指向附件、prompt 双通道说明 |
| `tests/agent/no-progress-guard.test.ts` | 重复失败动作第 3 次跳过并提示收敛 |
| `tests/cli/ask-question-fallback.test.ts` | 非交互诚实回退，不再伪造用户确认 |
| `tests/skills/prompt-bundle-consistency.test.ts` | 提示词/技能/bundle 镜像字节一致、能力登记 |

## 7. 已知限制

1. `tests/scripts/sp-sync-engine.test.ts` 的 ACL 断言在未启用 ACL 保护的临时目录上失败，属环境既有失败，已在基线报告中隔离。
2. 真实 Copilot 任务验收需要用户重新上传 `dist/copilot-agent-bundle.zip` 后执行（见 `2026-10-26-live-acceptance-checklist.md`）。
3. 内联索引默认 24000 字符；超大工作区会截断并指向 catalog 附件（已由 `prompt-builder-bounded-map` 测试覆盖）。
