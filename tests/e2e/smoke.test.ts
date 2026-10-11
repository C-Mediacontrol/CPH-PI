import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  CphPiCli,
  runCli,
  parseCliArgs,
  getHelpText,
  CPH_PI_VERSION,
} from "../../src/cli.ts";
import { TuiRenderer } from "../../src/ui/tui-renderer.ts";
import { InterruptController } from "../../src/agent/interrupt-controller.ts";
import type { IOrchestratorChatClient } from "../../src/agent/orchestrator.ts";
import { SubstrateUploader } from "../../src/transport/substrate-uploader.ts";

/**
 * Mock ChatHub Client for end-to-end multi-step autonomous planning simulation
 */
class MockE2EChatClient implements IOrchestratorChatClient {
  public responses: string[] = [];
  public sentPrompts: string[] = [];
  public callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async sendMessage(
    params: { text: string; [key: string]: any },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      [key: string]: any;
    }
  ): Promise<{ text: string }> {
    this.sentPrompts.push(params.text);
    const text =
      this.responses[this.callCount] ||
      "FINAL_ANSWER: Mock client completed all planned steps.";
    this.callCount++;

    // Simulate streaming deltas to exercise TUI rendering pipeline
    if (callbacks?.onDelta) {
      const chunkSize = 25;
      for (let i = 0; i < text.length; i += chunkSize) {
        callbacks.onDelta({
          type: "text",
          content: text.slice(i, i + chunkSize),
        });
      }
    }

    return { text };
  }
}

describe("CPH-PI End-to-End Smoke Test Suite", () => {
  let tempDir: string;
  let outputBuffer: string[];
  let renderer: TuiRenderer;
  let interruptController: InterruptController;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cph-pi-e2e-smoke-"));
    outputBuffer = [];
    renderer = new TuiRenderer({
      writer: (chunk: string) => outputBuffer.push(chunk),
    });
    interruptController = new InterruptController({
      idleExitTimeoutMs: 1500,
      autoAttach: false,
    });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const getRenderedOutput = () => outputBuffer.join("");

  // =========================================================================
  // 1. CLI Argument Parsing & Startup Options
  // =========================================================================
  describe("1. CLI Argument Parsing & Startup Options", () => {
    it("should parse --help and -h flags", () => {
      expect(parseCliArgs(["--help"]).help).toBe(true);
      expect(parseCliArgs(["-h"]).help).toBe(true);
    });

    it("should parse --version and -v flags", () => {
      expect(parseCliArgs(["--version"]).version).toBe(true);
      expect(parseCliArgs(["-v"]).version).toBe(true);
    });

    it("should parse workspace directory parameters", () => {
      expect(parseCliArgs(["--workspace", "/path/to/project"]).workspaceRoot).toBe("/path/to/project");
      expect(parseCliArgs(["-w", "/path/to/project"]).workspaceRoot).toBe("/path/to/project");
      expect(parseCliArgs(["--workspace=/path/to/project"]).workspaceRoot).toBe("/path/to/project");
    });

    it("should parse model tone and max turns parameters", () => {
      expect(parseCliArgs(["--tone", "Precise"]).modelTone).toBe("Precise");
      expect(parseCliArgs(["-m", "Balanced"]).modelTone).toBe("Balanced");
      expect(parseCliArgs(["--max-turns", "15"]).maxTurns).toBe(15);
      expect(parseCliArgs(["--max-turns=20"]).maxTurns).toBe(20);
    });

    it("should parse non-interactive task parameter via -t and positional args", () => {
      expect(parseCliArgs(["-t", "analyze memory leak"]).task).toBe("analyze memory leak");
      expect(parseCliArgs(["--task", "run diagnostics"]).task).toBe("run diagnostics");
      expect(parseCliArgs(["fix", "subtraction", "bug"]).task).toBe("fix subtraction bug");
    });

    it("should execute runCli with --help flag and return help text", async () => {
      const res = await runCli(["--help"]);
      expect(res.exitCode).toBe(0);
      expect(res.mode).toBe("help");
      expect(res.output).toContain("CPH-PI: Copilot-Pi Hybrid Autonomous Coding Agent");
      expect(res.output).toContain("用法 (Usage):");
      expect(res.output).toContain("--workspace");
      expect(res.output).toContain("/status");
    });

    it("should execute runCli with --version flag and return correct version", async () => {
      const res = await runCli(["--version"]);
      expect(res.exitCode).toBe(0);
      expect(res.mode).toBe("version");
      expect(res.output).toContain(`CPH-PI v${CPH_PI_VERSION}`);
    });
  });

  // =========================================================================
  // 2. Launcher Scripts Integration (Batch & PowerShell)
  // =========================================================================
  describe("2. Launcher Scripts Integration (Windows Batch & PowerShell)", () => {
    it("should execute cph-pi.bat --version via cmd successfully", () => {
      const batPath = join(process.cwd(), "cph-pi.bat");
      const stdout = execSync(`cmd /c "${batPath}" --version`, {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(stdout).toContain(`CPH-PI v${CPH_PI_VERSION}`);
    });

    it("should execute cph-pi.bat --help via cmd and display usage", () => {
      const batPath = join(process.cwd(), "cph-pi.bat");
      const stdout = execSync(`cmd /c "${batPath}" --help`, {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(stdout).toContain("用法 (Usage):");
      expect(stdout).toContain("--task");
    });

    it("should execute cph-pi.ps1 --version via powershell successfully", () => {
      const ps1Path = join(process.cwd(), "cph-pi.ps1");
      const stdout = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" --version`,
        {
          encoding: "utf8",
          cwd: process.cwd(),
        }
      );
      expect(stdout).toContain(`CPH-PI v${CPH_PI_VERSION}`);
    });

    it("should execute cph-pi.ps1 --help via powershell and display options", () => {
      const ps1Path = join(process.cwd(), "cph-pi.ps1");
      const stdout = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" --help`,
        {
          encoding: "utf8",
          cwd: process.cwd(),
        }
      );
      expect(stdout).toContain("用法 (Usage):");
      expect(stdout).toContain("--max-turns");
    });
  });

  // =========================================================================
  // 3. Full-Chain Multi-Step Autonomous Planning with Real Pi Tools
  // =========================================================================
  describe("3. Full-Chain Multi-Step Autonomous Planning with Real Pi Tools", () => {
    it("should complete full workflow: read file -> identify bug -> edit patch -> bash verify -> deliver final answer", async () => {
      // 1. Prepare target file in workspace with intentional defect
      const targetFile = join(tempDir, "calculator.ts");
      const initialContent = [
        'export function calculateArea(width: number, height: number): number {',
        '  // Intentional bug: adding dimensions instead of multiplying',
        '  return width + height;',
        '}',
      ].join("\n");
      await writeFile(targetFile, initialContent, "utf8");

      // 2. Prepare mock responses driving multi-turn autonomous cycle
      const mockResponses = [
        // Turn 1: Autonomous agent reads file
        `THOUGHT: First I will inspect calculator.ts using read_file to check implementation.
\`\`\`action
tool: read_file
path: calculator.ts
start_line: 1
end_line: 10
\`\`\``,

        // Turn 2: Agent detects bug and applies partial edit patch
        `THOUGHT: Found bug in line 3: "return width + height;". Applying surgical edit patch to replace with multiplication.
\`\`\`action
tool: edit
path: calculator.ts
old_string: return width + height;
new_string: return width * height;
\`\`\``,

        // Turn 3: Agent executes verification command using native bash tool
        `THOUGHT: Now verifying syntax and calculation with node.
\`\`\`action
tool: bash
command: node -e "console.log('verification: ok')"
\`\`\``,

        // Turn 4: Agent concludes and delivers final answer
        `THOUGHT: All steps verified successfully.
FINAL_ANSWER:
已成功读取 calculator.ts，定位到面积计算中加法误写的缺陷，并局部补丁修正为 return width * height;，经命令行执行验证无误，交付完毕！`,
      ];

      const chatClient = new MockE2EChatClient(mockResponses);

      const uploadSpy = spyOn(SubstrateUploader, "uploadDocumentToOneDrive").mockImplementation(
        async (_token: string, _content: string, fileName: string) => {
          return {
            driveItemId: "mock-item-id",
            webUrl: `https://example.com/${fileName}`,
            fileName,
            annotation: {
              id: "mock-item-id",
              messageAnnotationType: "DocumentFile",
              messageAnnotationMetadata: {
                "@type": "File",
                annotationType: "File",
                fileName,
              },
            },
          };
        }
      );

      const mockPool: any = {
        getGraphAccessToken: async () => "mock-graph-token",
        getAccounts: () => [],
        getActiveAccount: () => null,
      };

      try {
        // 3. Run non-interactive task through CLI entry point
        const runResult = await runCli(
          [
            "--workspace",
            tempDir,
            "--tone",
            "Precise",
            "-t",
            "Fix area calculation defect in calculator.ts",
          ],
          {
            renderer,
            interruptController,
            chatClient,
            pool: mockPool,
          }
        );

        // 4. Assertions on execution result
        expect(runResult.exitCode).toBe(0);
        expect(runResult.mode).toBe("task");
        expect(chatClient.callCount).toBe(4);
        expect(uploadSpy).toHaveBeenCalledTimes(3);

        // 5. Assertions on file system modifications
        const patchedContent = await readFile(targetFile, "utf8");
        expect(patchedContent).toContain("return width * height;");
        expect(patchedContent).not.toContain("return width + height;");

        // 6. Assertions on TUI rendering pipeline events
        const rendered = getRenderedOutput();

        // Tool badges rendered
        expect(rendered).toContain("read_file");
        expect(rendered).toContain("edit");
        expect(rendered).toContain("run_command");

        // Tool result status rendered to user TUI
        expect(rendered).toContain("read_file");
        expect(rendered).toContain("calculator.ts");
        expect(rendered).toContain("执行成功");
        expect(rendered).toContain("edit");

        // Unified Diff highlighting rendered
        expect(rendered).toContain("Diff");
        expect(rendered).toContain("return width");

        // Final answer box rendered
        expect(rendered).toContain("FINAL ANSWER");
        expect(rendered).toContain("已成功读取 calculator.ts");
        expect(rendered).toContain("交付完毕！");

        // 7. Verify prompt history continuity across turns (attached losslessly)
        expect(chatClient.sentPrompts[0]).toContain("calculator.ts");
        expect(chatClient.sentPrompts[1]).toContain("[TOOL_RESULT for read_file - SUCCESS (ATTACHED)]");
        expect(chatClient.sentPrompts[2]).toContain("[TOOL_RESULT for edit - SUCCESS (ATTACHED)]");
        expect(chatClient.sentPrompts[3]).toContain("[TOOL_RESULT for run_command - SUCCESS (ATTACHED)]");
      } finally {
        uploadSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 4. CLI Interactive Lifecycle & Error Resilience
  // =========================================================================
  describe("4. CLI Interactive Lifecycle & Error Resilience", () => {
    it("should assemble interactive components and display status cleanly", async () => {
      const cli = new CphPiCli({
        workspaceRoot: tempDir,
        renderer,
        interruptController,
        maxTurns: 10,
      });

      expect(cli.getRenderer()).toBe(renderer);
      expect(cli.getInterruptController()).toBe(interruptController);
      expect(cli.getOrchestrator().getWorkspaceRoot()).toBe(tempDir);

      // Verify /status command
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
        expect(statusOutput).toContain("单次最大轮数");
        expect(statusOutput).toContain("10");
      } finally {
        process.stdout.write = origWrite;
        cli.close();
      }
    });

    it("should handle task execution errors without unhandled rejections", async () => {
      // Client throwing network error
      const failingClient: IOrchestratorChatClient = {
        async sendMessage() {
          throw new Error("ChatHub WebSocket connection dropped");
        },
      };

      const runResult = await runCli(
        ["--workspace", tempDir, "-t", "Failing task"],
        {
          renderer,
          interruptController,
          chatClient: failingClient,
        }
      );

      expect(runResult.exitCode).toBe(0); // Gracefully handled by renderer
      expect(getRenderedOutput()).toContain("ChatHub WebSocket connection dropped");
    });
  });
});
