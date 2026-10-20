import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import WebSocket from "ws";
import { WebServer } from "../../src/server/web-server.ts";
import { WebUiBridge } from "../../src/server/web-ui-bridge.ts";
import { createEnvelope, parseEnvelope } from "../../src/server/protocol-types.ts";

describe("WebServer", () => {
  let server: WebServer | null = null;
  let tempDir: string = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-pi-webserver-test-"));
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("should start on random available port and provide accessors", async () => {
    server = new WebServer({ port: 0 });
    const info = await server.start();

    expect(info.port).toBeGreaterThan(0);
    expect(info.token.length).toBe(64);
    expect(info.url).toContain(`127.0.0.1:${info.port}`);
    expect(info.url).toContain(`token=${info.token}`);

    expect(server.getPort()).toBe(info.port);
    expect(server.getToken()).toBe(info.token);
    expect(server.getUrl()).toBe(info.url);
    expect(server.getBridge()).toBeInstanceOf(WebUiBridge);
  });

  it("should serve static assets with correct MIME types", async () => {
    fs.writeFileSync(path.join(tempDir, "index.html"), "<h1>Hello Index</h1>", "utf-8");
    fs.writeFileSync(path.join(tempDir, "app.js"), "console.log('app');", "utf-8");
    fs.writeFileSync(path.join(tempDir, "style.css"), "body { color: red; }", "utf-8");
    fs.writeFileSync(path.join(tempDir, "data.json"), '{"key":"value"}', "utf-8");
    fs.writeFileSync(path.join(tempDir, "logo.svg"), "<svg></svg>", "utf-8");
    fs.writeFileSync(path.join(tempDir, "icon.ico"), "fake-ico-content", "utf-8");

    server = new WebServer({ port: 0, staticDir: tempDir });
    const info = await server.start();

    // GET / (index.html)
    const resRoot = await fetch(`http://127.0.0.1:${info.port}/`);
    expect(resRoot.status).toBe(200);
    expect(resRoot.headers.get("content-type")).toContain("text/html");
    expect(await resRoot.text()).toBe("<h1>Hello Index</h1>");

    // GET /app.js
    const resJs = await fetch(`http://127.0.0.1:${info.port}/app.js`);
    expect(resJs.status).toBe(200);
    expect(resJs.headers.get("content-type")).toContain("application/javascript");
    expect(await resJs.text()).toBe("console.log('app');");

    // GET /style.css
    const resCss = await fetch(`http://127.0.0.1:${info.port}/style.css`);
    expect(resCss.status).toBe(200);
    expect(resCss.headers.get("content-type")).toContain("text/css");
    expect(await resCss.text()).toBe("body { color: red; }");

    // GET /data.json
    const resJson = await fetch(`http://127.0.0.1:${info.port}/data.json`);
    expect(resJson.status).toBe(200);
    expect(resJson.headers.get("content-type")).toContain("application/json");
    expect(await resJson.text()).toBe('{"key":"value"}');

    // GET /logo.svg
    const resSvg = await fetch(`http://127.0.0.1:${info.port}/logo.svg`);
    expect(resSvg.status).toBe(200);
    expect(resSvg.headers.get("content-type")).toContain("image/svg+xml");

    // GET /icon.ico
    const resIco = await fetch(`http://127.0.0.1:${info.port}/icon.ico`);
    expect(resIco.status).toBe(200);
    expect(resIco.headers.get("content-type")).toContain("image/x-icon");
  });

  it("should support SPA fallback when requested path does not exist", async () => {
    fs.writeFileSync(path.join(tempDir, "index.html"), "<h1>SPA Root</h1>", "utf-8");

    server = new WebServer({ port: 0, staticDir: tempDir });
    const info = await server.start();

    const resSpa = await fetch(`http://127.0.0.1:${info.port}/sessions/cph-session-12345`);
    expect(resSpa.status).toBe(200);
    expect(resSpa.headers.get("content-type")).toContain("text/html");
    expect(await resSpa.text()).toBe("<h1>SPA Root</h1>");
  });

  it("should serve informative fallback HTML when index.html does not exist", async () => {
    // Empty directory, no index.html
    server = new WebServer({ port: 0, staticDir: tempDir });
    const info = await server.start();

    const res = await fetch(`http://127.0.0.1:${info.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("CPH-PI Web GUI");
    expect(body).toContain("dist/web");
  });

  it("should block directory traversal attacks outside staticDir", async () => {
    fs.writeFileSync(path.join(tempDir, "index.html"), "<h1>Safe</h1>", "utf-8");

    server = new WebServer({ port: 0, staticDir: tempDir });
    const info = await server.start();

    // 1. Raw HTTP request with /../../
    const status1 = await new Promise<number>((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port: info.port,
          path: "/../../package.json",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        }
      );
      req.on("error", reject);
    });
    expect(status1).toBe(403);

    // 2. Encoded traversal with %2e%2e
    const status2 = await new Promise<number>((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port: info.port,
          path: "/%2e%2e/%2e%2e/package.json",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        }
      );
      req.on("error", reject);
    });
    expect(status2).toBe(403);
  });

  it("should reject unauthorized WebSocket connections (missing or invalid token)", async () => {
    server = new WebServer({ port: 0 });
    const info = await server.start();

    // 1. Bad token
    const badWs = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=bad-token-12345`);
    const rejectedBad = await new Promise<boolean>((resolve) => {
      badWs.on("error", () => resolve(true));
      badWs.on("close", (code) => resolve(code !== 1000));
      badWs.on("open", () => resolve(false));
    });
    expect(rejectedBad).toBe(true);

    // 2. Missing token
    const noTokenWs = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
    const rejectedNoToken = await new Promise<boolean>((resolve) => {
      noTokenWs.on("error", () => resolve(true));
      noTokenWs.on("close", (code) => resolve(code !== 1000));
      noTokenWs.on("open", () => resolve(false));
    });
    expect(rejectedNoToken).toBe(true);
  });

  it("should accept authorized WebSocket connections on /ws or / with valid token", async () => {
    server = new WebServer({ port: 0 });
    const info = await server.start();

    // 1. Authorized on /ws
    const ws1 = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
    const opened1 = await new Promise<boolean>((resolve) => {
      ws1.on("open", () => resolve(true));
      ws1.on("error", () => resolve(false));
    });
    expect(opened1).toBe(true);
    expect(server.getBridge().getClientCount()).toBe(1);

    // 2. Authorized on /
    const ws2 = new WebSocket(`ws://127.0.0.1:${info.port}/?token=${info.token}`);
    const opened2 = await new Promise<boolean>((resolve) => {
      ws2.on("open", () => resolve(true));
      ws2.on("error", () => resolve(false));
    });
    expect(opened2).toBe(true);
    expect(server.getBridge().getClientCount()).toBe(2);

    ws1.close();
    ws2.close();

    // Wait for client close to propagate
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getBridge().getClientCount()).toBe(0);
  });

  it("should exchange bi-directional messages between client and bridge", async () => {
    const bridge = new WebUiBridge();
    server = new WebServer({ port: 0, bridge });
    const info = await server.start();

    let receivedPromptText = "";
    bridge.setDispatchHandlers({
      onPrompt: (text) => {
        receivedPromptText = text;
      },
    });

    const client = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => resolve());
      client.on("error", reject);
    });

    // Client -> Server: prompt:send
    const promptMsg = createEnvelope("prompt:send", { text: "Hello CPH-PI Server!" });
    client.send(JSON.stringify(promptMsg));

    // Wait for handler to receive message
    await new Promise((r) => setTimeout(r, 50));
    expect(receivedPromptText).toBe("Hello CPH-PI Server!");

    // Server -> Client: broadcast
    const receivedMessages: any[] = [];
    client.on("message", (data) => {
      receivedMessages.push(parseEnvelope(data.toString()));
    });

    bridge.broadcast("turn:delta", { chunk: "Delta stream chunk" });

    await new Promise((r) => setTimeout(r, 50));
    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].type).toBe("turn:delta");
    expect(receivedMessages[0].payload.chunk).toBe("Delta stream chunk");

    // Approval flow over real socket
    const approvalPromise = bridge.requestApproval({
      tool: "bash",
      input: { command: "npm test" },
    });

    await new Promise((r) => setTimeout(r, 50));
    // Client should have received tool:approval-required
    expect(receivedMessages.length).toBe(2);
    expect(receivedMessages[1].type).toBe("tool:approval-required");
    const approvalId = receivedMessages[1].payload.approvalId;

    // Client approves
    client.send(
      JSON.stringify(
        createEnvelope("tool:approve", { approvalId })
      )
    );

    const approved = await approvalPromise;
    expect(approved).toBe(true);

    client.close();
  });

  it("should stop cleanly and terminate active sockets", async () => {
    server = new WebServer({ port: 0 });
    const info = await server.start();

    const client = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
    await new Promise<void>((resolve) => {
      client.on("open", () => resolve());
    });

    await server.stop();
    server = null;

    // Client should be closed/disconnected
    const isClosed = await new Promise<boolean>((resolve) => {
      if (client.readyState === WebSocket.CLOSED) return resolve(true);
      client.on("close", () => resolve(true));
      setTimeout(() => resolve(client.readyState === WebSocket.CLOSED), 100);
    });
    expect(isClosed).toBe(true);

    // HTTP should fail
    let fetchFailed = false;
    try {
      await fetch(`http://127.0.0.1:${info.port}/`);
    } catch {
      fetchFailed = true;
    }
    expect(fetchFailed).toBe(true);
  });
});
