# Capability Registry（能力 ↔ 提示词 ↔ Harness ↔ 测试）

> 规则 11 的落地台账：任何新增/调整的模型可见能力，必须同时出现在提示词、Harness 实现与自动化测试三处。
> 新增能力时请在此表登记，并在 `tests/skills/prompt-bundle-consistency.test.ts` 或对应契约测试中追加断言。

| 能力 | 提示词 / 技能登记 | Harness 实现点 | 测试 | 开关 |
|---|---|---|---|---|
| 精简内联工作区索引（`[SHAREPOINT REMOTE WORKSPACE]`，24KB 上限、任务范围优先） | `cph-main-agent-prompt.txt` / `cph-coder-agent-prompt.txt` / `cph-dev-agent-prompt.txt`；`PromptBuilder.buildTurn1Prompt` 事实区 | `PnPWorkspaceSyncEngine.buildBoundedRepoMap`；`src/protocol/prompt-builder.ts` 注入 | `tests/protocol/prompt-builder-bounded-map.test.ts`、`tests/protocol/prompt-builder.test.ts` | `CPH_TURN1_INDEX_MAX_CHARS`（默认 24000） |
| 完整目录清单附件（`remote-workspace-catalog.md`，2 层目录树 + 逐文件直链 + 同步状态） | 三个系统提示词与 `skills/handoff`、`skills/subagent` 均以同名引用；首轮事实区注明“完整清单见附件” | `PnPWorkspaceSyncEngine.generateCatalogMarkdown`；`Orchestrator.ensureWorkspaceCatalogAttachment`（per-account + hash 缓存 + 换号重挂） | `tests/workspace/catalog.test.ts`、`tests/agent/catalog-attachment.test.ts` | `enableWorkspaceCatalog`（默认 true） |
| 交付文件自动落盘（`FINAL_ANSWER` 交付段 + `write_file(url)`） | `cph-main-agent-prompt.txt` / `cph-coder-agent-prompt.txt` 的【交付文件与落盘指引 / Deliverables】契约与模板 | `DeliverablesParser`、`LandingService`、`FilePorter.deliverToWorkspace`、`Orchestrator` 两个钩子、`.cph/state/delivery-report.json` | `tests/protocol/deliverables-parser.test.ts`、`tests/delivery/landing-service.test.ts`、`tests/transport/file-porter-deliver.test.ts`、`tests/agent/auto-landing.test.ts` | `enableAutoLanding`（默认 true） |
| 云端 URL 对账（迁移后 manifest 刷新/校正） | 模型不可见（纯 Harness 物理修复） | `scripts/sp-sync-engine.ps1` 的 SKIP 分支 + `ReconcileUrls` action | `tests/scripts/sp-sync-engine.test.ts` | 无 |
| 工具回执来源/状态/新鲜度字段 | 无需提示词登记（回执由 Harness 生成） | `PromptBuilder.buildToolResultPrompt` / `buildAttachedToolResultPrompt` / `buildFileSavedAndSyncedReceipt` | `tests/protocol/prompt-builder.test.ts` | 无 |
| `ask_question` 非交互诚实回退 | 无需提示词登记 | `src/cli.ts` 的 `handleInteractiveQuestion` 返回 `[QUESTION_UNAVAILABLE]` | `tests/cli/ask-question-fallback.test.ts` | 无 |
| 无进展保护（重复失败动作跳过 + 收敛提示） | 无需提示词登记 | `src/agent/orchestrator.ts` 的 action 指纹计数与跳过分支 | `tests/agent/no-progress-guard.test.ts` | 无 |
| 调试指纹（effectiveAgentId / promptHash / 附件清单） | 无需提示词登记 | `src/agent/orchestrator.ts` 每轮 `[CPH-FINGERPRINT]` 日志 | 人工验收（`CPH_DEBUG=1`） | 环境变量 `CPH_DEBUG=1` |

## 变更联动检查清单

1. 新增模型可见能力 → 先在 `cph-*-agent-prompt.txt` 与对应 `skills/` 写正向引导，再写 Harness 实现。
2. 运行 `bun run package` 同步 `package/agent-bundle/`（含 skills 与 zip）。
3. 在本表登记，并补契约测试（提示词关键字 + 实现存在性 + 行为断言）。
4. `git status --porcelain` 必须为空后再提交（规则 12）。
