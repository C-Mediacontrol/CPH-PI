import { describe, it, expect } from "bun:test";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Prompt Governance & Constructive Guidance (CR-4)", () => {
  it("should not contain negative prohibitions like '严禁输出工具块' in PROTOCOL_REMINDER", () => {
    const reminder = PromptBuilder.PROTOCOL_REMINDER;
    expect(reminder).not.toContain("严禁输出工具块");
    expect(reminder).not.toContain("切勿");
    expect(reminder).toContain("FINAL_ANSWER");
  });

  it("should provide positive action instructions in turn contract", () => {
    const reminder = PromptBuilder.PROTOCOL_REMINDER;
    expect(reminder).toContain("【交接协议规范 (Turn Protocol Contract)】");
  });

  it("should include POSIX Git Bash single-quote PowerShell guidance in main agent prompt", () => {
    const promptPath = path.join(__dirname, "../../cph-main-agent-prompt.txt");
    const content = fs.readFileSync(promptPath, "utf8");
    expect(content).toContain("Git Bash");
    expect(content).toContain("powershell");
  });
});

