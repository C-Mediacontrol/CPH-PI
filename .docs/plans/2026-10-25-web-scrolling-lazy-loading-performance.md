# Web 前端全滚动区域视口懒加载与渲染性能优化实施计划 (Web Scrolling Lazy-Loading Performance Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建零外部依赖的原生双重加速与三维立体懒加载体系，彻底根治主会话长消息流、子代理执行链、ToolCard 超长输出及 WAL 账本等滚动区域的 DOM 膨胀与卡顿，保障流畅滚动与流式吸底。

**Architecture:** 
1. **浏览器底层跳过**: CSS `content-visibility: auto` + `contain-intrinsic-size`，原生跳过离屏重排与重绘。
2. **React 视口感知卸载**: `useIntersectionObserver` Hook 提供 250px 预加载缓冲区；`LazyViewportItem` 在离屏时仅保留极轻量骨架卡片并释放内部重度 DOM，对流式打字与最新轮次施加 `forceActive: true` 常驻保护。
3. **超长内容智能截断**: `LazyTextCollapse` 组件对 >35 行或 >1800 字符的日志/Diff 进行首屏 30 行截断展示，提供展开全部与复制全文操作；`ToolCard` 成功完成后默认适度收起。
4. **渐进式分批渲染**: `LedgerWALViewer` 采用 `visibleCount` 分批分页与单项视口懒加载；`Sidebar` 会话列表应用 `content-visibility: auto`。

**Tech Stack:** React 18, TypeScript, CSS Modules, Modern CSS (`content-visibility`, `contain-intrinsic-size`), Web IntersectionObserver API, Vite, Bun Test.

## Global Constraints

- **AGENTS.md Rule 1 (Harness Neutrality & Root Isolation):** 所有代码、测试与文档改动均位于 `CPH-PI/` 目录下，工作区根目录零文件写入。
- **AGENTS.md Rule 3 (Constructive Guidance):** 全程贯彻建设性正向引导，杜绝使用负面禁止词。
- **AGENTS.md Rule 5 (Workspace Packaging):** 专注于当前工作区内部演进，隔离并保护用户全局配置。
- **AGENTS.md Rule 9 (Full Attachment Fidelity):** 文本复制操作始终复制完整原始数据，保持原始数据保真。

---

## 冲击面扫描（Impact Surface Scan）

| 制品类型 | ⬆️ 上游（生产方） | ⬇️ 下游（消费方） | 应对策略 |
|---|---|---|---|
| **视口 Hook: `useIntersectionObserver`** | DOM 容器 Ref | `LazyViewportItem` | 预加载缓冲区配置为 `rootMargin: '250px 0px'`；支持 `disabled` 参数以在流式打字时强制常驻激活。 |
| **容器组件: `LazyViewportItem`** | React 节点树 | `ChatView`, `ToolCard`, `LedgerWALViewer` | 离屏展示 `fallbackHeight` 占位框；命中 `forceActive` 或进入视口时挂载完整子组件；配合 CSS `contain-intrinsic-size` 防止滚动条跳动。 |
| **截断组件: `LazyTextCollapse`** | 长文本/Diff/stdout | `ToolCard`, 子代理动作列表 | 超过 35 行或 1800 字符时切片展示前 30 行；复制操作穿透复制完整文本。 |
| **主消息流: `ChatView`** | Store `turns`, `subagentsMap` | 界面滚动流 | 最新轮次或 `status === 'streaming'` 消息强制激活；用户向上滚动时保持阅读位置，在底部时平滑自动吸底。 |
| **工具卡片: `ToolCard`** | `tool.status`, `tool.output` | 卡片渲染 | `running` 与 `failed` 状态保持展开；`completed` 状态默认折叠或适度摘要；输出由 `LazyTextCollapse` 托管。 |
| **预写账本: `LedgerWALViewer`** | Store `ledgerEntries` | 抽屉面板列表 | 初始渲染前 35 条，触底自动追加 `visibleCount += 35`，每个条目包裹 `LazyViewportItem`。 |

---

## Agent-Friendly Slicing 矩阵

| Task | 专注文件 | 对应测试与验证 | 提交规范 |
|---|---|---|---|
| **Task 1** | `useIntersectionObserver.ts`, `LazyViewportItem.tsx`, `base.css` | `tests/web/lazy-viewport-observer.test.ts` | 独立 Commit |
| **Task 2** | `LazyTextCollapse.tsx`, `ToolCard.tsx` | `tests/web/lazy-text-collapse.test.ts` | 独立 Commit |
| **Task 3** | `ChatView.tsx`, `ChatView.module.css` | `tests/web/chat-view-lazy-integration.test.ts` | 独立 Commit |
| **Task 4** | `LedgerWALViewer.tsx`, `Sidebar.tsx` | `tests/web/ledger-viewer-lazy.test.ts` | 独立 Commit |
| **Task 5** | `CHANGE-REQUEST.md`, 全量回归与构建 | `bun test` (全仓) + `npm run web:build` | 独立 Commit |

---

## File Structure

- **新增文件**:
  - `CPH-PI/web/src/hooks/useIntersectionObserver.ts`: 视口监听通用 Hook
  - `CPH-PI/web/src/components/common/LazyViewportItem.tsx`: 视口懒挂载容器组件
  - `CPH-PI/web/src/components/common/LazyViewportItem.module.css`: 视口容器与占位骨架样式
  - `CPH-PI/web/src/components/common/LazyTextCollapse.tsx`: 超长文本智能截断折叠组件
  - `CPH-PI/web/src/components/common/LazyTextCollapse.module.css`: 截断条与按钮操作样式
  - `CPH-PI/tests/web/lazy-viewport-observer.test.ts`: Hook 与视口挂载逻辑测试
  - `CPH-PI/tests/web/lazy-text-collapse.test.ts`: 智能文本截断与复制测试
  - `CPH-PI/tests/web/tool-card-lazy.test.ts`: 工具卡片折叠策略与长输出测试
  - `CPH-PI/tests/web/chat-view-lazy-integration.test.ts`: 消息流懒加载与流式常驻保护测试
  - `CPH-PI/tests/web/ledger-viewer-lazy.test.ts`: WAL 账本分批渲染测试
- **修改文件**:
  - `CPH-PI/web/src/styles/base.css`: 注入 `content-visibility` 与占位规范辅助样式
  - `CPH-PI/web/src/components/chat/ToolCard.tsx`: 接入 `LazyTextCollapse` 并优化默认展开策略
  - `CPH-PI/web/src/components/chat/ToolCard.module.css`: 工具卡片滚动与最大高度样式
  - `CPH-PI/web/src/components/chat/ChatView.tsx`: 消息轮次与子代理视窗接入 `LazyViewportItem`，保障流式吸底
  - `CPH-PI/web/src/components/chat/ChatView.module.css`: 滚动容器性能样式
  - `CPH-PI/web/src/components/panels/LedgerWALViewer.tsx`: 接入分批渲染与 `LazyViewportItem`
  - `CPH-PI/web/src/components/layout/Sidebar.tsx`: 会话列表添加 `content-visibility: auto`
  - `CPH-PI/.docs/CHANGE-REQUEST.md`: 登记 `CR-2026-10-25-01`

---

### Task 1: 底层视口感知 Hook 与基础容器组件 (`useIntersectionObserver` & `LazyViewportItem`)

**Files:**
- Create: `CPH-PI/web/src/hooks/useIntersectionObserver.ts`
- Create: `CPH-PI/web/src/components/common/LazyViewportItem.tsx`
- Create: `CPH-PI/web/src/components/common/LazyViewportItem.module.css`
- Modify: `CPH-PI/web/src/styles/base.css`
- Test: `CPH-PI/tests/web/lazy-viewport-observer.test.ts`

**Interfaces:**
- Produces:
  - `useIntersectionObserver(targetRef, options)`: 返回 `boolean` 视口状态
  - `LazyViewportItem`: React 组件，接受 `fallbackHeight`, `forceActive`, `children`
  - `base.css`: 包含 `.contentVisibilityAuto` 实用样式

- [x] **Step 1: 编写失败测试 `tests/web/lazy-viewport-observer.test.ts`**

测试 `useIntersectionObserver` 在离屏与在屏时的状态切换，以及 `disabled`（强制激活）模式：

```typescript
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("1. useIntersectionObserver & LazyViewportItem (Task 1)", () => {
  const root = path.resolve(__dirname, "../../");

  it("should export useIntersectionObserver hook with disabled and rootMargin options", () => {
    const hookPath = path.join(root, "web/src/hooks/useIntersectionObserver.ts");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf8");
    expect(content).toContain("useIntersectionObserver");
    expect(content).toContain("rootMargin");
    expect(content).toContain("disabled");
    expect(content).toContain("IntersectionObserver");
  });

  it("should export LazyViewportItem component with fallbackHeight and forceActive props", () => {
    const compPath = path.join(root, "web/src/components/common/LazyViewportItem.tsx");
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, "utf8");
    expect(content).toContain("LazyViewportItem");
    expect(content).toContain("fallbackHeight");
    expect(content).toContain("forceActive");
    expect(content).toContain("contentVisibility");
  });

  it("should declare content-visibility utility rules in base.css", () => {
    const cssPath = path.join(root, "web/src/styles/base.css");
    const content = fs.readFileSync(cssPath, "utf8");
    expect(content).toContain("content-visibility: auto");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/lazy-viewport-observer.test.ts`
预期: FAIL，因对应文件尚不存在。

- [x] **Step 3: 实现 `useIntersectionObserver.ts`、`LazyViewportItem.tsx` 与 `base.css`**

1. 编写 `web/src/hooks/useIntersectionObserver.ts`：
   - 处理 SSR/无 DOM 环境优雅降级（若 `IntersectionObserver` 不存在则默认返回 `true`）；
   - 支持 `disabled: true` 时直接返回 `true`；
   - 在 `useEffect` 返回 `disconnect()` 清理。
2. 编写 `web/src/components/common/LazyViewportItem.tsx` 及 `.module.css`：
   - 包含 `contentVisibility: 'auto'` 与 `containIntrinsicSize` 内联样式；
   - 处于可视区或 `forceActive === true` 时渲染真实 `children`；离屏时渲染骨架占位 `div`。
3. 在 `web/src/styles/base.css` 中追加 `.contentVisibilityAuto` 辅助类。

- [x] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/lazy-viewport-observer.test.ts`
预期: PASS。

- [x] **Step 5: 提交代码**

```powershell
git add CPH-PI/web/src/hooks/useIntersectionObserver.ts CPH-PI/web/src/components/common/LazyViewportItem.tsx CPH-PI/web/src/components/common/LazyViewportItem.module.css CPH-PI/web/src/styles/base.css CPH-PI/tests/web/lazy-viewport-observer.test.ts
git commit -m "feat(web): implement useIntersectionObserver hook and LazyViewportItem container (Task 1)"
```

---

### Task 2: 超长文本智能截断组件与工具卡片治理 (`LazyTextCollapse` & `ToolCard`)

**Files:**
- Create: `CPH-PI/web/src/components/common/LazyTextCollapse.tsx`
- Create: `CPH-PI/web/src/components/common/LazyTextCollapse.module.css`
- Modify: `CPH-PI/web/src/components/chat/ToolCard.tsx`
- Modify: `CPH-PI/web/src/components/chat/ToolCard.module.css`
- Test: `CPH-PI/tests/web/lazy-text-collapse.test.ts`
- Test: `CPH-PI/tests/web/tool-card-lazy.test.ts`

**Interfaces:**
- Consumes: Task 1 的组件模式
- Produces:
  - `LazyTextCollapse`: 对长文本在 >35 行或 >1800 字符时切片，提供展开与无损复制
  - `ToolCard`: 优化展开逻辑（`running` 与 `failed` 展开，`completed` 默认摘要），输出与 Diff 接入 `LazyTextCollapse`

- [x] **Step 1: 编写失败测试**

测试 `LazyTextCollapse` 截断逻辑、展开/收起切换与复制完整文本逻辑；测试 `ToolCard` 默认状态分流：

```typescript
describe("2. LazyTextCollapse & ToolCard Strategy (Task 2)", () => {
  it("should implement LazyTextCollapse with maxLines, maxChars and copyable", () => {
    const compPath = path.join(root, "web/src/components/common/LazyTextCollapse.tsx");
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, "utf8");
    expect(content).toContain("LazyTextCollapse");
    expect(content).toContain("maxLines");
    expect(content).toContain("maxChars");
    expect(content).toContain("navigator.clipboard");
  });

  it("should integrate LazyTextCollapse in ToolCard and optimize default expanded state", () => {
    const cardPath = path.join(root, "web/src/components/chat/ToolCard.tsx");
    const content = fs.readFileSync(cardPath, "utf8");
    expect(content).toContain("LazyTextCollapse");
    // Completed status should not blindly default expand every output
    expect(content).not.toMatch(/defaultExpanded\s*:\s*tool\.status\s*===\s*'running'\s*\|\|\s*Boolean\(tool\.output\s*\|\|\s*tool\.diff\)/);
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/lazy-text-collapse.test.ts tests/web/tool-card-lazy.test.ts`
预期: FAIL。

- [x] **Step 3: 实现 `LazyTextCollapse` 并重构 `ToolCard`**

1. 编写 `web/src/components/common/LazyTextCollapse.tsx` 及样式；
2. 在 `ToolCard.tsx` 中：
   - 默认展开逻辑优化：
     ```typescript
     const [expanded, setExpanded] = useState<boolean>(
       defaultExpanded !== undefined
         ? defaultExpanded
         : tool.status === 'running' || tool.status === 'failed'
     );
     ```
   - 在 `renderDiff` 中如果 lines > 40 使用 `LazyTextCollapse` 包裹；
   - 工具 `tool.output` 渲染接入 `<LazyTextCollapse text={tool.output} maxLines={35} maxChars={1800} />`。

- [x] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/lazy-text-collapse.test.ts tests/web/tool-card-lazy.test.ts`
预期: PASS。

- [x] **Step 5: 提交代码**

```powershell
git add CPH-PI/web/src/components/common/LazyTextCollapse.tsx CPH-PI/web/src/components/common/LazyTextCollapse.module.css CPH-PI/web/src/components/chat/ToolCard.tsx CPH-PI/web/src/components/chat/ToolCard.module.css CPH-PI/tests/web/lazy-text-collapse.test.ts CPH-PI/tests/web/tool-card-lazy.test.ts
git commit -m "feat(web): implement LazyTextCollapse component and optimize ToolCard rendering (Task 2)"
```

---

### Task 3: 主会话消息流与子代理视窗视口懒加载 (`ChatView`)

**Files:**
- Modify: `CPH-PI/web/src/components/chat/ChatView.tsx`
- Modify: `CPH-PI/web/src/components/chat/ChatView.module.css`
- Test: `CPH-PI/tests/web/chat-view-lazy-integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LazyViewportItem` 与 Task 2 的 `LazyTextCollapse`
- Produces: 
  - `ChatView`: 主消息轮次 `turnItem` 全部包裹 `LazyViewportItem`
  - 流式打字与吸底保护：`isLatest || isStreaming` 触发 `forceActive={true}`
  - 子代理独立聚焦流（`focusedStageContainer`）：动作列表与报告预览视口懒加载

- [x] **Step 1: 编写测试 `tests/web/chat-view-lazy-integration.test.ts`**

测试 `ChatView` 接入 `LazyViewportItem`，并且明确断言 `forceActive` 保护机制：

```typescript
describe("3. ChatView Lazy Integration & Streaming Invariant (Task 3)", () => {
  it("should wrap turns inside LazyViewportItem with forceActive for streaming and latest turn", () => {
    const chatPath = path.join(root, "web/src/components/chat/ChatView.tsx");
    const content = fs.readFileSync(chatPath, "utf8");
    expect(content).toContain("LazyViewportItem");
    expect(content).toContain("forceActive");
    expect(content).toContain("fallbackHeight");
  });

  it("should wrap subagent actions inside LazyViewportItem in focused subagent stage", () => {
    const chatPath = path.join(root, "web/src/components/chat/ChatView.tsx");
    const content = fs.readFileSync(chatPath, "utf8");
    expect(content).toContain("focusedSub.actions");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/chat-view-lazy-integration.test.ts`
预期: FAIL。

- [x] **Step 3: 在 `ChatView.tsx` 中接入 `LazyViewportItem` 并增强流式吸底**

1. 引入 `LazyViewportItem`；
2. 在 `turns.map((turn, index))` 中包裹每个消息项；
3. 计算 `isLatest`, `isStreaming`, `forceActive` 与 `fallbackHeight`；
4. 在 `focusedSub.actions.map` 中包裹每个 `actionItem`；
5. 在 `ChatView.module.css` 的 `.scrollArea` 添加 `content-visibility` 与平滑滚动属性。

- [x] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/chat-view-lazy-integration.test.ts`
预期: PASS。

- [x] **Step 5: 提交代码**

```powershell
git add CPH-PI/web/src/components/chat/ChatView.tsx CPH-PI/web/src/components/chat/ChatView.module.css CPH-PI/tests/web/chat-view-lazy-integration.test.ts
git commit -m "feat(web): integrate LazyViewportItem into ChatView turns and subagent stage (Task 3)"
```

---

### Task 4: 侧边抽屉面板渐进式分批与全局样式 (`LedgerWALViewer` & `Sidebar`)

**Files:**
- Modify: `CPH-PI/web/src/components/panels/LedgerWALViewer.tsx`
- Modify: `CPH-PI/web/src/components/layout/Sidebar.tsx`
- Modify: `CPH-PI/web/src/components/panels/LedgerWALViewer.module.css`
- Modify: `CPH-PI/web/src/components/layout/Sidebar.module.css`
- Test: `CPH-PI/tests/web/ledger-viewer-lazy.test.ts`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的通用能力
- Produces:
  - `LedgerWALViewer`: 采用 `visibleCount` 分批展示（默认 35 条，触底追加），条目包裹 `LazyViewportItem`
  - `Sidebar`: 历史会话列表采用 `content-visibility: auto`，避免百级列表重排阻塞

- [x] **Step 1: 编写测试 `tests/web/ledger-viewer-lazy.test.ts`**

测试 `LedgerWALViewer` 的渐进式批次渲染与 `Sidebar` 的 CSS 优化：

```typescript
describe("4. LedgerWALViewer Batching & Sidebar Optimization (Task 4)", () => {
  it("should implement visibleCount progressive batching in LedgerWALViewer", () => {
    const walPath = path.join(root, "web/src/components/panels/LedgerWALViewer.tsx");
    const content = fs.readFileSync(walPath, "utf8");
    expect(content).toContain("visibleCount");
    expect(content).toContain("LazyViewportItem");
  });

  it("should declare content-visibility on sessionList in Sidebar.module.css", () => {
    const sideCssPath = path.join(root, "web/src/components/layout/Sidebar.module.css");
    const content = fs.readFileSync(sideCssPath, "utf8");
    expect(content).toContain("content-visibility");
  });
});
```

- [x] **Step 2: 运行测试验证失败**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/ledger-viewer-lazy.test.ts`
预期: FAIL。

- [x] **Step 3: 在 `LedgerWALViewer` 与 `Sidebar` 中实现优化**

1. `LedgerWALViewer.tsx`:
   - 增加 `const [visibleCount, setVisibleCount] = useState<number>(35);`
   - 切片展示 `filteredEntries.slice(0, visibleCount)`；
   - 底部提供触底无限滚动侦测或「加载更多」按钮；
   - 每个条目包裹 `LazyViewportItem fallbackHeight={52}`。
2. `Sidebar.module.css`:
   - 在 `.sessionList` 与 `.sessionItem` 中添加 `content-visibility: auto` 与 `contain-intrinsic-size: auto 36px`。

- [x] **Step 4: 运行测试验证通过**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test tests/web/ledger-viewer-lazy.test.ts`
预期: PASS。

- [x] **Step 5: 提交代码**

```powershell
git add CPH-PI/web/src/components/panels/LedgerWALViewer.tsx CPH-PI/web/src/components/panels/LedgerWALViewer.module.css CPH-PI/web/src/components/layout/Sidebar.tsx CPH-PI/web/src/components/layout/Sidebar.module.css CPH-PI/tests/web/ledger-viewer-lazy.test.ts
git commit -m "feat(web): implement progressive batching in LedgerWALViewer and optimize Sidebar (Task 4)"
```

---

### Task 5: 全量回归验证、构建编译与变更文档归档

**Files:**
- Modify: `CPH-PI/.docs/CHANGE-REQUEST.md`
- Verify: Full Test Suite (`bun test`), Web Production Build (`npm run web:build`)

- [x] **Step 1: 运行前端生产编译**

运行: `cd "E:\copilot-web proxy\CPH-PI\web"; npm run build`
预期: Vite 构建无报错，TypeScript 0 类型错误。

- [x] **Step 2: 运行全仓单元与集成测试**

运行: `cd "E:\copilot-web proxy\CPH-PI"; bun test`
预期: 全仓现有测试与新增测试 100% PASS，0 失败。

- [x] **Step 3: 登记变更文档 `CPH-PI/.docs/CHANGE-REQUEST.md`**

追加 `CR-2026-10-25-01` 变更记录，说明滚动懒加载、智能长文本截断与渲染性能优化交付。

- [x] **Step 4: 最终提交**

```powershell
git add CPH-PI/.docs/CHANGE-REQUEST.md
git commit -m "docs: finalize CR-2026-10-25-01 implementation and full verification"
```

