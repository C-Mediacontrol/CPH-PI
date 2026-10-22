# CHANGE-REQUEST (变更请求台账)

## 进行中的变更请求

*暂无进行中的变更请求。*

---

## 已完成的变更请求

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
