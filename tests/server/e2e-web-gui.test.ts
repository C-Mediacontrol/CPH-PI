import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { WebServer } from "../../src/server/web-server.ts";
import { WebUiBridge } from "../../src/server/web-ui-bridge.ts";
import {
  createEnvelope,
  parseEnvelope,
  type WsEnvelope,
} from "../../src/server/protocol-types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Robust WebSocket test client with queued message support to eliminate race conditions
 */
class TestWsClient {
  private ws: WebSocket;
  private messageQueue: WsEnvelope[] = [];
  private waiters: Array<{
    predicate: (env: WsEnvelope) => boolean;
    resolve: (env: WsEnvelope) => void;
    reject: (err: Error) => void;
    timer: any;
  }> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (data) => {
      const raw = data.toString();
      const env = parseEnvelope(raw);
      if (!env) return;

      const waiterIdx = this.waiters.findIndex((w) => w.predicate(env));
      if (waiterIdx >= 0) {
        const [waiter] = this.waiters.splice(waiterIdx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(env);
      } else {
        this.messageQueue.push(env);
      }
    });
  }

  public sendEnvelope(type: string, payload: any, id?: string): void {
    const env = createEnvelope(type, payload, id);
    this.ws.send(JSON.stringify(env));
  }

  public waitForEnvelope(
    predicate: (env: WsEnvelope) => boolean,
    timeoutMs = 4000
  ): Promise<WsEnvelope> {
    const queueIdx = this.messageQueue.findIndex(predicate);
    if (queueIdx >= 0) {
      const [msg] = this.messageQueue.splice(queueIdx, 1);
      return Promise.resolve(msg);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timeout after ${timeoutMs}ms waiting for envelope`));
      }, timeoutMs);

      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  public close(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Client closed"));
    }
    this.waiters = [];
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  public get readyState(): number {
    return this.ws.readyState;
  }
}

describe("E2E Web GUI Lifecycle & Production Delivery (Task 8)", () => {
  let server: WebServer | null = null;
  let client: TestWsClient | null = null;
  const distWebDir = path.resolve(__dirname, "../../dist/web");

  afterEach(async () => {
    if (client) {
      client.close();
      client = null;
    }
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("should complete the full E2E lifecycle (Startup -> WebSocket Auth -> Streaming -> HITL -> Snapshot -> Interrupt -> Static HTTP -> Clean Stop)", async () => {
    // 0. Ensure production bundle exists
    expect(fs.existsSync(path.join(distWebDir, "index.html"))).toBe(true);

    // 1. Launch WebServer on port 0 with auth token
    const bridge = new WebUiBridge();
    server = new WebServer({
      port: 0,
      bridge,
      staticDir: distWebDir,
    });
    const info = await server.start();

    expect(info.port).toBeGreaterThan(0);
    expect(info.token).toBeDefined();
    expect(info.token.length).toBe(64);
    expect(info.url).toContain(`127.0.0.1:${info.port}`);
    expect(info.url).toContain(`token=${info.token}`);

    // Set up bridge dispatch handlers
    const interruptEvents: Array<"soft" | "hard"> = [];
    let receivedPromptText = "";
    bridge.setDispatchHandlers({
      onPrompt: (text) => {
        receivedPromptText = text;
      },
      onInterrupt: (mode) => {
        interruptEvents.push(mode);
      },
      onSyncSnapshot: async (sessionId, lastTurn) => {
        return {
          sessionId: sessionId || "sess-e2e-lifecycle",
          lastTurn: lastTurn ?? 0,
          status: "running",
          messages: [
            { id: "m1", role: "user", content: "Build production GUI" },
            { id: "m2", role: "assistant", content: "Working on it..." },
          ],
          workspaceFiles: ["package.json", "src/cli.ts", "dist/web/index.html"],
        };
      },
    });

    // 2. Connect client WebSocket with ?token=${token}
    const wsUrl = `ws://127.0.0.1:${info.port}/ws?token=${info.token}`;
    const rawWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      rawWs.on("open", () => resolve());
      rawWs.on("error", reject);
    });
    client = new TestWsClient(rawWs);
    expect(bridge.getClientCount()).toBe(1);

    // 3. Verify server sends / handles events:

    // 3a. turn:reasoning (streaming thinking chunk)
    const reasoningChunk = "Analyzing project dependencies and production bundles...";
    bridge.onReasoning(reasoningChunk);
    const reasoningEnv = await client.waitForEnvelope((e) => e.type === "turn:reasoning");
    expect(reasoningEnv.type).toBe("turn:reasoning");
    expect(reasoningEnv.payload.chunk).toBe(reasoningChunk);

    // 3b. turn:delta (streaming markdown content)
    const deltaChunk = "### Verification Steps\n1. Check static assets\n2. Verify WebSocket events";
    bridge.onDelta(deltaChunk);
    const deltaEnv = await client.waitForEnvelope((e) => e.type === "turn:delta");
    expect(deltaEnv.type).toBe("turn:delta");
    expect(deltaEnv.payload.chunk).toBe(deltaChunk);

    // 3c. tool:start and tool:end with Unified Diff payload
    const unifiedDiff = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,4 +1,4 @@",
      " const PORT = 3000;",
      "-const DEBUG = false;",
      "+const DEBUG = true;",
      " export default PORT;",
    ].join("\n");

    bridge.onToolStart({
      tool: "edit",
      input: {
        path: "src/app.ts",
        diff: unifiedDiff,
      },
    });
    const toolStartEnv = await client.waitForEnvelope((e) => e.type === "tool:start");
    expect(toolStartEnv.type).toBe("tool:start");
    expect(toolStartEnv.payload.action.tool).toBe("edit");
    expect(toolStartEnv.payload.action.input.diff).toBe(unifiedDiff);

    bridge.onToolEnd({
      tool: "edit",
      success: true,
      output: unifiedDiff,
    });
    const toolEndEnv = await client.waitForEnvelope((e) => e.type === "tool:end");
    expect(toolEndEnv.type).toBe("tool:end");
    expect(toolEndEnv.payload.result.tool).toBe("edit");
    expect(toolEndEnv.payload.result.success).toBe(true);
    expect(toolEndEnv.payload.result.output).toBe(unifiedDiff);

    // 3d. tool:approval-required -> client sends tool:approve -> bridge resolves true
    const approvalPromise = bridge.requestApproval({
      tool: "bash",
      input: { command: "bun test tests/server/" },
    });
    const approvalEnv = await client.waitForEnvelope((e) => e.type === "tool:approval-required");
    expect(approvalEnv.type).toBe("tool:approval-required");
    const approvalId = approvalEnv.payload.approvalId || approvalEnv.payload.id;
    expect(approvalId).toBeDefined();
    expect(approvalEnv.payload.action.tool).toBe("bash");

    client.sendEnvelope("tool:approve", { approvalId });
    const approved = await approvalPromise;
    expect(approved).toBe(true);

    // 3e. question:ask -> client sends question:answer -> bridge resolves answers
    const questionPromise = bridge.requestQuestionAnswer("q-e2e-delivery-01", [
      {
        question: "Select target deployment tier",
        options: ["canary", "production"],
        is_multi_select: false,
      },
    ]);
    const questionEnv = await client.waitForEnvelope((e) => e.type === "question:ask");
    expect(questionEnv.type).toBe("question:ask");
    const questionId = questionEnv.payload.questionId || questionEnv.payload.id;
    expect(questionId).toBe("q-e2e-delivery-01");
    expect(questionEnv.payload.questions).toHaveLength(1);

    client.sendEnvelope("question:answer", {
      questionId,
      answers: { 0: "production" },
    });
    const answered = await questionPromise;
    expect(answered).toEqual({ 0: "production" });

    // 3f. session:sync-snapshot -> client receives session:snapshot-response
    client.sendEnvelope("session:sync-snapshot", {
      sessionId: "sess-e2e-lifecycle",
      lastTurn: 2,
    });
    const snapshotEnv = await client.waitForEnvelope((e) => e.type === "session:snapshot-response");
    expect(snapshotEnv.type).toBe("session:snapshot-response");
    expect(snapshotEnv.payload.sessionId).toBe("sess-e2e-lifecycle");
    expect(snapshotEnv.payload.status).toBe("running");
    expect(snapshotEnv.payload.workspaceFiles).toContain("dist/web/index.html");
    expect(snapshotEnv.payload.messages).toHaveLength(2);

    // 3g. execution:interrupt (soft and hard mode)
    client.sendEnvelope("execution:interrupt", { mode: "soft" });
    await new Promise((r) => setTimeout(r, 60));
    expect(interruptEvents).toContain("soft");

    client.sendEnvelope("execution:interrupt", { mode: "hard" });
    await new Promise((r) => setTimeout(r, 60));
    expect(interruptEvents).toContain("hard");

    // 4. Verify HTTP GET returns static dist/web/index.html with status 200 and Content-Type text/html
    const resHtml = await fetch(`http://127.0.0.1:${info.port}/`);
    expect(resHtml.status).toBe(200);
    expect(resHtml.headers.get("content-type")).toContain("text/html");
    const htmlBody = await resHtml.text();
    expect(htmlBody).toContain("<!doctype html>");
    expect(htmlBody).toContain("CPH-PI Agent Workbench");
    expect(htmlBody).toContain('<div id="root"></div>');

    // Also verify SPA routing fallback to index.html
    const resSpa = await fetch(`http://127.0.0.1:${info.port}/sessions/sess-e2e-lifecycle`);
    expect(resSpa.status).toBe(200);
    expect(resSpa.headers.get("content-type")).toContain("text/html");
    const spaBody = await resSpa.text();
    expect(spaBody).toContain('<div id="root"></div>');

    // 5. Cleanly shut down with server.stop()
    client.close();
    client = null;

    await server.stop();
    server = null;

    // Verify server has completely stopped
    let fetchFailed = false;
    try {
      await fetch(`http://127.0.0.1:${info.port}/`);
    } catch {
      fetchFailed = true;
    }
    expect(fetchFailed).toBe(true);
  });

  it("should handle interactive tool rejection via tool:reject", async () => {
    const bridge = new WebUiBridge();
    server = new WebServer({
      port: 0,
      bridge,
      staticDir: distWebDir,
    });
    const info = await server.start();

    const rawWs = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
    await new Promise<void>((resolve, reject) => {
      rawWs.on("open", () => resolve());
      rawWs.on("error", reject);
    });
    client = new TestWsClient(rawWs);

    const approvalPromise = bridge.requestApproval({
      tool: "bash",
      input: { command: "rm -rf /" },
    });

    const approvalEnv = await client.waitForEnvelope((e) => e.type === "tool:approval-required");
    const approvalId = approvalEnv.payload.approvalId || approvalEnv.payload.id;

    // Client rejects the action
    client.sendEnvelope("tool:reject", { approvalId });
    const approved = await approvalPromise;
    expect(approved).toBe(false);
  });
});
