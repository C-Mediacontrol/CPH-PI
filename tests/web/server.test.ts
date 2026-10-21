import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WebSocket } from "ws";
import { startWebServer, stopWebServer, type WebServerInstance } from "../../src/web/server.ts";
import { RpcHandler } from "../../src/web/rpc-handler.ts";

describe("CPH-PI Web Server & RPC Integration Tests", () => {
  let instance: WebServerInstance;
  const PORT = 3888;
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

  beforeAll(async () => {
    instance = await startWebServer({
      port: PORT,
      host: "127.0.0.1",
      autoOpen: false,
    });
  });

  afterAll(async () => {
    if (instance) {
      await stopWebServer(instance);
    }
  });

  it("GET /api/health should return 200 with status ok and timestamp", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { status: string; timestamp: number };
    expect(json.status).toBe("ok");
    expect(typeof json.timestamp).toBe("number");
  });

  it("GET / should serve index.html with 200 and text/html Content-Type", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("GET SPA route should fallback to index.html with 200", async () => {
    const res = await fetch(`${BASE_URL}/sessions/custom-session-route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("WebSocket connection to /ws should immediately receive session:snapshot", async () => {
    const ws = new WebSocket(WS_URL);

    const snapshot = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for session:snapshot")),
        3000
      );

      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "session:snapshot") {
            clearTimeout(timer);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(snapshot).toBeDefined();
    expect(Array.isArray(snapshot.sessions)).toBe(true);
    expect(typeof snapshot.activeSessionId).toBe("string");
    expect(Array.isArray(snapshot.turns)).toBe(true);
    expect(snapshot.contextMetrics).toBeDefined();

    ws.close();
  });

  it("WebSocket should handle user:submit and emit reasoning:chunk, assistant:chunk, and turn:end", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const receivedPackets: Array<{ type: string; payload: any }> = [];

    const turnCompletion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for turn:end")),
        5000
      );

      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          receivedPackets.push(packet);
          if (packet.type === "turn:end") {
            clearTimeout(timer);
            resolve();
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "user:submit",
        payload: { text: "Hello CPH-PI test" },
      })
    );

    await turnCompletion;

    const packetTypes = receivedPackets.map((p) => p.type);
    expect(packetTypes).toContain("reasoning:chunk");
    expect(packetTypes).toContain("assistant:chunk");
    expect(packetTypes).toContain("turn:end");

    ws.close();
  });

  it("WebSocket should handle session:new and emit a refreshed snapshot", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    let snapshotCount = 0;
    const newSessionSnapshot = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for second snapshot")),
        3000
      );

      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "session:snapshot") {
            snapshotCount++;
            if (snapshotCount === 2) {
              clearTimeout(timer);
              resolve(packet.payload);
            }
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "session:new",
        payload: { title: "Automated Test Session" },
      })
    );

    const snapshot = await newSessionSnapshot;
    expect(snapshot).toBeDefined();
    expect(snapshot.activeSessionId).toBeDefined();
    expect(snapshot.turns).toEqual([]);

    ws.close();
  });

  it("WebSocket should handle user:interrupt and stop streaming turn", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const interruptEnd = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for interrupt turn:end")),
        3000
      );

      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "turn:end") {
            clearTimeout(timer);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "user:submit",
        payload: { text: "Long running instruction to interrupt" },
      })
    );

    // Send interrupt shortly after
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "user:interrupt" }));
    }, 10);

    const endPayload = await interruptEnd;
    expect(endPayload).toBeDefined();

    ws.close();
  });

  it("serveStatic should correctly map required MIME types and handle fallback", async () => {
    const { serveStatic, MIME_TYPES } = await import("../../src/web/static-handler.ts");
    expect(MIME_TYPES[".html"]).toBe("text/html; charset=utf-8");
    expect(MIME_TYPES[".js"]).toBe("application/javascript; charset=utf-8");
    expect(MIME_TYPES[".css"]).toBe("text/css; charset=utf-8");
    expect(MIME_TYPES[".svg"]).toBe("image/svg+xml");
    expect(MIME_TYPES[".json"]).toBe("application/json; charset=utf-8");
    expect(MIME_TYPES[".woff2"]).toBe("font/woff2");

    // Test non-existent dist directory
    const mockReq: any = { method: "GET", url: "/test.js" };
    const mockRes: any = {
      statusCode: 200,
      setHeader: () => {},
      end: () => {},
    };
    const served = serveStatic(mockReq, mockRes, "non/existent/path");
    expect(served).toBe(false);

    // Test non-GET/HEAD method
    const postReq: any = { method: "POST", url: "/" };
    expect(serveStatic(postReq, mockRes, "non/existent/path")).toBe(false);
  });

  it("WebSocket should handle workspace:set to switch directory and return workspace:update", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const updatePromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for workspace:update")), 3000);
      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "workspace:update") {
            clearTimeout(timer);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    // Send workspace:set with existing directory
    ws.send(
      JSON.stringify({
        type: "workspace:set",
        payload: { path: process.cwd() },
      })
    );

    const result = await updatePromise;
    expect(result).toBeDefined();
    expect(result.workspaceRoot).toBeDefined();
    expect(Array.isArray(result.recentWorkspaces)).toBe(true);
    expect(Array.isArray(result.workspaceFiles)).toBe(true);

    ws.close();
  });

  it("WebSocket should return workspace:error when given invalid directory path", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const errorPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for workspace:error")), 3000);
      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "workspace:error") {
            clearTimeout(timer);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "workspace:set",
        payload: { path: "Z:/definitely/non/existent/directory/xyz123" },
      })
    );

    const errResult = await errorPromise;
    expect(errResult).toBeDefined();
    expect(errResult.message).toContain("不存在");

    ws.close();
  });

  it("WebSocket should handle agent:add-custom and agent:remove-custom", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    // Skip snapshot
    await new Promise((resolve) => setTimeout(resolve, 50));

    const addPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for agent:update")), 3000);
      const onMsg = (data: any) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "agent:update") {
            clearTimeout(timer);
            ws.off("message", onMsg);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
      ws.on("message", onMsg);
    });

    ws.send(
      JSON.stringify({
        type: "agent:add-custom",
        payload: {
          agent: {
            name: "安全渗透审查员",
            agentId: "agent-sec-123",
            role: "researcher",
            description: "专精漏洞挖掘",
          },
        },
      })
    );

    const addRes = await addPromise;
    expect(addRes).toBeDefined();
    expect(Array.isArray(addRes.customAgents)).toBe(true);
    const added = addRes.customAgents.find((a: any) => a.name === "安全渗透审查员");
    expect(added).toBeDefined();
    expect(added.agentId).toBe("agent-sec-123");

    // Now test remove
    const removePromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for agent:update after remove")), 3000);
      const onMsg = (data: any) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "agent:update") {
            clearTimeout(timer);
            ws.off("message", onMsg);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
      ws.on("message", onMsg);
    });

    ws.send(
      JSON.stringify({
        type: "agent:remove-custom",
        payload: { id: added.id },
      })
    );

    const removeRes = await removePromise;
    expect(removeRes).toBeDefined();
    expect(removeRes.customAgents.find((a: any) => a.id === added.id)).toBeUndefined();

    ws.close();
  });

  it("WebSocket should discover available skills and handle /thermo-nuclear-code-quality-review command", async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    // 1. Check initial snapshot includes availableSkills with thermo-nuclear-code-quality-review
    const snapshotPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for snapshot")), 3000);
      const onMsg = (data: any) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "session:snapshot") {
            clearTimeout(timer);
            ws.off("message", onMsg);
            resolve(packet.payload);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
      ws.on("message", onMsg);
    });

    const snapshot = await snapshotPromise;
    expect(snapshot.availableSkills).toBeDefined();
    expect(Array.isArray(snapshot.availableSkills)).toBe(true);
    const thermoSkill = snapshot.availableSkills.find(
      (s: any) => s.name === "thermo-nuclear-code-quality-review"
    );
    expect(thermoSkill).toBeDefined();

    // 2. Submit the slash command
    let receivedContextUpdate = false;
    let receivedSkillReasoning = false;
    let turnCompleted = false;

    const testExecution = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for skill turn")), 5000);
      ws.on("message", (data) => {
        try {
          const packet = JSON.parse(data.toString());
          if (packet.type === "context:update") {
            if (packet.payload?.activeSkills?.includes("thermo-nuclear-code-quality-review")) {
              receivedContextUpdate = true;
            }
          }
          if (packet.type === "reasoning:chunk") {
            if (packet.payload?.chunk?.includes("thermo-nuclear-code-quality-review")) {
              receivedSkillReasoning = true;
            }
          }
          if (packet.type === "turn:end") {
            turnCompleted = true;
            clearTimeout(timer);
            resolve();
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "user:submit",
        payload: {
          text: `/thermo-nuclear-code-quality-review 请根据skill流程，审查"E:\\test\\Library\\CNNJI QUERY"这个项目，最后请输出一个详细的审查报告在E:\\test\\test`,
        },
      })
    );

    await testExecution;
    expect(receivedContextUpdate).toBe(true);
    expect(receivedSkillReasoning).toBe(true);
    expect(turnCompleted).toBe(true);

    ws.close();
  });

  it("RpcHandler.getAccountsPayload should properly map throttleReason from AccountPool", () => {
    const mockWs: any = {
      on: () => {},
      send: () => {},
      readyState: 1,
    };
    const mockPool: any = {
      getPoolStatus: () => [
        {
          email: "daily@example.com",
          isAvailable: false,
          isThrottled: true,
          isAllowed: true,
          cooldownUntil: Date.now() + 100000,
          lastUsedAt: Date.now(),
          totalRequests: 10,
          throttledCount: 2,
          throttleReason: "daily",
        },
        {
          email: "burst@example.com",
          isAvailable: false,
          isThrottled: true,
          isAllowed: true,
          cooldownUntil: Date.now() + 50000,
          lastUsedAt: Date.now(),
          totalRequests: 5,
          throttledCount: 1,
          throttleReason: "burst",
        },
      ],
      getAllowedAccounts: () => null,
    };

    const handler = new RpcHandler(mockWs, { pool: mockPool, workspaceRoot: null });
    const payload = handler.getAccountsPayload();
    expect(payload.accounts).toHaveLength(2);
    expect(payload.accounts[0].throttleReason).toBe("daily");
    expect(payload.accounts[1].throttleReason).toBe("burst");
  });
});


