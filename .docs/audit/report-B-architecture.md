# 对抗复核报告：模块深度与双向冲击面 (Dim-3: improve-codebase-architecture)

- **复核基准文件**: `E:/copilot-web proxy/CPH-PI/.docs/audit/report-A-architecture.md`
- **复核角色**: 对抗审查复审子代理 B3（Adversarial Auditor B3）
- **核查范围**: `E:/copilot-web proxy/CPH-PI` 全量源码与测试套件 (26 个核心源码模块，72 个测试套件，508 个单元测试)
- **参考设计与历史资产**:
  - `E:/copilot-web proxy/CPH-PI/.docs/plans/2026-10-14-safe-remediation-plan.md` (安全整改实施计划 CR-1 ~ CR-5)
  - `E:/copilot-web proxy/CPH-PI/.docs/audit/FINAL-AUDIT-REPORT.md` (全量对抗审计决议蓝图)
  - Git 核心演进记录: `b8ca0fa`, `e207f31`, `b514955`, `d664c13`, `a07a3ed`
- **核心治理依据**:
  - `E:/copilot-web proxy/AGENTS.md` (项目开发与核心治理宪章)
  - 软件设计哲学: John Ousterhout《A Philosophy of Software Design》(深层模块、信息隐藏、消除伪缝隙)
- **裁决分布统计**:
  - `[CONFIRMED]` (确凿缺陷): 6 项 (Issue 2, 3, 4, 5, 6, 7, 8 中的 6 项核心架构问题)
  - `[FALSE-POSITIVE]` (初审误报 / 历史已修复项复读): 4 项 (Issue 1, 9, 10, 12)
  - `[VIOLATES-GOVERNANCE-RULE]` / `[INTENDED-DESIGN]` (建议违宪 / 既定设计): 1 项复合裁决 (Issue 11)
  - `[DRIFT-DESYNC]` (契约设计脱节): 深度融合标注于 Issue 4 与 Issue 5

---

## 紧凑对账索引表 (Reconciliation Table)

| 编号 | A3 报告缺陷简述 | 关键源码位置 | A3置信度 | B3 复核裁决 | 核心依据与事实对账摘要 |
|---|---|---|---|---|---|
| **Issue 1** | `CRASH_SPARSE_ARRAY`<br>稀疏数组并发空洞导致崩溃 | `src/agent/subagent-runner.ts:99, 186-216, 614` | Level 1 | `[FALSE-POSITIVE]`<br>(初审误报 / 已修复) | **已在 CR-1 彻底修复**。L186-196 具备 Stage Fallback 守卫，L208-216 具备全局填充守卫，L614 具备 `if (!r) continue;`。自动化测试 `subagent-sparse-array.test.ts` 100% 绿灯锁死，A3 引用旧行号与历史现象误报。 |
| **Issue 2** | `ACCOUNT_POOL_CONCURRENCY_RACE`<br>AccountPool 异步间隔无锁导致子代理挤占同账号 | `src/auth/account-pool.ts:321-360`<br>`src/agent/subagent-runner.ts:88-89` | Level 1 | `[CONFIRMED]`<br>(确凿架构缺陷) | `getNextAvailableToken` 中 `await getAccessToken` 产生异步间隙，`currentIndex` 未提前递增且无并发租约锁 (`isLeased`)，多个并发 worker 同时调用必分配同一账号，冲击单账号连接上限。 |
| **Issue 3** | `HARDCODED_LEDGER_PROVENANCE`<br>ToolBridge 硬编码静态身份导致账本审计脱节 | `src/protocol/tool-bridge.ts:485-488`<br>`src/session/ledger/execution-ledger.ts:59-88` | Level 1 | `[CONFIRMED]`<br>(确凿数据契约违背) | `recordToLedger` 内部硬编码 `role: "main", sessionId: "main"`。多子代理 (Coder/Researcher) 与多代接力 (Gen 2+) 执行工具时调用方身份被抹除，严重违背治理准则 7（物理账本客观证据链）。 |
| **Issue 4** | `UNPERSISTED_LINEAGE_GRAPH`<br>SessionLineageTracker 纯内存状态导致恢复断代 | `src/session/lineage-tracker.ts:18-31, 99-116`<br>`src/session/session-manager.ts:24-41` | Level 1 | `[CONFIRMED]`<br>+ `[DRIFT-DESYNC]` | `SessionLineageTracker` 内部仅持有易失性 `Map`，未写入磁盘；`SessionRecord` 缺乏 `predecessorId`/`successorId`。跨进程 `/resume` 导致继承链彻底归零，依赖脆弱的 `_genX` / `_hopX` 正则猜测。 |
| **Issue 5** | `ARGUMENT_SNIFFING_CORRUPTION`<br>PromptBuilder 字符串启发式嗅探引发参数倒置 | `src/protocol/prompt-builder.ts:140-165` | Level 1 | `[CONFIRMED]`<br>+ `[DRIFT-DESYNC]` | `buildTurn2TaskPrompt` 使用 `arg2.includes("Skill")` 倒置参数。当工具执行结果（如读取代码、单测日志）包含单词 `"Skill"` 或 `"技能"` 时，工具客观事实与技能内容在 Turn 2 发生灾难性反向颠倒。 |
| **Issue 6** | `HIDDEN_IO_DYNAMIC_REQUIRE`<br>main-plan-snapshot 纯函数隐式引入动态 Require 与物理 I/O | `src/session/main-plan-snapshot.ts:95-110` | Level 1 | `[CONFIRMED]`<br>(确凿伪缝隙缺陷) | `formatSuccessorTurn1Prompt` 作为纯格式化函数，内部暗中执行 `require("./ledger/execution-ledger.ts")` 并读取文件系统，破坏依赖倒置、破坏纯函数可测试性，在严苛模块打包环境下存在隐患。 |
| **Issue 7** | `LOGGER_COHESION_COLLAPSE`<br>TerminalLogger 单例将控制台劫持与结构化日志树强耦合 | `src/ui/terminal-logger.ts:31-89`<br>`src/agent/subagent-runner.ts:66-68` | Level 2 | `[CONFIRMED]`<br>(确凿内聚性与分层反向依赖) | CR-5 仅治理了 ANSI 看板刷屏过滤，未解决 `TerminalLogger` 同时承担控制台输出劫持与会话目录树管理的职责混杂问题；`SubagentRunner` 仍反向强依赖 UI 单例 `TerminalLogger.getInstance()`。 |
| **Issue 8** | `DUPLICATE_AUTONOMOUS_HANDOFF_SLICING`<br>CphPiCli 2100 行上帝类与双重自治接力循环割裂 | `src/cli.ts:1378-1685`<br>`src/agent/orchestrator.ts:758-763` | Level 2 | `[CONFIRMED]`<br>(确凿架构割裂) | `cli.ts` 达 2,122 行。接力状态机被撕裂在两个层级：`Orchestrator` 内部有子代理结题后 `generation++` 与 turn 重置；`cli.ts` 又包装了 300 行 `while (true)` 外层接力循环，表现层严重越界介入核心调度。 |
| **Issue 9** | `EMPTY_RESPONSE_LOOP`<br>传输层空帧零载荷向业务协议泄漏引发死循环 | `src/protocol/resilient-parser.ts:115-122`<br>`src/agent/orchestrator.ts:557-560` | Level 1 | `[FALSE-POSITIVE]`<br>(初审严重误报 / 已修复) | **已在 CR-2 彻底修复**。`ResilientParser` 已将空串分流为 `empty_response` 类型，`Orchestrator` 已实现指数退避重试与熔断，单测 `empty-response-handling.test.ts` 锁定，A3 将已修缺陷反向报出。 |
| **Issue 10** | `CLOUD_ATTACHMENT_ZERO_THRESHOLD`<br>云端附件阈值为 0 强制直传致使模型工作内存完全剥离 | `src/agent/orchestrator.ts:196-203`<br>`src/protocol/prompt-builder.ts:215-228` | Level 1 | `[FALSE-POSITIVE]`<br>(初审严重误报 / 已修复) | **已在 CR-3 彻底修复**。默认阈值已调整为 12,000 字符与 200 行，且附带 Head-Tail 摘录物理指纹，单测 `cloud-attachment-threshold.test.ts` 锁死，A3 对历史修复事实完全脱节。 |
| **Issue 11** | `SHELL_ESCAPING_MISMATCH`<br>Windows 环境下 Git Bash 变量展开导致 PowerShell 语法崩溃 | `src/protocol/tool-bridge.ts:351-396`<br>`cph-main-agent-prompt.txt:48-50` | Level 1 | `[VIOLATES-GOVERNANCE-RULE]`<br>(建议违宪)<br>─────────<br>`[INTENDED-DESIGN]`<br>(认知塑形既定设计) | A3 建议在 Harness 执行层建立拦截改写 Seam，**严重违反《AGENTS.md》准则 1（严禁在 Harness 替模型擦屁股）**；CR-4 已按准则 2（认知塑形）在系统提示词中正向注入 POSIX Git Bash 单引号规范。 |
| **Issue 12** | `NEGATIVE_PROMPT_PARALYSIS`<br>负面禁止词引发“粉色大象”效应与认知麻痹 | `src/protocol/prompt-builder.ts:20-28, 178-180`<br>`src/session/ledger/execution-ledger.ts:129` | Level 1 | `[FALSE-POSITIVE]`<br>(初审严重误报 / 已清洗) | **已在 CR-4 全量清洗**。A3 所列的 `prompt-builder.ts:27-28, 180`, `execution-ledger.ts:129`, `SKILL.md:207` 经源码逐行核验，所有“严禁/切勿/不要”均已重构为正向指引，单测 `prompt-builder-governance.test.ts` 绿灯通过。 |

---

## 逐项事实对抗核验与深度推演详情

---

### Issue 1: 稀疏数组并发空洞导致运行时崩溃 (CRASH_SPARSE_ARRAY)

- **A3 初审主张与 PoC**:
  A3 指责 `subagent-runner.ts:99` 中 `new Array(tasks.length)` 创建了稀疏数组，并发熔断时未执行的任务槽位为 `undefined`，下游 `formatReportSummary` 访问 `reports[i].success` 触发致命 `TypeError` 崩溃。
- **源码逐行对账事实**:
  1. 查阅当前 `src/agent/subagent-runner.ts` 源码：
     - **第 186-196 行 (Stage 级防空洞守卫)**:
       ```typescript
       // Stage fallback guard: ensure all tasks in the current stage are settled (no holes)
       for (const item of stageTasks) {
         if (!settled[item.index]) {
           const reason = signal?.aborted
             ? new Error("Subagent execution aborted")
             : new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 任务因熔断或中断未执行`);
           settled[item.index] = { status: "rejected", reason };
         }
       }
       ```
     - **第 208-216 行 (全局数组密实守卫)**:
       ```typescript
       // Global guard: ensure no empty slots remain in settled array
       for (let idx = 0; idx < tasks.length; idx++) {
         if (!settled[idx]) {
           settled[idx] = { status: "rejected", reason: new Error("STAGE_CIRCUIT_BREAKER: 任务未执行或被熔断阻断") };
         }
       }
       ```
     - **第 614 行 (`formatReportSummary` 非空防御)**:
       ```typescript
       for (let i = 0; i < reports.length; i++) {
         const r = reports[i];
         if (!r) continue; // 💥 显式非空守卫已就位
         const statusIcon = r.success ? "✅ 成功" : "❌ 失败";
       ```
  2. 查阅最新特征测试 `tests/agent/subagent-sparse-array.test.ts`：两个包含空洞与 `undefined` 的极端用例均已通过并锁死行为。
- **复核裁决**: `[FALSE-POSITIVE]` (初审误报 / 历史已修复缺陷复读)
- **根因剖析与对抗裁决意见**:
  该问题已于 2026-10-14 在安全整改计划 Task 1 (CR-1) 中彻底整改闭环。初审子代理 A3 未亲阅最新源码及新增单测，照搬整改前的历史描述与已过时行号进行误报。

---

### Issue 2: AccountPool 异步间隔无锁导致并发子代理挤占同账号 (ACCOUNT_POOL_CONCURRENCY_RACE)

- **A3 初审主张与 PoC**:
  A3 指出 `AccountPool.getNextAvailableToken` 在调用 `await this.manager.getAccessToken(acc.email)` 时存在异步间隙，事件循环让渡执行权期间 `currentIndex` 未更新且无并发占用标记，导致多个并发 worker 全部获取同一个账号并挤占同一 WebSocket 连接。
- **源码逐行对账事实**:
  查阅 `src/auth/account-pool.ts:339-346`：
  ```typescript
  if (!status.isThrottled) {
    try {
      const session = await this.manager.getAccessToken(acc.email); // 💥 异步 I/O 挂起点
      this.currentIndex = (idx + 1) % total;
      status.lastUsedAt = now;
      status.totalRequests++;
      return session;
  ```
  在 `await this.manager.getAccessToken` 挂起期间，第二个并发 worker 进入循环，此时 `this.currentIndex` 仍然是旧值，且 `status` 只有 `lastUsedAt`，没有任何 `inUse`、`isLeased` 或租约计数。两个并发任务必然获取完全相同的账号令牌。
- **原作者辩护推演 (Steelmanning)**:
  1. `AccountPool` 最初是为单会话串行交互设计的：每轮推理轮询可用账号，若遭遇 429 则调用 `markThrottled` 切换到下一个账号。在该串行模型下，`await getAccessToken` 之后再递增 `currentIndex` 完全正确且逻辑清晰。
  2. 当 `SubagentRunner` 引入多子代理并发调度时（`src/agent/subagent-runner.ts:88-89` 计算 `maxConcurrency = Math.min(effectiveCapacity, tasks.length)`），调度器假设“账号池里有 N 个可用账号，就能支撑 N 个并发子代理并行跑”。然而，作者未同步对 `AccountPool` 进行并发升级，导致调度层面的并发假设在物理资源分配层被击穿。
- **治理宪章 (AGENTS.md) 校验**:
  符合准则 1（Harness 物理实现缺陷）：这是 Harness 基础设施内部资源竞态导致的真实 Bug，直接引发 Copilot 服务端单账号连接并发超限与封禁风险。
- **复核裁决**: `[CONFIRMED]` (确凿架构缺陷)
- **建议整改方向**:
  在 `AccountPool` 中引入原子租约机制（Lease Lock）：在发起异步获取前同步打上租约或递增并发占用计数；当子代理会话完成时（或超时）通过归还接口释放租约。

---

### Issue 3: ToolBridge 硬编码静态身份导致账本审计证据链脱节 (HARDCODED_LEDGER_PROVENANCE)

- **A3 初审主张与 PoC**:
  A3 揭示 `ToolBridge.recordToLedger` 内部将角色硬编码为 `role: "main", sessionId: "main"`，导致所有子代理（Coder、Researcher）与后继接力者的物理工具调用在账本中全部被记为 `main`。
- **源码逐行对账事实**:
  查阅 `src/protocol/tool-bridge.ts:485-488`：
  ```typescript
  this.ledger.recordStep({
    role: "main",       // 💥 静态硬编码
    sessionId: "main",  // 💥 静态硬编码
    tool: toolName,
    target,
    status: success ? "SUCCESS" : "FAILURE",
    modifiedFiles,
    statusBadge,
    briefSummary: output.slice(0, 200),
  });
  ```
  源码中毫无动态上下文传递逻辑。所有通过该 Bridge 调用的工具（哪怕由独立子会话发起）在落盘预写日志 `.cph/state/execution-ledger.jsonl` 与 Markdown 视图中全部被盖上 `main` 印章。
- **原作者辩护推演 (Steelmanning)**:
  在引入 `ExecutionLedger`（提交 `a07a3ed` 和 `d664c13`）时，核心目标是为主控会话自治接力提供前序操作指纹。`ToolBridge` 采用工作区单例或简单复用模式，为了不在各层级大量重构函数签名，作者暂时写死了 `"main"` 作为占位符。
- **治理宪章 (AGENTS.md) 校验**:
  违反准则 7（状态持久化与工作内存正交分层准则）：底层 WAL 预写日志必须真实记录“物理世界的状态持久化、工具执行事实与历史证据”。硬编码身份导致审计证据失真，违背了事实记录的严肃性。
- **复核裁决**: `[CONFIRMED]` (确凿数据契约违背)
- **建议整改方向**:
  在 `ToolBridge` 构造函数或 `executeAction` 方法中增加可选上下文参数 `context?: { role: string; sessionId: string }`，缺省时安全兜底，禁止写死静态字面量。

---

### Issue 4: SessionLineageTracker 纯内存状态导致跨会话与恢复断代 (UNPERSISTED_LINEAGE_GRAPH)

- **A3 初审主张与 PoC**:
  A3 指出 `SessionLineageTracker` 仅在内存持有 `Map<string, SessionLineage>`，退出 CLI 重启后状态完全丢失；`SessionManager` 持久化的 `SessionRecord` 缺乏血缘字段，迫使系统使用正则匹配 `_genX` / `_hopX` 兜底，继承图谱彻底断裂。
- **源码逐行对账事实**:
  1. 查阅 `src/session/lineage-tracker.ts:19`：`private registry = new Map<string, SessionLineage>();`，全局未搜索到任何文件读写调用。
  2. 查阅 `src/session/session-manager.ts:24-41`：`SessionRecord` 包含 `generation` 和 `handoffCount`，但完全没有 `predecessorId`、`successorId`、`parentSessionId` 字段。
  3. 查阅 `src/cli.ts:452-465`：当使用 `--resume <id>` 恢复会话时，`this.orchestrator` 重新初始化，其持有的 `SessionLineageTracker` 为新实例，`registry` 空空如也。
  4. 查阅 `src/session/lineage-tracker.ts:99-116`：存在针对 `_gen(\d+)` 与 `_hop(\d+)` 的字符串后缀嗅探。
- **原作者辩护推演 (Steelmanning)**:
  作者最初将 `SessionLineageTracker` 定位为“当前在线调度周期的临时拓扑器”（用于主控 429 切换后，让仍在运行的子代理能通过 `resolveActiveHead` 找到活着的继承者主控）。会话的长期持久化则通过 `SessionRecord.handoffSnapshot` 传递成果。
- **治理宪章 (AGENTS.md) 校验**:
  违反准则 7（状态持久化与工作内存正交分层）：会话树的血缘图谱属于宿主持久化资产，不应仅存留于内存工作区中。
- **复核裁决**: `[CONFIRMED]` + `[DRIFT-DESYNC]` (确凿架构断代与契约脱节)
- **建议整改方向**:
  在 `SessionRecord` 中补齐 `predecessorId`、`successorId`、`parentSessionId`，并在 `SessionManager.saveSession` / `loadSession` 时与 `SessionLineageTracker` 实现双向自动同步。

---

### Issue 5: PromptBuilder 字符串启发式嗅探引发参数倒置 (ARGUMENT_SNIFFING_CORRUPTION)

- **A3 初审主张与 PoC**:
  A3 揭露 `PromptBuilder.buildTurn2TaskPrompt` 内部通过嗅探字符串是否包含 `"Skill"` 或 `"技能"` 来猜测参数顺序，当工具输出包含上述关键词时会导致参数颠倒。
- **源码逐行对账事实**:
  查阅 `src/protocol/prompt-builder.ts:140-159`：
  ```typescript
  public static buildTurn2TaskPrompt(
    task: string,
    arg2: string,
    arg3 = "",
    toolName?: string
  ): string {
    let skillsSection = "";
    let toolResult = "";

    if (arg3 !== undefined && arg3 !== "") {
      if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
        skillsSection = arg2;
        toolResult = arg3;
      } else if (arg3.includes("Skill") || arg3.includes("技能")) {
        toolResult = arg2;
        skillsSection = arg3;
      } else {
        skillsSection = arg2;
        toolResult = arg3;
      }
    }
  ```
  注释明目张胆地写着：`Supports both (task, skillsSection, toolResult) and (task, toolResult, skillsSection).`
  如果被检查的文件或测试日志包含 `"Skill"` 字符串（例如排查技能模块 `skill-loader.ts`），`arg2.includes("Skill")` 必然为真，原本作为 `toolResult` 传入的 `arg2` 被强行当作技能说明，工具输出与技能配置在 Turn 2 中直接对调！
- **原作者辩护推演 (Steelmanning)**:
  这是典型的兼容性历史技术债务。在早期重构中，上游多个调用方传参顺序不一致，作者未在编译期统一签名，而是写了一段启发式字符串检查以图“两全其美”。
- **复核裁决**: `[CONFIRMED]` + `[DRIFT-DESYNC]` (确凿浅层模块与多态破坏缺陷)
- **建议整改方向**:
  废除模糊多态签名，改为显式命名对象参数：`buildTurn2TaskPrompt(options: { task: string; toolResult: string; skillsSection?: string; toolName?: string })`。

---

### Issue 6: main-plan-snapshot 纯格式化函数隐式引入动态 Require 与物理 I/O (HIDDEN_IO_DYNAMIC_REQUIRE)

- **A3 初审主张与 PoC**:
  A3 指出 `formatSuccessorTurn1Prompt` 在处理账本挂载头时，使用动态 `require("./ledger/execution-ledger.ts")` 读取磁盘，破坏了纯函数的确定性与依赖隔离。
- **源码逐行对账事实**:
  查阅 `src/session/main-plan-snapshot.ts:100-109`：
  ```typescript
  let mountHeader = customLedgerMountHeader;
  if (!mountHeader && snapshot.workspaceRoot) {
    try {
      const { ExecutionLedger } = require("./ledger/execution-ledger.ts");
      const ledger = new ExecutionLedger(snapshot.workspaceRoot);
      mountHeader = ledger.formatMountHeader();
    } catch {
      // 容错忽略
    }
  }
  ```
  该函数签名与职责原本属于纯 Markdown 提示词模版格式化，但在入参缺省时背地里动态加载模块并访问真实物理文件系统。
- **原作者辩护推演 (Steelmanning)**:
  在提交 `d664c13` 中，作者为了让上游不必显式传递账本挂载头，提供了一个便捷的自动化兜底；同时为了避免 `main-plan-snapshot.ts` 与 `execution-ledger.ts` 形成顶层循环依赖，采用了内联 `require`。
- **治理宪章 (AGENTS.md) 校验**:
  违背 John Ousterhout 关于信息隐藏与深层模块的理论（属于典型的“伪缝隙 Fake Seam”）：外部看似无副作用，内部却隐式持有文件句柄与 I/O，且相对路径带 `.ts` 在打包后可能失效。
- **复核裁决**: `[CONFIRMED]` (确凿隐式副作用与伪缝隙缺陷)
- **建议整改方向**:
  依赖倒置：提示词组装函数只消费数据，`mountHeader` 必须由调用方显式计算后传入，彻底移除内部动态加载。

---

### Issue 7: TerminalLogger 单例将控制台劫持与结构化日志目录强耦合 (LOGGER_COHESION_COLLAPSE)

- **A3 初审主张与 PoC**:
  A3 指责 `TerminalLogger` 同时承担全局控制台 stdout/stderr 拦截与会话磁盘目录树构建（`initSessionTree`），导致后台模块 `SubagentRunner` 强耦合 UI 单例。
- **源码逐行对账事实**:
  1. 查阅 `src/ui/terminal-logger.ts`：类内同时包含终端 ANSI 流拦截、`isHooked` 控制台劫持，以及创建 `.cph/logs/<sessionId>/subagents` 目录与写入 `timeline.jsonl` 的 `initSessionTree` 方法。
  2. 查阅 `src/agent/subagent-runner.ts:66-68`：
     ```typescript
     this.loggerTree =
       options.loggerTree ||
       TerminalLogger.getInstance().initSessionTree(this.mainSessionId, this.workspaceRoot);
     ```
     Agent 核心调度层直接依赖 UI 展现层的单例工厂。
  3. 整改计划 CR-5 的改动仅针对 TUI 矩阵重绘帧在日志文件中的过滤截断，并未拆分 `TerminalLogger` 的多重职责。
- **原作者辩护推演 (Steelmanning)**:
  早期阶段将所有与“Log”相关的逻辑归入一处，便于快速调试，减少配置传递。
- **复核裁决**: `[CONFIRMED]` (确凿分层架构反向依赖与低内聚缺陷)
- **建议整改方向**:
  将结构化会话目录树管理与时间线事件记录提取为独立的 `SessionLogTreeManager`，归入 `session/` 或独立日志服务层；`TerminalLogger` 退回 UI 层纯粹负责 ANSI 录制与控制台分流。

---

### Issue 8: CphPiCli 2100 行大文件与双重自治接力循环割裂 (DUPLICATE_AUTONOMOUS_HANDOFF_SLICING)

- **A3 初审主张与 PoC**:
  A3 批判 `CphPiCli` 拥有超过 2,100 行代码，且自治接力状态机被撕裂在 CLI 层与 Orchestrator 层重复实现。
- **源码逐行对账事实**:
  1. `src/cli.ts` 物理行数为 2,122 行，包含 30 个配置项、数十个命令分发与终端渲染交织。
  2. `cli.ts:1403-1624` 的 `executeTask` 内部实现了一个复杂的 `while (true)` 外层循环：
     - 手动计算 `hopCount`；
     - 手动调用 `sessionManager.createSession` 创建接力会话；
     - 手动重置 `orchestrator.resetHandshake()`；
     - 手动拼装接力提示词（`【自主接力延续任务 - 阶段 ${nextStage}】...`）。
  3. 与此同时，`src/agent/orchestrator.ts:758-763` 内部也实现了一套子代理结题后的接力与 `generation++`、`turn = 0` 轮数重置状态机。
  4. 两层接力逻辑各自为政、职责割裂，导致核心编排器（Orchestrator）无法脱离 CLI 独立完成端到端的自治长耗时任务。
- **原作者辩护推演 (Steelmanning)**:
  CLI 是原作者唯一的交互载体，接力过程中需要频繁在终端打出横幅、重绘看板、重置 Readline 提示符。作者为了响应交互事件，将外层接力控制权留在了 CLI。
- **复核裁决**: `[CONFIRMED]` (确凿上帝类与编排状态机撕裂缺陷)
- **建议整改方向**:
  将自治接力外循环完全收敛沉淀至 `CopilotOrchestrator`（或独立的 `SessionEngine`），使其成为支持长会话自治推进的深层模块；CLI 仅作为观察者通过事件回调（Event Listener）接收通知并打印横幅。

---

### Issue 9: 传输层空帧零载荷向业务协议泄漏引发死循环 (EMPTY_RESPONSE_LOOP)

- **A3 初审主张与 PoC**:
  A3 指责底层 SignalR WebSocket 传输层返回空字符串时，`ResilientParser` 将其误判为 `invalid_chatter` 并注入纠偏提示词，`Orchestrator` 自增 `turn++` 并秒级烧光 30 轮预算。
- **源码逐行对账事实**:
  1. 查阅当前 `src/protocol/resilient-parser.ts:115-122`：
     ```typescript
     if (trimmed === "") {
       return {
         type: "empty_response",
         thought: extractedThought,
       };
     }
     ```
     空响应已被严格识别为独立的 `empty_response` 类型，不再归为 `invalid_chatter`！
  2. 查阅当前 `src/agent/orchestrator.ts:557-560` 及 L837-L852：
     ```typescript
     if (parsed.type === "empty_response") {
       // 触发指数退避重试，不递增正式 turn，不注入纠偏警告
     ```
  3. 查阅最新特征测试 `tests/protocol/empty-response-handling.test.ts`：
     - 用例 1: `should classify empty string as empty_response rather than invalid_chatter` (PASS)
     - 用例 4: `should retry transient empty responses without incrementing formal turn` (PASS)
     - 用例 5: `should throw EMPTY_RESPONSE_LIMIT_EXCEEDED when consecutive empty responses exceed limit` (PASS)
- **复核裁决**: `[FALSE-POSITIVE]` (初审严重误报 / 历史已修复缺陷复读)
- **根因剖析与对抗裁决意见**:
  此问题在安全整改计划 Task 2 (CR-2) 中已彻底修复并全量绿灯验证。初审 A3 甚至直接抄录了整改测试用例中的报错关键字作为其“反例提案”，存在严重的上下文倒流与误判。

---

### Issue 10: 云端附件阈值为 0 强制直传致使模型工作内存完全剥离 (CLOUD_ATTACHMENT_ZERO_THRESHOLD)

- **A3 初审主张与 PoC**:
  A3 指责系统将附件上传阈值设为 0，任何工具调用（哪怕 1 字符或 3 行短文本）都会无条件上传至 OneDrive，导致模型无法读取上下文中的执行事实，智能体失明。
- **源码逐行对账事实**:
  1. 查阅当前 `src/agent/orchestrator.ts:162-163, 196-203`：
     ```typescript
     this.cloudAttachmentThresholdChars =
       options.cloudAttachmentThresholdChars !== undefined
         ? options.cloudAttachmentThresholdChars
         : 12000; // 默认 12,000 字符
     this.cloudAttachmentThresholdLines =
       options.cloudAttachmentThresholdLines !== undefined
         ? options.cloudAttachmentThresholdLines
         : 200;   // 默认 200 行
     ```
     默认阈值明确为 12,000 字符与 200 行，绝非 0！
  2. 查阅当前 `src/protocol/prompt-builder.ts:242-251`：
     超限上传附件时，提示词明确嵌入 `【物理执行指纹摘要 (Head-Tail Fingerprint)】`，保留首尾核心行与状态码。
  3. 查阅最新特征测试 `tests/agent/cloud-attachment-threshold.test.ts:21-30`：
     明确断言 `expect(status.chars).toBe(12000); expect(status.lines).toBe(200);` 100% 绿灯通过。
- **复核裁决**: `[FALSE-POSITIVE]` (初审严重误报 / 历史已修复缺陷复读)
- **根因剖析与对抗裁决意见**:
  该问题在安全整改计划 Task 3 (CR-3) 中已完成调优。初审 A3 所描述的“阈值为 0 强制直传”系历史阶段方案，当前代码事实完全不支持 A3 的指控。

---

### Issue 11: Windows 环境下 Git Bash 变量展开导致 PowerShell 语法崩溃 (SHELL_ESCAPING_MISMATCH)

- **A3 初审主张与整改建议**:
  A3 指出 Windows 下使用 Git Bash 执行带双引号的 PowerShell 命令（如 `powershell -Command "$var = 'OK'"`）时，Bash 提前将 `$var` 展开置空。A3 建议：
  - 方案一：通过提示词正向引导模型使用单引号；
  - 方案二：**在执行层（ToolBridge）建立平台命令适配 Seam，阻断 POSIX Shell 对 Windows 变量的提前展开破坏**。
- **源码逐行对账事实与治理宪章检验**:
  1. 查阅 `cph-main-agent-prompt.txt:48-50`：
     ```
     2. 运行命令（单步）：
     终端命令默认在 POSIX 规范环境（Windows 下为 Git Bash）执行；若执行 PowerShell 脚本，外层请统一使用单引号字面量包裹（如 powershell.exe -NoProfile -Command '...'），防止内部变量被提前展开。
     ```
     整改计划 Task 4 (CR-4) 已按规范将此认知规范注入系统提示词，并通过单测 `tests/protocol/prompt-builder-governance.test.ts` 锁定。
  2. 检验《AGENTS.md》核心开发与治理准则：
     - **准则 1 (Harness 纯粹与中立原则)**：*“Harness 本身必须保持绝对中立与纯粹：无论 Copilot 模型返回什么内容、内容是对是错，Harness 只管按统一既定协议进行客观处理与调度，严禁在 Harness 代码中给模型打特化补丁或‘替模型擦屁股’。”*
     - **准则 2 (认知塑形与正向引导优先)**：*“模型行为异常的根本解法，是让 Copilot Agent 建立清晰的自我认知与情境感知……所有精力与重构重心应当放在 Copilot Agent 的系统提示词设计上……而不是在 Harness 调度层做妥协。”*
  3. A3 提议在 Harness 执行层设立适配层去嗅探、解析、转义模型发出的命令行字符串，是典型的“替模型擦屁股”行为，直接违反准则 1！
- **复核裁决**:
  - A3 提议在 Harness 层拦截转义：`[VIOLATES-GOVERNANCE-RULE]` (严重违反治理准则 1)
  - 现行提示词正向认知塑形：`[INTENDED-DESIGN]` (符合治理准则 2 的既定正向设计，已在 CR-4 闭环)

---

### Issue 12: 负面禁止词引发“粉色大象”效应与认知麻痹 (NEGATIVE_PROMPT_PARALYSIS)

- **A3 初审主张与 PoC**:
  A3 声称在 `prompt-builder.ts:27-28, 180, 247`、`execution-ledger.ts:129`、`skills/subagent/SKILL.md:207` 中残留大量“严禁”、“切勿”、“不要”等负面禁止词。
- **源码逐行对账事实**:
  对 A3 所指出的每一行进行物理排查：
  1. `src/protocol/prompt-builder.ts:27-28`:
     `2. 当所有目标已达成且验证充分时，直接在独立一行输出最终交付总结：FINAL_ANSWER: <任务交付总结说明>` —— **零负面词**。
  2. `src/protocol/prompt-builder.ts:180`:
     `3. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。` —— **零负面词**。
  3. `src/protocol/prompt-builder.ts:249`:
     `【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件已解析的全部数据推进后续技术推演与操作。` —— **零负面词**。
  4. `src/session/ledger/execution-ledger.ts:129`:
     `- 查阅契约: 上述客观事实已由系统物理验证。如需回溯某一步的详细改动或命令输出，请使用 read_file / view_file 工具定向查看账本文件，通过调阅物理账本或关键指纹获取执行事实。` —— **零负面词**。
  5. `skills/subagent/SKILL.md:207`:
     `| ❌ 忽略测试证据直接裁决 | 盲目信任子代理文本输出，遗漏隐蔽 Bug | 主控必须在收到 Coder 报告中的真实测试绿灯证据后再输出 FINAL_ANSWER |` —— 正向最佳实践对照表，**零“严禁/切勿”词汇**。
  6. 运行专门的治理单测 `bun test tests/protocol/prompt-builder-governance.test.ts`：100% 绿灯通过，明确断言生产提示词不含负面禁止词。
- **复核裁决**: `[FALSE-POSITIVE]` (初审严重误报 / 历史已清洗项复读)
- **根因剖析与对抗裁决意见**:
  初审子代理 A3 严重脱离当前代码现实，未能感知 CR-4 全量清洗事实，对已被重构为正向指引的健康代码进行了无根据的指控。

---

## 7 类制品双向冲击面对抗修正矩阵 (Reconciled Blast-Radius Matrix)

依据复核对账结果，对初审提出的 7 类制品冲击面进行实事求是的修正：

| 制品类型 | ⬆️ 上游（生产方/输入端） | ⬇️ 下游（消费方/交付端） | 关联真实缺陷 (已剔除误报) | 修正后风险评级 | 裁决说明 |
|---|---|---|---|---|---|
| **函数/接口** | 参数传递、多态签名（`buildTurn2TaskPrompt`、`CphPiCliOptions`） | 接口混淆、传参倒置（`toolResult` 被误判为 `Skill`） | Issue 5, 8 | 🔴 极高 | 接口模糊多态与 CLI 上帝类真实存在；原 Issue 1 稀疏数组崩溃已修复降级。 |
| **全局状态** | 账号池状态管理（`AccountPool`、`currentIndex`） | 令牌租约并发冲突、单账号并发超限封禁 | Issue 2 | 🔴 极高 | 异步挂起点无锁并发竞态真实存在，威胁账号安全。 |
| **数据/存储** | 会话持久化、执行账本落盘（`SessionRecord`、`ExecutionLedger`） | 继承图谱丢失、审计追溯失真（硬编码 `main`） | Issue 3, 4 | 🔴 极高 | 账本身份抹除与跨进程血缘丢失真实存在，违背治理准则 7。 |
| **文件/资源** | 磁盘目录创建（`.cph/logs/`） | 分层依赖反转（Agent 依赖 UI 单例创建目录） | Issue 6, 7 | 🟡 中 | 纯函数隐式 I/O 与 TerminalLogger 职责混杂真实存在。 |
| **配置文件** | 阈值参数（`cloudAttachmentThresholdChars`） | 上传决策流向 | *无* | 🟢 低 (已收敛) | 原 Issue 10 阈值已在 CR-3 调整为 12k/200 行，风险已解除。 |
| **共享常量** | 提示词协议模板（`PROTOCOL_REMINDER`） | 模型注意力解码 | *无* | 🟢 低 (已收敛) | 原 Issue 12 负面词已在 CR-4 全量清洗，风险已解除。 |
| **依赖/库** | 外部平台进程（Git Bash、SignalR） | 变量展开、网络空响应 | *无 (已治理)* | 🟢 低 (已收敛) | 原 Issue 9 空帧已分流重试；原 Issue 11 已在提示词完成单引号范式对齐。 |

---

## 深层模块重构演进蓝图与落地建议 (Actionable Deep Architecture Roadmap)

基于 John Ousterhout 深度理论与复核确认的 6 项核心缺陷（Issue 2, 3, 4, 5, 6, 7, 8），提出如下高杠杆深层模块整改实施路线：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CphPiCli (纯粹薄展现层)                         │
│  (仅负责: 命令行参数解析、ANSI 终端样式、Readline 交互与事件展示)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 事件驱动监听 (onTurn, onHandoff, onTool)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 CopilotOrchestrator (深层会话核心)                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. 统一自治多代接力循环 (吸收 cli.ts 中 300 行外层接力状态机)    │  │
│  │ 2. 显式配置契约 (消除 PromptBuilder 参数嗅探与模糊多态)         │  │
│  │ 3. 纯函数化提示词构建 (消除 main-plan-snapshot 隐式 require)     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────┬───────────────────────────┬────────────────────────┘
                    │ 调度                      │ 执行与追溯
                    ▼                           ▼
┌───────────────────────────────┐   ┌────────────────────────────────────┐
│      DeepAccountPool          │   │         DeepToolRuntime            │
│  (原子化租约状态机 Lease Lock,│   │  (动态追踪调用方 role / sessionId, │
│   彻底杜绝并发子代理挤占同账号)│   │   消除 ToolBridge 静态写死 main)   │
└───────────────────────────────┘   └─────────────────┬──────────────────┘
                                                      │ 持久化
                                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      DeepSessionStorage                                │
│  (合并 SessionManager、LineageTracker 与 ExecutionLedger，持久化完整   │
│   继承拓扑图，彻底解决跨进程 /resume 血缘归零问题)                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 推荐整改步骤与行动清单：
1. **P0: 引入 AccountPool 原子租约状态机 (解决 Issue 2)**
   - 在 `AccountPool` 中维护 `leasedAccounts: Set<string>` 或租约计数；
   - `getNextAvailableToken` 获取前原子标记占用，配合会话生命周期释放。
2. **P0: 补齐 ToolBridge 执行身份上下文 (解决 Issue 3)**
   - `ToolBridge.executeAction(action, signal, context?: { role: string; sessionId: string })`；
   - 动态将调用方身份如实追加至 `ExecutionLedger`。
3. **P1: 统一会话持久化与血缘图谱 (解决 Issue 4)**
   - 在 `SessionRecord` 中增加 `predecessorId`、`successorId`、`parentSessionId`；
   - 移除内存 Map 依赖与脆弱的 `_genX` / `_hopX` 正则猜测。
4. **P1: 重构 PromptBuilder 显式对象接口 (解决 Issue 5)**
   - 废除模糊多态嗅探，采用强类型对象签名，从根源消除参数倒置。
5. **P2: 纯函数化 Snapshot 提示词组装 (解决 Issue 6)**
   - 将 `mountHeader` 改为必须显式传入，移除动态 `require("./ledger/execution-ledger.ts")`。
6. **P2: 下沉自治接力循环，瘦身 CphPiCli (解决 Issue 8 & Issue 7)**
   - 将外层 `while (true)` 接力循环下沉至 `Orchestrator`；
   - 将 `initSessionTree` 移出 `TerminalLogger`，解耦 Agent 层对 UI 单例的依赖。
