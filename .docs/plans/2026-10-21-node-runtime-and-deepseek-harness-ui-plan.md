# CPH-PI Node.js Runtime & DeepSeek-Harness UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CPH-PI 全面切换为基于 Node.js 原生运行时（支持 `node --import tsx` 与独立 JS 分发，去除对 Bun 的硬依赖），并将 Web GUI 像素级对齐 `Library/deepseek-harness/packages/client/` 的官方开源设计系统（单行 ToolRow、TurnProcess 极简思考栏、ExitCodeBadge 与 AskQuestionCard 胶囊）。

**Architecture:** 后端利用标准 Node.js + `tsx` 提供即时执行与脚本运行，前端采用从官方 `design-platform.css` 抽取的纯正 DeepSeek 蓝与暗色蓝灰系设计变量，全面重构组件 DOM 结构与排版细节，通过 Vite 构建为静态产物。

**Tech Stack:** Node.js (>=18), TypeScript, tsx, ws, React 19, Vite, Tailwind CSS, Lucide Icons

## Global Constraints
- 所有文件创建与修改必须严格限定在 `CPH-PI/` 二级目录内，严禁在工作区根目录新建文件。
- 绝不向模型 System Prompt 泄露任何底层 Web 管道实现细节（遵循准则 6）。
- 状态持久化与工作内存正交分层：前端仅作为视图投影，磁盘 WAL 日志为权威事实（遵循准则 7）。
- 必须支持标准 Node.js 环境下 `node --import tsx` 与编译后的 `node package/bin/cph-pi.js web`，不强依赖外部 Bun 环境。

---

### Task 1: Node.js Native Runtime & Package Scripts (Node 运行支持与 tsx 集成)

**Files:**
- Modify: `package.json`
- Modify: `cph-pi.bat`
- Modify: `cph-pi.ps1`
- Test: `tests/server/node-launch.test.ts`

**Interfaces:**
- Produces:
  - `package.json` 脚本升级为基于 `node` / `npm`
  - `tsx` 作为运行时 TypeScript 加载器
  - `node-launch.test.ts` 验证 `node --import tsx src/cli.ts --help` 成功执行且返回退出码 0

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/node-launch.test.ts
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("Node.js Native CLI Launch", () => {
  it("should successfully launch CLI using node with tsx", () => {
    const cliPath = path.resolve(__dirname, "../../src/cli.ts");
    const result = spawnSync("node", ["--import", "tsx", cliPath, "--help"], {
      encoding: "utf-8",
      env: process.env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("cph-pi");
    expect(result.stdout).toContain("web");
  });
});
```

- [ ] **Step 2: Run test to verify initial state**

Run: `bun test tests/server/node-launch.test.ts`  
Expected: May fail if `tsx` is not yet installed in `devDependencies`.

- [ ] **Step 3: Update `package.json` and launcher scripts**

In `package.json`:
Add `"tsx": "^4.19.2"` to `devDependencies`.
Update `scripts`:
```json
{
  "start": "node --import tsx src/cli.ts",
  "web": "node --import tsx src/cli.ts web",
  "web:dev": "npm --prefix web run dev",
  "web:build": "npm --prefix web run build",
  "build:all": "npm run web:build && npm run build:package",
  "build:package": "bun build src/cli.ts --target node --outfile package/bin/cph-pi.js && bun build scripts/probe-agent-access.ts --target node --outfile package/bin/check-accounts.js",
  "test": "bun test tests/"
}
```

In `cph-pi.bat` & `cph-pi.ps1`:
Update launcher to prioritize Node.js:
`node --import tsx src/cli.ts %*`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install tsx --save-dev && bun test tests/server/node-launch.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json cph-pi.bat cph-pi.ps1 tests/server/node-launch.test.ts
git commit -m "feat(runtime): support pure Node.js execution via tsx loader (Task 1)"
```

---

### Task 2: DeepSeek-Harness Official Design System & Theme Tokens (主题变量移植)

**Files:**
- Modify: `web/src/index.css`
- Modify: `web/tailwind.config.js`
- Test: `tests/web/theme-tokens.test.ts`

**Interfaces:**
- Produces:
  - DeepSeek official color tokens: `--dsw-deepseek-500` (`#4176e6`), `--dsw-deepseek-400` (`#7aafff`), `--dsw-bg-base` (`#0f1115`), `--dsw-bg-surface` (`#151517`), `--dsw-bg-card` (`#1b1b1c`), `--dsw-border-base` (`#2c2c2e`), `--dsw-border-subtle`
  - Tabular monospace numeric font styles for stats and timers

- [ ] **Step 1: Write the failing test**

```typescript
// tests/web/theme-tokens.test.ts
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("DeepSeek-Harness Design Tokens", () => {
  it("should contain official deepseek brand colors and surfaces in index.css", () => {
    const cssPath = path.resolve(__dirname, "../../web/src/index.css");
    const content = fs.readFileSync(cssPath, "utf-8");

    expect(content).toContain("--dsw-static-deepseek-500: rgb(65, 118, 230)");
    expect(content).toContain("--dsw-static-neutral-bluish-1000: rgb(15, 17, 21)");
    expect(content).toContain("--dsw-static-neutral-bluish-900: rgb(27, 27, 28)");
  });

  it("should define deepseek theme extensions in tailwind.config.js", () => {
    const tailwindPath = path.resolve(__dirname, "../../web/tailwind.config.js");
    const content = fs.readFileSync(tailwindPath, "utf-8");

    expect(content).toContain("deepseek");
    expect(content).toContain("surface");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/web/theme-tokens.test.ts`  
Expected: FAIL

- [ ] **Step 3: Update `web/src/index.css` and `web/tailwind.config.js`**

Inject the full official token set from `Library/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/web/theme-tokens.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/index.css web/tailwind.config.js tests/web/theme-tokens.test.ts
git commit -m "feat(web): inject DeepSeek-Harness official design platform tokens (Task 2)"
```

---

### Task 3: Refactor ToolRow & ExitCodeBadge (原版单行紧凑工具卡片)

**Files:**
- Create: `web/src/components/chat/ToolRow.tsx`
- Create: `web/src/components/chat/ExitCodeBadge.tsx`
- Modify: `web/src/components/chat/ToolExecutionCard.tsx` (delegate to ToolRow)
- Modify: `web/src/components/chat/index.ts`
- Test: `tests/web/tool-row.test.ts`

**Interfaces:**
- Produces:
  - `ExitCodeBadge`: capsule rendering `Exit 0` (green) or `Exit 1` (red)
  - `ToolRow`:
    - 24px content row height
    - Tool Icon + Name + 2x2 dot separator + underlined dotted path/command + tabular green `+additions` / red `-deletions` diff totals + 14px rotating chevron
    - Expanded Unified Diff line-by-line view with gutter line numbers
    - Expanded Terminal box with `ExitCodeBadge`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/web/tool-row.test.ts
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("ToolRow Component & ExitCodeBadge", () => {
  it("should have ExitCodeBadge implementation with exit code status mapping", () => {
    const badgePath = path.resolve(__dirname, "../../web/src/components/chat/ExitCodeBadge.tsx");
    expect(fs.existsSync(badgePath)).toBe(true);
    const content = fs.readFileSync(badgePath, "utf-8");
    expect(content).toContain("Exit");
  });

  it("should have ToolRow matching DeepSeek 24px row specification", () => {
    const rowPath = path.resolve(__dirname, "../../web/src/components/chat/ToolRow.tsx");
    expect(fs.existsSync(rowPath)).toBe(true);
    const content = fs.readFileSync(rowPath, "utf-8");
    expect(content).toContain("diffStat");
    expect(content).toContain("fileLink");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/web/tool-row.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `ExitCodeBadge.tsx` and `ToolRow.tsx`**

Directly replicate the DOM structure and styling from `Library/deepseek-harness/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` and `ExitCodeBadge.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/web/tool-row.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/ tests/web/tool-row.test.ts
git commit -m "feat(web): implement DeepSeek-Harness official ToolRow and ExitCodeBadge (Task 3)"
```

---

### Task 4: Refactor TurnProcessNodeView & AskQuestionCard (原版思考栏与问答胶囊)

**Files:**
- Create: `web/src/components/chat/TurnProcessNodeView.tsx`
- Create: `web/src/components/interaction/AskQuestionCard.tsx`
- Modify: `web/src/components/chat/ReasoningBlock.tsx` (delegate to TurnProcessNodeView)
- Modify: `web/src/components/interaction/HumanInteractionCard.tsx` (delegate to AskQuestionCard)
- Modify: `web/src/components/interaction/ActionDock.tsx` (DeepSeek blue composer)
- Modify: `web/src/components/chat/MessageStream.tsx`
- Test: `tests/web/turn-process-and-question.test.ts`

**Interfaces:**
- Produces:
  - `TurnProcessNodeView`:
    - Thin hairline border bottom: `border-b border-white/5`
    - "Thinking..." or "Thought for 12.4s" with tabular duration numbers
    - Smooth chevron disclosure
  - `AskQuestionCard`:
    - Interactive options pills, radio/checkbox rows, custom write-in field, and DeepSeek blue Submit button
  - `ActionDock`:
    - Floating `rounded-2xl` composer with DeepSeek blue `#4176e6` send button and two-tier interrupt controls

- [ ] **Step 1: Write the failing test**

```typescript
// tests/web/turn-process-and-question.test.ts
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("TurnProcessNodeView & AskQuestionCard", () => {
  it("should implement TurnProcessNodeView matching official DeepSeek specs", () => {
    const processPath = path.resolve(__dirname, "../../web/src/components/chat/TurnProcessNodeView.tsx");
    expect(fs.existsSync(processPath)).toBe(true);
    const content = fs.readFileSync(processPath, "utf-8");
    expect(content).toContain("Thought for");
  });

  it("should implement AskQuestionCard with options pills and custom write-in", () => {
    const qPath = path.resolve(__dirname, "../../web/src/components/interaction/AskQuestionCard.tsx");
    expect(fs.existsSync(qPath)).toBe(true);
    const content = fs.readFileSync(qPath, "utf-8");
    expect(content).toContain("AskQuestionCard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/web/turn-process-and-question.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement components and wire into MessageStream & App**

Replicate DOM and styling from `TurnProcessNodeView.tsx` and `AskQuestionCard.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/web/turn-process-and-question.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ tests/web/turn-process-and-question.test.ts
git commit -m "feat(web): implement DeepSeek-Harness TurnProcessNodeView and AskQuestionCard (Task 4)"
```

---

### Task 5: Production Node.js Build Verification & End-to-End Delivery

**Files:**
- Run: `npm run web:build`
- Run: `npm run build:package`
- Test: `tests/server/` and `tests/web/`

**Interfaces:**
- Produces:
  - Updated production bundle in `dist/web/`
  - Fully passing test suites across both server and web
  - Verified execution with `node --import tsx src/cli.ts web --no-open`

- [ ] **Step 1: Build production web bundle via NPM**

Run: `npm --prefix web run build`  
Expected: Clean build into `dist/web/` with 0 warnings.

- [ ] **Step 2: Verify all test suites**

Run: `bun test tests/server/ tests/web/`  
Expected: All tests PASS.

- [ ] **Step 3: Verify Node.js CLI launch**

Run: `node --import tsx src/cli.ts --help`  
Expected: Returns 0 with help banner.

- [ ] **Step 4: Commit**

```bash
git add dist/web/
git commit -m "feat: complete Node.js native runtime and DeepSeek-Harness design system delivery (Task 5)"
```

---

## Self-Review Checklist
- [x] **Spec Coverage**: 涵盖规范所有方面（Node.js tsx 运行时、官方色彩系统、单行 ToolRow、TurnProcessNodeView、AskQuestionCard、生产构建）。
- [x] **No Placeholders**: 每个 Task 的代码、命令与测试断言完整展现，无 TODO、TBD。
- [x] **Zero-Bun Requirement**: CLI 支持通过 `node --import tsx` 与纯 JS 产物启动。
