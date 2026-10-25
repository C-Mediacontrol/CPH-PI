import { PnPWorkspaceSyncEngine } from "../workspace/pnp-sync-engine.ts";

export interface Turn1PromptOptions {
  workspaceRoot: string;
  gitFacts?: string;
  dirTree?: string;
  task?: string;
  environmentFilePath?: string;
  skillsSection?: string;
  catalogAttached?: boolean;
  boundedRepoMap?: boolean;
}

export interface ReGroundingOptions {
  workspaceRoot: string;
  gitFacts?: string;
  historySummary?: string;
  currentTask?: string;
  environmentFilePath?: string;
  skillsSection?: string;
  catalogAttached?: boolean;
  boundedRepoMap?: boolean;
}

export interface Turn2TaskPromptOptions {
  task: string;
  toolResult: string;
  skillsSection?: string;
  toolName?: string;
  concurrencyWorkers?: number;
  workspaceRoot?: string;
  catalogAttached?: boolean;
  boundedRepoMap?: boolean;
}

export interface GroundingBlockOptions {
  workspaceRoot: string;
  task?: string;
  catalogAttached?: boolean;
  boundedRepoMap?: boolean;
}

export class PromptBuilder {
  /**
   * Shared workspace grounding block: filesystem + cloud index, used by every
   * turn that introduces a task (Turn 1, handshake, and Turn 2 after handshake).
   */
  public static buildWorkspaceGroundingBlock(options: GroundingBlockOptions): string {
    const wsNorm = options.workspaceRoot.replace(/\\/g, "/");
    const catalogLine = options.catalogAttached
      ? "完整清单见随本轮消息挂载的云端附件 remote-workspace-catalog.md（会话附件，直接基于其内容推理，无需 read_file）；下方为任务范围内精简索引"
      : "见下方精简索引（未列出的文件按需 read_file 读取）";
    const repoMap =
      options.boundedRepoMap === false
        ? PnPWorkspaceSyncEngine.readVirtualRepoMap(options.workspaceRoot) || ""
        : PnPWorkspaceSyncEngine.buildBoundedRepoMap({
            workspaceRoot: options.workspaceRoot,
            task: options.task,
          });

    return [
      "【本地宿主机与工作区事实 (Grounding Facts)】",
      `- 工作区绝对路径: ${wsNorm}`,
      `- 工作区目录与云端文件索引: ${catalogLine}`,
      repoMap ? `\n${repoMap.trim()}\n` : "",
    ]
      .join("\n")
      .trimEnd();
  }

  public static readonly PROTOCOL_REMINDER = `【交接协议规范 (Turn Protocol Contract)】
1. 若需继续执行，必须且仅输出一个 \`\`\`action 块：
   - 读取文件: tool: read_file \\n path: <path>
   - 局部修改: tool: edit \\n path: <path> \\n old_string: <old> \\n new_string: <new>
   - 写入文件: tool: write_file \\n path: <path> \\n content: <content>
   - 写入下载文件: tool: write_file \\n path: <path> \\n url: <下载链接>
   - 运行命令: tool: run_command \\n command: <cmd>
   - 提问用户: tool: ask_question \\n question: <question>
   - 调派子代理: tool: invoke_subagent \\n subagents: [{"role": "researcher"|"coder", "prompt": "<具体独立切片任务>"}]
2. 当所有目标已达成且验证充分时，直接在独立一行输出最终交付总结：
   FINAL_ANSWER: <任务交付总结说明>`;

  /**
   * Constructs the grounded Turn 1 prompt embedding physical workspace facts,
   * Git repository state, directory tree preview, and available Pi native tools.
   */
  public static buildTurn1Prompt(options: Turn1PromptOptions): string {
    const gitStatus = options.gitFacts || "Git: 未初始化或无未提交变更 (clean)";
    const treePreview = options.dirTree ? `\n【核心目录结构预览】\n${options.dirTree}\n` : "";
    const grounding = PromptBuilder.buildWorkspaceGroundingBlock({
      workspaceRoot: options.workspaceRoot,
      task: options.task,
      catalogAttached: options.catalogAttached,
      boundedRepoMap: options.boundedRepoMap,
    });

    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。你直接运行在用户本地宿主机的 CPH-PI 运行环境中，具备真实物理磁盘读写与终端命令执行工具（Tool Calling）。

${grounding}
- 本地 Git 仓库状态:
${gitStatus}
${treePreview}
【可用工具格式 (Tool Calling)】
当你需要读取文件、修改代码、创建文件、运行测试命令、调派子代理或向用户提问时，请输出 \`\`\`action 块：
1. 读取文件内容：
\`\`\`action
tool: read_file
path: <文件路径>
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
6. 调派子代理并发执行独立切片审查或研发任务：
\`\`\`action
tool: invoke_subagent
subagents: [{"role": "researcher"|"coder", "prompt": "<具体独立切片任务>"}]
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
    activeSkillsSection = "",
    dirSkeleton = "",
    concurrencyWorkers?: number,
    virtualRepoMap?: string,
    catalogAttached = false,
    boundedRepoMap = true
  ): string {
    const explicitRepoMap =
      virtualRepoMap && virtualRepoMap.trim() !== "" ? virtualRepoMap.trim() : undefined;
    const grounding = PromptBuilder.buildWorkspaceGroundingBlock({
      workspaceRoot,
      task,
      catalogAttached,
      boundedRepoMap,
    });

    let prompt = grounding;
    if (explicitRepoMap) {
      prompt += `\n\n${explicitRepoMap}`;
    }

    if (concurrencyWorkers !== undefined && concurrencyWorkers > 0) {
      prompt += `\n- 并发集群容量: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`;
    }

    if (dirSkeleton && dirSkeleton.trim() !== "") {
      prompt += `\n\n【工作区受控目录骨架 (2-Level Skeleton)】\n${dirSkeleton.trim()}`;
    }

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
    dirTree?: string,
    task?: string,
    catalogAttached?: boolean,
    boundedRepoMap?: boolean
  ): string {
    const treePreview = dirTree ? `\n【当前工作区精简目录树】\n${dirTree}\n` : "";
    const grounding = PromptBuilder.buildWorkspaceGroundingBlock({
      workspaceRoot,
      task,
      catalogAttached,
      boundedRepoMap,
    });

    return `你是一个运行在本地宿主机的 CPH-PI 自主编程智能体。你的工具链路已直接接入物理操作系统。

${grounding}
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
   * Supports strongly-typed options object { task, toolResult, skillsSection?, toolName? }
   * and positional arguments (task, toolResult, skillsSection?, toolName?).
   */
  public static buildTurn2TaskPrompt(
    optionsOrTask: Turn2TaskPromptOptions | string,
    toolResult?: string,
    skillsSection = "",
    toolName?: string,
    concurrencyWorkers?: number
  ): string {
    let finalTask = "";
    let finalToolResult = "";
    let finalSkillsSection = "";
    let finalToolName: string | undefined;
    let finalConcurrencyWorkers: number | undefined;
    let finalWorkspaceRoot: string | undefined;
    let finalCatalogAttached: boolean | undefined;
    let finalBoundedRepoMap: boolean | undefined;

    if (typeof optionsOrTask === "object" && optionsOrTask !== null) {
      finalTask = optionsOrTask.task;
      finalToolResult = optionsOrTask.toolResult;
      finalSkillsSection = optionsOrTask.skillsSection || "";
      finalToolName = optionsOrTask.toolName;
      finalConcurrencyWorkers = optionsOrTask.concurrencyWorkers;
      finalWorkspaceRoot = optionsOrTask.workspaceRoot;
      finalCatalogAttached = optionsOrTask.catalogAttached;
      finalBoundedRepoMap = optionsOrTask.boundedRepoMap;
    } else {
      finalTask = optionsOrTask;
      finalToolResult = toolResult ?? "";
      finalSkillsSection = skillsSection ?? "";
      finalToolName = toolName;
      finalConcurrencyWorkers = concurrencyWorkers;
    }

    const toolHeader = finalToolName
      ? `[TOOL_RESULT for ${finalToolName} - SUCCESS]:`
      : `[TOOL_RESULT - SUCCESS]:`;

    const clusterFact =
      finalConcurrencyWorkers !== undefined && finalConcurrencyWorkers > 0
        ? `\n- 并发集群容量: ${finalConcurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`
        : "";

    const groundingBlock = finalWorkspaceRoot
      ? `${PromptBuilder.buildWorkspaceGroundingBlock({
          workspaceRoot: finalWorkspaceRoot,
          task: finalTask,
          catalogAttached: finalCatalogAttached,
          boundedRepoMap: finalBoundedRepoMap,
        })}\n\n`
      : "";

    return `${groundingBlock}${toolHeader}
${finalToolResult}

【环境握手完成：本地工具与工作区已就绪】${clusterFact}
${finalSkillsSection ? `【当前已激活的专业技能 (Skill)】\n${finalSkillsSection}\n\n` : ""}
【用户正式需求】
${finalTask}

【执行规则与推进要求】
1. 深入分析工作区现状，按需使用 read_file、edit、write_file、run_command 开展工作；
2. 若需运行测试，输出 tool: run_command 调用对应测试命令；
3. 任务全部落盘完成并验证后，方可输出 FINAL_ANSWER。

${this.PROTOCOL_REMINDER}`;
  }

  /**
   * Builds continuation prompt containing tool execution output and protocol reinforcement.
   * Optionally embeds taskInvariant to maintain grounding anchor across extended turns and avoid cognitive drift.
   */
  public static buildToolResultPrompt(
    toolName: string,
    success: boolean,
    output: string,
    error?: string,
    taskInvariant?: string
  ): string {
    const invariantBlock =
      taskInvariant && taskInvariant.trim() !== ""
        ? `\n【当前推进战役北极星 (Task Invariant)】:\n${taskInvariant.trim()}\n`
        : "";

    if (success) {
      return `[TOOL_RESULT for ${toolName} - SUCCESS]:
${output}
source: local | status: success | freshness: unknown
${invariantBlock}
${this.PROTOCOL_REMINDER}`;
    } else {
      return `[TOOL_RESULT for ${toolName} - FAILED]:
Error: ${error || "Execution failed"}
Output: ${output}
source: local | status: failed | freshness: unknown
${invariantBlock}
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
   * Optionally embeds taskInvariant to anchor model focus across turns.
   */
  public static buildAttachedToolResultPrompt(
    toolName: string,
    fileName: string,
    summary: { lineCount: number; charCount: number },
    excerpt?: string,
    taskInvariant?: string
  ): string {
    const fingerprintBlock = excerpt
      ? `\n\n【物理执行指纹摘要 (Head-Tail Fingerprint)】:\n${excerpt}`
      : "";

    const invariantBlock =
      taskInvariant && taskInvariant.trim() !== ""
        ? `\n\n【当前推进战役北极星 (Task Invariant)】:\n${taskInvariant.trim()}`
        : "";

    return `[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ ${toolName} 执行成功 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)。
完整执行结果已作为文件附件【${fileName}】挂载送达。
source: cloud-attachment | status: attached | freshness: unknown
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件已解析的全部数据推进后续技术推演与操作。${fingerprintBlock}${invariantBlock}

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
    excerpt?: string,
    concurrencyWorkers?: number,
    grounding?: GroundingBlockOptions
  ): string {
    const groundingBlock = grounding
      ? `${PromptBuilder.buildWorkspaceGroundingBlock(grounding)}\n\n`
      : "";
    const fingerprintBlock = excerpt
      ? `\n\n【物理执行指纹摘要 (Head-Tail Fingerprint)】:\n${excerpt}`
      : "";

    const clusterFact =
      concurrencyWorkers !== undefined && concurrencyWorkers > 0
        ? `\n- 并发集群容量: ${concurrencyWorkers} 个并行 Worker (推荐单批派发与此容量匹配的正交子任务以实现最高吞吐)`
        : "";

    return `${groundingBlock}[TOOL_RESULT for ${toolName} - SUCCESS (ATTACHED)]:
✔ 探测握手执行完成 (共 ${summary.lineCount} 行 / ${summary.charCount} 字符)，完整输出已作为文件附件【${fileName}】挂载送达。
【无损附件感知指引】：云端文档引擎已对该附件进行全量原生解析，请直接基于该附件分析推进。${fingerprintBlock}

【环境握手完成：本地工具与工作区已就绪】${clusterFact}
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
  public static buildUserResponsePrompt(userResponse: string, taskInvariant?: string): string {
    const invariantBlock =
      taskInvariant && taskInvariant.trim() !== ""
        ? `\n【当前推进战役北极星 (Task Invariant)】:\n${taskInvariant.trim()}\n`
        : "";

    return `[USER_RESPONSE for ask_question]:
用户已回复确认：
${userResponse}
${invariantBlock}
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
    const repoMap =
      options.boundedRepoMap === false
        ? PnPWorkspaceSyncEngine.readVirtualRepoMap(options.workspaceRoot) || ""
        : PnPWorkspaceSyncEngine.buildBoundedRepoMap({
            workspaceRoot: options.workspaceRoot,
            task: options.currentTask,
          });
    const repoMapSection = repoMap ? `\n\n${repoMap.trim()}` : "";
    const catalogLine = options.catalogAttached
      ? "完整清单见随本轮消息挂载的附件 remote-workspace-catalog.md（含 2 层目录树与逐文件直链）；下方为任务范围内精简索引"
      : "见下方精简索引（未列出的文件按需 read_file 读取）";

    return `你是一个专业的自主式编程与架构智能体（Coding Agent）。本地物理环境已连接。

【本地宿主机与工作区事实 (Session Re-grounding)】
- 工作区绝对路径: ${wsNorm}
- 工作区目录与云端文件索引: ${catalogLine}
- 最新 Git 仓库状态:
${gitFacts}${repoMapSection}

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

