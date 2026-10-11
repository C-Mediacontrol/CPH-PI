import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ChatHubClient } from "../src/transport/chathub-client.ts";
import type { AttachmentAnnotation } from "../src/transport/types.ts";
import { AccountPool } from "../src/auth/account-pool.ts";
import type { ActiveSessionToken } from "../src/auth/token-manager.ts";

export type ProbeMode = "short" | "long-text" | "local-file" | "cloud-attachment";

export interface ProbeTurnRecord {
  turn: number;
  timestamp: string;
  promptChars: number;
  responseChars: number;
  reasoningChars: number;
  latencyMs: number;
  terminal: boolean;
  terminalCode?: string;
  terminalSnippet?: string;
  rawTerminalFrame?: any;
}

export interface ProbeReport {
  mode: ProbeMode;
  agentId: string;
  modelTone: string;
  conversationId: string;
  maxTurnsAttempted: number;
  actualCompletedTurns: number;
  stoppedAtTurn: number;
  isHardCapped: boolean;
  terminalSignal?: string;
  turns: ProbeTurnRecord[];
}

export interface ProbeOptions {
  mode?: ProbeMode;
  maxTurns?: number;
  agentId?: string;
  outputDir?: string;
  mockPort?: number;
  pacingMs?: number;
  token?: ActiveSessionToken;
  workspaceRoot?: string;
  onTurnStart?: (turn: number, total: number) => void;
  onTurnProgress?: (record: ProbeTurnRecord, turn: number, total: number) => void;
}

/**
 * 轨道 1：极简纯轮数基准
 * 排除 Token 干扰，测试纯轮数硬顶极限
 */
export function buildShortPrompt(turn: number): string {
  if (turn === 1) {
    return "我们正在进行基础连通性基准测试。请仅回答数字：1。";
  }
  return `收到。请仅回答下一个数字：${turn}。`;
}

/**
 * 轨道 2A：直接灌入长文本
 * 每轮灌入 ~3,500 字符代码与错误日志，测试窗口溢出点
 */
export function buildLongTextPrompt(turn: number): string {
  const header = `// =========================================================================\n// CPH-PI 工业级运行日志与 SignalR 双工帧诊断数据 (Turn ${turn})\n// =========================================================================\n\n`;

  const codeSection = `
interface SignalRMessageFrame {
  type: number;
  target?: string;
  invocationId?: string;
  arguments?: Array<{
    messages?: Array<{
      author?: string;
      text?: string;
      messageType?: string;
      adaptiveCards?: any[];
      messageAnnotations?: Array<{
        id: string;
        messageAnnotationMetadata: Record<string, any>;
        messageAnnotationType: string;
      }>;
    }>;
    writeAtCursor?: string;
    throttledState?: {
      isThrottled: boolean;
      cooldownRemainingMs: number;
      retryAfterSeconds: number;
    };
  }>;
}

class FastSignalRDecoder {
  private buffer: Buffer;
  private offset: number = 0;
  private readonly delimiter: number = 0x1e;

  constructor(initialCapacity: number = 65536) {
    this.buffer = Buffer.allocUnsafe(initialCapacity);
  }

  public append(chunk: Buffer): SignalRMessageFrame[] {
    const frames: SignalRMessageFrame[] = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === this.delimiter) {
        const slice = chunk.subarray(start, i);
        if (slice.length > 0) {
          try {
            const parsed = JSON.parse(slice.toString("utf-8"));
            frames.push(parsed);
          } catch (e: any) {
            console.error("[SignalRDecoder] Corrupted JSON slice discarded:", e.message);
          }
        }
        start = i + 1;
      }
    }
    return frames;
  }
}

class SlidingWindowBufferCompactor {
  private totalTokens: number = 0;
  private windowSize: number = 32768;
  private history: Array<{ role: string; content: string; tokens: number }> = [];

  public pushTurn(role: string, content: string, tokens: number): void {
    this.history.push({ role, content, tokens });
    this.totalTokens += tokens;
    this.compactIfNeeded();
  }

  private compactIfNeeded(): void {
    if (this.totalTokens <= this.windowSize) return;
    let reclaimed = 0;
    while (this.history.length > 4 && this.totalTokens > this.windowSize * 0.75) {
      const removed = this.history.shift();
      if (removed) {
        this.totalTokens -= removed.tokens;
        reclaimed += removed.tokens;
      }
    }
    console.log(\`[Compactor] Reclaimed \${reclaimed} tokens from sliding window buffer.\`);
  }
}
`;

  const logSection = `
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.102Z] [TRACE] SignalR frame parser encountered partial chunk (offset=2048, remaining=1536)
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.105Z] [DEBUG] WebSocket state transitioned: CONNECTED -> STREAMING
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.110Z] [WARN] Potential high memory usage detected in AST patch cache (size=142MB)
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.115Z] [INFO] Dispatching tool call batch: git_status, read_file, file_search
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.120Z] [ERROR] Substrate client request timeout after 120000ms: endpoint=https://substrate.office.com/m365Copilot/Chathub
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.125Z] [DEBUG] Invoking exponential backoff: attempt=2, delay=4500ms
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.130Z] [INFO] AccountPool switching active session from primary to secondary account: GSC.VFU2@cma-cgm.com
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.135Z] [TRACE] Re-establishing Sydney WebSocket duplex handshake with token oid=00000000-0000-0000-0000-000000000001
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.140Z] [DEBUG] SignalR protocol handshake acknowledged: {"protocol":"json","version":1}
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.145Z] [TRACE] Injected customAgentId: T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.150Z] [DEBUG] OptionsSets verified: search_result_progress_messages_with_search_queries, update_textdoc_response_after_streaming, cwc_flux_v3
[2026-10-10T19:00:${String(turn % 60).padStart(2, "0")}.155Z] [TRACE] Telemetry span: ClientSessionLifetime durationMs=89231 status=OK
`;

  const footer = `\n\n【分析任务】请根据上述代码和系统运行日志，提取并用一句话简要陈述其中的 1 个核心技术问题（轮次: ${turn}）：`;

  let prompt = header + codeSection + logSection + footer;

  // 保证达到至少 3,500 字符
  if (prompt.length < 3500) {
    const padContent = `\n// [PADDING-BLOCK] 仿真追踪冗余上下文以达到 3.5k 字符窗口阈值 (Turn ${turn})\n` +
      `// ContextPaddingLine: token_entropy=0x${(turn * 31337).toString(16)} trace_id=cph-probe-${turn}-${Date.now()}\n`.repeat(25);
    prompt = header + codeSection + logSection + padContent + footer;
  }

  return prompt;
}

/**
 * 轨道 2B：本地文件路径引用
 * 将 10KB 真实代码写入 .cph/probe-files/turn-${N}.log，仅发送路径与头尾摘要
 */
export function buildLocalFilePrompt(
  turn: number,
  workspaceRoot: string = process.cwd()
): {
  prompt: string;
  filePath: string;
  fileContent: string;
} {
  const probeFilesDir = path.join(workspaceRoot, ".cph", "probe-files");
  fs.mkdirSync(probeFilesDir, { recursive: true });

  const fileName = `turn-${turn}.log`;
  const filePath = path.join(probeFilesDir, fileName);

  let content = `// === CPH-PI Local File Payload: Turn ${turn} ===\n`;
  content += `// Generated at: ${new Date().toISOString()}\n`;
  content += `// Target Path: .cph/probe-files/${fileName}\n\n`;

  const fillerLine = `[TRACE-${turn}] seq=${turn} code=CPH_SYDNEY_PROBE_DIAGNOSTIC_TRACE_LINE_${turn} status=OK payload=0x${(turn * 9999).toString(16)} checksum=VALID\n`;
  while (content.length < 10240) {
    content += fillerLine;
  }
  content = content.slice(0, 10240); // 严格截取 10KB

  fs.writeFileSync(filePath, content, "utf-8");

  const prompt = [
    `[本地文件索引: .cph/probe-files/${fileName}]`,
    `头部摘要: [Turn ${turn}] 时间=${new Date().toISOString()} 文件大小=10240 字节`,
    `中间摘要: 包含序列号 seq=${turn} 的端到端 Sydney WebSocket 遥测数据与代码追踪`,
    `尾部摘要: 校验和=VALID 状态=OK 轮次=${turn}`,
    `请确认已检索并记录此本地文件，并简要回复确认轮次：${turn}。`,
  ].join("\n");

  return { prompt, filePath, fileContent: content };
}

/**
 * 轨道 2C：云端附件注入探测
 * 在 SignalR 帧中挂载 AttachmentAnnotation 元数据
 */
export function buildCloudAttachmentPayload(turn: number): {
  prompt: string;
  annotations: AttachmentAnnotation[];
} {
  const docId = `urn:cph:probe:attachment:${turn}:handoff-${turn}.md`;
  const annotations: AttachmentAnnotation[] = [
    {
      id: docId,
      messageAnnotationMetadata: {
        "@type": "FileMetadata",
        annotationType: "File",
        fileType: "md",
        fileName: `handoff-turn-${turn}.md`,
      },
      messageAnnotationType: "File",
    },
  ];

  const prompt = [
    `[云端附件注入 Turn ${turn}]`,
    `我们在 SignalR 消息中挂载了附件: handoff-turn-${turn}.md (ID: ${docId})。`,
    `请确认云端已成功解析该附件元数据，并仅回复：“附件已接收: ${turn}”。`,
  ].join("\n");

  return { prompt, annotations };
}

/**
 * 评估单轮应答是否触碰终止特征
 */
export function evaluateTerminalCondition(
  text: string,
  rawMessages: any[] = [],
  rawFrames: any[] = [],
  rateLimitDetected = false
): {
  isTerminal: boolean;
  terminalCode?: string;
  terminalSnippet?: string;
  rawTerminalFrame?: any;
} {
  if (rateLimitDetected) {
    return {
      isTerminal: true,
      terminalCode: "Throttled",
      terminalSnippet: "Rate limit detected during message exchange",
      rawTerminalFrame: { reason: "rate_limit_detected" },
    };
  }

  // 1. 检查 rawMessages 中的 Disengaged 或 OffTopic
  for (const msg of rawMessages) {
    if (msg.messageType === "Disengaged") {
      return {
        isTerminal: true,
        terminalCode: "Disengaged",
        terminalSnippet: msg.text || "Disengaged message received",
        rawTerminalFrame: msg,
      };
    }
    if (msg.messageType === "OffTopic") {
      return {
        isTerminal: true,
        terminalCode: "OffTopic",
        terminalSnippet: msg.text || "OffTopic message received",
        rawTerminalFrame: msg,
      };
    }
  }

  // 2. 检查 rawFrames 的 result 状态
  for (const frame of rawFrames) {
    if (frame.item?.result?.value && frame.item.result.value !== "Success") {
      return {
        isTerminal: true,
        terminalCode: frame.item.result.value,
        terminalSnippet: frame.item.result.message || frame.item.result.value,
        rawTerminalFrame: frame,
      };
    }
    if (frame.error) {
      return {
        isTerminal: true,
        terminalCode: "FrameError",
        terminalSnippet: typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error),
        rawTerminalFrame: frame,
      };
    }
  }

  // 3. 检查模型文本中的限制模式
  const limitPattern = /已达到(此|该)?对话的限制|达到会话上限|reached (the )?(conversation )?limit|time to move on|换个新话题/i;
  if (limitPattern.test(text)) {
    return {
      isTerminal: true,
      terminalCode: "ConversationLimitReached",
      terminalSnippet: text.slice(0, 200),
      rawTerminalFrame: { text },
    };
  }

  const throttledPattern = /rate limit|too many requests|配额已达上限|请稍后再试/i;
  if (throttledPattern.test(text)) {
    return {
      isTerminal: true,
      terminalCode: "Throttled",
      terminalSnippet: text.slice(0, 200),
      rawTerminalFrame: { text },
    };
  }

  return { isTerminal: false };
}

/**
 * 生成 Markdown 格式的探测报告
 */
export function generateMarkdownReport(report: ProbeReport): string {
  const terminalTurn = report.turns.find((t) => t.terminal);
  const avgLatency = report.turns.length > 0
    ? Math.round(report.turns.reduce((acc, t) => acc + t.latencyMs, 0) / report.turns.length)
    : 0;

  let md = `# CPH-PI 云端会话轮数与上下文探测报告 (${report.mode})\n\n`;
  md += `## 1. 基础元数据\n\n`;
  md += `| 属性 | 取值 |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **探测模式 (Mode)** | \`${report.mode}\` |\n`;
  md += `| **目标 Agent ID** | \`${report.agentId}\` |\n`;
  md += `| **模型基调 (Tone)** | \`${report.modelTone}\` |\n`;
  md += `| **会话 ID (Conversation ID)** | \`${report.conversationId}\` |\n`;
  md += `| **计划尝试轮数** | ${report.maxTurnsAttempted} |\n`;
  md += `| **实际完成轮数** | ${report.actualCompletedTurns} |\n`;
  md += `| **停止轮次** | ${report.stoppedAtTurn} |\n`;
  md += `| **平均单轮耗时** | ${avgLatency} ms |\n`;
  md += `| **是否触发硬顶** | ${report.isHardCapped ? "**是 (YES)**" : "否 (NO)"} |\n`;
  if (report.terminalSignal) {
    md += `| **终结信号 / 错误码** | \`${report.terminalSignal}\` |\n`;
  }
  md += `\n---\n\n`;

  md += `## 2. 轮次详细遥测数据\n\n`;
  md += `| 轮次 | 耗时 (ms) | 提示词字符数 | 思考链字符数 | 回复字符数 | 状态 | 终结代码 |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const t of report.turns) {
    const status = t.terminal ? "🔴 终结" : "🟢 正常";
    const code = t.terminalCode || "-";
    md += `| ${t.turn} | ${t.latencyMs} | ${t.promptChars} | ${t.reasoningChars} | ${t.responseChars} | ${status} | ${code} |\n`;
  }
  md += `\n`;

  if (terminalTurn && terminalTurn.rawTerminalFrame) {
    md += `## 3. 原始终结帧 (Raw Terminal Frame)\n\n`;
    md += `\`\`\`json\n`;
    md += JSON.stringify(terminalTurn.rawTerminalFrame, null, 2);
    md += `\n\`\`\`\n\n`;
  }

  md += `## 4. 实验结论与分析说明\n\n`;
  if (report.isHardCapped) {
    md += `- **硬顶拦截确认**: 探测在第 ${report.stoppedAtTurn} 轮遭遇终止，终止原因: \`${report.terminalSignal || "Unknown"}\`。\n`;
    if (terminalTurn?.terminalSnippet) {
      md += `- **终端响应摘要**: "${terminalTurn.terminalSnippet}"\n`;
    }
  } else {
    md += `- **平稳通过**: 顺利完成全部 ${report.actualCompletedTurns} 轮交互，未触发任何 Disengaged、Throttled 或硬顶限制。\n`;
  }

  return md;
}

/**
 * 将探测报告落盘保存为 JSON 和 Markdown
 */
export function saveProbeReport(
  report: ProbeReport,
  outputDir?: string,
  workspaceRoot: string = process.cwd()
): { jsonPath: string; mdPath: string } {
  const targetDir = outputDir || path.join(workspaceRoot, ".cph", "probe-reports");
  fs.mkdirSync(targetDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `probe-${report.mode}-${ts}`;
  const jsonPath = path.join(targetDir, `${baseName}.json`);
  const mdPath = path.join(targetDir, `${baseName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(mdPath, generateMarkdownReport(report), "utf-8");

  return { jsonPath, mdPath };
}

/**
 * 探针执行引擎
 */
export class ProbeLimitsRunner {
  private options: Required<Omit<ProbeOptions, "token" | "mockPort" | "onTurnStart" | "onTurnProgress">> & {
    token?: ActiveSessionToken;
    mockPort?: number;
    onTurnStart?: (turn: number, total: number) => void;
    onTurnProgress?: (record: ProbeTurnRecord, turn: number, total: number) => void;
  };
  private isInterrupted = false;

  constructor(options?: ProbeOptions) {
    const defaultWorkspace = process.cwd();
    this.options = {
      mode: options?.mode || "short",
      maxTurns: options?.maxTurns ?? 45,
      agentId:
        options?.agentId ||
        "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3",
      outputDir: options?.outputDir || path.join(options?.workspaceRoot || defaultWorkspace, ".cph", "probe-reports"),
      mockPort: options?.mockPort,
      pacingMs: options?.pacingMs ?? 1500,
      token: options?.token,
      workspaceRoot: options?.workspaceRoot || defaultWorkspace,
      onTurnStart: options?.onTurnStart,
      onTurnProgress: options?.onTurnProgress,
    };
  }

  public stop(): void {
    this.isInterrupted = true;
  }

  public async run(): Promise<ProbeReport> {
    let token = this.options.token;
    if (!token) {
      if (this.options.mockPort) {
        token = {
          email: "mock.tester@cma-cgm.com",
          accessToken: "mock.jwt.token",
          refreshToken: "mock.rt",
          expiresAt: Date.now() + 3600_000,
          oid: "00000000-0000-0000-0000-000000000001",
          tid: "72f988bf-86f1-41af-91ab-2d7cd011db47",
        };
      } else {
        const pool = new AccountPool();
        token = await pool.getNextAvailableToken();
      }
    }

    const normalizedAgentId = ChatHubClient.normalizeAgentId(this.options.agentId);
    const client = new ChatHubClient(token, {
      modelTone: "Gpt_61_Sol_Reasoning",
      customAgentId: normalizedAgentId,
      wsBaseUrl: this.options.mockPort ? `ws://127.0.0.1:${this.options.mockPort}/chathub` : undefined,
      timeoutMs: 60_000,
    });

    const conversationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const turns: ProbeTurnRecord[] = [];
    let isHardCapped = false;
    let terminalSignal: string | undefined = undefined;
    let stoppedAtTurn = this.options.maxTurns;
    let actualCompletedTurns = 0;

    for (let turn = 1; turn <= this.options.maxTurns; turn++) {
      if (this.isInterrupted) {
        stoppedAtTurn = turn - 1;
        break;
      }

      this.options.onTurnStart?.(turn, this.options.maxTurns);

      let promptText = "";
      let annotations: AttachmentAnnotation[] | undefined = undefined;

      switch (this.options.mode) {
        case "short":
          promptText = buildShortPrompt(turn);
          break;
        case "long-text":
          promptText = buildLongTextPrompt(turn);
          break;
        case "local-file": {
          const res = buildLocalFilePrompt(turn, this.options.workspaceRoot);
          promptText = res.prompt;
          break;
        }
        case "cloud-attachment": {
          const res = buildCloudAttachmentPayload(turn);
          promptText = res.prompt;
          annotations = res.annotations;
          break;
        }
      }

      const requestId = crypto.randomUUID();
      const turnStartTime = Date.now();
      let rateLimitDetected = false;
      const turnFrames: any[] = [];

      try {
        const response = await client.sendMessage(
          {
            text: promptText,
            conversationId,
            sessionId,
            requestId,
            isStartOfSession: turn === 1,
            annotations,
          },
          {
            onRateLimitDetected: () => {
              rateLimitDetected = true;
            },
            onRawFrame: (frame) => {
              turnFrames.push(frame);
            },
          }
        );

        const latencyMs = Date.now() - turnStartTime;
        const termEval = evaluateTerminalCondition(
          response.text,
          response.rawMessages,
          response.rawFrames || turnFrames,
          rateLimitDetected
        );

        const record: ProbeTurnRecord = {
          turn,
          timestamp: new Date().toISOString(),
          promptChars: promptText.length,
          responseChars: response.text.length,
          reasoningChars: response.reasoning.length,
          latencyMs,
          terminal: termEval.isTerminal,
          terminalCode: termEval.terminalCode,
          terminalSnippet: termEval.terminalSnippet,
          rawTerminalFrame: termEval.rawTerminalFrame,
        };

        turns.push(record);
        this.options.onTurnProgress?.(record, turn, this.options.maxTurns);

        if (termEval.isTerminal) {
          isHardCapped = true;
          terminalSignal = termEval.terminalCode;
          stoppedAtTurn = turn;
          actualCompletedTurns = turn - 1;
          break;
        } else {
          actualCompletedTurns = turn;
        }
      } catch (err: any) {
        const latencyMs = Date.now() - turnStartTime;
        const isRateLimit = /rate limit|429|throttled|配额/i.test(err.message || "");
        const termCode = isRateLimit ? "Throttled" : "Error";

        const record: ProbeTurnRecord = {
          turn,
          timestamp: new Date().toISOString(),
          promptChars: promptText.length,
          responseChars: 0,
          reasoningChars: 0,
          latencyMs,
          terminal: true,
          terminalCode: termCode,
          terminalSnippet: err.message || String(err),
          rawTerminalFrame: { error: err.message || String(err), frames: turnFrames },
        };

        turns.push(record);
        this.options.onTurnProgress?.(record, turn, this.options.maxTurns);

        isHardCapped = true;
        terminalSignal = termCode;
        stoppedAtTurn = turn;
        actualCompletedTurns = turn - 1;
        break;
      }

      if (turn < this.options.maxTurns && this.options.pacingMs > 0 && !this.isInterrupted) {
        await new Promise((resolve) => setTimeout(resolve, this.options.pacingMs));
      }
    }

    if (!isHardCapped && actualCompletedTurns === this.options.maxTurns) {
      stoppedAtTurn = this.options.maxTurns;
    }

    const report: ProbeReport = {
      mode: this.options.mode,
      agentId: this.options.agentId,
      modelTone: "Gpt_61_Sol_Reasoning",
      conversationId,
      maxTurnsAttempted: turns.length,
      actualCompletedTurns,
      stoppedAtTurn,
      isHardCapped,
      terminalSignal,
      turns,
    };

    return report;
  }

  public saveReport(report: ProbeReport): { jsonPath: string; mdPath: string } {
    return saveProbeReport(report, this.options.outputDir, this.options.workspaceRoot);
  }
}

/**
 * 命令行参数解析
 */
export function parseCliArgs(argv: string[]): ProbeOptions {
  const options: ProbeOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode" && argv[i + 1]) {
      options.mode = argv[++i] as any;
    } else if (arg === "--max-turns" && argv[i + 1]) {
      options.maxTurns = parseInt(argv[++i], 10);
    } else if (arg === "--agent" && argv[i + 1]) {
      options.agentId = argv[++i];
    } else if (arg === "--output-dir" && argv[i + 1]) {
      options.outputDir = argv[++i];
    } else if (arg === "--mock-port" && argv[i + 1]) {
      options.mockPort = parseInt(argv[++i], 10);
    } else if (arg === "--pacing-ms" && argv[i + 1]) {
      options.pacingMs = parseInt(argv[++i], 10);
    }
  }
  return options;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  console.log("=================================================================");
  console.log("🚀 CPH-PI 云端会话轮数与上下文注入实证探针 (Probe Limits Suite)");
  console.log(`- 探测模式: ${args.mode || "short"}`);
  console.log(`- 最大轮数: ${args.maxTurns || 45}`);
  console.log(`- 目标 Agent: ${args.agentId || "CPH-Dev (默认)"}`);
  if (args.mockPort) {
    console.log(`- Mock 端口: ${args.mockPort}`);
  }
  console.log("=================================================================\n");

  const runner = new ProbeLimitsRunner({
    ...args,
    onTurnStart: (turn, total) => {
      process.stdout.write(`[Turn ${turn}/${total}] 正在发送请求... `);
    },
    onTurnProgress: (record, turn, total) => {
      if (record.terminal) {
        console.log(`🔴 触发终结! 代码: ${record.terminalCode} | 耗时: ${record.latencyMs}ms | 回复: ${record.responseChars} 字符`);
        if (record.terminalSnippet) {
          console.log(`   Snippet: ${record.terminalSnippet}`);
        }
      } else {
        console.log(`🟢 完成 | 耗时: ${record.latencyMs}ms | 提示: ${record.promptChars} 字符 | 思考: ${record.reasoningChars} 字符 | 回复: ${record.responseChars} 字符`);
      }
    },
  });

  process.on("SIGINT", () => {
    console.log("\n[!] 捕获 Ctrl+C 中断信号，正在优雅停止探针并导出阶段报告...");
    runner.stop();
  });

  try {
    const report = await runner.run();
    console.log("\n=================================================================");
    console.log("📊 探测完成统计");
    console.log(`- 计划轮数: ${report.maxTurnsAttempted}`);
    console.log(`- 实际完成: ${report.actualCompletedTurns}`);
    console.log(`- 停止轮次: ${report.stoppedAtTurn}`);
    console.log(`- 是否触碰硬顶: ${report.isHardCapped ? "是" : "否"}`);
    if (report.terminalSignal) {
      console.log(`- 终结信号: ${report.terminalSignal}`);
    }
    console.log("=================================================================\n");

    const saved = runner.saveReport(report);
    console.log(`[√] JSON 报告已保存: ${saved.jsonPath}`);
    console.log(`[√] Markdown 报告已保存: ${saved.mdPath}\n`);
  } catch (err: any) {
    console.error(`[X] 探测执行失败:`, err);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
