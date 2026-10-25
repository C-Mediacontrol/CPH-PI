import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("Dual-Agent System Prompts & Subagent Skill Contracts", () => {
  const root = path.resolve(__dirname, "../../");

  it("should enforce Cloud-First Grounding and direct reading in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("[SHAREPOINT REMOTE WORKSPACE]");
    expect(mainPrompt).toContain("[CLOUD-READY]");
    expect(mainPrompt).toContain("[LOCAL-NEW: use read_file]");
    expect(mainPrompt).toContain("CPH-Main（全栈云原生主控与首席架构师智能体）");
  });

  it("should enforce coordinator and coder delegation workflow in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("invoke_subagent");
    expect(mainPrompt).toMatch(/role:\s*"coder"/);
    expect(mainPrompt).toContain("plan.md");
    expect(mainPrompt).toContain("DAG 阶段屏障（Stage Barrier）");
  });

  it("should enforce physical plan checklist invariant and convergence gate in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("plan.md");
    expect(mainPrompt).toContain("- [ ]");
    expect(mainPrompt).toContain("- [x]");
    expect(mainPrompt).toContain("FINAL_ANSWER");
    expect(mainPrompt).toContain("收敛门禁");
    expect(mainPrompt).toContain("已审阅文件与取证来源清单");
  });

  it("should enforce internalized skills and anonymous dispatch contract in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("技能内化与具象指令");
    expect(mainPrompt).toContain("invoke_subagent");
  });

  it("should enforce pure worker contract in coder prompt without external skill reliance", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    expect(coderPrompt).toContain("CPH-Coder（云原生专项代码实施与验证智能体）");
    expect(coderPrompt).toContain("```handoff");
    expect(coderPrompt).not.toContain("invoke_subagent");
    expect(coderPrompt).toContain("patch_file");
    expect(coderPrompt).toContain("run_command");
    expect(coderPrompt).toContain("FINAL_ANSWER");
  });

  it("should declare micro handoff contract in coder prompt", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    expect(coderPrompt).toContain("handoff");
    expect(coderPrompt).toMatch(/第 25 至第 29 轮/);
    expect(coderPrompt).not.toContain("invoke_subagent");
  });

  it("should define Four Coder Dispatch Gates in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("Coder 派发四大核心门禁");
    expect(skillContent).toContain("Gate 1：云端认知先行与契约锚定");
    expect(skillContent).toContain("Gate 2：文件正交隔离与 DAG 阶段屏障（Stage Barrier）");
    expect(skillContent).toContain("Gate 3：技能内化与无名化具象派发");
    expect(skillContent).toContain("Gate 4：`plan.md` 物理任务清单对账与派发即提交");
  });

  it("should enforce internalized skills, anonymous dispatch and plan.md alignment in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("技能内化与无名化具象派发");
    expect(skillContent).toContain("plan.md");
    expect(skillContent).toContain("patch_file");
    expect(skillContent).toContain("- [ ]");
    expect(skillContent).toContain("- [x]");
    expect(skillContent).toContain("FINAL_ANSWER");
  });

  it("should enforce physical plan alignment, P0/P1 two-tier structure, and anti-early exit invariant in skills/handoff/SKILL.md", () => {
    const handoffContent = fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8");
    expect(handoffContent).toContain("plan.md");
    expect(handoffContent).toContain("物理任务计划对账");
    expect(handoffContent).toMatch(/P0（断点现场恢复 \/ Immediate Resumption）/);
    expect(handoffContent).toMatch(/P1（战役核心推进 \/ Core Campaign Progression）/);
    expect(handoffContent).toContain("反早退收敛准则");
    expect(handoffContent).toContain("天然继承与零重复确认");
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

  it("should declare Gate 2 Stage Barrier and causality rules in subagent skill and main prompt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    expect(skillContent).toContain("Gate 2");
    expect(skillContent).toContain("阶段屏障");
    expect(skillContent).toContain("stage");

    expect(mainPrompt).toContain("阶段屏障");
    expect(mainPrompt).toContain("stage");
  });

  it("should enforce strict role tool boundaries: coder has patch_file, read_file, run_command, and no raw write_file", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");

    expect(coderPrompt).toContain("patch_file");
    expect(coderPrompt).toContain("read_file");
    expect(coderPrompt).toContain("run_command");
    expect(coderPrompt).not.toContain('"tool": "write_file"');

    expect(mainPrompt).toContain("invoke_subagent");
    expect(mainPrompt).toContain("patch_file");
    expect(mainPrompt).toContain("read_file");
    expect(mainPrompt).toContain("run_command");
    expect(mainPrompt).toContain("write_file");
  });

  it("should positively guide script-based testing and error diagnostic self-healing in coder prompt", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    expect(coderPrompt).toContain("单行原生测试命令");
    expect(coderPrompt).toContain("独立测试脚本文件");
    expect(coderPrompt).toContain("自愈与纠偏闭环");
    expect(coderPrompt).not.toContain("严禁执行复杂命令");
    expect(coderPrompt).not.toContain("切勿重试");
  });

  it("should enforce Cloud-First direct reading and traceable delivery in main prompt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("云端工作区全景直读与精准补读");
    expect(mainPrompt).toContain("主控一步直出闭环");
    expect(mainPrompt).toContain("已审阅文件与取证来源清单");
    expect(mainPrompt).toContain("FINAL_ANSWER");
  });

  it("should positively guide cloud-first grounding and green-light closure in coder prompt", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    expect(coderPrompt).toContain("云端上下文直读与局部精准补读");
    expect(coderPrompt).toContain("外科手术式精准补丁与原生文件生成");
    expect(coderPrompt).toContain("靶向测试验证、自愈纠偏与 PowerShell 原生稳健执行规范");
    expect(coderPrompt).toContain("高效收敛与微交接契约");
    expect(coderPrompt).not.toContain("严禁");
    expect(coderPrompt).not.toContain("切勿");
    expect(coderPrompt).not.toContain("不要");
    expect(coderPrompt).not.toContain("杜绝");
  });

  it("should declare Coder subagent dispatch and convergence contracts in subagent SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("云原生专项编码子代理（Coder Subagent）调度规范");
    expect(skillContent).toContain("适用场景与主控直读边界");
    expect(skillContent).toContain("Coder 派发四大核心门禁");
    expect(skillContent).toContain("标准 `invoke_subagent` 调用范式");
    expect(skillContent).toContain("成果回收与对账收敛");
  });

  it("should verify SubagentRunner defaults unspecified roles to coder and preserves isInlineScoutTask export", async () => {
    const runnerSource = fs.readFileSync(path.join(root, "src/agent/subagent-runner.ts"), "utf8");
    expect(runnerSource).toContain("export { isInlineScoutTask };");
    expect(runnerSource).toMatch(/taskSpec\.role === "researcher" \? "researcher" : "coder"/);

    const { isInlineScoutTask } = await import("../../src/agent/subagent-runner.ts");
    expect(typeof isInlineScoutTask).toBe("function");
  });

  it("should verify isInlineScoutTask behavior in orchestrator / subagent-runner", async () => {
    const { isInlineScoutTask } = await import("../../src/agent/subagent-runner.ts");
    expect(isInlineScoutTask([{ role: "researcher", isScout: true }])).toBe(true);
    expect(isInlineScoutTask([{ role: "researcher", description: "斥候探查架构大纲" }])).toBe(true);
    expect(isInlineScoutTask([{ role: "coder", description: "普通编码任务" }])).toBe(false);
  });

  it("should embed native PowerShell execution guide in main and coder agent prompts", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");

    for (const prompt of [mainPrompt, coderPrompt]) {
      expect(prompt).toContain("PowerShell 原生稳健执行规范");
      expect(prompt).toContain("变量内插优先");
      expect(prompt).toContain("独立脚本优先");
      expect(prompt).toContain("保持 PS 5.1 兼容");
      expect(prompt).toMatch(/-File\s+<?.*\.ps1>?/);
    }
  });

  it("should ensure skills/subagent/SKILL.md and skills/handoff/SKILL.md retire obsolete scout and researcher terms", () => {
    const subagentContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    const handoffContent = fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8");

    const retiredTerms = [
      "researcher",
      "searcher",
      "isScout",
      "斥候",
      "500 行",
      "300 行",
      "workspace-v1.txt",
      "workspace-vN.txt",
    ];

    for (const term of retiredTerms) {
      expect(subagentContent).not.toContain(term);
      expect(handoffContent).not.toContain(term);
    }
  });

  it("should package PowerShell-Agent-Guide into distribution bundle in docx, txt, pdf, and md formats", () => {
    const packagerScript = fs.readFileSync(path.join(root, "scripts/package-agent-bundle.ts"), "utf8");
    const guideDoc = fs.readFileSync(path.join(root, "docs/PowerShell-Agent-Guide.md"), "utf8");
    const guideTxt = fs.readFileSync(path.join(root, "docs/PowerShell-Agent-Guide.txt"), "utf8");

    expect(packagerScript).toContain("PowerShell-Agent-Guide.docx");
    expect(packagerScript).toContain("PowerShell-Agent-Guide.txt");
    expect(packagerScript).toContain("PowerShell-Agent-Guide.pdf");
    expect(packagerScript).toContain("专属知识库挂载指引");
    expect(guideDoc).toContain("PowerShell Agent 实战避坑与原生执行指南");
    expect(guideDoc).toContain("ParserError: (:)");
    expect(guideDoc).toContain("-File script.ps1");
    expect(guideTxt).toContain("PowerShell Agent 实战避坑与原生执行指南");
    expect(guideTxt).toContain("ParserError: (:)");
    expect(fs.existsSync(path.join(root, "docs/PowerShell-Agent-Guide.docx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs/PowerShell-Agent-Guide.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs/PowerShell-Agent-Guide.pdf"))).toBe(true);
  });

  it("should uphold Rule 3 constructive guidance without negative prohibition words across dual-agent prompts and skills", () => {
    const files = [
      "cph-main-agent-prompt.txt",
      "cph-coder-agent-prompt.txt",
      "skills/subagent/SKILL.md",
      "skills/handoff/SKILL.md",
    ];

    const negativeWords = ["严禁", "切勿", "不要", "禁止", "杜绝", "不得", "绝不允许"];
    for (const file of files) {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      for (const word of negativeWords) {
        expect(content).not.toContain(word);
      }
    }
  });
});
