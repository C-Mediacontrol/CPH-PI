import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Agent prompt and bundle registration contract", () => {
  const mainPrompt = read("cph-main-agent-prompt.txt");
  const coderPrompt = read("cph-coder-agent-prompt.txt");
  const devPrompt = read("cph-dev-agent-prompt.txt");

  test("Main and Coder register the deliverables landing contract", () => {
    for (const prompt of [mainPrompt, coderPrompt]) {
      expect(prompt).toContain("【交付文件与落盘指引 / Deliverables】");
      expect(prompt).toContain("<-");
      expect(prompt).toContain("remote-workspace-catalog.md");
    }
  });

  test("Dev prompt references the catalog and stops promising an unmounted snapshot", () => {
    expect(devPrompt).toContain("remote-workspace-catalog.md");
    expect(devPrompt).not.toContain("workspace-v1.txt");
  });

  test("handoff and subagent skills reference the same catalog name", () => {
    for (const skill of ["skills/handoff/SKILL.md", "skills/subagent/SKILL.md"]) {
      expect(read(skill)).toContain("remote-workspace-catalog.md");
    }
  });

  test("package bundle mirrors the source prompts byte-for-byte", () => {
    const mirrorPairs: Array<[string, string]> = [
      ["cph-main-agent-prompt.txt", "package/agent-bundle/cph-main-agent-prompt.txt"],
      ["cph-coder-agent-prompt.txt", "package/agent-bundle/cph-coder-agent-prompt.txt"],
      ["cph-dev-agent-prompt.txt", "package/agent-bundle/cph-dev-agent-prompt.txt"],
      [
        "cph-main-agent-prompt.txt",
        "package/agent-bundle/Instructions-Main-主协调智能体.txt",
      ],
      [
        "cph-coder-agent-prompt.txt",
        "package/agent-bundle/Instructions-Coder-代码实现智能体.txt",
      ],
    ];
    for (const [source, mirror] of mirrorPairs) {
      expect(read(mirror)).toBe(read(source));
    }
  });

  test("package bundle mirrors the workspace skills byte-for-byte", () => {
    for (const name of ["handoff", "subagent"]) {
      expect(read(`package/agent-bundle/skills/${name}/SKILL.md`)).toBe(
        read(`skills/${name}/SKILL.md`)
      );
    }
  });
});
