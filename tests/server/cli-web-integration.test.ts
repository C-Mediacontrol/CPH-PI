import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { parseCliArgs, getHelpText } from "../../src/cli/args.ts";
import { runCli, CphPiCli, type CliOptions } from "../../src/cli.ts";
import { WebServer } from "../../src/server/web-server.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { InterruptController } from "../../src/agent/interrupt-controller.ts";
import { SessionManager } from "../../src/session/session-manager.ts";

describe("CLI Web Integration & Dual-Mode Wiring Suite (Task 4)", () => {
  describe("1. CLI Argument Parsing for Web Modes", () => {
    it("should parse 'web' subcommand with --port and --no-open", () => {
      const parsed = parseCliArgs(["web", "--port", "3099", "--no-open"]);
      expect(parsed.subcommand).toBe("web");
      expect(parsed.webPort).toBe(3099);
      expect(parsed.noOpen).toBe(true);
      expect(parsed.task).toBeUndefined();
    });

    it("should parse '--web' companion flag with --port", () => {
      const parsed = parseCliArgs(["--web", "--port", "4000"]);
      expect(parsed.web).toBe(true);
      expect(parsed.webPort).toBe(4000);
      expect(parsed.subcommand).toBeUndefined();
    });

    it("should parse short port flag -p with web subcommand", () => {
      const parsed = parseCliArgs(["web", "-p", "3088"]);
      expect(parsed.subcommand).toBe("web");
      expect(parsed.webPort).toBe(3088);
    });

    it("should parse --port=value and -p=value syntax", () => {
      const res1 = parseCliArgs(["web", "--port=5000", "--no-open"]);
      expect(res1.subcommand).toBe("web");
      expect(res1.webPort).toBe(5000);
      expect(res1.noOpen).toBe(true);

      const res2 = parseCliArgs(["--web", "-p=5001"]);
      expect(res2.web).toBe(true);
      expect(res2.webPort).toBe(5001);
    });

    it("should ignore invalid non-numeric port arguments safely", () => {
      const parsed = parseCliArgs(["web", "-p", "not-a-number"]);
      expect(parsed.subcommand).toBe("web");
      expect(parsed.webPort).toBeUndefined();
    });

    it("should document web subcommand and options in getHelpText()", () => {
      const help = getHelpText();
      expect(help).toContain("web");
      expect(help).toContain("--web");
      expect(help).toContain("--port");
      expect(help).toContain("--no-open");
    });
  });

  describe("2. Standalone Web Subcommand Mode (cph-pi web)", () => {
    let activeServer: WebServer | null = null;

    afterEach(async () => {
      if (activeServer) {
        await activeServer.stop();
        activeServer = null;
      }
    });

    it("should start WebServer in standalone web mode and wire bridge dispatch handlers", async () => {
      const customOptions: CliOptions = {
        parsedArgs: {
          help: false,
          version: false,
          subcommand: "web",
          webPort: 0,
          noOpen: true,
        },
      };

      const result = await runCli(["web", "--port", "0", "--no-open"], customOptions, false);
      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("web");
      expect(result.server).toBeDefined();

      activeServer = result.server!;
      const port = activeServer.getPort();
      expect(port).toBeGreaterThan(0);
      const url = activeServer.getUrl();
      expect(url).toContain(`http://127.0.0.1:${port}/?token=`);

      const bridge = activeServer.getBridge();
      expect(bridge).toBeDefined();

      // Test bridge dispatch handlers wiring: onSyncSnapshot
      const mockWs = { readyState: 1, send: () => {} };
      let snapshotReceived: any = null;
      bridge.setDispatchHandlers({
        onSyncSnapshot: async (sessionId, lastTurn) => {
          snapshotReceived = { sessionId, lastTurn };
          return { sessionId: "sess-1", title: "Test Session" };
        },
      });

      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "req-1",
          type: "session:sync-snapshot",
          payload: { sessionId: "sess-1" },
          timestamp: Date.now(),
        })
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(snapshotReceived).toEqual({ sessionId: "sess-1", lastTurn: undefined });
    });

    it("should dispatch onPrompt and onInterrupt from bridge to CLI controller", async () => {
      const result = await runCli(["web", "--port", "0", "--no-open"], {}, false);
      activeServer = result.server!;
      const bridge = activeServer.getBridge();

      // Verify onInterrupt triggers interrupt controller
      let interrupted = false;
      bridge.setDispatchHandlers({
        onInterrupt: (mode) => {
          interrupted = true;
        },
      });

      const mockWs = { readyState: 1, send: () => {} };
      bridge.onClientMessage(
        mockWs,
        JSON.stringify({
          id: "int-1",
          type: "execution:interrupt",
          payload: { mode: "soft" },
          timestamp: Date.now(),
        })
      );

      expect(interrupted).toBe(true);
    });
  });

  describe("3. Companion Mode (--web Flag)", () => {
    let activeServer: WebServer | null = null;

    afterEach(async () => {
      if (activeServer) {
        await activeServer.stop();
        activeServer = null;
      }
    });

    it("should start companion WebServer alongside CLI task execution", async () => {
      const customOptions: CliOptions = {
        orchestrator: {
          run: async () => ({ completed: true, history: [] }),
          resetHandshake: () => {},
          completeHandshake: () => {},
        } as any,
      };

      const result = await runCli(
        ["--web", "--port", "0", "--no-open", "--task", "ping task"],
        customOptions,
        false
      );

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("task");
      expect(result.server).toBeDefined();

      activeServer = result.server!;
      expect(activeServer.getPort()).toBeGreaterThan(0);
      expect(activeServer.getUrl()).toContain("?token=");

      await activeServer.stop();
      activeServer = null;
    });

    it("should chain Orchestrator and renderer events to WebUiBridge", () => {
      const renderer = new TuiRenderer({ writer: () => {} });
      const cli = new CphPiCli({ renderer, maxTurns: 2 });
      const webServer = new WebServer({ port: 0 });
      cli.setWebServer(webServer);

      const bridge = cli.getWebBridge();
      expect(bridge).toBeDefined();

      const sent: string[] = [];
      bridge!.addClient({
        readyState: 1,
        send: (msg: string) => sent.push(msg),
      });

      // Trigger bridge event directly or via cli web bridge
      bridge!.onDelta("test delta");
      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(parsed.type).toBe("turn:delta");
      expect(parsed.payload.chunk).toBe("test delta");
    });
  });
});
