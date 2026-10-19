# 中立审计报告 G：实施计划复评

> **审计对象**: [`.docs/plans/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-plan.md`](../plans/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-plan.md)（297 行）
> **上游依据**: [v1.3.0 架构规范](../specs/2026-10-19-unified-workspace-supercharger-and-pnp-mirror-architecture.md)
> **审计日期**: 2026-10-19
> **审计立场**: 绝对中立。只判四件事——数字是否成立、任务是否覆盖承诺、依赖是否指向真实代码、验收是否能失败。
> **审计方法**: 逐条重跑计划中的数值；核对计划引用的每个路径与函数；运行当前测试套件取得真实基线；检查计划"未提及"的既有同构实现。
> **前序报告**: [C](./report-C-spec-neutral-review.md) / [D](./report-D-spec-neutral-review-v1.1.md) / [E](./report-E-spec-neutral-review-v1.2.md) / [F](./report-F-spec-neutral-review-v1.3.md)

---

## 0. 判定摘要

| 维度 | 结论 |
|---|---|
| 相对规范的真实进步 | **4 项**（字节口径修正、别名保留互换容错、退避可中断、边界实验立项） |
| 事实错误 | **6 项**（P1–P6） |
| 缺失任务（承诺未落到步骤） | **6 项**（M1–M6，其中 M1/M2 为高风险） |
| 过度理想化 | **5 项**（I13–I17） |
| 有失偏颇 | **4 项**（B11–B14） |
| 可立即执行且无需修改的任务 | Phase 0.1 / 0.2 / 2.1（步骤结构）、Phase 4.2（技能改造） |

**一句话结论**：这份计划在**工程执行层面明显强于规范**（TDD 步序真实、文件级 Create/Modify 明确、字节口径反而比规范更准），但它有两类硬伤：**验收门槛比现状还低**（P1）、**验收断言在落地瞬间就会自我失败**（P2）；同时它按绿地项目写成，而仓库里已经存在一套并行的 snapshot / handoff / virtualization 链路（M1），计划对此零提及。

---

## 1. 相对规范的真实进步（本轮成立）

| 项 | 规范 v1.3.0 | 计划 | 判定 |
|---|---|---|---|
| 快照字节口径（F/N20） | 把 1,324,834 说成快照大小 | 明确区分"151 文件原始字节和 1,324,834 (1.26 MB)"与"产物 `workspace-v1.txt` 1,365,870 字节 (1.30 MiB / 1.37 MB)" | **正确**。我独立复算：原始和 1,324,834、产物 1,365,870，与计划完全一致 |
| 别名兼容性（N24） | 第 4 参改成 `signal`，静默丢弃 `customBaseUrl` 与参数错序启发式 | `customBaseUrlOrSignal?: string \| AbortSignal`，并明确"保留历史启发式互换容错"，测试覆盖 3 参/4 参/错序 | **更保守**，保护了现网行为 |
| 退避可中断 | `setTimeout` 不监听 `signal`，Abort 最长被 60s 挡住 | 新增 `sleepInterruptible(ms, signal)` 并写进 Step 0.1.3 | **真实补洞** |
| 4MB 假说 | 只在 Phase 0 提一句"边界实验" | 立项为独立 Task 0.3，含产出证据文件与"差异则调整常量" | **形式正确**（方法问题见 P3） |

补充：计划引用的 17 个路径我逐个核对，除 `src/workspace/`、`tests/workspace/`（均为 Create 目标，尚不存在）外**全部存在**；两处存量调用点 `orchestrator.ts:880`、`subagent-runner.ts:489` 确为 3 参，改成不破坏。

---

## 2. 事实错误

### P1【事实错误·最严重】验收门槛低于当前现状，无法失败

Phase 5 Step 5.1.1 要求"确保全仓测试用例 100% 绿灯（目标用例数 **≥ 520** 项，断言数 **≥ 2300**）"。

我实跑当前仓库（bun 1.4.2）：

```
 655 pass
 0 fail
 2847 expect() calls
Ran 655 tests across 86 files. [20.19s]
```

- 用例门槛 520 **比现状低 135 项**（655 → 520 仍算通过）；
- 断言门槛 2300 比现状低 547 次；
- 这两个数字取自 [`CHANGELOG.md`](../CHANGELOG.md) L185 的旧基线（72 文件 / 508 用例 / 2235 断言），说明**验收标准是抄历史记录写的，没有核现状**。

后果：这是一个永远不会失败的"全量回归门禁"。哪怕这次改造删掉 130 个测试，Phase 5 照样绿灯。

### P2【事实错误·自指矛盾】Phase 2 的"151 文件"断言在落地瞬间必然失败

Step 2.1.1 要求"验证本仓库实测生成的文件数（**151 个源文件**）与产物大小（**~1.30 MiB**）"。

当前快照构成（我按 §5.1 规则实测）：

| 目录 | 文件数 |
|---|---|
| `tests/` | 86 |
| `src/` | 30 |
| `scripts/` | 21 |
| 根目录 | 10 |
| `skills/` | 2 |
| `docs/`（无点号） | 2 |
| **合计** | **151** |

计划自身会新增 **8 个**会被计入的快照文件：`tests/transport/resumable-uploader.test.ts`、`scripts/test-upload-boundary.ts`、`scripts/sp-sync-engine.ps1`、`tests/scripts/sp-sync-engine.test.ts`、`src/workspace/snapshot-generator.ts`、`tests/workspace/snapshot-generator.test.ts`、`tests/agent/dual-layer-lifecycle.test.ts`、`tests/skills/tri-agent-governance.test.ts`。

因此：
- Phase 2 执行时，快照至少是 **155**（若 Phase 1 已落，则 157）；
- 全计划完成后是 **159**；
- 字节数同步漂移。

**写在 Step 2.1.1 里的断言，会在它被提交的那一次运行就红。** 正确写法是"核心 9 项 ⊆ 快照"（硬断言）+ "文件数与字节数落在记录值 ±N"（软断言），或把 generator 自身与测试目录加入排除。

### P3【事实错误·方法论】Phase 0.3 的边界实验测不到它要验证的东西

Task 0.3 写"通过真实 Graph API 上传构造的 3.9MB 与 4.1MB 文本，记录各自走 `/content` 还是 `createUploadSession`"。

但 `/content` 与 `createUploadSession` 的**选择方是我们自己的 `uploadDocumentAuto`**，而 `CLIENT_SPLIT_THRESHOLD_HYPOTHESIS` 就是我们自己写死的 4MB。这个实验的结构是：

```
输入 3.9MB → 我们的代码判断 3.9 < 4.0 → 走 /content → 记录"走 /content"
```

它 100% 会得到 `3.9→simple, 4.1→resumable`，**与云端行为无关，纯自证**。

真正待验的问题（规范 L27–L30 的原始主张）是：**Copilot Web 客户端/Substrate 云端在 3.9MB 与 4.1MB 附件上的行为是否真的分叉**。这只能通过真实 UI 上传观测，而仓库里已有现成范式——[`run-rag-boundary-test.ts`](../evidence/run-rag-boundary-test.ts) 用 CDP `DOM.setFileInputFiles` 驱动真实附件卡片的做法，正是这个实验该复用的形态。

### P4【事实错误·口径倒退】Goal 首句把 4MB 又说回"限制"

Goal 第一句："**突破 4MB 简易上传限制**"。

Microsoft Graph 简易上传的服务端上限是 **250MB**；4MB 只是本轮确立的**客户端经验假说**。规范 v1.3.0 已把它降级为假说（N10/N13 已闭环），Global Constraints 里也写得准确（"原始字节总和 1,324,834"），但 Goal 又退回旧口径。同一份计划里，第 14 行是"假说"、第 5 行是"限制"。

### P5【事实错误】冲击面矩阵把 `FilePorter` 列为 `uploadDocumentAuto` 的下游

矩阵首行："下游 `Orchestrator`, `SubagentRunner`, **`FilePorter`**"。

实测 [`file-porter.ts`](../../src/transport/file-porter.ts) 的 import 只有 `node:fs`、`node:path`、`node:child_process`，**全文不出现** `SubstrateUploader` 或 `uploadDocument`。`file-porter` 与上传器无调用关系，列进下游会让执行者去改一个不需要改的文件，也会掩盖真正的下游清单。

### P6【事实错误】矩阵把 `prompt-builder.ts` 定为提示词"生产方"

矩阵末行："上游 `prompt-builder.ts` → 下游 Copilot / GPT-6.1 Sol"。

实测 [`prompt-builder.ts`](../../src/protocol/prompt-builder.ts)（395 行）**不读取任何** `cph-*-agent-prompt.txt`；它做的是运行时拼装（工作区事实、目录骨架、激活技能）。提示词 `.txt` 的真正装配与投递在 [`package-agent-bundle.ts`](../../scripts/package-agent-bundle.ts)（L28–L52 `promptMappings` 读四个 .txt 并格式化，L74–L85 拷贝 skills 到 bundle），产物落 `package/agent-bundle/`。

后果不是文字问题：Phase 4 只改 `.txt`、Phase 5 只跑 `bun run package`，**缺"bundle 重新上传/部署到 Copilot Agent + 云端行为验证"这一步**，而"提示词重塑 → 认知重塑"的因果链恰恰断在这里。当前 `package/agent-bundle/` 里只有 `cph-dev-agent-prompt.txt` 一个提示词文件，也侧面证明投递端与源端并不自动同步。

---

## 3. 缺失任务（承诺未落到步骤）

### M1【高风险】计划按绿地写，仓库已有并行快照链路，零提及

仓库现状（实测）：

| 既有实现 | 位置 | 与计划的关系 |
|---|---|---|
| `MainPlanSnapshot` + `saveMainPlanSnapshot`（151 行） | [`src/session/main-plan-snapshot.ts`](../../src/session/main-plan-snapshot.ts) | 写 `.cph/handoffs/main-plan-*.{json,md}`，**已经叫"snapshot"** |
| Orchestrator 调用点 | [`orchestrator.ts:750`](../../src/agent/orchestrator.ts) `createMainPlanSnapshot` / `:757` `saveMainPlanSnapshot` | Phase 3 要改的同一文件 |
| `formatSuccessorTurn1Prompt` | `main-plan-snapshot.ts` 导出 | Phase 4 的"接力防失忆契约"与它职责重叠 |
| TUI 横幅 `formatMainVirtualizationBanner(sessionId, snapshotPath)` | [`tui-renderer.ts:907`](../../src/ui/tui-renderer.ts) | 已存在"快照已落盘"的用户可见提示 |
| 相关既有测试 | `tests/session/snapshot-static-import.test.ts`、`tests/agent/orchestrator-virtualization.test.ts`、`tests/agent/smart-handoff.test.ts`、`tests/integration/virtualization-relay.test.ts` | Phase 3 会动到同一批行为 |

计划完全没有出现 `main-plan-snapshot`、`virtualization`、`handoff` 的任何字样，也没有定义新的 `workspace-snapshot`（源码包）与既有 `main-plan-snapshot`（规划包）的**命名区分、落盘目录分工、Turn 1 挂载顺序**。Phase 3 的 "Modify `orchestrator.ts`" 因此没有可执行接口：新挂载点插在 L750 之前还是之后？两套快照谁上传、谁只落本地？

### M2【高风险】Turn 1 上传失败是**静默吞掉**的，而计划把它当认知地基

现网 [`orchestrator.ts:888-890`](../../src/agent/orchestrator.ts)：

```ts
} catch (uploadErr) {
  // Upload failure must not crash agent; gracefully fallback to inline prompt
}
```

对 tool-result 上传而言这是合理的降级。但计划把"首轮全景快照挂载"设定为整个架构的认知地基（Goal 第 3 条、Phase 3 全部产出都建立在"模型已看到 151 文件快照"之上）。**地基走的是同一条会静默吞错的路径**：一次 1.3MB 上传失败 → 没有附件、没有报错、没有 TUI 提示 → 模型退回无快照的盲跑状态，而所有后续"禁止重复上传全库快照"的优化都会让它一直盲跑。

计划没有任何一步把这条路径改为"快照上传失败即硬失败或至少显式降级（内联/分片重试/告警）"。

### M3【高风险】ACL 与去租户化只存在于约束与矩阵，没有任何任务

- Global Constraints："敏感 Cookie 严格存储于 `~/.cph/pnp-session.json` 并**配置 Windows ACL 仅当前用户访问**"；
- 冲击面矩阵："写入时**自动施加** Windows ACL (`FileSystemAccessRule`)"；
- 但 Phase 1 只有 5 个步骤：PS5.1 断言 → 引用 vendored 模块 → 实现 `SyncSingleFile`/`SyncWorkspace` → CI Mock → commit。

对照模块实测：`icacls|Set-Acl|Get-Acl|FileSystemAccessRule` 命中 **0**；L64–L68 仍保留 `~/.ltk-shipschedule-session.json` 跨项目回退，且 `Write-DpsSessionCache` 用同一 getter（会**写**该共享文件）。

**计划执行完毕，F 报告里的 N25 原样保留。** 约束是承诺，任务是账本，账本没有这两行。

### M4【中】"增量推送"从未定义增量基线

Step 1.1.1 写 `SyncWorkspace`"基于 `git ls-files` **增量**推送"。但增量比较需要持久化基线（mtime 清单 / ETag / 已推送 SHA），计划只定义了 `.cph/state/dirty-sync.jsonl`（**只记失败，不记成功**）。没有"已同步状态"就无处比对，实现者必须自行发明一套，而验收测试只断言"失败写 jsonl"，不会发现增量退化成全量。

### M5【中】快照输出目录未指定，存在"快照套快照"的膨胀路径

`generateWorkspaceSnapshot(workspaceRoot, outputDir)` 的 `outputDir` 在计划里从未给出；而规范 §5/§6 的图里产物叫 `workspace-v1.txt`（看起来就在仓库根）。

`git ls-files --cached --others --exclude-standard` **会收录未跟踪文件**，而 `EXCLUDED_DIR_PREFIXES` 只排 `package/ .docs/ dist/ .cph/ node_modules/`。若产物写在 `CPH-PI/` 根：

- 第 1 次生成 `workspace-<hash1>.txt`（1.30 MiB）；
- 第 2 次生成时，该文件被当作未跟踪 `.txt` 收入 → 快照变 ~2.6 MiB，hash 变，文件名变；
- 第 3 次再翻倍……

`outputDir` 必须写死到 `.cph/`（已 gitignore 且在排除表内）或 `.docs/`，并在测试里加一条"连续生成两次，文件数与字节数稳定"的断言。

### M6【中】"实战对账"名不副实：全计划没有一次真实端到端验证

Phase 5 标题是"全量回归、构建打包与**实战对账**"，实际步骤只有 `bun test` 与 `bun run package` / `build:package`。

云侧三条关键假设全无验证步骤：
1. 1.30 MiB 附件在真实会话里能否就绪、需多久（规范 L44 的 20~25s 只有单次控制台日志）；
2. 模型是否真的"看到"了 151 个文件（而非只索引了其中一部分）；
3. 分块路径在真实网络下是否真的走通（Phase 0.2 全是 mock）。

唯一一次真实实验是 Phase 0.3，而它按 P3 是无意义的。

---

## 4. 过度理想化

### I13 Turn 1 无成本模型

每开一个新会话，都要造 1.30 MiB 快照 + 上传 + 等卡片就绪。规范实测 20~25s。计划对"用户可感延迟""同仓库未变更时是否复用上次 `webUrl`/annotation""上传失败是否退化为内联"三项均无设计。而 Phase 3 的产出写的是"Turn 1 会话启动时**全自动**上传并挂载"——全自动意味着**每次都付这个成本**。

### I14 用绝对数字当门禁

`≥520 用例`、`≥2300 断言`、`151 文件`、`~1.30 MiB` 都是容易过期、且过期后要么永远绿（P1）、要么立刻红（P2）的绝对数。可持续的门禁形式是"不低于本分支当前基线且零失败""核心集 ⊆ 快照"这类相对断言。

### I15 词面断言替代行为断言

Step 4.1.1 用"检查无'严禁''切勿'等负面禁止词"作为治理测试。这是**词汇仪式**：它无法证明提示词能让模型建立 DAG 因果感知，只能证明文本里没出现某些字。而且同一份计划的 Global Constraints 自己就写了 5 处"严禁"（PS5.1、根目录写入、pwsh、凭据入库），说明"禁词"与"坏设计"并不等价。

### I16 把规范当逐字规范搬运

Step 0.2.2："将规范 §3.1 中的分块状态机逻辑**完整落入**"。规范本身已知两处缺陷（4xx 也重试、退避不可中断——后者计划自己在 0.1 修了，前者未提）。"完整落入"会让 `uploadResumable` 继承"400/401/403 也重试 5 次、每次退避 2/4/6/8s、共约 20s 才报错"的行为。

### I17 mock 覆盖即视为风险覆盖

Phase 0.2 的测试用"模拟服务端返回 202 (`nextExpectedRanges`)"推进；Phase 1 用 `MockSharePointSyncClient`；Phase 3 用"模拟 Turn 1 注入全景附件注解"。三层 mock 之后，全部真实不确定性（服务端真实 ranges 格式、真实限流、真实附件卡片、真实 CSP/网络）都被排除在验证之外，而风险恰好都在那里。

---

## 5. 有失偏颇

### B11 "冲击面扫描"只扫了新代码往外的影响

矩阵五行全部是"新制品 → 谁消费它"，没有一行是"既有制品 → 谁会因它被改而受伤"。而最危险的两处（M1 既有 snapshot 链路、M2 静默吞错的上传路径）恰好都属于后一类。标题叫"扫描"，实际是"新功能清单"。

### B12 验收数字来自过期台账，与"真实数据口径"约束自相矛盾

计划把"真实数据口径"写成 Global Constraint（并且字节数确实核过，值得肯定），却在 Phase 5 直接沿用 CHANGELOG 里 72/508/2235 的旧基线，没有跑一次 `bun test` 核对 655/2847。同一份文档里，一处核了实、一处没核。

### B13 零处提及既有同构能力，读者会低估改造面

`main-plan-snapshot`、`formatSuccessorTurn1Prompt`、TUI 快照横幅、4 个 handoff/virtualization 既有测试，全部未出现。执行者会以为 `src/workspace/` 是全新领域，实际上是在一个已有"snapshot"语义的代码库里再加一套 snapshot。

### B14 约束与任务互斥时未声明豁免

Global Constraints 写"生产环境全链路零 CDP / 零浏览器依赖"，而 P3 已说明：要真正验证 4MB 假说**必须**走 CDP/UI。计划既没有给 Phase 0.3 一个"实验豁免"条款，也没说明该实验属于"离线验证"而非"生产链路"，执行者会撞上自己写的约束。

---

## 6. 建议处置

**P0（不改则计划无法起到门禁作用）**
1. Phase 5 门禁改为"`bun test` 零失败 且 用例数 ≥ 当前基线 655、断言数 ≥ 2847"（或写成相对基线 + 禁止减少）。
2. Step 2.1.1 的 151 / 1.30 MiB 断言改为"核心 9 项 ⊆ 快照"硬断言 + 数量/字节软断言；或把 `src/workspace/`、`tests/workspace/` 等自指文件纳入排除，并声明快照不含 generator 自身。
3. 明确 `generateWorkspaceSnapshot` 的 `outputDir` 必须是 `.cph/snapshots/`（已忽略），并加"连续两次生成规模稳定"的断言。
4. 新增任务：Turn 1 快照上传失败必须显式失败或显式降级，禁止沿用 `orchestrator.ts:888` 的静默吞错。
5. 新增任务：`PnPSession.psm1` 施加 ACL + 移除/门控 `~/.ltk-shipschedule-session.json` 回退（否则 M3 承诺落空）。

**P1**
6. Phase 0.3 重写为 UI 侧实验（复用 `run-rag-boundary-test.ts` 的 CDP 范式），或明确降级为"仅验证我方路由开关"，不再声称验证云端阈值。
7. 删除 Goal 首句"突破 4MB 简易上传限制"，改为"实现对 4MB 客户端假说的可验证边界"。
8. 矩阵修正：移除 `FilePorter`；`prompt-builder.ts` 改注为"运行时提示词拼装（与 .txt 无关）"，并补 `package-agent-bundle.ts` 为真实装配/投递方。
9. 新增任务：Phase 4 后重新 `bun run package` 并把 bundle 部署到 Copilot Agent，做一次"新提示词确实生效"的云端验证（当前 `package/agent-bundle/` 仅有 dev prompt，源端/投递端已不同步）。
10. 补 `MainPlanSnapshot` / virtualization 的接口边界：新 `workspace-snapshot` 与既有 `main-plan-snapshot` 的职责、目录、挂载顺序；Phase 3 需列出要跑的既有测试（`snapshot-static-import`、`orchestrator-virtualization`、`smart-handoff`、`virtualization-relay`）。

**P2**
11. `uploadSimple`/`uploadResumable` 只对 429/503/5xx/网络错误重试，4xx 直接失败（避免 20s 后才报鉴权错）。
12. 定义增量基线（`.cph/state/sync-manifest.json`：path → sha256 + lastSyncedAt），并加"未变更文件不重推"的断言。
13. 把"禁词检查"改为行为断言（例如断言提示词包含"阶段屏障/stage"契约字段并能在 mock 工单上解析出 DAG 顺序）。
14. Phase 5 增加 CHANGELOG 条目（当前只改 CHANGE-REQUEST）。

---

## 7. 复现命令

```powershell
# 1) 当前测试真实基线（P1）
cd 'E:\copilot-web proxy\CPH-PI'; bun test tests/    # 655 pass / 2847 expect / 86 files / 20.19s

# 2) 快照构成（P2 / M5）
git -C 'E:\copilot-web proxy\CPH-PI' ls-files --cached --others --exclude-standard

# 3) 既有并行链路（M1）
Select-String -Path 'E:\copilot-web proxy\CPH-PI\src\**\*.ts' -Pattern 'main-plan-snapshot|MainPlanSnapshot|formatSuccessorTurn1Prompt'

# 4) 静默吞错（M2）
Get-Content 'E:\copilot-web proxy\CPH-PI\src\agent\orchestrator.ts' | Select-Object -Skip 866 -First 26

# 5) 矩阵失真（P5 / P6）
Select-String 'E:\copilot-web proxy\CPH-PI\src\transport\file-porter.ts' -Pattern 'SubstrateUploader|uploadDocument'   # 0 命中
Select-String 'E:\copilot-web proxy\CPH-PI\src\protocol\prompt-builder.ts' -Pattern 'agent-prompt\.txt'                # 0 命中
Select-String 'E:\copilot-web proxy\CPH-PI\scripts\package-agent-bundle.ts' -Pattern 'promptMappings|skills'
```

---

## 8. 结语

这份计划的写法比规范健康得多：它把"要做的事"拆成了可勾选的步骤，给了 Create/Modify 的文件级清单，TDD 的 RED→GREEN→commit 顺序是真的，字节口径也主动核过一遍——这些都不是套话。

它的问题集中在两处，且都能低成本修好：

1. **门禁不设防**。520/2300 低于现状 655/2847，151 是自指死数。一条永绿的回归门禁 + 一条必红的自指断言，等于没有门禁。
2. **按绿地施工**。仓库里已经有一套 snapshot/handoff/virtualization 在跑，计划当成不存在；Turn 1 的地基走的又是那条"失败也静默"的上传路径。这两点不改，Phase 3 落地时会撞上两堵没画在图纸上的墙。

把 P0 的五条改完，这份计划就可以直接派给执行者了。
