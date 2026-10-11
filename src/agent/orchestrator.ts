import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AccountPool } from "../auth/account-pool.ts";
import { ChatHubClient } from "../transport/chathub-client.ts";
import {
  SubstrateUploader,
  type UploadDocumentResult,
} from "../transport/substrate-uploader.ts";
import type { AttachmentAnnotation } from "../transport/types.ts";
import {
  ToolBridge,
  type CopilotAction,
  type ToolBridgeResult,
} from "../protocol/tool-bridge.ts";
import { PromptBuilder } from "../protocol/prompt-builder.ts";
import { ResilientParser } from "../protocol/resilient-parser.ts";
import { CompactionService, type TurnRecord } from "./compaction.ts";
import { BlackboxCompactor } from "./blackbox-compactor.ts";
import { RefusalGuard } from "./refusal-guard.ts";
import type { Skill } from "../skills/skill-loader.ts";
import { SkillRegistry } from "../skills/skill-registry.ts";
import { SubagentRunner } from "./subagent-runner.ts";
import { SessionLineageTracker } from "../session/lineage-tracker.ts";

export interface IAccountPool {
  markThrottled(email: string, durationMs?: number): void;
  getNextAvailableToken(options?: any): Promise<any>;
  refreshAccountList?(): any[];
  getPoolStatus?(): any[];
  [key: string]: any;
}

export interface IOrchestratorChatClient {
  sendMessage(
    params: {
      text: string;
      conversationId?: string;
      sessionId?: string;
      requestId?: string;
      signal?: AbortSignal;
      [key: string]: any;
    },
    callbacks?: {
      onDelta?: (delta: { type: string; content: string }) => void;
      onRateLimitDetected?: (email: string) => Promise<void> | void;
      [key: string]: any;
    }
  ): Promise<{ text: string; reasoning?: string }>;
}

export interface OrchestratorOptions {
  workspaceRoot?: string;
  maxTurns?: number;
  maxRefusalRetries?: number;
  modelTone?: string;
  pool?: AccountPool | IAccountPool;
  bridge?: ToolBridge;
  chatClient?: IOrchestratorChatClient;
  client?: IOrchestratorChatClient;
  arbitratorChatClient?: IOrchestratorChatClient;
  chatClientFactory?: (
    token: any,
    options: { modelTone?: string; customAgentId?: string }
  ) => IOrchestratorChatClient;
  activeSkills?: Skill[] | string;
  isHandshakePending?: boolean;
  customAgentId?: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  subagentRunner?: SubagentRunner | any;
  sessionId?: string;
  enableInSessionCompaction?: boolean;
  graphTokenProvider?: () => Promise<string>;
  enableCloudAttachment?: boolean;
  cloudAttachmentThresholdChars?: number;
  cloudAttachmentThresholdLines?: number;
  lineageTracker?: SessionLineageTracker;
}

export type CopilotOrchestratorOptions = OrchestratorOptions;

export interface OrchestratorEvents {
  onDelta?: (delta: string) => void;
  onReasoning?: (reasoning: string) => void;
  onTurnStart?: (turn: number) => void;
  onTurnEnd?: (turn: number, response: string) => void;
  onToolStart?: (action: CopilotAction) => void;
  onToolEnd?: (result: ToolBridgeResult) => void;
  onSubagentStart?: (id: string, role: string, spec: any) => void;
  onSubagentEnd?: (report: any) => void;
  onAccountSwitched?: (oldEmail: string, newEmail: string) => void;
  onRefusalIntercepted?: (refusalText: string, retryAttempt: number) => void;
  onCompacted?: (clearedChars: number, ratio: number) => void;
  onCompleted?: (finalAnswer: string) => void;
  onError?: (err: Error) => void;
  onHandoff?: (snapshot: string, handoffDocPath?: string) => void;
  onDisasterOccurred?: (blackbox: string, lastError: string) => void | Promise<void>;
  onArbitratorHandoffStart?: (arbitratorSessionId: string, accountEmail: string) => void | Promise<void>;
  onArbitratorHandoffComplete?: (handoffDocPath: string, arbitratorSessionId: string) => void | Promise<void>;
  onAttachmentUploaded?: (attachment: UploadDocumentResult, toolName: string) => void;
}

export interface OrchestratorRunOptions {
  task: string;
  signal?: AbortSignal;
  events?: OrchestratorEvents;
  activeSkills?: Skill[] | string;
  sessionId?: string;
  arbitratorChatClient?: IOrchestratorChatClient;
}

export interface OrchestratorRunResult {
  finalAnswer: string;
  turnsCount: number;
  completed: boolean;
  history: TurnRecord[];
  handedOff?: boolean;
  handoffSnapshot?: string;
  handoffDocPath?: string;
  disasterRecovered?: boolean;
  disasterBlackbox?: string;
  arbitratorSessionId?: string;
  lastPartialOutput?: {
    reasoning?: string;
    response?: string;
  };
}

export class Orchestrator {
  private workspaceRoot: string;
  private maxTurns: number;
  private maxRefusalRetries: number;
  private modelTone: string;
  private pool?: AccountPool | IAccountPool;
  private bridge: ToolBridge;
  private chatClient?: IOrchestratorChatClient;
  private arbitratorChatClient?: IOrchestratorChatClient;
  private chatClientFactory?: (
    token: any,
    options: { modelTone?: string; customAgentId?: string }
  ) => IOrchestratorChatClient;
  private activeSkills?: Skill[] | string;
  public customAgentId?: string;
  public coderAgentId?: string;
  public researcherAgentId?: string;
  private subagentRunner?: SubagentRunner | any;
  private enableInSessionCompaction: boolean = false;
  private graphTokenProvider?: () => Promise<string>;
  private enableCloudAttachment: boolean = true;
  private cloudAttachmentThresholdChars: number = 0;
  private cloudAttachmentThresholdLines: number = 0;
  private lineageTracker: SessionLineageTracker;

  // Handshake State Machine
  public isHandshakePending: boolean = true;
  private pendingTask: string = "";
  private pendingSkills: string = "";
  private conversationId: string = crypto.randomUUID();
  private sessionId: string;
  private lastHandoffDocPath?: string;

  constructor(options: OrchestratorOptions = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.maxTurns = options.maxTurns ?? 30;
    this.maxRefusalRetries = options.maxRefusalRetries ?? 3;
    this.modelTone = options.modelTone ?? "Gpt_61_Sol_Reasoning";
    this.pool = options.pool;
    this.bridge = options.bridge || new ToolBridge(this.workspaceRoot);
    this.chatClient = options.chatClient || options.client;
    this.arbitratorChatClient = options.arbitratorChatClient;
    this.chatClientFactory = options.chatClientFactory;
    this.activeSkills = options.activeSkills;
    this.customAgentId = options.customAgentId;
    this.coderAgentId = options.coderAgentId;
    this.researcherAgentId = options.researcherAgentId;
    this.subagentRunner = options.subagentRunner;
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.enableInSessionCompaction = options.enableInSessionCompaction ?? false;
    this.graphTokenProvider = options.graphTokenProvider;
    this.enableCloudAttachment = options.enableCloudAttachment ?? true;
    this.cloudAttachmentThresholdChars = options.cloudAttachmentThresholdChars ?? 0;
    this.cloudAttachmentThresholdLines = options.cloudAttachmentThresholdLines ?? 0;
    this.lineageTracker = options.lineageTracker || new SessionLineageTracker();
    this.isHandshakePending =
      options.isHandshakePending !== undefined
        ? options.isHandshakePending
        : !this.customAgentId;
  }

  public getLineageTracker(): SessionLineageTracker {
    return this.lineageTracker;
  }

  public linkSuccessor(oldId: string, newId: string): void {
    this.lineageTracker.register({
      sessionId: newId,
      role: "main",
      status: "active",
      predecessorId: oldId,
    });
    this.lineageTracker.linkSuccessor(oldId, newId);
  }

  /**
   * Acquire a Microsoft Graph access token from provider or account pool
   */
  public async acquireGraphToken(): Promise<string | undefined> {
    if (this.graphTokenProvider) {
      try {
        return await this.graphTokenProvider();
      } catch {
        return undefined;
      }
    }
    if (this.pool && typeof (this.pool as any).getGraphAccessToken === "function") {
      try {
        return await (this.pool as any).getGraphAccessToken();
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  public getLastHandoffDocPath(): string | undefined {
    return this.lastHandoffDocPath;
  }

  public getBridge(): ToolBridge {
    return this.bridge;
  }

  public getActiveSkills(): Skill[] | string | undefined {
    return this.activeSkills;
  }

  public setActiveSkills(skills?: Skill[] | string): void {
    this.activeSkills = skills;
  }

  public getIsHandshakePending(): boolean {
    return this.isHandshakePending;
  }

  public getCustomAgentId(): string | undefined {
    return this.customAgentId;
  }

  public setCustomAgentId(agentId?: string): void {
    this.customAgentId = agentId;
    this.isHandshakePending = !agentId;
  }

  public resetHandshake(): void {
    this.isHandshakePending = !this.customAgentId;
    this.pendingTask = "";
    this.pendingSkills = "";
    this.conversationId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    this.lastHandoffDocPath = undefined;
  }

  private formatSkillsSection(skills?: Skill[] | string): string {
    if (!skills) return "";
    if (typeof skills === "string") return skills;
    if (Array.isArray(skills)) {
      if (skills.length === 0) return "";
      const registry = new SkillRegistry();
      return registry.buildPromptSection(skills);
    }
    return "";
  }

  /**
   * Runs an autonomous closed-loop programming task.
   */
  public async run(options: OrchestratorRunOptions): Promise<OrchestratorRunResult> {
    const { task, signal, events } = options;

    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    const sessionId = options.sessionId || this.sessionId;
    this.sessionId = sessionId;
    const conversationId = this.conversationId;

    // Register active main session in lineage tracker
    this.lineageTracker.register({
      sessionId: this.sessionId,
      role: "main",
      status: "active",
    });

    // Initialize or resolve ChatHub client
    let client = this.chatClient;
    if (!client) {
      const pool = this.pool || new AccountPool();
      this.pool = pool;
      try {
        const token = await pool.getNextAvailableToken(
          this.customAgentId ? { forAgentId: this.customAgentId } : undefined
        );
        client = this.chatClientFactory
          ? this.chatClientFactory(token, {
              modelTone: this.modelTone,
              customAgentId: this.customAgentId,
            })
          : new ChatHubClient(token, {
              modelTone: this.modelTone,
              customAgentId: this.customAgentId,
            });
      } catch (err: any) {
        if (this.isRateLimitError(err)) {
          return await this.executeDisasterRecoveryArbitration({
            task,
            history: [],
            client: client as any,
            lastError: String(err?.message || err),
            signal,
            events,
            sessionId,
            arbitratorChatClient: options.arbitratorChatClient,
          });
        }
        throw err;
      }
    }

    // 1. Gather objective facts for Turn 1 Grounding
    const gitFacts = this.collectGitFacts();
    const dirTree = this.collectDirTreePreview();

    // Resolve skills to inject into prompt
    const skillsToUse =
      options.activeSkills !== undefined ? options.activeSkills : this.activeSkills;
    const skillsSection = this.formatSkillsSection(skillsToUse);

    let currentPrompt: string;
    if (this.customAgentId) {
      // Direct Mode for Custom Agent (CPH-Dev): bypass handshake, send task directly
      currentPrompt = PromptBuilder.buildDirectAgentPrompt(
        this.workspaceRoot,
        task,
        skillsSection
      );
    } else if (this.isHandshakePending) {
      // Turn 1 Grounding Handshake (Pure: NO task, NO skillsSection)
      this.pendingTask = task;
      this.pendingSkills = skillsSection;
      currentPrompt = PromptBuilder.buildHandshakePrompt(
        this.workspaceRoot,
        gitFacts,
        dirTree
      );
    } else {
      // Follow-up task in active session: advance directly without repeating handshake
      currentPrompt = PromptBuilder.buildTurn1Prompt({
        workspaceRoot: this.workspaceRoot,
        gitFacts,
        dirTree,
        task,
        skillsSection,
      });
    }

    const history: TurnRecord[] = [];
    let refusalRetries = 0;
    let turn = 1;
    let currentAnnotations: AttachmentAnnotation[] = [];

    while (turn <= this.maxTurns) {
      if (signal?.aborted) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      if (turn === this.maxTurns - 1 && !this.isHandshakePending && refusalRetries === 0) {
        currentPrompt = PromptBuilder.buildHandoffPreparationPrompt(
          this.pendingTask || task,
          options.sessionId || this.sessionId
        );
      }

      events?.onTurnStart?.(turn);
      const requestId = crypto.randomUUID();

      let turnResponseText = "";
      let turnReasoningText = "";

      try {
        const res = await client.sendMessage(
          {
            text: currentPrompt,
            conversationId,
            sessionId,
            requestId,
            signal,
            annotations: currentAnnotations.length > 0 ? currentAnnotations : undefined,
          },
          {
            onDelta: (delta: { type: string; content: string }) => {
              if (delta.type === "reasoning") {
                turnReasoningText += delta.content;
                events?.onReasoning?.(delta.content);
              } else if (delta.type === "text") {
                turnResponseText += delta.content;
                events?.onDelta?.(delta.content);
              }
            },
            onRateLimitDetected: async (email: string) => {
              if (this.pool) {
                this.pool.markThrottled(email);
                const nextToken = await this.pool.getNextAvailableToken();
                events?.onAccountSwitched?.(email, nextToken.email);
                client = new ChatHubClient(nextToken, {
                  modelTone: this.modelTone,
                  customAgentId: this.customAgentId,
                });
              }
            },
          }
        );

        turnResponseText = res.text;
        currentAnnotations = [];
      } catch (err: any) {
        if (signal?.aborted || err?.name === "AbortError" || err?.message?.includes("aborted")) {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          throw abortError;
        }

        if (this.isRecoverableTransportError(err)) {
          if (turnReasoningText || turnResponseText) {
            history.push({
              turn,
              userInput: currentPrompt,
              thought: turnReasoningText,
              response: turnResponseText,
              error: String(err?.message || err),
            });
          }
          return await this.executeDisasterRecoveryArbitration({
            task,
            history,
            client,
            lastError: String(err?.message || err),
            signal,
            events,
            sessionId,
            arbitratorChatClient: options.arbitratorChatClient,
            lastPartialOutput:
              turnReasoningText || turnResponseText
                ? {
                    reasoning: turnReasoningText,
                    response: turnResponseText,
                  }
                : undefined,
          });
        }

        events?.onError?.(err);
        throw err;
      }

      // Check if turnResponseText indicates a rate limit / termination frame
      if (this.isRateLimitResponseText(turnResponseText)) {
        return await this.executeDisasterRecoveryArbitration({
          task,
          history,
          client,
          lastError: turnResponseText,
          signal,
          events,
          sessionId,
          arbitratorChatClient: options.arbitratorChatClient,
        });
      }

      // 2. RefusalGuard check: detect sandbox refusal hallucinations
      if (RefusalGuard.detectRefusal(turnResponseText)) {
        events?.onRefusalIntercepted?.(turnResponseText, refusalRetries + 1);

        if (RefusalGuard.shouldRetry(refusalRetries, this.maxRefusalRetries)) {
          refusalRetries++;
          const strategy = RefusalGuard.getRetryStrategy(refusalRetries, {
            workspaceRoot: this.workspaceRoot,
            candidateFile: "package.json",
          });

          if (strategy.shouldSwitchAccount && this.pool) {
            try {
              const currentEmail = (client as any)?.token?.email || "";
              if (currentEmail) this.pool.markThrottled(currentEmail);
              const nextToken = await this.pool.getNextAvailableToken();
              events?.onAccountSwitched?.(currentEmail, nextToken.email);
              client = new ChatHubClient(nextToken, {
                modelTone: this.modelTone,
                customAgentId: this.customAgentId,
              });
            } catch {
              // Pool exhausted or single account; proceed with prompt retry
            }
          }

          currentPrompt = strategy.rewrittenPrompt;
          continue; // Re-attempt turn with correction prompt without incrementing loop turn
        }
      }

      // Reset consecutive refusal counter on non-refusal response
      refusalRetries = 0;

      // 3. Parse output using ResilientParser
      const parsed = ResilientParser.parse(turnResponseText);

      // Case 3a: FINAL_ANSWER achieved
      if (parsed.type === "final_answer") {
        if (this.isHandshakePending) {
          // Model attempted to answer before executing grounding handshake action
          history.push({
            turn,
            userInput: currentPrompt,
            thought: parsed.thought || turnReasoningText,
            response: turnResponseText,
          });
          currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]\n\n${PromptBuilder.PROTOCOL_REMINDER}`;
          events?.onTurnEnd?.(turn, turnResponseText);
          turn++;
          continue;
        }

        const finalAnswer = parsed.answer.summary || parsed.answer.raw;
        history.push({
          turn,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText,
        });

        events?.onTurnEnd?.(turn, turnResponseText);
        events?.onCompleted?.(finalAnswer);

        return {
          finalAnswer,
          turnsCount: turn,
          completed: true,
          history,
          handedOff: false,
        };
      }

      // Case 3b: Action invoked
      if (parsed.type === "action") {
        events?.onToolStart?.(parsed.action);

        let toolResult: ToolBridgeResult;

        if (parsed.action.tool === "invoke_subagent") {
          const runner =
            this.subagentRunner ||
            new SubagentRunner({
              workspaceRoot: this.workspaceRoot,
              mainSessionId: this.sessionId,
              coderAgentId: this.coderAgentId,
              researcherAgentId: this.researcherAgentId,
              pool: this.pool,
              chatClientFactory: this.chatClientFactory,
              modelTone: this.modelTone,
              lineageTracker: this.lineageTracker,
            });

          const subagents = (parsed.action as any).subagents || [];
          const reports = await runner.executeBatch(subagents, signal, {
            onSubagentStart: events?.onSubagentStart,
            onSubagentEnd: events?.onSubagentEnd,
          });

          const summaryOutput = runner.formatReportSummary(reports);
          toolResult = {
            actionName: "invoke_subagent",
            piToolName: "subagent",
            target: `${reports.length} subagents`,
            success: reports.every((r: any) => r.success),
            output: summaryOutput,
            formatted: summaryOutput,
          };
        } else {
          toolResult = await this.bridge.executeAction(parsed.action, signal);
        }

        events?.onToolEnd?.(toolResult);

        // Check and trigger cloud document attachment upload for tool outputs (aggressive upload policy to avoid encoding corruption and chat bloat)
        let uploadedAttachment: UploadDocumentResult | null = null;
        const rawContent = toolResult.rawOutput || toolResult.output || "";
        const lineCount = rawContent.split(/\r?\n/).length;
        const charCount = rawContent.length;
        const shouldUpload =
          this.enableCloudAttachment &&
          toolResult.success &&
          charCount > 0 &&
          (this.cloudAttachmentThresholdChars === 0 && this.cloudAttachmentThresholdLines === 0
            ? true
            : charCount > this.cloudAttachmentThresholdChars ||
              lineCount > this.cloudAttachmentThresholdLines);

        if (shouldUpload) {
          try {
            const graphToken = await this.acquireGraphToken();
            if (graphToken) {
              const actionTag = (parsed.action.tool || toolResult.actionName || "tool").replace(/[^a-zA-Z0-9_-]/g, "_");
              const uploadFileName = `tool-result-${actionTag}-${Date.now()}.txt`;
              uploadedAttachment = await SubstrateUploader.uploadDocumentToOneDrive(
                graphToken,
                rawContent,
                uploadFileName
              );
              currentAnnotations = [uploadedAttachment.annotation];
              events?.onAttachmentUploaded?.(uploadedAttachment, parsed.action.tool || toolResult.actionName);
            }
          } catch (uploadErr) {
            // Upload failure must not crash agent; gracefully fallback to inline prompt
          }
        }

        const currentTurnRecord: TurnRecord = {
          turn,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText,
          action: parsed.action,
          toolName: toolResult.actionName || parsed.action.tool,
          toolOutput: rawContent,
          success: toolResult.success,
        };
        history.push(currentTurnRecord);

        // 4. Two-turn sliding compaction (Disabled by default to preserve 100% full execution truth within active session)
        if (this.enableInSessionCompaction && history.length > 2) {
          const compaction = CompactionService.compactTurns(history, {
            preserveRecentTurns: 2,
          });
          if (compaction.clearedCharsCount > 0) {
            events?.onCompacted?.(
              compaction.clearedCharsCount,
              compaction.compressionRatio
            );
          }
        }

        // Prepare next turn prompt
        if (this.isHandshakePending) {
          this.isHandshakePending = false;
          if (uploadedAttachment) {
            currentPrompt = PromptBuilder.buildTurn2TaskPromptWithAttachment(
              this.pendingTask,
              this.pendingSkills,
              parsed.action.tool || toolResult.actionName,
              uploadedAttachment.fileName,
              { lineCount, charCount }
            );
          } else {
            currentPrompt = PromptBuilder.buildTurn2TaskPrompt(
              this.pendingTask,
              this.pendingSkills,
              toolResult.output,
              parsed.action.tool || toolResult.actionName
            );
          }
        } else {
          if (uploadedAttachment) {
            currentPrompt = PromptBuilder.buildAttachedToolResultPrompt(
              parsed.action.tool || toolResult.actionName,
              uploadedAttachment.fileName,
              { lineCount, charCount }
            );
          } else {
            currentPrompt = PromptBuilder.buildToolResultPrompt(
              parsed.action.tool || toolResult.actionName,
              toolResult.success,
              toolResult.output,
              toolResult.success ? undefined : toolResult.output
            );
          }
        }

        events?.onTurnEnd?.(turn, turnResponseText);
        turn++;
        continue;
      }

      // Case 3c: Invalid chatter
      history.push({
        turn,
        userInput: currentPrompt,
        thought: parsed.thought || turnReasoningText,
        response: turnResponseText,
      });

      if (this.isHandshakePending) {
        currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]\n\n${PromptBuilder.PROTOCOL_REMINDER}`;
      } else {
        currentPrompt = `${parsed.warning}\n${PromptBuilder.PROTOCOL_REMINDER}`;
      }
      events?.onTurnEnd?.(turn, turnResponseText);
      turn++;
    }

    const targetSessionId = options.sessionId || this.sessionId;
    const handoffSnapshot = this.generateHandoffSnapshot(task, history, targetSessionId);
    const handoffDocPath = this.lastHandoffDocPath;
    events?.onHandoff?.(handoffSnapshot, handoffDocPath);

    return {
      finalAnswer: "Max turns reached without final answer.",
      turnsCount: turn - 1,
      completed: false,
      history,
      handedOff: true,
      handoffSnapshot,
      handoffDocPath,
    };
  }

  /**
   * Helper to extract key error message from tool output without context bloat.
   */
  private extractKeyError(output: string): string {
    if (!output) return "（无错误输出）";
    const lines = output.split(/\r?\n/);
    const keyLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (
        /error|exception|failed|fatal|cannot find|not found|denied|未找到|失败|TypeNotFound|CommandNotFound|InvalidOperation|ExitCode|No \.NET/i.test(
          line
        )
      ) {
        keyLines.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
        if (keyLines.length >= 4) break;
      }
    }

    if (keyLines.length > 0) {
      return keyLines.join("\n");
    }

    // Fallback: take head of output
    const cleanOutput = output.trim().replace(/\r?\n/g, " ");
    return cleanOutput.length > 200 ? `${cleanOutput.slice(0, 197)}...` : cleanOutput;
  }

  /**
   * Generates a 5-dimensional high-fidelity structured handoff document,
   * summarizing task goals, verified facts, critical blockers, file modifications, and actionable next steps.
   * Automatically persists document to <workspaceRoot>/.cph/handoffs/handoff-<sessionId>.md.
   */
  public generateHandoffSnapshot(
    task: string,
    history: TurnRecord[],
    sessionId?: string
  ): string {
    const effectiveSessionId = sessionId || this.sessionId;
    const cleanTask =
      task || this.pendingTask || (history[0]?.userInput ? history[0].userInput : "未指定任务需求");

    // 0. File-First Handoff: if the model has already written the handoff document directly via write_file,
    // honor and return the model's authentic document without secondary wrapping!
    if (effectiveSessionId && this.workspaceRoot) {
      try {
        const docPath = path.join(this.workspaceRoot, ".cph", "handoffs", `handoff-${effectiveSessionId}.md`);
        if (fs.existsSync(docPath)) {
          const existingDoc = fs.readFileSync(docPath, "utf8").trim();
          if (existingDoc.length > 50) {
            this.lastHandoffDocPath = docPath;
            return existingDoc;
          }
        }
      } catch {
        // Fallback to synthesizing snapshot
      }
    }

    // Module 1: 【任务目标与原始需求】
    const taskSection = [
      `- **原始任务**: ${cleanTask}`,
      `- **工作区根目录**: \`${this.workspaceRoot}\``,
      effectiveSessionId ? `- **会话标识**: \`${effectiveSessionId}\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Module 2: 【已验证客观事实与阶段性成果】
    const executedActions: string[] = [];
    const recentFindings: string[] = [];
    const successfulRecords = history.filter((h) => h.toolName && h.success !== false);
    const readFiles = new Set<string>();
    const executedCmds: string[] = [];
    let editWriteCount = 0;

    for (const record of history) {
      if (record.toolName) {
        let details = "";
        if (record.action?.command) {
          details = ` \`${record.action.command.length > 80 ? `${record.action.command.slice(0, 77)}...` : record.action.command}\``;
        } else if (record.action?.path || record.action?.filePath) {
          details = ` \`${record.action.path || record.action.filePath}\``;
        }
        const status = record.success !== false ? "成功" : "失败";
        executedActions.push(`- Turn ${record.turn}: [${status}] ${record.toolName}${details}`);
      }
      if (record.toolOutput) {
        const cleanOutput = record.toolOutput.trim().replace(/\r?\n/g, " ");
        const preview = cleanOutput.length > 120 ? `${cleanOutput.slice(0, 117)}...` : cleanOutput;
        recentFindings.push(`- Turn ${record.turn} (${record.toolName || "tool"}): ${preview}`);
      }
    }

    for (const r of successfulRecords) {
      const tool = (r.toolName || r.action?.tool || "").toLowerCase();
      const filePath = r.action?.path || r.action?.filePath || r.action?.file;
      if (["read_file", "read", "cat"].includes(tool) && filePath) {
        readFiles.add(filePath);
      } else if (["edit", "edit_file", "patch_file", "write", "write_file"].includes(tool)) {
        editWriteCount++;
      } else if (["run_command", "bash", "exec"].includes(tool)) {
        if (r.action?.command) {
          executedCmds.push(r.action.command);
        }
      }
    }

    let verifiedFactsSection = "";
    if (history.length === 0) {
      verifiedFactsSection = `- （暂无已执行的物理动作成果）\n\n**已执行动作清单**:\n- 无已执行的物理工具调用\n\n**最近工具发现与上下文**:\n- 暂无显著工具发现`;
    } else {
      const parts: string[] = [];

      if (successfulRecords.length > 0) {
        parts.push(
          `- **物理工具执行汇总**: 共成功执行 ${successfulRecords.length} 项动作（读取 ${readFiles.size} 处、修改/创建 ${editWriteCount} 处、运行命令 ${executedCmds.length} 次）`
        );

        if (readFiles.size > 0) {
          parts.push(`- **已成功读取/探测的项目模块**:`);
          for (const file of Array.from(readFiles).slice(0, 15)) {
            parts.push(`  - \`${file}\``);
          }
        }

        if (executedCmds.length > 0) {
          parts.push(`- **已验证执行的基准命令**:`);
          for (const cmd of executedCmds.slice(0, 8)) {
            const preview = cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd;
            parts.push(`  - \`${preview}\``);
          }
        }

        const insightfulThoughts = history
          .filter((h) => h.thought && /(盘点|验证|确认|发现|成功|完成)/.test(h.thought))
          .map((h) => h.thought!.trim());
        if (insightfulThoughts.length > 0) {
          parts.push(`- **关键阶段性结论与发现**:`);
          for (const thought of insightfulThoughts.slice(-3)) {
            const preview = thought.length > 120 ? `${thought.slice(0, 117)}...` : thought;
            parts.push(`  - ${preview}`);
          }
        }
      } else if (executedActions.length === 0) {
        parts.push(`- （暂无已执行的物理动作成果；已完成 ${history.length} 轮对话探索研讨）`);
      }

      // Preserve actions list and recent findings for backward compatibility and full auditability
      parts.push(``);
      parts.push(`**已执行动作清单**:`);
      parts.push(executedActions.length > 0 ? executedActions.join("\n") : "- 无已执行的物理工具调用");
      parts.push(``);
      parts.push(`**最近工具发现与上下文**:`);
      parts.push(recentFindings.length > 0 ? recentFindings.slice(-5).join("\n") : "- 暂无显著工具发现");

      verifiedFactsSection = parts.join("\n");
    }

    // Module 3: 【关键卡点、报错与最新诊断】
    const failedRecords = history.filter((h) => h.toolName && h.success === false);
    let blockersSection = "";

    if (failedRecords.length === 0) {
      blockersSection = `- （当前会话运行健康，无关键错误卡点与失败调用）`;
    } else {
      const parts: string[] = [
        `- **卡点与失败动作清单** (共 ${failedRecords.length} 次执行失败):`,
      ];

      for (const h of failedRecords.slice(-5)) {
        const target = h.action?.command
          ? `\`${h.action.command.length > 80 ? `${h.action.command.slice(0, 77)}...` : h.action.command}\``
          : h.action?.path
          ? `\`${h.action.path}\``
          : "";
        parts.push(`  - **Turn ${h.turn} [${h.toolName || "tool"}]** ${target}:`);
        const keyErr = this.extractKeyError(h.toolOutput || "");
        for (const errLine of keyErr.split("\n")) {
          parts.push(`    > ${errLine}`);
        }
      }

      const allFailedText = failedRecords
        .map((f) => `${f.toolOutput || ""} ${f.thought || ""}`)
        .join(" ");

      const envIssues: string[] = [];
      if (
        /\.net\s+sdk|dotnet/i.test(allFailedText) &&
        /not\s+found|missing|no \.net|0x80070005|failed/i.test(allFailedText)
      ) {
        envIssues.push("环境卡点: 缺少 .NET SDK 8 环境或安装中断，导致相关组件构建受阻");
      }
      if (/winget/i.test(allFailedText) && /failed|error|denied|提权|0x80070005/i.test(allFailedText)) {
        envIssues.push("包管理卡点: winget 自动化安装受提权或系统策略限制中断");
      }
      if (/access is denied|0x80070005/i.test(allFailedText)) {
        envIssues.push("权限卡点: 操作系统权限拒绝 (Access is denied)");
      }
      if (/\[System\.IO\.Path\\\]|TypeName|TypeNotFound/i.test(allFailedText)) {
        envIssues.push("脚本语法卡点: PowerShell 转义或类型名称格式错误");
      }

      if (envIssues.length > 0) {
        parts.push(`- **识别的环境与系统卡点特征**:`);
        for (const issue of envIssues) {
          parts.push(`  - ⚠️ ${issue}`);
        }
      }

      const diagnosticThoughts = history
        .filter((h) => h.thought && /(提权|缺失|无法|失败|原因|由于|检测到|卡点)/.test(h.thought))
        .map((h) => h.thought!.trim());
      if (diagnosticThoughts.length > 0) {
        parts.push(`- **模型最新诊断原因分析**:`);
        for (const d of diagnosticThoughts.slice(-3)) {
          const preview = d.length > 140 ? `${d.slice(0, 137)}...` : d;
          parts.push(`  - ${preview}`);
        }
      }

      blockersSection = parts.join("\n");
    }

    // Module 4: 【已修改/生成文件清单】
    const modifiedFiles = new Map<string, string>();
    for (const h of history) {
      const tool = (h.toolName || h.action?.tool || "").toLowerCase();
      const filePath = h.action?.path || h.action?.filePath || h.action?.file;
      if (["edit", "edit_file", "patch_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已修改 (edit)");
      } else if (["write", "write_file"].includes(tool) && filePath) {
        modifiedFiles.set(filePath, "已创建 (write_file)");
      } else if (["run_command", "bash"].includes(tool) && h.action?.command) {
        const cmd = h.action.command;
        const redirMatch = cmd.match(/>\s*['"]?([^'">\s|&;]+\.[a-zA-Z0-9]+)['"]?/);
        if (redirMatch && redirMatch[1]) {
          modifiedFiles.set(redirMatch[1], "重定向输出生成");
        }
      }
    }

    let modifiedFilesSection = "";
    if (modifiedFiles.size === 0) {
      modifiedFilesSection = `- （会话期间未修改或新建文件，主要为只读探测）`;
    } else {
      const parts: string[] = [];
      for (const [p, status] of modifiedFiles.entries()) {
        parts.push(`- \`${p}\` (${status})`);
      }
      modifiedFilesSection = parts.join("\n");
    }

    // Module 5: 【接力第一优先级待办事项 (Actionable Next Steps)】
    let nextStepsSection = "";
    const nextSteps: string[] = [];

    if (failedRecords.length > 0) {
      const lastFailed = failedRecords[failedRecords.length - 1];
      const lastCmd =
        lastFailed.action?.command || lastFailed.action?.path || lastFailed.toolName || "未知动作";
      const shortCmd = lastCmd.length > 60 ? `${lastCmd.slice(0, 57)}...` : lastCmd;
      nextSteps.push(
        `1. **第一优先级 (立即执行/优先处理)**: 针对 Turn ${lastFailed.turn} 的关键卡点（\`${shortCmd}\`），优先解决依赖或报错。`
      );

      const allFailedText = failedRecords
        .map((f) => `${f.toolOutput || ""} ${f.thought || ""}`)
        .join(" ");
      if (/\.net|dotnet|winget/i.test(allFailedText)) {
        nextSteps.push(
          `   - **环境修复指引**: 检测到 .NET SDK / winget 安装或提权受阻，建议优先采用免安装 zip 包、已有运行时路径或由外部环境提供支持，切勿盲目重复调用 winget。`
        );
      }
      nextSteps.push(
        `2. **接力执行剩余需求**: 依赖或卡点解除后，接续完成未完成的原始需求：${cleanTask}`
      );
    } else {
      const lastRecord = history[history.length - 1];
      nextSteps.push(
        `1. **第一优先级 (立即执行)**: 当前所有前序动作均已验证成功，无关键卡点，直接推进下一阶段核心交付。`
      );
      if (lastRecord?.thought) {
        const shortThought =
          lastRecord.thought.length > 80
            ? `${lastRecord.thought.slice(0, 77)}...`
            : lastRecord.thought;
        nextSteps.push(`   - 接续最新思绪进度: "${shortThought}"`);
      }
      nextSteps.push(`2. **接续完成目标**: 围绕原始任务目标【${cleanTask}】继续执行。`);
    }

    nextSteps.push(
      `- **避坑提示**: 请勿重复执行前序已验证成功的步骤与文件探测，直接基于上述已验证客观事实推进。`
    );
    nextStepsSection = [
      `**接力建议**: 请接续上方成果与状态，避免重复执行已验证步骤，继续完成剩余需求。`,
      ``,
      ...nextSteps,
    ].join("\n");

    // Module 2a: 【阶段性技术审计发现与核心见解 (Review Draft)】
    let reviewDraftContent = "";
    if (this.workspaceRoot) {
      try {
        const reviewDraftPath = path.join(this.workspaceRoot, ".cph", "review_draft.md");
        if (fs.existsSync(reviewDraftPath)) {
          reviewDraftContent = fs.readFileSync(reviewDraftPath, "utf8").trim();
        }
      } catch {
        // Gracefully handle file system read issues
      }
    }

    // Module 2b: 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】
    let handoffMemoContent = "";
    for (let i = history.length - 1; i >= 0; i--) {
      const resp = history[i]?.response || "";
      const idx = resp.indexOf("HANDOFF_MEMO:");
      if (idx !== -1) {
        let memo = resp.slice(idx + "HANDOFF_MEMO:".length).trim();
        const actionIdx = memo.indexOf("```action");
        if (actionIdx !== -1) {
          memo = memo.slice(0, actionIdx).trim();
        }
        if (memo) {
          handoffMemoContent = memo;
          break;
        }
      }
    }

    const docParts = [
      `### [阶段性成果快照 (Auto-Handoff Snapshot)]`,
      `# 🔄 CPH-PI 会话高保真接力交接文档 (Autonomous Handoff Document)`,
      ``,
      `## 1. 【任务目标与原始需求】`,
      taskSection,
      ``,
    ];

    if (reviewDraftContent) {
      docParts.push(
        `## 2. 【阶段性技术审计发现与核心见解 (Review Draft)】`,
        reviewDraftContent,
        ``
      );
    }

    if (handoffMemoContent) {
      docParts.push(
        `## 【前序 AI 亲笔交接备忘录 (Agent Handoff Memo)】`,
        handoffMemoContent,
        ``
      );
    }

    docParts.push(
      `## ${reviewDraftContent ? "3" : "2"}. 【已验证客观事实与阶段性成果】`,
      verifiedFactsSection,
      ``,
      `## ${reviewDraftContent ? "4" : "3"}. 【关键卡点、报错与最新诊断】`,
      blockersSection,
      ``,
      `## ${reviewDraftContent ? "5" : "4"}. 【已修改/生成文件清单】`,
      modifiedFilesSection,
      ``,
      `## ${reviewDraftContent ? "6" : "5"}. 【接力第一优先级待办事项 (Actionable Next Steps)】`,
      nextStepsSection,
      ``,
      `---`,
      `*注: 本文档由 CPH-PI Orchestrator 自动生成并持久化归档于 \`.cph/handoffs/\`。接力会话将自动注入此背景。*`
    );

    const doc = docParts.join("\n");

    // Persist to <workspaceRoot>/.cph/handoffs/handoff-<sessionId>.md
    if (effectiveSessionId && this.workspaceRoot) {
      try {
        const handoffsDir = path.join(this.workspaceRoot, ".cph", "handoffs");
        fs.mkdirSync(handoffsDir, { recursive: true });
        const docPath = path.join(handoffsDir, `handoff-${effectiveSessionId}.md`);
        fs.writeFileSync(docPath, doc, "utf8");
        this.lastHandoffDocPath = docPath;
      } catch {
        // Gracefully handle file system write issues
      }
    }

    return doc;
  }

  /**
   * Safely captures current Git facts (branch, status) without throwing.
   */
  private collectGitFacts(): string {
    try {
      const branch = execSync("git branch --show-current", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();

      const status = execSync("git status -s", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();

      return `Branch: ${branch || "main"}\nStatus: ${status ? `\n${status}` : "clean (无未提交变更)"}`;
    } catch {
      return "Git: 未初始化或非 Git 仓库 (clean)";
    }
  }

  /**
   * Generates a compact preview of top-level directories and files.
   */
  private collectDirTreePreview(): string {
    try {
      const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
        .slice(0, 15)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return filtered.join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Identifies recoverable transport-level errors such as rate limits (429),
   * stream/idle timeouts, and connection/socket drops.
   */
  public isRecoverableTransportError(err: any): boolean {
    if (!err) return false;
    if (err.name === "AbortError" || err.message?.includes("aborted")) return false;
    const msg = String(err?.message || err || "").toLowerCase();
    const code = String(
      err?.code || err?.statusCode || err?.status || err?.errorCode || ""
    ).toLowerCase();

    const isRateLimit =
      code === "429" ||
      code === "ratelimit" ||
      msg.includes("429") ||
      msg.includes("throttled") ||
      msg.includes("rate limit") ||
      msg.includes("quota") ||
      msg.includes("exceeded") ||
      msg.includes("too many requests") ||
      msg.includes("配额已达上限") ||
      msg.includes("请求过于频繁");

    const isTimeout =
      code === "etimedout" ||
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("idle timeout");

    const isNetBreak =
      code === "econnreset" ||
      code === "epipe" ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("epipe") ||
      msg.includes("closed before") ||
      msg.includes("premature close") ||
      msg.includes("socket hang up");

    return isRateLimit || isTimeout || isNetBreak;
  }

  private isRateLimitError(err: any): boolean {
    return this.isRecoverableTransportError(err);
  }

  private isRateLimitResponseText(text: string): boolean {
    if (!text) return false;
    if (text.includes("```action") || text.includes("FINAL_ANSWER")) {
      return false;
    }
    const lower = text.toLowerCase();
    return (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      lower.includes("配额已达上限") ||
      lower.includes("请求过于频繁") ||
      lower.includes("throttled")
    );
  }

  /**
   * Executes the Orchestrator A -> B -> C Disaster Recovery Arbitration Pipeline.
   * Invoked when Session A encounters 429 rate limit or disconnection.
   */
  private async executeDisasterRecoveryArbitration(params: {
    task: string;
    history: TurnRecord[];
    client: IOrchestratorChatClient;
    lastError: string;
    signal?: AbortSignal;
    events?: OrchestratorEvents;
    sessionId: string;
    arbitratorChatClient?: IOrchestratorChatClient;
    lastPartialOutput?: {
      reasoning?: string;
      response?: string;
    };
  }): Promise<OrchestratorRunResult> {
    const { task, history, client, lastError, signal, events, sessionId } = params;

    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    // 1. Extract high-density disaster recovery blackbox (5k~8k chars)
    let disasterBlackbox = BlackboxCompactor.extractDisasterBlackbox(history, lastError);
    if (params.lastPartialOutput && (params.lastPartialOutput.reasoning || params.lastPartialOutput.response)) {
      if (
        !disasterBlackbox.includes(params.lastPartialOutput.response || "___nonexistent___") &&
        !disasterBlackbox.includes(params.lastPartialOutput.reasoning || "___nonexistent___")
      ) {
        disasterBlackbox += `\n\n### [中断前未完结部分输出 (Partial Output Before Crash)]\n` +
          (params.lastPartialOutput.reasoning ? `- **Reasoning**: ${params.lastPartialOutput.reasoning}\n` : "") +
          (params.lastPartialOutput.response ? `- **Response**: ${params.lastPartialOutput.response}\n` : "");
      }
    }
    if (events?.onDisasterOccurred) {
      await Promise.resolve(events.onDisasterOccurred(disasterBlackbox, lastError));
    }

    // 2. Mark victim account throttled in pool
    let victimEmail =
      (client as any)?.token?.email ||
      (client as any)?.email ||
      "";
    if (!victimEmail && this.pool?.refreshAccountList) {
      const accounts = this.pool.refreshAccountList();
      if (accounts && accounts.length > 0) {
        victimEmail = accounts[0].email;
      }
    }
    if (victimEmail && this.pool) {
      this.pool.markThrottled(victimEmail);
    }

    const targetHandoffRelativePath = `.cph/handoffs/handoff-${sessionId}.md`;
    const handoffsDir = path.join(this.workspaceRoot, ".cph", "handoffs");
    const targetHandoffAbsolutePath = path.join(handoffsDir, `handoff-${sessionId}.md`);

    // Local fallback when no account pool and no arbitrator client are configured
    if (!this.pool && !params.arbitratorChatClient && !this.arbitratorChatClient) {
      fs.mkdirSync(handoffsDir, { recursive: true });
      const localHandoffDoc = this.generateHandoffSnapshot(task, history, sessionId);
      fs.writeFileSync(targetHandoffAbsolutePath, localHandoffDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;

      if (events?.onHandoff) {
        events.onHandoff(localHandoffDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `Transport error recovered via local handoff snapshot. Handoff document generated.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: true,
        disasterBlackbox,
        handoffSnapshot: localHandoffDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 3. Obtain next available account token from pool
    let nextToken: any;
    try {
      if (!this.pool) {
        if (params.arbitratorChatClient || this.arbitratorChatClient) {
          nextToken = { email: "arbitrator@example.com" };
        } else {
          throw new Error("No account pool configured for disaster recovery");
        }
      } else {
        nextToken = await this.pool.getNextAvailableToken(
          this.customAgentId ? { forAgentId: this.customAgentId } : undefined
        );
      }
    } catch (poolErr: any) {
      // Scenario 3: All accounts throttled / pool exhausted -> graceful local fallback
      fs.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# 🔄 CPH-PI 容灾降级交接文档 (All Accounts Throttled)`,
        `> ⚠️ 账号池所有可用账号均已耗尽频控 (${poolErr.message || String(poolErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox,
      ].join("\n");

      fs.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;

      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `429 Rate limit encountered. All accounts in pool throttled: ${poolErr.message || String(poolErr)}`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 4. Resolve Arbitrator ChatClient (Session B)
    const arbitratorSessionId = `ses_arb_${crypto.randomUUID()}`;
    const nextEmail = nextToken?.email || "next-account";

    this.lineageTracker.register({
      sessionId: arbitratorSessionId,
      role: "main",
      status: "active",
      predecessorId: sessionId,
    });
    this.lineageTracker.linkSuccessor(sessionId, arbitratorSessionId);

    if (victimEmail && nextEmail && events?.onAccountSwitched) {
      events.onAccountSwitched(victimEmail, nextEmail);
    }

    if (events?.onArbitratorHandoffStart) {
      await Promise.resolve(events.onArbitratorHandoffStart(arbitratorSessionId, nextEmail));
    }

    let arbitratorClient: IOrchestratorChatClient;
    if (params.arbitratorChatClient) {
      arbitratorClient = params.arbitratorChatClient;
    } else if (this.arbitratorChatClient) {
      arbitratorClient = this.arbitratorChatClient;
    } else if (this.chatClientFactory) {
      arbitratorClient = this.chatClientFactory(nextToken, {
        modelTone: this.modelTone,
        customAgentId: this.customAgentId,
      });
    } else {
      arbitratorClient = new ChatHubClient(nextToken, {
        modelTone: this.modelTone,
        customAgentId: this.customAgentId,
      });
    }

    // 5. Construct 1-turn prompt for Arbitrator Session B
    const arbitratorPrompt = [
      `【前序会话事故黑匣子快照 (Disaster Recovery Blackbox)】`,
      disasterBlackbox,
      ``,
      `【交接仲裁任务】`,
      `前序会话因突发 429 频控/断连异常中断。你是交接仲裁者 (Handoff Arbitrator)。`,
      `请调用 handoff 技能（或输出标准 5 维交接文档），提炼出高保真阶段性交接文档：`,
      `1. 【任务目标与原始需求】`,
      `2. 【已验证客观事实与阶段性成果】`,
      `3. 【关键卡点、报错与最新诊断】`,
      `4. 【已修改/生成文件清单】`,
      `5. 【接力第一优先级待办事项 (Actionable Next Steps)】`,
      ``,
      `请必须使用 action: write_file 将交接文档写入 \`${targetHandoffRelativePath}\`。`,
      `如果直接返回 Markdown 正文，也请确保内容包含上述完整 5 维交接结构。`,
    ].join("\n");

    let arbitratorResponseText = "";
    try {
      const arbRes = await arbitratorClient.sendMessage({
        text: arbitratorPrompt,
        conversationId: crypto.randomUUID(),
        sessionId: arbitratorSessionId,
        requestId: crypto.randomUUID(),
        signal,
      });
      arbitratorResponseText = arbRes.text;
    } catch (arbErr: any) {
      if (signal?.aborted || arbErr?.name === "AbortError" || arbErr?.message?.includes("aborted")) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      // Graceful local fallback on arbitrator communication failure
      fs.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# 🔄 CPH-PI 容灾降级交接文档 (Arbitrator Session Failed)`,
        `> ⚠️ 仲裁会话执行异常 (${arbErr.message || String(arbErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox,
      ].join("\n");
      fs.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");
      this.lastHandoffDocPath = targetHandoffAbsolutePath;

      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `429 Disaster recovery partial: arbitrator session failed (${arbErr.message || String(arbErr)}), blackbox persisted locally.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 6. Handle tool invocation in Session B and guarantee disk persistence
    fs.mkdirSync(handoffsDir, { recursive: true });
    const parsed = ResilientParser.parse(arbitratorResponseText);

    if (parsed.type === "action") {
      events?.onToolStart?.(parsed.action);
      const toolResult = await this.bridge.executeAction(parsed.action, signal);
      events?.onToolEnd?.(toolResult);
    }

    // Guarantee persistence if not already created on disk by write_file
    if (!fs.existsSync(targetHandoffAbsolutePath)) {
      const contentToPersist =
        parsed.type === "final_answer"
          ? (parsed.answer.summary || parsed.answer.raw || arbitratorResponseText)
          : (parsed.type === "action" && parsed.action?.content)
          ? parsed.action.content
          : arbitratorResponseText;
      fs.writeFileSync(targetHandoffAbsolutePath, contentToPersist, "utf8");
    }

    this.lastHandoffDocPath = targetHandoffAbsolutePath;
    const finalDocContent = fs.existsSync(targetHandoffAbsolutePath)
      ? fs.readFileSync(targetHandoffAbsolutePath, "utf8")
      : disasterBlackbox;

    if (events?.onArbitratorHandoffComplete) {
      await Promise.resolve(
        events.onArbitratorHandoffComplete(targetHandoffAbsolutePath, arbitratorSessionId)
      );
    }
    if (events?.onHandoff) {
      events.onHandoff(finalDocContent, targetHandoffAbsolutePath);
    }

    return {
      finalAnswer: `429 Disaster recovered via arbitrator session ${arbitratorSessionId}. Handoff document generated.`,
      turnsCount: history.length,
      completed: false,
      history,
      handedOff: true,
      disasterRecovered: true,
      disasterBlackbox,
      handoffSnapshot: finalDocContent,
      handoffDocPath: targetHandoffAbsolutePath,
      arbitratorSessionId,
      lastPartialOutput: params.lastPartialOutput,
    };
  }
}

export { Orchestrator as CopilotOrchestrator };
