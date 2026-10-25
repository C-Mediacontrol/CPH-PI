import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("Dual-Agent & Dev Governance & Packaging Contracts (Phase 4)", () => {
  const root = path.resolve(__dirname, "../../");

  const promptFiles = [
    "cph-main-agent-prompt.txt",
    "cph-coder-agent-prompt.txt",
    "cph-dev-agent-prompt.txt",
  ];

  const skillFiles = [
    "skills/subagent/SKILL.md",
    "skills/handoff/SKILL.md",
  ];

  it("should ensure cph-researcher-agent-prompt.txt is retired and does not exist on disk", () => {
    expect(fs.existsSync(path.join(root, "cph-researcher-agent-prompt.txt"))).toBe(false);
  });

  it("should uphold Rule 3 constructive guidance without negative prohibition words across dual-agent prompts and skills", () => {
    const targetFiles = [
      "cph-main-agent-prompt.txt",
      "cph-coder-agent-prompt.txt",
      "skills/subagent/SKILL.md",
      "skills/handoff/SKILL.md",
    ];
    const negativeWords = ["严禁", "切勿", "不要", "禁止", "杜绝", "不得", "绝不允许"];
    for (const relPath of targetFiles) {
      const fullPath = path.join(root, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");

      for (const word of negativeWords) {
        expect(content).not.toContain(word);
      }
    }
  });

  it("should enforce black-box abstraction without leaking harness internal transport mechanics across all prompts and skills", () => {
    const allFiles = [...promptFiles, ...skillFiles];
    const forbiddenTerms = ["WebSocket", "SignalR", "账号池", "Chathub"];
    for (const relPath of allFiles) {
      const content = fs.readFileSync(path.join(root, relPath), "utf8");
      for (const term of forbiddenTerms) {
        expect(content).not.toContain(term);
      }
    }
  });

  it("should enforce Cloud-First Grounding, DAG stage barrier, and traceable delivery contracts in cph-main-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");

    // Cloud-First SharePoint Remote Workspace perception
    expect(content).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(content).toContain("[CLOUD-READY]");
    expect(content).toContain("[LOCAL-NEW: use read_file]");

    // Physical plan and convergence gate
    expect(content).toContain("plan.md");
    expect(content).toContain("FINAL_ANSWER");
    expect(content).toContain("收敛门禁");
    expect(content).toContain("已审阅文件与取证来源清单");

    // Commander role & DAG dependency scheduling
    expect(content).toContain("DAG");
    expect(content).toContain("阶段屏障");
    expect(content).toMatch(/契约先于实现/);
    expect(content).toMatch(/底座先于应用/);
    expect(content).toMatch(/研判先于重构/);
    expect(content).toMatch(/实施先于集成/);

    // Coder delegation & orthogonal concurrency
    expect(content).toMatch(/role:\s*"coder"/);
    expect(content).toMatch(/正交.*并发/);
  });

  it("should enforce Cloud-First Grounding, surgical patching, and test green-light loop in cph-coder-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");

    // Cloud-First SharePoint Remote Workspace perception
    expect(content).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(content).toContain("[LOCAL-NEW: use read_file]");

    // Surgical patching and test green-light loop
    expect(content).toContain("patch_file");
    expect(content).toMatch(/绿灯/);
    expect(content).toContain("run_command");
    expect(content).toContain("FINAL_ANSWER");
    expect(content).toContain("handoff");

    // No raw write_file tool action
    expect(content).not.toContain('"tool": "write_file"');
  });

  it("should enforce end-to-end full snapshot perception and positive engineering delivery in cph-dev-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-dev-agent-prompt.txt"), "utf8");

    // Standalone autonomous developer baseline
    expect(content).toContain("CPH-Dev");
    expect(content).toMatch(/工作区索引|remote-workspace-catalog\.md|全景视野/);

    // TDD & patch-first delivery
    expect(content).toContain("patch_file");
    expect(content).toMatch(/测试|绿灯/);
    expect(content).toContain("FINAL_ANSWER");
    expect(content).not.toContain("严禁");
    expect(content).not.toContain("切勿");
  });

  it("should enforce Cloud-First dispatch, DAG causality, and stage barriers in skills/subagent/SKILL.md", () => {
    const content = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    // Cloud workspace anchoring
    expect(content).toContain("[SHAREPOINT REMOTE WORKSPACE]");

    // DAG causality & dispatch guide
    expect(content).toContain("DAG");
    expect(content).toMatch(/因果/);

    // Stage barriers & causality sequence
    expect(content).toContain("阶段屏障");
    expect(content).toContain("stage: 1");
    expect(content).toContain("stage: 2");
    expect(content).toMatch(/契约先于实现/);
    expect(content).toMatch(/底座先于应用/);
    expect(content).toMatch(/研判先于重构/);
    expect(content).toMatch(/实施先于集成/);

    // Target files & orthogonal concurrency
    expect(content).toContain("targetFiles");
    expect(content).toMatch(/正交.*并发/);
    expect(content).toContain("plan.md");
    expect(content).toContain("patch_file");
    expect(content).toContain("FINAL_ANSWER");
  });

  it("should enforce Cloud-Anchored Handoff, plan.md alignment, P0/P1 tiers, and anti-early exit in skills/handoff/SKILL.md", () => {
    const content = fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8");

    // Cloud workspace anchoring & natural inheritance
    expect(content).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(content).toContain("[CLOUD-READY]");
    expect(content).toContain("[LOCAL-NEW: use read_file]");
    expect(content).toMatch(/天然继承/);
    expect(content).toMatch(/无需.*重新向用户确认.*初始目标/);

    // plan.md alignment, P0/P1 tiers, and anti-early-exit invariant
    expect(content).toContain("plan.md");
    expect(content).toContain("P0");
    expect(content).toContain("P1");
    expect(content).toContain("反早退");
    expect(content).toContain("FINAL_ANSWER");
  });

  it("should synchronize prompts, skills, and distribution artifacts into package/agent-bundle via package-agent-bundle.ts", () => {
    // Run packager script
    execSync("bun run scripts/package-agent-bundle.ts", { cwd: root, stdio: "pipe" });

    const packageBundleDir = path.join(root, "package", "agent-bundle");
    expect(fs.existsSync(packageBundleDir)).toBe(true);

    // 1. Verify instructions files in package/agent-bundle/
    const mainInstructions = path.join(packageBundleDir, "Instructions-Main-主协调智能体.txt");
    const coderInstructions = path.join(packageBundleDir, "Instructions-Coder-代码实现智能体.txt");
    const researcherInstructions = path.join(packageBundleDir, "Instructions-Researcher-深度调研智能体.txt");
    const devInstructions = path.join(packageBundleDir, "Instructions-系统提示词.txt");

    expect(fs.existsSync(mainInstructions)).toBe(true);
    expect(fs.existsSync(coderInstructions)).toBe(true);
    expect(fs.existsSync(researcherInstructions)).toBe(false);
    expect(fs.existsSync(devInstructions)).toBe(true);

    // Verify content matches source prompts
    expect(fs.readFileSync(mainInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8"));
    expect(fs.readFileSync(coderInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8"));
    expect(fs.readFileSync(devInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-dev-agent-prompt.txt"), "utf8"));

    // 2. Verify raw prompts also preserved in package/agent-bundle/
    for (const promptFile of promptFiles) {
      const bundlePromptPath = path.join(packageBundleDir, promptFile);
      expect(fs.existsSync(bundlePromptPath)).toBe(true);
      expect(fs.readFileSync(bundlePromptPath, "utf8")).toBe(fs.readFileSync(path.join(root, promptFile), "utf8"));
    }
    // Verify cph-researcher-agent-prompt.txt does NOT exist in package/agent-bundle/
    expect(fs.existsSync(path.join(packageBundleDir, "cph-researcher-agent-prompt.txt"))).toBe(false);

    // 3. Verify skills packaged in package/agent-bundle/skills/
    const subagentSkillPath = path.join(packageBundleDir, "skills", "subagent", "SKILL.md");
    const handoffSkillPath = path.join(packageBundleDir, "skills", "handoff", "SKILL.md");
    expect(fs.existsSync(subagentSkillPath)).toBe(true);
    expect(fs.existsSync(handoffSkillPath)).toBe(true);
    expect(fs.readFileSync(subagentSkillPath, "utf8")).toBe(fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8"));
    expect(fs.readFileSync(handoffSkillPath, "utf8")).toBe(fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8"));
  });
});
