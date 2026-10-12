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
import {
  createMainPlanSnapshot,
  saveMainPlanSnapshot,
  formatSuccessorTurn1Prompt,
} from "../session/main-plan-snapshot.ts";
import { HandoffDocumentGenerator } from "./handoff-generator.ts";
import { DisasterArbitrator } from "./disaster-arbitrator.ts";

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
  maxGenerations?: number;
  timeoutMs?: number;
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
  onSubagentProgress?: (id: string, turn: number, delta?: string, action?: any) => void;
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
  onMainSessionVirtualized?: (snapshot: any, mdPath: string) => void;
  onSuccessorAwakened?: (newSessionId: string, generation: number) => void;
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
  private cloudAttachmentThresholdChars: number = 120000;
  private cloudAttachmentThresholdLines: number = 3000;
  private lineageTracker: SessionLineageTracker;
  public generation: number = 1;
  private maxGenerations: number;
  public timeoutMs?: number;

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
    this.maxGenerations = options.maxGenerations ?? 10;
    this.maxRefusalRetries = options.maxRefusalRetries ?? 3;
    this.modelTone = options.modelTone ?? "Gpt_61_Sol_Reasoning";
    this.timeoutMs = options.timeoutMs;
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
    this.cloudAttachmentThresholdChars = options.cloudAttachmentThresholdChars ?? 120000;
    this.cloudAttachmentThresholdLines = options.cloudAttachmentThresholdLines ?? 3000;
    this.lineageTracker = options.lineageTracker || new SessionLineageTracker();
    this.isHandshakePending =
      options.isHandshakePending !== undefined
        ? options.isHandshakePending
        : !this.customAgentId;
  }

  public getTimeoutMs(): number | undefined {
    return this.timeoutMs;
  }

  public setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  public getModelTone(): string {
    return this.modelTone;
  }

  public setModelTone(tone: string): void {
    this.modelTone = tone;
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

  public resetHandshake(pending?: boolean): void {
    if (pending !== undefined) {
      this.isHandshakePending = pending;
      return;
    }
    this.isHandshakePending = !this.customAgentId;
    this.pendingTask = "";
    this.pendingSkills = "";
    this.conversationId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    this.generation = 1;
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

    let sessionId = options.sessionId || this.sessionId;
    this.sessionId = sessionId;
    let conversationId = this.conversationId;

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
    let globalTurn = 1;
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

      events?.onTurnStart?.(globalTurn);
      const turnIndex = globalTurn;
      const turnInputPrompt = currentPrompt;
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
              turn: turnIndex,
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
              const nextToken = await this.pool.getNextAvailableToken();
              events?.onAccountSwitched?.(currentEmail, nextToken.email);
              client = this.chatClientFactory
                ? this.chatClientFactory(nextToken, {
                    modelTone: this.modelTone,
                    customAgentId: this.customAgentId,
                  })
                : new ChatHubClient(nextToken, {
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
            turn: turnIndex,
            userInput: currentPrompt,
            thought: parsed.thought || turnReasoningText,
            response: turnResponseText,
          });
          currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]\n\n${PromptBuilder.PROTOCOL_REMINDER}`;
          events?.onTurnEnd?.(turnIndex, turnResponseText);
          turn++;
          globalTurn++;
          continue;
        }

        const finalAnswer = parsed.answer.summary || parsed.answer.raw;
        history.push({
          turn: turnIndex,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText,
        });

        events?.onTurnEnd?.(turnIndex, turnResponseText);
        events?.onCompleted?.(finalAnswer);

        return {
          finalAnswer,
          turnsCount: turnIndex,
          completed: true,
          history,
          handedOff: false,
        };
      }

      // Case 3b: Native handoff fenced block emitted
      if (parsed.type === "handoff") {
        const targetSessionId = options.sessionId || this.sessionId;
        let docPath: string | undefined;
        if (this.workspaceRoot) {
          const handoffsDir = path.join(this.workspaceRoot, ".cph", "handoffs");
          fs.mkdirSync(handoffsDir, { recursive: true });
          docPath = path.join(handoffsDir, `handoff-${targetSessionId}.md`);
          fs.writeFileSync(docPath, parsed.handoffDoc, "utf8");
          this.lastHandoffDocPath = docPath;
        }

        history.push({
          turn: turnIndex,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText,
        });
        events?.onTurnEnd?.(turnIndex, turnResponseText);
        events?.onHandoff?.(parsed.handoffDoc, docPath);

        return {
          finalAnswer: "Session handed off with native handoff document.",
          turnsCount: turnIndex,
          completed: false,
          history,
          handedOff: true,
          handoffSnapshot: parsed.handoffDoc,
          handoffDocPath: docPath,
        };
      }

      // Case 3c: Action invoked
      if (parsed.type === "action") {
        events?.onToolStart?.(parsed.action);

        let toolResult: ToolBridgeResult;

        if (parsed.action.tool === "invoke_subagent") {
          const thought = parsed.thought || (parsed as any).action?.thought || "";
          const subagents = (parsed.action as any).subagents || [];
          const snapshot = createMainPlanSnapshot({
            originalSessionId: this.sessionId,
            originalTask: this.pendingTask || task,
            thought,
            workspaceRoot: this.workspaceRoot,
            plannedSubagents: subagents,
          });
          const { mdPath } = saveMainPlanSnapshot(snapshot, this.workspaceRoot);
          events?.onMainSessionVirtualized?.(snapshot, mdPath);

          // Safely disconnect client WebSocket if close method exists to free cloud account
          try {
            (client as any)?.close?.();
          } catch {}

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

          const reports = await runner.executeBatch(subagents, signal, {
            onSubagentStart: events?.onSubagentStart,
            onSubagentEnd: events?.onSubagentEnd,
            onSubagentProgress: events?.onSubagentProgress,
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

          // Generational transition to Successor Main Session
          const prevSessionId = this.sessionId;
          this.generation++;
          const nextSessionId = `${this.sessionId.replace(/_gen\d+$/, "")}_gen${this.generation}`;
          this.sessionId = nextSessionId;
          sessionId = nextSessionId;
          this.conversationId = crypto.randomUUID();
          conversationId = this.conversationId;
          this.lineageTracker?.register({
            sessionId: nextSessionId,
            role: "main",
            status: "active",
            predecessorId: prevSessionId,
          });
          this.lineageTracker?.linkSuccessor(prevSessionId, nextSessionId);

          events?.onSuccessorAwakened?.(nextSessionId, this.generation);

          if (!this.chatClient && this.pool) {
            try {
              const token = await this.pool.getNextAvailableToken(
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
            } catch {}
          }

          currentPrompt = formatSuccessorTurn1Prompt(snapshot, summaryOutput);
          this.isHandshakePending = false;
          refusalRetries = 0;
          if (this.generation <= this.maxGenerations) {
            turn = 0; // Reset turn counter for fresh 30 turns budget!
          }
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
          turn: turnIndex,
          userInput: turnInputPrompt,
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
        if (parsed.action.tool === "invoke_subagent") {
          // Generational relay: currentPrompt was already set to formatSuccessorTurn1Prompt(...)
        } else if (this.isHandshakePending) {
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
            currentPrompt = PromptBuilder.buildTurn2TaskPrompt({
              taskPrompt: this.pendingTask,
              skillsSection: this.pendingSkills,
              toolResult: toolResult.output,
              toolName: parsed.action.tool || toolResult.actionName,
            });
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

        events?.onTurnEnd?.(turnIndex, turnResponseText);
        if (parsed.action.tool === "invoke_subagent" && this.generation > this.maxGenerations) {
          return {
            finalAnswer: `Max generations reached (${this.maxGenerations}) without completion.`,
            turnsCount: turnIndex,
            completed: false,
            history,
          };
        }
        turn++;
        globalTurn++;
        continue;
      }

      // Case 3c: Invalid chatter
      history.push({
        turn: turnIndex,
        userInput: currentPrompt,
        thought: parsed.thought || turnReasoningText,
        response: turnResponseText,
      });

      if (this.isHandshakePending) {
        currentPrompt = `[请先输出 action 块执行 git status 以验证本地物理工具连接]\n\n${PromptBuilder.PROTOCOL_REMINDER}`;
      } else {
        currentPrompt = `${parsed.warning}\n${PromptBuilder.PROTOCOL_REMINDER}`;
      }
      events?.onTurnEnd?.(turnIndex, turnResponseText);
      turn++;
      globalTurn++;
    }

    const targetSessionId = options.sessionId || this.sessionId;
    const handoffSnapshot = this.generateHandoffSnapshot(task, history, targetSessionId);
    const handoffDocPath = this.lastHandoffDocPath;
    events?.onHandoff?.(handoffSnapshot, handoffDocPath);

    return {
      finalAnswer: "Max turns reached without final answer.",
      turnsCount: globalTurn - 1,
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
    return HandoffDocumentGenerator.extractKeyError(output);
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
    const result = HandoffDocumentGenerator.generate({
      task,
      history,
      sessionId: sessionId || this.sessionId,
      workspaceRoot: this.workspaceRoot,
      pendingTask: this.pendingTask,
    });
    if (result.handoffDocPath) {
      this.lastHandoffDocPath = result.handoffDocPath;
    }
    return result.document;
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
  public async executeDisasterRecoveryArbitration(params: {
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
    const result = await DisasterArbitrator.execute({
      ...params,
      workspaceRoot: this.workspaceRoot,
      modelTone: this.modelTone,
      customAgentId: this.customAgentId,
      pool: this.pool as any,
      bridge: this.bridge,
      lineageTracker: this.lineageTracker,
      chatClientFactory: this.chatClientFactory,
      arbitratorChatClient: params.arbitratorChatClient || this.arbitratorChatClient,
      generateHandoffSnapshot: (t, h, s) => this.generateHandoffSnapshot(t, h, s),
    });
    if (result.handoffDocPath) {
      this.lastHandoffDocPath = result.handoffDocPath;
    }
    return result;
  }
}

export { Orchestrator as CopilotOrchestrator };
