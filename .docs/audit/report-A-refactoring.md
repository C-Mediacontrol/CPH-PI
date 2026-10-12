# 初审报告：代码坏味道与重构契机 (Dim-1: refactoring-patterns)

- **审查对象**: `E:\copilot-web proxy\CPH-PI`
- **审查模式**: Full Mode (全量深度代码坏味道审计)
- **扫描文件数**: 24 个生产源码文件 + 4 个系统提示词文件 + 2 个核心技能规约 = 30 个核心资产
- **基线测试状态**: 476 个单元与端到端测试全量通过 (476 pass, 0 fail, 63 test files)
- **当前结构健康评分**: 3.5 / 10

---

## 评分依据与核心坏味道概览

依据 Martin Fowler《重构：改善既有代码的设计》(第 2 版) 规约与 `refactoring-patterns` 评估矩阵（8 维快速诊断标准）：

| 诊断维度 | 达标情况 | 现状诊断 |
|---|---|---|
| 1. 重构前测试是否通过 | **达标** | 476 个测试全绿，具备坚实的防退化安全网 |
| 2. 坏味道是否能明确命名 | **达标** | 可精准归纳为 Fowler 五大坏味道家族的标准项 |
| 3. 函数体是否控制在短小单一范围 | **严重不达标** | 存在多个 200~550 行的超大怪兽函数 (`run()`, `sendMessage()`, `executeTask()`, `generateHandoffSnapshot()`) |
| 4. 每个类是否仅有一个引起变化的轴心 | **严重不达标** | `CphPiCli` (2081 行) 与 `CopilotOrchestrator` (1638 行) 是典型的上帝类 (God Class)，内嵌多达 6~8 个独立变化原因 |
| 5. 是否消除重复代码 (DRY) | **不达标** | 自主接力循环、Token 估算、工具错误处理、交接 Prompt 拼接存在大段 Copy-Paste 代码 |
| 6. 条件分支是否恰当使用多态/表驱动 | **不达标** | 350 行的 `if-else` 命令分发路由，以及工具参数映射分支未采用策略模式 |
| 7. 提交与变更步调是否小步安全 | **待实施** | 结构与行为高度交织，此前迭代伴随大量局部功能堆叠 |
| 8. 代码可读性与自解释性 | **部分达标** | 变量命名良好但方法过度嵌套，存在 `as any` 内部状态侵入与参数内容模糊嗅探 |

**当前结构健康评分：3.5 / 10**。系统功能强悍且测试覆盖率极高，但两大核心文件（`cli.ts` 2081 行、`orchestrator.ts` 1638 行）已呈现严重的“大泥球 (Big Ball of Mud)”演变趋势，急需系统化重构解耦。

---

## 发现的问题清单

### 1. 上帝类与发散变化 (God Class & Divergent Change) —— CphPiCli 职责严重超载
- **文件路径**: `src/cli.ts#L71-L1658`
- **置信度等级**: `Level 2`
- **异味/缺陷类别**: God Class (上帝类) / Divergent Change (发散变化) / Large Class (过大类)
- **代码现状说明**:
  `CphPiCli` 类拥有 27 个实例字段，总代码量高达 2081 行。该类目前混杂了以下 8 组完全正交的关注点：
  1. CLI 命令行参数解析 (`parseCliArgs`)；
  2. 工作区本地配置存取 (`loadWorkspaceConfig` / `saveWorkspaceConfig`)；
  3. Node.js Readline 交互 REPL 循环与 SIGINT 双击退出事件监听；
  4. 多行输入缓冲区累积 (`"""` 块与 `\` 尾续行检测)；
  5. 超过 12 种 Slash 快捷命令的分发与执行 (`/help`, `/new`, `/resume`, `/model`, `/accounts`, `/debug` 等)；
  6. 账号池白名单增删改查业务逻辑；
  7. 多子代理实时进度矩阵状态收集与 UI 渲染驱动；
  8. 自主会话接力跃迁的循环调度 (`while (hopCount < maxAutonomousHandoffHops)`)。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 缺陷证明：若仅测试 /model 或 /accounts 命令逻辑，必须强行初始化带有真实 TTY/Readline 与 Orchestrator 的巨型 CphPiCli
  import { CphPiCli } from "../src/cli.ts";

  // 即使只需要测试一个内存命令，也被迫触发文件系统与整个调度核初始化
  const cli = new CphPiCli({ workspaceRoot: "./dummy" });
  // 命令逻辑直接向 process.stdout 产生硬编码控制台输出，无法纯函数式注入 OutputWriter 断言结果
  await cli.handleCommand("/model Creative");
  // 只能通过 hack 检查私有属性或磁盘配置文件来间接断言
  ```
- **潜在风险与影响面**:
  违背单一职责原则 (SRP)。任何维度的微小调整（例如支持新的 CLI 参数、增加一个 Slash 命令、调整多行输入规则）都必须修改同一个 2000 行的大文件，极易引发代码冲突、上下文加载溢出以及测试难以隔离。
- **建议整改方向**:
  - **Extract Class (提炼类)**:
    - 提炼 `ReplController`：负责终端 Readline 输入流、多行累积、SIGINT 拦截与提示符管理；
    - 提炼 `WorkspaceConfigManager`：负责 `.cph/config.json` 的安全原子读写与单测；
    - 提炼 `CommandRegistry` 与 `CommandHandler`：采用命令模式 (Command Pattern) 将 `/accounts`, `/model`, `/debug`, `/skills` 抽离为独立处理类；
  - **Move Method (搬移函数)**: 将顶层的 CLI 启动与参数规范迁移到专门的入口适配器。

---

### 2. 上帝编排器与超长函数 (God Class & Long Method) —— CopilotOrchestrator.run() 职责严重过载
- **文件路径**: `src/agent/orchestrator.ts#L140-L858`
- **置信度等级**: `Level 2`
- **异味/缺陷类别**: God Class (上帝类) / Long Method (超长函数: 554 行) / Divergent Change (发散变化)
- **代码现状说明**:
  `CopilotOrchestrator` 囊括了运行时调度的全部细节。其核心方法 `public async run(...)` 从第 304 行一直延续至第 858 行，单函数长达 554 行。函数内部深层嵌套了：
  - 动态 Token 获取与账号池故障转移；
  - Turn 1 纯净探测握手与正式任务 Prompt 注入逻辑；
  - `while (turn <= this.maxTurns)` 轮次大循环；
  - 网络层 AbortSignal、流式 Delta / Reasoning 收集与速率拦截；
  - SandBox 拒答模版正则拦截与纠偏重试策略调度 (`RefusalGuard`)；
  - 工具调用分流与结果包装；
  - 子代理并发批处理虚拟化、宏观架构快照落盘与主控后继者代际转生 (`Generational Succession`)；
  - Microsoft Graph API OneDrive 附件自动上传通道；
  - 运行时双轮滑动微压实 (`CompactionService`)；
  - 最终答案确认与交接快照生成。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 缺陷证明：无法对 Orchestrator 的“单轮输出解析与决策”做独立单元测试
  // 必须模拟包含 WebSocket client、Graph API、Token Pool、FS 的全套运行环境
  // 一旦在 554 行中间发生未捕获异常，外部只能捕获模糊的 Error，难以精准断言故障阶段
  ```
- **潜在风险与影响面**:
  该函数局部变量极其庞大（`turn`, `refusalRetries`, `currentPrompt`, `currentAnnotations`, `turnResponseText`, `turnReasoningText` 等），存在严重的作用域污染与跨阶段共享可变状态。代际转生重置计数器（`turn = 0; this.generation++`）直接在循环体内强行篡改控制变量，极其脆弱。
- **建议整改方向**:
  - **Extract Class (提炼类)**:
    - 提炼 `TurnRunner`：负责单轮请求发送、响应接收与异常归类；
    - 提炼 `GenerationalSuccessor`：负责主会话虚拟化与后继代际 Awakening 状态机；
    - 提炼 `CloudAttachmentInterceptor`：负责检查阈值并自动上传 OneDrive；
  - **Decompose Conditional (分解条件表达式)**: 将 550 行中的 `final_answer`、`handoff`、`invoke_subagent`、常规 tool 分支提炼为命名处理方法。

---

### 3. 重复代码与逻辑克隆 (Duplicate Code / Missing Abstraction) —— 主控与子代理各自克隆自主接力循环
- **文件路径**: `src/cli.ts#L1385-L1637` 与 `src/agent/subagent-runner.ts#L246-L378`
- **置信度等级**: `Level 1`
- **异味/缺陷类别**: Duplicate Code (重复代码) / Shotgun Surgery (霰弹式修改)
- **代码现状说明**:
  在 `CphPiCli.executeTask` 和 `SubagentRunner.runSingleSubagent` 中，各自独立实现了一套几乎完全相同的“跨会话自主换会话接力状态机”：
  1. `while (hopCount < maxHops)` 递增循环；
  2. 监听 `res.handedOff` 标志；
  3. 从磁盘读取 `handoffDocPath` 中的 5 维交接文档；
  4. 构造新会话 ID 并向 `lineageTracker` 注册后继节点与父子关系；
  5. 拼接高度相似的“【前序会话脱困成果快照/跨会话自主接力任务】...【接力第一优先级待办事项】”提示词模版；
  6. 重新初始化 Orchestrator 并投入下一代攻坚。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 验证两处接力提示词的不一致性与散落行为：
  // 在 cli.ts 中：
  const mainPromptTemplate = (doc: string) =>
    `【自主接力延续任务 - 阶段 2】\n前序会话已达成阶段性成果并已安全脱困...\n\n${doc}\n\n【接力执行需求】\n请根据上述交接文档中的【接力第一优先级待办事项 (Actionable Next Steps)】...`;

  // 在 subagent-runner.ts 中：
  const subPromptTemplate = (doc: string) =>
    `【跨会话自主接力任务】前序子代理已达到 30 轮推理上限并输出交接文档。请根据下方交接文档中的【接力第一优先级待办事项】与【任务目标】...\n\n${doc}`;

  // 两者格式规范微小偏离，且对 hop 超限的处理逻辑各成一套：
  // 一处写入 pendingHandoffSnapshot，另一处直接截断并拼在 finalAnswer 中
  ```
- **潜在风险与影响面**:
  典型的散弹式修改（Shotgun Surgery）。未来一旦升级交接协议、调整连续接力上限逻辑或变更血缘关系记录格式，必须同时在 `cli.ts` 与 `subagent-runner.ts` 保持多处纯手工同步，极易遗漏导致主从行为分裂。
- **建议整改方向**:
  - **Extract Class (提炼类)**: 提炼通用的 `AutonomousHandoffLoop<TContext, TResult>` 模板类；
  - **Form Template Method (塑造模板方法)**: 将“执行单次 -> 检查 handoff -> 读取快照 -> 关联血缘 -> 构造续跑 Prompt -> 进入下轮”抽取为通用内核，主控与子代理仅需通过策略参数定制其 Prompt 头部与会话命名前缀。

---

### 4. 依恋情结与私有侵入 (Feature Envy & Inappropriate Intimacy) —— CLI 强行注入 Orchestrator 内部状态
- **文件路径**: `src/cli.ts#L195, L437, L448, L828, L893, L962, L1243`
- **置信度等级**: `Level 1`
- **异味/缺陷类别**: Feature Envy (依恋情结) / Inappropriate Intimacy (不当亲密关系) / 破坏类型安全
- **代码现状说明**:
  `CphPiCli` 频繁越过公开 API 接口，强行使用 `as any` 直接读写 `CopilotOrchestrator` 的内部属性：
  ```typescript
  // cli.ts line 195 & line 828
  (this.orchestrator as any).timeoutMs = timeoutMs;

  // cli.ts line 437, 448, 893, 962
  this.orchestrator.isHandshakePending = false;

  // cli.ts line 1243
  (this.orchestrator as any).modelTone = raw;
  ```
  此外，在 `orchestrator.ts` 内部也存在相同问题：
  ```typescript
  // orchestrator.ts line 526, 1401
  const currentEmail = (client as any)?.token?.email || "";
  (client as any)?.close?.();
  ```
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { CphPiCli } from "../src/cli.ts";
  import { CopilotOrchestrator } from "../src/agent/orchestrator.ts";

  it("fails silently when orchestrator refactors modelTone to be encapsulated", () => {
    class SafeOrchestrator extends CopilotOrchestrator {
      private _actualTone = "DefaultTone";
      public get modelTone(): string { return this._actualTone; }
      // 不提供 setter，而是通过构造器或显式方法受保护
    }

    const orch = new SafeOrchestrator({});
    const cli = new CphPiCli({ orchestrator: orch });
    cli.handleModelCommand("Creative");

    // 因为 cli.ts 使用 (this.orchestrator as any).modelTone = raw;
    // 在严格 getter 类上赋值会要么抛出 TypeError，要么静默失败！
    expect(orch.modelTone).toBe("Creative"); // 无法按预期更新
  });
  ```
- **潜在风险与影响面**:
  严重的类型不安全。编译期完全丧失 TypeScript 静态类型检查保障。一旦重构 `CopilotOrchestrator` 或 `ChatHubClient` 的属性名，所有 `as any` 赋值都会静默失效，导致运行时参数并未真正传递到底层网络客户端。
- **建议整改方向**:
  - **Encapsulate Field (封装字段)**: 在 `CopilotOrchestrator` 定义规范的公开配置修改方法：`public updateModelTone(tone: string): void`、`public setTimeoutMs(timeoutMs: number): void`、`public setHandshakePending(pending: boolean): void`；
  - 为 `IOrchestratorChatClient` 补充 `close(): void` 与 `token?: ActiveSessionToken` 的标准可选接口契约，彻底消灭代码中的 `as any` 强制转换。

---

### 5. 基本类型偏执与参数嗅探 (Primitive Obsession & Parameter Sniffing) —— PromptBuilder 模糊内容推断
- **文件路径**: `src/protocol/prompt-builder.ts#L140-L164`
- **置信度等级**: `Level 1`
- **异味/缺陷类别**: Primitive Obsession (基本类型偏执) / Parameter Sniffing (反模式参数内容嗅探)
- **代码现状说明**:
  `PromptBuilder.buildTurn2TaskPrompt` 接受未命名的泛化字符串参数 `(task: string, arg2: string, arg3 = "", toolName?: string)`，并在内部依靠检查字符串是否包含 `"Skill"` 或 `"技能"` 来反推其角色：
  ```typescript
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
  } else {
    toolResult = arg2;
    skillsSection = "";
  }
  ```
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { PromptBuilder } from "../src/protocol/prompt-builder.ts";

  it("inverts prompt semantics when toolResult happens to contain the word Skill", () => {
    const task = "Fix the login bug";
    // 假设上一步工具读取了一个名为 SkillLoader.ts 的源码文件，输出中自然包含 "Skill"
    const toolOutput = "export class SkillLoader { ... 50 lines of code ... }";

    // 调用双参数模式 buildTurn2TaskPrompt(task, toolResult)
    const prompt = PromptBuilder.buildTurn2TaskPrompt(task, toolOutput);

    // 致命缺陷：因为只有两个参数，函数走 else 分支，toolResult = arg2 看起来正确；
    // 但如果有调用方传入了空的 skillsSection 作为 arg2，真实的 toolResult 作为 arg3：
    const swappedPrompt = PromptBuilder.buildTurn2TaskPrompt(task, toolOutput, "");
    
    // 因为 toolOutput 含有 "Skill"，被误判为 skillsSection！
    // 真实的代码内容被错拼进了【当前已激活的专业技能】，而【TOOL_RESULT】被置空！
    expect(swappedPrompt).toContain(`[TOOL_RESULT - SUCCESS]:\n\n`);
  });
  ```
- **潜在风险与影响面**:
  极其脆弱的启发式猜测逻辑。大语言模型应用中，工具输出经常包含诸如 `Skill`、`技能` 相关的关键词（例如阅读技能文件、运行技能测试等）。一旦触发误判，会导致用户任务上下文被错误注入到技能系统提示词中，造成模型认知严重混乱。
- **建议整改方向**:
  - **Introduce Parameter Object (引入参数对象)**:
    将位置参数重构为具名对象接口：
    ```typescript
    export interface Turn2PromptParams {
      task: string;
      toolResult: string;
      skillsSection?: string;
      toolName?: string;
    }
    ```
    彻底废除基于字符串内容嗅探的歧义重载。

---

### 6. 数据泥团与双轨契约 (Data Clumps / Duplicate Abstraction) —— TurnRecord 与 SessionTurnRecord 不对齐
- **文件路径**: `src/agent/compaction.ts#L1-L11` vs `src/session/session-manager.ts#L7-L19` 与 `src/cli.ts#L1478-L1506`
- **置信度等级**: `Level 2`
- **异味/缺陷类别**: Data Clumps (数据泥团) / Duplicate Abstraction (重复抽象)
- **代码现状说明**:
  系统内定义了两套结构极其相似却字段名截然不同的交互记录接口：
  - `src/agent/compaction.ts`: `TurnRecord` (`turn`, `userInput`, `thought`, `response`, `toolName`, `toolOutput`, `success`, `action`)；
  - `src/session/session-manager.ts`: `SessionTurnRecord` (`turnNumber`, `userInput`, `modelReasoning`, `modelResponse`, `toolCalls: [...]`)。
  这导致在 `cli.ts` 的第 1478-1506 行，每次从编排器收集结果保存到会话时，必须手写一段长达 30 行的胶水适配循环将 `TurnRecord` 映射转换为 `SessionTurnRecord`。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 当需要为单轮交互扩展字段（例如 tokenCounts、durationMs、timestamp）时：
  // 必须同时修改 compaction.ts、orchestrator.ts、session-manager.ts 以及 cli.ts 中的转换循环
  // 漏改任意一处都会导致数据在运行时静默丢失
  ```
- **潜在风险与影响面**:
  跨模块数据传递存在沉重的摩擦成本。两者属于同一领域概念（会话轮次），双轨制导致数据在跨越 `orchestrator` 和 `session-manager` 边界时频繁发生对象拆装箱与字段改名。
- **建议整改方向**:
  - **Unify Type (统一实体契约)**:
    在 `src/session/types.ts` 或通用模型层中定义单一真相来源 `ConversationTurn`；
  - 或在 `SessionManager` 中内置 `SessionRecord.appendTurns(turns: TurnRecord[])` 领域方法，彻底从 `cli.ts` 中消除手动转换循环。

---

### 7. 样板代码克隆 (Duplicate Code) —— ToolBridge 结果包装与持久化样板 4 次复制
- **文件路径**: `src/protocol/tool-bridge.ts#L602-L622, L659-679, L686-706, L758-778`
- **置信度等级**: `Level 2`
- **异味/缺陷类别**: Duplicate Code (重复代码)
- **代码现状说明**:
  在 `ToolBridge.executeAction` 中，无论遇到参数非法、提问抛错、未找到原生工具、还是工具内部崩溃，下面这段长达 20 行的处理样板代码在 4 处 `catch` 和错误分支中一字不差地重复出现：
  ```typescript
  let output = err instanceof Error ? err.message : String(err);
  output = sanitizeOutput(output);
  const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
  const formatted = this.formatResult({
    toolName: rawActionName,
    target: mapped.target,
    success: false,
    output: persisted.displayOutput,
  });

  return {
    actionName: rawActionName,
    piToolName: mapped.canonicalTool,
    target: mapped.target,
    success: false,
    output: persisted.displayOutput,
    rawOutput: output,
    formatted,
    mappedArgs: mapped.args,
    persistedFile: persisted.persistedFile,
  };
  ```
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 若需在所有工具失败时增加错误追踪日志或指标上报，开发人员必须在 4 个完全相同的地方分别复制粘贴修改
  ```
- **潜在风险与影响面**:
  修改单点逻辑时容易遗漏其他三处，违反 DRY (Don't Repeat Yourself) 原则，平白增加代码行数与审计认知负荷。
- **建议整改方向**:
  - **Extract Method (提炼函数)**:
    提炼统一的错误构建辅助方法：
    ```typescript
    private createErrorResult(
      rawActionName: string,
      target: string,
      error: unknown,
      piToolName = "unknown",
      mappedArgs?: MappedToolArgs
    ): ToolBridgeResult
    ```

---

### 8. 重复代码 (Duplicate Code) —— 上下文 Token 估算算法复制粘贴
- **文件路径**: `src/cli.ts#L472-L480` 与 `src/cli.ts#L1139-L1147`
- **置信度等级**: `Level 1`
- **异味/缺陷类别**: Duplicate Code (重复代码)
- **代码现状说明**:
  在 `CphPiCli.renderCurrentStatusBar()` (第 472-480 行) 和 `CphPiCli.getDiagnosticCard()` (第 1139-1147 行) 中，统计会话已消耗字符量并估算 Token 的算法完全一致：
  ```typescript
  let estimatedChars = 0;
  for (const t of session.turns || []) {
    estimatedChars += (t.userInput?.length || 0) + (t.modelResponse?.length || 0);
    if (t.toolCalls) {
      for (const tc of t.toolCalls) {
        estimatedChars += tc.output?.length || 0;
      }
    }
  }
  const estimatedTokens = estimatedChars > 0 ? Math.round(estimatedChars / 3.5) : 0;
  ```
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 若某天优化了中文/代码 Token 比例（例如从 3.5 改为 2.8），或者将 toolCalls 的 args 也计入上下文，
  // 一旦只修改了 renderCurrentStatusBar 而忘记修改 getDiagnosticCard，
  // 用户在终端状态栏看到的 Token 数量与输入 /status 诊断卡看到的数值将产生矛盾对账失败！
  ```
- **潜在风险与影响面**:
  极易产生上下游状态显示不一致的低级缺陷。
- **建议整改方向**:
  - **Move Method (搬移函数) / Extract Method**:
    将该算法移动至 `SessionRecord` 领域模型，或在 `SessionManager` 中提供纯函数 `estimateSessionContextTokens(session: SessionRecord): number`。

---

### 9. 巨石长函数与深度回调闭包 (Long Method & Complex Closure) —— ChatHubClient.sendMessage()
- **文件路径**: `src/transport/chathub-client.ts#L113-L483`
- **置信度等级**: `Level 2`
- **异味/缺陷类别**: Long Method (超长函数: 370 行) / Divergent Change (发散变化)
- **代码现状说明**:
  `sendMessage()` 方法长达 370 行，包裹在一个巨大的 `new Promise` 闭包内部。该方法同时管理着：
  1. AbortSignal 监听器挂载与反挂载；
  2. 请求全局总超时定时器 (`timeoutMs`) 与连接空闲心跳定时器 (`idleTimeoutMs`)；
  3. WebSocket 实例创建、请求头组装；
  4. SignalR 握手帧序列化与发送 (`protocol: json`)；
  5. 初始握手响应接收与 ChatFrame / MetricsFrame 巨型负载组装（内含 11 个 hardcoded optionsSets）；
  6. 消息帧类型 `type: 6` (Ping/Pong) 心跳反击；
  7. 消息帧类型 `type: 1` 流式 Delta、Reasoning 及 429 限流关键字探测；
  8. 消息帧类型 `type: 2` 与 `type: 3` 结题判决与错误码映射。
- **反例测试提案 (PoC Test Snippet)**:
  ```typescript
  // 缺陷证明：无法在不构造完整 WebSocket Mock 管道的情况下，单独针对某一个 SignalR 帧的处理逻辑（如 GptNotAvailable 错误码解析）编写轻量单元测试
  // 所有状态变量（isSettled, hasSentChat, fullText, timeoutTimer 等）都封闭在闭包深处，无法做白盒断言
  ```
- **潜在风险与影响面**:
  闭包内部包含 10 余个共享可变变量，异步时序极其复杂。在网络突发抖动、异常关闭与 AbortSignal 并发触发时，极易产生竞态条件或未清理的定时器悬挂。
- **建议整改方向**:
  - **Replace Method with Method Object (以方法对象取代函数)**:
    将 `sendMessage` 重构为专门的 `ChatHubStreamingSession` 会话对象；
  - **Extract Method (提炼函数)**:
    将帧解析提取为独立的分流方法：`handleHeartbeatFrame()`, `handleStreamUpdateFrame()`, `handleCompletionFrame()`。

---

### 10. 散落的魔术字面量与协议配置泥团 (Magic Literals & Data Clumps) —— SignalR 请求载荷
- **文件路径**: `src/transport/chathub-client.ts#L257-L277, L314-L322`
- **置信度等级**: `Level 3`
- **异味/缺陷类别**: Magic Literals (魔术字面量) / Data Clumps (数据泥团)
- **代码现状说明**:
  在 `chathub-client.ts` 内部，深度内嵌了大量的长文本魔法字符串数组：
  - 11 个特定的 Sydney optionsSets：`"search_result_progress_messages_with_search_queries"`, `"deepleo_networking_timeout_10minutes_canmore"`, `"cwc_fileupload_odb"`, `"enable_batch_token_processing"` 等；
  - 6 个 `allowedMessageTypes`；
  - 5 个 `entityAnnotationTypes`。
- **潜在风险与影响面**:
  这些字符串直接决定了微软 Sydney 服务的响应模式。散落在深层网络代码中不利于针对不同模型版本或协议演进做统一配置与灰度变更。
- **建议整改方向**:
  - **Replace Magic Literal with Symbolic Constant (以符号常量取代魔术字面量)**:
    提取至 `src/transport/protocol-constants.ts`。

---

### 11. 重复的代码框绘制逻辑 (Duplicate Code) —— TuiRenderer 横幅框渲染
- **文件路径**: `src/ui/tui-renderer.ts#L492-L604, L798-L835`
- **置信度等级**: `Level 3`
- **异味/缺陷类别**: Duplicate Code (重复代码)
- **代码现状说明**:
  在 `tui-renderer.ts` 中，存在 6 个独立的 Banner 格式化方法：
  `formatAutonomousHandoffBanner`, `formatDisasterBlackboxBanner`, `formatArbitratorHandoffBanner`, `formatDisasterSuccessorBanner`, `formatMainVirtualizationBanner`, `formatSuccessorAwakeningBanner`。
  每个方法均手写了 `border = "─".repeat(60)`、`padEnd(35)` 等 ANSI 控制字符与换行组合，格式化模板高度雷同。
- **建议整改方向**:
  - **Extract Method (提炼函数)**:
    提炼通用的文本框渲染器 `renderBoxedBanner(title: string, lines: string[], options: { borderColor: ChalkColor, width?: number })`。

---

## 达到 10/10 结构健康度所需的分步重构蓝图

按照 Martin Fowler 重构规约，重构不是推倒重来，而是一系列**在现有 476 个测试绿灯保护下，步步验证、小步前进的保行为变换**。

### 第一阶段：消除高危代码坏味道（拉升至 6.0 分）
1. **彻底消除参数内容嗅探 (Issue 5)**：
   - 重构 `PromptBuilder.buildTurn2TaskPrompt`，改用强类型参数对象 `Turn2PromptParams`；
   - 修复所有调用方，确保 476 个测试绿灯通过。
2. **提取公用 ToolBridge 结果构建器 (Issue 7)**：
   - 在 `ToolBridge` 中提炼 `createErrorResult(...)`，消除 4 处重复样板代码。
3. **消除 Token 估算算法克隆 (Issue 8)**：
   - 在 `SessionManager` 中封装统一的 `estimateSessionTokens(session)` 纯函数，替换 `cli.ts` 中的两处重复循环。
4. **统一封装 Orchestrator 与 Client 访问接口 (Issue 4)**：
   - 在 `CopilotOrchestrator` 提供正规的方法（如 `updateModelTone`, `resetHandshake`），消灭 `cli.ts` 中的 `(this.orchestrator as any)` 侵入。

### 第二阶段：拆解上帝类与长方法（拉升至 8.5 分）
1. **提取自主接力执行核 (Issue 3)**：
   - 提炼 `AutonomousHandoffRelay`，统一主控与子代理的 Multi-Hop 接力调度状态机，消灭 `cli.ts` 与 `subagent-runner.ts` 之间的重复代码。
2. **分解 CphPiCli (Issue 1)**：
   - 将 `src/cli.ts` 中的 12+ Slash 命令按 Command 模式提取到 `src/cli/commands/` 目录；
   - 将 REPL 交互与多行模式提炼至 `src/cli/repl-session.ts`；
   - 使 `src/cli.ts` 瘦身至 300 行以内，仅充当装配与启动胶水。
3. **分解 CopilotOrchestrator.run() (Issue 2)**：
   - 提取 `GenerationalSuccessionManager` 管理多代主控会话的转生与血缘登记；
   - 将 550 行的 `run()` 拆解为 `initializeContext()`, `executeTurnLoop()`, `handleActionDispatch()` 三大主线。

### 第三阶段：领域实体归一化与设计模式升级（达到 10.0 分）
1. **统一交互轮次契约 (Issue 6)**：
   - 归一化 `TurnRecord` 与 `SessionTurnRecord`，由单一模块提供跨层通用实体；
2. **重构 ChatHubClient 传输层 (Issue 9 & 10)**：
   - 将 `sendMessage` 提炼为 `ChatHubStreamingSession` 会话对象，抽离独立 SignalR 帧分发策略，常量下沉至 `protocol-constants.ts`；
3. **完成最终回归测试矩阵**：
   - 验证所有 476 个单元/集成测试与 E2E 测试持续 100% 通过，结构整洁，无遗留代码异味。
