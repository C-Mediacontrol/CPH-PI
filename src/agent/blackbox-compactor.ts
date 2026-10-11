import type { TurnRecord } from "./compaction.ts";

export interface BlackboxCompactorOptions {
  /**
   * Number of most recent turns to keep completely uncompacted (default: 2).
   */
  preserveRecentTurns?: number;
  /**
   * Target lower bound for high-density compaction on large histories (default: 5000).
   */
  minSnapshotChars?: number;
  /**
   * Strict upper bound to prevent WAF / Sydney prompt length rejection (default: 8000).
   */
  maxSnapshotChars?: number;
  /**
   * Timestamp of incident trigger (default: new Date().toISOString()).
   */
  incidentTime?: string | Date;
  /**
   * When true, preserves full natural conversation history without compaction.
   */
  skipCompaction?: boolean;
}

interface IncidentDiagnostic {
  category: string;
  signature: string;
  remediation: string;
}

export class BlackboxCompactor {
  public static readonly DEFAULT_PRESERVE_RECENT_TURNS = 2;
  public static readonly DEFAULT_MIN_SNAPSHOT_CHARS = 5000;
  public static readonly DEFAULT_MAX_SNAPSHOT_CHARS = 8000;

  /**
   * Core disaster recovery extractor.
   * Compresses multi-turn conversation history into a 5k~8k high-density blackbox snapshot
   * for seamless session handoff when experiencing 429 throttling or connection drops.
   */
  public static extractDisasterBlackbox(
    history: TurnRecord[],
    lastError?: string,
    options: BlackboxCompactorOptions = {}
  ): string {
    const preserveRecent =
      options.preserveRecentTurns ?? this.DEFAULT_PRESERVE_RECENT_TURNS;
    const minChars =
      options.minSnapshotChars ?? this.DEFAULT_MIN_SNAPSHOT_CHARS;
    const maxChars =
      options.maxSnapshotChars ?? this.DEFAULT_MAX_SNAPSHOT_CHARS;
    const isSkip = options.skipCompaction ?? false;

    const incidentTimeStr = options.incidentTime
      ? typeof options.incidentTime === "string"
        ? options.incidentTime
        : options.incidentTime.toISOString()
      : new Date().toISOString();

    const totalTurns = history.length;
    const cutoffIndex = isSkip
      ? 0
      : Math.max(0, totalTurns - preserveRecent);

    const historicalTurns = isSkip ? [] : history.slice(0, cutoffIndex);
    const sceneTurns = isSkip ? history : history.slice(cutoffIndex);

    // Calculate raw character volume
    const totalRawChars = history.reduce(
      (acc, t) =>
        acc +
        (t.userInput?.length || 0) +
        (t.thought?.length || 0) +
        (t.toolOutput?.length || 0) +
        (typeof t.action === "string"
          ? t.action.length
          : JSON.stringify(t.action || "").length),
      0
    );

    // 1. Build Diagnostics
    const diagnostic = this.analyzeIncident(lastError, history);

    // 2. Build Crash Scene Section
    const crashSceneSection = this.renderCrashScene(sceneTurns, isSkip);

    // 3. Build Metadata Section
    let compactionStatusText = "";
    if (isSkip) {
      compactionStatusText = "未折叠 (免裁剪模式生效，保留完整自然历史)";
    } else if (totalTurns <= preserveRecent) {
      compactionStatusText = `无需折叠 (总轮数 ${totalTurns} <= ${preserveRecent} 轮，全保真展现)`;
    } else {
      compactionStatusText = `已折叠历史轮次 (前 ${historicalTurns.length} 轮已精炼压缩，保留末期 ${sceneTurns.length} 轮完整现场)`;
    }

    const metadataSection = [
      "# 🚨 事故现场黑匣子快照 (Disaster Recovery Blackbox Snapshot)",
      "",
      "## 1. 事故基础元数据 (Incident Metadata)",
      `- **触发时间 (Timestamp)**: ${incidentTimeStr}`,
      `- **总执行轮数 (Total Turns)**: ${totalTurns} 轮`,
      `- **最后异常信息 (Last Error)**: ${lastError ? lastError.trim() : "None (未捕获到显式异常)"}`,
      `- **折叠压缩状态 (Compaction Status)**: ${compactionStatusText}`,
    ].join("\n");

    const diagnosticSection = [
      "## 2. 事故特征诊断 (Incident Diagnostics)",
      `- **诊断分类 (Category)**: ${diagnostic.category}`,
      `- **特征研判 (Signature)**: ${diagnostic.signature}`,
      `- **建议处置 (Remediation)**: ${diagnostic.remediation}`,
    ].join("\n");

    // 4. Build Timeline Section with Adaptive Sizing
    // Fixed parts length estimation
    const fixedDocWithoutTimeline = [
      metadataSection,
      diagnosticSection,
      crashSceneSection,
    ].join("\n\n");
    const fixedLength = fixedDocWithoutTimeline.length;

    const timelineSection = this.buildAdaptiveTimeline({
      historicalTurns,
      isSkip,
      totalTurns,
      preserveRecent,
      fixedLength,
      minChars,
      maxChars,
      totalRawChars,
    });

    // 5. Final Document Assembly
    const finalDoc = [
      metadataSection,
      diagnosticSection,
      timelineSection,
      crashSceneSection,
    ].join("\n\n");

    return finalDoc.trim();
  }

  /**
   * Compatibility alias matching the design spec extractSnapshot signature.
   */
  public static extractSnapshot(
    history: TurnRecord[],
    options: BlackboxCompactorOptions = {}
  ): string {
    return this.extractDisasterBlackbox(history, undefined, options);
  }

  /**
   * Analyzes incident signatures for 429 rate limit, network abort, or permission issues.
   */
  private static analyzeIncident(
    lastError?: string,
    history?: TurnRecord[]
  ): IncidentDiagnostic {
    const errText = (lastError || "").trim();
    const lastTurn = history && history.length > 0 ? history[history.length - 1] : undefined;
    const lastTurnErr = (lastTurn?.error || "").trim();
    const combined = `${errText} ${lastTurnErr}`.toLowerCase();

    if (/429|rate[- ]?limit|throttl|quota|too many requests/.test(combined)) {
      return {
        category: "429_RATE_LIMIT (上游频控限流)",
        signature: "检测到 Sydney 上游 429 频控限流或请求阈值溢出，会话被迫异常终止。",
        remediation: "当前账号立即进入 3 分钟冷却，自动轮换账号池下一健康账号，并通过 Handoff 仲裁者微会话完成交接接力。",
      };
    }

    if (
      /disconnect|connection closed|econnreset|broken pipe|socket hang up|timeout|abort|network/.test(
        combined
      )
    ) {
      return {
        category: "CONNECTION_ABORTED (网络中断或连接重置)",
        signature: "检测到传输层 WebSocket / SignalR 双工连接非预期断开或超时中断。",
        remediation: "检查网络直连链路或刷新 Session/Token，准备无缝容灾重试。",
      };
    }

    if (
      /forbidden|unauthorized|gptaccessforbidden|gptnotavailable|access denied|permission/.test(
        combined
      )
    ) {
      return {
        category: "ACCESS_RESTRICTED (智能体访问权限受限)",
        signature: "当前账号无权访问指定的专属 Agent (如 CPH-Dev) 或该智能体权限未激活。",
        remediation: "标记当前账号对该 Agent 不可用，自动轮换具有合法访问权限的已授权账号。",
      };
    }

    if (!errText && !lastTurnErr) {
      return {
        category: "NO_EXPLICIT_ERROR (无显式报错或优雅停机)",
        signature: "未捕获到显式异常调用栈，可能为主动中断或平稳交接场景。",
        remediation: "按标准交接流程读取末期案发现场，直接推进下一步行动。",
      };
    }

    return {
      category: "UNHANDLED_EXCEPTION (运行时未分类异常)",
      signature: `运行时捕获到未分类异常: ${errText || lastTurnErr}`,
      remediation: "审查末期案发现场中保留的完整错误堆栈并进行容灾仲裁。",
    };
  }

  /**
   * Renders the crash scene with 100% complete, uncompacted detail.
   */
  private static renderCrashScene(
    sceneTurns: TurnRecord[],
    isSkip: boolean
  ): string {
    const title = isSkip
      ? "## 4. 全量案发现场记录 (Full Scene Record: All Turns)"
      : `## 4. 末期案发现场 (Immediate Crash Scene: Recent ${sceneTurns.length} Turns)`;

    if (sceneTurns.length === 0) {
      return `${title}\n*(无轮次记录)*`;
    }

    const renderedTurns = sceneTurns.map((t) => this.renderTurnDetail(t));
    return `${title}\n\n${renderedTurns.join("\n\n")}`;
  }

  /**
   * Renders a single turn with 100% full detail.
   */
  private static renderTurnDetail(t: TurnRecord): string {
    const lines: string[] = [`### Turn ${t.turn}`];

    if (t.userInput) {
      lines.push(`- **User**: ${t.userInput}`);
    } else {
      lines.push(`- **User**: (无输入)`);
    }

    if (t.thought) {
      lines.push(`- **Thought**: ${t.thought}`);
    } else {
      lines.push(`- **Thought**: (无思考链)`);
    }

    if (t.action) {
      const actionContent =
        typeof t.action === "string"
          ? t.action
          : JSON.stringify(t.action, null, 2);
      lines.push(`- **Action**:\n\`\`\`json\n${actionContent}\n\`\`\``);
    } else if (t.toolName) {
      lines.push(`- **Tool**: \`${t.toolName}\``);
    } else {
      lines.push(`- **Tool**: (纯对话，无工具调用)`);
    }

    if (t.toolOutput !== undefined) {
      lines.push(`- **Tool Output**:\n\`\`\`\n${t.toolOutput}\n\`\`\``);
    } else {
      lines.push(`- **Tool Output**: (无)`);
    }

    lines.push(`- **Status**: ${t.success !== false ? "SUCCESS" : "FAILED"}`);

    if (t.error) {
      lines.push(`- **Error**: ${t.error}`);
    }

    return lines.join("\n");
  }

  /**
   * Builds the timeline section with dynamic adaptive sizing to hit [minChars, maxChars].
   */
  private static buildAdaptiveTimeline(params: {
    historicalTurns: TurnRecord[];
    isSkip: boolean;
    totalTurns: number;
    preserveRecent: number;
    fixedLength: number;
    minChars: number;
    maxChars: number;
    totalRawChars: number;
  }): string {
    const {
      historicalTurns,
      isSkip,
      totalTurns,
      preserveRecent,
      fixedLength,
      minChars,
      maxChars,
      totalRawChars,
    } = params;

    const header =
      historicalTurns.length > 0
        ? `## 3. 历史轮次时间线摘要 (Historical Timeline Summary: Turns 1 ~ ${historicalTurns.length})`
        : "## 3. 历史轮次时间线摘要 (Historical Timeline Summary)";

    if (isSkip) {
      return `${header}\n*免裁剪模式生效：历史记录未作折叠。*`;
    }

    if (totalTurns <= preserveRecent || historicalTurns.length === 0) {
      return `${header}\n*无需折叠历史：当前总轮数 <= ${preserveRecent} 轮，所有轮次均在末期案发现场完整呈现。*`;
    }

    // Candidate excerpt lengths in descending order
    const candidateExcerptLengths = [300, 200, 150, 100, 60, 30, 0, -1];

    let bestLines: string[] = [];
    let bestTotalLen = Infinity;

    for (const excerptLen of candidateExcerptLengths) {
      const lines = historicalTurns.map((t) =>
        this.formatTimelineItem(t, excerptLen)
      );
      const timelineText = `${header}\n\n${lines.join("\n")}`;
      const totalEstimated = fixedLength + timelineText.length + 4;

      if (totalEstimated <= maxChars) {
        if (totalEstimated >= minChars || totalRawChars < minChars) {
          return timelineText;
        }
        // If it's smaller than minChars but totalRawChars < minChars, we take it
        if (bestLines.length === 0 || totalEstimated > bestTotalLen) {
          bestLines = lines;
          bestTotalLen = totalEstimated;
        }
      }
    }

    // If even excerptLen = -1 still exceeds maxChars (e.g. huge number of historical turns like 80 turns)
    // We fold older turns into a range summary block
    const ultraCompactLines = historicalTurns.map((t) =>
      this.formatTimelineItem(t, -1)
    );
    const rawTimelineText = `${header}\n\n${ultraCompactLines.join("\n")}`;
    const rawTotalEstimated = fixedLength + rawTimelineText.length + 4;

    if (rawTotalEstimated > maxChars) {
      const overflow = rawTotalEstimated - maxChars + 60;
      const avgLineLen = 48;
      const foldCount = Math.min(
        historicalTurns.length - 2,
        Math.max(1, Math.ceil(overflow / avgLineLen))
      );

      const foldedBlock = this.buildFoldedBlock(
        historicalTurns.slice(0, foldCount)
      );
      const remainingLines = historicalTurns
        .slice(foldCount)
        .map((t) => this.formatTimelineItem(t, -1));

      const adjustedLines = [foldedBlock, ...remainingLines];
      return `${header}\n\n${adjustedLines.join("\n")}`;
    }

    // If we have bestLines that fit under maxChars, return them
    if (bestLines.length > 0) {
      return `${header}\n\n${bestLines.join("\n")}`;
    }

    return `${header}\n\n${ultraCompactLines.join("\n")}`;
  }

  /**
   * Formats a single historical turn for the timeline.
   */
  private static formatTimelineItem(
    t: TurnRecord,
    excerptLen: number
  ): string {
    const tool =
      t.toolName ||
      (typeof t.action === "object" && t.action?.tool
        ? t.action.tool
        : "conversation");
    const target =
      t.action?.path ||
      t.action?.command ||
      t.action?.query ||
      t.action?.file ||
      "";
    const status = t.success !== false ? "SUCCESS" : "FAILED";

    if (excerptLen < 0) {
      // Ultra compact mode (~45-50 chars)
      return `- Turn ${t.turn}: [${tool}]${target ? ` (${target})` : ""} -> ${status}`;
    }

    const parts: string[] = [
      `- Turn ${t.turn}: [${tool}]${target ? ` (${target})` : ""} -> ${status}`,
    ];

    if (t.userInput) {
      const userPreview =
        t.userInput.length > 50
          ? `${t.userInput.slice(0, 47)}...`
          : t.userInput;
      parts.push(`User: "${userPreview.replace(/\n/g, " ")}"`);
    }

    if (t.thought && excerptLen > 0) {
      const thoughtLimit = Math.min(excerptLen, 50);
      const thoughtPreview =
        t.thought.length > thoughtLimit
          ? `${t.thought.slice(0, thoughtLimit - 3)}...`
          : t.thought;
      parts.push(`Thought: "${thoughtPreview.replace(/\n/g, " ")}"`);
    }

    if (t.toolOutput && excerptLen > 0) {
      const lines = t.toolOutput.split("\n").length;
      const totalChars = t.toolOutput.length;
      const preview = t.toolOutput
        .slice(0, excerptLen)
        .replace(/\n/g, " ")
        .trim();
      parts.push(`Output [~${lines}L/${totalChars}c]: ${preview}...`);
    } else if (t.toolOutput) {
      const lines = t.toolOutput.split("\n").length;
      const totalChars = t.toolOutput.length;
      parts.push(`Output: [~${lines}L/${totalChars}c 折叠]`);
    }

    return parts.join(" | ");
  }

  /**
   * Builds an aggregated folded block for older historical turns.
   */
  private static buildFoldedBlock(turns: TurnRecord[]): string {
    if (turns.length === 0) return "";
    const firstTurn = turns[0].turn;
    const lastTurn = turns[turns.length - 1].turn;

    const toolCounts: Record<string, number> = {};
    let successCount = 0;

    for (const t of turns) {
      const tool =
        t.toolName ||
        (typeof t.action === "object" && t.action?.tool
          ? t.action.tool
          : "task");
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      if (t.success !== false) successCount++;
    }

    const toolsSummary = Object.entries(toolCounts)
      .map(([name, count]) => `${name} x${count}`)
      .join(", ");

    return `- Turns ${firstTurn} ~ ${lastTurn}: ${turns.length} 轮历史步骤已聚合折叠 (${toolsSummary}, 成功率: ${successCount}/${turns.length})`;
  }
}
