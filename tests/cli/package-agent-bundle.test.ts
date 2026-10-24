import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("Package Agent Bundle - Dual-Agent Matrix", () => {
  it("should package prompts and update upload guide with skill mounting matrix", () => {
    const root = path.resolve(__dirname, "../../");
    execSync("bun run scripts/package-agent-bundle.ts", { cwd: root, stdio: "pipe" });

    const bundleDir = path.join(root, "dist", "copilot-agent-bundle");
    expect(fs.existsSync(bundleDir)).toBe(true);

    // 1. 验证双智能体提示词均已打包，Researcher 提示词不存在
    const mainPromptPath = path.join(bundleDir, "Instructions-Main-主协调智能体.txt");
    const coderPromptPath = path.join(bundleDir, "Instructions-Coder-代码实现智能体.txt");
    const researcherPromptPath = path.join(bundleDir, "Instructions-Researcher-深度调研智能体.txt");

    expect(fs.existsSync(mainPromptPath)).toBe(true);
    expect(fs.existsSync(coderPromptPath)).toBe(true);
    expect(fs.existsSync(researcherPromptPath)).toBe(false);

    expect(fs.readFileSync(mainPromptPath, "utf8").length).toBeGreaterThan(0);
    expect(fs.readFileSync(coderPromptPath, "utf8").length).toBeGreaterThan(0);

    // 2. 验证两个核心技能目录均已打包
    const skillsBundleDir = path.join(bundleDir, "skills");
    const subagentSkillPath = path.join(skillsBundleDir, "subagent", "SKILL.md");
    const handoffSkillPath = path.join(skillsBundleDir, "handoff", "SKILL.md");

    expect(fs.existsSync(subagentSkillPath)).toBe(true);
    expect(fs.existsSync(handoffSkillPath)).toBe(true);

    // 3. 验证 UPLOAD-GUIDE.md 及其技能挂载矩阵
    const guidePath = path.join(bundleDir, "UPLOAD-GUIDE.md");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guideContent = fs.readFileSync(guidePath, "utf8");

    // 验证技能挂载矩阵说明关键字
    expect(guideContent).toContain("Main 智能体");
    expect(guideContent).toContain("Coder 智能体");
    expect(guideContent).toContain("subagent");
    expect(guideContent).toContain("handoff");

    // 验证明确指引 Dual-Agent 挂载规范
    expect(guideContent).toContain("Main Agent: `skills/subagent` + `skills/handoff`");
    expect(guideContent).toContain("Coder Agent: `skills/handoff` (no subagent)");

    // 4. 验证 ZIP 压缩包生成
    const zipPath = path.join(root, "dist", "copilot-agent-bundle.zip");
    expect(fs.existsSync(zipPath)).toBe(true);
  });
});
