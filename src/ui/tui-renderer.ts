import * as fs from "node:fs";
import * as path from "node:path";
import { Chalk } from "chalk";
import { DiffHighlighter } from "./diff-highlighter.ts";
import type { CopilotAction, ToolBridgeResult } from "../protocol/tool-bridge.ts";

export interface TuiRendererOptions {
  writer?: (text: string) => void;
  colorLevel?: 0 | 1 | 2 | 3;
}

export interface SessionStatusInfo {
  sessionId: string;
  turnCount: number;
  maxTurns: number;
  estimatedTokens?: number;
  compactionRatio?: number;
  currentAccount?: string;
  agentName?: string;
  generation?: number;
  handoffCount?: number;
}

export interface SubagentLiveState {
  id: string;
  role: "researcher" | "coder" | string;
  account?: string;
  description?: string;
  status: "running" | "completed" | "failed" | string;
  currentTurn?: number;
  durationMs?: number;
  lastAction?: string;
  hopCount?: number;
  handoffCount?: number;
}

export type ActiveSubagentState = SubagentLiveState;

/**
 * TUI Renderer bridging Pi ANSI styles, stream tokens, diff visualization, and tool badges.
 */
export class TuiRenderer {
  private writer: (text: string) => void;
  private c: Chalk;
  private diffHighlighter: DiffHighlighter;

  constructor(options: TuiRendererOptions = {}) {
    this.writer = options.writer || ((text: string) => process.stdout.write(text));
    this.c = new Chalk({ level: options.colorLevel ?? 3 });
    this.diffHighlighter = new DiffHighlighter({ chalk: this.c });
  }

  public setWriter(writer: (text: string) => void): void {
    this.writer = writer;
  }

  public getChalk(): InstanceType<typeof chalk.Chalk> {
    return this.c;
  }

  // =========================================================================
  // 1. Streaming Chunk Rendering
  // =========================================================================

  /**
   * Format reasoning / thinking chunk (light purple / magenta).
   */
  public formatReasoning(chunk: string): string {
    return this.c.magenta(chunk);
  }

  /**
   * Render reasoning / thinking chunk stream in light purple / magenta.
   */
  public renderReasoningChunk(chunk: string): void {
    this.writer(this.formatReasoning(chunk));
  }

  /**
   * Format standard text chunk.
   */
  public formatText(chunk: string): string {
    return chunk;
  }

  /**
   * Render standard text stream chunk.
   */
  public renderTextChunk(chunk: string): void {
    this.writer(this.formatText(chunk));
  }

  // =========================================================================
  // 2. Tool Invocation Badge
  // =========================================================================

  /**
   * Formats a tool execution badge:
   * e.g. "⚡ 正在执行 read_file: src/cli.ts (lines 1-50)"
   */
  public formatToolBadge(action: CopilotAction): string {
    const rawTool = action.tool || action.action || action.name || "unknown";
    let targetInfo = "";

    if (rawTool === "read_file" || rawTool === "read" || rawTool === "cat") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      if (action.start_line !== undefined || action.end_line !== undefined) {
        const start = action.start_line ?? 1;
        const end = action.end_line ?? start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else if (action.startLine !== undefined || action.endLine !== undefined) {
        const start = action.startLine ?? 1;
        const end = action.endLine ?? start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else if (action.offset !== undefined || action.limit !== undefined) {
        const start = action.offset ?? 1;
        const end = action.limit !== undefined ? start + action.limit - 1 : start + 99;
        targetInfo = `${filePath} (lines ${start}-${end})`;
      } else {
        targetInfo = `${filePath} (lines 1-100)`;
      }
    } else if (rawTool === "edit" || rawTool === "patch_file" || rawTool === "edit_file") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      const editsCount = Array.isArray(action.edits) ? action.edits.length : 1;
      targetInfo = `${filePath} (${editsCount} block${editsCount > 1 ? "s" : ""})`;
    } else if (rawTool === "write_file" || rawTool === "write") {
      const filePath = action.path || action.filePath || action.file || "unknown";
      targetInfo = filePath;
    } else if (rawTool === "run_command" || rawTool === "bash" || rawTool === "exec") {
      const cmd = action.command || action.cmd || "";
      targetInfo = cmd.length > 70 ? `${cmd.slice(0, 67)}...` : cmd;
    } else if (rawTool === "ask_question" || rawTool === "question") {
      const q = action.question || action.prompt || "";
      targetInfo = q.length > 70 ? `${q.slice(0, 67)}...` : q;
    } else {
      const fallback = action.path || action.command || action.question || "";
      targetInfo = fallback ? String(fallback) : JSON.stringify(action);
    }

    const lightning = this.c.yellow("⚡");
    const label = this.c.bold.cyan("正在执行");
    const toolFormatted = this.c.bold.white(rawTool);
    const targetFormatted = this.c.green(targetInfo);

    return `${lightning} ${label} ${toolFormatted}${this.c.gray(":")} ${targetFormatted}`;
  }

  /**
   * Renders the tool badge to terminal output.
   */
  public renderToolBadge(action: CopilotAction): void {
    this.writer(`\n${this.formatToolBadge(action)}\n`);
  }

  // =========================================================================
  // 3. Pi Official Intra-Line Diff Renderer (Delegated to DiffHighlighter)
  // =========================================================================

  /**
   * Renders a diff string with colored lines and intra-line change highlighting.
   */
  public renderDiff(diffText: string): string {
    return this.diffHighlighter.renderDiff(diffText);
  }

  // =========================================================================
  // 4. Tool Result Highlighting & Output Display
  // =========================================================================

  /**
   * Formats tool execution result, highlighting status and rendering Diff previews for edit actions.
   */
  public formatToolResult(result: ToolBridgeResult): string {
    const isSuccess = result.success;
    const toolName = result.actionName || result.piToolName;
    const icon = isSuccess ? this.c.green("✔") : this.c.red("✖");
    const statusLabel = isSuccess ? this.c.green("执行成功") : this.c.red("执行失败");
    const target = this.c.gray(`[${result.target}]`);

    const header = `${icon} ${this.c.bold(toolName)} ${target} ${statusLabel}`;

    // Check for edit diff
    let diffContent = "";
    if (result.rawResult?.details?.diff) {
      diffContent = result.rawResult.details.diff;
    } else if (result.output && result.output.includes("Diff:\n")) {
      const idx = result.output.indexOf("Diff:\n");
      diffContent = result.output.slice(idx + "Diff:\n".length).trim();
    } else if (
      (toolName === "edit" || toolName === "patch_file") &&
      (result.output.includes("@@") || result.output.startsWith("+") || result.output.startsWith("-"))
    ) {
      diffContent = result.output;
    }

    if (diffContent) {
      const renderedDiff = this.renderDiff(diffContent);
      const diffBox = [
        this.c.gray("  ┌─ [Diff 局部预览] ──────────────────────────────────────────"),
        renderedDiff
          .split("\n")
          .map((l) => `  │ ${l}`)
          .join("\n"),
        this.c.gray("  └────────────────────────────────────────────────────────────"),
      ].join("\n");

      return `${header}\n${diffBox}`;
    }

    // Standard output preview (short or trimmed)
    if (result.output) {
      const lines = result.output.trim().split("\n");
      const previewLines = lines.slice(0, 15);
      const isTruncated = lines.length > 15;

      const formattedLines = previewLines.map((l) => this.c.gray(`  │ ${l}`)).join("\n");
      const footer = isTruncated
        ? this.c.gray(`\n  │ ... (已省略 ${lines.length - 15} 行输出)`)
        : "";

      return `${header}\n${formattedLines}${footer}`;
    }

    return header;
  }

  /**
   * Renders tool execution result to terminal output.
   */
  public renderToolResult(result: ToolBridgeResult): void {
    this.writer(`${this.formatToolResult(result)}\n`);
  }

  // =========================================================================
  // 5. FINAL_ANSWER Highlight Box
  // =========================================================================

  /**
   * Formats FINAL_ANSWER into an emphasized highlight box.
   */
  public formatFinalAnswer(summary: string): string {
    const rawLines = summary.trim().split("\n");
    const contentLines = rawLines.map((l) => l.trimEnd());

    // Determine visual width (min 66 chars, max 90)
    let maxLen = 0;
    for (const line of contentLines) {
      if (line.length > maxLen) maxLen = line.length;
    }
    const boxWidth = Math.min(90, Math.max(66, maxLen + 6));

    const topBorder = this.c.bold.green(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " 🎯 【任务已完成交付 / FINAL ANSWER】";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.green("│")}${this.c.bold.white(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.green("│")}`;
    const midDivider = this.c.bold.green(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.green(`└${"─".repeat(boxWidth - 2)}┘`);

    const formattedContent = contentLines.map((line) => {
      const lineLen = line.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.green("│")}  ${line}${" ".repeat(pad)}${this.c.bold.green("│")}`;
    });

    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder,
    ].join("\n");
  }

  /**
   * Scans text to extract referenced Markdown file paths (.md / .markdown).
   * Supports Markdown links, quoted/backticked strings, absolute and relative paths.
   */
  public extractReferencedMarkdownFiles(text: string): string[] {
    if (!text) return [];

    const rawMatches: string[] = [];

    // 1. Markdown link targets: [text](path/to/file.md) or [text](file:///path/to/file.md)
    const mdLinkRegex = /\[[^\]]*\]\(([^)\s]+?\.(?:md|markdown))\)/gi;
    let match: RegExpExecArray | null;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      rawMatches.push(match[1]);
    }

    // 2. Quoted strings (backticks, double quotes, single quotes): `path/to/file.md`, "path/to/file.md"
    const quotedRegex = /[`"']([^`"'\r\n]+?\.(?:md|markdown))[`"']/gi;
    while ((match = quotedRegex.exec(text)) !== null) {
      rawMatches.push(match[1]);
    }

    // 3. Windows absolute paths: e.g. C:\path\to\file.md or C:/path/to/file.md
    const winAbsRegex = /[A-Za-z]:[\\/][^\r\n`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = winAbsRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }

    // 4. Posix absolute paths: /path/to/file.md
    const posixAbsRegex = /\/(?:[^\s`"'()<>*?，。；：！？\t]+?\/)?[^\s`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = posixAbsRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }

    // 5. Relative paths with directories: reports/summary.md or .docs/review.md
    const relPathRegex = /(?:\.{1,2}[\\/]|[a-zA-Z0-9_\-.]+[\\/])[^\s`"'()<>*?，。；：！？\t]+?\.(?:md|markdown)\b/gi;
    while ((match = relPathRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }

    // 6. Bare markdown filenames: bare-note.md
    const bareFileRegex = /(?<![\\/\w@.-])[a-zA-Z0-9_\-.]+\.(?:md|markdown)\b/gi;
    while ((match = bareFileRegex.exec(text)) !== null) {
      rawMatches.push(match[0]);
    }

    // Clean, normalize and deduplicate
    const cleaned: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawMatches) {
      let p = raw.trim();
      if (p.startsWith("file:///")) {
        p = decodeURIComponent(p.slice(8));
      } else if (p.startsWith("file://")) {
        p = decodeURIComponent(p.slice(7));
      }
      // Remove enclosing quotes, backticks, brackets
      p = p.replace(/^[`"'\(\[<（【]+|[`"'\)\]>）】]+$/g, "");
      // Remove trailing punctuation
      p = p.replace(/[.,;:!?，。；：！？]+$/, "");
      p = p.trim();

      if (!p) continue;

      const key = path.normalize(p).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cleaned.push(p);
      }
    }

    return cleaned;
  }

  /**
   * Formats a deliverable artifact card with physical metrics, file size, line count, and heading outline.
   * Returns null if the file does not exist or is not a regular file.
   */
  public formatArtifactCard(filePath: string): string | null {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    let stats: fs.Stats;
    let content: string;
    try {
      stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        return null;
      }
      content = fs.readFileSync(resolvedPath, "utf-8");
    } catch {
      return null;
    }

    const sizeBytes = stats.size;
    let sizeStr: string;
    if (sizeBytes < 1024) {
      sizeStr = `${sizeBytes} B`;
    } else if (sizeBytes < 1024 * 1024) {
      sizeStr = `${(sizeBytes / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    const rawLines = content.split(/\r?\n/);
    const totalLines = rawLines.length;

    // Extract top 3~5 markdown headings
    const headings: string[] = [];
    let totalHeadings = 0;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (/^(#{1,6})\s+/.test(trimmed)) {
        totalHeadings++;
        if (headings.length < 5) {
          headings.push(trimmed);
        }
      }
    }

    const displayPath = resolvedPath;
    const contentLines: string[] = [];
    contentLines.push(`📄 交付文档: ${displayPath}`);
    contentLines.push(`📊 规格指标: ${sizeStr} | ${totalLines} 行`);

    if (headings.length > 0) {
      contentLines.push(`📑 章节大纲:`);
      for (const h of headings) {
        contentLines.push(`  • ${h}`);
      }
      if (totalHeadings > 5) {
        contentLines.push(`  • ... (共 ${totalHeadings} 个核心章节)`);
      }
    }

    let maxLen = 0;
    for (const l of contentLines) {
      if (l.length > maxLen) maxLen = l.length;
    }
    const boxWidth = Math.min(96, Math.max(72, maxLen + 6));

    const topBorder = this.c.bold.cyan(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " 🏆 战役成果交付展板 (Deliverable Artifact)";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.cyan("│")}${this.c.bold.yellow(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.cyan("│")}`;
    const midDivider = this.c.bold.cyan(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.cyan(`└${"─".repeat(boxWidth - 2)}┘`);

    const formattedContent = contentLines.map((l) => {
      const lineLen = l.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.cyan("│")}  ${this.c.white(l)}${" ".repeat(pad)}${this.c.bold.cyan("│")}`;
    });

    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder,
    ].join("\n");
  }

  /**
   * Alias for formatArtifactCard.
   */
  public formatDeliverableArtifactCard(filePath: string): string | null {
    return this.formatArtifactCard(filePath);
  }

  /**
   * Renders FINAL_ANSWER highlight box to terminal output.
   * If any referenced deliverable markdown files are found on disk,
   * automatically renders a deliverable artifact card.
   */
  public renderFinalAnswer(summary: string): void {
    this.writer(`\n${this.formatFinalAnswer(summary)}\n\n`);

    const referencedFiles = this.extractReferencedMarkdownFiles(summary);
    for (const file of referencedFiles) {
      const card = this.formatArtifactCard(file);
      if (card) {
        this.writer(`${card}\n\n`);
      }
    }
  }

  /**
   * Formats interactive question prompt card (yellow box / question badge).
   */
  public formatQuestionPrompt(question: string, options?: string[]): string {
    const rawQuestionLines = question.trim().split(/\r?\n/);
    const contentLines: string[] = [];

    for (const line of rawQuestionLines) {
      contentLines.push(line.trimEnd());
    }

    if (options && options.length > 0) {
      contentLines.push("");
      contentLines.push("可选项:");
      options.forEach((opt, idx) => {
        contentLines.push(`  [${idx + 1}] ${opt}`);
      });
    }

    let maxLen = 0;
    for (const line of contentLines) {
      if (line.length > maxLen) maxLen = line.length;
    }
    const boxWidth = Math.min(90, Math.max(66, maxLen + 6));

    const topBorder = this.c.bold.yellow(`┌${"─".repeat(boxWidth - 2)}┐`);
    const headerTitle = " ❓ 【Copilot 交互提问 / ASK_QUESTION】";
    const headerPadding = Math.max(0, boxWidth - 2 - headerTitle.length);
    const headerLine = `${this.c.bold.yellow("│")}${this.c.bold.yellow(headerTitle)}${" ".repeat(headerPadding)}${this.c.bold.yellow("│")}`;
    const midDivider = this.c.bold.yellow(`├${"─".repeat(boxWidth - 2)}┤`);
    const bottomBorder = this.c.bold.yellow(`└${"─".repeat(boxWidth - 2)}┘`);

    const formattedContent = contentLines.map((line) => {
      const lineLen = line.length;
      const pad = Math.max(0, boxWidth - 4 - lineLen);
      return `${this.c.bold.yellow("│")}  ${this.c.white(line)}${" ".repeat(pad)}${this.c.bold.yellow("│")}`;
    });

    return [
      topBorder,
      headerLine,
      midDivider,
      ...formattedContent,
      bottomBorder,
    ].join("\n");
  }

  /**
   * Renders interactive question prompt card to terminal output.
   */
  public renderQuestionPrompt(question: string, options?: string[]): void {
    this.writer(`\n${this.formatQuestionPrompt(question, options)}\n\n`);
  }

  // =========================================================================
  // 6. Terminal Banner & Status Notifications
  // =========================================================================

  /**
   * Renders vibrant startup banner highlighting Pi architecture, Copilot protocol, and workspace.
   */
  public renderBanner(workspaceRoot?: string): void {
    const banner = [
      this.c.bold.cyan("╔══════════════════════════════════════════════════════════════════╗"),
      this.c.bold.cyan("║") +
        this.c.bold.white("       CPH-PI: Copilot M365 x Pi Autonomous Coding Terminal       ") +
        this.c.bold.cyan("║"),
      this.c.bold.cyan("║") +
        this.c.gray("   Architecture: Pi Engine (@earendil-works/pi-tui)               ") +
        this.c.bold.cyan("║"),
      this.c.bold.cyan("║") +
        this.c.gray("   Protocol: Native Microsoft Sydney / ChatHub WebSocket          ") +
        this.c.bold.cyan("║"),
      this.c.bold.cyan("╚══════════════════════════════════════════════════════════════════╝"),
      ...(workspaceRoot ? [this.c.cyan(`  工作区根目录: ${workspaceRoot}`)] : []),
      this.c.dim("  快捷命令: /help (帮助) | /reset (重置会话) | /status (状态) | /skills (技能) | /exit (退出)"),
      this.c.dim("  中断控制: 运行中按 Ctrl+C 中断当前步骤并保留会话 | 空闲时 1.5s 内连按两次退出"),
      "",
    ].join("\n");

    this.writer(`${banner}\n`);
  }

  /**
   * Formats autonomous handoff continuation banner.
   */
  public formatAutonomousHandoffBanner(
    newSessionId: string,
    hopCount: number,
    maxHops: number,
    docPath?: string
  ): string {
    const banner = [
      this.c.bold.yellow("🔄 ══════════════════════════════════════════════════════════════════ 🔄"),
      this.c.bold.yellow(`   [Auto-Handoff] 自主换会话接力跃迁 (阶段 ${hopCount}/${maxHops})`),
      this.c.gray(`   新会话 ID: `) + this.c.cyan(newSessionId),
      ...(docPath ? [this.c.gray(`   交接文档: `) + this.c.green(docPath)] : []),
      this.c.dim(`   提示: 已无感加载高保真 5 维交接文档，正在自动启动接力推理...`),
      this.c.bold.yellow("🔄 ══════════════════════════════════════════════════════════════════ 🔄"),
    ].join("\n");
    return banner;
  }

  /**
   * Renders autonomous handoff continuation banner to terminal output.
   */
  public renderAutonomousHandoffBanner(
    newSessionId: string,
    hopCount: number,
    maxHops: number,
    docPath?: string
  ): void {
    this.writer(`\n${this.formatAutonomousHandoffBanner(newSessionId, hopCount, maxHops, docPath)}\n\n`);
  }

  /**
   * Formats Stage 1 Disaster Blackbox banner (⚡ 红色/黄色边框高亮).
   */
  public formatDisasterBlackboxBanner(sessionId: string, lastError?: string): string {
    const banner = [
      this.c.bold.red("⚡ ══════════════════════════════════════════════════════════════════ ⚡"),
      this.c.bold.yellow("   [Disaster-Recovery: 阶一] 遭遇 429 频控/突发中断，提炼事故现场黑匣子"),
      this.c.gray("   受害会话 ID: ") + this.c.cyan(sessionId),
      ...(lastError ? [this.c.gray("   拦截异常原因: ") + this.c.red(lastError)] : []),
      this.c.dim("   操作: 正在将全量历史上下文浓缩为 5k~8k 字符高密度黑匣子快照..."),
      this.c.bold.red("⚡ ══════════════════════════════════════════════════════════════════ ⚡"),
    ].join("\n");
    return banner;
  }

  /**
   * Renders Stage 1 Disaster Blackbox banner to terminal output.
   */
  public renderDisasterBlackboxBanner(sessionId: string, lastError?: string): void {
    this.writer(`\n${this.formatDisasterBlackboxBanner(sessionId, lastError)}\n\n`);
  }

  /**
   * Formats Stage 2 Arbitrator Handoff banner (📑 蓝色/青色边框高亮).
   */
  public formatArbitratorHandoffBanner(
    arbitratorSessionId: string,
    accountEmail: string,
    docPath?: string
  ): string {
    const banner = [
      this.c.bold.cyan("📑 ══════════════════════════════════════════════════════════════════ 📑"),
      this.c.bold.cyan("   [Disaster-Recovery: 阶二] 账号池敏捷轮换，唤起原生 handoff 仲裁微会话"),
      this.c.gray("   仲裁会话 ID: ") + this.c.cyan(arbitratorSessionId),
      this.c.gray("   仲裁备用账号: ") + this.c.green(accountEmail),
      ...(docPath ? [this.c.gray("   交接文档落盘: ") + this.c.green(docPath)] : []),
      this.c.dim("   操作: 正在通过云端 handoff 技能生成标准 5 维交接文档并落盘归档..."),
      this.c.bold.cyan("📑 ══════════════════════════════════════════════════════════════════ 📑"),
    ].join("\n");
    return banner;
  }

  /**
   * Renders Stage 2 Arbitrator Handoff banner to terminal output.
   */
  public renderArbitratorHandoffBanner(
    arbitratorSessionId: string,
    accountEmail: string,
    docPath?: string
  ): void {
    this.writer(`\n${this.formatArbitratorHandoffBanner(arbitratorSessionId, accountEmail, docPath)}\n\n`);
  }

  /**
   * Formats Stage 3 Disaster Successor banner (🚀 绿色边框高亮).
   */
  public formatDisasterSuccessorBanner(
    successorSessionId: string,
    hopCount: number,
    maxHops: number,
    docPath?: string
  ): string {
    const banner = [
      this.c.bold.green("🚀 ══════════════════════════════════════════════════════════════════ 🚀"),
      this.c.bold.green(`   [Disaster-Recovery: 阶三] 灾备接力闭环就绪，接力会话继续攻坚 (阶段 ${hopCount}/${maxHops})`),
      this.c.gray("   接力会话 ID: ") + this.c.cyan(successorSessionId),
      ...(docPath ? [this.c.gray("   承接交接文档: ") + this.c.green(docPath)] : []),
      this.c.dim("   操作: 挂载高保真交接文档，使用健康账号全速推进剩余业务需求..."),
      this.c.bold.green("🚀 ══════════════════════════════════════════════════════════════════ 🚀"),
    ].join("\n");
    return banner;
  }

  /**
   * Renders Stage 3 Disaster Successor banner to terminal output.
   */
  public renderDisasterSuccessorBanner(
    successorSessionId: string,
    hopCount: number,
    maxHops: number,
    docPath?: string
  ): void {
    this.writer(`\n${this.formatDisasterSuccessorBanner(successorSessionId, hopCount, maxHops, docPath)}\n\n`);
  }

  /**
   * Formats cloud document attachment notification badge.
   */
  public formatAttachmentUploadedNotice(fileName: string, toolName: string): string {
    return this.c.cyan(
      `☁️  [云端直传附件] 工具 ${this.c.bold(toolName)} 完整输出已上传至 OneDrive 并作为文件附件【${this.c.green(fileName)}】挂载送达 Copilot`
    );
  }

  /**
   * Renders cloud document attachment notification badge to terminal output.
   */
  public renderAttachmentUploadedNotice(fileName: string, toolName: string): void {
    this.writer(`${this.formatAttachmentUploadedNotice(fileName, toolName)}\n`);
  }

  /**
   * Renders notice when a specialized skill is activated.
   */
  public renderSkillActivated(name: string): void {
    this.writer(this.c.bold.magenta(`\n🎯 [已激活专属技能: ${name}]\n\n`));
  }

  /**
   * Renders turn header: [Turn 1]
   */
  public renderTurnHeader(turn: number): void {
    this.writer(this.c.bold.blue(`\n▶ [Turn ${turn}]\n`));
  }

  /**
   * Renders RefusalGuard interception notice.
   */
  public renderRefusalWarning(refusalText: string, retryAttempt: number): void {
    const msg = this.c.yellow(
      `\n🛡️  [RefusalGuard] 拦截到微软沙箱拒答模版，正在注入物理上下文纠偏 (第 ${retryAttempt} 次重试)...`
    );
    this.writer(`${msg}\n`);
  }

  /**
   * Renders sliding compaction notice.
   */
  public renderCompactedNotice(clearedChars: number, ratio: number): void {
    const percentage = (ratio * 100).toFixed(1);
    const msg = this.c.gray(
      `✂️  [Compaction] 两轮滑动微压实完成：剥离 ${clearedChars} 字符历史工具输出 (节省约 ${percentage}% 上下文空间)`
    );
    this.writer(`${msg}\n`);
  }

  /**
   * Renders account switched notice upon rate limiting.
   */
  public renderAccountSwitchedNotice(oldEmail: string, newEmail: string): void {
    const msg = this.c.magenta(
      `🔄 [AccountPool] 账号 ${oldEmail} 触发限流，已自动无感轮换至 ${newEmail}`
    );
    this.writer(`${msg}\n`);
  }

  /**
   * Renders operation cancelled / aborted notification.
   */
  public renderAbortedNotice(): void {
    const msg = this.c.yellow(
      `\n⚠️  已拦截 Ctrl+C：当前执行已安全中止。会话历史与上下文完整保留，已返回交互等待模式。\n`
    );
    this.writer(msg);
  }

  /**
   * Renders general error message.
   */
  public renderError(err: Error | string): void {
    const text = typeof err === "string" ? err : err.message;
    this.writer(this.c.bold.red(`\n❌ 出错: ${text}\n`));
  }

  // =========================================================================
  // 7. Session Status Bar Rendering
  // =========================================================================

  /**
   * Formats the session status bar with ANSI highlighting and graceful fallbacks.
   * Format: ┌─ [ 会话: <sessionId> | 轮次: <turnCount>/<maxTurns> | 上下文: ~<tokens> (压实率 <ratio>%) | 账号: <account> ]
   */
  public formatStatusBar(info: SessionStatusInfo): string {
    const sessionIdStr = this.c.cyan(info.sessionId || "未命名");
    const gen =
      info.generation ??
      (info.handoffCount !== undefined ? info.handoffCount + 1 : undefined);
    const handoffCount =
      info.handoffCount ?? (gen !== undefined ? Math.max(0, gen - 1) : undefined);
    let genBadge = "";
    if (gen !== undefined && handoffCount !== undefined) {
      genBadge =
        handoffCount > 0
          ? this.c.yellow(` [第 ${gen} 代 (接手 ${handoffCount} 次)]`)
          : this.c.gray(` [第 1 代 (接手 0 次)]`);
    }

    const agentBadge = this.c.green(info.agentName || "通用握手模式");
    const turnCount = info.turnCount ?? 0;
    const maxTurns = info.maxTurns ?? 25;
    const turnStr = this.c.yellow(`${turnCount}/${maxTurns}`);

    let contextContent = "";
    if (info.estimatedTokens !== undefined) {
      const tokensFormatted =
        info.estimatedTokens >= 1000
          ? `~${(info.estimatedTokens / 1000).toFixed(1)}k Token`
          : `~${info.estimatedTokens} Token`;

      if (info.compactionRatio !== undefined && info.compactionRatio > 0) {
        const ratioPercent = Math.round(
          info.compactionRatio > 1
            ? info.compactionRatio
            : info.compactionRatio * 100
        );
        contextContent = `${tokensFormatted} (压实率 ${ratioPercent}%)`;
      } else {
        contextContent = tokensFormatted;
      }
    } else {
      contextContent = "初始";
    }
    const contextStr = this.c.green(contextContent);

    const accountStr = this.c.magenta(info.currentAccount || "默认");

    const prefix = this.c.gray("┌─ [ ");
    const suffix = this.c.gray(" ]");
    const div = this.c.gray(" | ");

    return (
      prefix +
      this.c.dim("会话: ") +
      sessionIdStr +
      genBadge +
      div +
      this.c.dim("智能体: ") +
      agentBadge +
      div +
      this.c.dim("轮次: ") +
      turnStr +
      div +
      this.c.dim("上下文: ") +
      contextStr +
      div +
      this.c.dim("账号: ") +
      accountStr +
      suffix
    );
  }

  /**
   * Renders the session status bar to output and returns the formatted string.
   */
  public renderStatusBar(info: SessionStatusInfo): string {
    const formatted = this.formatStatusBar(info);
    this.writer(`${formatted}\n`);
    return formatted;
  }

  /**
   * Formats a single compact event line for a subagent status update.
   * e.g. "[Subagent Event] [Sub-1] [researcher] 状态: running | 动作: reading file\n"
   */
  public formatSubagentMatrixEvent(state: SubagentLiveState): string {
    const rawId = state.id || "sub-unknown";
    const displayId = rawId.replace(/^sub-/i, "Sub-");
    const role = state.role || "unknown";
    const status = state.status || "unknown";
    const action = state.lastAction || "";
    const account = state.account ? ` [${state.account}]` : "";
    return `[Subagent Event] [${displayId}] [${role}]${account} 状态: ${status} | 动作: ${action}\n`;
  }

  /**
   * Formats multi-subagent execution progress matrix card.
   */
  public formatSubagentMatrix(states: ActiveSubagentState[], compact = false): string {
    if (compact) {
      return states.map((s) => this.formatSubagentMatrixEvent(s).trimEnd()).join("\n");
    }

    const lines: string[] = [];
    lines.push(this.c.bold.cyan("┌─ [多会话子代理协同看板 (Sub-Agent Matrix)] " + "─".repeat(30)));

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const roleBadge = s.role === "coder" ? this.c.yellow(`[coder]`) : this.c.blue(`[researcher]`);
      const accountBadge = s.account ? this.c.magenta(`[${s.account}]`) : "";
      const hop = s.hopCount ?? (s.handoffCount !== undefined ? s.handoffCount + 1 : 1);
      const subHandoffs = s.handoffCount ?? Math.max(0, hop - 1);
      const hopBadge =
        subHandoffs > 0
          ? this.c.yellow(`[Hop ${hop} (接手 ${subHandoffs} 次)]`)
          : this.c.gray(`[Hop 1 (接手 0 次)]`);

      const statusBadge =
        s.status === "completed"
          ? this.c.green("✅ 已完成")
          : s.status === "failed"
          ? this.c.red("❌ 失败")
          : this.c.cyan("🔄 运行中");
      const durationSec = ((s.durationMs ?? 0) / 1000).toFixed(1);

      const headerBadges = [roleBadge, accountBadge, hopBadge].filter(Boolean).join(" ");

      lines.push(
        this.c.bold(`│ [Sub-${i + 1}] `) +
          `${headerBadges} ${(s.description || "").slice(0, 24)} | 状态: ${statusBadge} | 耗时: ${durationSec}s`
      );
      if (s.lastAction) {
        lines.push(`│   └─ 最新动作: ${this.c.gray(s.lastAction)}`);
      }
    }

    lines.push(this.c.bold.cyan("└" + "─".repeat(68)));
    return lines.join("\n");
  }

  /**
   * Renders the multi-subagent progress matrix card.
   */
  public renderSubagentMatrix(states: ActiveSubagentState[], compact = false): void {
    if (compact) {
      for (const s of states) {
        this.writer(this.formatSubagentMatrixEvent(s));
      }
    } else {
      this.writer(this.formatSubagentMatrix(states) + "\n");
    }
  }

  /**
   * Formats Main Session Virtualization banner (📌 虚拟化归档青色边框).
   */
  public formatMainVirtualizationBanner(sessionId: string, snapshotPath: string): string {
    const border = "─".repeat(60);
    return [
      this.c.cyan(`┌${border}┐`),
      this.c.cyan(`│ 📌 [主控会话已虚拟化归档] ${sessionId.padEnd(35)} │`),
      this.c.cyan(`│ 宏观规划快照已落盘: ${snapshotPath.padEnd(40)} │`),
      this.c.cyan(`│ 云端连接已安全释放，子任务开始受限排队攻坚...             │`),
      this.c.cyan(`└${border}┘`),
    ].join("\n");
  }

  /**
   * Renders Main Session Virtualization banner to terminal output.
   */
  public renderMainVirtualizationBanner(sessionId: string, snapshotPath: string): void {
    this.writer("\n" + this.formatMainVirtualizationBanner(sessionId, snapshotPath) + "\n\n");
  }

  /**
   * Formats Successor Awakening banner (🚀 后继代际唤醒绿色边框).
   */
  public formatSuccessorAwakeningBanner(sessionId: string, generation: number): string {
    const border = "─".repeat(60);
    const handoffCount = Math.max(0, generation - 1);
    const title = `🚀 [第 ${generation} 代主控会话已唤醒 (接手 ${handoffCount} 次)] ${sessionId}`;
    return [
      this.c.green(`┌${border}┐`),
      this.c.green(`│ ${title.padEnd(58)} │`),
      this.c.green(`│ 注入前序架构快照与子任务结题成果，重置满额 30 轮推理预算   │`),
      this.c.green(`│ 进入系统交叉验证与交付审阅阶段...                        │`),
      this.c.green(`└${border}┘`),
    ].join("\n");
  }

  /**
   * Renders Successor Awakening banner to terminal output.
   */
  public renderSuccessorAwakeningBanner(sessionId: string, generation: number): void {
    this.writer("\n" + this.formatSuccessorAwakeningBanner(sessionId, generation) + "\n\n");
  }
}

