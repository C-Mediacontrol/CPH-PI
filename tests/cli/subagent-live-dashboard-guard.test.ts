import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CphPiCli } from "../../src/cli.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";

describe("CLI Subagent Live Dashboard & Input Lock Tests", () => {
  let tmpDir: string;
  let cliOutputBuffer: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-subagent-guard-test-"));
    cliOutputBuffer = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should ignore readline input when task execution is busy", async () => {
    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      renderer: new TuiRenderer({
        writer: (t) => cliOutputBuffer.push(t),
        colorLevel: 0,
      }),
    });

    const interrupt = cli.getInterruptController();
    interrupt.beginBusy();

    // While busy, enter empty line or command
    await cli.handleInputLine("");
    await cli.handleInputLine("/status");

    // No output / re-prompt should have occurred
    expect(cliOutputBuffer.join("")).toBe("");

    interrupt.endBusy();
  });

  it("should stream subagent events into live matrix updates during orchestrator execution", async () => {
    const matrixOutputs: string[] = [];
    const renderer = new TuiRenderer({
      writer: (t) => {
        cliOutputBuffer.push(t);
        if (t.includes("Sub-Agent Matrix")) {
          matrixOutputs.push(t);
        }
      },
      colorLevel: 0,
    });

    const mockOrchestrator = {
      isHandshakePending: false,
      run: async (opts: any) => {
        // Simulate subagent lifecycle
        opts.events?.onSubagentStart?.("sub-1", "researcher", {
          description: "审查数据模块",
          prompt: "审查数据",
        });

        opts.events?.onSubagentProgress?.("sub-1", 2, undefined, {
          tool: "read_file",
          path: "src/db.ts",
        });

        opts.events?.onSubagentEnd?.({
          id: "sub-1",
          role: "researcher",
          description: "审查数据模块",
          success: true,
          turnsCount: 2,
          durationMs: 1500,
        });

        return {
          completed: true,
          finalAnswer: "审查完毕，发现 0 个漏洞。",
          turnsCount: 1,
          history: [],
        };
      },
    };

    const cli = new CphPiCli({
      workspaceRoot: tmpDir,
      renderer,
      orchestrator: mockOrchestrator as any,
    });

    await cli.executeTask("审查项目代码");

    expect(matrixOutputs.length).toBeGreaterThanOrEqual(3);
    const combined = matrixOutputs.join("\n");
    expect(combined).toContain("[Sub-1]");
    expect(combined).toContain("审查数据模块");
    expect(combined).toContain("read_file src/db.ts");
    expect(combined).toContain("已完成");
  });
});

