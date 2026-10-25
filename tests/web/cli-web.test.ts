import { describe, it, expect, spyOn } from "bun:test";
import { parseCliArgs, runCli, stopWebServer, CphPiCli } from "../../src/cli.ts";
import path from "node:path";
import fs from "node:fs";

describe("CPH-PI Web CLI Integration Tests", () => {
  it("should parse web subcommand with default port and host", () => {
    const parsed = parseCliArgs(["web"]);
    expect(parsed.subcommand).toBe("web");
    expect(parsed.port).toBe(3000);
    expect(parsed.host).toBe("127.0.0.1");
    expect(parsed.noOpen).toBeUndefined();
    expect(parsed.task).toBeUndefined();
  });

  it("should parse -p and --port flags", () => {
    const p1 = parseCliArgs(["web", "-p", "8080"]);
    expect(p1.subcommand).toBe("web");
    expect(p1.port).toBe(8080);

    const p2 = parseCliArgs(["web", "--port", "9090"]);
    expect(p2.subcommand).toBe("web");
    expect(p2.port).toBe(9090);

    const p3 = parseCliArgs(["web", "--port=4567"]);
    expect(p3.subcommand).toBe("web");
    expect(p3.port).toBe(4567);

    const p4 = parseCliArgs(["web", "-p=5678"]);
    expect(p4.subcommand).toBe("web");
    expect(p4.port).toBe(5678);
  });

  it("should parse --host flag", () => {
    const p1 = parseCliArgs(["web", "--host", "0.0.0.0"]);
    expect(p1.subcommand).toBe("web");
    expect(p1.host).toBe("0.0.0.0");

    const p2 = parseCliArgs(["web", "--host=192.168.1.100"]);
    expect(p2.subcommand).toBe("web");
    expect(p2.host).toBe("192.168.1.100");
  });

  it("should parse --no-open flag", () => {
    const parsed = parseCliArgs(["web", "--no-open"]);
    expect(parsed.subcommand).toBe("web");
    expect(parsed.noOpen).toBe(true);
  });

  it("should parse -debug single dash flag alongside web subcommand", () => {
    const p1 = parseCliArgs(["web", "-debug"]);
    expect(p1.subcommand).toBe("web");
    expect(p1.debug).toBe(true);

    const p2 = parseCliArgs(["-debug", "web"]);
    expect(p2.subcommand).toBe("web");
    expect(p2.debug).toBe(true);

    const p3 = parseCliArgs(["web", "-debug", ".cph/logs/test.log"]);
    expect(p3.subcommand).toBe("web");
    expect(p3.debug).toBe(true);
    expect(p3.debugLogPath).toBe(".cph/logs/test.log");

    const p4 = parseCliArgs(["web", "-debug=.cph/logs/inline.log"]);
    expect(p4.subcommand).toBe("web");
    expect(p4.debug).toBe(true);
    expect(p4.debugLogPath).toBe(".cph/logs/inline.log");
  });

  it("should execute runCli with web subcommand and start server cleanly", async () => {
    const testPort = 3991;
    const res = await runCli(["web", "-p", String(testPort), "--no-open"], { autoOpen: false }, false);

    expect(res.exitCode).toBe(0);
    expect(res.mode).toBe("web");
    expect(res.serverInstance).toBeDefined();

    try {
      const response = await fetch(`http://127.0.0.1:${testPort}/api/health`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe("ok");
    } finally {
      if (res.serverInstance) {
        await stopWebServer(res.serverInstance);
      }
    }
  });

  it("should warn if web/dist/index.html is missing", async () => {
    const warnSpy = spyOn(console, "warn");
    const cli = new CphPiCli();

    // Use non-existent dist dir
    const instance = await cli.startWebServer({
      port: 3992,
      host: "127.0.0.1",
      autoOpen: false,
      distDir: path.resolve(process.cwd(), "non_existent_dist"),
    });

    try {
      // Expect warning was logged
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === "string" && arg.includes("web/dist/index.html"))
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
      await stopWebServer(instance);
    }
  });
});
