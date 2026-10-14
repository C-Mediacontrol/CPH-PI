import { describe, it, expect } from "bun:test";
import { PromptBuilder } from "../../src/protocol/prompt-builder.ts";

describe("PromptBuilder - Turn 2 Argument Order & No Heuristic Inversion", () => {
  it("should never invert toolResult and skillsSection when toolResult contains 'Skill' (object options)", () => {
    const task = "代码审查任务";
    const toolResult = "Found 5 occurrences of Skill in skill-loader.ts: class SkillLoader";
    const skillsSection = "#### [技能 1: tdd]\n执行红绿测试";

    const prompt = PromptBuilder.buildTurn2TaskPrompt({
      task,
      toolResult,
      skillsSection,
      toolName: "run_command",
    });

    const toolResultIdx = prompt.indexOf(toolResult);
    const skillsIdx = prompt.indexOf(skillsSection);
    const handshakeIdx = prompt.indexOf("【环境握手完成：本地工具与工作区已就绪】");

    // toolResult must appear in the TOOL_RESULT section at the top, before handshake
    expect(toolResultIdx).toBeGreaterThan(-1);
    expect(toolResultIdx).toBeLessThan(handshakeIdx);

    // skillsSection must appear after handshake
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(handshakeIdx);

    // toolResult must NOT be under skills section
    expect(prompt).toContain(`[TOOL_RESULT for run_command - SUCCESS]:\n${toolResult}`);
    expect(prompt).toContain(`【当前已激活的专业技能 (Skill)】\n${skillsSection}`);
  });

  it("should never invert toolResult and skillsSection when toolResult contains '技能' (positional arguments)", () => {
    const task = "排查缺陷";
    const toolResult = "执行测试完成：测试技能装载器 3 个技能全数通过";
    const skillsSection = "Active Skill: systematic-debugging";

    const prompt = PromptBuilder.buildTurn2TaskPrompt(
      task,
      toolResult,
      skillsSection,
      "run_command"
    );

    const toolResultIdx = prompt.indexOf(toolResult);
    const skillsIdx = prompt.indexOf(skillsSection);
    const handshakeIdx = prompt.indexOf("【环境握手完成：本地工具与工作区已就绪】");

    expect(toolResultIdx).toBeGreaterThan(-1);
    expect(toolResultIdx).toBeLessThan(handshakeIdx);
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(handshakeIdx);

    expect(prompt).toContain(`[TOOL_RESULT for run_command - SUCCESS]:\n${toolResult}`);
    expect(prompt).toContain(`【当前已激活的专业技能 (Skill)】\n${skillsSection}`);
  });

  it("should handle omitted skillsSection with positional arguments without inversion", () => {
    const task = "构建项目";
    const toolResult = "Build completed with skill plugin enabled";

    const prompt = PromptBuilder.buildTurn2TaskPrompt(task, toolResult);

    expect(prompt).toContain(`[TOOL_RESULT - SUCCESS]:\n${toolResult}`);
    expect(prompt).not.toContain("【当前已激活的专业技能 (Skill)】");
    expect(prompt).toContain("【用户正式需求】\n构建项目");
  });
});
