import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("Tri-Agent System Prompts & Subagent Skill Contracts", () => {
  const root = path.resolve(__dirname, "../../");

  it("should contain Task Right-Sizing rules in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("黄金工作区间");
    expect(mainPrompt).toContain("10~20");
    expect(mainPrompt).toContain("核心修改文件");
  });

  it("should declare micro handoff contract in coder and researcher prompts", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    expect(coderPrompt).toContain("handoff");
    expect(coderPrompt).toContain("第 29 轮");
    expect(coderPrompt).not.toContain("invoke_subagent");

    expect(researcherPrompt).toContain("handoff");
    expect(researcherPrompt).toContain("第 29 轮");
    expect(researcherPrompt).not.toContain("invoke_subagent");
  });

  it("should define Gate 2 Task Right-Sizing in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("Gate 2");
    expect(skillContent).toContain("10~20");
  });
});
