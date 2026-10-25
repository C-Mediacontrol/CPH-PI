import { SkillLoader, type Skill } from "./skill-loader.ts";

export interface SlashCommandResult {
  skill?: Skill;
  task: string;
  isSlashCommand: boolean;
  rawCommand?: string;
}

export class SkillRegistry {
  private loader: SkillLoader;
  private availableSkills: Map<string, Skill> = new Map();
  private activeSkills: Map<string, Skill> = new Map();
  private agentMountedSkills: Set<string> = new Set(["handoff", "subagent"]);

  constructor(loader?: SkillLoader, agentMountedSkills?: string[]) {
    this.loader = loader || new SkillLoader();
    if (agentMountedSkills && Array.isArray(agentMountedSkills)) {
      this.agentMountedSkills = new Set(
        agentMountedSkills.map((s) => s.toLowerCase().replace(/^\//, "").trim())
      );
    }
  }

  public getAgentMountedSkills(): string[] {
    return Array.from(this.agentMountedSkills.values());
  }

  public isAgentMounted(name: string): boolean {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    return this.agentMountedSkills.has(key);
  }

  public setAgentMountedSkills(names: string[]): void {
    this.agentMountedSkills = new Set(
      names.map((s) => s.toLowerCase().replace(/^\//, "").trim())
    );
  }

  public toggleAgentMounted(name: string): boolean {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    if (this.agentMountedSkills.has(key)) {
      this.agentMountedSkills.delete(key);
      return false;
    } else {
      this.agentMountedSkills.add(key);
      return true;
    }
  }

  public setAgentMounted(name: string, mounted: boolean): void {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    if (mounted) {
      this.agentMountedSkills.add(key);
    } else {
      this.agentMountedSkills.delete(key);
    }
  }

  public getLoader(): SkillLoader {
    return this.loader;
  }

  /**
   * Scans and loads available skills from the loader.
   */
  public loadSkills(): Skill[] {
    const skills = this.loader.discoverSkills();
    this.availableSkills.clear();
    for (const skill of skills) {
      this.availableSkills.set(skill.name.toLowerCase(), skill);
    }
    return skills;
  }

  /**
   * Directly registers a skill in memory (useful for tests or dynamic skills).
   */
  public registerSkill(skill: Skill): void {
    this.availableSkills.set(skill.name.toLowerCase(), skill);
  }

  public getAvailableSkills(): Skill[] {
    return Array.from(this.availableSkills.values());
  }

  public getActiveSkills(): Skill[] {
    return Array.from(this.activeSkills.values());
  }

  public isSkillActive(name: string): boolean {
    const key = name.toLowerCase().replace(/^\//, "").trim();
    return this.activeSkills.has(key);
  }

  public activateSkill(name: string): boolean {
    const skill = this.findSkill(name);
    if (!skill) return false;
    this.activeSkills.set(skill.name.toLowerCase(), skill);
    return true;
  }

  public deactivateSkill(name: string): boolean {
    const skill = this.findSkill(name);
    if (!skill) return false;
    return this.activeSkills.delete(skill.name.toLowerCase());
  }

  public toggleSkill(name: string): { active: boolean; skill?: Skill } {
    const skill = this.findSkill(name);
    if (!skill) return { active: false };

    const key = skill.name.toLowerCase();
    if (this.activeSkills.has(key)) {
      this.activeSkills.delete(key);
      return { active: false, skill };
    } else {
      this.activeSkills.set(key, skill);
      return { active: true, skill };
    }
  }

  public clearActiveSkills(): void {
    this.activeSkills.clear();
  }

  /**
   * Finds a skill with priority:
   * 1. Exact match (case-insensitive)
   * 2. Prefix match (e.g. "brainstorm" matches "brainstorming")
   * 3. Substring match
   */
  public findSkill(query: string): Skill | undefined {
    const q = query.trim().toLowerCase().replace(/^\//, "");
    if (!q) return undefined;

    const skills = Array.from(this.availableSkills.values());

    // 1. Exact match
    const exact = skills.find((s) => s.name.toLowerCase() === q);
    if (exact) return exact;

    // 2. Prefix match
    const prefixMatches = skills.filter((s) => s.name.toLowerCase().startsWith(q));
    if (prefixMatches.length > 0) {
      prefixMatches.sort((a, b) => a.name.length - b.name.length);
      return prefixMatches[0];
    }

    // 3. Substring match
    const substringMatches = skills.filter((s) => s.name.toLowerCase().includes(q));
    if (substringMatches.length > 0) {
      substringMatches.sort((a, b) => a.name.length - b.name.length);
      return substringMatches[0];
    }

    return undefined;
  }

  /**
   * Searches skills by keyword across name and description.
   */
  public searchSkills(keyword: string): Skill[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return this.getAvailableSkills();

    return Array.from(this.availableSkills.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        (s.description && s.description.toLowerCase().includes(kw))
    );
  }

  /**
   * Parses slash command input:
   * e.g. "/brainstorming 帮我设计系统" -> { skill, task: "帮我设计系统", isSlashCommand: true }
   * e.g. "/brainstorm 需求" -> { skill, task: "需求", isSlashCommand: true } (prefix match)
   * e.g. "普通的任务描述" -> { task: "普通的任务描述", isSlashCommand: false }
   */
  public parseSlashCommand(input: string): SlashCommandResult {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return { task: input, isSlashCommand: false };
    }

    const spaceIdx = trimmed.indexOf(" ");
    let rawCmd: string;
    let task: string;

    if (spaceIdx === -1) {
      rawCmd = trimmed.slice(1).trim();
      task = "";
    } else {
      rawCmd = trimmed.slice(1, spaceIdx).trim();
      task = trimmed.slice(spaceIdx + 1).trim();
    }

    const matchedSkill = this.findSkill(rawCmd);
    return {
      skill: matchedSkill,
      task,
      isSlashCommand: true,
      rawCommand: rawCmd,
    };
  }

  /**
   * Builds formatted Markdown block for active skills to inject into prompt.
   * Differentiates between:
   * 1. Agent Pre-mounted Skills (uploaded to Agent Knowledge / Instructions):
   *    Emits an activation directive referencing the internalized skill, avoiding duplicate attachment or body dumping.
   * 2. Dynamic Attached Skills:
   *    Injects the full SKILL.md specification and rules.
   */
  public buildPromptSection(skills?: Skill[]): string {
    const targetSkills = skills ?? this.getActiveSkills();
    if (targetSkills.length === 0) return "";

    const mounted: Skill[] = [];
    const dynamic: Skill[] = [];

    for (const s of targetSkills) {
      if (this.isAgentMounted(s.name)) {
        mounted.push(s);
      } else {
        dynamic.push(s);
      }
    }

    const blocks: string[] = [];

    // 1. 已在 Agent 挂载的内置技能 (Agent Pre-mounted / Internalized Skills)
    if (mounted.length > 0) {
      const mountedItems = mounted.map((s) => {
        const desc = s.description ? `: ${s.description}` : "";
        return `- **[${s.name}]**${desc}`;
      });

      blocks.push(
        [
          "【已在 Agent 挂载的内置专业技能 (Agent Pre-mounted Skills)】",
          "当前任务已激活以下预置于你的专属知识库与系统指令中的工程技能。该技能规范已由你完全掌握，无需重复上传附件或倾倒正文，请直接唤醒并遵循你所持有的对应技能流程与阶段门禁执行：",
          ...mountedItems,
        ].join("\n")
      );
    }

    // 2. 需动态加载/挂载的技能 (Dynamic / External Skills)
    if (dynamic.length > 0) {
      const dynamicSections = dynamic.map((s, idx) => {
        const header = `#### [技能 ${idx + 1}: ${s.name}]`;
        const desc = s.description ? `**说明**: ${s.description}` : "";
        const body = s.content ? `**指引与约束规范**:\n${s.content}` : "";
        return [header, desc, body].filter(Boolean).join("\n");
      });

      blocks.push(
        [
          "【已激活专业工程技能手册 (Active Specialized Skills)】",
          "以下是你当前已激活的专属领域工程技能（动态全量挂载）。请在后续分析、计划与工具调用中严格遵守各技能的规范与铁律约束：",
          "",
          ...dynamicSections,
        ].join("\n")
      );
    }

    return blocks.join("\n\n");
  }
}
