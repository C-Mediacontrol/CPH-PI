import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { SkillLoader, type Skill } from "../../src/skills/skill-loader.ts";
import { SkillRegistry } from "../../src/skills/skill-registry.ts";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

describe("SkillLoader & SkillRegistry Unit Tests", () => {
  let tempWorkspace: string;
  let tempGlobal: string;

  beforeEach(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), "cph-pi-ws-skills-"));
    tempGlobal = await mkdtemp(join(tmpdir(), "cph-pi-global-skills-"));
  });

  afterEach(async () => {
    if (tempWorkspace) await rm(tempWorkspace, { recursive: true, force: true });
    if (tempGlobal) await rm(tempGlobal, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. YAML Frontmatter Parsing Assertions
  // =========================================================================
  describe("1. YAML Frontmatter Parsing Assertions", () => {
    it("should parse standard YAML frontmatter with name and description", () => {
      const markdown = `---
name: brainstorming
description: 任何创造性工作前必须使用——探索用户意图、需求与设计
---

# Brainstorming Ideas Into Designs
Always clarify requirements first.`;

      const parsed = SkillLoader.parseSkillMarkdown(markdown, "fallback");
      expect(parsed.name).toBe("brainstorming");
      expect(parsed.description).toBe("任何创造性工作前必须使用——探索用户意图、需求与设计");
      expect(parsed.content).toContain("# Brainstorming Ideas Into Designs");
      expect(parsed.content).toContain("Always clarify requirements first.");
      expect(parsed.content).not.toContain("---");
    });

    it("should clean quotes in frontmatter values", () => {
      const markdown = `---
name: "tdd"
description: '红绿重构TDD——行为驱动测试'
---

Write tests first.`;

      const parsed = SkillLoader.parseSkillMarkdown(markdown, "fallback");
      expect(parsed.name).toBe("tdd");
      expect(parsed.description).toBe("红绿重构TDD——行为驱动测试");
      expect(parsed.content).toBe("Write tests first.");
    });

    it("should support multiline descriptions in frontmatter", () => {
      const markdown = `---
name: deep-architect
description: Comprehensive multi-stage architecture review
  and refactoring workflow
---

Guidance body`;

      const parsed = SkillLoader.parseSkillMarkdown(markdown, "fallback");
      expect(parsed.name).toBe("deep-architect");
      expect(parsed.description).toContain("Comprehensive multi-stage architecture review");
      expect(parsed.description).toContain("and refactoring workflow");
    });

    it("should fallback to directory name when name is omitted in frontmatter", () => {
      const markdown = `---
description: A skill without explicit name
---

Body content`;

      const parsed = SkillLoader.parseSkillMarkdown(markdown, "auto-folder-name");
      expect(parsed.name).toBe("auto-folder-name");
      expect(parsed.description).toBe("A skill without explicit name");
      expect(parsed.content).toBe("Body content");
    });

    it("should gracefully handle markdown without any frontmatter", () => {
      const markdown = `# Raw Markdown Skill
Direct instructions without frontmatter delimiters.`;

      const parsed = SkillLoader.parseSkillMarkdown(markdown, "raw-skill");
      expect(parsed.name).toBe("raw-skill");
      expect(parsed.description).toBe("");
      expect(parsed.content).toBe(markdown);
    });
  });

  // =========================================================================
  // 2. Multi-Source Discovery & Workspace Precedence
  // =========================================================================
  describe("2. Multi-Source Discovery & Workspace Precedence", () => {
    it("should discover skills across multiple custom directories", async () => {
      // 1. Create a workspace skill in <workspace>/.skills/brainstorming/SKILL.md
      const wsSkillDir = join(tempWorkspace, ".skills", "brainstorming");
      await mkdir(wsSkillDir, { recursive: true });
      await writeFile(
        join(wsSkillDir, "SKILL.md"),
        `---
name: brainstorming
description: Workspace-specific brainstorming skill
---
Workspace version guidelines`
      );

      // 2. Create a global skill in <global>/tdd/SKILL.md
      const globalSkillDir = join(tempGlobal, "tdd");
      await mkdir(globalSkillDir, { recursive: true });
      await writeFile(
        join(globalSkillDir, "SKILL.md"),
        `---
name: tdd
description: Global TDD skill
---
Red-Green-Refactor guidelines`
      );

      const loader = new SkillLoader({
        workspaceRoot: tempWorkspace,
        customPaths: [join(tempWorkspace, ".skills"), tempGlobal],
        includeDefaults: false,
      });

      const discovered = loader.discoverSkills();
      expect(discovered.length).toBe(2);

      const names = discovered.map((s) => s.name);
      expect(names).toContain("brainstorming");
      expect(names).toContain("tdd");
    });

    it("should prioritize workspace skill over global skill when names collide", async () => {
      // Create duplicate skill named 'architect' in workspace and global
      const wsDir = join(tempWorkspace, "skills", "architect");
      await mkdir(wsDir, { recursive: true });
      await writeFile(
        join(wsDir, "SKILL.md"),
        `---
name: architect
description: WORKSPACE ARCHITECT
---
Workspace guidelines`
      );

      const globalDir = join(tempGlobal, "architect");
      await mkdir(globalDir, { recursive: true });
      await writeFile(
        join(globalDir, "SKILL.md"),
        `---
name: architect
description: GLOBAL ARCHITECT
---
Global guidelines`
      );

      const loader = new SkillLoader({
        workspaceRoot: tempWorkspace,
        customPaths: [join(tempWorkspace, "skills"), tempGlobal],
        includeDefaults: false,
      });

      const discovered = loader.discoverSkills();
      expect(discovered.length).toBe(1);
      expect(discovered[0].name).toBe("architect");
      expect(discovered[0].description).toBe("WORKSPACE ARCHITECT");
      expect(discovered[0].source).toBe("workspace");
    });
  });

  // =========================================================================
  // 3. SkillRegistry Matching (Exact, Prefix, Substring)
  // =========================================================================
  describe("3. SkillRegistry Matching (Exact, Prefix, Substring)", () => {
    let registry: SkillRegistry;

    beforeEach(() => {
      registry = new SkillRegistry();
      registry.registerSkill({
        name: "brainstorming",
        description: "Creative design brainstorming and clarifying questions",
        content: "Rule 1: Never write code before design approval.",
        filePath: "/fake/path/brainstorming/SKILL.md",
        source: "global",
      });
      registry.registerSkill({
        name: "tdd",
        description: "Test driven development with red-green refactoring",
        content: "Rule 1: Public interface tests first.",
        filePath: "/fake/path/tdd/SKILL.md",
        source: "global",
      });
      registry.registerSkill({
        name: "code-review",
        description: "Multi-dimensional code quality gate",
        content: "Rule 1: Check edge cases.",
        filePath: "/fake/path/code-review/SKILL.md",
        source: "global",
      });
    });

    it("should match exact skill name ignoring case and slash", () => {
      expect(registry.findSkill("tdd")?.name).toBe("tdd");
      expect(registry.findSkill("TDD")?.name).toBe("tdd");
      expect(registry.findSkill("/tdd")?.name).toBe("tdd");
      expect(registry.findSkill("brainstorming")?.name).toBe("brainstorming");
    });

    it("should match prefix: brainstorm -> brainstorming", () => {
      const matched = registry.findSkill("brainstorm");
      expect(matched).toBeDefined();
      expect(matched?.name).toBe("brainstorming");

      const slashMatched = registry.findSkill("/brainstorm");
      expect(slashMatched?.name).toBe("brainstorming");
    });

    it("should match substring: review -> code-review", () => {
      const matched = registry.findSkill("review");
      expect(matched).toBeDefined();
      expect(matched?.name).toBe("code-review");
    });

    it("should return undefined for unmatched queries", () => {
      expect(registry.findSkill("nonexistent-skill")).toBeUndefined();
      expect(registry.findSkill("")).toBeUndefined();
    });

    it("should search skills across name and description", () => {
      const results = registry.searchSkills("design");
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("brainstorming");

      const all = registry.searchSkills("");
      expect(all.length).toBe(3);
    });

    it("should toggle skill activation status properly", () => {
      expect(registry.isSkillActive("tdd")).toBe(false);

      const activateRes = registry.toggleSkill("tdd");
      expect(activateRes.active).toBe(true);
      expect(activateRes.skill?.name).toBe("tdd");
      expect(registry.isSkillActive("tdd")).toBe(true);
      expect(registry.getActiveSkills().map((s) => s.name)).toContain("tdd");

      const deactivateRes = registry.toggleSkill("tdd");
      expect(deactivateRes.active).toBe(false);
      expect(registry.isSkillActive("tdd")).toBe(false);
    });
  });

  // =========================================================================
  // 4. Slash Command Parsing (/skill-name task)
  // =========================================================================
  describe("4. Slash Command Parsing (/skill-name task)", () => {
    let registry: SkillRegistry;

    beforeEach(() => {
      registry = new SkillRegistry();
      registry.registerSkill({
        name: "brainstorming",
        description: "Design brainstorming",
        content: "Clarify first.",
        filePath: "/fake/brainstorming/SKILL.md",
        source: "global",
      });
      registry.registerSkill({
        name: "tdd",
        description: "TDD development",
        content: "Red green refactor.",
        filePath: "/fake/tdd/SKILL.md",
        source: "global",
      });
    });

    it("should parse /brainstorming with task description", () => {
      const parsed = registry.parseSlashCommand("/brainstorming 帮我设计一个用户认证模块");
      expect(parsed.isSlashCommand).toBe(true);
      expect(parsed.skill?.name).toBe("brainstorming");
      expect(parsed.task).toBe("帮我设计一个用户认证模块");
    });

    it("should parse prefix /brainstorm and map to brainstorming with task", () => {
      const parsed = registry.parseSlashCommand("/brainstorm 架构设计");
      expect(parsed.isSlashCommand).toBe(true);
      expect(parsed.skill?.name).toBe("brainstorming");
      expect(parsed.task).toBe("架构设计");
    });

    it("should parse /tdd without residual task", () => {
      const parsed = registry.parseSlashCommand("/tdd");
      expect(parsed.isSlashCommand).toBe(true);
      expect(parsed.skill?.name).toBe("tdd");
      expect(parsed.task).toBe("");
    });

    it("should return isSlashCommand false for standard task inputs", () => {
      const parsed = registry.parseSlashCommand("修复计算器加法缺陷");
      expect(parsed.isSlashCommand).toBe(false);
      expect(parsed.skill).toBeUndefined();
      expect(parsed.task).toBe("修复计算器加法缺陷");
    });

    it("should return undefined skill for unknown slash commands", () => {
      const parsed = registry.parseSlashCommand("/unknown-tool 执行某任务");
      expect(parsed.isSlashCommand).toBe(true);
      expect(parsed.skill).toBeUndefined();
      expect(parsed.task).toBe("执行某任务");
    });
  });

  // =========================================================================
  // 5. Prompt Section Injection
  // =========================================================================
  describe("5. Prompt Section Injection", () => {
    let registry: SkillRegistry;

    beforeEach(() => {
      registry = new SkillRegistry();
      registry.registerSkill({
        name: "brainstorming",
        description: "探索用户意图、需求与设计",
        content: "【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。",
        filePath: "/fake/brainstorming/SKILL.md",
        source: "global",
      });
    });

    it("should return empty string when no skills are active", () => {
      expect(registry.buildPromptSection()).toBe("");
    });

    it("should build structured Markdown prompt section for active skills", () => {
      registry.activateSkill("brainstorming");
      const section = registry.buildPromptSection();

      expect(section).toContain("【已激活专业工程技能手册 (Active Specialized Skills)】");
      expect(section).toContain("#### [技能 1: brainstorming]");
      expect(section).toContain("探索用户意图、需求与设计");
      expect(section).toContain("【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。");
    });

    it("should safely inject active skills into PromptBuilder.buildTurn1Prompt", () => {
      registry.activateSkill("brainstorming");
      const skillsSection = registry.buildPromptSection();

      const turn1Prompt = PromptBuilder.buildTurn1Prompt({
        workspaceRoot: "/project/app",
        gitFacts: "Branch: main",
        task: "设计消息总线架构",
        skillsSection,
      });

      expect(turn1Prompt).toContain("【当前已激活的专业技能 (Skill)】");
      expect(turn1Prompt).toContain("brainstorming");
      expect(turn1Prompt).toContain("【硬门槛】在用户批准设计前，严禁输出任何修改代码的动作。");
      expect(turn1Prompt).toContain("【当前用户任务】\n设计消息总线架构");
    });

    it("should emit internalized activation notice for agent mounted skills without dumping body", () => {
      registry.registerSkill({
        name: "handoff",
        description: "跨会话高保真接力交接规范",
        content: "【非常庞大的交接规范正文...多达数千字】",
        filePath: "/skills/handoff/SKILL.md",
        source: "workspace",
      });

      // handoff is agent-mounted by default
      expect(registry.isAgentMounted("handoff")).toBe(true);

      const section = registry.buildPromptSection([registry.findSkill("handoff")!]);
      expect(section).toContain("【已在 Agent 挂载的内置专业技能 (Agent Pre-mounted Skills)】");
      expect(section).toContain("- **[handoff]**: 跨会话高保真接力交接规范");
      // Must NOT contain full content body
      expect(section).not.toContain("【非常庞大的交接规范正文...多达数千字】");
    });

    it("should support toggling and setting custom agent mounted skills list", () => {
      expect(registry.isAgentMounted("brainstorming")).toBe(false);
      registry.toggleAgentMounted("brainstorming");
      expect(registry.isAgentMounted("brainstorming")).toBe(true);

      registry.setAgentMountedSkills(["tdd", "custom-skill"]);
      expect(registry.getAgentMountedSkills()).toEqual(["tdd", "custom-skill"]);
      expect(registry.isAgentMounted("handoff")).toBe(false);
      expect(registry.isAgentMounted("tdd")).toBe(true);
    });
  });
});
