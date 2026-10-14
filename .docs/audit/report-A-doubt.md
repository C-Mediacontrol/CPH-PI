# 初审报告：契约对抗与假设证伪 (Dim-2: doubt-driven-development)

- **审查对象**: `E:\copilot-web proxy\CPH-PI`
- **审查角色**: 对抗性代码审查矩阵 · 初审子代理 A2 (Adversarial Code Audit - Stage 1)
- **审查维度**: `doubt-driven-development` (契约对抗、假设证伪与异常边界审计)
- **审查模式**: Full Mode (地毯式全量源码契约审计)
- **扫描文件数**: 26 个核心源码文件 (涵盖 `src/` 下全量子系统：agent, auth, protocol, session, skills, transport, ui, cli)
- **基线测试状态**: 508 passed / 0 failed / 72 test files (测试网 100% 绿色通过，但潜藏深层未被测试覆盖的假阳性与契约断层)

---

## 一、 契约对抗核心矛盾概述 (Executive Summary)

依据 **Doubt-Driven Development** 规范与哲学：
> **“自信的实现绝不等于正确的实现。长周期维护悄然将未经检验的乐观假设变成了‘事实’，而灾难往往潜伏在上下游接口的隐式断层、边界假定与粗暴的启发式嗅探之中。”**

初审子代理 A2 抱持极具怀疑态度的逆向证伪视角，对 CPH-PI 的 26 个核心模块进行了地毯式审计。在 508 项单测全部绿色通过的光鲜外表之下，我们成功证伪并挖掘出 **12 项深层契约断裂、竞态隐患与逻辑不变量破坏**：

1. **子代理调度与解析契约断层 (Issue 1 - P0 致命)**: `SubagentTaskSpec` 和 `SubagentRunner` 声明了强大的 Stage Barrier（阶段依赖屏障），但上游 `ResilientParser` 在解析 LLM 输出时完全遗漏了 `stage` 属性，导致所有多阶段计划被扁平化为同一阶段并发抢跑，屏障体系在真实交互中彻底归零。
2. **假阳性限流劫持与正常会话自杀 (Issue 2 - P0 致命)**: `Orchestrator` 以无差别的子串匹配（`lower.includes("429")`）判定模型是否遭遇限流。只要模型在推演中分析 HTTP 429 或限流中间件代码，即触发假阳性自杀并误将健康账号拉黑，引发账号池雪崩。
3. **账号池限流容量计算之 JS 假值陷阱 (Issue 3 - P1 高危)**: `SubagentRunner` 使用 `activeAllowedAccounts.length || poolStatus.length` 计算有效容量。当所有账号被限流（长度为 0，JS 假值）时，容量错误跳变为满配账号数，导致限流风暴期反以最大并发度疯狂冲撞，瞬间被全盘击穿。
4. **ESM 运行时动态调用 CJS `require` 导致账本失联 (Issue 4 - P1 高危)**: `main-plan-snapshot.ts` 在已声明 `"type": "module"` 的项目中动态调用 `require` 挂载执行账本，并在失败时以空 `catch` 吞噬异常，导致后继主控会话永远无法收到物理账本挂载头，破坏了 Pass-by-Reference 契约。
5. **血缘追踪器纯内存驻留与重启拓扑断裂 (Issue 5 - P2 架构)**: `SessionLineageTracker` 将全部会话血缘存放在内存 Map 中，未落盘状态预写日志。当 CLI 进程重启（`--continue`）时血缘彻底清空，导致活动端点解析失效，违背准则 7。
6. **繁忙状态缺乏双击 Ctrl+C 强制逃生机制 (Issue 6 - P2 体验)**: `InterruptController` 在 busy 状态下对每一次 SIGINT 均只调用已 abort 的控制器，若底层命令挂起，用户在控制台狂按 Ctrl+C 永远无法退出进程。
7. **底层工具异常文本盲区与静默失败 (Issue 7 - P2 健壮性)**: `ToolBridge` 当原生工具以非数组 `rawResult.message` 或 `rawResult.error` 报告失败时，输出被置为空字符串，导致 Copilot 完全收不到失败根因。
8. **索引重建遗漏代数元数据 (Issue 8 - P2 状态机)**: `SessionManager.rebuildIndex` 在扫描会话文件自愈时硬编码遗漏了 `generation` 与 `handoffCount`，自愈后索引丢失代数信息。
9. **不可变压实结果被丢弃导致会话压实空转 (Issue 9 - P1 逻辑)**: `Orchestrator` 调用纯函数 `CompactionService.compactTurns` 获得压缩数组后，未回填替换 `history`，导致压实事件虽已触发，但物理历史未被削减。
10. **执行超时硬编码 30 秒无视全局 CLI 配置 (Issue 10 - P2 契约)**: `ToolBridge.mapAction` 将 `run_command` 超时死锁在 30 秒，导致大型测试或构建命令被意外掐死。
11. **正则前瞻截断陷阱破坏含 `tool:`/`path:` 代码段的局部编辑 (Issue 11 - P1 准确性)**: `ResilientParser` 用前瞻断言匹配字段键，若用户被替换的代码中恰好包含 `tool:` 或 `path:`，`old_string` 被拦腰切断导致补丁必然失败。
12. **参数位置文本嗅探引发工具结果与技能倒错 (Issue 12 - P2 稳定性)**: `PromptBuilder.buildTurn2TaskPrompt` 依赖 `arg.includes("Skill")` 猜测重载参数，当 `git status` 输出包含 `skills/` 目录时，引发参数位置反转。

---

## 二、 发现的问题清单 (Detailed Vulnerability Matrix)

| 编号 | 暴露问题代号 | 涉及核心文件与行号 | 置信度等级 | 缺陷类型 |
|---|---|---|---|---|
| 1 | **STAGE_ATTRIBUTE_DROPPED** | `src/protocol/resilient-parser.ts#L301-L348`, `src/agent/subagent-runner.ts#L102-L107` | **Level 1 (确定性缺陷)** | 上下游解析契约断裂 / 阶段屏障被强制拉平失效 |
| 2 | **RATE_LIMIT_FALSE_POSITIVE** | `src/agent/orchestrator.ts#L523-L536, L1397-L1411` | **Level 1 (确定性缺陷)** | 启发式判据粗暴越界 / 正常代码推演误触发限流自杀 |
| 3 | **FALSY_CAPACITY_OVERFLOW** | `src/agent/subagent-runner.ts#L84-L89` | **Level 1 (确定性缺陷)** | JS 逻辑运算符假值陷阱 / 全限流期虚增最大并发度 |
| 4 | **ESM_REQUIRE_SILENT_FAILURE** | `src/session/main-plan-snapshot.ts#L100-L109` | **Level 1 (确定性缺陷)** | 模块化契约冲突 / 异常静默吞噬 / 物理账本挂载断裂 |
| 5 | **LINEAGE_MEMORY_EPHEMERAL** | `src/session/lineage-tracker.ts#L18-L31, L83-L122`, `src/cli.ts#L163, L434-L465` | **Level 2 (逻辑不变量破坏)** | 状态持久化断裂 / 跨进程血缘幽灵化 / 违背准则 7 |
| 6 | **BUSY_INTERRUPT_TRAP** | `src/agent/interrupt-controller.ts#L115-L130` | **Level 2 (逻辑不变量破坏)** | 进程控制反模式 / 异步卡死陷阱 / 缺乏逃生安全网 |
| 7 | **TOOL_ERROR_MESSAGE_BLACKOUT** | `src/protocol/tool-bridge.ts#L758-L775` | **Level 2 (逻辑不变量破坏)** | 契约缺失 / 错误输出静默置空 / 排错反馈回路阻断 |
| 8 | **INDEX_REBUILD_METADATA_LOSS** | `src/session/session-manager.ts#L185-L199` | **Level 2 (逻辑不变量破坏)** | 序列化不对称 / 自愈时丢失关键代数元数据 |
| 9 | **COMPACTED_TURNS_DISCARDED** | `src/agent/orchestrator.ts#L816-L826`, `src/agent/compaction.ts#L47-L85` | **Level 1 (确定性缺陷)** | 纯函数返回值被丢弃 / 虚假压实与物理上下文膨胀 |
| 10 | **COMMAND_TIMEOUT_HARDCODED_30S** | `src/protocol/tool-bridge.ts#L593-L609` | **Level 2 (逻辑不变量破坏)** | 隐式硬编码超时 / 破坏 CLI 全局超时契约 |
| 11 | **PARSER_LOOKAHEAD_TRUNCATION** | `src/protocol/resilient-parser.ts#L209-L214` | **Level 1 (确定性缺陷)** | 正则前瞻截断反噬 / 代码字面量与协议字段冲突 |
| 12 | **PROMPT_BUILDER_HEURISTIC_SWAP** | `src/protocol/prompt-builder.ts#L140-L164` | **Level 2 (逻辑不变量破坏)** | 脆弱重载文本嗅探 / 路径关键字引发参数对调 |

---

### Issue 1: `ResilientParser` 物理丢弃 `stage` 属性导致多阶段屏障与依赖执行逻辑全面破裂 (STAGE_ATTRIBUTE_DROPPED)

- **文件路径**: [`src/protocol/resilient-parser.ts#L301-L348`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/resilient-parser.ts#L301-L348), [`src/agent/subagent-runner.ts#L102-L107`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/subagent-runner.ts#L102-L107)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: 上下游字段解析契约断裂 / 阶段依赖调度全盘失效
- **代码现状说明**:
  `SubagentTaskSpec` 声明了 `stage?: number`，`SubagentRunner.executeBatch` 严格依赖 `t.stage` 进行阶段拓扑排序（Stage 1 ➔ Stage 2）与前序熔断隔离（Stage Barrier）。
  但在 `ResilientParser.parseSubagentsBlock` 实现中：
  1. JSON 数组解析分支（L309-L319）：
     ```ts
     return arr.map((s: any) => ({
       role,
       description: s.description ? String(s.description).trim() : "",
       prompt: s.prompt ? String(s.prompt).trim() : "",
       maxTurns: typeof s.maxTurns === "number" ? s.maxTurns : undefined,
     }));
     ```
     `s.stage` 被显式漏掉，没有复制到返回结果中！
  2. YAML 列表块解析分支（L328-L347）：
     正则仅匹配了 `role`、`description`、`prompt`、`maxTurns`，压根没有任何匹配 `stage` 的逻辑！
  3. 导致 LLM 输出的所有子代理规格在经过解析后，`stage` 均为 `undefined`；
  4. 下游 `SubagentRunner` 执行 `Math.max(1, Math.floor(t.stage ?? 1))`，全部降级为 Stage 1，本应串行推进的 Stage 1（调研）与 Stage 2（修改）在滑动窗口下同时并行启动！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { ResilientParser } from "../src/protocol/resilient-parser.ts";

  it("PoC: ResilientParser silently drops stage attribute from subagents", () => {
    const yamlInput = `\`\`\`action
tool: invoke_subagent
subagents:
  - role: researcher
    description: 阶段1调研
    prompt: 深入调研
    stage: 1
  - role: coder
    description: 阶段2修改
    prompt: 开始写代码
    stage: 2
\`\`\``;

    const parsed = ResilientParser.parse(yamlInput);
    expect(parsed.type).toBe("action");
    const subagents = (parsed as any).action.subagents;
    expect(subagents).toBeDefined();
    // 证伪断言：解析器必须保留 stage 属性
    expect(subagents[0].stage).toBe(1);
    expect(subagents[1].stage).toBe(2); // 物理运行报错：received undefined
  });
  ```
- **潜在风险与影响面**:
  模型规划的因果依赖步骤被完全摧毁，Coder 子代理在 Researcher 尚未输出任何调研事实时即并发修改工作区，引发代码踩踏与不可逆的脏状态。
- **建议整改方向**:
  在 `parseSubagentsBlock` 中同时为 JSON 和 YAML 解析补齐 `stage` 字段抽取：
  `stage: typeof s.stage === "number" ? s.stage : undefined`，以及 `const stageMatch = block.match(/(?:stage|step|phase)\s*:\s*(\d+)/i);`。

---

### Issue 2: `isRateLimitResponseText` 粗暴文本匹配将正常技术讨论误判为 429 并强制杀会话 (RATE_LIMIT_FALSE_POSITIVE)

- **文件路径**: [`src/agent/orchestrator.ts#L523-L536`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L523-L536), [`src/agent/orchestrator.ts#L1397-L1411`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L1397-L1411)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: 语义判据粗暴越界 / 假阳性限流拦截 / 误杀会话与健康账号误拉黑
- **代码现状说明**:
  在 `Orchestrator.run` 每一轮主循环中（L524）：
  ```ts
  if (this.isRateLimitResponseText(turnResponseText)) {
    return await this.executeDisasterRecoveryArbitration({ ... });
  }
  ```
  而 `isRateLimitResponseText` 的判据为：
  ```ts
  const lower = text.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("配额已达上限") ||
    lower.includes("请求过于频繁") ||
    lower.includes("throttled")
  );
  ```
  当且仅当响应中包含 ````action` 或 `FINAL_ANSWER` 时跳过。
  但在模型进行长思考、多步方案探讨、或者在 Turn 1 针对网络限流代码进行审计分析时：
  只要模型的文本中出现了 `429`（例如“我们发现网关对客户端返回了 429 Too Many Requests”），该判据瞬间触发假阳性！
  系统不仅立刻掐死正常推进的会话，还将当前**完全健康的账号调用 `markThrottled` 强制冻结 3 分钟**！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { CopilotOrchestrator } from "../src/agent/orchestrator.ts";

  it("PoC: orchestrator misidentifies code explanation mentioning 429 as a rate-limit crash", async () => {
    let disasterTriggered = false;
    const orchestrator = new CopilotOrchestrator({
      chatClient: {
        sendMessage: async () => ({
          text: "我正在审查代码，发现服务端在遇到 HTTP 429 请求时未做退避重试，我接下来准备编写修复方案。",
          conversationId: "test",
          sessionId: "test",
          requestId: "test",
        }),
      } as any,
    });

    const res = await orchestrator.run({
      task: "审查 429 错误重试逻辑",
      events: {
        onDisasterOccurred: () => { disasterTriggered = true; }
      }
    });

    // 证伪断言：正常技术推演绝不应触发灾备中断
    expect(disasterTriggered).toBe(false); // 物理运行将失败：disasterTriggered 为 true
    expect(res.disasterRecovered).toBeUndefined(); // 物理运行被灾备接管
  });
  ```
- **潜在风险与影响面**:
  凡是涉及 API 限流、重试中间件、HTTP 错误码 429 的编程任务，Agent 几乎百分之百触发自杀并把账号池的所有可用账号轮流锁死，导致工具完全不可用。
- **建议整改方向**:
  严禁扫描 LLM 生成的自然语言。限流状态必须由底层传输信令（如 SignalR 异常代码、`ChatHubClient` 专用事件 `onRateLimitDetected`、HTTP 状态码）权威判定。

---

### Issue 3: `SubagentRunner` 账号池计算中 `0 || poolStatus.length` 的假值陷阱导致全限流时虚增最大并发度 (FALSY_CAPACITY_OVERFLOW)

- **文件路径**: [`src/agent/subagent-runner.ts#L84-L89`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/subagent-runner.ts#L84-L89)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: JavaScript 逻辑运算符假值陷阱 / 极端边界容量失真
- **代码现状说明**:
  在 `SubagentRunner.executeBatch` 中：
  ```ts
  const poolStatus = (this.pool?.getPoolStatus?.() || []) as any[];
  const activeAllowedAccounts = poolStatus.filter(
    (acc) => acc.isAllowed !== false && !acc.isThrottled
  );
  const effectiveCapacity = Math.max(1, activeAllowedAccounts.length || poolStatus.length || 1);
  const maxConcurrency = Math.max(1, Math.min(effectiveCapacity, tasks.length));
  ```
  在 JavaScript 语义中，数字 `0` 为假值（falsy）。
  当池中全部账号均被限流（`activeAllowedAccounts.length === 0`）时：
  表达式 `activeAllowedAccounts.length || poolStatus.length` 会跳过 `0`，直接取值 `poolStatus.length`！
  假设账号池共有 5 个账号，且全部处于 429 冷却期：
  系统计算出的 `effectiveCapacity` 竟然是 `5`！
  结果：系统立即拉起 5 个并发 Worker，同时抢占账号，瞬间抛出 5 个 `ALL_ACCOUNTS_THROTTLED`，导致全批次任务瞬间猝死。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";

  it("PoC: falsy 0 in effectiveCapacity calculates max capacity when 0 active accounts exist", () => {
    const poolStatus = [
      { email: "a1", isThrottled: true },
      { email: "a2", isThrottled: true },
      { email: "a3", isThrottled: true },
    ];
    const activeAllowedAccounts = poolStatus.filter(a => !a.isThrottled);
    expect(activeAllowedAccounts.length).toBe(0);

    // 源码中的算法
    const effectiveCapacity = Math.max(1, activeAllowedAccounts.length || poolStatus.length || 1);

    // 0 个可用账号，算法却输出了 3！
    expect(effectiveCapacity).toBe(3); 
  });
  ```
- **潜在风险与影响面**:
  在账号池遭遇突发限流时，原本应当收敛为单任务排队或等待，却反而以最大并发度雪上加霜，彻底摧毁容灾退避机制。
- **建议整改方向**:
  改用显式比较而非逻辑或：
  `const effectiveCapacity = activeAllowedAccounts.length > 0 ? activeAllowedAccounts.length : 1;`。

---

### Issue 4: `main-plan-snapshot.ts` 在 ESM 项目中动态调用 CJS `require` 导致物理账本挂载断裂 (ESM_REQUIRE_SILENT_FAILURE)

- **文件路径**: [`src/session/main-plan-snapshot.ts#L100-L109`](file:///e:/copilot-web%20proxy/CPH-PI/src/session/main-plan-snapshot.ts#L100-L109)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: 模块化契约冲突 / 异常静默吞噬 / 物理账本挂载头失效
- **代码现状说明**:
  在 `formatSuccessorTurn1Prompt` 中：
  ```ts
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
  `package.json` 声明了 `"type": "module"`，且构建脚本目标为 Node bundle。
  在标准 Node ESM 运行时中，`require` 并不存在（抛出 `ReferenceError: require is not defined`）。
  由于被空的 `catch {}` 静默吞噬，该异常从不告警，但导致 `mountHeader` 始终为 `undefined`！
  后继主控会话所接收到的第一轮接力提示词中，**物理账本挂载区（Section 2）被永久剔除**！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { formatSuccessorTurn1Prompt } from "../src/session/main-plan-snapshot.ts";

  it("PoC: formatSuccessorTurn1Prompt mounts ledger header without relying on require()", () => {
    const prompt = formatSuccessorTurn1Prompt({
      originalSessionId: "s1",
      originalTask: "task1",
      thought: "thought1",
      workspaceRoot: process.cwd(),
      plannedSubagents: []
    }, "reports summary");

    // 证伪断言：物理账本挂载区必须确定性存在
    expect(prompt).toContain("物理执行账本已挂载");
  });
  ```
- **潜在风险与影响面**:
  违背准则 7“传引用挂载而非传值倾倒”原则，接力主控智能体完全无法获知前序已修改文件清单与物理步骤指纹。
- **建议整改方向**:
  移除脆弱的动态 `require`，在文件顶部直接静态导入 `import { ExecutionLedger } from "./ledger/execution-ledger.ts";`。

---

### Issue 5: `SessionLineageTracker` 纯内存驻留导致进程重启后代际血缘与跨代接力拓扑彻底断裂 (LINEAGE_MEMORY_EPHEMERAL)

- **文件路径**: [`src/session/lineage-tracker.ts#L18-L31`](file:///e:/copilot-web%20proxy/CPH-PI/src/session/lineage-tracker.ts#L18-L31), [`src/cli.ts#L163, L434-L465`](file:///e:/copilot-web%20proxy/CPH-PI/src/cli.ts#L163)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 状态持久化断裂 / 跨进程血缘幽灵化 / 违背准则 7
- **代码现状说明**:
  `SessionLineageTracker` 维护了会话代际关系、`resolveActiveHead` 与 `getGenerationInfo`。
  但其内部状态仅保存在 `private registry = new Map<string, SessionLineage>();` 中，没有任何预写日志（WAL）或落盘机制。
  当用户执行 `Ctrl+C` 退出 CLI，随后执行 `cph --continue` 或 `cph session resume` 时：
  - 新进程创建了一个崭新的空 `SessionLineageTracker`；
  - `resolveActiveHead(sessionId)` 返回自身，无法追踪到前序已完成的代际跃迁；
  - 丢失了所有祖先关系，代际代数丢失。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { SessionLineageTracker } from "../src/session/lineage-tracker.ts";

  it("PoC: restarted lineage tracker loses all ancestry and successor chains", () => {
    const trackerA = new SessionLineageTracker();
    trackerA.register({ sessionId: "ses_1", role: "main", status: "handed_off" });
    trackerA.register({ sessionId: "ses_2", role: "main", status: "active", predecessorId: "ses_1" });
    trackerA.linkSuccessor("ses_1", "ses_2");
    expect(trackerA.resolveActiveHead("ses_1")).toBe("ses_2");

    // 模拟新进程启动
    const trackerB = new SessionLineageTracker();
    expect(trackerB.resolveActiveHead("ses_1")).toBe("ses_2"); // 物理运行失败：返回 ses_1
  });
  ```
- **潜在风险与影响面**:
  跨进程接力时，子代理交付物可能被路由到已经归档的旧会话，引起状态机脱节。
- **建议整改方向**:
  将血缘记录以追加写日志格式同步至 `.cph/state/lineage.jsonl`，初始化时自动回放恢复。

---

### Issue 6: `InterruptController` 在繁忙状态下缺乏双击 Ctrl+C 强制逃生机制 (BUSY_INTERRUPT_TRAP)

- **文件路径**: [`src/agent/interrupt-controller.ts#L115-L130`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/interrupt-controller.ts#L115-L130)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 进程控制反模式 / 异步卡死陷阱 / 缺乏逃生安全网
- **代码现状说明**:
  在 `InterruptController.handleSigint()` 中：
  ```ts
  if (this.isBusyState) {
    if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
      this.activeAbortController.abort();
    }
    this.options.onOperationAborted?.();
    return {
      action: "aborted_operation",
      message: "操作已中止，保留会话并返回交互等待模式",
      timestamp: now,
    };
  }
  ```
  如果某个子进程（如卡住的外部命令或网络请求）忽略了 AbortSignal 或者清理耗时极长，`isBusyState` 一直为 `true`。
  此时用户连续按下 5 次 `Ctrl+C`，代码依然只进入该分支并返回 `aborted_operation`，永远无法退出进程！
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { InterruptController } from "../src/agent/interrupt-controller.ts";

  it("PoC: pressing Ctrl+C 5 times during busy state never triggers exit", () => {
    let exitTriggered = false;
    const controller = new InterruptController({
      onExit: () => { exitTriggered = true; }
    });

    controller.beginBusy();

    for (let i = 0; i < 5; i++) {
      const res = controller.handleSigint();
      expect(res.action).toBe("aborted_operation");
    }

    expect(exitTriggered).toBe(true); // 物理运行失败：exitTriggered 始终为 false
  });
  ```
- **潜在风险与影响面**:
  当外部子工具发生死锁或僵尸进程时，用户完全失去控制权，只能杀掉整个终端窗口。
- **建议整改方向**:
  在 busy 状态下增加连续击键检测。若已调用 `abort()` 后的 1.5 秒内用户再次按下 Ctrl+C，直接判定为强制退出，调用 `onExit` 或 `process.exit(130)`。

---

### Issue 7: `ToolBridge.executeAction` 工具失败时若无 content 数组则错误信息被置空 (TOOL_ERROR_MESSAGE_BLACKOUT)

- **文件路径**: [`src/protocol/tool-bridge.ts#L758-L775`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/tool-bridge.ts#L758-L775)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 契约缺失 / 错误输出静默置空 / 排错反馈回路阻断
- **代码现状说明**:
  当底层工具执行失败返回 `{ isError: true, message: "EACCES: permission denied" }` 时：
  `ToolBridge` 仅尝试从 `rawResult.content` 数组或 `rawResult.structuredContent` 中读取 `output`。
  若工具未将错误放入 `content` 数组，`output` 保持为初始值 `""`！
  最终回传给 Copilot 的上下文为：
  `【TOOL_RESULT: bash (xxx) - FAILED】\n\n【END_TOOL_RESULT】`
  错误正文完全丢失，模型无法得知失败根因。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { ToolBridge } from "../src/protocol/tool-bridge.ts";

  it("PoC: tool returning error via message field produces empty output", async () => {
    const bridge = new ToolBridge({
      tools: [
        {
          name: "bash",
          description: "mock",
          execute: async () => ({
            isError: true,
            message: "Fatal: out of memory",
          } as any),
        } as any,
      ],
    });

    const res = await bridge.executeAction({ tool: "run_command", command: "test" });
    expect(res.success).toBe(false);
    expect(res.output).toContain("Fatal: out of memory"); // 物理运行失败：received ""
  });
  ```
- **潜在风险与影响面**:
  破坏了诊断闭环（反馈回路），模型因看不见错误堆栈而陷入反复盲猜重试。
- **建议整改方向**:
  在提取 output 时增加对 `rawResult.message`、`rawResult.error` 与 `rawResult.text` 的降级合并。

---

### Issue 8: `SessionManager.rebuildIndex` 在扫描重构索引时硬编码遗漏代数元数据 (INDEX_REBUILD_METADATA_LOSS)

- **文件路径**: [`src/session/session-manager.ts#L185-L199`](file:///e:/copilot-web%20proxy/CPH-PI/src/session/session-manager.ts#L185-L199)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 序列化不对称 / 自愈时丢失关键代数元数据
- **代码现状说明**:
  在 `SessionManager.saveSession` 中，索引条目包含了 `generation` 和 `handoffCount`。
  但在 `SessionManager.rebuildIndex` 中：
  扫描会话 JSON 时，在 `items.push({...})` 中遗漏了将 `session.generation` 和 `session.handoffCount` 赋值给索引项。
  一旦 `index.json` 触发自愈重建，所有历史会话在列表中的代数标记全部还原丢失。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { SessionManager } from "../src/session/session-manager.ts";
  import fs from "fs";
  import path from "path";

  it("PoC: rebuildIndex strips generation and handoffCount metadata", () => {
    const testDir = path.join(process.cwd(), ".tmp_test_rebuild");
    const mgr = new SessionManager(testDir);
    const session = mgr.createSession({ title: "Test" });
    session.generation = 3;
    session.handoffCount = 2;
    mgr.saveSession(session);

    const indexPath = path.join(testDir, ".cph", "sessions", "index.json");
    fs.unlinkSync(indexPath);

    const reloaded = mgr.listSessions();
    expect(reloaded[0].generation).toBe(3); // 物理运行失败：received undefined
  });
  ```
- **潜在风险与影响面**:
  索引自愈时发生静默数据丢弃，TUI 状态栏和历史列表中的接力标识失效。
- **建议整改方向**:
  在 `rebuildIndex` 的投影对象中补齐 `generation: session.generation, handoffCount: session.handoffCount`。

---

### Issue 9: `CompactionService.compactTurns` 返回浅拷贝数组未被 `Orchestrator` 回填导致会话压实空转 (COMPACTED_TURNS_DISCARDED)

- **文件路径**: [`src/agent/orchestrator.ts#L816-L826`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/orchestrator.ts#L816-L826), [`src/agent/compaction.ts#L47-L85`](file:///e:/copilot-web%20proxy/CPH-PI/src/agent/compaction.ts#L47-L85)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: 纯函数返回值被丢弃 / 虚假压实与物理上下文膨胀
- **代码现状说明**:
  在 `Orchestrator.run` 中：
  ```ts
  if (this.enableInSessionCompaction && history.length > 2) {
    const compaction = CompactionService.compactTurns(history, {
      preserveRecentTurns: 2,
    });
    if (compaction.clearedCharsCount > 0) {
      events?.onCompacted?.(compaction.clearedCharsCount, compaction.compressionRatio);
    }
  }
  ```
  `CompactionService.compactTurns` 是纯函数，返回的是一个新数组 `compactedTurns`，根本不会原地修改传入的 `history` 数组！
  `Orchestrator` 计算了压缩率，触发了 `onCompacted` 事件，但**完全没有将 `compactedTurns` 同步回 `history`**！
  在后续轮次或生成交接文档时，所引用的 `history` 仍然是 100% 原始未压缩的巨型内容。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { CompactionService, type TurnRecord } from "../src/agent/compaction.ts";

  it("PoC: compactTurns is non-mutating and does not alter input array in place", () => {
    const history: TurnRecord[] = [
      { turn: 1, toolOutput: "A".repeat(1000) },
      { turn: 2, toolOutput: "B".repeat(1000) },
      { turn: 3, toolOutput: "C".repeat(1000) },
    ];

    CompactionService.compactTurns(history, { preserveRecentTurns: 1, maxToolResultChars: 100 });

    // 验证 history 原地被修改的假设破裂
    expect(history[0].toolOutput!.length).toBe(1000); // 未被原地压缩
  });
  ```
- **潜在风险与影响面**:
  功能形成假象（UI 报告压实成功，物理上上下文未有任何缩减），长会话依然会遭遇 Token 溢出与 Sydney 截断。
- **建议整改方向**:
  在 `Orchestrator` 中使用 `history.splice(0, history.length, ...compaction.compactedTurns)` 将压缩结果原子同步回内部状态。

---

### Issue 10: `ToolBridge.mapAction` 硬编码 30 秒超时无视全局 CLI 配置导致长耗时测试被意外掐断 (COMMAND_TIMEOUT_HARDCODED_30S)

- **文件路径**: [`src/protocol/tool-bridge.ts#L593-L609`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/tool-bridge.ts#L593-L609)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 隐式硬编码超时 / 破坏 CLI 全局超时契约
- **代码现状说明**:
  在 `ToolBridge.mapAction` 中：
  ```ts
  const command = action.command ?? action.cmd ?? "";
  const timeout = action.timeout !== undefined ? Number(action.timeout) : 30;
  ```
  尽管用户在 CLI 命令行中通过 `--timeout 600` 配置了 10 分钟超时，但 `ToolBridge` 在构造时压根未传入该全局超时，且在映射命令时无条件将默认值设为 `30` 秒！
  当运行整个工程的完整单元测试套件（如 72 个测试文件运行超过 30 秒）时，底层 Pi 进程守护强制杀进程并报错 `Command timed out after 30 seconds`。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { ToolBridge } from "../src/protocol/tool-bridge.ts";

  it("PoC: tool-bridge defaults command timeout to 30s regardless of global cli options", () => {
    const bridge = new ToolBridge();
    const mapped = bridge.mapAction({ tool: "run_command", command: "bun test tests/" });
    // 证伪：默认超时被焊死在 30 秒
    expect((mapped.args as any).timeout).toBe(30);
  });
  ```
- **潜在风险与影响面**:
  对耗时较长但正常的测试、编译与依赖安装任务造成毁灭性打击，Agent 频繁遭遇超时假死。
- **建议整改方向**:
  在 `ToolBridgeOptions` 中支持传入 `defaultCommandTimeout`，由 CLI 统一传递全局超时配置（默认建议 180~300 秒）。

---

### Issue 11: `ResilientParser` 正则前瞻截断陷阱导致含 `tool:` / `path:` 代码段的局部编辑精准匹配失败 (PARSER_LOOKAHEAD_TRUNCATION)

- **文件路径**: [`src/protocol/resilient-parser.ts#L209-L214`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/resilient-parser.ts#L209-L214)
- **置信度等级**: **Level 1 (确定性缺陷)**
- **异味/缺陷类别**: 正则前瞻截断反噬 / 代码字面量与协议字段冲突
- **代码现状说明**:
  在 `extractActionFields` 中，提取 `old_string` 与 `new_string` 时：
  ```ts
  const oldStrMatch = contentToScan.match(
    /(?:old_string|oldstring|old_text|oldText)\s*:\s*([\s\S]*?)(?=\n(?:new_string|newstring|new_text|newText|tool|path)\s*:|$)/i
  );
  ```
  若被编辑的源码本身包含对象字段：
  ```typescript
  const options = {
    tool: "git",
    path: "/usr/bin"
  };
  ```
  前瞻断言匹配到代码中的 `\ntool:` 时，**误以为遇到了协议中的下一个 tool 字段**，导致 `old_string` 在此处被截断！
  提取出来的 `old_string` 只有前半截，底层 `edit` 工具必定抛出 `Could not find exact match`。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { ResilientParser } from "../src/protocol/resilient-parser.ts";

  it("PoC: ResilientParser truncates old_string if code contains 'tool:' or 'path:'", () => {
    const yaml = `tool: edit
path: src/test.ts
old_string: const config = {
  tool: "bash",
  path: "/bin/sh"
};
new_string: const config = {
  tool: "zsh",
  path: "/bin/zsh"
};`;

    const parsed = ResilientParser.parse(yaml);
    expect(parsed.type).toBe("action");
    const action = (parsed as any).action;
    // 证伪断言：old_string 必须包含整块代码
    expect(action.old_string).toContain('path: "/bin/sh"'); // 物理运行失败：在 tool: 处被切断
  });
  ```
- **潜在风险与影响面**:
  凡是修改与工具、路径相关的接口、配置文件或代码段，局部精准编辑 100% 失败，迫使模型只能盲目退回整文件覆写。
- **建议整改方向**:
  前瞻断言必须限制在非缩进顶格位置（`(?=\n(?![ \t])(?:new_string|tool|path)\s*:)`），或引导模型采用带引号多行块结构。

---

### Issue 12: `PromptBuilder.buildTurn2TaskPrompt` 文本嗅探导致路径中含 "skills" 时参数发生颠倒 (PROMPT_BUILDER_HEURISTIC_SWAP)

- **文件路径**: [`src/protocol/prompt-builder.ts#L140-L164`](file:///e:/copilot-web%20proxy/CPH-PI/src/protocol/prompt-builder.ts#L140-L164)
- **置信度等级**: **Level 2 (逻辑不变量破坏)**
- **异味/缺陷类别**: 脆弱重载文本嗅探 / 路径关键字引发参数对调
- **代码现状说明**:
  在 `buildTurn2TaskPrompt` 中：
  ```ts
  if (arg3 !== undefined && arg3 !== "") {
    if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
      skillsSection = arg2;
      toolResult = arg3;
    } else if (arg3.includes("Skill") || arg3.includes("技能")) {
      toolResult = arg2;
      skillsSection = arg3;
    }
  }
  ```
  为了兼容不同参数顺序，代码以 `includes("Skill")` 进行判断。
  但如果 Turn 1 执行的是 `git status`，且仓库中包含 `skills/` 目录或修改了 `SkillLoader`：
  `toolResult` 中必然含有 "Skill" 字符串！
  这导致 `arg2`（工具执行结果）被判定为 `skillsSection`，而 `arg3`（实际技能说明）被判定为 `toolResult`！
  两者的内容在组装 Prompt 时被完全颠倒。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { PromptBuilder } from "../src/protocol/prompt-builder.ts";

  it("PoC: toolResult containing 'skills' gets mistakenly swapped as skillsSection", () => {
    const task = "排查问题";
    const toolResult = "Git status:\n  Untracked files: skills/new-feature.ts";
    const skillsSection = "【Skill: TDD】请遵循测试驱动开发";

    const prompt = PromptBuilder.buildTurn2TaskPrompt(task, toolResult, skillsSection);

    const toolResultIdx = prompt.indexOf("[TOOL_RESULT - SUCCESS]:");
    const gitStatusIdx = prompt.indexOf("Git status:");
    expect(gitStatusIdx).toBeGreaterThan(toolResultIdx);
    expect(gitStatusIdx).toBeLessThan(prompt.indexOf("【当前已激活的专业技能")); // 物理运行失败：位置被对调
  });
  ```
- **潜在风险与影响面**:
  在对包含 skills 模块的仓库进行操作时，Turn 2 任务提示词产生严重错乱，模型看到的执行事实与技能指南彻底对调。
- **建议整改方向**:
  废弃脆弱的模糊文本嗅探重载，使用具名接口对象替代多参数模糊重载。

---

## 三、 总结与治理决议

本次全量契约审查严格遵循【只读门禁】，未修改代码库中任何文件。
上述 12 项缺陷均附带了具体的代码定位、失败反例用例断言及风险分析。建议优先按照以下拓扑次序安排整改：
1. **P0 底层契约阻断修复**: 修复 `ResilientParser` 的 `stage` 属性丢弃问题（Issue 1）与 `isRateLimitResponseText` 假阳性自杀问题（Issue 2）；
2. **P1 调度与模块通信加固**: 修复 `SubagentRunner` 假值容量计算（Issue 3）、`main-plan-snapshot.ts` 的 ESM `require` 漏洞（Issue 4）与压实数组回填丢失（Issue 9）；
3. **P2 状态与健壮性提升**: 固化 `SessionLineageTracker` 磁盘持久化（Issue 5）、解决正则截断（Issue 11）与消除超时硬编码（Issue 10）。
