import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../../src/agent/orchestrator.ts";
import { LandingService } from "../../src/delivery/landing-service.ts";

describe("Orchestrator auto landing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-auto-landing-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("lands FINAL_ANSWER deliverables and prepends a receipt", async () => {
    const landedCalls: any[] = [];
    const landing = new LandingService({
      workspaceRoot: tmpDir,
      filePorter: {
        deliverToWorkspace: async (params: any) => {
          landedCalls.push(params);
          fs.mkdirSync(path.dirname(path.join(tmpDir, params.destinationPath)), { recursive: true });
          fs.writeFileSync(path.join(tmpDir, params.destinationPath), "report body");
          return { landedFiles: [params.destinationPath], extractedFromZip: false };
        },
      } as any,
      syncFile: async (rel: string) => ({ status: "synced", serverRelativeUrl: `https://sp/${rel}` }),
    });

    const mockClient: any = {
      async sendMessage() {
        return {
          text: [
            "FINAL_ANSWER: 审查完成。",
            "",
            "【交付文件与落盘指引 / Deliverables】",
            "- `test/report.md` <- [report.md](https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/original)",
            "",
            "# 审查报告",
            "正文内容",
          ].join("\n"),
        };
      },
    };

    const mockBridge: any = { executeAction: async () => ({ success: true, output: "" }) };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge: mockBridge,
      customAgentId: "T_test_agent",
      autoLandingService: landing,
    });

    const result = await orchestrator.run({ task: "审查并输出报告" });

    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain("已落盘");
    expect(result.finalAnswer).toContain("test/report.md");
    expect(result.finalAnswer).toContain("审查报告");

    expect(landedCalls).toHaveLength(1);
    expect(landedCalls[0].downloadUrl).toContain("asyncgw");
    expect(fs.readFileSync(path.join(tmpDir, "test", "report.md"), "utf-8")).toBe("report body");

    const report = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cph", "state", "delivery-report.json"), "utf-8")
    );
    expect(report.status).toBe("ok");
    expect(report.landed[0].cloudUrl).toContain("https://sp/test/report.md");
  });

  it("does not hijack a plain write_file when content is present alongside url", async () => {
    let bridgeCalls = 0;
    const mockBridge: any = {
      executeAction: async () => {
        bridgeCalls++;
        return {
          actionName: "write_file",
          piToolName: "write",
          target: "test/a.md",
          success: true,
          output: "written",
          formatted: "written",
        };
      },
    };
    let calls = 0;
    const mockClient: any = {
      async sendMessage() {
        calls++;
        if (calls === 1) {
          return {
            text: [
              "```action",
              "tool: write_file",
              "path: test/a.md",
              "content: url: https://x.test/inside-content",
              "url: https://fr-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/original",
              "```",
            ].join("\n"),
          };
        }
        return { text: "FINAL_ANSWER: 完成" };
      },
    };

    const orchestrator = new Orchestrator({
      workspaceRoot: tmpDir,
      chatClient: mockClient,
      bridge: mockBridge,
      customAgentId: "T_test_agent",
    });

    const result = await orchestrator.run({ task: "write a plain file" });
    expect(result.completed).toBe(true);
    expect(bridgeCalls).toBe(1);
    expect(result.finalAnswer).toContain("完成");
  });
});
