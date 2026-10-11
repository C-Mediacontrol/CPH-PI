import { describe, it, expect, beforeEach, mock } from "bun:test";
import { CphPiCli } from "../src/cli.ts";
import { TuiRenderer } from "../src/ui/tui-renderer.ts";
import { InterruptController } from "../src/agent/interrupt-controller.ts";

describe("CphPiCli Unit & Assembly Tests", () => {
  let outputBuffer: string[];
  let renderer: TuiRenderer;
  let interruptController: InterruptController;
  let cli: CphPiCli;

  beforeEach(() => {
    outputBuffer = [];
    renderer = new TuiRenderer({
      writer: (text: string) => outputBuffer.push(text),
    });
    interruptController = new InterruptController({
      idleExitTimeoutMs: 1500,
      autoAttach: false,
    });
    cli = new CphPiCli({
      renderer,
      interruptController,
      maxTurns: 3,
    });
  });

  const getOutput = () => outputBuffer.join("");

  it("should assemble components properly", () => {
    expect(cli.getRenderer()).toBe(renderer);
    expect(cli.getInterruptController()).toBe(interruptController);
    expect(cli.getOrchestrator()).toBeDefined();
  });

  it("should handle /help command and display available commands and shortcuts", async () => {
    // Intercept stdout temporarily
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as any;

    try {
      await cli.handleCommand("/help");
      const helpOutput = stdoutWrites.join("");
      expect(helpOutput).toContain("/help");
      expect(helpOutput).toContain("/status");
      expect(helpOutput).toContain("/reset");
      expect(helpOutput).toContain("/exit");
      expect(helpOutput).toContain("Ctrl+C");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("should handle /status command and show configuration", async () => {
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as any;

    try {
      await cli.handleCommand("/status");
      const statusOutput = stdoutWrites.join("");
      expect(statusOutput).toContain("[CPH-PI 运行状态]");
      expect(statusOutput).toContain("工作区目录");
      expect(statusOutput).toContain("单次最大轮数");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("should handle /reset command by instantiating fresh Orchestrator", async () => {
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as any;

    try {
      const oldOrchestrator = cli.getOrchestrator();
      await cli.handleCommand("/reset");
      const newOrchestrator = cli.getOrchestrator();

      expect(newOrchestrator).not.toBe(oldOrchestrator);
      expect(stdoutWrites.join("")).toContain("会话历史与上下文已重置");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("should support multiline input via trailing backslash", async () => {
    let executedTask = "";
    cli.executeTask = async (task: string) => {
      executedTask = task;
    };

    await cli.handleInputLine("first line \\");
    expect(executedTask).toBe(""); // Not executed yet

    await cli.handleInputLine("second line");
    expect(executedTask).toBe("first line \nsecond line");
  });

  it("should support multiline block input via triple quotes", async () => {
    let executedTask = "";
    cli.executeTask = async (task: string) => {
      executedTask = task;
    };

    await cli.handleInputLine('""" start');
    await cli.handleInputLine("body line 1");
    await cli.handleInputLine("body line 2");
    await cli.handleInputLine('"""');

    expect(executedTask).toContain("start");
    expect(executedTask).toContain("body line 1");
    expect(executedTask).toContain("body line 2");
  });
});
