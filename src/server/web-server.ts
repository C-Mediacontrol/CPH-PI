import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { WebUiBridge } from "./web-ui-bridge.ts";
import { generateSecurityToken, verifySecurityToken } from "./security-token.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export class WebServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private bridge: WebUiBridge;
  private options: WebServerOptions;
  private token: string;
  private actualPort: number | null = null;

  constructor(options: WebServerOptions = {}) {
    this.options = options;
    this.token = options.token || generateSecurityToken();
    this.bridge = options.bridge || new WebUiBridge();
  }

  public getBridge(): WebUiBridge {
    return this.bridge;
  }

  public getPort(): number {
    return this.actualPort ?? this.options.port ?? 3080;
  }

  public getToken(): string {
    return this.token;
  }

  public getUrl(): string {
    const host = this.options.host || "127.0.0.1";
    return `http://${host}:${this.getPort()}/?token=${this.token}`;
  }

  public async start(): Promise<{ url: string; port: number; token: string }> {
    const host = this.options.host || "127.0.0.1";
    const requestedPort = this.options.port !== undefined ? this.options.port : 3080;
    const staticDir = this.options.staticDir
      ? path.resolve(this.options.staticDir)
      : path.resolve(__dirname, "../../dist/web");

    this.server = http.createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
      }

      const rawUrl = req.url || "/";
      let decodedRaw = rawUrl;
      try {
        decodedRaw = decodeURIComponent(rawUrl);
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad Request");
        return;
      }

      // Check for directory traversal attempts in request path
      const rawPath = decodedRaw.split(/[?#]/)[0];
      const segments = rawPath.split(/[\/\\]/);
      if (segments.includes("..") || rawUrl.toLowerCase().includes("%2e%2e")) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      let reqPathname = "/";
      try {
        const parsedUrl = new URL(rawUrl, `http://${host}:${this.getPort()}`);
        reqPathname = decodeURIComponent(parsedUrl.pathname);
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad Request");
        return;
      }

      // Strip null bytes
      reqPathname = reqPathname.replace(/\0/g, "");

      // Normalize path and verify it stays inside staticDir
      const relativePath = path.normalize(reqPathname).replace(/^(\.\.[\/\\])+/, "");
      let targetPath = path.resolve(staticDir, "." + relativePath);

      const relative = path.relative(staticDir, targetPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      // If directory, check for index.html inside
      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) {
            const potentialIndex = path.join(targetPath, "index.html");
            if (fs.existsSync(potentialIndex)) {
              targetPath = potentialIndex;
            }
          }
        } catch {}
      }

      // If file exists, serve it
      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isFile()) {
            const ext = path.extname(targetPath).toLowerCase();
            const contentType = MIME_MAP[ext] || "application/octet-stream";
            res.writeHead(200, {
              "Content-Type": contentType,
              "Content-Length": stat.size,
            });
            if (req.method === "HEAD") {
              res.end();
            } else {
              fs.createReadStream(targetPath).pipe(res);
            }
            return;
          }
        } catch {}
      }

      // SPA Fallback: serve index.html if it exists in staticDir
      const fallbackIndex = path.join(staticDir, "index.html");
      if (fs.existsSync(fallbackIndex)) {
        try {
          const stat = fs.statSync(fallbackIndex);
          if (stat.isFile()) {
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": stat.size,
            });
            if (req.method === "HEAD") {
              res.end();
            } else {
              fs.createReadStream(fallbackIndex).pipe(res);
            }
            return;
          }
        } catch {}
      }

      // Informative fallback HTML when index.html does not exist
      const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CPH-PI Web GUI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; line-height: 1.6; }
    .card { max-width: 600px; margin: 4rem auto; background: #1e293b; padding: 2rem; border-radius: 8px; border: 1px solid #334155; }
    h2 { margin-top: 0; color: #38bdf8; }
    code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; color: #38bdf8; font-family: monospace; }
  </style>
</head>
<body>
  <div class="card">
    <h2>CPH-PI Web GUI Server Active</h2>
    <p>Static bundle not found in <code>dist/web</code>. The server is running and ready for WebSocket connections.</p>
    <p>To build the web frontend assets, please run:</p>
    <pre><code>bun run web:build</code></pre>
  </div>
</body>
</html>`;

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(fallbackHtml),
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(fallbackHtml);
      }
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (req, socket, head) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(req.url || "/", `http://${host}:${this.getPort()}`);
      } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      // Intercept /ws or root path upgrade
      if (parsedUrl.pathname !== "/ws" && parsedUrl.pathname !== "/") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const providedToken = parsedUrl.searchParams.get("token") || "";
      if (!verifySecurityToken(this.token, providedToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      if (!this.wss) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws: WebSocket) => {
      this.bridge.addClient(ws);

      ws.on("message", (raw: string | Buffer) => {
        try {
          this.bridge.onClientMessage(ws, raw.toString());
        } catch {}
      });

      const cleanup = () => {
        this.bridge.removeClient(ws);
      };

      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(requestedPort, host, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });

    const addr = this.server.address();
    this.actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
    const url = this.getUrl();

    return { url, port: this.actualPort, token: this.token };
  }

  public async stop(): Promise<void> {
    if (this.wss) {
      for (const client of this.wss.clients) {
        try {
          client.terminate();
        } catch {}
      }
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.server) {
      if (typeof (this.server as any).closeAllConnections === "function") {
        (this.server as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }
}
