import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("Handshake flow grounding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-handshake-"));
    fs.mkdirSync(path.join(tmpDir, "Library", "proj"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "Library", "proj", "a.ps1"), "Write-Output 1\n");
    fs.mkdirSync(path.join(tmpDir, ".cph", "state"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".cph", "state", "sync-manifest.json"),
      JSON.stringify(
        {
          version: 2,
          siteUrl: "https://tenant.sharepoint.com/sites/test",
          targetFolder: "AFRASIA/WorkSpace/test_workspace",
          files: {
            "Library/proj/a.ps1": {
              sha256: "abc",
              size: 10,
              serverRelativeUrl:
                "/sites/test/AFRASIA/WorkSpace/test_workspace/Library/proj/a.ps1",
            },
          },
          folders: {},
        },
        null,
        2
      ),
      "utf8"
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("sends the cloud map on the Turn 2 task prompt after the handshake", async () => {
    const prompts: string[] = [];
    let call = 0;
    const mockClient: any = {
      async sendMessage(params: any) {
        prompts.push(params.text);
        call++;
        if (call === 1) {
          return { text: "```action\ntool: run_command\ncommand: git status\n```" };
        }
        return { text: "FINAL_ANSWER: 完成" };
      },
    };
    const mockBridge: any = {
      executeAction: async () => ({
        actionName: "run_command",
        piToolName: "bash",
        target: "git status",
        success: true,
        output: "clean",
        formatted: "clean",
      }),
    };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge: mockBridge,
      isHandshakePending: true,
      enableWorkspaceCatalog: false,
    });

    const result = await orchestrator.run({ task: "review Library/proj" });
    expect(result.completed).toBe(true);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    // Handshake prompt may or may not include the map; the task-entry Turn 2 must.
    expect(prompts[1]).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(prompts[1]).toContain("Library/proj/a.ps1");
    expect(prompts[1]).toContain("【用户正式需求】");
  });

  it("cloud-verified sessions skip the handshake and get task + map on Turn 1", async () => {
    const prompts: string[] = [];
    const mockClient: any = {
      async sendMessage(params: any) {
        prompts.push(params.text);
        return { text: "FINAL_ANSWER: 完成" };
      },
    };
    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge: { executeAction: async () => ({ success: true, output: "" }) } as any,
      isHandshakePending: true,
      enableWorkspaceCatalog: false,
    });

    const result = await orchestrator.run({
      task: "review Library/proj",
      skipHandshake: true,
    });

    expect(result.completed).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(prompts[0]).toContain("Library/proj/a.ps1");
    expect(prompts[0]).toContain("【当前用户任务】");
    expect(prompts[0]).not.toContain("【第一轮基准探测握手");
  });
});
