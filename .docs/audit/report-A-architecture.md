# 初审报告：模块深度与双向冲击面 (Dim-3: improve-codebase-architecture)

- **审查对象**: `E:\copilot-web proxy\CPH-PI`
- **审查模式**: Full Mode
- **扫描文件数**: 98 (含 `src/` 26 个核心源码模块及 `tests/` 72 个测试套件)
- **理论依据**: John Ousterhout《软件设计的哲学》(A Philosophy of Software Design)、`improve-codebase-architecture` 架构规范与《AGENTS.md》核心治理准则

---

## 架构宏观全景与深度评估

依据《软件设计的哲学》，优秀软件架构的基石在于**深层模块（Deep Modules）**——即**以最小、最稳定的外部接口（Small Interface），隐藏复杂、高杠杆的内部实现细节（High Leverage & Information Hiding）**。反之，若接口复杂度与内部实现复杂度接近，或者向调用方泄漏了底层传输、进程或文件系统细节，则属于**浅层模块（Shallow Modules）**；若接口只是做简单的参数透传与包装，则属于**透传包装（Pass-through Wrapper）**。

在对 `CPH-PI` 核心调度层（`subagent-runner.ts`、`orchestrator.ts`）、展示与接入层（`cli.ts`、`tui-renderer.ts`、`terminal-logger.ts`）、协议与工具层（`tool-bridge.ts`、`prompt-builder.ts`、`resilient-parser.ts`）、会话与状态层（`session-manager.ts`、`lineage-tracker.ts`、`main-plan-snapshot.ts`、`execution-ledger.ts`）、认证与传输层（`account-pool.ts`、`chathub-client.ts`、`substrate-uploader.ts`）进行全量深度扫描后，系统识别出以下 12 项关于模块深度不足、7 类制品双向冲击面泄漏及伪缝隙（Fake Seams）的问题清单。

---

## 发现的问题清单

### 1. 稀疏数组并发空洞导致运行时崩溃 (CRASH_SPARSE_ARRAY)
- **文件路径**: `src/agent/subagent-runner.ts:99, 156-184, 575-585`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 浅层并发容器 (Shallow Container) / 泄漏的不变量 (Leaky Invariant)
- **代码现状说明**:
  在 `subagent-runner.ts:99` 中，代码使用 `const settled: PromiseSettledResult<SubagentTaskReport>[] = new Array(tasks.length);` 预分配定长数组。在 JavaScript V8 引擎中，该语法创建的是包含物理空洞（Holes / uninitialized slots）的稀疏数组。在并发执行模式（`maxConcurrency > 1`）下，工作协程遇异常提前退出时，若任务槽位未被领用或熔断未能覆盖当前阶段内所有槽位，`settled` 将残留未赋值的空洞；下游报表格式化方法 `formatReportSummary` 采用普通 `for` 循环按索引直接访问 `reports[i].success`，遇到 `undefined` 槽位时瞬间触发致命 `TypeError: Cannot read properties of undefined (reading 'success')` 崩溃。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: CRASH_SPARSE_ARRAY - Stage 1 并发任务熔断导致稀疏数组空洞访问崩溃", async () => {
    const tasks: SubagentTaskSpec[] = [
      { role: "coder", description: "Task 1 必然失败", prompt: "fail" },
      { role: "coder", description: "Task 2 队列等待中", prompt: "skip" },
    ];
    const runner = new SubagentRunner({ ...mockOptions });
    const reports = await runner.executeBatch(tasks);
    expect(() => runner.formatReportSummary(reports)).not.toThrow();
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **上游**: `orchestrator.ts:671` 批量等待报告并格式化输出，直接导致主控任务中断；
  - ⬇️ **下游**: 无法落盘 `SessionRecord`，未释放子代理资源与账号并发令牌。
- **建议整改方向**:
  重构为非稀疏容器（如基于队列的结果收集器 `TaskResultCollector`），在批处理初始化时即为全部索引填充默认结构；并在消费层增加非空保护与防御网关。

---

### 2. AccountPool 异步间隔无锁导致并发子代理挤占同账号 (ACCOUNT_POOL_CONCURRENCY_RACE)
- **文件路径**: `src/auth/account-pool.ts:321-360`, `src/agent/subagent-runner.ts:84-90, 156-182`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 全局状态/资源竞争 (Concurrency Race on Shared Resource) / 伪并发调度
- **代码现状说明**:
  在 `subagent-runner.ts` 中，当 `tasks.length > 1` 且账号池允许多账号时，系统计算 `maxConcurrency = Math.min(effectiveCapacity, tasks.length)` 并启动多个并发 worker。各 worker 均调用 `await this.pool.getNextAvailableToken({ forAgentId })`。
  但在 `account-pool.ts:321-360` 中，代码通过轮询查找可用账号：
  ```typescript
  if (!status.isThrottled) {
    try {
      const session = await this.manager.getAccessToken(acc.email); // 💥 异步 I/O 挂起
      this.currentIndex = (idx + 1) % total;
      status.lastUsedAt = now;
      return session;
    } ...
  ```
  在 `await this.manager.getAccessToken(acc.email)` 期间，Node.js 事件循环让渡执行权。第二个、第三个 worker 同时进入循环，此时 `this.currentIndex` 尚未被递增，且 `status` 没有“已被租用（leased/in-use）”标记，导致所有并发 worker 均被分配给同一个账号 `acc.email`！所有并发子代理同时冲击同一个 Copilot WebSocket 连接，瞬间触发单个账号并发超限或 429 熔断。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: ACCOUNT_POOL_CONCURRENCY_RACE - 多个并发请求同时调用 getNextAvailableToken 会获得相同账号", async () => {
    const manager = new MockTokenManager(["user1@test.com", "user2@test.com"]);
    const pool = new AccountPool(manager);
    const [token1, token2] = await Promise.all([
      pool.getNextAvailableToken(),
      pool.getNextAvailableToken(),
    ]);
    expect(token1.email).not.toBe(token2.email); // 现状失败：两者均为 user1@test.com
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **生产方**: `SubagentRunner.executeBatch` 以为实现了多账号多代理并行；
  - ⬇️ **消费方**: 目标账号遭遇瞬时多连接并发攻击，被微软 Copilot 风控系统限流封禁；
  - **7类制品**: 全局状态（`AccountPool.currentIndex`）、资源（账号并发配额）受损。
- **建议整改方向**:
  为 `AccountPool` 引入原子化租约状态机（Lease State Machine）：在选中账号后立即同步打上 `leased: true` 或增加并发计数器 `activeLeaseCount`，待会话归还或超时后再释放。

---

### 3. ToolBridge 硬编码静态身份导致账本审计证据链脱节 (HARDCODED_LEDGER_PROVENANCE)
- **文件路径**: `src/protocol/tool-bridge.ts:467-498`, `src/session/ledger/execution-ledger.ts:59-88`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 上下文信息剥离 (Context Stripping) / 7类制品数据/存储契约违背
- **代码现状说明**:
  在 `tool-bridge.ts:467-498` 的 `recordToLedger` 实现中：
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
  当 CPH-PI 运行多子代理架构（如 Coder、Researcher）或者处于接力继任者（Successor Agent / Gen 2）阶段时，所有子代理通过 `ToolBridge` 执行的读写文件、命令执行，在落盘预写账本 `execution-ledger.jsonl` 与 `execution-ledger.md` 时全部被粗暴记录为 `role: "main", sessionId: "main"`！
  后继主控在调阅物理账本时，无法分辨哪些修改是 Coder 所做、哪些探测是 Researcher 所做，彻底丧失了多代理审计追溯的客观证据价值。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: HARDCODED_LEDGER_PROVENANCE - 子代理执行工具调用时账本被错误记录为 main 角色", async () => {
    const ledger = new ExecutionLedger(testWorkspace);
    const bridge = new ToolBridge({ cwd: testWorkspace, ledger });
    // 模拟子代理调用工具，期望账本能记录 caller context
    await bridge.executeAction({ tool: "read_file", path: "package.json" });
    const entry = ledger.getLatestEntries(1)[0];
    expect(entry.role).toBe("main"); // 证实无法动态承载真实调用方身份
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **生产方**: `ToolBridge` 抹除调用方身份；
  - ⬇️ **消费方**: `ExecutionLedger` 存储错误元数据；
  - **7类制品**: 数据存储（`.cph/state/execution-ledger.md` 表格视图列“角色”失真）。
- **建议整改方向**:
  在 `ToolBridge.executeAction` 入参中增加执行上下文参数 `context?: { role: string; sessionId: string }`，若缺省则安全兜底为当前绑定的会话上下文，杜绝静态字符串硬编码。

---

### 4. SessionLineageTracker 纯内存状态导致跨会话与恢复断代 (UNPERSISTED_LINEAGE_GRAPH)
- **文件路径**: `src/session/lineage-tracker.ts:18-31, 99-116`, `src/session/session-manager.ts:24-41`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 状态持久化与内存正交割裂 / 浅层包装与启发式正则修补
- **代码现状说明**:
  `SessionLineageTracker` 负责追踪主会话与子代理会话的生命周期节点、父子关系与单向继承链条。
  然而，`SessionLineageTracker` 内部仅持有一个易失性的 `Map<string, SessionLineage>()`，没有持久化到磁盘；同时，`SessionManager` 持久化的 `SessionRecord` 实体中缺乏 `predecessorId`、`successorId`、`parentSessionId` 字段。
  导致当用户退出 CLI 并通过 `/resume <id>` 恢复会话时，`SessionLineageTracker` 内存一片空白。为了掩盖这一缺陷，`lineage-tracker.ts:99-116` 甚至采用字符串正则猜测：
  ```typescript
  const genMatch = sessionId.match(/_gen(\d+)$/);
  const hopMatch = sessionId.match(/_hop(\d+)$/);
  ```
  如果会话 ID 没有附带特定后缀，代数计算与祖先溯源全部重置为代数 1，继承链条彻底断裂，429 容灾接力的动态寻头（`resolveActiveHead`）直接瘫痪。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: UNPERSISTED_LINEAGE_GRAPH - 跨进程 resume 丢失继承链条", () => {
    const tracker1 = new SessionLineageTracker();
    tracker1.register({ sessionId: "ses_001", role: "main", status: "handed_off" });
    tracker1.register({ sessionId: "ses_002", role: "main", status: "active", predecessorId: "ses_001" });
    tracker1.linkSuccessor("ses_001", "ses_002");
    
    // 模拟新进程启动加载
    const tracker2 = new SessionLineageTracker();
    const info = tracker2.getGenerationInfo("ses_002");
    expect(info.generation).toBe(2); // 现状失败：得到 1，且 predecessorIds 为空
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **生产方**: `SessionLineageTracker` 状态脱节；
  - ⬇️ **消费方**: `SessionManager`、`cli.ts` 无法恢复血缘关系；
  - **7类制品**: 数据/存储（`.cph/sessions/index.json` 缺少图谱拓扑）。
- **建议整改方向**:
  将血缘图谱持久化职责合并至 `SessionManager`（或提供 `.cph/sessions/lineage.json` 预写持久化），消除浅层的独立纯内存 Map，实现深层会话管理。

---

### 5. PromptBuilder 字符串启发式嗅探引发参数倒置 (ARGUMENT_SNIFFING_CORRUPTION)
- **文件路径**: `src/protocol/prompt-builder.ts:140-165`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 浅层接口与模糊多态 (Ambiguous Parameter Sniffing)
- **代码现状说明**:
  在 `PromptBuilder.buildTurn2TaskPrompt` 中，由于历史调用方传递参数顺序不一致，代码采用启发式字符串扫描来猜测参数含义：
  ```typescript
  public static buildTurn2TaskPrompt(
    task: string,
    arg2: string,
    arg3 = "",
    toolName?: string
  ): string {
    if (arg3 !== undefined && arg3 !== "") {
      if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
        skillsSection = arg2;
        toolResult = arg3;
      } else {
        toolResult = arg2;
        skillsSection = arg3;
      }
    }
  ```
  如果用户执行的工具结果（`toolResult`，如读取代码或查看测试日志）中恰好包含了单词 `"Skill"` 或 `"技能"`（这在审查或修改技能代码时极其常见），`PromptBuilder` 就会误判 `arg2` 是技能配置段，导致工具执行事实与技能内容在第二轮提示词中直接发生灾难性的**反向颠倒**！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: ARGUMENT_SNIFFING_CORRUPTION - 工具执行结果包含 'Skill' 关键词导致 Turn 2 参数颠倒", () => {
    const task = "代码审查任务";
    const toolResult = "Found 5 occurrences of Skill in skill-loader.ts";
    const skills = "Active Skill: /code-review";
    const prompt = PromptBuilder.buildTurn2TaskPrompt(task, toolResult, skills);
    // 现状：因为 toolResult 包含 "Skill"，被误当作技能段，内容被颠倒组装
    expect(prompt).toContain(`【本地工具初探客观事实】\n${toolResult}`);
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **生产方**: `orchestrator.ts` 构造 Turn 2 提示词；
  - ⬇️ **消费方**: Copilot 模型注意力混淆，将代码内容当成系统技能指令解析；
  - **7类制品**: 函数/接口（类型不安全、传参顺序歧义）。
- **建议整改方向**:
  废除模糊多态签名，改为显式的对象配置接口：`buildTurn2TaskPrompt(options: { task: string; toolResult: string; skillsSection?: string; toolName?: string })`。

---

### 6. main-plan-snapshot 纯格式化函数隐式引入动态 Require 与物理 I/O (HIDDEN_IO_DYNAMIC_REQUIRE)
- **文件路径**: `src/session/main-plan-snapshot.ts:95-110`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 伪缝隙 (Fake Seam) / 隐式副作用与动态加载隐患
- **代码现状说明**:
  `main-plan-snapshot.ts` 本身属于会话快照的数据契约与 Markdown/JSON 视图生成器。然而其导出的 `formatSuccessorTurn1Prompt` 在处理账本挂载头时，竟暗中执行了物理实例化与动态 `require`：
  ```typescript
  let mountHeader = customLedgerMountHeader;
  if (!mountHeader && snapshot.workspaceRoot) {
    try {
      const { ExecutionLedger } = require("./ledger/execution-ledger.ts");
      const ledger = new ExecutionLedger(snapshot.workspaceRoot);
      mountHeader = ledger.formatMountHeader();
    } catch {}
  }
  ```
  调用方以为这是一个无副作用的纯文本格式化函数，但它背地里却触发磁盘 I/O 并读取文件系统。在严苛打包或不同 Node/Bun 模块解析环境下，相对路径 `require("./ledger/execution-ledger.ts")` 极易由于语法加载差异或循环依赖引发运行时异常。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: HIDDEN_IO_DYNAMIC_REQUIRE - 格式化纯函数隐式依赖未隔离的文件系统", () => {
    const snapshot = { originalSessionId: "s1", originalTask: "t1", workspaceRoot: "/invalid/path", ... } as any;
    // 函数本应由调用方注入 ledger mount header，而不是内部自作主张寻找物理路径
    expect(() => formatSuccessorTurn1Prompt(snapshot, "summary")).not.toThrow();
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **依赖关系**: 增加向后向深层模块的隐式耦合；
  - ⬇️ **可测试性**: 使得该模块无法在纯内存单元测试中孤立运行。
- **建议整改方向**:
  遵循依赖倒置与纯函数设计，将 `mountHeader` 作为显式入参传入，移除函数内部的动态 `require` 与物理实例化。

---

### 7. TerminalLogger 单例将控制台劫持与结构化日志目录强耦合 (LOGGER_COHESION_COLLAPSE)
- **文件路径**: `src/ui/terminal-logger.ts:31-89, 131-148`, `src/agent/subagent-runner.ts:68`
- **置信度等级**: Level 2
- **异味/缺陷类别**: 职责混杂 (Low Cohesion) / 全局状态单例污染 (Singleton Leakage)
- **代码现状说明**:
  `TerminalLogger` 声称其核心目标是“全局控制台输出拦截器（teeing stdout/stderr）”。
  然而，该类同时被赋予了“会话结构化日志目录树创建者”的职责：`initSessionTree(sessionId)` 创建 `.cph/logs/<sessionId>/subagents/`、`main.log` 和 `timeline.jsonl`。
  这导致后台任务引擎 `SubagentRunner:68` 被迫强依赖 `TerminalLogger.getInstance().initSessionTree(...)` 全局单例。
  当在非 CLI 环境、Headless 服务端或单元测试中运行时，即便不需要拦截控制台，系统也必须实例化一个全局单例，带来跨测试用例的全局状态残留与生命周期混乱。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: LOGGER_COHESION_COLLAPSE - 非控制台服务强依赖全局 TerminalLogger 单例", () => {
    // 单元测试中多个测试用例并发执行 initSessionTree，会共享同一 TerminalLogger 单例实例与状态
    const l1 = TerminalLogger.getInstance();
    const l2 = TerminalLogger.getInstance();
    expect(l1).toBe(l2); // 证实存在跨上下文单例共享
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **全局状态**: `TerminalLogger.instance` 跨用例污染；
  - ⬇️ **系统架构**: 展现层（Terminal TUI）越界成为存储层（Session Logs）的管理器。
- **建议整改方向**:
  拆分职责：将结构化日志目录规划与事件追加（`SessionLoggerTree`）收归到 `SessionManager` 或独立的 `SessionLogManager`；`TerminalLogger` 仅专注于控制台 ANSI 捕获与屏幕录像机机制。

---

### 8. CphPiCli 2100 行大文件与双重自治接力循环割裂 (DUPLICATE_AUTONOMOUS_HANDOFF_SLICING)
- **文件路径**: `src/cli.ts:36-71, 1378-1685`, `src/agent/orchestrator.ts:141-1702`
- **置信度等级**: Level 2
- **异味/缺陷类别**: 上帝类 (God Class) / 浅层包装倒灌核心复杂度 (Leaky Inversion)
- **代码现状说明**:
  `CphPiCli` 拥有超过 2,100 行代码，其构造入参 `CphPiCliOptions` 高达 30 个字段，且对外暴露了 25 个浅层 getter/setter。
  最严重的架构失衡在于：**自治接力（Autonomous Handoff）状态机被撕裂在两个不同的层级重复实现**。
  - `orchestrator.ts` 内部实现了 generation 累加、successor 关联、快照生成与脱困接力；
  - 然而在 `cli.ts:1378-1685` 中，`CphPiCli.executeTask` 又自行包装了一个 `while (true)` 自治接力外循环（`hopCount < this.maxAutonomousHandoffHops`），在 CLI 层手动实例化 `sessionManager.createSession`、重置 `orchestrator.resetHandshake()`、组装接力提示词（`【自主接力延续任务 - 阶段 ${nextStage}】...`）。
  表现层（CLI）严重越界介入核心编排状态机，导致核心引擎（Orchestrator）沦为一个“每次只能跑单代、需要外部套壳驱动循环”的半成品浅层引擎。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: DUPLICATE_AUTONOMOUS_HANDOFF_SLICING - 接力循环状态机在 CLI 层被二次暴露", () => {
    const cli = new CphPiCli({ workspaceRoot: testWorkspace });
    // CLI 拥有大量内部调度状态字段：hopCount, pendingHandoffSnapshot, maxAutonomousHandoffHops
    expect(typeof (cli as any).executeTask).toBe("function");
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **接入层**: CLI 代码极度臃肿庞大，难以维护与复用；
  - ⬇️ **引擎层**: 如果未来接入 Web UI、VSCode 插件或 REST API，所有调用方都必须重新实现这套 300 行的接力循环逻辑。
- **建议整改方向**:
  将自治多代接力循环完全下沉收敛至 `CopilotOrchestrator`（使 Orchestrator 成为真正的深层模块），CLI 仅负责接收事件回调并渲染进度，输入一进、结果一出。

---

### 9. 传输层空帧零载荷向业务协议泄漏引发死循环 (EMPTY_RESPONSE_LOOP)
- **文件路径**: `src/transport/chathub-client.ts:375-434`, `src/protocol/resilient-parser.ts:24-29`, `src/agent/orchestrator.ts:574-599`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 传输层抽象泄漏 (Transport Leakage) / 缺少防空帧 Seam
- **代码现状说明**:
  微软 SignalR WebSocket 协议在网络拥塞或长思考时可能下发不带 bot 文本的结束帧。若底层传输层直接将 `text: ""` 上抛给文本协议解析器，`ResilientParser` 将其误判为模型的业务闲聊（Chatter）并注入纠偏提示词，编排器随后自增 `turn++` 并立即重发。在网络短暂无载荷状态下，系统可在数秒内空转耗尽 30 轮预算。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: EMPTY_RESPONSE_LOOP - 传输层空载荷不应消耗业务推理轮数预算", async () => {
    const mockClient = { sendMessage: async () => ({ text: "", reasoning: "Thinking..." }) };
    const orchestrator = new CopilotOrchestrator({ chatClient: mockClient as any, maxTurns: 5 });
    await expect(orchestrator.run({ task: "test" })).rejects.toThrow("EMPTY_RESPONSE_LIMIT_EXCEEDED");
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **调用方**: 用户任务在没有任何有效执行的情况下被瞬间耗死；
  - ⬇️ **底层**: 产生大量无意义的 WebSocket 握手与网络流量。
- **建议整改方向**:
  在 Transport 与 Parser 之间建立严格的物理空帧守卫（Empty Frame Guard）：空帧走传输层退避重试或心跳等待，严禁递增业务轮数或注入业务纠偏提示词。

---

### 10. 云端附件阈值为 0 强制直传致使模型工作内存完全剥离 (CLOUD_ATTACHMENT_ZERO_THRESHOLD)
- **文件路径**: `src/agent/orchestrator.ts:162-163, 196-203, 733-740`, `src/protocol/prompt-builder.ts:213-224`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 过度优化反模式 (Premature Offloading) / 破坏局部性与推理工作内存
- **代码现状说明**:
  系统曾为了防止长文本被截断，将附件上传阈值设为 0。当阈值为 0 时，任何工具调用（哪怕只有 1 个字符或 3 行短文本）都会被无条件上传至 OneDrive，并在 Prompt 中用附件占位符替代真实输出。模型无法直接读取上下文中的执行事实，且受制于 OneDrive 权限生效延迟，导致智能体陷入失明与反复重试死循环。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: CLOUD_ATTACHMENT_ZERO_THRESHOLD - 短文本工具结果必须内联在 Prompt 中", async () => {
    const orchestrator = new CopilotOrchestrator({ workspaceRoot: testWorkspace });
    const thresholds = orchestrator.getCloudAttachmentThresholds();
    expect(thresholds.chars).toBeGreaterThanOrEqual(4000);
    expect(thresholds.lines).toBeGreaterThanOrEqual(100);
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **Prompt 上下文**: 丧失即时决策依据；
  - ⬇️ **外部依赖**: 引入对微软 Graph API 的强运行时依赖。
- **建议整改方向**:
  保持合理的高阈值（如 >= 12,000 字符 / 200 行），常规工具执行事实必须以内联方式完整保存在 Prompt 工作内存中。

---

### 11. Windows 环境下 Git Bash 变量展开导致 PowerShell 语法崩溃 (SHELL_ESCAPING_MISMATCH)
- **文件路径**: `src/protocol/tool-bridge.ts:351-396, 593-609`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 跨平台 Seam 抽象泄漏 / Shell 阻抗失配 (Impedance Mismatch)
- **代码现状说明**:
  Pi 底层工具链在 Windows 上默认使用 Git Bash（`bash.exe -c`）执行命令。当 Copilot Agent 发送包含环境变量或变量赋值的 PowerShell 命令（如 `powershell -Command "$ErrorActionPreference = 'Stop'; ..."`）时，Git Bash 在双引号下将 `$ErrorActionPreference` 提前按 Bash 变量求值置空，导致 PowerShell 接收到破损的语法 `= 'Stop'` 并抛出致命语法错误。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: SHELL_ESCAPING_MISMATCH - Windows 下带变量的 PowerShell 命令执行验证", async () => {
    const bridge = new ToolBridge(testWorkspace);
    const result = await bridge.executeAction({
      tool: "run_command",
      command: `powershell -Command "$var = 'OK'; Write-Output $var"`
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("OK");
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **Agent 命令调用**: 常规 PowerShell 测试与管理脚本频繁因变量被置空而失败；
  - ⬇️ **底层执行器**: 平台差异未能在环境感知与提示词层建立对齐。
- **建议整改方向**:
  通过提示词正向引导模型在 Windows 下使用单引号转义规则，或在执行层建立平台命令适配 Seam，阻断 POSIX Shell 对 Windows 变量的提前展开破坏。

---

### 12. 负面禁止词引发“粉色大象”效应与认知麻痹 (NEGATIVE_PROMPT_PARALYSIS)
- **文件路径**: `src/protocol/prompt-builder.ts:27-28, 180, 247`, `src/session/ledger/execution-ledger.ts:129`, `skills/subagent/SKILL.md:207`
- **置信度等级**: Level 1
- **异味/缺陷类别**: 违反《AGENTS.md》正向引导准则 / 注意力抑制与防御死锁
- **代码现状说明**:
  在提示词和技能描述中残留多处“严禁……”、“切勿……”、“在……之前不要输出 FINAL_ANSWER”等负面禁止词。此类词汇极易诱发粉色大象效应，导致模型产生病态防御心态，即使修改与测试已全部完成，也因对负面词的恐惧而不敢结题，陷入无休止的“假装思考与重复读取”，最终耗尽轮数。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  it("PoC: NEGATIVE_PROMPT_PARALYSIS - 生产提示词模板不得包含负面禁止词", () => {
    const reminder = PromptBuilder.PROTOCOL_REMINDER;
    expect(reminder).not.toMatch(/严禁|不要|切勿|不允许/);
  });
  ```
- **潜在风险与影响面**:
  - ⬆️ **大模型行为**: 解码注意力受抑，产生防御性复读或无意义拖延；
  - ⬇️ **工程管理**: 严重违背工作区核心开发与治理宪章。
- **建议整改方向**:
  全面将负面禁止词重构为建设性正向引导（Constructive Positive Guidance），明确“正确的方式是什么”、“达成目标后应该如何行动”。

---

## 7 类制品双向冲击面矩阵汇总

| 制品类型 | ⬆️ 上游（生产方/输入端） | ⬇️ 下游（消费方/交付端） | 关联缺陷 | 综合风险评级 |
|---|---|---|---|---|
| **函数/接口** | 参数传递、多态签名（`buildTurn2TaskPrompt`、`CphPiCliOptions`） | 返回值类型、槽位完整性（`executeBatch` 结果空洞） | Issue 1, 5, 8 | 🔴 极高 |
| **配置文件** | 阈值参数（`cloudAttachmentThresholdChars`、`timeoutSec`） | 决策流向（附件强制上传、超时中断） | Issue 10 | 🟡 中 |
| **数据/存储** | 会话持久化、执行账本落盘（`SessionRecord`、`ExecutionLedger`） | 继承图谱读取、审计追溯（`lineage-tracker` 内存丢失、硬编码 `main`） | Issue 3, 4 | 🔴 极高 |
| **文件/资源** | 磁盘目录创建（`.cph/logs/`、`.cph/artifacts/`） | 文件句柄管理、日志流泄露（`TerminalLogger` 单例冲突） | Issue 6, 7 | 🟡 中 |
| **全局状态** | 账号池状态管理（`AccountPool`、`currentIndex`） | 令牌租约并发冲突、单账号并发超限 | Issue 2 | 🔴 极高 |
| **共享常量** | 提示词协议模板（`PROTOCOL_REMINDER`、负面禁止词） | 模型注意力解码、交互死锁与防御性拖延 | Issue 12 | 🔴 极高 |
| **依赖/库** | 外部平台进程（Git Bash、PowerShell、WebSocket SignalR） | 变量展开语法错误、网络空帧死循环 | Issue 9, 11 | 🔴 极高 |

---

## 深层模块重构演进蓝图 (Deep Architecture Blueprint)

根据 Ousterhout 深度理论，重构的最终目标是将当前“浅、薄、散”的二十多个小组件重组为 4 大深层模块：

```
                      ┌────────────────────────────────────────────────────────┐
                      │                   CphPiCli (薄展现层)                  │
                      │  (仅负责: 参数解析、终端颜色渲染、Readline 输入与事件展示)  │
                      └───────────────────────────┬────────────────────────────┘
                                                  │ 单一入口 run(task, options)
                                                  ▼
                      ┌────────────────────────────────────────────────────────┐
                      │              DeepSessionEngine (深层会话核心)           │
                      │  ┌──────────────────────────────────────────────────┐  │
                      │  │ 封装:                                            │  │
                      │  │ 1. 多代自治接力循环 (原分散在 CLI 与 Orchestrator) │  │
                      │  │ 2. 会话持久化与完整血缘图谱 (合并 SessionManager  │  │
                      │  │    与 LineageTracker，消除内存数据丢失)           │  │
                      │  │ 3. 动态角色账本分发 (消除 ToolBridge 硬编码 main)  │  │
                      │  └──────────────────────────────────────────────────┘  │
                      └───────────────────────────┬────────────────────────────┘
                                                  │
          ┌───────────────────────────────────────┼───────────────────────────────────────┐
          ▼                                       ▼                                       ▼
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│     DeepAccountGateway    │   │     DeepTransportCore     │   │      DeepToolRuntime      │
│  (原子化租约状态机，消除    │   │  (空帧防护、心跳保活重试、  │   │  (环境感知适配、内联事实  │
│   并发 subagent 挤占同账号)│   │   彻底隔绝底层 SignalR 碎片)│   │   保留、安全转义 Seam)    │
└───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
```

**重构核心收益 (Benefits)**:
1. **Locality（局部性集中）**: 多代接力状态机、血缘图谱与持久化逻辑完全集中在会话引擎内部，CLI 不再越界管理状态；
2. **Leverage（高杠杆率）**: 调用方只需调用 `engine.run(task)`，底层自动完成多账号租约分发、429 容灾接力与物理账本记录；
3. **Robustness（消除崩溃与竞争）**: 彻底铲除并发数组空洞、账号挤占竞态与提示词负面认知麻痹。
