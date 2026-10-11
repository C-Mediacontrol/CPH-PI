import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  source: string;
  metadata?: Record<string, any>;
}

export interface SkillLoaderOptions {
  workspaceRoot?: string;
  customPaths?: string[];
  includeDefaults?: boolean;
}

/**
 * Multi-source Skill Loader discovering, reading and parsing SKILL.md files.
 */
export class SkillLoader {
  private workspaceRoot: string;
  private customPaths: string[];
  private includeDefaults: boolean;

  constructor(options: string | SkillLoaderOptions = {}) {
    if (typeof options === "string") {
      this.workspaceRoot = path.resolve(options);
      this.customPaths = [];
      this.includeDefaults = true;
    } else {
      this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
      this.customPaths = options.customPaths || [];
      this.includeDefaults = options.includeDefaults ?? true;
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Resolves search directories in standard precedence order:
   * 1. <workspace>/.skills
   * 2. <workspace>/skills
   * 3. <workspace>/.pi/skills
   * 4. ~/.gemini/config/skills
   * 5. ~/.gemini/antigravity/builtin/skills
   * 6. ~/.pi/agent/skills
   */
  public getSearchPaths(): string[] {
    const paths: string[] = [];

    // Custom paths have top priority if specified
    for (const p of this.customPaths) {
      paths.push(this.resolveHome(p));
    }

    if (this.includeDefaults) {
      const home = os.homedir();
      paths.push(
        path.join(this.workspaceRoot, ".skills"),
        path.join(this.workspaceRoot, "skills"),
        path.join(this.workspaceRoot, ".pi", "skills"),
        path.join(home, ".gemini", "config", "skills"),
        path.join(home, ".gemini", "antigravity", "builtin", "skills"),
        path.join(home, ".pi", "agent", "skills")
      );
    }

    return paths;
  }

  private resolveHome(p: string): string {
    if (p.startsWith("~")) {
      return path.join(os.homedir(), p.slice(1).replace(/^[/\\]/, ""));
    }
    return path.resolve(p);
  }

  /**
   * Scans all search paths and discovers available skills.
   * Earlier discovery locations take precedence over subsequent locations
   * (e.g. Workspace skills override user or system-level skills).
   */
  public discoverSkills(): Skill[] {
    const skillsMap = new Map<string, Skill>();
    const searchPaths = this.getSearchPaths();

    for (const searchDir of searchPaths) {
      if (!fs.existsSync(searchDir)) continue;

      try {
        const stat = fs.statSync(searchDir);
        if (!stat.isDirectory()) continue;

        const entries = fs.readdirSync(searchDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = path.join(searchDir, entry.name, "SKILL.md");
            const altSkillPath = path.join(searchDir, entry.name, "skill.md");

            let targetFile = "";
            if (fs.existsSync(skillPath)) {
              targetFile = skillPath;
            } else if (fs.existsSync(altSkillPath)) {
              targetFile = altSkillPath;
            }

            if (targetFile) {
              const skill = this.loadSkillFromFile(targetFile, entry.name, searchDir);
              if (skill) {
                const key = skill.name.toLowerCase();
                if (!skillsMap.has(key)) {
                  skillsMap.set(key, skill);
                }
              }
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            // Standalone skill file inside skills folder
            const fallbackName = entry.name.replace(/\.md$/i, "");
            const targetFile = path.join(searchDir, entry.name);
            const skill = this.loadSkillFromFile(targetFile, fallbackName, searchDir);
            if (skill) {
              const key = skill.name.toLowerCase();
              if (!skillsMap.has(key)) {
                skillsMap.set(key, skill);
              }
            }
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    return Array.from(skillsMap.values());
  }

  /**
   * Reads and parses a single SKILL.md file into a Skill object.
   */
  public loadSkillFromFile(filePath: string, fallbackName: string, sourceDir: string): Skill | null {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = SkillLoader.parseSkillMarkdown(raw, fallbackName);

      const isWorkspace = filePath.startsWith(this.workspaceRoot);
      const source = isWorkspace ? "workspace" : sourceDir;

      return {
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        filePath,
        source,
        metadata: parsed.metadata,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parses YAML frontmatter and markdown body from SKILL.md content.
   */
  public static parseSkillMarkdown(
    content: string,
    fallbackName: string
  ): {
    name: string;
    description: string;
    content: string;
    metadata: Record<string, any>;
  } {
    const trimmed = content.trim();
    // Frontmatter regex matching --- block at the start
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = trimmed.match(frontmatterRegex);

    const metadata: Record<string, any> = {};
    let body = trimmed;

    if (match) {
      const yamlBlock = match[1];
      body = match[2].trim();

      const lines = yamlBlock.split(/\r?\n/);
      let currentKey = "";
      let currentValue = "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const colonIdx = line.indexOf(":");
        if (colonIdx > 0 && !rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
          if (currentKey) {
            metadata[currentKey] = SkillLoader.cleanYamlValue(currentValue);
          }
          currentKey = line.slice(0, colonIdx).trim();
          currentValue = line.slice(colonIdx + 1).trim();
        } else if (currentKey) {
          currentValue += " " + line;
        }
      }
      if (currentKey) {
        metadata[currentKey] = SkillLoader.cleanYamlValue(currentValue);
      }
    }

    const name = metadata.name || fallbackName;
    const description = metadata.description || "";

    return {
      name,
      description,
      content: body,
      metadata,
    };
  }

  private static cleanYamlValue(val: string): string {
    let cleaned = val.trim();
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1);
    }
    return cleaned.trim();
  }
}
