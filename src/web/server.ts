import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { serveStatic } from "./static-handler.ts";
import { RpcHandler } from "./rpc-handler.ts";

export interface WebServerOptions {
  port: number;
  host: string;
  autoOpen?: boolean;
  distDir?: string;
  workspaceRoot?: string | null;
  orchestrator?: any;
  sessionManager?: any;
  pool?: any;
  cliApp?: any;
  skillRegistry?: any;
  debug?: boolean;
  debugLogPath?: string;
  maxAutonomousHandoffHops?: number;
  graphTokenProvider?: () => Promise<string>;
}

export interface WebServerInstance {
  server: http.Server;
  wss: WebSocketServer;
}

export type WebServerResult = Promise<WebServerInstance> & WebServerInstance;

export function resolveWebDistDir(customDir?: string, baseDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }

  const current =
    baseDir ||
    (typeof (import.meta as any).dir === "string"
      ? (import.meta as any).dir
      : path.dirname(fileURLToPath(import.meta.url)));

  const candidates = [
    customDir,
    path.resolve(current, "../../web/dist"),
    path.resolve(current, "../web/dist"),
    path.resolve(current, "../../../web/dist"),
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(process.cwd(), "CPH-PI/web/dist"),
    path.resolve(current, "web/dist"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(path.resolve(candidate, "index.html"))) {
      return path.resolve(candidate);
    }
  }

  return customDir || path.resolve(current, "../../web/dist");
}

/**
 * Start the embedded CPH-PI HTTP and WebSocket server.
 */
export function startWebServer(options: WebServerOptions): WebServerResult {
  const distDir = resolveWebDistDir(options.distDir);

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    let pathname = "/";
    try {
      const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      pathname = parsed.pathname;
    } catch {
      pathname = req.url || "/";
    }

    // Health check endpoint
    if (pathname === "/api/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
      return;
    }

    // Serve static files with SPA fallback
    const handled = serveStatic(req, res, distDir);
    if (!handled) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url || "", `http://${request.headers.host || "localhost"}`).pathname;
    } catch {
      pathname = request.url || "";
    }

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    new RpcHandler(ws, {
      workspaceRoot: options.workspaceRoot,
      orchestrator: options.orchestrator,
      sessionManager: options.sessionManager,
      pool: options.pool,
      cliApp: options.cliApp,
      skillRegistry: options.skillRegistry,
      debug: options.debug,
      debugLogPath: options.debugLogPath,
      maxAutonomousHandoffHops:
        options.maxAutonomousHandoffHops ??
        options.cliApp?.maxAutonomousHandoffHops,
      graphTokenProvider:
        options.graphTokenProvider ?? options.cliApp?.graphTokenProvider,
    });
  });

  const promise = new Promise<WebServerInstance>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      if (options.autoOpen) {
        const targetHost =
          options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
        const url = `http://${targetHost}:${options.port}`;
        const startCmd =
          process.platform === "darwin"
            ? `open "${url}"`
            : process.platform === "win32"
            ? `cmd.exe /c start "" "${url}"`
            : `xdg-open "${url}"`;
        try {
          exec(startCmd, () => {});
        } catch {
          // ignore auto-open failures
        }
      }
      resolve({ server, wss });
    });
  });

  return Object.assign(promise, { server, wss });
}

/**
 * Stop the embedded CPH-PI HTTP and WebSocket server gracefully.
 */
export async function stopWebServer(instance: {
  server: http.Server;
  wss: WebSocketServer;
}): Promise<void> {
  if (!instance) return;
  const { server, wss } = instance;

  if (wss) {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  if (server) {
    await new Promise<void>((resolve) => {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
      server.close(() => resolve());
    });
  }
}
