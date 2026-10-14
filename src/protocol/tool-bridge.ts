import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createCodingTools,
  createReadTool,
  createEditTool,
  createWriteTool,
  createBashTool,
  createLocalBashOperations,
  type BashOperations,
  type BashToolOptions,
  type Tool,
} from "../../pi/packages/coding-agent/src/core/tools/index.ts";

/**
 * Supported Copilot action tool names and aliases.
 */
export type CopilotActionName =
  | "read_file"
  | "read"
  | "cat"
  | "patch_file"
  | "edit"
  | "edit_file"
  | "write_file"
  | "write"
  | "run_command"
  | "bash"
  | "exec"
  | "ask_question"
  | "question"
  | "invoke_subagent"
  | "subagent";

export type CanonicalToolName = "read" | "edit" | "write" | "bash" | "question";

export interface SubagentTaskSpec {
  role: "researcher" | "searcher" | "coder";
  description: string;
  prompt: string;
  maxTurns?: number;
  stage?: number;
}

/**
 * Raw action input received from Copilot (Markdown code block, JSON, or YAML).
 */
export interface CopilotAction {
  tool?: string;
  action?: string;
  name?: string;
  subagents?: SubagentTaskSpec[];
  path?: string;
  filePath?: string;
  file?: string;
  start_line?: number;
  end_line?: number;
  startLine?: number;
  endLine?: number;
  offset?: number;
  limit?: number;
  lines?: number;
  old_string?: string;
  new_string?: string;
  old_text?: string;
  new_text?: string;
  oldText?: string;
  newText?: string;
  edits?: Array<{
    oldText?: string;
    newText?: string;
    old_string?: string;
    new_string?: string;
    old_text?: string;
    new_text?: string;
    [key: string]: any;
  }>;
  content?: string;
  command?: string;
  cmd?: string;
  timeout?: number;
  question?: string;
  prompt?: string;
  options?: string[];
  [key: string]: any;
}

export interface InvokeSubagentAction extends CopilotAction {
  tool: "invoke_subagent" | "subagent";
  subagents: SubagentTaskSpec[];
}

export interface MappedReadArgs {
  path: string;
  offset: number;
  limit: number;
}

export interface MappedEditArgs {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}

export interface MappedWriteArgs {
  path: string;
  content: string;
}

export interface MappedBashArgs {
  command: string;
  timeout: number;
}

export interface MappedQuestionArgs {
  question: string;
  options?: string[];
}

export type MappedToolArgs =
  | MappedReadArgs
  | MappedEditArgs
  | MappedWriteArgs
  | MappedBashArgs
  | MappedQuestionArgs;

export interface MappedAction {
  canonicalTool: CanonicalToolName;
  target: string;
  args: MappedToolArgs;
  originalAction: CopilotAction;
}

export interface ToolBridgeResult {
  actionName: string;
  piToolName: string;
  target: string;
  success: boolean;
  output: string;
  rawOutput?: string;
  formatted: string;
  rawResult?: any;
  mappedArgs?: MappedToolArgs;
  persistedFile?: string;
}

export interface FormatResultParams {
  toolName: string;
  target?: string;
  success: boolean;
  output: string;
}

export interface ToolBridgeOptions {
  cwd?: string;
  tools?: Tool[] | Record<string, Tool>;
  onQuestion?: (action: MappedQuestionArgs) => Promise<string> | string;
  ledger?: any;
  context?: { role?: string; sessionId?: string };
}

/**
 * Maximum lines allowed in a single slice read (protects Copilot 2k token limit).
 */
export const MAX_READ_SLICE_LINES = 100;

/**
 * Large output persistence thresholds and preview constraints.
 */
export const MAX_INLINE_OUTPUT_CHARS = 3000;
export const MAX_INLINE_OUTPUT_LINES = 50;
export const PREVIEW_HEAD_LINES = 20;
export const PREVIEW_TAIL_LINES = 20;

export interface PersistOutputResult {
  displayOutput: string;
  persistedFile?: string;
}

/**
 * Checks if tool output exceeds inline limits (3000 chars or 50 lines).
 * If it does, automatically persists 100% full content to <workspaceRoot>/.cph/artifacts/tool-output-<timestamp>-<hash>.log
 * and formats a compact snapshot preview (head 20 lines + notice with relative path and read_file hint + tail 20 lines).
 */
export function persistLargeOutputIfNeeded(
  output: string,
  workspaceRoot: string,
  toolName = "tool"
): PersistOutputResult {
  if (!output) {
    return { displayOutput: "" };
  }

  const lines = output.split(/\r?\n/);
  const isOverChars = output.length > MAX_INLINE_OUTPUT_CHARS;
  const isOverLines = lines.length > MAX_INLINE_OUTPUT_LINES;

  if (!isOverChars && !isOverLines) {
    return { displayOutput: output };
  }

  // 1. Ensure artifacts directory exists in workspace
  const artifactsDir = path.join(workspaceRoot, ".cph", "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  // 2. Generate unique filename: tool-output-<timestamp>-<hash>.log
  const timestamp = Date.now();
  const hash = crypto.createHash("sha256").update(output).digest("hex").slice(0, 8);
  const fileName = `tool-output-${timestamp}-${hash}.log`;
  const absolutePath = path.join(artifactsDir, fileName);

  // 3. Write 100% full original content
  fs.writeFileSync(absolutePath, output, "utf-8");

  // Relative path with forward slashes for cross-platform model readability
  const relPath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");

  // 4. Construct compact preview
  let headLines: string[];
  let tailLines: string[];
  let omittedLines: number;

  if (lines.length > PREVIEW_HEAD_LINES + PREVIEW_TAIL_LINES) {
    headLines = lines.slice(0, PREVIEW_HEAD_LINES);
    tailLines = lines.slice(-PREVIEW_TAIL_LINES);
    omittedLines = lines.length - PREVIEW_HEAD_LINES - PREVIEW_TAIL_LINES;
  } else {
    const half = Math.floor(lines.length / 2);
    headLines = lines.slice(0, half);
    tailLines = lines.slice(half);
    omittedLines = 0;
  }

  const noticeLines = [
    `... [工具输出过大已自动截断: 共 ${lines.length} 行 / ${output.length} 字符${omittedLines > 0 ? `，已省略中间 ${omittedLines} 行` : ""}] ...`,
    `... [完整输出已备份保存至工作区本地文件: ${relPath} (仅供本地审计归档)] ...`,
  ];

  const displayOutput = `${headLines.join("\n")}\n\n${noticeLines.join("\n")}\n\n${tailLines.join("\n")}`;

  return {
    displayOutput,
    persistedFile: relPath,
  };
}

/**
 * Smart buffer decoder that handles Windows OEM code pages (CP936/GBK) and UTF-8.
 * It first attempts strict UTF-8 decoding. If that fails, it decodes as GBK,
 * falling back to safe string representation without producing diamond question marks.
 */
export function smartDecodeBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) {
    return "";
  }

  // 1. Prioritize strict UTF-8 decoding
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    // 2. Fallback to GBK (standard Windows CP936 OEM code page)
    try {
      const gbkDecoder = new TextDecoder("gbk");
      const decoded = gbkDecoder.decode(buffer);
      return decoded.replace(/\uFFFD/g, "");
    } catch {
      // 3. Dual fault tolerance fallback
      return buffer.toString("utf-8").replace(/\uFFFD/g, "");
    }
  }
}

/**
 * Strips any residual Unicode replacement characters (\uFFFD / diamond question mark).
 */
export function sanitizeOutput(text: string): string {
  if (!text) return "";
  return text.replace(/\uFFFD/g, "");
}

/**
 * Internal stream chunk decoder with multi-byte boundary protection for UTF-8 and GBK.
 */
function decodeStreamChunk(buffer: Buffer): { text: string; remainder: Buffer } {
  if (!buffer || buffer.length === 0) {
    return { text: "", remainder: buffer };
  }

  // Check if entire buffer is valid UTF-8
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, remainder: Buffer.alloc(0) };
  } catch {
    // Buffer is not a complete, valid UTF-8 sequence
  }

  // Check if buffer is UTF-8 with an incomplete trailing sequence (1 to 3 bytes)
  for (let t = 1; t <= Math.min(3, buffer.length); t++) {
    const leadCandidate = buffer[buffer.length - t];
    let expectedBytes = 0;
    if (leadCandidate >= 0xc2 && leadCandidate <= 0xdf) expectedBytes = 2;
    else if (leadCandidate >= 0xe0 && leadCandidate <= 0xef) expectedBytes = 3;
    else if (leadCandidate >= 0xf0 && leadCandidate <= 0xf4) expectedBytes = 4;

    if (expectedBytes > t) {
      const prefix = buffer.subarray(0, buffer.length - t);
      if (prefix.length === 0) {
        return { text: "", remainder: buffer };
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(prefix);
        return { text, remainder: Buffer.from(buffer.subarray(buffer.length - t)) };
      } catch {
        // Prefix is not valid UTF-8, so this chunk is not UTF-8
        break;
      }
    }
  }

  // Check if buffer is GBK with an incomplete trailing lead byte
  let highCount = 0;
  for (let i = buffer.length - 1; i >= 0 && buffer[i] >= 0x81; i--) {
    highCount++;
  }

  if (highCount % 2 === 1) {
    // Odd trailing high bytes indicate the final byte is an incomplete lead byte
    const prefix = buffer.subarray(0, buffer.length - 1);
    const remainder = Buffer.from(buffer.subarray(buffer.length - 1));
    const text = prefix.length > 0 ? smartDecodeBuffer(prefix) : "";
    return { text, remainder };
  } else {
    // Complete GBK byte sequence
    const text = smartDecodeBuffer(buffer);
    return { text, remainder: Buffer.alloc(0) };
  }
}

/**
 * Extended BashOperations tagged with self-healing indicator.
 */
export interface SelfHealingBashOperations extends BashOperations {
  readonly isEncodingSelfHealing: boolean;
}

/**
 * Creates BashOperations wrapped with Windows encoding self-healing.
 * Intercepts stdout/stderr onData streams, decodes CP936/GBK into pure UTF-8 Buffer,
 * preventing Pi's OutputAccumulator from emitting \uFFFD diamond question marks.
 */
export function createEncodingSelfHealingBashOperations(
  options?: BashToolOptions,
  baseOps?: BashOperations,
): BashOperations {
  const underlyingOps = baseOps ?? createLocalBashOperations({ shellPath: options?.shellPath });

  const ops: SelfHealingBashOperations = {
    isEncodingSelfHealing: true,
    exec: async (command, cwd, execOptions) => {
      const isWindows = process.platform === "win32";
      // In Windows environment or when custom baseOps is explicitly supplied (e.g. testing)
      if (!isWindows && !baseOps) {
        return underlyingOps.exec(command, cwd, execOptions);
      }

      let leftover = Buffer.alloc(0);
      const originalOnData = execOptions.onData;

      const healingOnData = (chunk: Buffer) => {
        const combined = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
        const { text, remainder } = decodeStreamChunk(combined);
        leftover = remainder;
        if (text.length > 0) {
          originalOnData(Buffer.from(text, "utf-8"));
        }
      };

      const result = await underlyingOps.exec(command, cwd, {
        ...execOptions,
        onData: healingOnData,
      });

      if (leftover.length > 0) {
        const text = smartDecodeBuffer(leftover);
        if (text.length > 0) {
          originalOnData(Buffer.from(text, "utf-8"));
        }
        leftover = Buffer.alloc(0);
      }

      return result;
    },
  };

  return ops;
}

/**
 * ToolBridge coordinates between Copilot actions and native Pi tools.
 * It enforces slicing constraints, normalizes argument shapes, delegates execution
 * to Pi's industrial-grade tools, and formats results into standard Copilot context blocks.
 */
export class ToolBridge {
  private cwd: string;
  private tools: Map<string, Tool> = new Map();
  private onQuestion?: (action: MappedQuestionArgs) => Promise<string> | string;
  private ledger?: any;
  private defaultContext?: { role?: string; sessionId?: string };
  public readonly bashOperations?: BashOperations;

  constructor(options?: ToolBridgeOptions | string) {
    if (typeof options === "string") {
      this.cwd = options;
    } else {
      this.cwd = options?.cwd ?? process.cwd();
      this.onQuestion = options?.onQuestion;
      this.ledger = options?.ledger;
      this.defaultContext = options?.context;
    }

    const customTools = typeof options === "object" ? options?.tools : undefined;
    if (customTools) {
      if (Array.isArray(customTools)) {
        for (const t of customTools) {
          this.tools.set(t.name, t);
        }
      } else {
        for (const [name, t] of Object.entries(customTools)) {
          this.tools.set(name, t);
        }
      }
    } else {
      // Create native Pi coding tools with encoding self-healing bash operations
      const bashOps = createEncodingSelfHealingBashOperations();
      this.bashOperations = bashOps;
      const piTools = createCodingTools(this.cwd, {
        bash: { operations: bashOps },
      });
      for (const t of piTools) {
        this.tools.set(t.name, t);
      }
    }
  }

  public getBashOperations(): BashOperations | undefined {
    return this.bashOperations;
  }

  public getCwd(): string {
    return this.cwd;
  }

  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): Map<string, Tool> {
    return new Map(this.tools);
  }

  public getLedger(): any {
    return this.ledger;
  }

  public setLedger(ledger: any): void {
    this.ledger = ledger;
  }

  public recordToLedger(
    toolName: string,
    target: string,
    canonicalTool: string,
    success: boolean,
    output: string,
    context?: { role?: string; sessionId?: string }
  ): void {
    if (!this.ledger || typeof this.ledger.recordStep !== "function") return;
    try {
      const modifiedFiles =
        canonicalTool === "edit" || canonicalTool === "write" ? [target] : undefined;
      let statusBadge: string | undefined = undefined;
      if (canonicalTool === "bash") {
        const match = output.match(/(\d+\s*pass[^\n\r]*|\d+\s*fail[^\n\r]*|PASS[^\n\r]*|FAIL[^\n\r]*)/i);
        if (match) {
          statusBadge = match[1].slice(0, 30);
        }
      }
      this.ledger.recordStep({
        role: context?.role || this.defaultContext?.role || "main",
        sessionId: context?.sessionId || this.defaultContext?.sessionId || "main",
        tool: toolName,
        target,
        status: success ? "SUCCESS" : "FAILURE",
        modifiedFiles,
        statusBadge,
        briefSummary: output.slice(0, 200),
      });
    } catch {
      // 容错不中断
    }
  }

  /**
   * Maps a Copilot action into a normalized Pi tool call with safety slicing and parameter validation.
   */
  public mapAction(action: CopilotAction): MappedAction {
    const rawToolName = (action.tool ?? action.action ?? action.name ?? "").trim();
    if (!rawToolName) {
      throw new Error("Action is missing tool name");
    }

    const toolName = rawToolName.toLowerCase();

    // 1. read_file / read / cat
    if (toolName === "read_file" || toolName === "read" || toolName === "cat") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      const rawStart = action.start_line ?? action.offset ?? action.startLine ?? 1;
      const offset = Math.max(1, Number(rawStart) || 1);

      let requestedLines: number;
      const rawEnd = action.end_line ?? action.endLine;
      if (rawEnd !== undefined) {
        const endLine = Number(rawEnd);
        requestedLines = endLine >= offset ? endLine - offset + 1 : 1;
      } else if (action.limit !== undefined || action.lines !== undefined) {
        const rawLimit = Number(action.limit ?? action.lines);
        requestedLines = rawLimit > 0 ? rawLimit : MAX_READ_SLICE_LINES;
      } else {
        requestedLines = MAX_READ_SLICE_LINES;
      }

      // Enforce strict 100-line slice limit
      const limit = Math.min(requestedLines, MAX_READ_SLICE_LINES);

      const args: MappedReadArgs = {
        path,
        offset,
        limit,
      };

      return {
        canonicalTool: "read",
        target: path,
        args,
        originalAction: action,
      };
    }

    // 2. patch_file / edit / edit_file
    if (toolName === "patch_file" || toolName === "edit" || toolName === "edit_file") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      let edits: Array<{ oldText: string; newText: string }> = [];

      if (Array.isArray(action.edits) && action.edits.length > 0) {
        edits = action.edits.map((e) => ({
          oldText: e.oldText ?? e.old_string ?? e.old_text ?? "",
          newText: e.newText ?? e.new_string ?? e.new_text ?? "",
        }));
      } else {
        const oldText = action.old_string ?? action.oldText ?? action.old_text ?? "";
        const newText = action.new_string ?? action.newText ?? action.new_text ?? "";
        edits = [{ oldText, newText }];
      }

      const args: MappedEditArgs = {
        path,
        edits,
      };

      return {
        canonicalTool: "edit",
        target: path,
        args,
        originalAction: action,
      };
    }

    // 3. write_file / write
    if (toolName === "write_file" || toolName === "write") {
      const path = action.path ?? action.filePath ?? action.file ?? "";
      const content = action.content ?? "";

      const args: MappedWriteArgs = {
        path,
        content,
      };

      return {
        canonicalTool: "write",
        target: path,
        args,
        originalAction: action,
      };
    }

    // 4. run_command / bash / exec
    if (toolName === "run_command" || toolName === "bash" || toolName === "exec") {
      const command = action.command ?? action.cmd ?? "";
      const timeout = action.timeout !== undefined ? Number(action.timeout) : 30;

      const args: MappedBashArgs = {
        command,
        timeout,
      };

      return {
        canonicalTool: "bash",
        target: command,
        args,
        originalAction: action,
      };
    }

    // 5. ask_question / question
    if (toolName === "ask_question" || toolName === "question") {
      const question = action.question ?? action.prompt ?? "";
      const options = Array.isArray(action.options) ? action.options : undefined;

      const args: MappedQuestionArgs = {
        question,
        options,
      };

      return {
        canonicalTool: "question",
        target: question,
        args,
        originalAction: action,
      };
    }

    throw new Error(`Unsupported Copilot action: ${rawToolName}`);
  }

  public persistLargeOutputIfNeeded(output: string, toolName?: string): PersistOutputResult {
    return persistLargeOutputIfNeeded(output, this.cwd, toolName);
  }

  /**
   * Executes a mapped Copilot action on Pi native tools or the question callback,
   * returning structured details and formatted text.
   */
  public async executeAction(
    action: CopilotAction,
    signal?: AbortSignal,
    context?: { role?: string; sessionId?: string }
  ): Promise<ToolBridgeResult> {
    const rawActionName = action.tool ?? action.action ?? action.name ?? "unknown";
    let mapped: MappedAction;

    try {
      mapped = this.mapAction(action);
    } catch (err: any) {
      let output = err instanceof Error ? err.message : String(err);
      output = sanitizeOutput(output);
      const target = action.path ?? action.command ?? action.question ?? "unknown";
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target,
        success: false,
        output: persisted.displayOutput,
      });

      return {
        actionName: rawActionName,
        piToolName: "unknown",
        target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        persistedFile: persisted.persistedFile,
      };
    }

    // Question action handling
    if (mapped.canonicalTool === "question") {
      const qArgs = mapped.args as MappedQuestionArgs;
      try {
        let output = "";
        if (this.onQuestion) {
          const userAns = await this.onQuestion(qArgs);
          output = typeof userAns === "string" ? userAns : String(userAns ?? "");
        } else {
          output = `[Question prompted]: ${qArgs.question}` +
            (qArgs.options?.length ? `\nOptions: ${qArgs.options.join(", ")}` : "");
        }
        output = sanitizeOutput(output);
        const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);

        const formatted = this.formatResult({
          toolName: rawActionName,
          target: mapped.target,
          success: true,
          output: persisted.displayOutput,
        });

        return {
          actionName: rawActionName,
          piToolName: "question",
          target: mapped.target,
          success: true,
          output: persisted.displayOutput,
          rawOutput: output,
          formatted,
          mappedArgs: mapped.args,
          persistedFile: persisted.persistedFile,
        };
      } catch (err: any) {
        let output = err instanceof Error ? err.message : String(err);
        output = sanitizeOutput(output);
        const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
        const formatted = this.formatResult({
          toolName: rawActionName,
          target: mapped.target,
          success: false,
          output: persisted.displayOutput,
        });

        return {
          actionName: rawActionName,
          piToolName: "question",
          target: mapped.target,
          success: false,
          output: persisted.displayOutput,
          rawOutput: output,
          formatted,
          mappedArgs: mapped.args,
          persistedFile: persisted.persistedFile,
        };
      }
    }

    // Native Pi tool execution
    const tool = this.tools.get(mapped.canonicalTool);
    if (!tool) {
      let output = `Native Pi tool not available for action: ${mapped.canonicalTool}`;
      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
      });

      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile,
      };
    }

    const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const rawResult = await tool.execute(toolCallId, mapped.args as any, signal);
      const isError = Boolean(rawResult.isError);

      let output = "";
      if (rawResult.content && Array.isArray(rawResult.content)) {
        output = rawResult.content
          .map((c: any) => (c.type === "text" ? c.text : "[image]"))
          .join("\n");
      } else if (typeof rawResult.structuredContent === "string") {
        output = rawResult.structuredContent;
      } else if (
        rawResult.structuredContent &&
        typeof rawResult.structuredContent === "object" &&
        "output" in rawResult.structuredContent
      ) {
        output = String(rawResult.structuredContent.output);
      }

      // If edit tool produced diff and it's not already in the message, append it for Copilot inspectability
      if (mapped.canonicalTool === "edit" && rawResult.details?.diff && !output.includes(rawResult.details.diff)) {
        output += `\n\nDiff:\n${rawResult.details.diff}`;
      }

      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      const success = !isError;
      this.recordToLedger(rawActionName, mapped.target, mapped.canonicalTool, success, output, context);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success,
        output: persisted.displayOutput,
      });

      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        rawResult,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile,
      };
    } catch (err: any) {
      let output = err instanceof Error ? err.message : String(err);
      output = sanitizeOutput(output);
      const persisted = this.persistLargeOutputIfNeeded(output, rawActionName);
      this.recordToLedger(rawActionName, mapped?.target || "unknown", mapped?.canonicalTool || "unknown", false, output, context);
      const formatted = this.formatResult({
        toolName: rawActionName,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
      });

      return {
        actionName: rawActionName,
        piToolName: mapped.canonicalTool,
        target: mapped.target,
        success: false,
        output: persisted.displayOutput,
        rawOutput: output,
        formatted,
        mappedArgs: mapped.args,
        persistedFile: persisted.persistedFile,
      };
    }
  }

  /**
   * Formats a tool execution outcome into the standard Copilot context representation:
   *
   * 【TOOL_RESULT: <toolName> (<target>) - SUCCESS/FAILED】
   * <output>
   * 【END_TOOL_RESULT】
   */
  public formatResult(params: FormatResultParams | ToolBridgeResult): string {
    const toolName = "actionName" in params ? params.actionName : params.toolName;
    const target = params.target || "unknown";
    const status = params.success ? "SUCCESS" : "FAILED";
    let output = params.output ?? "";

    if (
      (output.length > MAX_INLINE_OUTPUT_CHARS || output.split(/\r?\n/).length > MAX_INLINE_OUTPUT_LINES) &&
      !output.includes(".cph/artifacts/tool-output-")
    ) {
      output = this.persistLargeOutputIfNeeded(output, toolName).displayOutput;
    }

    return `【TOOL_RESULT: ${toolName} (${target}) - ${status}】\n${output}\n【END_TOOL_RESULT】`;
  }

  /**
   * Formats a user response string into the standardized protocol format:
   * [USER_RESPONSE for ask_question]: <answer>
   */
  public static formatUserResponse(answer: string): string {
    if (!answer) return "[USER_RESPONSE for ask_question]:";
    return answer.startsWith("[USER_RESPONSE for ask_question]:")
      ? answer
      : `[USER_RESPONSE for ask_question]: ${answer}`;
  }

  public formatUserResponse(answer: string): string {
    return ToolBridge.formatUserResponse(answer);
  }
}

