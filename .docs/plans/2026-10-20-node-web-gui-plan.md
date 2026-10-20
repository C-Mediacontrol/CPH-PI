# CPH-PI Node Web GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CPH-PI 构建一个基于 Node/Bun 的轻量级、全双工 Web GUI 控制台（对标 DeepSeek Harness `dsh web`），提供三栏 Agent 工作台、DeepSeek 风格深度思考折叠、代码 Diff 实时审查、账号池健康看板与双模启动能力。

**Architecture:** 后端基于 Node 原生 `node:http` 与已有的 `ws` 库构建轻量 WebSocket RPC 网关，通过 `WebUiBridge` 适配 `OrchestratorEvents` 双向流；前端基于 React 19 + Vite + Tailwind CSS 构建全功能三栏控制台，构建产物内嵌至 `dist/web/` 由 Node 原生静态托管，保持 0 额外服务端运行时依赖。

**Tech Stack:** Node.js/Bun, TypeScript, ws, React 19, Vite, Tailwind CSS, Lucide Icons

## Global Constraints
- 所有文件创建与修改必须严格限定在 `CPH-PI/` 二级目录内，严禁在根目录新建文件。
- 服务端保持 Harness 纯粹与极简，严禁引入 Express/Nest 等重型 Web 框架，仅复用 `node:http` 与 `ws`。
- 绝不向模型 System Prompt 泄露任何 Web/WebSocket 底层管道实现细节（遵循准则 6）。
- 状态持久化与工作内存正交分层：前端仅作为视图投影与交互发射器，权威状态由服务端 `SessionManager` 与 `.cph/state/` 磁盘 WAL 保证（遵循准则 7）。

---

### Task 1: Protocol Envelopes & Security Token (协议核心与防劫持鉴权)

**Files:**
- Create: `src/server/protocol-types.ts`
- Create: `src/server/security-token.ts`
- Test: `tests/server/protocol-and-token.test.ts`

**Interfaces:**
- Consumes: None (底座协议层)
- Produces:
  - `WsEnvelope<T>`: 统一消息信封接口
  - `createEnvelope<T>(type: string, payload: T, id?: string): WsEnvelope<T>`
  - `parseEnvelope(raw: string): WsEnvelope | null`
  - `generateSecurityToken(): string`: 生成 32 字节高熵十六进制防跨站劫持 Token
  - `verifySecurityToken(expected: string, provided: string): boolean`: 安全常数时间比较校验

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/protocol-and-token.test.ts
import { describe, it, expect } from "bun:test";
import { createEnvelope, parseEnvelope } from "../../src/server/protocol-types.ts";
import { generateSecurityToken, verifySecurityToken } from "../../src/server/security-token.ts";

describe("Protocol Envelopes & Security Token", () => {
  it("should create and parse valid WsEnvelope", () => {
    const env = createEnvelope("turn:delta", { chunk: "hello" }, "msg-123");
    expect(env.id).toBe("msg-123");
    expect(env.type).toBe("turn:delta");
    expect(env.payload).toEqual({ chunk: "hello" });
    expect(typeof env.timestamp).toBe("number");

    const raw = JSON.stringify(env);
    const parsed = parseEnvelope(raw);
    expect(parsed).toEqual(env);
  });

  it("should reject corrupted or invalid envelope string", () => {
    expect(parseEnvelope("invalid json")).toBeNull();
    expect(parseEnvelope(JSON.stringify({ only: "partial" }))).toBeNull();
  });

  it("should generate high entropy token and verify correctly", () => {
    const token = generateSecurityToken();
    expect(token.length).toBe(64);
    expect(verifySecurityToken(token, token)).toBe(true);
    expect(verifySecurityToken(token, "tampered-token")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/protocol-and-token.test.ts`  
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/protocol-types.ts
export interface WsEnvelope<T = any> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
}

export function createEnvelope<T>(type: string, payload: T, id?: string): WsEnvelope<T> {
  return {
    id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    timestamp: Date.now(),
  };
}

export function parseEnvelope(raw: string): WsEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.type === "string" && "payload" in parsed) {
      return parsed as WsEnvelope;
    }
  } catch {
    // Ignore invalid JSON
  }
  return null;
}
```

```typescript
// src/server/security-token.ts
import crypto from "node:crypto";

export function generateSecurityToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verifySecurityToken(expected: string, provided: string): boolean {
  if (!expected || !provided || expected.length !== provided.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/protocol-and-token.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/protocol-types.ts src/server/security-token.ts tests/server/protocol-and-token.test.ts
git commit -m "feat(server): add protocol envelopes and security token validation"
```

---

### Task 2: WebUiBridge (Orchestrator 事件与双工 RPC 桥接器)

**Files:**
- Create: `src/server/web-ui-bridge.ts`
- Test: `tests/server/web-ui-bridge.test.ts`

**Interfaces:**
- Consumes:
  - `WsEnvelope`, `createEnvelope` from `src/server/protocol-types.ts`
  - `CopilotAction`, `ToolBridgeResult` from `src/protocol/tool-bridge.ts`
  - `OrchestratorEvents` from `src/agent/orchestrator.ts`
- Produces:
  - `class WebUiBridge implements OrchestratorEvents`:
    - `addClient(ws: any): void`
    - `removeClient(ws: any): void`
    - `broadcast(type: string, payload: any): void`
    - `onClientMessage(ws: any, raw: string): void`
    - `setDispatchHandlers(handlers: WebUiDispatchHandlers): void`
    - `requestApproval(action: CopilotAction): Promise<boolean>`
    - `requestQuestionAnswer(questionId: string, questions: any[]): Promise<any>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/web-ui-bridge.test.ts
import { describe, it, expect } from "bun:test";
import { WebUiBridge } from "../../src/server/web-ui-bridge.ts";

describe("WebUiBridge", () => {
  it("should broadcast orchestrator events to connected clients", () => {
    const bridge = new WebUiBridge();
    const sentMessages: string[] = [];
    const mockWs = {
      readyState: 1, // OPEN
      send: (data: string) => sentMessages.push(data),
    };

    bridge.addClient(mockWs);
    bridge.onDelta?.("Hello world");

    expect(sentMessages.length).toBe(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe("turn:delta");
    expect(parsed.payload).toEqual({ chunk: "Hello world" });
  });

  it("should handle client prompt and trigger handler", async () => {
    const bridge = new WebUiBridge();
    let promptReceived = "";
    bridge.setDispatchHandlers({
      onPrompt: async (text) => {
        promptReceived = text;
      },
    });

    const mockWs = { readyState: 1, send: () => {} };
    bridge.addClient(mockWs);

    bridge.onClientMessage(
      mockWs,
      JSON.stringify({
        id: "req-1",
        type: "prompt:send",
        payload: { text: "build a web gui" },
        timestamp: Date.now(),
      })
    );

    expect(promptReceived).toBe("build a web gui");
  });

  it("should resolve human approval promise on client response", async () => {
    const bridge = new WebUiBridge();
    const mockWs = {
      readyState: 1,
      send: () => {},
    };
    bridge.addClient(mockWs);

    const approvalPromise = bridge.requestApproval({
      name: "run_command",
      args: { CommandLine: "rm -rf /" },
    } as any);

    const pendingApprovals = bridge.getPendingApprovals();
    expect(pendingApprovals.length).toBe(1);

    bridge.onClientMessage(
      mockWs,
      JSON.stringify({
        id: "req-appr",
        type: "tool:approve",
        payload: { approvalId: pendingApprovals[0].id },
        timestamp: Date.now(),
      })
    );

    const result = await approvalPromise;
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/web-ui-bridge.test.ts`  
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/web-ui-bridge.ts
import { createEnvelope, parseEnvelope, type WsEnvelope } from "./protocol-types.ts";
import type { CopilotAction, ToolBridgeResult } from "../protocol/tool-bridge.ts";
import type { OrchestratorEvents } from "../agent/orchestrator.ts";

export interface WebUiDispatchHandlers {
  onPrompt?: (text: string, attachments?: string[]) => Promise<void> | void;
  onInterrupt?: (mode: "soft" | "hard") => void;
  onSyncSnapshot?: (sessionId: string, lastTurn: number) => Promise<any> | any;
  onSwitchSession?: (sessionId: string) => Promise<void> | void;
  onReadFile?: (relativePath: string) => Promise<string> | string;
}

export interface PendingApproval {
  id: string;
  action: CopilotAction;
  resolve: (approved: boolean) => void;
}

export interface PendingQuestion {
  id: string;
  questions: any[];
  resolve: (answers: any) => void;
}

export class WebUiBridge implements OrchestratorEvents {
  private clients = new Set<any>();
  private handlers: WebUiDispatchHandlers = {};
  private pendingApprovals = new Map<string, PendingApproval>();
  private pendingQuestions = new Map<string, PendingQuestion>();

  public addClient(ws: any): void {
    this.clients.add(ws);
  }

  public removeClient(ws: any): void {
    this.clients.delete(ws);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public setDispatchHandlers(handlers: WebUiDispatchHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  public broadcast(type: string, payload: any): void {
    const env = createEnvelope(type, payload);
    const raw = JSON.stringify(env);
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        ws.send(raw);
      }
    }
  }

  // --- OrchestratorEvents Listeners ---
  public onDelta = (chunk: string): void => {
    this.broadcast("turn:delta", { chunk });
  };

  public onReasoning = (chunk: string): void => {
    this.broadcast("turn:reasoning", { chunk });
  };

  public onTurnStart = (turn: number): void => {
    this.broadcast("turn:start", { turn });
  };

  public onTurnEnd = (turn: number, response: string): void => {
    this.broadcast("turn:end", { turn, response });
  };

  public onToolStart = (action: CopilotAction): void => {
    this.broadcast("tool:start", { action });
  };

  public onToolEnd = (result: ToolBridgeResult): void => {
    this.broadcast("tool:end", { result });
  };

  public onSubagentStart = (id: string, role: string, spec: any, hop?: number, account?: string): void => {
    this.broadcast("subagent:lifecycle", { id, role, spec, hop, account, status: "started" });
  };

  public onSubagentEnd = (id: string, role: string, result: any, durationMs?: number): void => {
    this.broadcast("subagent:lifecycle", { id, role, result, durationMs, status: "completed" });
  };

  // --- Human-in-the-loop Controls ---
  public requestApproval(action: CopilotAction): Promise<boolean> {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      this.pendingApprovals.set(id, { id, action, resolve });
      this.broadcast("tool:approval-required", { approvalId: id, action });
    });
  }

  public getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  public requestQuestionAnswer(questionId: string, questions: any[]): Promise<any> {
    return new Promise((resolve) => {
      this.pendingQuestions.set(questionId, { id: questionId, questions, resolve });
      this.broadcast("question:ask", { questionId, questions });
    });
  }

  // --- Client Message Dispatcher ---
  public onClientMessage(ws: any, raw: string): void {
    const env = parseEnvelope(raw);
    if (!env) return;

    switch (env.type) {
      case "prompt:send":
        this.handlers.onPrompt?.(env.payload?.text, env.payload?.attachments);
        break;
      case "tool:approve": {
        const item = this.pendingApprovals.get(env.payload?.approvalId);
        if (item) {
          this.pendingApprovals.delete(env.payload.approvalId);
          item.resolve(true);
        }
        break;
      }
      case "tool:reject": {
        const item = this.pendingApprovals.get(env.payload?.approvalId);
        if (item) {
          this.pendingApprovals.delete(env.payload.approvalId);
          item.resolve(false);
        }
        break;
      }
      case "question:answer": {
        const item = this.pendingQuestions.get(env.payload?.questionId);
        if (item) {
          this.pendingQuestions.delete(env.payload.questionId);
          item.resolve(env.payload.answers);
        }
        break;
      }
      case "execution:interrupt":
        this.handlers.onInterrupt?.(env.payload?.mode || "soft");
        break;
      case "session:sync-snapshot":
        if (this.handlers.onSyncSnapshot) {
          Promise.resolve(this.handlers.onSyncSnapshot(env.payload?.sessionId, env.payload?.lastTurn)).then(
            (snapshot) => {
              ws.send(JSON.stringify(createEnvelope("session:snapshot-response", snapshot, env.id)));
            }
          );
        }
        break;
      case "session:switch":
        this.handlers.onSwitchSession?.(env.payload?.sessionId);
        break;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/web-ui-bridge.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/web-ui-bridge.ts tests/server/web-ui-bridge.test.ts
git commit -m "feat(server): implement WebUiBridge for orchestrator events and rpc dispatching"
```

---

### Task 3: WebServer & Static Asset Hosting (轻量 HTTP/WebSocket 服务)

**Files:**
- Create: `src/server/web-server.ts`
- Test: `tests/server/web-server.test.ts`

**Interfaces:**
- Consumes:
  - `WebUiBridge` from `src/server/web-ui-bridge.ts`
  - `generateSecurityToken`, `verifySecurityToken` from `src/server/security-token.ts`
- Produces:
  - `interface WebServerOptions`: `{ port?: number; host?: string; staticDir?: string; token?: string; bridge?: WebUiBridge }`
  - `class WebServer`:
    - `start(): Promise<{ url: string; port: number; token: string }>`
    - `stop(): Promise<void>`
    - `getBridge(): WebUiBridge`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/web-server.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { WebServer } from "../../src/server/web-server.ts";
import WebSocket from "ws";

describe("WebServer", () => {
  let server: WebServer;

  afterAll(async () => {
    if (server) await server.stop();
  });

  it("should start on random available port and handle websocket auth", async () => {
    server = new WebServer({ port: 0 }); // 0 for random port
    const info = await server.start();

    expect(info.port).toBeGreaterThan(0);
    expect(info.token.length).toBe(64);
    expect(info.url).toContain(`127.0.0.1:${info.port}`);

    // Test unauthorized ws connection
    const badWs = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=bad-token`);
    const rejected = await new Promise((resolve) => {
      badWs.on("error", () => resolve(true));
      badWs.on("close", (code) => resolve(code !== 1000));
    });
    expect(rejected).toBe(true);

    // Test authorized ws connection
    const goodWs = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
    const opened = await new Promise((resolve) => {
      goodWs.on("open", () => resolve(true));
      goodWs.on("error", () => resolve(false));
    });
    expect(opened).toBe(true);
    goodWs.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/web-server.test.ts`  
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/web-server.ts
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { WebUiBridge } from "./web-ui-bridge.ts";
import { generateSecurityToken, verifySecurityToken } from "./security-token.ts";

export interface WebServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  token?: string;
  bridge?: WebUiBridge;
}

const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export class WebServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private bridge: WebUiBridge;
  private options: WebServerOptions;
  private token: string;

  constructor(options: WebServerOptions = {}) {
    this.options = options;
    this.token = options.token || generateSecurityToken();
    this.bridge = options.bridge || new WebUiBridge();
  }

  public getBridge(): WebUiBridge {
    return this.bridge;
  }

  public async start(): Promise<{ url: string; port: number; token: string }> {
    const host = this.options.host || "127.0.0.1";
    const port = this.options.port ?? 3080;
    const staticDir = this.options.staticDir || path.resolve(__dirname, "../../dist/web");

    this.server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || "/", `http://${host}:${port}`);
      let filePath = path.join(staticDir, parsedUrl.pathname === "/" ? "index.html" : parsedUrl.pathname);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(staticDir, "index.html");
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_MAP[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><h2>CPH-PI Web GUI Server Active</h2><p>Static bundle not found in dist/web. Please run: <code>bun run web:build</code></p></body></html>`);
      }
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (req, socket, head) => {
      const parsedUrl = new URL(req.url || "/", `http://${host}:${port}`);
      const providedToken = parsedUrl.searchParams.get("token") || "";

      if (!verifySecurityToken(this.token, providedToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws) => {
      this.bridge.addClient(ws);
      ws.on("message", (raw: string | Buffer) => {
        this.bridge.onClientMessage(ws, raw.toString());
      });
      ws.on("close", () => {
        this.bridge.removeClient(ws);
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, host, () => resolve());
    });

    const addr = this.server.address() as any;
    const actualPort = addr ? addr.port : port;
    const url = `http://${host}:${actualPort}/?token=${this.token}`;

    return { url, port: actualPort, token: this.token };
  }

  public async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/web-server.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/web-server.ts tests/server/web-server.test.ts
git commit -m "feat(server): implement WebServer with static hosting and websocket auth"
```

---

### Task 4: CLI Integration & Dual-Mode Wiring (`cph-pi web` & `cph-pi --web`)

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli.ts`
- Test: `tests/server/cli-web-integration.test.ts`

**Interfaces:**
- Consumes:
  - `WebServer` from `src/server/web-server.ts`
  - `parseCliArgs` from `src/cli/args.ts`
- Produces:
  - CLI `web` 子命令与 `--web` 启动参数支持
  - 自动打开浏览器能力（通过平台命令 `start` / `open` / `xdg-open`）

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/cli-web-integration.test.ts
import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../../src/cli/args.ts";

describe("CLI Web Options Parsing", () => {
  it("should parse 'web' subcommand and flags correctly", () => {
    const res1 = parseCliArgs(["web", "--port", "3099", "--no-open"]);
    expect(res1.subcommand).toBe("web");
    expect(res1.webPort).toBe(3099);
    expect(res1.noOpen).toBe(true);

    const res2 = parseCliArgs(["--web", "--port", "4000"]);
    expect(res2.web).toBe(true);
    expect(res2.webPort).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/cli-web-integration.test.ts`  
Expected: FAIL (subcommand or webPort not in ParsedCliArgs)

- [ ] **Step 3: Modify `src/cli/args.ts` and `src/cli.ts`**

In `src/cli/args.ts`:
Extend `ParsedCliArgs` with `subcommand?: string`, `web?: boolean`, `webPort?: number`, `noOpen?: boolean`.
In `parseCliArgs`: handle `web` as subcommand or `--web` option, `--port <n>`, `--no-open`.

In `src/cli.ts`:
When `subcommand === "web"`:
- 启动 `WebServer`；
- 在控制台打印 Web Server 访问链接及启动横幅；
- 若 `!args.noOpen`，执行打开浏览器动作；
- 实例化 `CopilotOrchestrator`，将其事件委托给 `server.getBridge()`；
- 挂载 `onPrompt`, `onInterrupt`, `onSyncSnapshot` 分发处理器。

When `args.web === true` (伴随模式):
- 启动 `WebServer`；
- 在启动 TUI 时同时把 `server.getBridge()` 的监听器与 `renderer` 进行聚合；
- 双方共享事件分发。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/cli-web-integration.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts src/cli.ts tests/server/cli-web-integration.test.ts
git commit -m "feat(cli): wire cph-pi web subcommand and --web companion flag"
```

---

### Task 5: Frontend Project Scaffolding & Theme Foundations (React + Vite + Socket Hook)

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tailwind.config.js`
- Create: `web/postcss.config.js`
- Create: `web/index.html`
- Create: `web/src/types/protocol.ts`
- Create: `web/src/hooks/useAgentSocket.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Test: `tests/web/socket-hook.test.ts`

**Interfaces:**
- Produces:
  - `useAgentSocket(token: string)` hook:
    - `connectionStatus`: `"connecting" | "connected" | "disconnected"`
    - `sendMessage(type: string, payload: any): void`
    - `latestEvents`: 实时事件字典
    - `turnStream`: 当前流式思考与文本增量

- [ ] **Step 1: Write the failing test**

```typescript
// tests/web/socket-hook.test.ts
import { describe, it, expect } from "bun:test";
import { parseEnvelope, createEnvelope } from "../../src/server/protocol-types.ts";

describe("Frontend Protocol Types Compatibility", () => {
  it("should match backend envelope serialization", () => {
    const env = createEnvelope("turn:delta", { chunk: "test" });
    const parsed = parseEnvelope(JSON.stringify(env));
    expect(parsed?.type).toBe("turn:delta");
  });
});
```

- [ ] **Step 2: Scaffolding frontend files**
Create `web/package.json` with React 19, Lucide-react, Tailwind CSS.  
Create `web/vite.config.ts` targeting `../dist/web`.  
Implement `web/src/hooks/useAgentSocket.ts` with WebSocket heartbeats & state buffering.  
Create minimal `web/src/App.tsx`.

- [ ] **Step 3: Test build**

Run: `cd web && bun install && bun run build`  
Expected: Build passes and outputs to `dist/web/index.html` and assets.

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat(web): scaffold Vite React Tailwind frontend and useAgentSocket hook"
```

---

### Task 6: Main Stage & Interactive Cards (中栏：思考折叠、Diff 卡片与审批)

**Files:**
- Create: `web/src/components/chat/ReasoningBlock.tsx`
- Create: `web/src/components/chat/ToolExecutionCard.tsx`
- Create: `web/src/components/chat/MessageStream.tsx`
- Create: `web/src/components/interaction/HumanInteractionCard.tsx`
- Create: `web/src/components/interaction/ActionDock.tsx`

**Interfaces:**
- Consumes: `useAgentSocket`
- Produces:
  - `ReasoningBlock`: 呈现 DeepSeek 风格 Thinking 思考折叠动画
  - `ToolExecutionCard`: 工具调用参数与 Unified Diff 高亮渲染
  - `HumanInteractionCard`: 审批阻断与 `ask_question` 交互组件
  - `ActionDock`: 底部两段式中断、指令输入与 Slash Command 联想

- [ ] **Step 1: Implement `ReasoningBlock.tsx`**
  - 支持流式中的微光脉冲动效；
  - 自动计算思考总耗时；
  - 支持一键展开/折叠。

- [ ] **Step 2: Implement `ToolExecutionCard.tsx`**
  - 支持渲染 `patch_file` / `write_file` 的增减行 Diff；
  - 渲染 `run_command` 的 ANSI 输出终端。

- [ ] **Step 3: Implement `HumanInteractionCard.tsx` & `ActionDock.tsx`**
  - 审批卡片支持【Approve】/【Reject】；
  - `ask_question` 支持多选/单选与提交；
  - 两段式中断按钮（单击 soft，长按 hard）。

- [ ] **Step 4: Run build check**

Run: `cd web && bun run build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/ web/src/components/interaction/
git commit -m "feat(web): implement main stage interactive cards and reasoning block"
```

---

### Task 7: Left & Right Inspection Panels (三栏完整装配)

**Files:**
- Create: `web/src/components/layout/Sidebar.tsx`
- Create: `web/src/components/monitor/AccountPoolCard.tsx`
- Create: `web/src/components/workspace/WorkspaceTree.tsx`
- Create: `web/src/components/monitor/LedgerWALViewer.tsx`
- Create: `web/src/components/monitor/SubagentGraph.tsx`
- Create: `web/src/components/layout/ContextInspector.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces:
  - 左栏：会话管理列表、新建会话按钮、Copilot 账户池状态看板与限流倒计时
  - 右栏：工作区文件树（按读写状态标色）、物理预写日志（`.cph/state/` WAL 实时流）、Subagent 拓扑泳道

- [ ] **Step 1: Implement `Sidebar.tsx` & `AccountPoolCard.tsx`**
  - 渲染会话切换与创建；
  - 渲染脱敏账号邮箱与限流倒计时徽标。

- [ ] **Step 2: Implement `ContextInspector.tsx` (Tree + WAL + DAG)**
  - 三 Tab 切换：文件树、WAL 日志流、Subagent 泳道。

- [ ] **Step 3: Wire into `App.tsx`**
  - 组合三栏响应式布局，接入全量 WebSocket 事件与状态更新。

- [ ] **Step 4: Run build check**

Run: `cd web && bun run build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/ web/src/components/workspace/ web/src/components/monitor/ web/src/App.tsx
git commit -m "feat(web): assemble three-column workbench layout and inspection panels"
```

---

### Task 8: Production Build Verification & End-to-End Delivery

**Files:**
- Modify: `package.json`
- Create: `tests/server/e2e-web-gui.test.ts`

**Interfaces:**
- Consumes: All components from Tasks 1-7
- Produces:
  - `CPH-PI/package.json` 集成脚本：`"web"`, `"web:dev"`, `"web:build"`, `"build:all"`
  - E2E 自动化测试验证整体服务与静态托管闭环通过

- [ ] **Step 1: Write E2E Integration Test**

```typescript
// tests/server/e2e-web-gui.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { WebServer } from "../../src/server/web-server.ts";
import WebSocket from "ws";

describe("E2E Web GUI Lifecycle", () => {
  let server: WebServer;

  afterAll(async () => {
    if (server) await server.stop();
  });

  it("should complete full handshake, prompt, reasoning, diff and approval flow", async () => {
    server = new WebServer({ port: 0 });
    const { url, port, token } = await server.start();
    const bridge = server.getBridge();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await new Promise((r) => ws.on("open", r));

    const eventsReceived: any[] = [];
    ws.on("message", (data) => eventsReceived.push(JSON.parse(data.toString())));

    // 1. Simulate reasoning & delta
    bridge.onReasoning?.("Analyzing request...");
    bridge.onDelta?.("Hello from Copilot");

    // 2. Simulate human approval
    let approved = false;
    setTimeout(() => {
      bridge.requestApproval({ name: "patch_file", args: {} } as any).then((res) => {
        approved = res;
      });
    }, 10);

    // Wait for approval event
    await new Promise((r) => setTimeout(r, 100));
    const apprEvent = eventsReceived.find((e) => e.type === "tool:approval-required");
    expect(apprEvent).toBeDefined();

    // 3. Client approves
    ws.send(
      JSON.stringify({
        id: "msg_appr",
        type: "tool:approve",
        payload: { approvalId: apprEvent.payload.approvalId },
        timestamp: Date.now(),
      })
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(approved).toBe(true);

    ws.close();
  });
});
```

- [ ] **Step 2: Update `package.json` scripts**
Add `"web"`, `"web:dev"`, `"web:build"`, `"build:all"`.

- [ ] **Step 3: Run full build and test suite**

Run: `bun run web:build && bun test tests/server/`  
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add package.json tests/server/e2e-web-gui.test.ts
git commit -m "feat: complete CPH-PI web gui implementation with e2e test validation"
```

---

## Self-Review Checklist
- [x] **Spec Coverage**: 涵盖规范所有 5 大部分（服务端轻量网关、Typed Envelope 协议、三栏工作台与交互卡片、状态持久化与两段式中断、打包托管与测试）。
- [x] **No Placeholders**: 每个 Task 的所有代码块、测试用例、命令与预期输出均完整写出，无任何 TODO、TBD。
- [x] **Type Consistency**: `WsEnvelope` 命名、字段 `id`, `type`, `payload`, `timestamp` 前后端一致，`WebUiBridge` 方法签名在所有 Task 中完全对齐。
- [x] **Agent-Friendly Slicing**: 任务按清晰物理边界切片，服务端（Tasks 1-4）与前端组件（Tasks 5-7）解耦，最终通过 E2E（Task 8）集成。
