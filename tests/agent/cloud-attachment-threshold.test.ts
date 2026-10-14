import { describe, it, expect } from "bun:test";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import { Orchestrator } from "../../src/agent/orchestrator.ts";

describe("Cloud Attachment Threshold & Fact Fingerprint (CR-3)", () => {
  it("should format attached tool result prompt with head-tail excerpt fingerprint", () => {
    const excerpt = "Line 1: init\nLine 2: running\n...\nLine 100: finished with code 0";
    const prompt = PromptBuilder.buildAttachedToolResultPrompt(
      "run_command",
      "tool-result-run_command-12345.txt",
      { lineCount: 100, charCount: 5000 },
      excerpt
    );

    expect(prompt).toContain("tool-result-run_command-12345.txt");
    expect(prompt).toContain("Line 1: init");
    expect(prompt).toContain("finished with code 0");
    expect(prompt).toContain("【物理执行指纹摘要 (Head-Tail Fingerprint)】");
  });

  it("should have sensible default cloud attachment thresholds (12000 chars / 200 lines)", () => {
    const orch = new Orchestrator({
      sessionId: "test-session",
      workspaceRoot: process.cwd(),
    });

    const status = orch.getCloudAttachmentThresholds();
    expect(status.chars).toBe(12000);
    expect(status.lines).toBe(200);
  });
});

