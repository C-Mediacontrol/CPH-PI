import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("Tri-Agent System Prompts & Subagent Skill Contracts", () => {
  const root = path.resolve(__dirname, "../../");

  it("should contain physical Task Right-Sizing rules in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    // Abolish abstract turn counts, enforce 3 physical metrics
    expect(mainPrompt).not.toContain("10~20");
    expect(mainPrompt).toMatch(/核心(?:修改)?(?:源)?文件\s*(?:≤|<=|不超过)\s*1/);
    expect(mainPrompt).toMatch(/500\s*行/);
    expect(mainPrompt).toMatch(/(?:≤|<=|不超过)\s*2\s*个.*关注点/);
    expect(mainPrompt).toContain("物理指标");
  });

  it("should enforce coordinator purity and path restrictions in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("规划与调度中枢");
    // patch_file is restricted to plan.md, reports and docs; business code modification by main is prohibited
    expect(mainPrompt).toMatch(/patch_file.*(?:仅限|严格限定).*plan\.md/);
    expect(mainPrompt).toMatch(/(?:业务(?:源)?代码|业务代码).*invoke_subagent/);
  });

  it("should enforce physical plan checklist invariant and convergence gate in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    // Must establish physical plan.md in Turn 1~2
    expect(mainPrompt).toContain("plan.md");
    expect(mainPrompt).toContain("- [ ]");
    expect(mainPrompt).toContain("- [x]");
    // Convergence gate: no FINAL_ANSWER while uncompleted items remain
    expect(mainPrompt).toMatch(/FINAL_ANSWER/);
    expect(mainPrompt).toMatch(/收敛门禁/);
  });

  it("should enforce internalized skills and anonymous dispatch contract in cph-main-agent-prompt.txt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("内化");
    expect(mainPrompt).toMatch(/(?:严禁|不得).*(?:出现|包含|携带|提及).*(?:Skill|技能)\s*名称/);
  });

  it("should enforce pure worker contract in researcher and coder prompts without external skill reliance", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    // Cleaned up "挂载并调用" skill phrasing, pure native handoff block
    expect(coderPrompt).not.toContain("挂载并调用");
    expect(researcherPrompt).not.toContain("挂载并调用");
    expect(coderPrompt).toContain("```handoff");
    expect(researcherPrompt).toContain("```handoff");

    // Pure worker, zero skill reliance, single file focus
    expect(coderPrompt).toMatch(/(?:不寻找|不加载).*Skill/);
    expect(researcherPrompt).toMatch(/(?:不寻找|不加载).*Skill/);
    expect(coderPrompt).toMatch(/单文件|单一核心文件/);
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

  it("should define Gate 2 Task Right-Sizing with physical metrics in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("Gate 2");
    // Abolish abstract turn counts, enforce 3 physical metrics
    expect(skillContent).not.toContain("10~20");
    expect(skillContent).toContain("三大物理指标");
    expect(skillContent).toMatch(/核心(?:修改)?(?:源)?文件\s*(?:≤|<=|不超过)\s*1/);
    expect(skillContent).toMatch(/500\s*行/);
    expect(skillContent).toMatch(/(?:≤|<=|不超过)\s*2\s*个.*关注点/);
  });

  it("should enforce internalized skills, anonymous dispatch and plan.md alignment in skills/subagent/SKILL.md", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("技能内化");
    expect(skillContent).toContain("无名化派发");
    expect(skillContent).toMatch(/(?:严禁|不得).*(?:出现|包含|携带|提及).*(?:Skill|技能)\s*名称/);
    expect(skillContent).toContain("plan.md");
    expect(skillContent).toMatch(/plan\.md.*(?:打勾|对账|物理任务清单)/);
  });

  it("should enforce physical plan alignment, P0/P1 two-tier structure, and anti-early exit invariant in skills/handoff/SKILL.md", () => {
    const handoffContent = fs.readFileSync(path.join(root, "skills/handoff/SKILL.md"), "utf8");
    expect(handoffContent).toContain("plan.md");
    expect(handoffContent).toContain("物理任务计划对账");
    expect(handoffContent).toMatch(/P0.*(?:断点现场恢复|Immediate Resumption)/);
    expect(handoffContent).toMatch(/P1.*(?:战役核心推进|Core Campaign Progression)/);
    expect(handoffContent).toContain("反早退");
    expect(handoffContent).toMatch(/(?:严禁|绝不允许).*(?:早退|提前.*FINAL_ANSWER|P0.*等同于全局交付)/);
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

  it("should enforce strict role tool boundaries: researcher read-only and no raw write_file", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    // Researcher is strictly read-only: NO write_file, NO patch_file
    expect(researcherPrompt).not.toContain("write_file");
    expect(researcherPrompt).not.toContain("patch_file");
    expect(researcherPrompt).toContain("read_file");
    expect(researcherPrompt).toContain("run_command");

    // Coder has patch_file, but no raw write_file action to prevent code dump
    expect(coderPrompt).toContain("patch_file");
    expect(coderPrompt).not.toContain("tool: write_file");

    // Main has orchestrator tools, but no raw write_file action
    expect(mainPrompt).toContain("invoke_subagent");
    expect(mainPrompt).toContain("patch_file");
    expect(mainPrompt).not.toContain("tool: write_file");

    // All prompts use native handoff block, never tool: write_file for handoff
    expect(mainPrompt).not.toContain("tool: write_file");
    expect(coderPrompt).not.toContain("tool: write_file");
    expect(researcherPrompt).not.toContain("tool: write_file");
  });

  it("should positively guide script-based testing and error diagnostic self-healing in coder prompt", () => {
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    // Positive guidance on simple commands and script file generation for complex validations
    expect(coderPrompt).toMatch(/(?:单行原生命令|原生测试命令)/);
    expect(coderPrompt).toMatch(/(?:独立测试脚本文件|脚本文件)/);
    // Positive guidance on error diagnostic self-healing
    expect(coderPrompt).toMatch(/(?:语法错误|报错输出|具体信息)/);
    expect(coderPrompt).toMatch(/(?:基于客观事实|自愈与纠偏闭环|调整命令)/);
    // Strict compliance with Rule 3: No negative prohibition words in new guidance
    expect(coderPrompt).not.toContain("严禁执行复杂命令");
    expect(coderPrompt).not.toContain("切勿重试");
  });

  it("should declare Two-Stage Scout protocol and Plan Refinement Scope Conservation in main prompt (Task 3)", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    expect(mainPrompt).toContain("两阶段斥候领航协议");
    expect(mainPrompt).toMatch(/isScout|斥候探查架构大纲/);
    expect(mainPrompt).toContain("内联等待模式");
    expect(mainPrompt).toContain("范围守恒律");
    expect(mainPrompt).toMatch(/300\s*行/);
    expect(mainPrompt).toContain("单点补缺");
  });

  it("should positively guide turn-1 attachment reading and semantic chunk review in researcher prompt (Task 3)", () => {
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");
    expect(researcherPrompt).toContain("开局附件直通与全量阅读");
    expect(researcherPrompt).toContain("宏观语义块审阅");
    expect(researcherPrompt).toContain("单会话高效交付闭环");
    // Strict compliance with Rule 3: No negative prohibition words in new guidance
    expect(researcherPrompt).not.toContain("严禁");
    expect(researcherPrompt).not.toContain("切勿");
    expect(researcherPrompt).not.toContain("不要");
    expect(researcherPrompt).not.toContain("杜绝");
  });

  it("should declare Scout template, Dual-Track Scheduling, and Plan Scope Conservation in subagent SKILL.md (Task 4)", () => {
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");
    expect(skillContent).toContain("斥候角色");
    expect(skillContent).toContain("isScout");
    expect(skillContent).toContain("双轨调度门禁");
    expect(skillContent).toContain("轨道 1：单 Scout 斥候内联等待");
    expect(skillContent).toContain("轨道 2：Swarm 批量并发虚拟化");
    expect(skillContent).toContain("Plan 范围守恒律与 Partial Success 纵向切片");
  });

  it("should enforce Two-Stage Role Decoupling and Deferred Skill Injection in main prompt and subagent SKILL.md", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    expect(mainPrompt).toContain("两阶段职责解耦与技能延后注入准则");
    expect(mainPrompt).toContain("第一阶段斥候工单极简化");
    expect(mainPrompt).toContain("第二阶段集群攻坚工单精准化");
    expect(mainPrompt).toContain("完整保留在主控自身的规划心智中");

    expect(skillContent).toContain("业务技能解耦与延后注入");
    expect(skillContent).toContain("完整保留在主控自身的规划心智中");

    // Compliance with Rule 3: No negative prohibition words in Two-Stage guidance
    const twoStageSection = mainPrompt.substring(
      mainPrompt.indexOf("两阶段职责解耦与技能延后注入准则"),
      mainPrompt.indexOf("7. **子任务体量三大物理度量指标")
    );
    expect(twoStageSection).not.toContain("严禁");
    expect(twoStageSection).not.toContain("切勿");
    expect(twoStageSection).not.toContain("不要");
    expect(twoStageSection).not.toContain("杜绝");
  });

  it("should prepend scout guideline header in subagent-runner.ts for inline scout tasks", () => {
    const runnerSource = fs.readFileSync(path.join(root, "src/agent/subagent-runner.ts"), "utf8");
    expect(runnerSource).toContain("isInlineScoutTask");
    expect(runnerSource).toContain("【斥候宏观侦察工单】");
    expect(runnerSource).toMatch(/本阶段任务聚焦于目标文件的宏观结构概览与顶层大纲探查/);
  });

  it("should embed native PowerShell execution guide in all three agent prompts", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const coderPrompt = fs.readFileSync(path.join(root, "cph-coder-agent-prompt.txt"), "utf8");
    const researcherPrompt = fs.readFileSync(path.join(root, "cph-researcher-agent-prompt.txt"), "utf8");

    for (const prompt of [mainPrompt, coderPrompt, researcherPrompt]) {
      expect(prompt).toContain("PowerShell 原生稳健执行规范");
      expect(prompt).toContain("变量内插优先");
      expect(prompt).toContain("独立脚本优先");
      expect(prompt).toContain("保持 PS 5.1 兼容");
      expect(prompt).toMatch(/-File\s+<?.*\.ps1>?/);
    }
  });

  it("should enforce Scout prompt physical outline standard with 3 physical metrics in subagent SKILL.md and main prompt", () => {
    const mainPrompt = fs.readFileSync(path.join(root, "cph-main-agent-prompt.txt"), "utf8");
    const skillContent = fs.readFileSync(path.join(root, "skills/subagent/SKILL.md"), "utf8");

    // Main prompt Scout focus on 3 physical metrics
    expect(mainPrompt).toMatch(/三大物理指标.*起止行号/);
    expect(mainPrompt).toMatch(/300\s*行/);

    // Scout template in SKILL.md
    expect(skillContent).toContain("【斥候探测目标】: 快速摸清 <目标文件或模块> 的物理结构大纲与核心数据流。");
    expect(skillContent).toContain("梳理文件内的核心类定义、主要函数清单及其起始与结束行号范围");
    expect(skillContent).toContain("提取输入到输出的核心数据流动拓扑");
    expect(skillContent).toContain("基于物理行号提出后续精细切片建议（每个切片聚焦于 ≤300 行核心逻辑或单一子系统）。");
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

  it("should uphold Rule 3 constructive guidance without negative prohibition words across tri-agent prompts and subagent skill", () => {
    const files = [
      "cph-main-agent-prompt.txt",
      "cph-coder-agent-prompt.txt",
      "cph-researcher-agent-prompt.txt",
      "skills/subagent/SKILL.md",
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      expect(content).not.toContain("严禁");
      expect(content).not.toContain("切勿");
    }
  });
});


