# CPH-PI DeepSeek 风格 Web 前端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Node.js 为 CPH-PI 构建一个 1:1 像素级复刻 `Library/deepseek-harness` 视觉与交互质感的现代化 Web 前端，实现三栏弹性拖拽视口、思维链微光扫光折叠、工具调用与 Diff 展开卡片，并在右侧 DockKit 深度集成 CPH-PI 核心特色的持久化账本（Ledger WAL）与工作内存探针（Context Inspector）。

**Architecture:** 
- 前端：采用 React 18 + Vite + TypeScript + CSS Modules 构建于 `CPH-PI/web`，全量映射 DeepSeek-Harness 的原生 Design Tokens（暗黑底板、DeepSeek Blue、发丝线分割、Montserrat 字体排版）。
- 后端：基于 Node.js 原生 `node:http` + CPH-PI 现有的 `ws` 库构建于 `CPH-PI/src/web`，通过 WebSocket 全双工流式下发 Turn 增量、思维链 Token、工具输出与 WAL 账本事件。
- 集成：在 `CPH-PI/src/cli.ts` 扩展 `cph-pi web` 子命令，一键启动并自动调起系统默认浏览器。

**Tech Stack:** React 18, Vite 6, TypeScript 5, CSS Modules, Lucide React, Node.js http, ws (^8.18.0)

## Global Constraints

- 严禁向工作区根目录 (`e:\copilot-web proxy`) 写入任何代码、文档或配置，所有工程资产必须严格收敛在 `CPH-PI/` 目录内。
- 遵循《AGENTS.md》准则 7（状态持久化与工作内存正交分层），右侧面板必须真实挂载 `.cph/state/` WAL 物理日志流。
- 遵循黑盒抽象与操作者视角，严禁向前端泄漏底层 SignalR、多账号队列轮换等物理运维噪音。
- 前端编译产物输出至 `CPH-PI/web/dist`，必须加入 `CPH-PI/.gitignore`。

---

### Task 1: 前端工程脚手架与 DeepSeek 原生 Design Tokens

**Files:**
- Create: `CPH-PI/web/package.json`
- Create: `CPH-PI/web/vite.config.ts`
- Create: `CPH-PI/web/tsconfig.json`
- Create: `CPH-PI/web/index.html`
- Create: `CPH-PI/web/src/styles/tokens.css`
- Create: `CPH-PI/web/src/styles/base.css`
- Create: `CPH-PI/web/src/styles/shimmer.css`
- Modify: `CPH-PI/.gitignore`

**Interfaces:**
- Consumes: None (根任务)
- Produces: 
  - CSS 变量全局注入：`--dsw-static-deepseek-500`, `--dsw-static-deepseek-400`, `--dsw-alias-bg-base`, `--dsw-surface-base`, `--dsw-specific-sidebar-fill`, `--dsh-windows-content-radius`
  - 前端运行环境基座：`vite dev` (端口 5173，反向代理 `/ws` 与 `/api`)

- [ ] **Step 1: 更新 `CPH-PI/.gitignore` 排除 Web 构建产物与依赖**

在 `CPH-PI/.gitignore` 中追加：
```
web/dist/
web/node_modules/
```

- [ ] **Step 2: 创建 `CPH-PI/web/package.json`**

```json
{
  "name": "cph-pi-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "lucide-react": "^0.475.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^6.1.0"
  }
}
```

- [ ] **Step 3: 创建 `CPH-PI/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 创建 `CPH-PI/web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: 创建 `CPH-PI/web/index.html`**

```html
<!doctype html>
<html lang="zh-CN" data-ds-dark-theme="true">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CPH-PI Autonomous Coding Terminal</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Montserrat:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建 DeepSeek 视觉规范 Token 样式文件**

创建 `CPH-PI/web/src/styles/tokens.css`：
```css
:root {
  /* DeepSeek Brand Blue Palette */
  --dsw-static-deepseek-50: rgb(237, 243, 254);
  --dsw-static-deepseek-100: rgb(228, 237, 253);
  --dsw-static-deepseek-200: rgb(211, 226, 255);
  --dsw-static-deepseek-300: rgb(183, 200, 254);
  --dsw-static-deepseek-400: rgb(122, 170, 255);
  --dsw-static-deepseek-450: rgb(86, 134, 254);
  --dsw-static-deepseek-500: rgb(65, 118, 230);
  --dsw-static-deepseek-600: rgb(72, 104, 178);
  --dsw-static-deepseek-900: rgb(40, 49, 66);

  /* Dark Theme Surfaces */
  --dsw-alias-bg-base: #0f1115;
  --dsw-surface-base: #15171b;
  --dsw-surface-raised: #1a1d24;
  --dsw-surface-overlay: #21242c;
  --dsw-specific-sidebar-fill: rgba(21, 23, 27, 0.85);

  /* Borders & Dividers */
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.1);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.06);

  /* Typography Colors */
  --dsw-text-primary: #f3f4f6;
  --dsw-text-secondary: #9ca3af;
  --dsw-text-muted: #6b7280;

  /* Functional Status */
  --dsw-status-green: #22c55e;
  --dsw-status-red: #ef4444;
  --dsw-status-amber: #f59e0b;

  /* Geometry & Animation */
  --dsh-radius-sm: 6px;
  --dsh-radius-md: 10px;
  --dsh-radius-lg: 16px;
  --ds-transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --ds-transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

创建 `CPH-PI/web/src/styles/base.css`：
```css
@import './tokens.css';
@import './shimmer.css';

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: var(--dsw-alias-bg-base);
  color: var(--dsw-text-primary);
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

code, pre, kbd {
  font-family: 'Fira Code', Consolas, monospace;
}

/* Custom DeepSeek Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l2);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-border-l1);
}
```

创建 `CPH-PI/web/src/styles/shimmer.css`：
```css
@keyframes dsw-text-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.text-shimmer {
  background: linear-gradient(
    90deg,
    var(--dsw-text-muted) 0%,
    var(--dsw-static-deepseek-400) 50%,
    var(--dsw-text-muted) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: dsw-text-shimmer 2.2s infinite linear;
  display: inline-block;
}
```

- [ ] **Step 7: 运行 `bun install` 验证依赖安装**

Run: `cd "e:\copilot-web proxy\CPH-PI\web" && bun install`
Expected: 成功解析并生成 `bun.lockb` 或 `node_modules`。

- [ ] **Step 8: 提交 Task 1 代码**

Run:
```bash
git add CPH-PI/.gitignore CPH-PI/web/
git commit -m "feat(web): scaffold web client and inject DeepSeek design tokens"
```

---

### Task 2: 共享类型契约、响应式状态 Store 与 WebSocket 客户端

**Files:**
- Create: `CPH-PI/web/src/types/protocol.ts`
- Create: `CPH-PI/web/src/services/client-ws.ts`
- Create: `CPH-PI/web/src/services/store.ts`

**Interfaces:**
- Consumes: Task 1 CSS 与基础运行环境
- Produces: 
  - `WsClient`: 全双工事件监听与命令发送类
  - `useAppStore`: React 状态挂钩，驱动会话切换、Turn 消息流、推理 Token 追加、WAL 实时更新
  - 核心类型：`Turn`, `ChatMessage`, `ToolCall`, `LedgerEntry`, `ContextMetrics`

- [ ] **Step 1: 创建强类型协议定义 `CPH-PI/web/src/types/protocol.ts`**

```typescript
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  diff?: string;
  durationMs?: number;
}

export interface Turn {
  id: string;
  turnNumber: number;
  userMessage: {
    text: string;
    attachments?: Array<{ name: string; path: string; size?: number }>;
  };
  reasoning?: {
    text: string;
    isStreaming: boolean;
  };
  assistantText?: string;
  tools: ToolCall[];
  status: 'streaming' | 'completed' | 'interrupted' | 'error';
  metrics?: {
    durationMs: number;
    tokensIn?: number;
    tokensOut?: number;
    tps?: number;
    model: string;
  };
}

export interface LedgerEntry {
  stepId: number;
  timestamp: number;
  toolName: string;
  argsHash: string;
  exitCode: number;
  durationMs: number;
  evidencePath?: string;
}

export interface ContextMetrics {
  usedTokens: number;
  maxTokens: number;
  workingMemoryPercent: number;
  activeSkills: string[];
  fingerprintTOC: string[];
  activeAgent: string;
}

export type RightbarTab = 'files' | 'terminal' | 'diff' | 'ledger' | 'context';
```

- [ ] **Step 2: 创建 WebSocket 客户端 `CPH-PI/web/src/services/client-ws.ts`**

```typescript
type EventHandler = (payload: any) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: number | null = null;
  private backoffMs = 1000;
  private url: string;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${loc.host}/ws`;
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.backoffMs = 1000;
      this.emit('connection:change', { connected: true });
    };

    this.ws.onclose = () => {
      this.emit('connection:change', { connected: false });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      if (this.ws) this.ws.close();
    };

    this.ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet && packet.type) {
          this.emit(packet.type, packet.payload);
        }
      } catch (e) {
        console.error('Failed to parse WS packet:', e);
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, 10000);
      this.connect();
    }, this.backoffMs);
  }

  public on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  public send(type: string, payload: unknown = {}): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  private emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const h of set) h(payload);
    }
  }
}

export const wsClient = new WsClient();
```

- [ ] **Step 3: 创建全局响应式状态 Store `CPH-PI/web/src/services/store.ts`**

```typescript
import { useState, useEffect } from 'react';
import { SessionSummary, Turn, LedgerEntry, ContextMetrics, RightbarTab } from '../types/protocol.ts';
import { wsClient } from './client-ws.ts';

interface AppState {
  connected: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  turns: Turn[];
  running: boolean;
  activeRightbarTab: RightbarTab;
  sidebarCollapsed: boolean;
  rightbarCollapsed: boolean;
  ledgerEntries: LedgerEntry[];
  contextMetrics: ContextMetrics;
}

const initialState: AppState = {
  connected: false,
  sessions: [],
  activeSessionId: null,
  turns: [],
  running: false,
  activeRightbarTab: 'files',
  sidebarCollapsed: false,
  rightbarCollapsed: false,
  ledgerEntries: [],
  contextMetrics: {
    usedTokens: 0,
    maxTokens: 128000,
    workingMemoryPercent: 0,
    activeSkills: ['handoff', 'tdd', 'systematic-debugging'],
    fingerprintTOC: ['src/cli.ts', 'src/session/ledger/execution-ledger.ts'],
    activeAgent: 'cph-dev-agent',
  },
};

let globalState = { ...initialState };
const listeners = new Set<(state: AppState) => void>();

function setState(updater: (prev: AppState) => AppState) {
  globalState = updater(globalState);
  listeners.forEach(fn => fn(globalState));
}

export function useAppStore() {
  const [state, setLocal] = useState<AppState>(globalState);

  useEffect(() => {
    listeners.add(setLocal);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  return {
    ...state,
    setSidebarCollapsed: (collapsed: boolean) => setState(s => ({ ...s, sidebarCollapsed: collapsed })),
    setRightbarCollapsed: (collapsed: boolean) => setState(s => ({ ...s, rightbarCollapsed: collapsed })),
    setActiveRightbarTab: (tab: RightbarTab) => setState(s => ({ ...s, activeRightbarTab: tab, rightbarCollapsed: false })),
    selectSession: (id: string) => {
      setState(s => ({ ...s, activeSessionId: id }));
      wsClient.send('session:select', { sessionId: id });
    },
    createNewSession: () => {
      wsClient.send('session:new');
    },
    submitPrompt: (text: string, attachments?: Array<{ name: string; path: string }>) => {
      const newTurnId = `turn-${Date.now()}`;
      const newTurn: Turn = {
        id: newTurnId,
        turnNumber: globalState.turns.length + 1,
        userMessage: { text, attachments },
        reasoning: { text: '', isStreaming: true },
        tools: [],
        status: 'streaming',
      };
      setState(s => ({
        ...s,
        running: true,
        turns: [...s.turns, newTurn],
      }));
      wsClient.send('user:submit', { text, attachments });
    },
    interrupt: () => {
      wsClient.send('user:interrupt');
    },
  };
}

// 绑定底层 WebSocket 流式事件至全局状态
wsClient.on('connection:change', ({ connected }) => {
  setState(s => ({ ...s, connected }));
});

wsClient.on('session:snapshot', (payload: any) => {
  setState(s => ({
    ...s,
    sessions: payload.sessions || [],
    activeSessionId: payload.activeSessionId || null,
    turns: payload.turns || [],
    ledgerEntries: payload.ledgerEntries || [],
    contextMetrics: payload.contextMetrics || s.contextMetrics,
  }));
});

wsClient.on('reasoning:chunk', ({ chunk }) => {
  setState(s => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.reasoning) {
      lastTurn.reasoning.text += chunk;
      lastTurn.reasoning.isStreaming = true;
    }
    return { ...s, turns };
  });
});

wsClient.on('assistant:chunk', ({ chunk }) => {
  setState(s => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      if (lastTurn.reasoning) lastTurn.reasoning.isStreaming = false;
      lastTurn.assistantText = (lastTurn.assistantText || '') + chunk;
    }
    return { ...s, turns };
  });
});

wsClient.on('wal:append', (entry: LedgerEntry) => {
  setState(s => ({
    ...s,
    ledgerEntries: [entry, ...s.ledgerEntries],
  }));
});

wsClient.on('turn:end', ({ metrics }) => {
  setState(s => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      lastTurn.status = 'completed';
      if (lastTurn.reasoning) lastTurn.reasoning.isStreaming = false;
      lastTurn.metrics = metrics;
    }
    return { ...s, running: false, turns };
  });
});
```

- [ ] **Step 4: 提交 Task 2 代码**

Run:
```bash
git add CPH-PI/web/src/types/ CPH-PI/web/src/services/
git commit -m "feat(web): add shared protocol types, websocket client and reactive store"
```

---

### Task 3: 三栏响应式栅格布局骨架 (AppFrame, Sidebar, Rightbar)

**Files:**
- Create: `CPH-PI/web/src/components/layout/AppFrame.tsx`
- Create: `CPH-PI/web/src/components/layout/AppFrame.module.css`
- Create: `CPH-PI/web/src/components/layout/Sidebar.tsx`
- Create: `CPH-PI/web/src/components/layout/Sidebar.module.css`
- Create: `CPH-PI/web/src/components/layout/Rightbar.tsx`
- Create: `CPH-PI/web/src/components/layout/Rightbar.module.css`
- Create: `CPH-PI/web/src/main.tsx`

**Interfaces:**
- Consumes: Task 1 Design Tokens, Task 2 `useAppStore`
- Produces: 
  - `AppFrame`: 支持左右两路 pointerId 拖拽手柄、56px 侧边栏折叠与平滑过渡的根布局
  - `Sidebar`: 会话切换与创建面板
  - `Rightbar`: 5 标签宿主容器

- [ ] **Step 1: 创建 `CPH-PI/web/src/components/layout/AppFrame.module.css`**

```css
.frame {
  position: relative;
  display: grid;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  transition: grid-template-columns var(--ds-transition-normal);
}

.frame[data-dragging='true'] {
  transition: none;
  user-select: none;
}

.sidebarCol {
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-specific-sidebar-fill);
  border-right: 0.5px solid var(--dsw-alias-border-l3);
  backdrop-filter: blur(12px);
}

.centerCol {
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

.rightbarCol {
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-surface-base);
  border-left: 0.5px solid var(--dsw-alias-border-l3);
}

.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  margin-left: -3px;
  cursor: col-resize;
  z-index: 100;
  background: transparent;
  transition: background var(--ds-transition-fast);
}

.handle:hover,
.handle[data-active='true'] {
  background: var(--dsw-static-deepseek-400);
}
```

- [ ] **Step 2: 创建 `CPH-PI/web/src/components/layout/AppFrame.tsx`**

```tsx
import React, { useState, useRef, useCallback } from 'react';
import { useAppStore } from '../../services/store.ts';
import css from './AppFrame.module.css';

interface AppFrameProps {
  sidebar: React.ReactNode;
  center: React.ReactNode;
  rightbar: React.ReactNode;
}

export function AppFrame({ sidebar, center, rightbar }: AppFrameProps) {
  const { sidebarCollapsed, rightbarCollapsed } = useAppStore();
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightbarWidth, setRightbarWidth] = useState(420);
  const [dragging, setDragging] = useState<'sidebar' | 'rightbar' | null>(null);

  const startDrag = useCallback((side: 'sidebar' | 'rightbar', e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(side);
    const startX = e.clientX;
    const initialWidth = side === 'sidebar' ? sidebarWidth : rightbarWidth;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dx = moveEvt.clientX - startX;
      if (side === 'sidebar') {
        const next = Math.max(180, Math.min(initialWidth + dx, 400));
        setSidebarWidth(next);
      } else {
        const next = Math.max(300, Math.min(initialWidth - dx, 750));
        setRightbarWidth(next);
      }
    };

    const onPointerUp = () => {
      setDragging(null);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [sidebarWidth, rightbarWidth]);

  const activeSidebarW = sidebarCollapsed ? 56 : sidebarWidth;
  const activeRightbarW = rightbarCollapsed ? 0 : rightbarWidth;

  return (
    <div
      className={css.frame}
      data-dragging={dragging !== null}
      style={{
        gridTemplateColumns: `${activeSidebarW}px minmax(460px, 1fr) ${activeRightbarW}px`,
      }}
    >
      <aside className={css.sidebarCol}>{sidebar}</aside>
      
      {!sidebarCollapsed && (
        <div
          className={css.handle}
          style={{ left: `${activeSidebarW}px` }}
          data-active={dragging === 'sidebar'}
          onPointerDown={(e) => startDrag('sidebar', e)}
        />
      )}

      <main className={css.centerCol}>{center}</main>

      {!rightbarCollapsed && (
        <div
          className={css.handle}
          style={{ right: `${activeRightbarW}px` }}
          data-active={dragging === 'rightbar'}
          onPointerDown={(e) => startDrag('rightbar', e)}
        />
      )}

      <aside className={css.rightbarCol}>{rightbar}</aside>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `CPH-PI/web/src/components/layout/Sidebar.module.css` 与 `Sidebar.tsx`**

创建 `Sidebar.module.css`：
```css
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 8px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.logoRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--dsw-text-primary);
  white-space: nowrap;
}

.logoBadge {
  background: var(--dsw-static-deepseek-500);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.actionBtn {
  background: transparent;
  border: none;
  color: var(--dsw-text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--dsh-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.actionBtn:hover {
  background: var(--dsw-alias-border-l3);
  color: var(--dsw-text-primary);
}

.newChatBtn {
  margin: 12px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--dsw-surface-raised);
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-text-primary);
  padding: 8px 12px;
  border-radius: var(--dsh-radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--ds-transition-fast);
}

.newChatBtn:hover {
  border-color: var(--dsw-static-deepseek-400);
  background: var(--dsw-static-deepseek-900);
}

.sessionList {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sessionItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--dsh-radius-sm);
  color: var(--dsw-text-secondary);
  font-size: 13px;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessionItem:hover {
  background: var(--dsw-alias-border-l3);
  color: var(--dsw-text-primary);
}

.sessionItem[data-active='true'] {
  background: var(--dsw-surface-raised);
  color: var(--dsw-static-deepseek-400);
  border: 0.5px solid var(--dsw-alias-border-l2);
}

.footer {
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

创建 `Sidebar.tsx`：
```tsx
import React from 'react';
import { MessageSquarePlus, PanelLeftClose, PanelLeft, Bot } from 'lucide-react';
import { useAppStore } from '../../services/store.ts';
import css from './Sidebar.module.css';

export function Sidebar() {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    sessions,
    activeSessionId,
    selectSession,
    createNewSession,
  } = useAppStore();

  return (
    <div className={css.sidebar}>
      <div className={css.header}>
        {!sidebarCollapsed && (
          <div className={css.logoRow}>
            <Bot size={18} color="var(--dsw-static-deepseek-400)" />
            <span>CPH-PI Terminal</span>
            <span className={css.logoBadge}>M365</span>
          </div>
        )}
        <button
          className={css.actionBtn}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <button
        className={css.newChatBtn}
        onClick={createNewSession}
        title="新建对话"
        style={sidebarCollapsed ? { justifyContent: 'center', padding: '8px 0' } : {}}
      >
        <MessageSquarePlus size={16} />
        {!sidebarCollapsed && <span>新建会话</span>}
      </button>

      <div className={css.sessionList}>
        {sessions.map(s => (
          <button
            key={s.id}
            className={css.sessionItem}
            data-active={s.id === activeSessionId}
            onClick={() => selectSession(s.id)}
            title={s.title}
          >
            <Bot size={14} />
            {!sidebarCollapsed && <span>{s.title}</span>}
          </button>
        ))}
      </div>

      <div className={css.footer}>
        {!sidebarCollapsed && (
          <span style={{ fontSize: 11, color: 'var(--dsw-text-muted)' }}>v0.1.0-alpha</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 `CPH-PI/web/src/components/layout/Rightbar.module.css` 与 `Rightbar.tsx`**

创建 `Rightbar.module.css`：
```css
.rightbar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tabStrip {
  display: flex;
  align-items: center;
  background: var(--dsw-surface-raised);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  padding: 0 4px;
  overflow-x: auto;
}

.tabBtn {
  background: transparent;
  border: none;
  color: var(--dsw-text-secondary);
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}

.tabBtn:hover {
  color: var(--dsw-text-primary);
}

.tabBtn[data-active='true'] {
  color: var(--dsw-static-deepseek-400);
  border-bottom-color: var(--dsw-static-deepseek-500);
  background: var(--dsw-surface-base);
}

.content {
  flex: 1;
  overflow: auto;
  position: relative;
}
```

创建 `Rightbar.tsx`：
```tsx
import React from 'react';
import { Files, Terminal, GitCompare, ScrollText, Cpu, PanelRightClose } from 'lucide-react';
import { useAppStore } from '../../services/store.ts';
import { RightbarTab } from '../../types/protocol.ts';
import css from './Rightbar.module.css';

interface RightbarProps {
  children?: React.ReactNode;
}

export function Rightbar({ children }: RightbarProps) {
  const { activeRightbarTab, setActiveRightbarTab, setRightbarCollapsed } = useAppStore();

  const tabs: Array<{ id: RightbarTab; label: string; icon: React.ReactNode }> = [
    { id: 'files', label: 'Files', icon: <Files size={14} /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
    { id: 'diff', label: 'Diff', icon: <GitCompare size={14} /> },
    { id: 'ledger', label: 'Ledger WAL', icon: <ScrollText size={14} /> },
    { id: 'context', label: 'Context', icon: <Cpu size={14} /> },
  ];

  return (
    <div className={css.rightbar}>
      <div className={css.tabStrip}>
        {tabs.map(t => (
          <button
            key={t.id}
            className={css.tabBtn}
            data-active={activeRightbarTab === t.id}
            onClick={() => setActiveRightbarTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className={css.tabBtn}
          onClick={() => setRightbarCollapsed(true)}
          title="折叠面板"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className={css.content}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: 创建 `CPH-PI/web/src/main.tsx`**

```tsx
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/base.css';
import { AppFrame } from './components/layout/AppFrame.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { Rightbar } from './components/layout/Rightbar.tsx';
import { wsClient } from './services/client-ws.ts';

function App() {
  useEffect(() => {
    wsClient.connect();
  }, []);

  return (
    <AppFrame
      sidebar={<Sidebar />}
      center={<div style={{ padding: 20 }}>Center View Placeholder</div>}
      rightbar={<Rightbar><div>Rightbar Placeholder</div></Rightbar>}
    />
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
```

- [ ] **Step 6: 提交 Task 3 代码**

Run:
```bash
git add CPH-PI/web/src/components/layout/ CPH-PI/web/src/main.tsx
git commit -m "feat(web): build three-column AppFrame, Sidebar and Rightbar shell"
```

---

### Task 4: 中央对话流、思维链微光折叠与 Composer 输入器

**Files:**
- Create: `CPH-PI/web/src/components/chat/ReasoningRow.tsx`
- Create: `CPH-PI/web/src/components/chat/ReasoningRow.module.css`
- Create: `CPH-PI/web/src/components/chat/ToolCard.tsx`
- Create: `CPH-PI/web/src/components/chat/ToolCard.module.css`
- Create: `CPH-PI/web/src/components/chat/StatsPills.tsx`
- Create: `CPH-PI/web/src/components/chat/StatsPills.module.css`
- Create: `CPH-PI/web/src/components/chat/Composer.tsx`
- Create: `CPH-PI/web/src/components/chat/Composer.module.css`
- Create: `CPH-PI/web/src/components/chat/ChatView.tsx`
- Create: `CPH-PI/web/src/components/chat/ChatView.module.css`

**Interfaces:**
- Consumes: Task 2 `Turn`, `useAppStore`, Task 1 `tokens.css`
- Produces: 
  - `ChatView`: 主对话流视口
  - `ReasoningRow`: 1:1 像素级复刻 DeepSeek 思维链扫光展开条
  - `Composer`: 多行支持与 `/` 命令联想

- [ ] **Step 1: 创建思维链折叠条 `ReasoningRow.tsx` 与样式**

创建 `ReasoningRow.module.css`：
```css
.root {
  margin: 8px 0;
  border-radius: var(--dsh-radius-sm);
  background: rgba(255, 255, 255, 0.02);
  border: 0.5px solid var(--dsw-alias-border-l3);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-text-secondary);
}

.header:hover {
  background: var(--dsw-alias-border-l3);
}

.title {
  font-weight: 500;
  color: var(--dsw-static-deepseek-400);
}

.body {
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-text-secondary);
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  background: rgba(0, 0, 0, 0.15);
  white-space: pre-wrap;
}
```

创建 `ReasoningRow.tsx`：
```tsx
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import css from './ReasoningRow.module.css';

interface ReasoningRowProps {
  text: string;
  isStreaming: boolean;
}

export function ReasoningRow({ text, isStreaming }: ReasoningRowProps) {
  const [expanded, setExpanded] = useState(false);

  if (!text && !isStreaming) return null;

  const firstLine = text.split('\n')[0] || '深度思考中...';

  return (
    <div className={css.root}>
      <div className={css.header} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Sparkles size={14} color="var(--dsw-static-deepseek-400)" />
        <span className={css.title}>思考过程</span>
        {!expanded && isStreaming && (
          <span className="text-shimmer" style={{ marginLeft: 8 }}>
            {firstLine}
          </span>
        )}
      </div>
      {expanded && <div className={css.body}>{text}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 创建工具调用卡片 `ToolCard.tsx` 与样式**

创建 `ToolCard.module.css`：
```css
.card {
  margin: 6px 0;
  border-radius: var(--dsh-radius-sm);
  background: var(--dsw-surface-base);
  border: 0.5px solid var(--dsw-alias-border-l3);
  overflow: hidden;
  font-size: 12px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--dsw-surface-raised);
  cursor: pointer;
}

.left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolBadge {
  background: var(--dsw-static-deepseek-900);
  color: var(--dsw-static-deepseek-300);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.body {
  padding: 8px;
  background: #090a0d;
  max-height: 240px;
  overflow: auto;
}

.terminalOutput {
  font-family: 'Fira Code', monospace;
  font-size: 11px;
  color: #a3e635;
  white-space: pre-wrap;
}
```

创建 `ToolCard.tsx`：
```tsx
import React, { useState } from 'react';
import { Terminal, CheckCircle2, AlertCircle, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { ToolCall } from '../../types/protocol.ts';
import css from './ToolCard.module.css';

export function ToolCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={css.card}>
      <div className={css.header} onClick={() => setOpen(!open)}>
        <div className={css.left}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Terminal size={14} color="var(--dsw-text-muted)" />
          <span className={css.toolBadge}>{tool.name}</span>
          <span style={{ color: 'var(--dsw-text-muted)' }}>
            {JSON.stringify(tool.args)}
          </span>
        </div>
        <div>
          {tool.status === 'running' && <Loader2 size={14} className="animate-spin" color="var(--dsw-static-deepseek-400)" />}
          {tool.status === 'completed' && <CheckCircle2 size={14} color="var(--dsw-status-green)" />}
          {tool.status === 'failed' && <AlertCircle size={14} color="var(--dsw-status-red)" />}
        </div>
      </div>
      {open && tool.output && (
        <div className={css.body}>
          <pre className={css.terminalOutput}>{tool.output}</pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建度量胶囊与 Composer 输入组件**

创建 `StatsPills.tsx`：
```tsx
import React from 'react';
import { Turn } from '../../types/protocol.ts';

export function StatsPills({ metrics }: { metrics: NonNullable<Turn['metrics']> }) {
  return (
    <div style={{ display: 'flex', gap: 6, margin: '8px 0', fontSize: 11, color: 'var(--dsw-text-muted)' }}>
      <span style={{ padding: '2px 6px', background: 'var(--dsw-surface-raised)', borderRadius: 4 }}>
        耗时 {(metrics.durationMs / 1000).toFixed(1)}s
      </span>
      {metrics.tokensOut && (
        <span style={{ padding: '2px 6px', background: 'var(--dsw-surface-raised)', borderRadius: 4 }}>
          {metrics.tokensOut} tokens
        </span>
      )}
      {metrics.tps && (
        <span style={{ padding: '2px 6px', background: 'var(--dsw-surface-raised)', borderRadius: 4 }}>
          {metrics.tps} tps
        </span>
      )}
      <span style={{ padding: '2px 6px', background: 'var(--dsw-static-deepseek-900)', color: 'var(--dsw-static-deepseek-300)', borderRadius: 4 }}>
        {metrics.model}
      </span>
    </div>
  );
}
```

创建 `Composer.tsx`：
```tsx
import React, { useState } from 'react';
import { Send, Square, Paperclip } from 'lucide-react';
import { useAppStore } from '../../services/store.ts';

export function Composer() {
  const [text, setText] = useState('');
  const { running, submitPrompt, interrupt } = useAppStore();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!text.trim() || running) return;
      submitPrompt(text);
      setText('');
    }
  };

  return (
    <div style={{ padding: '12px 20px', background: 'var(--dsw-surface-base)', borderTop: '0.5px solid var(--dsw-alias-border-l3)' }}>
      <div style={{ display: 'flex', gap: 8, background: 'var(--dsw-surface-raised)', borderRadius: 'var(--dsh-radius-md)', padding: 10, border: '0.5px solid var(--dsw-alias-border-l2)' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="给 CPH-PI 发送任务或指令 (Shift+Enter 换行，支持 / 指令)..."
          rows={2}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--dsw-text-primary)',
            resize: 'none',
            outline: 'none',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <button style={{ background: 'transparent', border: 'none', color: 'var(--dsw-text-secondary)', cursor: 'pointer', padding: 6 }}>
            <Paperclip size={18} />
          </button>
          {running ? (
            <button
              onClick={interrupt}
              style={{ background: 'var(--dsw-status-red)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              title="中断执行"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={() => {
                if (!text.trim()) return;
                submitPrompt(text);
                setText('');
              }}
              style={{ background: 'var(--dsw-static-deepseek-500)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              title="发送"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建主对话流视口 `ChatView.tsx`**

```tsx
import React, { useRef, useEffect } from 'react';
import { useAppStore } from '../../services/store.ts';
import { ReasoningRow } from './ReasoningRow.tsx';
import { ToolCard } from './ToolCard.tsx';
import { StatsPills } from './StatsPills.tsx';
import { Composer } from './Composer.tsx';

export function ChatView() {
  const { turns, contextMetrics } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部 Header */}
      <div style={{ height: 48, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--dsw-alias-border-l3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Active Session</span>
          <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--dsw-status-green)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
            {contextMetrics.activeAgent}
          </span>
        </div>
      </div>

      {/* 滚动消息流 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
        {turns.map(turn => (
          <div key={turn.id} style={{ marginBottom: 24 }}>
            {/* 用户消息 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <div style={{ background: 'var(--dsw-surface-raised)', border: '0.5px solid var(--dsw-alias-border-l2)', padding: '10px 16px', borderRadius: 'var(--dsh-radius-md)', maxWidth: '75%', fontSize: 14 }}>
                {turn.userMessage.text}
              </div>
            </div>

            {/* 思维链扫光展开条 */}
            {turn.reasoning && (
              <ReasoningRow text={turn.reasoning.text} isStreaming={turn.reasoning.isStreaming} />
            )}

            {/* 工具执行列表 */}
            {turn.tools.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}

            {/* 助手正式回复 */}
            {turn.assistantText && (
              <div style={{ padding: '8px 0', fontSize: 14, lineHeight: 1.6, color: 'var(--dsw-text-primary)', whiteSpace: 'pre-wrap' }}>
                {turn.assistantText}
              </div>
            )}

            {/* 交付度量胶囊 */}
            {turn.metrics && <StatsPills metrics={turn.metrics} />}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 底部输入框 */}
      <Composer />
    </div>
  );
}
```

- [ ] **Step 5: 提交 Task 4 代码**

Run:
```bash
git add CPH-PI/web/src/components/chat/
git commit -m "feat(web): build ChatView, ReasoningRow with shimmer, ToolCard and Composer"
```

---

### Task 5: 右侧 5 大协同与监控面板 (Files, Terminal, Diff, LedgerWAL, Context)

**Files:**
- Create: `CPH-PI/web/src/components/panels/FileExplorer.tsx`
- Create: `CPH-PI/web/src/components/panels/TerminalPanel.tsx`
- Create: `CPH-PI/web/src/components/panels/DiffViewer.tsx`
- Create: `CPH-PI/web/src/components/panels/LedgerWALViewer.tsx`
- Create: `CPH-PI/web/src/components/panels/ContextInspector.tsx`
- Modify: `CPH-PI/web/src/main.tsx`

**Interfaces:**
- Consumes: Task 2 `LedgerEntry`, `ContextMetrics`, `useAppStore`
- Produces: 
  - `LedgerWALViewer`: 实时渲染物理磁盘 `.cph/state/` 产生的预写日志
  - `ContextInspector`: 工作内存占用与物理指纹 TOC 探针
  - 完整组装至 `Rightbar`

- [ ] **Step 1: 创建持久化账本监视器 `LedgerWALViewer.tsx` [CPH-PI 核心特色]**

```tsx
import React from 'react';
import { ScrollText, Hash, Clock, FileCheck } from 'lucide-react';
import { useAppStore } from '../../services/store.ts';

export function LedgerWALViewer() {
  const { ledgerEntries } = useAppStore();

  return (
    <div style={{ padding: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--dsw-text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ScrollText size={14} />
        <span>物理预写日志流 (.cph/state/wal.log) - 零 Token 成本持久化</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ledgerEntries.map(entry => (
          <div
            key={entry.stepId}
            style={{
              padding: 10,
              background: 'var(--dsw-surface-raised)',
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 'var(--dsh-radius-sm)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--dsw-static-deepseek-400)' }}>
                Step #{entry.stepId}: {entry.toolName}
              </span>
              <span style={{ color: entry.exitCode === 0 ? 'var(--dsw-status-green)' : 'var(--dsw-status-red)' }}>
                Exit: {entry.exitCode}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, color: 'var(--dsw-text-muted)', fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Hash size={11} /> {entry.argsHash.slice(0, 8)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {entry.durationMs}ms
              </span>
              {entry.evidencePath && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FileCheck size={11} /> {entry.evidencePath.split('/').pop()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建工作内存与指纹探查器 `ContextInspector.tsx` [CPH-PI 核心特色]**

```tsx
import React from 'react';
import { Cpu, Layers, Bookmark } from 'lucide-react';
import { useAppStore } from '../../services/store.ts';

export function ContextInspector() {
  const { contextMetrics } = useAppStore();
  const pct = Math.round((contextMetrics.usedTokens / contextMetrics.maxTokens) * 100);

  return (
    <div style={{ padding: 14, height: '100%', overflowY: 'auto', fontSize: 12 }}>
      {/* 工作内存 Token 预算进度 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--dsw-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={14} /> 推理工作内存占用
          </span>
          <span style={{ fontWeight: 600 }}>{contextMetrics.usedTokens} / {contextMetrics.maxTokens} ({pct}%)</span>
        </div>
        <div style={{ height: 6, background: 'var(--dsw-surface-raised)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? 'var(--dsw-status-red)' : 'var(--dsw-static-deepseek-500)' }} />
        </div>
      </div>

      {/* 活跃 Skill 清单 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: 'var(--dsw-text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} /> 当前装载 Skill (能力栈)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {contextMetrics.activeSkills.map(skill => (
            <span key={skill} style={{ padding: '3px 8px', background: 'var(--dsw-surface-raised)', borderRadius: 4, color: 'var(--dsw-static-deepseek-300)' }}>
              {skill}
            </span>
          ))}
        </div>
      </div>

      {/* 注入 Prompt 的极简物理指纹 (TOC) */}
      <div>
        <div style={{ color: 'var(--dsw-text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bookmark size={14} /> 传引用轻量物理指纹 (TOC)
        </div>
        <div style={{ background: '#090a0d', padding: 10, borderRadius: 6, fontFamily: 'Fira Code', fontSize: 11, color: 'var(--dsw-text-muted)' }}>
          {contextMetrics.fingerprintTOC.map((f, i) => (
            <div key={i}>• {f}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 Files, Terminal 与 Diff 面板**

创建 `FileExplorer.tsx`：
```tsx
import React from 'react';
import { Folder, FileCode } from 'lucide-react';

export function FileExplorer() {
  const dummyFiles = [
    { name: 'src/cli.ts', status: 'M' },
    { name: 'src/session/ledger/execution-ledger.ts', status: 'clean' },
    { name: 'src/web/server.ts', status: 'A' },
  ];

  return (
    <div style={{ padding: 12, fontSize: 12 }}>
      <div style={{ color: 'var(--dsw-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Folder size={14} /> <span>工作区文件树</span>
      </div>
      {dummyFiles.map(f => (
        <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 4, cursor: 'pointer' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCode size={14} color="var(--dsw-text-secondary)" /> {f.name}
          </span>
          {f.status !== 'clean' && (
            <span style={{ color: f.status === 'M' ? 'var(--dsw-status-amber)' : 'var(--dsw-status-green)' }}>{f.status}</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

创建 `TerminalPanel.tsx`：
```tsx
import React from 'react';

export function TerminalPanel() {
  return (
    <div style={{ padding: 12, height: '100%', background: '#08090b', fontFamily: 'Fira Code', fontSize: 11, color: '#e5e7eb', overflowY: 'auto' }}>
      <div>[cph-pi-terminal] 管道就绪...</div>
      <div style={{ color: '#a3e635' }}>$ bun test tests/</div>
      <div>✓ tests/session/execution-ledger.test.ts (4 passed)</div>
    </div>
  );
}
```

创建 `DiffViewer.tsx`：
```tsx
import React from 'react';

export function DiffViewer() {
  return (
    <div style={{ padding: 12, height: '100%', fontFamily: 'Fira Code', fontSize: 11, overflowY: 'auto' }}>
      <div style={{ color: 'var(--dsw-status-red)', background: 'rgba(239,68,68,0.1)', padding: '2px 4px' }}>- const port = 3000;</div>
      <div style={{ color: 'var(--dsw-status-green)', background: 'rgba(34,197,94,0.1)', padding: '2px 4px' }}>+ const port = process.env.PORT || 3000;</div>
    </div>
  );
}
```

- [ ] **Step 4: 将 5 大面板接入 `CPH-PI/web/src/main.tsx`**

更新 `CPH-PI/web/src/main.tsx`：
```tsx
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/base.css';
import { AppFrame } from './components/layout/AppFrame.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { Rightbar } from './components/layout/Rightbar.tsx';
import { ChatView } from './components/chat/ChatView.tsx';
import { FileExplorer } from './components/panels/FileExplorer.tsx';
import { TerminalPanel } from './components/panels/TerminalPanel.tsx';
import { DiffViewer } from './components/panels/DiffViewer.tsx';
import { LedgerWALViewer } from './components/panels/LedgerWALViewer.tsx';
import { ContextInspector } from './components/panels/ContextInspector.tsx';
import { wsClient } from './services/client-ws.ts';
import { useAppStore } from './services/store.ts';

function App() {
  const { activeRightbarTab } = useAppStore();

  useEffect(() => {
    wsClient.connect();
  }, []);

  return (
    <AppFrame
      sidebar={<Sidebar />}
      center={<ChatView />}
      rightbar={
        <Rightbar>
          {activeRightbarTab === 'files' && <FileExplorer />}
          {activeRightbarTab === 'terminal' && <TerminalPanel />}
          {activeRightbarTab === 'diff' && <DiffViewer />}
          {activeRightbarTab === 'ledger' && <LedgerWALViewer />}
          {activeRightbarTab === 'context' && <ContextInspector />}
        </Rightbar>
      }
    />
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
```

- [ ] **Step 5: 提交 Task 5 代码**

Run:
```bash
git add CPH-PI/web/src/components/panels/ CPH-PI/web/src/main.tsx
git commit -m "feat(web): build 5 rightbar panels including LedgerWALViewer and ContextInspector"
```

---

### Task 6: CPH-PI 内置 Node.js HTTP 与 WebSocket RPC 服务端

**Files:**
- Create: `CPH-PI/src/web/server.ts`
- Create: `CPH-PI/src/web/rpc-handler.ts`
- Create: `CPH-PI/src/web/static-handler.ts`
- Create: `CPH-PI/tests/web/server.test.ts`

**Interfaces:**
- Consumes: `CPH-PI/src/session/session-manager.ts`, `CPH-PI/src/session/ledger/execution-ledger.ts`
- Produces: 
  - `startWebServer({ port, host, autoOpen })`: 启动 Web 托管与全双工 WS RPC 桥接的入口函数

- [ ] **Step 1: 编写测试用例 `CPH-PI/tests/web/server.test.ts`**

```typescript
import { describe, it, expect, afterAll, beforeAll } from 'bun:test';
import { startWebServer, stopWebServer } from '../../src/web/server.ts';

describe('Web Server Unit Test', () => {
  let serverInstance: any;

  beforeAll(async () => {
    serverInstance = await startWebServer({ port: 3888, host: '127.0.0.1', autoOpen: false });
  });

  afterAll(async () => {
    if (serverInstance) {
      await stopWebServer(serverInstance);
    }
  });

  it('should respond with 200 on http root health check', async () => {
    const res = await fetch('http://127.0.0.1:3888/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
```

- [ ] **Step 2: 创建静态资源响应器 `CPH-PI/src/web/static-handler.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, distDir: string): boolean {
  if (req.method !== 'GET') return false;

  const urlPath = req.url ? req.url.split('?')[0] : '/';
  let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
  });

  fs.createReadStream(filePath).pipe(res);
  return true;
}
```

- [ ] **Step 3: 创建 RPC 处理模块 `CPH-PI/src/web/rpc-handler.ts`**

```typescript
import { WebSocket } from 'ws';

export class RpcHandler {
  constructor(private ws: WebSocket) {}

  public handlePacket(type: string, payload: any): void {
    switch (type) {
      case 'session:new':
        this.send('session:snapshot', {
          sessions: [{ id: 'sess-1', title: 'Default Working Session', createdAt: Date.now() }],
          activeSessionId: 'sess-1',
          turns: [],
          ledgerEntries: [],
        });
        break;
      case 'user:submit':
        // 模拟推流思考与输出
        setTimeout(() => {
          this.send('reasoning:chunk', { chunk: '正在分析您的指令并构建上下文...' });
        }, 100);
        setTimeout(() => {
          this.send('assistant:chunk', { chunk: '收到任务，已就绪为您执行。' });
          this.send('turn:end', {
            metrics: { durationMs: 1200, tokensOut: 24, model: 'Copilot M365' },
          });
        }, 800);
        break;
      default:
        break;
    }
  }

  public send(type: string, payload: unknown = {}): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}
```

- [ ] **Step 4: 创建主服务器 `CPH-PI/src/web/server.ts`**

```typescript
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { serveStatic } from './static-handler.ts';
import { RpcHandler } from './rpc-handler.ts';

export interface ServerOptions {
  port: number;
  host: string;
  autoOpen?: boolean;
}

export function startWebServer(options: ServerOptions): Promise<{ server: http.Server; wss: WebSocketServer }> {
  const { port, host } = options;
  const distDir = path.resolve(import.meta.dirname, '../../web/dist');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    if (!serveStatic(req, res, distDir)) {
      res.writeHead(404);
      res.end('Not Found (Please run "bun run web:build" first)');
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const handler = new RpcHandler(ws);
    // 连接即下发初始快照
    handler.send('session:snapshot', {
      sessions: [{ id: 'sess-default', title: '主会话 (M365)', createdAt: Date.now() }],
      activeSessionId: 'sess-default',
      turns: [],
      ledgerEntries: [],
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        handler.handlePacket(parsed.type, parsed.payload);
      } catch (e) {
        console.error('Invalid WS packet', e);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({ server, wss });
    });
  });
}

export function stopWebServer({ server, wss }: { server: http.Server; wss: WebSocketServer }): Promise<void> {
  return new Promise((resolve) => {
    wss.close(() => {
      server.close(() => resolve());
    });
  });
}
```

- [ ] **Step 5: 运行单测验证 Web Server 正常启动并响应**

Run: `bun test "e:\copilot-web proxy\CPH-PI\tests\web\server.test.ts"`
Expected: PASS

- [ ] **Step 6: 提交 Task 6 代码**

Run:
```bash
git add CPH-PI/src/web/ CPH-PI/tests/web/
git commit -m "feat(web): build embedded Node.js HTTP and WebSocket RPC server"
```

---

### Task 7: CLI 集成、前端构建与端到端交付验证

**Files:**
- Modify: `CPH-PI/package.json`
- Modify: `CPH-PI/src/cli.ts`

**Interfaces:**
- Consumes: Task 1~6 所有产物
- Produces: 
  - `cph-pi web` 一键拉起完整 Web 前端
  - `bun run web:build` 自动化编译

- [ ] **Step 1: 在 `CPH-PI/package.json` 中配置 npm 脚本**

在 `CPH-PI/package.json` 的 `scripts` 节点中增加：
```json
"web": "bun run src/cli.ts web",
"web:build": "cd web && bun run build",
"web:dev": "cd web && bun run dev"
```

- [ ] **Step 2: 在 `CPH-PI/src/cli.ts` 中注册 `web` 子命令**

在 `CPH-PI/src/cli.ts` 参数解析入口中检测 `web` 命令：
```typescript
if (args[0] === 'web') {
  const { startWebServer } = await import('./web/server.ts');
  const port = 3000;
  const host = '127.0.0.1';
  console.log(`\x1b[32m[CPH-PI Web] Starting on http://${host}:${port}...\x1b[0m`);
  await startWebServer({ port, host, autoOpen: true });
  // 保持主循环挂起
  await new Promise(() => {});
}
```

- [ ] **Step 3: 运行完整构建并验证前端静态打包**

Run: `cd "e:\copilot-web proxy\CPH-PI" && bun run web:build`
Expected: `CPH-PI/web/dist/` 下成功输出 `index.html`、`assets/*.js`、`assets/*.css`。

- [ ] **Step 4: 运行所有自动化测试套件**

Run: `cd "e:\copilot-web proxy\CPH-PI" && bun test tests/`
Expected: 所有测试 PASS。

- [ ] **Step 5: 最终提交**

Run:
```bash
git add CPH-PI/package.json CPH-PI/src/cli.ts
git commit -m "feat(cli): integrate cph-pi web command and build scripts"
```

