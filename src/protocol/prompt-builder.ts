export interface Turn1PromptOptions {
  workspaceRoot: string;
  gitFacts?: string;
  dirTree?: string;
  task?: string;
  environmentFilePath?: string;
  skillsSection?: string;
}

export interface ReGroundingOptions {
  workspaceRoot: string;
  gitFacts?: string;
  historySummary?: string;
  currentTask?: string;
  environmentFilePath?: string;
  skillsSection?: string;
}

export class PromptBuilder {
  public static readonly PROTOCOL_REMINDER = `【交接协议规范 (Turn Protocol Contract)】
1. 若需继续执行，必须且仅输出一个 \`\`\`action 块：
   - 读取文件: tool: read_file \\n path: <path> \\n start_line: 1 \\n end_line: 100
   - 局部修改: tool: edit \\n path: <path> \\n old_string: <old> \\n new_string: <new>
   - 写入文件: tool: write_file \\n path: <path> \\n content: <content>
   - 运行命令: tool: run_command \\n command: <cmd>
   - 提问用户: tool: ask_question \\n question: <question>
2. 当所有目标已达成且验证充分时，直接在独立一行输出最终交付总结：
   FINAL_ANSWER: <任务交付总结说明>`;

  /**
   * Constructs the grounded Turn 1 prompt embedding physical workspace facts,
   * Git repository state, directory tree preview, and available Pi native tools.
   */
  public static buildTurn1Prompt(options: Turn1PromptOptions): string {
    const wsNorm = options.workspaceRoot.replace(/\\/g, "/");
    const gitStatus = options.gitFacts || "Git: 未初始化或无未提交变更 (clean)";
    const treePreview = options.dirTree ? `\n【核心目录结构预览】\n${options.dirTree}\n` : "";

    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。你直接运行在用户本地宿主机的 CPH-PI 运行环境中，具备真实物理磁盘读写与终端命令执行工具（Tool Calling）。

【本地宿主机与工作区事实 (Grounding Facts)】
- 工作区绝对路径: ${wsNorm}
- 本地 Git 仓库状态:
${gitStatus}
${treePreview}
【可用工具格式 (Tool Calling)】
当你需要读取文件、修改代码、创建文件、运行测试命令或向用户提问时，请输出 \`\`\`action 块：
1. 读取文件内容 (每次最多读取 100 行)：
\`\`\`action
tool: read_file
path: <文件路径>
start_line: 1
end_line: 100
\`\`\`
2. 局部精准编辑文件（推荐！仅替换指定代码段，避免全量覆写导致大文件截断）：
\`\`\`action
tool: edit
path: <文件路径>
old_string: <要替换的原代码段>
new_string: <替换后的新代码段>
\`\`\`
3. 写入或新建文件：
\`\`\`action
tool: write_file
path: <文件路径>
content: <文件完整内容>
\`\`\`
4. 运行终端命令：
\`\`\`action
tool: run_command
command: <命令字符串>
\`\`\`
5. 向用户提问或选项确认：
\`\`\`action
tool: ask_question
question: <问题内容>
options: 选项A | 选项B (可选)
\`\`\`

${options.skillsSection ? `【当前已激活的专业技能 (Skill)】\n${options.skillsSection}\n\n` : ""}${options.task ? `【当前用户任务】\n${options.task}\n\n` : ""}${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Dedicated prompt for custom agents (e.g. CPH-Dev).
   * Strips verbose tool calling instructions and protocol contract, trusting cloud-side instructions,
   * directly delivering workspace root facts and user task to save massive tokens.
   */
  public static buildDirectAgentPrompt(
    workspaceRoot: string,
    task: string,
    activeSkillsSection = ""
  ): string {
    const wsNorm = workspaceRoot.replace(/\\/g, "/");

    let prompt = `【本地宿主机工作区事实】
- 工作区绝对路径: ${wsNorm}`;

    if (activeSkillsSection && activeSkillsSection.trim() !== "") {
      prompt += `\n\n【当前已激活的专业技能 (Skill)】\n${activeSkillsSection.trim()}`;
    }

    prompt += `\n\n【用户正式需求】\n${task}`;

    return prompt;
  }

  /**
   * Dedicated Turn 1 Handshake prompt for two-phase startup.
   * Instructs the model to perform an initial directory or file read to establish tool grounding.
   */
  public static buildHandshakePrompt(
    workspaceRoot: string,
    gitFacts: string,
    dirTree?: string
  ): string {
    const wsNorm = workspaceRoot.replace(/\\/g, "/");
    const treePreview = dirTree ? `\n【当前工作区精简目录树】\n${dirTree}\n` : "";

    return `你是一个运行在本地宿主机的 CPH-PI 自主编程智能体。你的工具链路已直接接入物理操作系统。

【本地宿主机工作区事实】
- 工作区绝对路径: ${wsNorm}
- Git 仓库客观状态:
${gitFacts}
${treePreview}
【第一轮基准探测握手 (Turn 1 Grounding Handshake)】
这是新会话的第一轮交互。为验证本地真实工具调用链路与工作区文件系统连接，请第一步务必输出 action 块检查工作区状态（例如读取目标文件或执行探测命令）：
\`\`\`action
tool: run_command
command: git status
\`\`\`

在本地完成初次探测并反馈 [TOOL_RESULT] 后，系统将在第二轮注入用户的正式业务需求与全量流程！`;
  }

  /**
   * Builds Turn 2 task prompt after Turn 1 handshake succeeds.
   * Supports both (task, skillsSection, toolResult) and (task, toolResult, skillsSection).
   */
  public static buildTurn2TaskPrompt(
    task: string,
    arg2: string,
    arg3 = "",
    toolName?: string
  ): string {
    let skillsSection = "";
    let toolResult = "";

    if (arg3 !== undefined && arg3 !== "") {
      if (arg2.includes("Skill") || arg2.includes("技能") || arg2 === "") {
        skillsSection = arg2;
        toolResult = arg3;
      } else if (arg3.includes("Skill") || arg3.includes("技能")) {
        toolResult = arg2;
        skillsSection = arg3;
      } else {
        skillsSection = arg2;
        toolResult = arg3;
      }
    } else {
      toolResult = arg2;
      skillsSection = "";
    }

    const toolHeader = toolName
      ? `[TOOL_RESULT for ${toolName} - SUCCESS]:`
      : `[TOOL_RESULT - SUCCESS]:`;

    return `${toolHeader}
${toolResult}

【环境握手完成：本地工具与工作区已就绪】
${skillsSection ? `【当前已激活的专业技能 (Skill)】\n${skillsSection}\n\n` : ""}
【用户正式需求】
${task}

【执行规则与推进要求】
1. 深入分析工作区现状，按需使用 read_file、edit、write_file、run_command 开展工作；
2. 若需运行测试，输出 tool: run_command 调用对应测试命令；
3. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。

${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Builds continuation prompt containing tool execution output and protocol reinforcement.
   */
  public static buildToolResultPrompt(
    toolName: string,
    success: boolean,
    output: string,
    error?: string
  ): string {
    if (success) {
      return `[TOOL_RESULT for ${toolName} - SUCCESS]:
${output}

${this.PROTOCOL_REMINDER}`;
    } else {
      return `[TOOL_RESULT for ${toolName} - FAILED]:
Error: ${error || "Execution failed"}
Output: ${output}

请根据错误进行分析并尝试排查修复：
${this.PROTOCOL_REMINDER}`;
    }
  }

  /**
   * Generates a head-tail excerpt fingerprint for large content.
   * If line count > (maxHeadLines + maxTailLines) (default 50 lines),
   * extracts the first maxHeadLines and last maxTailLines, with an omission note in between.
   * If line count <= (maxHeadLines + maxTailLines), returns the raw text directly.
   */
  public static generateHeadTailExcerpt(
    rawContent: string,
    maxHeadLines = 25,
    maxTailLines = 25
  ): string {
    const lines = rawContent.split(/\r?\n/);
    const threshold = maxHeadLines + maxTailLines;
    if (lines.length <= threshold) {
      return rawContent;
    }
    const omittedCount = lines.length - maxHeadLines - maxTailLines;
    const head = lines.slice(0, maxHeadLines).join("\n");
    const tail = lines.slice(lines.length - maxTailLines).join("\n");
    return `${head}\n... (省略 ${omittedCount} 行) ...\n${tail}`;
  }

  /**
   * Builds high-efficiency tool result prompt when output is attached as a cloud file.
   * Completely avoids dumping massive texts into chat, preventing attention dilution and timeouts.
   * Embeds physical execution fingerprint if excerpt is provided.
   */
  public static buildAttachedToolResultPrompt(
    toolName: string,
    fileName: string,
    summary: { lineCount: number; charCount: number },
    excerpt?: string
  ): string {
    const fingerprintBlock = excerpt
      ? `\n\n【物理执行指纹摘要 (Head-Tail Fingerprint)】:\n${excerpt}`
      : "";

    return `[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ ${toolName} 执行成功 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)。
完整执行结果已作为文件附件【${fileName}】挂载送达。
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件已解析的全部数据推进后续技术推演与操作。${fingerprintBlock}

${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Builds Turn 2 task prompt when initial handshake output is attached as a cloud file.
   */
  public static buildTurn2TaskPromptWithAttachment(
    task: string,
    skillsSection: string,
    toolName: string,
    fileName: string,
    summary: { lineCount: number; charCount: number },
    excerpt?: string
  ): string {
    const fingerprintBlock = excerpt
      ? `\n\n【物理执行指纹摘要 (Head-Tail Fingerprint)】:\n${excerpt}`
      : "";

    return `[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ 探测握手执行完成 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)，完整输出已作为文件附件【${fileName}】挂载送达。
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件分析推进。${fingerprintBlock}

【环境握手完成：本地工具与工作区已就绪】
${skillsSection ? `【当前已激活的专业技能 (Skill)】\n${skillsSection}\n\n` : ""}
【用户正式需求】
${task}

【执行规则与推进要求】
1. 深入分析工作区现状，按需使用 read_file、patch_file、write_file、run_command 开展工作；
2. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。

${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Builds continuation prompt when user responds to ask_question.
   */
  public static buildUserResponsePrompt(userResponse: string): string {
    return `[USER_RESPONSE for ask_question]:
用户已回复确认：
${userResponse}

请根据用户输入继续推进执行下一步任务：
${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Builds re-grounding prompt for session rotation or account fallback.
   */
  public static buildReGroundingPrompt(options: ReGroundingOptions): string {
    const wsNorm = options.workspaceRoot.replace(/\\/g, "/");
    const gitFacts = options.gitFacts || "Git status: clean";
    const history = options.historySummary || "前序历史操作已成功同步。";

    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。本地物理环境已连接。

【本地宿主机与工作区事实 (Session Re-grounding)】
- 工作区绝对路径: ${wsNorm}
- 最新 Git 仓库状态:
${gitFacts}

【前序轮次执行摘要 (Context Transfer)】
${history}

${options.skillsSection ? `【当前已激活的技能】\n${options.skillsSection}\n\n` : ""}
${options.currentTask ? `【当前推进中的任务】\n${options.currentTask}\n\n` : ""}
${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Constructs pre-handoff summons prompt on turn maxTurns - 1,
   * instructing the model to output the handoff document directly via ```handoff fenced block.
   */
  public static buildHandoffPreparationPrompt(task: string, sessionId?: string): string {
    return `[SYSTEM NOTICE: 当前会话即将在下一轮达到推理上限]:
当前长耗时任务即将进入跨会话接力期。

【原生交接文档格式指南】
当前阶段的核心目标是完成接力移交，确保后续智能体能够无缝接续。
请在当前轮次直接输出 \`\`\`handoff ... \`\`\` 代码块提供你的【深度技术总结与接力备忘录 (HANDOFF_MEMO:)】：
\`\`\`handoff
# 跨会话自主任务交接文档
1. 【任务目标与交付边界】原始任务核心目标与约束
2. 【阶段性技术审计发现与架构核心见解】对已读源码与模块架构的深度研判及重构建议
3. 【已验证客观事实与物理基线】已读取的项目模块与已执行验证的基准命令
4. 【反模式与关键卡点】代码坏味道与阻碍推进的报错/依赖问题
5. 【已修改/生成文件清单】变更文件路径及当前状态
6. 【接力第一优先级待办事项】明确指示下任接力者的具体切入点，直接推进后续工作
\`\`\`

系统将自动提取该代码块并持久化归档，接力智能体将直接据此继续攻坚！
原始任务需求：${task}`;
  }
}

