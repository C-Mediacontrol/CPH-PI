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

  it("should enforce action-oriented contracts without leaking harness internal mechanics", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    const agentsMd = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");

    // Action-oriented contracts present
    expect(mainPrompt).toContain("invoke_subagent");
    expect(mainPrompt).toContain("派发即提交");
    expect(mainPrompt).toContain("系统会自动保留规划上下文");
    expect(skillContent).toContain("派发即提交");

    // No harness internal leak to agents
    expect(mainPrompt).not.toContain("WebSocket");
    expect(mainPrompt).not.toContain("自适应排队");
    expect(mainPrompt).not.toContain(".cph/handoffs/main-plan");

    // Rule 6 present in AGENTS.md
    expect(agentsMd).toContain("行动导向与认知极简准则");
  });

  it("should declare Gate 5 Stage Barrier and causality rules in subagent skill and main prompt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    // Gate 5 present in subagent SKILL.md
    expect(skillContent).toContain("Gate 5");
    expect(skillContent).toContain("阶段屏障");
    expect(skillContent).toContain("stage");

    // Main prompt declares stage barrier and causality separation
    expect(mainPrompt).toContain("阶段屏障");
    expect(mainPrompt).toContain("stage");
  });
});
