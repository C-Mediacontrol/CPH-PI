# DeepSeek 风格子代理独立视窗、全链路 Debug 落盘与 Handoff 平滑接力实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整解决 CPH-PI 在 Web 模式下的三大核心体验与架构断层——实现子代理全生命周期事件透传与独立双重视角查看（中央聚焦 + 右侧并排比对）、消除 Debug 日志排除过滤并接入会话日志树、实现业务 Handoff 与代际跃迁的平滑无缝接力与工作内存自动装配，以及 Turn 级双向持久化对账。

**Architecture:** 
1. **持久化与日志管道**：在 `RpcHandler` 中引入 Turn 级 `SessionManager.saveSession`，将子代理会话写入独立隔离目录 `.cph/subagents/<mainSessionId>/` 规避索引污染；解除 `reasoning:chunk` 排除限制，全面接入 `initSessionTree`；
2. **事件总线与双轨接力**：严格按 5 参数签名对齐子代理三态事件，维护 `activeSubagentToolId` 实现精确工具卡片绑定；双轨捕获 `onHandoff` 与 `onSuccessorAwakened`，自动暂存并装载 `pendingHandoffSnapshot`；
3. **前端双重视角与谱系组件**：以 DeepSeek-Harness 为基准，新增 `SubagentBatchCard`、`SubagentHeaderLineage`、`SubagentReadOnlyComposer` 与右侧抽屉 `SubagentInspector`，支持单子代理聚焦查看与跨代无跳转接力。

**Tech Stack:** TypeScript, Node.js (WebSocket), React 19, CSS Modules, Lucide React, Bun Test.

## Global Constraints

- 严禁在工作区根目录写入任何文件，所有源码、测试与构建配置必须严格落在 `CPH-PI/` 及其子目录内。
- 绝不引入虚构 API（如不存在的 `saveTurn`），严格使用 `SessionManager.saveSession(record)`。
- 子代理会话绝不混存入 `.cph/sessions/` 顶级目录，防止 `rebuildIndex` 污染主会话列表。
- 严禁硬编码虚假指标（如 `tps: 42`），无真实统计时宁缺毋滥。
- 保障全量测试基线通过（770+ pass, 0 fail）。

---

### Task 1: Turn 级持久化与子代理会话物理隔离 (P0)

**Files:**
- Modify: `CPH-PI/src/web/rpc-handler.ts`
- Create: `CPH-PI/tests/web/session-persistence-rpc.test.ts`

**Interfaces:**
- Consumes: `SessionManager.saveSession(session: SessionRecord)`, `SessionManager.loadSession(id: string)`
- Produces: `RpcHandler.persistActiveSession()` 保证每次 Turn 结束或状态变更时自动落盘至 `.cph/sessions/<sessionId>.json`；子代理独立会话落盘至 `.cph/subagents/<mainSessionId>/<subId>.json`

- [x] **Step 1: 编写失败测试**

创建 `CPH-PI/tests/web/session-persistence-rpc.test.ts`：

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/web/session-persistence-rpc.test.ts`
预期: FAIL (`handler.persistActiveSession is not a function`)

- [x] **Step 3: 实现持久化与物理隔离逻辑**

在 `CPH-PI/src/web/rpc-handler.ts` 中实现：
1. 新增辅助方法 `persistActiveSession()`
2. 新增辅助方法 `persistSubagentRecord()`
3. 在 `runOrchestrator` 每次轮次结束（`turnFinalized = true`）及 `onError`/`interrupted` 时调用 `await this.persistActiveSession()`。

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/web/session-persistence-rpc.test.ts`
预期: PASS (3 pass, 0 fail)

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/src/web/rpc-handler.ts CPH-PI/tests/web/session-persistence-rpc.test.ts
git commit -m "feat(web): add turn-level persistence and isolated subagent storage"
```

---

### Task 2: 子代理事件全量接线、5 参数对齐与思考流解禁 (P1 & P4b)

**Files:**
- Modify: `CPH-PI/src/web/rpc-handler.ts`
- Create: `CPH-PI/tests/web/subagent-events-rpc.test.ts`

**Interfaces:**
- Consumes: `OrchestratorEvents.onSubagentStart`, `onSubagentEnd`, `onSubagentProgress`, `initSessionTree`
- Produces: WebSocket 推送 `subagent:start` (含精确 `toolId`), `subagent:progress`, `subagent:end`；移除 `rpc-handler.ts:299` 对 `reasoning:chunk` 的过滤

- [ ] **Step 1: 编写失败测试**

创建 `CPH-PI/tests/web/subagent-events-rpc.test.ts`：
```ts
import { describe, test, expect } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler";

describe("Web RPC Subagent Events Suite", () => {
  test("should dispatch subagent:start with correct 5-arg alignment (hop as number, account as string)", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});

    // Set active tool id
    (handler as any).activeSubagentToolId = "tool-test-123";

    // Simulate callback
    (handler as any).handleSubagentStart(
      "sub-1",
      "researcher",
      { prompt: "分析架构" },
      3,
      "vincent@example.com"
    );

    const startPacket = packets.find((p) => p.type === "subagent:start");
    expect(startPacket).toBeDefined();
    expect(startPacket.payload.toolId).toBe("tool-test-123");
    expect(startPacket.payload.subagentId).toBe("sub-1");
    expect(startPacket.payload.role).toBe("researcher");
    expect(startPacket.payload.hopCount).toBe(3);
    expect(startPacket.payload.account).toBe("vincent@example.com");
  });

  test("should not filter out reasoning:chunk when debug is active", () => {
    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutData += String(chunk);
      return true;
    }) as any;

    try {
      const mockWs: any = { readyState: 1, send: () => {} };
      const handler = new RpcHandler(mockWs, { debug: true });
      handler.send("reasoning:chunk", { chunk: "思考中..." });

      expect(stdoutData).toContain("Web RPC ==> reasoning:chunk");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `bun test tests/web/subagent-events-rpc.test.ts`
预期: FAIL (`handleSubagentStart is not a function`)

- [ ] **Step 3: 完善 RpcHandler 事件接线与过滤解除**

在 `CPH-PI/src/web/rpc-handler.ts` 中：
1. 维护 `private activeSubagentToolId: string | null = null;`。在 `onToolStart` 判定 `toolName === "invoke_subagent"` 时赋值 `this.activeSubagentToolId = toolId`；在 `onToolEnd` 清空。
2. 实现 `handleSubagentStart`、`handleSubagentProgress`、`handleSubagentEnd` 并挂接到 `orchestrator.run({ events })`：
```ts
  onSubagentStart: (id: string, role: string, spec: any, hop?: number, account?: string) => {
    this.handleSubagentStart(id, role, spec, hop, account);
  },
  onSubagentProgress: (id: string, turn: number, delta?: string, action?: any, hopCount?: number, account?: string) => {
    this.handleSubagentProgress(id, turn, delta, action, hopCount, account);
  },
  onSubagentEnd: (report: any) => {
    this.handleSubagentEnd(report);
  },
```
3. 移除 `rpc-handler.ts:299` 中的 `&& type !== "reasoning:chunk"` 排除限制，让思考流在 Debug 打开时正常由 stdout 被 `TerminalLogger` 截获。

- [ ] **Step 4: 运行测试验证通过**

运行: `bun test tests/web/subagent-events-rpc.test.ts`
预期: PASS (2 pass, 0 fail)

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/src/web/rpc-handler.ts CPH-PI/tests/web/subagent-events-rpc.test.ts
git commit -m "feat(web): wire 5-arg subagent events and unblock reasoning stream logging"
```

---

### Task 3: Handoff 双轨监听与代际记忆无缝装配 (P2)

**Files:**
- Modify: `CPH-PI/src/web/rpc-handler.ts`
- Create: `CPH-PI/tests/web/handoff-continuity-rpc.test.ts`

**Interfaces:**
- Consumes: `OrchestratorEvents.onHandoff`, `OrchestratorEvents.onSuccessorAwakened`, `runResult.handedOff`
- Produces: `session:handoff` WebSocket 广播事件；维护 `pendingHandoffSnapshot` 并自动注入下一轮 `orchestrator.run` 的 prompt 前缀

- [x] **Step 1: 编写失败测试**

创建 `CPH-PI/tests/web/handoff-continuity-rpc.test.ts`：
```ts
import { describe, test, expect } from "bun:test";
import { RpcHandler } from "../../src/web/rpc-handler";

describe("Web RPC Handoff Continuity Suite", () => {
  test("should capture onHandoff, broadcast session:handoff, and retain pendingHandoffSnapshot", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});
    (handler as any).activeSessionId = "ses_main_gen1";

    (handler as any).handleHandoffOccurred("## 交接备忘录: 阶段成果", "/path/to/handoff-1.md");

    const handoffPacket = packets.find((p) => p.type === "session:handoff");
    expect(handoffPacket).toBeDefined();
    expect(handoffPacket.payload.predecessorSessionId).toBe("ses_main_gen1");
    expect(handoffPacket.payload.handoffDocPath).toBe("/path/to/handoff-1.md");
    expect((handler as any).pendingHandoffSnapshot).toContain("阶段成果");
  });

  test("should capture onSuccessorAwakened and transition activeSessionId", () => {
    const packets: any[] = [];
    const mockWs: any = {
      readyState: 1,
      send: (data: string) => packets.push(JSON.parse(data)),
    };
    const handler = new RpcHandler(mockWs, {});
    (handler as any).activeSessionId = "ses_main_gen1";

    (handler as any).handleSuccessorAwakened("ses_main_gen2", 2);

    expect((handler as any).activeSessionId).toBe("ses_main_gen2");
    const handoffPacket = packets.find((p) => p.type === "session:handoff");
    expect(handoffPacket).toBeDefined();
    expect(handoffPacket.payload.successorSessionId).toBe("ses_main_gen2");
    expect(handoffPacket.payload.generation).toBe(2);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `bun test tests/web/handoff-continuity-rpc.test.ts`
预期: FAIL (`handleHandoffOccurred is not a function`)

- [x] **Step 3: 实现双轨 Handoff 监听与代际装配**

在 `CPH-PI/src/web/rpc-handler.ts` 中：
1. 增加 `private pendingHandoffSnapshot: string | null = null;`。
2. 实现 `handleHandoffOccurred(snapshot: string, docPath?: string)` 与 `handleSuccessorAwakened(newSessionId: string, gen: number)`。
3. 在 `handleUserSubmit` 调用 `orchestrator.run` 时：
   如果 `this.pendingHandoffSnapshot` 存在，自动将其拼接至 `task` 开头：
   ```ts
   const prefix = `【前序会话成果与交接备忘录】\n${this.pendingHandoffSnapshot}\n\n【接力任务目标】\n`;
   executionTask = prefix + executionTask;
   this.pendingHandoffSnapshot = null; // 消费后清空
   ```
4. 在 `runOrchestrator` 的 `events` 中接管：
   ```ts
   onHandoff: (snapshot: string, docPath?: string) => {
     this.handleHandoffOccurred(snapshot, docPath);
   },
   onSuccessorAwakened: (newSessionId: string, generation: number) => {
     this.handleSuccessorAwakened(newSessionId, generation);
   },
   ```

- [x] **Step 4: 运行测试验证通过**

运行: `bun test tests/web/handoff-continuity-rpc.test.ts`
预期: PASS (2 pass, 0 fail)

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/src/web/rpc-handler.ts CPH-PI/tests/web/handoff-continuity-rpc.test.ts
git commit -m "feat(web): implement dual-track handoff listening and pending snapshot relay"
```

---

### Task 4: 前端协议类型扩展、Store 状态与 `/debug` 本地指令拦截 (P3 & P5)

**Files:**
- Modify: `CPH-PI/web/src/types/protocol.ts`
- Modify: `CPH-PI/web/src/services/store.ts`
- Modify: `CPH-PI/web/src/components/chat/Composer.tsx`

**Interfaces:**
- Consumes: WebSocket `subagent:*` 与 `session:handoff` 事件
- Produces: Store 中的 `subagentsMap: Record<string, SubagentState>`, `focusedSubagentId: string | null`, `handoffEvents: SessionHandoffPayload[]`, `debugEnabled: boolean`；`Composer` 拦截 `/debug` 保留指令

- [ ] **Step 1: 扩展协议定义 `CPH-PI/web/src/types/protocol.ts`**

添加子代理和 Handoff 状态接口：
```ts
export interface SubagentTaskSpec {
  prompt?: string;
  description?: string;
  targetFile?: string;
  stage?: number;
}

export interface SubagentState {
  id: string;
  toolId?: string;
  role: "researcher" | "coder" | string;
  spec?: SubagentTaskSpec;
  status: "queued" | "running" | "completed" | "failed";
  account?: string;
  hopCount: number;
  currentTurn: number;
  reasoning: string;
  actions: Array<{ tool: string; args: any; output?: string; timestamp: number }>;
  report?: {
    id: string;
    role: string;
    description: string;
    success: boolean;
    finalAnswer: string;
    deliverablePath?: string;
    durationMs: number;
    turnsCount: number;
  };
  durationMs?: number;
  startTime: number;
}

export interface SessionHandoffPayload {
  predecessorSessionId: string;
  successorSessionId: string;
  handoffDocPath?: string;
  memoSnippet?: string;
  generation: number;
}

// 扩展 RightbarTab 类型支持 subagent 面板
export type RightbarTab = 'files' | 'terminal' | 'diff' | 'ledger' | 'context' | 'subagent';
```

- [ ] **Step 2: 扩展全局 Store `CPH-PI/web/src/services/store.ts`**

增加响应式状态字段与监听：
- 状态：`subagentsMap: Record<string, SubagentState>`, `focusedSubagentId: string | null`, `activeSubagentAsideId: string | null`, `handoffAnchor: SessionHandoffPayload | null`
- Actions：`setFocusedSubagentId`, `setActiveSubagentAsideId`, `clearHandoffAnchor`
- 监听 `subagent:start`、`subagent:progress`、`subagent:end`、`session:handoff` 驱动状态更新。

- [ ] **Step 3: `Composer.tsx` 增加保留命名空间指令拦截**

在 `Composer.tsx` 的 `handleSubmit` 中判断：
如果 `trimmed.startsWith("/debug")`：
- 发送 `wsClient.send('debug:toggle', { arg: trimmed.slice(6).trim() })`；
- 清空输入框，**不发送**到模型 Prompt，避免技能过滤浮层冲突。

- [ ] **Step 4: 编译验证**

运行: `cd "e:\copilot-web proxy\CPH-PI\web" && bun run build`
预期: Vite 构建 0 错误通过

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/web/src/types/protocol.ts CPH-PI/web/src/services/store.ts CPH-PI/web/src/components/chat/Composer.tsx
git commit -m "feat(web): expand protocol types, store state, and reserve /debug in composer"
```

---

### Task 5: 前端内联子代理批处理卡片 (`SubagentBatchCard`) (P6)

**Files:**
- Create: `CPH-PI/web/src/components/chat/SubagentBatchCard.tsx`
- Create: `CPH-PI/web/src/components/chat/SubagentBatchCard.module.css`
- Modify: `CPH-PI/web/src/components/chat/ToolCard.tsx`

**Interfaces:**
- Consumes: `tool: ToolCall`, `store.subagentsMap`, `store.setFocusedSubagentId`, `store.setActiveSubagentAsideId`
- Produces: 在 `tool.name === 'invoke_subagent'` 时渲染带有并发阶段、账号徽章、实时思考扫光与报告预览的高保真卡片

- [ ] **Step 1: 编写 `SubagentBatchCard.module.css`**

包含 DeepSeek Blue 细线边框、阶段标签、账号徽标、各子代理条目、报告下载卡片样式。

- [ ] **Step 2: 编写 `SubagentBatchCard.tsx`**

实现：
1. 提取当前 `tool.id` 下的所有 `subagent`（通过 `subagent.toolId === tool.id` 关联）；
2. 顶栏显示阶段与统计：`Stage 1 · N/M 完成 · 耗时 X.Xs`；
3. 渲染子代理单选标签栏：`[全部概览] | [Sub-1] | [Sub-2]`；
4. 针对选中的子代理，展示其独立的思考链微光、内部工具执行流水线（`read_file` 等）与成果报告卡片。
5. 提供操作按钮：`[🔍 聚焦中央查看]`（调用 `setFocusedSubagentId`）与 `[◨ 在右侧栏打开]`（调用 `setActiveSubagentAsideId`）。

- [ ] **Step 3: 在 `ToolCard.tsx` 中分流渲染**

在 `ToolCard.tsx` 头部检测：
```tsx
if (tool.name === 'invoke_subagent') {
  return <SubagentBatchCard tool={tool} defaultExpanded={defaultExpanded} />;
}
```

- [ ] **Step 4: 构建验证**

运行: `cd "e:\copilot-web proxy\CPH-PI\web" && bun run build`
预期: 0 错误构建成功

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/web/src/components/chat/SubagentBatchCard.tsx CPH-PI/web/src/components/chat/SubagentBatchCard.module.css CPH-PI/web/src/components/chat/ToolCard.tsx
git commit -m "feat(web): add SubagentBatchCard with live CoT and report previews"
```

---

### Task 6: 顶栏谱系导航、中央聚焦与只读 Composer 保护 (P7)

**Files:**
- Create: `CPH-PI/web/src/components/chat/SubagentHeaderLineage.tsx`
- Create: `CPH-PI/web/src/components/chat/SubagentHeaderLineage.module.css`
- Create: `CPH-PI/web/src/components/chat/SubagentReadOnlyComposer.tsx`
- Create: `CPH-PI/web/src/components/chat/SubagentReadOnlyComposer.module.css`
- Modify: `CPH-PI/web/src/components/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `store.focusedSubagentId`, `store.subagentsMap`, `store.setFocusedSubagentId`
- Produces: 顶栏树形下拉菜单；中央主视窗在 `focusedSubagentId` 激活时只显示该子代理的专属流，并将底部输入框替换为 `SubagentReadOnlyComposer`

- [ ] **Step 1: 创建 `SubagentHeaderLineage.tsx` 及样式**

1:1 移植 DeepSeek-Harness 谱系下拉树：
- 顶栏显示 `[主任务 (Gen 1)] / [N 个子代理 ● 运行中 ▾]`；
- 点击展开浮层 `role="tree"`，列出各子代理的耗时、状态指示灯、账号与角色；
- 点击子代理即可快速聚焦，支持一键在侧栏打开。

- [ ] **Step 2: 创建 `SubagentReadOnlyComposer.tsx` 及样式**

提示条：`“当前处于子代理 (Sub-X) 只读检查模式。主会话正在等待汇总... [点击返回主会话]”`。

- [ ] **Step 3: 在 `ChatView.tsx` 中接驳**

- 在 `chatHeader` 插入 `<SubagentHeaderLineage />`；
- 如果 `focusedSubagentId` 存在：
  - 中央渲染该子代理的专属思考流与工具流水线；
  - 底部挂载 `<SubagentReadOnlyComposer onBack={() => setFocusedSubagentId(null)} />`；
- 否则正常渲染主会话聊天流与活动 Composer。

- [ ] **Step 4: 构建验证**

运行: `cd "e:\copilot-web proxy\CPH-PI\web" && bun run build`
预期: 0 错误构建成功

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/web/src/components/chat/SubagentHeaderLineage.tsx CPH-PI/web/src/components/chat/SubagentHeaderLineage.module.css CPH-PI/web/src/components/chat/SubagentReadOnlyComposer.tsx CPH-PI/web/src/components/chat/SubagentReadOnlyComposer.module.css CPH-PI/web/src/components/chat/ChatView.tsx
git commit -m "feat(web): add SubagentHeaderLineage, focus switching, and read-only composer"
```

---

### Task 7: 右侧栏并排抽屉比对面板 (`SubagentInspector`) (P7)

**Files:**
- Create: `CPH-PI/web/src/components/panels/SubagentInspector.tsx`
- Create: `CPH-PI/web/src/components/panels/SubagentInspector.module.css`
- Modify: `CPH-PI/web/src/components/layout/Rightbar.tsx`
- Modify: `CPH-PI/web/src/App.tsx`

**Interfaces:**
- Consumes: `store.activeRightbarTab`, `store.activeSubagentAsideId`, `store.subagentsMap`
- Produces: 右侧栏第 6 个 Tab `subagent`，在不跳出主会话的情况下左右双屏实时监视指定子代理

- [ ] **Step 1: 编写 `SubagentInspector.tsx` 及样式**

展示选中子代理的：
- 角色、账号、状态、运行耗时；
- 完整展开的思考过程（CoT）；
- 内部工具调用链及控制台输出；
- 最终成果报告 Markdown 完整渲染与复制按钮。

- [ ] **Step 2: 联动 `Rightbar.tsx` 与 `App.tsx`**

- 在 `Rightbar.tsx` 的 Tabs 列表中注册第 6 项：`{ id: 'subagent', label: '子代理', icon: Bot }`（当 `activeSubagentAsideId` 存在时自动高亮激活）；
- 在 `App.tsx` 的面板条件渲染中增加：
  ```tsx
  {activeRightbarTab === 'subagent' && <SubagentInspector />}
  ```

- [ ] **Step 3: 构建验证**

运行: `cd "e:\copilot-web proxy\CPH-PI\web" && bun run build`
预期: 0 错误构建成功

- [ ] **Step 4: 提交代码**

```bash
git add CPH-PI/web/src/components/panels/SubagentInspector.tsx CPH-PI/web/src/components/panels/SubagentInspector.module.css CPH-PI/web/src/components/layout/Rightbar.tsx CPH-PI/web/src/App.tsx
git commit -m "feat(web): add SubagentInspector side-by-side drawer in Rightbar"
```

---

### Task 8: Handoff 阶段接力桩卡片、指标真实化与端到端回归验证 (P8 & P9)

**Files:**
- Create: `CPH-PI/web/src/components/chat/HandoffAnchorCard.tsx`
- Create: `CPH-PI/web/src/components/chat/HandoffAnchorCard.module.css`
- Modify: `CPH-PI/web/src/components/chat/ChatView.tsx`
- Modify: `CPH-PI/src/web/rpc-handler.ts` (清理 `tps: 42`)

**Interfaces:**
- Consumes: `session:handoff` 事件负载、真实的 `durationMs`
- Produces: 聊天流无刷新插入 `HandoffAnchorCard`；清理硬编码的 `tps: 42`

- [ ] **Step 1: 编写 `HandoffAnchorCard.tsx` 及样式**

- 细线贯穿卡片，展示 `🔄 会话安全阶段接力桩 · 代际跃迁: Gen X ➔ Gen Y`；
- 显示交接文档文件路径与备忘录摘要折叠块；
- 提示用户直接在底部继续输入下一阶段指令。

- [ ] **Step 2: 在 `ChatView.tsx` 中挂载接力桩**

根据当前会话历史中的 Handoff 事件，在对应的 Turn 之间无缝渲染 `<HandoffAnchorCard />`。

- [ ] **Step 3: 清理 `rpc-handler.ts` 中的假指标**

移除硬编码的 `tps: 42`，改为真实根据文本 chunk 数量计算或直接省略。

- [ ] **Step 4: 全量测试与构建回归**

运行:
```bash
bun test
npm run web:build
```
预期:
- 后端测试通过率保持 100% (770+ pass, 0 fail)；
- 前端 bundle 构建 0 错误。

- [ ] **Step 5: 提交代码**

```bash
git add CPH-PI/web/src/components/chat/HandoffAnchorCard.tsx CPH-PI/web/src/components/chat/HandoffAnchorCard.module.css CPH-PI/web/src/components/chat/ChatView.tsx CPH-PI/src/web/rpc-handler.ts
git commit -m "feat(web): add HandoffAnchorCard and clean up hardcoded tps metrics"
```

