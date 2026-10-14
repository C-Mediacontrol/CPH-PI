# 初审报告：代码坏味道与重构契机 (Dim-1: refactoring-patterns)
- **审查对象**: E:\copilot-web proxy\CPH-PI
- **审查模式**: Full Mode
- **扫描文件数**: 26
- **基线测试状态**: 508 passed, 0 failed (72 files, 2235 assertions)
- **当前结构健康评分**: 3.5 / 10
- **目标健康评分**: 10.0 / 10

---

## 发现的问题清单

### 1. buildTurn2TaskPrompt 参数字符串类型嗅探与位置混淆反转缺陷
- **文件路径**: `src/protocol/prompt-builder.ts#L140-L164`
- **置信度等级**: Level 1 (确定性缺陷/可构造反例)
- **异味/缺陷类别**: Primitive Obsession (基本类型偏执) / Ambiguous Signature Workaround
- **代码现状说明**: 
  `PromptBuilder.buildTurn2TaskPrompt` 接受 `(task: string, arg2: string, arg3 = "", toolName?: string)`。为了向下兼容不同版本的调用位置，代码在内部通过 `arg2.includes("Skill") || arg2.includes("技能")` 与 `arg3.includes("Skill") || arg3.includes("技能")` 来暴力猜测哪一个是 `skillsSection`、哪一个是 `toolResult`。
  当工具执行输出内容中恰好包含 "Skill" 或 "技能" 关键词时（例如：读取到带有技能说明的代码、npm/tsc 报告中包含 SkillLoader 报错、或执行 git log 包含相关 commit 说明），嗅探逻辑发生致命误判，将本应作为 `toolResult` 的工具输出误判为 `skillsSection`，而将 `skillsSection` 误判为 `toolResult`。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import { PromptBuilder } from "./src/protocol/prompt-builder.ts";

test("buildTurn2TaskPrompt inverts parameters when tool output contains 'Skill' keyword", () => {
  const task = "Fix compile error";
  const toolResult = "Error in SkillLoader: invalid skill format at line 42";
  const skillsDoc = "【当前已激活的专业技能 (Skill)】\n- refactoring";

  // 调用方按照契约传参: (task, toolResult, skillsDoc)
  const prompt = PromptBuilder.buildTurn2TaskPrompt(task, toolResult, skillsDoc);

  // 断言 1: [TOOL_RESULT - SUCCESS] 区块必须包含真实的工具输出
  expect(prompt).toContain(`[TOOL_RESULT - SUCCESS]:\n${toolResult}`);

  // 断言 2: 技能手册区块不应被污染替换为工具报错信息
  expect(prompt).not.toContain(`【当前已激活的专业技能 (Skill)】\n${toolResult}`);

  // 实际运行结果: 因 arg2 包含 "Skill"，被错误赋值给 skillsSection，
  // 导致 [TOOL_RESULT] 变成了技能文档，而技能手册变成了错误输出，断言失败！
});
```
- **潜在风险与影响面**:
  模型在第二轮握手后收到完全颠倒的上下文：提示词工具结果区块丢失了真实的物理工具执行结果，技能区块被错误信息覆盖。这会导致 Copilot 产生严重的方向迷失和幻觉，甚至无法识别前序工具是否执行成功。
- **建议整改方向**:
  彻底废弃基于字符串包含猜测参数类型的重载，引入强类型的入参对象 (Introduce Parameter Object):
  ```typescript
  export interface Turn2TaskPromptOptions {
    task: string;
    toolResult: string;
    skillsSection?: string;
    toolName?: string;
  }
  public static buildTurn2TaskPrompt(options: Turn2TaskPromptOptions): string
  ```

---

### 2. YAML 动作块中 content 贪婪正则匹配吞噬后续同级字段导致落盘污染
- **文件路径**: `src/protocol/resilient-parser.ts#L208, L248-L265`
- **置信度等级**: Level 1 (确定性缺陷/可构造反例)
- **异味/缺陷类别**: Fragile Parsing via Disconnected Regexes / Feature Envy of Raw Text
- **代码现状说明**:
  在 `ResilientParser.extractActionFields` 中，解析非 JSON 格式的 YAML/键值对时，代码使用独立的多重正则表达式提取字段。其中 `contentMatch` 采用贪婪模式：
  ```typescript
  const contentMatch = contentToScan.match(/content\s*:\s*([\s\S]*)$/i);
  ```
  该正则直接从 `content:` 匹配至文本末尾。当 Copilot 生成 YAML 时，若先输出了 `content:`，后输出了 `path:`（或其它元数据），`contentMatch` 会将后续的 `path: <filepath>` 全部作为文件内容吞入。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import { ResilientParser } from "./src/protocol/resilient-parser.ts";

test("extractActionFields does not corrupt file content when content precedes path in YAML action block", () => {
  const rawInput = [
    "```action",
    "tool: write_file",
    "content: console.log(42);",
    "path: src/sample.ts",
    "```"
  ].join("\n");

  const parsed = ResilientParser.parse(rawInput);
  expect(parsed.type).toBe("action");

  if (parsed.type === "action") {
    expect(parsed.action.path).toBe("src/sample.ts");
    // 预期 content 纯粹为 'console.log(42);'
    // 实际运行结果: parsed.action.content 为 'console.log(42);\npath: src/sample.ts'
    expect(parsed.action.content).toBe("console.log(42);");
  }
});
```
- **潜在风险与影响面**:
  当 Copilot 偶尔调整键值输出顺序时，物理写入文件的末尾会被注入 YAML 元数据文本，导致生成代码语法错误或配置文件被污染。
- **建议整改方向**:
  弃用全局贪婪正则表达式匹配，重构为逐行解析器 (Line-based State Machine / Tokenizer)，或者以同级顶格关键字（`\n(?=[a-zA-Z_]+\s*:)`）作为前瞻截断边界。

---

### 3. ESM 模块中硬编码动态 require 导致标准 Node.js 环境下账本挂载静默丢失
- **文件路径**: `src/session/main-plan-snapshot.ts#L102-L108`
- **置信度等级**: Level 1 (确定性缺陷/可构造反例)
- **异味/缺陷类别**: Inappropriate Intimacy / Environment Drift Assumption
- **代码现状说明**:
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
  在 `"type": "module"` 的 ECMAScript Module 项目中，直接调用 CommonJS 的 `require` 属于运行时违规。在 Node.js 环境中执行会抛出 `ReferenceError: require is not defined in ES module scope`。由于外部使用了全容错的 `try-catch` 且直接吞没了错误，导致主控接力继任者会话在生成首轮 Prompt 时必定丢失物理账本挂载头 (Pass-by-Reference TOC)。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import { formatSuccessorTurn1Prompt, type MainPlanSnapshot } from "./src/session/main-plan-snapshot.ts";

test("formatSuccessorTurn1Prompt should mount ledger in standard ESM without require", () => {
  const snapshot: MainPlanSnapshot = {
    snapshotId: "snap-test",
    originalSessionId: "ses-test",
    originalTask: "Original Task",
    thought: "Architecture thoughts",
    workspaceRoot: process.cwd(),
    gitBaseline: "HEAD",
    plannedSubagents: [],
    createdAt: Date.now(),
  };

  // 模拟纯 Node.js ESM 环境 (屏蔽 global.require)
  const origRequire = (globalThis as any).require;
  try {
    delete (globalThis as any).require;
    const prompt = formatSuccessorTurn1Prompt(snapshot, "Batch completed");
    // 在真实标准 Node.js ESM 下，此断言将失败，因为 require 抛出 ReferenceError 被 catch 吞没
    expect(prompt).toContain("物理执行账本挂载");
  } finally {
    (globalThis as any).require = origRequire;
  }
});
```
- **潜在风险与影响面**:
  当系统被构建为标准 Node.js 包或在没有 Bun 全局 polyfill 的环境中运行时，主控会话代际继任者将无法收到执行账本摘要，违反核心治理准则第 7 条（传引用挂载与物理指纹约束）。
- **建议整改方向**:
  在文件顶层以标准 `import { ExecutionLedger } from "./ledger/execution-ledger.ts"` 静态引入，或通过参数依赖注入，彻底根除动态 `require`。

---

### 4. 上帝类与膨胀文件：CphPiCli 职责严重发散 (2122 行)
- **文件路径**: `src/cli.ts#L75-L2122` (重点 `executeTask` L1378-L1686, `parseArgs` L1729-L2040, `handleCommand` L785-L1140)
- **置信度等级**: Level 2 (设计异味/结构不变量破坏)
- **异味/缺陷类别**: Large Class (God Class) / Long Method / Divergent Change
- **代码现状说明**:
  `CphPiCli` 包含了 30+ 实例字段与 2100+ 行代码，承担了整个系统的所有边界职责：
  1. CLI 命令行参数解析 (`parseArgs`, 310 行)；
  2. Readline 终端事件监听与多行缓冲区管理；
  3. 工作区配置文件 `cph.config.json` 磁盘读写；
  4. 状态栏、诊断卡片与帮助横幅的渲染拼装；
  5. 会话列表管理与历史会话切换；
  6. 内置 Slash 指令解析与分发 (12+ 分支，355 行)；
  7. 账号池管理指令 (`/accounts set/enable/disable/reset`)；
  8. 超长任务执行调度闭环 (`executeTask`, 308 行)，内嵌多跃迁接力与容灾重试循环。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import { CphPiCli } from "./src/cli.ts";

test("CphPiCli is tightly coupled and cannot be unit tested without instantiating 15 subsystems", () => {
  // 单一类的实例化隐式创建了 AccountPool, ToolBridge, SkillRegistry, SessionManager, 
  // CopilotOrchestrator, InterruptController, TuiRenderer, ExecutionLedger
  const cli = new CphPiCli();
  expect(cli).toBeDefined();
});
```
- **潜在风险与影响面**:
  任何局部功能的调整（如增加一个 CLI 参数、增加一个 slash 指令、微调状态栏格式）都会直接修改 `cli.ts`，造成严重的并发冲突，测试用例难以轻量 mock。
- **建议整改方向**:
  应用 **Extract Class** 模式进行彻底拆分：
  - `CliArgsParser`: 负责解析 process.argv；
  - `ReplController`: 负责 readline 交互与按键事件；
  - `SlashCommandRouter`: 负责斜杠指令注册与派发；
  - `TaskExecutionRunner`: 负责任务执行与接力跳跃；
  - `WorkspaceConfigStore`: 负责配置落盘。

---

### 5. 上帝类与长函数调度核：CopilotOrchestrator 职责过度集聚 (1702 行)
- **文件路径**: `src/agent/orchestrator.ts#L141-L1702` (重点 `run` L326-L910, `generateHandoffSnapshot` L951-L1305, `executeDisasterRecoveryArbitration` L1410-L1702)
- **置信度等级**: Level 2 (设计异味/结构不变量破坏)
- **异味/缺陷类别**: Large Class (God Class) / Long Method / Divergent Change
- **代码现状说明**:
  `CopilotOrchestrator` 作为核心推理调度器，承担了过多不属于调度本身的职责：
  1. `run()` 方法单体长达 584 行，嵌套了客户端解析、握手状态机、流式帧累加、空帧重试、拒答拦截、代际分裂、附件上传、历史压实与工具桥接等多层分支；
  2. 内嵌长达 354 行的物理事实提取与 Markdown 文档生成算法 (`generateHandoffSnapshot`)；
  3. 内嵌长达 292 行的仲裁代理会话管理与跨账号换端执行代码 (`executeDisasterRecoveryArbitration`)；
  4. 自带 Git 状态提取 (`collectGitFacts`) 与目录树生成 (`collectDirTreePreview`)。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import { CopilotOrchestrator } from "./src/agent/orchestrator.ts";

test("generateHandoffSnapshot is tangled with networking orchestrator instance fields", () => {
  const orchestrator = new CopilotOrchestrator({ workspaceRoot: process.cwd() });
  // 无法脱离 Orchestrator 单独进行 Markdown 提炼逻辑的纯单元测试
  expect(typeof orchestrator.generateHandoffSnapshot).toBe("function");
});
```
- **潜在风险与影响面**:
  单体超长方法使代码审查与调试极度困难；任何对交接格式或错误分类规则的改动都直接威胁到主会话网络调度循环的稳定性。
- **建议整改方向**:
  应用 **Extract Class** 与 **Compose Method** 模式：
  - 提取 `HandoffDocSynthesizer`: 专职从 `TurnRecord[]` 提炼 5 维交接文档；
  - 提取 `DisasterArbitrator`: 专职执行第二阶段仲裁会话；
  - 提取 `EnvironmentGroundingCollector`: 专职采集 Git 客观事实与目录树。

---

### 6. 循环依赖与依赖倒置缺失：CopilotOrchestrator 与 SubagentRunner 强双向耦合
- **文件路径**: `src/agent/orchestrator.ts#L24, L693-L706` vs `src/agent/subagent-runner.ts#L4, L366-L375`
- **置信度等级**: Level 2 (结构不变量破坏)
- **异味/缺陷类别**: Circular Dependency / Inappropriate Intimacy / DIP Violation
- **代码现状说明**:
  `orchestrator.ts` 静态导入并实例化 `SubagentRunner`（L24: `import { SubagentRunner } from "./subagent-runner.ts"`）；而 `subagent-runner.ts` 静态导入并实例化 `CopilotOrchestrator`（L4: `import { CopilotOrchestrator } from "./orchestrator.ts"`）。
  主调度器依赖子代理执行器，子代理执行器又依赖主调度器。两者形成强环状引用，违反面向对象设计中的依赖倒置原则 (DIP)。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";

test("Modules should be decoupled from direct circular instantiations", async () => {
  const o = await import("./src/agent/orchestrator.ts");
  const r = await import("./src/agent/subagent-runner.ts");
  // 当前两者直接相互 new 对方，存在紧密循环引用
  expect(o.CopilotOrchestrator).toBeDefined();
  expect(r.SubagentRunner).toBeDefined();
});
```
- **潜在风险与影响面**:
  循环导入在复杂的打包、转译或测试环境中极易引发 `Cannot access before initialization` 或动态导入死锁；且无法单独为 `SubagentRunner` 或 `CopilotOrchestrator` 编写完全独立的单元测试。
- **建议整改方向**:
  定义解耦接口 `ISubagentRunner` 与 `IOrchestratorFactory`，将创建委托函数作为参数传入，消除模块间的硬导入依赖。

---

### 7. 依恋情结与强破封装：CphPiCli 依赖 (this.orchestrator as any) 窥探内部属性
- **文件路径**: `src/cli.ts#L1540-L1545`, `src/cli.ts#L446, L457`
- **置信度等级**: Level 2 (设计异味/结构不变量破坏)
- **异味/缺陷类别**: Feature Envy (依恋情结) / Inappropriate Intimacy / Anemic Contract
- **代码现状说明**:
  在 `CphPiCli.executeTask` 中：
  ```typescript
  if (this.orchestrator) {
    currentSession.generation =
      (this.orchestrator as any).getGeneration?.() || currentSession.generation || 1;
    currentSession.handoffCount =
      (this.orchestrator as any).getHandoffCount?.() || currentSession.handoffCount || 0;
  }
  ```
  由于 `OrchestratorRunResult` 未定义代际与接力元数据，`cli.ts` 不得不将 `this.orchestrator` 强转为 `any` 越权调用内部方法。此外，在 `initSession` 和 `/resume` 中直接将 `this.orchestrator.isHandshakePending = false` 进行外部字段赋值，绕过了 Orchestrator 自身的封装。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
import { test, expect } from "bun:test";
import type { OrchestratorRunResult } from "./src/agent/orchestrator.ts";

test("OrchestratorRunResult should formally declare generation and handoffCount", () => {
  const result: Partial<OrchestratorRunResult> = {};
  // @ts-expect-error - 当前 OrchestratorRunResult 接口缺少 generation 定义
  const gen = result.generation;
  expect(gen).toBeUndefined();
});
```
- **潜在风险与影响面**:
  绕过类型系统使得重构无法受到编译器保护。一旦 Orchestrator 内部方法重命名或重构，CLI 处静默降级为默认值 1，导致会话代际跟踪失真。
- **建议整改方向**:
  将 `generation` 与 `handoffCount` 纳入 `OrchestratorRunResult` 统一返回；将 `isHandshakePending` 设为私有变量，通过显式方法（如 `orchestrator.skipHandshake()` 或 `orchestrator.markSessionResumed()`）控制状态流转。

---

### 8. 重复逻辑：主会话与子代理间并行的自主接力循环 (Parallel Handoff Loops)
- **文件路径**: `src/cli.ts#L1403-L1675` vs `src/agent/subagent-runner.ts#L335-L460`
- **置信度等级**: Level 2 (设计异味/结构不变量破坏)
- **异味/缺陷类别**: Duplicated Logic (重复逻辑) / Parallel Inheritance Hierarchy
- **代码现状说明**:
  `CphPiCli` 和 `SubagentRunner` 各自实现了一套自主接力跳转机制：
  - 均有一个限制最大跳数（`maxAutonomousHandoffHops` / `maxAutonomousHops`）的 while 循环；
  - 均在检测到 `result.handedOff` 后读取磁盘交接文档；
  - 均拼接格式高度相似的延续前缀（`【自主接力延续任务 - 阶段 ${nextStage}】...` vs `【跨会话自主接力任务】...`）；
  - 均向 `lineageTracker` 注册前任与继任关系；
  - 均重建 `CopilotOrchestrator` 实例进行第二阶段攻坚。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
// 架构测试：状态接力跃迁应由统一的状态机处理，当前主从两端存在约 150 行几乎完全镜像的逻辑
```
- **潜在风险与影响面**:
  当接力协议规范、提示词约定或断点持久化策略更新时，必须在两个模块中同步手动同步代码，极易产生逻辑漂移（Logic Drift）。
- **建议整改方向**:
  应用 **Extract Class** 提炼 `AutonomousHandoffCoordinator`，将接力判断、交接文档挂载、血缘注册与下阶段提示词装配提取为可复用的接力状态机。

---

### 9. 重复逻辑：ToolBridge 结果装配代码在 6 个分支完全镜像复制
- **文件路径**: `src/protocol/tool-bridge.ts#L644-L668`, `L682-L702`, `L704-L725`, `L731-L751`, `L780-L802`, `L804-L826`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Duplicated Code (重复代码)
- **代码现状说明**:
  在 `ToolBridge.executeAction` 中，无论操作成功、失败还是抛出异常，均重复执行完全相同的一组操作：
  ```typescript
  output = sanitizeOutput(output);
  const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
  const formatted = this.formatResult({ ... });
  return {
    actionName: rawActionName,
    piToolName: ...,
    target: ...,
    success: ...,
    output: persisted.displayOutput,
    rawOutput: output,
    formatted,
    mappedArgs: mapped.args,
    persistedFile: persisted.persistedFile,
  };
  ```
  同样的 15~20 行装配代码在单个方法中复制粘贴了 6 次。
- **反例测试提案 (PoC Test Snippet)**:
```typescript
// 静态代码审查指标：6 处分散的 return 语句持有完全一致的属性构造特征
```
- **潜在风险与影响面**:
  样板代码膨胀掩盖了工具执行的核心业务流；若未来需要为工具结果添加新属性（如执行时间戳、耗时 ms、调用来源），需要逐一手动同步 6 个返回点。
- **建议整改方向**:
  应用 **Extract Method** 模式，提炼私有方法 `createToolResult(...)` 统一包装返回值。

---

### 10. 散落且不一致的 429 / 频控错误分类判断 (Scattered 429 Regexes)
- **文件路径**: `src/auth/account-pool.ts#L415-L420` vs `src/agent/orchestrator.ts#L1385-L1400` vs `src/agent/subagent-runner.ts#L250-L255`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Scatter-Shot Error Handling / Duplicated Logic
- **代码现状说明**:
  系统在 3 个不同模块中分别手写了相似但不完全相同的限流识别逻辑：
  - `account-pool.ts`: `msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("429") || msg.includes("throttled") || msg.includes("quota")`
  - `orchestrator.ts`: 私有方法 `isRateLimitError` 与 `isRateLimitResponseText`；
  - `subagent-runner.ts`: 正则表达式 `/all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(...)`。
- **潜在风险与影响面**:
  当微软云端返回新的频控特征文本时，部分组件能正确捕获轮换，部分组件却会漏判并崩溃，错误分类机制缺乏统一源头真理。
- **建议整改方向**:
  提取单一职责的 `RateLimitClassifier` 工具类，统一收敛所有 429/频控与配额耗尽的判断规则。

---

### 11. 脆弱的 Slash 命令双重路由与 26 支硬编码条件链
- **文件路径**: `src/cli.ts#L720-L752` vs `src/cli.ts#L785-L1140`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Switch Statements / Duplicated Conditional Expression / Missing Command Pattern
- **代码现状说明**:
  在 `cli.ts` 的 `handleInputLine` 中，存在一条硬编码包含 26 个 `||` 字符串判定的超长 `if` 语句，用以拦截内置命令（`/help`, `/status`, `/reset`, `/sessions`, `/new`, `/resume`, `/continue`, `/skills`, `/agent`, `/accounts`, `/debug`, `/model` 等）。紧接着在 `handleCommand` 中再次通过庞大的 `if (cmd === ...)` 进行二次分支。
- **潜在风险与影响面**:
  新增指令时必须在两处同时更新；一旦遗漏第一处拦截白名单，新增指令就会错误地穿透并掉入 `skillRegistry.parseSlashCommand`，导致指令执行失败。
- **建议整改方向**:
  应用 **Command Pattern** (命令模式)，建立统一的 `CommandRegistry`，每个指令封装为独立的 Command 处理对象。

---

### 12. 贫血数据模型引发霰弹式修改：Session 状态字段跨 6 个文件同步调整
- **文件路径**: `src/session/session-manager.ts#L24-L77`, `L183-L200`, `L260-L282`, `src/cli.ts#L1508-L1600`, `src/agent/orchestrator.ts#L723-L739`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Shotgun Surgery (霰弹式修改) / Data Clumps / Anemic Domain Model
- **代码现状说明**:
  `SessionRecord` 和 `SessionIndexItem` 是纯粹的扁平数据结构。每当增加一个新状态属性（例如 `disasterBlackbox`, `generation`, `handoffCount`），必须同步修改：
  1. `SessionRecord` 接口
  2. `SessionIndexItem` 接口
  3. `CreateSessionOptions` 接口
  4. `SessionManager.rebuildIndex`
  5. `SessionManager.saveSession`
  6. `CphPiCli.executeTask` (多处属性赋值)
  7. `CopilotOrchestrator`
- **潜在风险与影响面**:
  状态演化必须在全工程各层做“霰弹式修改”，漏改一处就会导致属性未被持久化进 index.json 或丢失。
- **建议整改方向**:
  构建充血领域模型 `SessionAggregate`，将索引投影与增量落盘行为内聚至实体方法，而不是由外部服务逐字段手工拷贝。

---

### 13. 弱类型参数袋与基本类型偏执：CopilotAction 30+ 属性混杂
- **文件路径**: `src/protocol/tool-bridge.ts#L49-L87`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Primitive Obsession / Data Clumps
- **代码现状说明**:
  `CopilotAction` 接口包含了 30 多个可选字段（`path`, `filePath`, `file`, `start_line`, `startLine`, `offset`, `limit`, `lines`, `old_string`, `new_string`, `old_text`, `new_text`, `oldText`, `newText`, `edits`, `command`, `cmd`, `question`, `prompt`, `options`, `subagents` 等），将 5 种完全不同的工具调用参数混杂在一个平面对象中。
- **潜在风险与影响面**:
  类型系统无法提供任何有效校验；任何工具的错误传参均能通过类型检查，下游必须充满各种判空与多重回退逻辑。
- **建议整改方向**:
  应用 **Replace Type Code with Class / Discriminated Union**，重构为可辨识联合类型 (Discriminated Union):
  `type CopilotAction = ReadAction | EditAction | WriteAction | BashAction | QuestionAction | SubagentAction`。

---

### 14. 无界静态内存缓存潜在泄漏风险：SubstrateUploader.spoBase64Cache
- **文件路径**: `src/transport/substrate-uploader.ts#L21, L27-L49`
- **置信度等级**: Level 2 (设计异味)
- **异味/缺陷类别**: Unbounded Static Cache / Memory Leak Risk
- **代码现状说明**:
  ```typescript
  private static spoBase64Cache = new Map<string, string>();
  ```
  以频繁轮换刷新的 JWT AccessToken（长达 1-2 KB）作为 Map 的键，在常驻内存中永久缓存 SPO 编码元数据，未设置任何容量上限或淘汰机制。
- **潜在风险与影响面**:
  在长时间高频运行或包含大量轮换账号的多任务执行场景下，旧 Token 键值对将永久滞留于内存中，导致内存缓慢增长与潜在泄漏。
- **建议整改方向**:
  改用带最大条目限制的 LRU 缓存，或以用户/租户固定标识为键进行缓存。

---

### 15. 字符串标识符代数信息推导与逆向解析：LineageTracker 偏执
- **文件路径**: `src/session/lineage-tracker.ts#L100-L116`
- **置信度等级**: Level 3 (设计异味/可疑点)
- **异味/缺陷类别**: Primitive Obsession
- **代码现状说明**:
  `SessionLineageTracker.getGenerationInfo` 在通过图结构回溯代数的同时，额外通过正则分析 `_gen(\d+)` 与 `_hop(\d+)` 字符串后缀并取较大值作为兜底。这种通过解析 ID 字符串获取领域状态的做法破坏了图节点的数据纯洁性。
- **潜在风险与影响面**:
  过度依赖字符串魔术后缀；若会话 ID 命名格式演进，会导致代数计算出现不一致。
- **建议整改方向**:
  将 `generation` 与 `hopCount` 作为 `SessionLineage` 节点的显式一等公民属性存储，废弃从字符串反解状态的隐式逻辑。
