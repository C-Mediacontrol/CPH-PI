# Pi (`earendil-works/pi`) 源码架构深度审计与 Copilot 注入锚点定位报告

> **报告版本**：1.0.0  
> **审计日期**：2026-10-10  
> **审计代码基座**：`e:\copilot-web proxy\CPH-PI\pi` (commit 基线：official upstream `earendil-works/pi`)  
> **目标工程**：`CPH-PI` (Copilot M365 + Pi 架构融合)  
> **关联任务**：Task 2 源码架构剖析与注入锚点定位

---

## 目录
1. [4 大核心工具审计 (`packages/coding-agent/src/core/tools/`)](#1-4-大核心工具审计)
2. [Provider 与 LLM 交互架构 (`packages/ai/` 与 `packages/coding-agent`)](#2-provider-与-llm-交互架构)
3. [Agent 会话生命周期与循环 (`packages/coding-agent` & `packages/agent`)](#3-agent-会话生命周期与循环)
4. [TUI 交互通道与中断机制 (`packages/tui/` & `packages/coding-agent`)](#4-tui-交互通道与中断机制)
5. [Copilot 注入最优路径综合评估与决议](#5-copilot-注入最优路径综合评估与决议)

---

## 1. 4 大核心工具审计

在 Pi 中，核心工具实现位于 `packages/coding-agent/src/core/tools/`，采用 `TypeBox` 声明强类型 Schema，所有工具均导出 `create<Name>Tool`（面向 `AgentTool`）与 `create<Name>ToolDefinition`（面向 `ToolDefinition`，包含渲染器配置）。

### 1.1 `read` 工具 (`packages/coding-agent/src/core/tools/read.ts`)

- **导出入口**：
  - `createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema>`
  - `createReadToolDefinition(cwd: string, options?: ReadToolOptions): ToolDefinition<typeof readSchema, ReadToolDetails | undefined>`
- **输入参数 Schema (`readSchema`)**：
  ```typescript
  const readSchema = Type.Object({
    path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  });
  ```
  - **字段清单**：
    - `path` (`string`，必填)：目标文件路径（支持相对路径与绝对路径，通过 `resolveReadPathAsync` 解析）。
    - `offset` (`number`，可选，1-indexed)：起始读取行号（转换为 0-indexed 数组偏移）。
    - `limit` (`number`，可选)：最大读取行数。
- **执行逻辑与截断机制**：
  - 依靠 `truncateHead(selectedContent)` 进行截断保护。
  - 限制常量：`DEFAULT_MAX_LINES = 2000` 行，`DEFAULT_MAX_BYTES = 50 * 1024` (50KB)。
  - 若超过限制，自动附加续读提示：`[Showing lines X-Y of Z. Use offset=N to continue.]`。
  - 支持多模态图片识别：若目标为图片，经 `processImage` 转换为 base64 发送 `ImageContent`。
- **返回结构 (`ReadToolOutput` / `AgentToolResult`)**：
  ```typescript
  return {
    content: [{ type: "text", text: outputText }],
    details: { truncation?: TruncationResult },
    structuredContent: string | { type: "image"; data: string; mimeType: string; note: string }
  };
  ```

---

### 1.2 `write` 工具 (`packages/coding-agent/src/core/tools/write.ts`)

- **导出入口**：
  - `createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema>`
  - `createWriteToolDefinition(cwd: string, options?: WriteToolOptions): ToolDefinition<typeof writeSchema, undefined>`
- **输入参数 Schema (`writeSchema`)**：
  ```typescript
  const writeSchema = Type.Object({
    path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
    content: Type.String({ description: "Content to write to the file" }),
  });
  ```
  - **字段清单**：
    - `path` (`string`，必填)：待写入文件路径。
    - `content` (`string`，必填)：写入的文件完整字符串。
- **并发与安全保护**：
  - 由 `withFileMutationQueue(absolutePath, async () => { ... })` 串行化保护同一文件的并发写入冲突。
  - 自动递归创建上级目录：`fsMkdir(dir, { recursive: true })`。
- **返回结构**：
  ```typescript
  return {
    content: [{ type: "text", text: `Successfully wrote to ${path}` }],
    details: undefined,
  };
  ```

---

### 1.3 `edit` 工具 (`packages/coding-agent/src/core/tools/edit.ts`)

- **导出入口**：
  - `createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema>`
  - `createEditToolDefinition(cwd: string, options?: EditToolOptions): ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState>`
- **输入参数 Schema (`editSchema`)**：
  ```typescript
  const replaceEditSchema = Type.Object({
    oldText: Type.String({
      description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
  });

  const editSchema = Type.Object({
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(replaceEditSchema, {
      description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally.",
    }),
  });
  ```
  - **字段清单**：
    - `path` (`string`，必填)：文件路径。
    - `edits` (`Array<{ oldText: string, newText: string }>`，必填)：目标精准替换块数组。
    - *兼容性容错*：`prepareEditArguments(input)` 支持将单对象、模型输出的 JSON 字符串、以及旧版 `{ oldText, newText }` 自动转为 `edits` 数组。
- **替换执行核心 (`applyEditsToNormalizedContent`)**：
  - 剥离 UTF-8 BOM 并统一转为 LF 换行后比对。
  - 强校验：`oldText` 在全文必须存在且**全局唯一**（出现次数精确为 1），否则直接报错并输出发生冲突的上下文定位。
  - 计算差异：利用 `generateDiffString` 与 `generateUnifiedPatch` 生成统一 Diff。
- **返回结构 (`EditToolDetails`)**：
  ```typescript
  return {
    content: [{ type: "text", text: `Successfully replaced ${edits.length} block(s) in ${path}.` }],
    details: {
      diff: diffResult.diff,         // 彩色终端/高亮展示格式
      patch: patch,                 // 标准 unified diff patch
      firstChangedLine: diffResult.firstChangedLine,
    },
  };
  ```

---

### 1.4 `bash` 工具 (`packages/coding-agent/src/core/tools/bash.ts`)

- **导出入口**：
  - `createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema>`
  - `createBashToolDefinition(cwd: string, options?: BashToolOptions): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState>`
- **输入参数 Schema (`bashSchema`)**：
  ```typescript
  const bashSchema = Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
  });
  ```
  - **字段清单**：
    - `command` (`string`，必填)：要执行的 shell 命令行。
    - `timeout` (`number`，可选，单位秒)：超时时间。
- **执行逻辑与截断保护**：
  - 由 `OutputAccumulator` 收集标准输出与错误输出，并通过 `BASH_UPDATE_THROTTLE_MS = 100ms` 节流更新到 TUI。
  - 尾部截断保护 (`truncateTail`)：保留最后 2000 行或 50KB（whichever hit first），超出部分自动落盘至临时文件：`fullOutputPath`（前缀 `pi-bash-*`）。
  - 跨平台进程树中止：超时或收到 `signal.abort` 时，Windows/POSIX 统一调用 `killProcessTree(child.pid)`，防止孤儿进程卡死。
- **返回结构 (`BashToolOutput`)**：
  ```typescript
  return {
    content: [{ type: "text", text: outputText }],
    details: { truncation?: TruncationResult, fullOutputPath?: string },
    structuredContent: {
      output: string,
      truncated: boolean,
      full_output_path?: string,
      exit_code: number,
      wall_time_seconds: number,
    },
    isError: exitCode !== 0,
  };
  ```

---

### 1.5 辅助工具与导出汇总 (`packages/coding-agent/src/core/tools/index.ts`)

Pi 还提供了：
- `powershell.ts`：Windows 原生 PowerShell 工具。
- `find.ts`, `grep.ts`, `ls.ts`：只读文件系统辅助工具。
- `truncate.ts`：公共截断算法 `truncateHead`、`truncateTail`、`DEFAULT_MAX_LINES` (2000)、`DEFAULT_MAX_BYTES` (50KB)。
- `createCodingTools(cwd, options)`：一键实例化 4 大核心工具 `[read, bash, edit, write]`。

---

## 2. Provider 与 LLM 交互架构

### 2.1 统一调用接口：`AssistantMessageEventStream`

Pi 并没有采用 Vercel AI SDK 的 `streamText`，而是构建了自有的高性能异步事件流抽象：

- **调用协议**：
  ```typescript
  // packages/ai/src/models.ts
  models.streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions
  ): AssistantMessageEventStream;
  ```
- **核心契约 `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`)**：
  继承自 `EventStream<AssistantMessageEvent, AssistantMessage>`，生命周期事件集合 (`AssistantMessageEvent`)：
  - `start`：流开始，初始化 `AssistantMessage`。
  - `text_start` / `text_delta` / `text_end`：文本增量更新。
  - `thinking_start` / `thinking_delta` / `thinking_end`：思维链增量更新。
  - `toolcall_start` / `toolcall_delta` / `toolcall_end`：工具调用参数流式拼装。
  - `done`：正常终止（包含原因：`stop` | `length` | `toolUse` | `deferred`）。
  - `error`：异常终止（`aborted` | `error`）。

### 2.2 自定义 Provider 注册与扩展机制

Pi 在两个层级支持自定义 Provider：

#### 层级 1：底层 `ModelRuntime` 原生注册 (`packages/coding-agent/src/core/model-runtime.ts`)
```typescript
modelRuntime.registerNativeProvider(provider: Provider): void;
modelRuntime.registerProvider(providerId: string, config: ProviderConfigInput): void;
```
通过 `createProvider(options)`（`packages/ai/src/models.ts`）构建原生 Provider：
```typescript
export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  name?: string;
  baseUrl?: string;
  auth: ProviderAuth;
  models: readonly ProviderModel<TApi>[];
  api?: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}
```

#### 层级 2：Extension API 扩展 (`packages/coding-agent/src/core/extensions/types.ts`)
```typescript
pi.registerProvider("copilot", {
  name: "Microsoft Copilot M365",
  baseUrl: "https://copilot.microsoft.com",
  models: [...],
  streamSimple: (model, context, options) => {
    // 自定义 stream 协议实现！返回 AssistantMessageEventStream
    const stream = createAssistantMessageEventStream();
    // 驱动自定义 WebSocket/ChatHub 解析逻辑并 push 事件
    return stream;
  }
});
```

### 2.3 Pi 原生现存的 GitHub Copilot 实现评估

源码审计显示，Pi 在 `packages/ai/src/providers/github-copilot.ts` 中**已自带 GitHub Copilot 支持**：
- 支持 Device Flow OAuth 登录（`auth/oauth/github-copilot.ts`）。
- 携带专有 VSCode 伪装 Headers (`User-Agent: GitHubCopilotChat/0.35.0` 等)。
- 涵盖大量官方模型映射（`data/github-copilot.json`）。
- **与本项目目标（M365 Copilot）的区别**：
  - 官方自带的是 **GitHub Copilot 个人/企业订阅（基于 REST HTTP，端点 `api.individual.githubcopilot.com`）**。
  - 本项目需要接入的是 **Microsoft 365 Copilot（基于 ChatHub WebSocket 双工长连接、Substrate 附件上传通道、7 账号透明加密轮转池）**。
  - 两者后端协议、握手帧、认证载荷完全不同。因此必须引入专有的 M365 Copilot Provider / Orchestrator。

---

## 3. Agent 会话生命周期与循环

### 3.1 架构分工：`Agent` 与 `AgentSession`

- **底层循环 `Agent` (`packages/agent/src/agent.ts`, `agent-loop.ts`)**：
  - 纯状态机，不依赖 UI 或具体磁盘持久化。
  - 拥有关键钩子：
    - `convertToLlm(messages)`：将内部消息清洗/转换为 LLM 接收的格式。
    - `transformContext(messages)`：**每次调用 LLM 前的上下文转换管道（压实第一锚点）**。
    - `beforeToolCall(ctx)` / `afterToolCall(ctx)`：工具执行前拦截（可 `block: true`）与结果重写。
    - `prepareRequest(ctx)`：每次请求底层 LLM 前触发。
    - `finishTurn(ctx)`：助手轮次完成后的决策（可强制 `continue` 或 `end`）。
- **上层编排 `AgentSession` (`packages/coding-agent/src/core/agent-session.ts`)**：
  - 组装 `Agent`、`SessionManager`、`ModelRuntime`、`SettingsManager`。
  - 负责维护对话树、分支（Branch）、文件系统会话日志落盘（`sessionManager.appendMessage(...)`）。
  - 控制高层消息流转：`prompt()`（新轮次）、`steer()`（运行中打断插话）、`followUp()`（运行完毕后续接）。
  - 统一协调 Compaction 与取消操作：`abort()` 触发内部 `AbortController` 连带取消底层模型流与子进程。

### 3.2 关键拦截锚点分析

#### (1) 两轮压实 (Compaction) 的植入点

在 CPH-PI 规范中，**两轮滑动观察剥离** 要求：
- 最近 $\le 2$ 轮：保留完整的用户输入、Thought、Action 与工具输出。
- 历史 $> 2$ 轮：剥离工具返回的长篇代码和命令输出（折叠为精简摘要或 `[Tool output cleared]`），释放 80%~95% 上下文空间。

**Pi 源码中定位到 2 个最佳植入点**：

1. **轻量实时滑动微压实（Micro-Compaction / Context Pruning）——【推荐主路径】**：
   - **锚点文件**：`packages/coding-agent/src/core/sdk.ts`（第 436 行）中的 `transformContext`：
     ```typescript
     transformContext: async (messages) => {
       // 此函数在每次向 LLM 构建 payload 前调用
       // 在此处遍历 messages：保留末尾 2 轮完整内容，
       // 将更早历史轮次中的 toolResult 内容压缩替换为精简签名或状态标记。
       return pruneOlderToolResults(messages, { keepRecentTurns: 2 });
     }
     ```
   - **优势**：无损、无需触发额外的 LLM 总结轮次、零延迟、立即削减 80%+ 的上下文消耗。
2. **宏观会话压实（Macro-Compaction / Checkpoint Summary）**：
   - **锚点文件**：`packages/coding-agent/src/core/agent-session.ts`（第 3125 行 `session_before_compact` 事件）以及 `packages/coding-agent/src/core/compaction/compaction.ts`。
   - 当会话轮次超过阈值（如 25 轮）或遇到 Token 溢出时，触发 `prepareCompaction` 生成结构化总结（`## Goal`, `## Done`, `## Next Steps`），在 session 中插入 `CompactionEntry`。

#### (2) RefusalGuard 拒答拦截的植入点

Copilot 面对本地代码操作容易触发微软安全机制输出拒答模版（如 *"I'm sorry, but I cannot access local files or execute commands on your system..."*）。

**Pi 源码中定位到 2 个植入点**：

1. **Provider 流式层拦截（Transport/Provider Hook）——【最优隐式恢复路径】**：
   - 在自定义的 `streamSimple` 中封装 `AssistantMessageEventStream`。
   - 当累积的文本命中 RefusalGuard 正则特征库时：
     - **不向 TUI 发送错误**，而是立即主动中止当前输出；
     - 自动调度 `AccountPool` 轮换下一个账号，或在上下文中注入 Grounding 物理证据后无感重新向 Copilot 发起重试；
     - 对用户完全透明无感。
2. **Agent 轮次层拦截（Agent `finishTurn` / `afterToolCall`）**：
   - 在 `Agent` 配置的 `finishTurn` 钩子中（`packages/agent/src/agent-loop.ts`）：
     - 检查 `turn.message.content` 是否被 RefusalGuard 判定为拒答；
     - 若判定为拒答，返回 `{ action: "continue" }`，并在上下文注入纠偏信息：
       ```markdown
       [系统事实纠偏]: 外部 Harness 已经挂载物理目录，请使用 read_file 工具读取目标文件。
       ```

---

## 4. TUI 交互通道与中断机制

### 4.1 终端渲染管道 (`packages/tui/` & `packages/coding-agent/src/modes/interactive/`)

- **流式 Markdown 渲染**：
  - 由 `AssistantMessageComponent` (`components/assistant-message.ts`) 承接。
  - 使用 `@earendil-works/pi-tui` 的 `Markdown` 组件做增量 ANSI 样式排版。
  - 思维链（Thinking Process）通过 `components/themed-text.ts` 折叠为带有动态点阵或 `Thinking...` 状态行，支持快捷键切换展开。
- **Diff 差异对比视窗**：
  - `renderDiff` (`components/diff.ts`)：基于 `diff` 模块计算词级别（word-level）intra-line 差异。
  - 绿色显示新增内容（`toolDiffAdded`），红色显示删除内容（`toolDiffRemoved`），并对行内变动词条应用反色突出显示（`theme.inverse`）。
  - `edit` 工具定义了专属 `editRenderers` (`packages/coding-agent/src/core/tools/renderers/edit.ts`)，在执行前向 TUI 推送预览，执行后高亮显示改动行数。
- **用户交互确认与选择**：
  - `ExtensionUIContext` (`core/extensions/types.ts`) 内置：
    - `ctx.ui.select(title, options)`：弹出交互式列表选择框。
    - `ctx.ui.confirm(title, message)`：弹出 [Y/N] 确认模态框。
    - `ctx.ui.input(title, placeholder)`：弹出单行文本输入框。
  - 底层基于 `SelectList` 和 `Editor` 模态层渲染，天然与终端大小自适应。

### 4.2 中断机制与两段式 Ctrl+C 改造点

- **Pi 原生键位映射 (`packages/coding-agent/src/core/keybindings.ts`)**：
  - `"app.interrupt"`：默认绑定为 `Escape`。
  - `"app.clear"`：默认绑定为 `Ctrl+C`。
  - `"app.exit"`：默认绑定为 `Ctrl+D`。
- **Pi 原生交互处理 (`packages/coding-agent/src/modes/interactive/interactive-mode.ts`)**：
  ```typescript
  // 行 3070: Escape 键处理
  this.defaultEditor.onEscape = () => {
    if (this.session.isStreaming) {
      this.restoreQueuedMessagesToEditor({ abort: true }); // 中断流并保留输入
    } else if (this.session.isBashRunning) {
      this.session.abortBash();                          // 杀掉 bash 子进程
    }
  };

  // 行 4269: Ctrl+C 处理
  private handleCtrlC(): void {
    const now = Date.now();
    if (now - this.lastSigintTime < 500) {
      void this.shutdown(); // 500ms 内连按两次退出程序
    } else {
      this.clearEditor();   // 单次按下清空输入框
      this.lastSigintTime = now;
    }
  }
  ```
- **CPH-PI 两段式安全中断实现方案**：
  - CPH-PI 规范要求：*“运行中单次 Ctrl+C 取消流或子进程；空闲时连按两次退出”*。
  - **改造方案极其简捷清晰**：只需在 `handleCtrlC()` 开头加入运行状态检测：
    ```typescript
    private handleCtrlC(): void {
      if (this.session.isStreaming) {
        this.restoreQueuedMessagesToEditor({ abort: true });
        return;
      }
      if (this.session.isBashRunning) {
        this.session.abortBash();
        return;
      }
      // 空闲态沿用 500ms 双击退出逻辑
      const now = Date.now();
      if (now - this.lastSigintTime < 500) {
        void this.shutdown();
      } else {
        this.clearEditor();
        this.lastSigintTime = now;
      }
    }
    ```
    同时在 `APP_KEYBINDINGS` 中允许为 `"app.interrupt"` 增加 `"ctrl+c"` 别名。

---

## 5. Copilot 注入最优路径综合评估与决议

在本次深度源码审计中，重点对比了两种架构注入思路：

### 方案 A：Provider 扩展注入 (Provider Extension via `ModelRuntime` / `ExtensionAPI`)
- **机制**：
  - 将 Microsoft Copilot M365 封装为一个合规的 `Provider`（或通过 `pi.registerProvider`）。
  - 实现 `streamSimple(model, context, options): AssistantMessageEventStream`。
  - 在底层连接 ChatHub WebSocket，将 Copilot 自然语言文本流与提取出的 `action` 解析转换为 Pi 标准的 `text_delta` 与 `toolcall_start` / `toolcall_delta` / `toolcall_end` 事件。
  - 让 Pi 原生 `AgentSession` 和 `Agent` 继续运转。
- **优点**：
  - 100% 复用 Pi 的全部生态、会话树分支保存、MCP 支持、所有工具调度。
  - 不需要重写或改动 `AgentSession` 主干代码。
- **致命难点与阻抗失配**：
  1. Copilot 输出的动作可能不是标准 JSON，而是 ````action tool: read_file ... ```` 的 Markdown 纯文本。如果在 Provider 内部强行抹平成原生 ToolCall，一旦模型吐出畸形或混杂文本，Provider 会变得异常脆弱。
  2. Copilot M365 需要强约束的 Turn 1 接地（物理文件目录注入）和每次工具执行结果的专用包装格式（`【TOOL_RESULT: ...】`），标准 `convertToLlm` 会将其还原成标准 OpenAI ToolResultMessage，可能会触发 Copilot 的模型幻觉。

### 方案 B：双层融合注入架构 (Dual-Layer Hybrid Injection) ——【最终推荐最优解】

结合 CPH-PI 设计规范（`CPH-PI/.docs/specs/2026-10-10-cph-pi-design.md`）与本次审计结论，最稳健、最符合工程质量的设计是 **“以 Pi 官方架构为主干，通过两层专用适配注入”**：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Pi Interactive Mode (TUI)                       │
│        (Diff 差异视窗 / AssistantMessageComponent 流式排版 / SelectList) │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│              AgentSession (会话树、分支持久化、中断信号级联)               │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
             ┌───────────────────────┴───────────────────────┐
             ▼                                               ▼
┌─────────────────────────┐                     ┌─────────────────────────┐
│   4 大原生工业级工具      │                     │ Copilot M365 专属调度核 │
│ (read, write, edit, bash)│                     │ (Orchestrator + ChatHub)│
└────────────▲────────────┘                     └────────────┬────────────┘
             │                                               │
             │         ┌───────────────────────────┐         │
             └─────────┤   ToolBridge 双向映射桥接   ├─────────┘
                       │ • read: 100行切片保护     │
                       │ • edit: 唯一性 patch 守卫  │
                       │ • bash: 尾部截断保护      │
                       └───────────────────────────┘
```

#### 实施路线锚定点：
1. **工具层 (Task 3)**：直接在 `CPH-PI/src/protocol/tool-bridge.ts` 中调用 Pi 原生 `createCodingTools` 返回的 `read`, `write`, `edit`, `bash` 实例，严密封装别名映射与 100 行切片限制。
2. **传输与认证层 (Task 4)**：在 `CPH-PI/src/transport/` 与 `src/auth/` 构建独立的 `ChatHubClient` 和 `AccountPool`（7 账号加密轮转与 429 感知）。
3. **状态机与压实层 (Task 5)**：
   - 编写 `Orchestrator`，实现 Turn 1 接地与正则容错解析器（`resilient-parser.ts`）。
   - 在消息流转前，通过 `compaction.ts` 实施 **两轮滑动观察剥离**（保留 $\le 2$ 轮完整详情，$> 2$ 轮清除长工具输出）。
   - 在流接收端挂载 `RefusalGuard`，检测到拒答时自动触发自纠 Prompt 或轮换账号。
4. **TUI 与中断层 (Task 6)**：
   - 入口挂载至 Pi 的 `InteractiveMode`；
   - 微调 `handleCtrlC` 实现两段式中断（运行中中断任务，空闲时双击退出）。

---

## 6. 审计结论与 Task 3/4/5/6 衔接指引

- **Pi 源码基座完整度**：官方 `earendil-works/pi` 源码在 `packages/coding-agent`、`packages/ai`、`packages/agent`、`packages/tui` 模块划分清晰，代码工业级，类型安全度极高。
- **4 大工具参数与行为完全摸清**：所有入参（`path`, `offset`, `limit`, `content`, `edits[].oldText`, `command`, `timeout`）及截断机制（2000 行 / 50KB）全部取得精确签名。
- **后续开发无需重搓外壳**：完全可以直接在 Pi 现有的 TUI 与 Tool 机制上完成 Copilot M365 的外科手术式注入！
