import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("Tri-Agent & Dev Governance & Packaging Contracts (Phase 4)", () => {
  const root = path.resolve(__dirname, "../../");

  const promptFiles = [
    "cph-main-agent-prompt.txt",
    "cph-researcher-agent-prompt.txt",
    "cph-coder-agent-prompt.txt",
    "cph-dev-agent-prompt.txt",
  ];

  const skillFiles = [
    "skills/subagent/SKILL.md",
    "skills/handoff/SKILL.md",
  ];

  it("should uphold Rule 3 constructive guidance without negative prohibition words across all prompts and skills", () => {
    const allFiles = [...promptFiles, ...skillFiles];
    for (const relPath of allFiles) {
      const fullPath = path.join(root, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");

      // Rule 3: No negative prohibition words like '严禁', '切勿'
      expect(content).not.toContain("严禁");
      expect(content).not.toContain("切勿");
    }
  });

  it("should enforce black-box abstraction without leaking harness internal transport mechanics", () => {
    for (const relPath of promptFiles) {
      const content = fs.readFileSync(path.join(root, relPath), "utf8");
      // Rule 6: Do not leak WebSocket, SignalR, account pool internals
      expect(content).not.toContain("WebSocket");
      expect(content).not.toContain("SignalR");
      expect(content).not.toContain("账号池");
      expect(content).not.toContain("Chathub");
    }
  });

  it("should enforce full workspace snapshot awareness and DAG stage barrier contracts in cph-main-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");

    // Full workspace snapshot perception in Turn 1
    expect(content).toMatch(/全景(?:代码)?快照|workspace-v1\.txt/);
    expect(content).toContain("plan.md");

    // Commander role & DAG dependency scheduling
    expect(content).toContain("DAG");
    expect(content).toContain("阶段屏障");
    expect(content).toMatch(/契约先于实现/);
    expect(content).toMatch(/底座先于应用/);
    expect(content).toMatch(/研判先于重构/);
    expect(content).toMatch(/实施先于集成/);

    // Orthogonal concurrency
    expect(content).toMatch(/正交.*并发/);
  });

  it("should enforce scoped micro-slice input and read-only evidence contracts in cph-researcher-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    // Scoped micro-slice perception
    expect(content).toMatch(/微切片|局部切片/);

    // Read-only investigation and verifiable evidence
    expect(content).toContain("只读");
    expect(content).toMatch(/证据/);
    expect(content).toContain("read_file");
    expect(content).toContain("run_command");
    expect(content).toContain("FINAL_ANSWER");

    // Tool boundaries: strictly read-only, no write_file or patch_file
    expect(content).not.toContain("write_file");
    expect(content).not.toContain("patch_file");
  });

  it("should enforce micro-slice input, surgical patching and test green-light loop in cph-coder-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");

    // Scoped micro-slice perception
    expect(content).toMatch(/微切片|局部切片|目标源码/);

    // Surgical patching and test green-light loop
    expect(content).toContain("patch_file");
    expect(content).toMatch(/绿灯/);
    expect(content).toContain("run_command");
    expect(content).toContain("FINAL_ANSWER");

    // No raw write_file tool action
    expect(content).not.toContain("tool: write_file");
  });

  it("should enforce end-to-end full snapshot perception and positive engineering delivery in cph-dev-agent-prompt.txt", () => {
    const content = fs.readFileSync(path.join(root, "cph-dev-agent-prompt.txt"), "utf8");

    // Standalone autonomous developer baseline
    expect(content).toContain("CPH-Dev");
    expect(content).toMatch(/全景(?:代码)?快照|全景视野|workspace-v1\.txt/);

    // TDD & patch-first delivery
    expect(content).toContain("patch_file");
    expect(content).toMatch(/测试|绿灯/);
    expect(content).toContain("FINAL_ANSWER");
    expect(content).not.toContain("严禁");
    expect(content).not.toContain("切勿");
  });

  it("should enforce DAG causality dispatch, scoped micro-slice specs, and stage barriers in skills/subagent/SKILL.md", () => {
    const content = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    // DAG causality & dispatch guide
    expect(content).toContain("DAG");
    expect(content).toMatch(/因果/);

    // Scoped micro-slice standards
    expect(content).toMatch(/微切片/);
    expect(content).toContain("targetFiles");
    expect(content).toMatch(/prerequisite(?:Reports|Context)/);

    // Stage barriers & causality sequence
    expect(content).toContain("阶段屏障");
    expect(content).toContain("stage: 1");
    expect(content).toContain("stage: 2");
    expect(content).toMatch(/契约先于实现/);
    expect(content).toMatch(/底座先于应用/);
    expect(content).toMatch(/研判先于重构/);
    expect(content).toMatch(/实施先于集成/);

    // Disjoint concurrency
    expect(content).toMatch(/正交.*并发/);
  });

  it("should enforce anti-amnesia contract, incremental snapshot alignment, and positive anti-early exit in skills/handoff/SKILL.md", () => {
    const content = fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8");

    // Anti-amnesia contract: inherit plan.md and full snapshot, proceed with P0/P1 without re-confirming initial goals
    expect(content).toMatch(/天然继承.*(?:plan\.md|物理清单)/);
    expect(content).toMatch(/全景快照/);
    expect(content).toMatch(/无需.*(?:重新向用户确认|重复确认).*初始.*目标/);

    // Incremental snapshot delivery
    expect(content).toMatch(/workspace-vN\.txt|递增.*快照/);

    // P0/P1 tiers and positive anti-early-exit invariant
    expect(content).toContain("plan.md");
    expect(content).toMatch(/P0/);
    expect(content).toMatch(/P1/);
    expect(content).toContain("反早退");
  });

  it("should synchronize all 4 prompts, skills, and distribution artifacts into package/agent-bundle via package-agent-bundle.ts", () => {
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
    expect(fs.existsSync(researcherInstructions)).toBe(true);
    expect(fs.existsSync(devInstructions)).toBe(true);

    // Verify content matches source prompts
    expect(fs.readFileSync(mainInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8"));
    expect(fs.readFileSync(coderInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8"));
    expect(fs.readFileSync(researcherInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8"));
    expect(fs.readFileSync(devInstructions, "utf8")).toBe(fs.readFileSync(path.join(root, "cph-dev-agent-prompt.txt"), "utf8"));

    // 2. Verify raw prompts also preserved in package/agent-bundle/
    for (const promptFile of promptFiles) {
      const bundlePromptPath = path.join(packageBundleDir, promptFile);
      expect(fs.existsSync(bundlePromptPath)).toBe(true);
      expect(fs.readFileSync(bundlePromptPath, "utf8")).toBe(fs.readFileSync(path.join(root, promptFile), "utf8"));
    }

    // 3. Verify skills packaged in package/agent-bundle/skills/
    const subagentSkillPath = path.join(packageBundleDir, "skills", "subagent", "SKILL.md");
    const handoffSkillPath = path.join(packageBundleDir, "skills", "handoff", "SKILL.md");
    expect(fs.existsSync(subagentSkillPath)).toBe(true);
    expect(fs.existsSync(handoffSkillPath)).toBe(true);
    expect(fs.readFileSync(subagentSkillPath, "utf8")).toBe(fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8"));
    expect(fs.readFileSync(handoffSkillPath, "utf8")).toBe(fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8"));
  });
});
