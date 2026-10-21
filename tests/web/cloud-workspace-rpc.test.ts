import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocket } from "ws";
import { startWebServer, stopWebServer, type WebServerInstance } from "../../src/web/server.ts";
import { RpcHandler, type CloudWorkspaceConfig } from "../../src/web/rpc-handler.ts";

function waitForPacket<T = any>(ws: WebSocket, type: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timeout waiting for packet type "${type}" after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (data: any) => {
      try {
        const packet = JSON.parse(data.toString());
        if (packet.type === type) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(packet.payload);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.on("message", onMessage);
  });
}

async function openClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (err) => reject(err));
  });
  return ws;
}

describe("Cloud Workspace RPC Integration Tests", () => {
  let instance: WebServerInstance;
  let tmpRoot: string;
  let tmpWorkspace: string;
  let tmpGlobalConfig: string;
  const PORT = 3999;
  const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cph-cloud-rpc-test-"));
    tmpWorkspace = path.join(tmpRoot, "local-workspace");
    fs.mkdirSync(tmpWorkspace, { recursive: true });

    tmpGlobalConfig = path.join(tmpRoot, "global-config.json");
    process.env.CPH_GLOBAL_CONFIG_PATH = tmpGlobalConfig;

    instance = await startWebServer({
      port: PORT,
      host: "127.0.0.1",
      autoOpen: false,
      workspaceRoot: undefined,
    });
  });

  afterAll(async () => {
    delete process.env.CPH_GLOBAL_CONFIG_PATH;
    delete process.env.SP_SYNC_MOCK_CLOUD_EMPTY;
    delete process.env.SP_SYNC_MOCK_OVERLAP_ZERO;

    if (instance) {
      await stopWebServer(instance);
    }

    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it("Test 1: Initial connection without prior records starts with workspaceRoot: null and cloudWorkspace: null", async () => {
    const ws = await openClient(WS_URL);
    const snapshotPromise = waitForPacket(ws, "session:snapshot");

    const snapshot = await snapshotPromise;
    expect(snapshot).toBeDefined();
    expect(snapshot.workspaceRoot).toBeNull();
    expect(snapshot.cloudWorkspace).toBeNull();
    expect(snapshot.recentWorkspaces).toEqual([]);
    expect(snapshot.workspaceFiles).toEqual([]);

    ws.close();
  });

  it("Test 2: Client sends workspace:verify-cloud with mock transport and receives workspace:verify-result", async () => {
    process.env.SP_SYNC_MOCK_CLOUD_EMPTY = "1";

    const ws = await openClient(WS_URL);
    await waitForPacket(ws, "session:snapshot");

    const verifyPromise = waitForPacket(ws, "workspace:verify-result");
    ws.send(
      JSON.stringify({
        type: "workspace:verify-cloud",
        payload: {
          workspaceRoot: tmpWorkspace,
          mockTransport: true,
        },
      })
    );

    const result = await verifyPromise;
    expect(result).toBeDefined();
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Cloud folder is empty");
    expect(result.details).toBeDefined();
    expect(result.details.cloudFileCount).toBe(0);

    ws.close();
  });

  it("Test 3: Client sends workspace:set with local path and cloudWorkspace; verifies both are persisted to .cph/config.json and received in workspace:update & snapshot", async () => {
    const ws = await openClient(WS_URL);
    await waitForPacket(ws, "session:snapshot");

    const cloudConfig: CloudWorkspaceConfig = {
      siteUrl: "https://cmacgmgroup.sharepoint.com/sites/TestSite",
      targetFolder: "/sites/TestSite/AFR/WorkSpace",
      verified: true,
    };

    const updatePromise = waitForPacket(ws, "workspace:update");
    const snapshotPromise = waitForPacket(ws, "session:snapshot");

    ws.send(
      JSON.stringify({
        type: "workspace:set",
        payload: {
          path: tmpWorkspace,
          cloudWorkspace: cloudConfig,
        },
      })
    );

    const update = await updatePromise;
    expect(update.workspaceRoot).toBe(path.resolve(tmpWorkspace));
    expect(update.cloudWorkspace).toEqual(cloudConfig);
    expect(update.recentWorkspaces).toContain(path.resolve(tmpWorkspace));

    const snapshot = await snapshotPromise;
    expect(snapshot.workspaceRoot).toBe(path.resolve(tmpWorkspace));
    expect(snapshot.cloudWorkspace).toEqual(cloudConfig);

    // Verify disk persistence in workspace
    const configPath = path.join(tmpWorkspace, ".cph", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const savedWorkspaceConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(savedWorkspaceConfig.workspaceRoot).toBe(path.resolve(tmpWorkspace));
    expect(savedWorkspaceConfig.cloudWorkspace).toEqual(cloudConfig);

    // Verify global config persistence
    expect(fs.existsSync(tmpGlobalConfig)).toBe(true);
    const savedGlobalConfig = JSON.parse(fs.readFileSync(tmpGlobalConfig, "utf-8"));
    expect(savedGlobalConfig.lastWorkspace).toBe(path.resolve(tmpWorkspace));

    ws.close();
  });

  it("Test 4: Subsequent connection or reload detects previously saved pairing from .cph/config.json", async () => {
    // Open a completely fresh WebSocket connection
    const ws = await openClient(WS_URL);
    const snapshot = await waitForPacket(ws, "session:snapshot");

    expect(snapshot.workspaceRoot).toBe(path.resolve(tmpWorkspace));
    expect(snapshot.cloudWorkspace).toBeDefined();
    expect(snapshot.cloudWorkspace.siteUrl).toBe("https://cmacgmgroup.sharepoint.com/sites/TestSite");
    expect(snapshot.cloudWorkspace.targetFolder).toBe("/sites/TestSite/AFR/WorkSpace");
    expect(snapshot.cloudWorkspace.verified).toBe(true);

    ws.close();
  });

  it("Test 5: Client sends workspace:sync-cloud with mock transport and receives workspace:sync-report with status: completed", async () => {
    process.env.SP_SYNC_MOCK_CLOUD_EMPTY = "1";

    const ws = await openClient(WS_URL);
    await waitForPacket(ws, "session:snapshot");

    const reportPromise = waitForPacket(ws, "workspace:sync-report");

    ws.send(
      JSON.stringify({
        type: "workspace:sync-cloud",
        payload: {
          mockTransport: true,
        },
      })
    );

    const reportRes = await reportPromise;
    expect(reportRes.status).toBe("completed");
    expect(reportRes.report).toBeDefined();
    expect(typeof reportRes.report.syncedCount).toBe("number");
    expect(typeof reportRes.report.durationMs).toBe("number");

    // Verify that lastSyncedAt is saved in .cph/config.json
    const configPath = path.join(tmpWorkspace, ".cph", "config.json");
    const savedWorkspaceConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(savedWorkspaceConfig.cloudWorkspace.lastSyncedAt).toBeDefined();
    expect(typeof savedWorkspaceConfig.cloudWorkspace.lastSyncedAt).toBe("string");

    ws.close();
  });

  it("Test 6: Client sends workspace:sync-cloud when cloud verification fails (e.g. SP_SYNC_MOCK_OVERLAP_ZERO='1') and receives workspace:sync-report with status: failed", async () => {
    delete process.env.SP_SYNC_MOCK_CLOUD_EMPTY;
    process.env.SP_SYNC_MOCK_OVERLAP_ZERO = "1";

    const ws = await openClient(WS_URL);
    await waitForPacket(ws, "session:snapshot");

    const reportPromise = waitForPacket(ws, "workspace:sync-report");

    ws.send(
      JSON.stringify({
        type: "workspace:sync-cloud",
        payload: {
          mockTransport: true,
        },
      })
    );

    const reportRes = await reportPromise;
    expect(reportRes.status).toBe("failed");
    expect(reportRes.error).toBeDefined();
    expect(reportRes.error).toContain("UNMATCHED_CLOUD_FOLDER");

    delete process.env.SP_SYNC_MOCK_OVERLAP_ZERO;
    ws.close();
  });
});
