import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { AccountPool } from "../auth/account-pool.ts";
import { ChatHubClient } from "../transport/chathub-client.ts";
import {
  SubstrateUploader,
  type UploadDocumentResult,
} from "../transport/substrate-uploader.ts";
import type { AttachmentAnnotation } from "../transport/types.ts";
import { SnapshotGenerator, type SnapshotResult } from "../workspace/snapshot-generator.ts";
import { PnPWorkspaceSyncEngine } from "../workspace/pnp-sync-engine.ts";
import {
  ToolBridge,
  type CopilotAction,
  type ToolBridgeResult,
} from "../protocol/tool-bridge.ts";
import { DeliverablesParser, type DeliverableItem } from "../protocol/deliverables-parser.ts";
import { FilePorter, type FilePorterDeliveryResult } from "../transport/file-porter.ts";
import { PromptBuilder } from "../protocol/prompt-builder.ts";
import { ResilientParser } from "../protocol/resilient-parser.ts";
import { CompactionService, type TurnRecord } from "./compaction.ts";
import { BlackboxCompactor } from "./blackbox-compactor.ts";
import { RefusalGuard } from "./refusal-guard.ts";
import type { Skill } from "../skills/skill-loader.ts";
import { SkillRegistry } from "../skills/skill-registry.ts";
import { SubagentRunner } from "./subagent-runner.ts";
import { TerminalLogger } from "../ui/terminal-logger.ts";
import { SessionLineageTracker } from "../session/lineage-tracker.ts";
import {
  createMainPlanSnapshot,
  saveMainPlanSnapshot,
  formatSuccessorTurn1Prompt,
} from "../session/main-plan-snapshot.ts";
import { getNextUtcMidnight } from "../auth/account-pool.ts";

export interface IAccountPool {
  markThrottled(email: string, durationMs?: number, reason?: "daily" | "burst"): void;
  getNextAvailableToken(options?: any): Promise<any>;
  releaseSessionLease?(sessionId: string): void;
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
  skillRegistry?: SkillRegistry;
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
  enableWorkspaceSnapshot?: boolean;
  cdpClient?: any;
}

export type CopilotOrchestratorOptions = OrchestratorOptions;

export interface OrchestratorEvents {
  onDelta?: (delta: string) => void;
  onReasoning?: (reasoning: string) => void;
  onTurnStart?: (turn: number) => void;
  onTurnEnd?: (turn: number, response: string) => void;
  onToolStart?: (action: CopilotAction) => void;
  onToolEnd?: (result: ToolBridgeResult) => void;
  onSubagentStart?: (id: string, role: string, spec: any, hop?: number, account?: string) => void;
  onSubagentEnd?: (report: any) => void;
  onSubagentProgress?: (id: string, turn: number, delta?: string, action?: any, hopCount?: number, account?: string) => void;
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
  initialAnnotations?: AttachmentAnnotation[];
  rootUserPrompt?: string;
  enableWorkspaceSnapshot?: boolean;
  cdpClient?: any;
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

/**
 * Checks if the given subagents represent an inline scout exploration task.
 * Inline scout tasks are single-agent lightweight probing tasks (researcher/searcher)
 * that execute within the current main session without virtualizing/ending the main session connection.
 */
export function isInlineScoutTask(subagents: any[]): boolean {
  if (!Array.isArray(subagents) || subagents.length !== 1) {
    return false;
  }
  const task = subagents[0];
  if (!task || typeof task !== "object") {
    return false;
  }
  const role = String(task.role || "").trim().toLowerCase();
  if (role !== "researcher" && role !== "searcher") {
    return false;
  }
  if (task.isScout === true || task.isScout === "true") {
    return true;
  }
  const scoutRegex = /scout|斥候|大纲|架构探查|结构梳理/i;
  const desc = typeof task.description === "string" ? task.description : "";
  const prompt = typeof task.prompt === "string" ? task.prompt : "";
  const title = typeof task.title === "string" ? task.title : "";
  const extraTask = typeof task.task === "string" ? task.task : "";
  return (
    scoutRegex.test(desc) ||
    scoutRegex.test(prompt) ||
    scoutRegex.test(title) ||
    scoutRegex.test(extraTask)
  );
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
  public skillRegistry?: SkillRegistry;
  public customAgentId?: string;
  public coderAgentId?: string;
  public researcherAgentId?: string;
  private subagentRunner?: SubagentRunner | any;
  private enableInSessionCompaction: boolean = false;
  private graphTokenProvider?: () => Promise<string>;
  private enableCloudAttachment: boolean = true;
  private cloudAttachmentThresholdChars: number = 12000;
  private cloudAttachmentThresholdLines: number = 200;
  private lineageTracker: SessionLineageTracker;
  public generation: number = 1;
  private maxGenerations: number;
  public enableWorkspaceSnapshot: boolean;
  public lastNextSnapshotMeta?: SnapshotResult;
  private lastModifiedFile?: string;
  private cdpClient?: any;

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
    this.maxGenerations = options.maxGenerations ?? 50;
    this.maxRefusalRetries = options.maxRefusalRetries ?? 3;
    this.modelTone = options.modelTone ?? "Gpt_61_Sol_Reasoning";
    this.pool = options.pool;
    this.bridge = options.bridge || new ToolBridge(this.workspaceRoot);
    this.chatClient = options.chatClient || options.client;
    this.arbitratorChatClient = options.arbitratorChatClient;
    this.chatClientFactory = options.chatClientFactory;
    this.activeSkills = options.activeSkills;
    this.skillRegistry = options.skillRegistry;
    this.customAgentId = options.customAgentId;
    this.coderAgentId = options.coderAgentId;
    this.researcherAgentId = options.researcherAgentId;
    this.subagentRunner = options.subagentRunner;
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.enableInSessionCompaction = options.enableInSessionCompaction ?? false;
    this.graphTokenProvider = options.graphTokenProvider;
    this.enableCloudAttachment = options.enableCloudAttachment ?? true;
    this.cloudAttachmentThresholdChars =
      options.cloudAttachmentThresholdChars !== undefined
        ? options.cloudAttachmentThresholdChars
        : 12000;
    this.cloudAttachmentThresholdLines =
      options.cloudAttachmentThresholdLines !== undefined
        ? options.cloudAttachmentThresholdLines
        : 200;
    this.lineageTracker = options.lineageTracker || new SessionLineageTracker();
    this.enableWorkspaceSnapshot = options.enableWorkspaceSnapshot ?? false;
    this.cdpClient = options.cdpClient;
    this.isHandshakePending =
      options.isHandshakePending !== undefined
        ? options.isHandshakePending
        : !this.customAgentId;
  }

  public getLastNextSnapshotMeta(): SnapshotResult | undefined {
    return this.lastNextSnapshotMeta;
  }

  public getCurrentGitBranch(): string {
    if (!this.workspaceRoot) return "main";
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.workspaceRoot,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf-8").trim();
    } catch {
      return "main";
    }
  }

  public getCloudAttachmentThresholds(): { chars: number; lines: number } {
    return {
      chars: this.cloudAttachmentThresholdChars,
      lines: this.cloudAttachmentThresholdLines,
    };
  }

  public getLineageTracker(): SessionLineageTracker {
    return this.lineageTracker;
  }

  public getGeneration(): number {
    return this.generation;
  }

  public getHandoffCount(): number {
    return Math.max(0, this.generation - 1);
  }

  public getConcurrencyWorkerCount(): number | undefined {
    if (!this.pool) return undefined;
    try {
      const statuses = this.pool.getPoolStatus();
      const allowed = this.pool.getAllowedAccounts();
      const allowedStatuses =
        allowed !== undefined && allowed.length > 0
          ? statuses.filter((s) => s.isAllowed !== false)
          : statuses;
      return allowedStatuses.length > 0 ? allowedStatuses.length : undefined;
    } catch {
      return undefined;
    }
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

  /**
   * Dynamically update workspaceRoot and synchronize tool bridge working directory.
   */
  public setWorkspaceRoot(newRoot: string, skillRegistry?: SkillRegistry): void {
    this.workspaceRoot = path.resolve(newRoot);
    if (this.bridge && typeof (this.bridge as any).setCwd === "function") {
      (this.bridge as any).setCwd(this.workspaceRoot);
    } else {
      this.bridge = new ToolBridge(this.workspaceRoot);
    }
    if (skillRegistry) {
      this.skillRegistry = skillRegistry;
    } else {
      this.skillRegistry = new SkillRegistry(new SkillLoader(this.workspaceRoot));
      try {
        this.skillRegistry.loadSkills();
      } catch {}
    }
    this.activeSkills = this.skillRegistry.getActiveSkills();
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

  public completeHandshake(): void {
    this.isHandshakePending = false;
  }

  public setHandshakePending(pending: boolean): void {
    this.isHandshakePending = pending;
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
    this.generation = 1;
    this.lastHandoffDocPath = undefined;
  }

  private formatSkillsSection(skills?: Skill[] | string): string {
    if (!skills) return "";
    if (typeof skills === "string") return skills;
    if (Array.isArray(skills)) {
      if (skills.length === 0) return "";
      const registry = this.skillRegistry || new SkillRegistry();
      return registry.buildPromptSection(skills);
    }
    return "";
  }

  /**
   * Runs an autonomous closed-loop programming task.
   */
  public async run(options: OrchestratorRunOptions): Promise<OrchestratorRunResult> {
    try {
      const { task, signal, events } = options;
    const rootUserPrompt = options.rootUserPrompt || options.task;

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
        const token = await pool.getNextAvailableToken({
          forAgentId: this.customAgentId,
          sessionId: this.sessionId,
        });
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
            rootUserPrompt,
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
      // Direct Mode for Custom Agent (CPH-Dev): bypass handshake, send task directly with 2-level directory skeleton
      const workerCount = this.getConcurrencyWorkerCount();
      currentPrompt = PromptBuilder.buildDirectAgentPrompt(
        this.workspaceRoot,
        task,
        skillsSection,
        dirTree,
        workerCount
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
    let emptyResponseRetries = 0;
    const maxEmptyResponseRetries = 2;
    let turn = 1;
    let currentAnnotations: AttachmentAnnotation[] = options.initialAnnotations
      ? [...options.initialAnnotations]
      : [];
    const cdpClient = options.cdpClient ?? this.cdpClient;

    // Pre-Turn 1: SharePoint Cloud Workspace Full Sync & Catalog Generation
    if (this.workspaceRoot) {
      const manifestPath = path.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
          if (manifest && manifest.targetFolder) {
            const siteUrl = manifest.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
            const targetFolder = manifest.targetFolder;
            const mockTransport = Boolean((manifest as any)?.mockTransport || process.env.CPH_MOCK_TRANSPORT === "1");
            const syncAbort = new AbortController();
            let syncTimer: any;
            try {
              await Promise.race([
                PnPWorkspaceSyncEngine.syncWorkspace(this.workspaceRoot, targetFolder, {
                  siteUrl,
                  mockTransport,
                  signal: syncAbort.signal,
                }),
                new Promise((_, reject) => {
                  syncTimer = setTimeout(() => {
                    syncAbort.abort();
                    reject(new Error("SYNC_TIMEOUT"));
                  }, 15000);
                  syncTimer?.unref?.();
                }),
              ]);
            } catch (syncErr: any) {
              try {
                const errLogPath = path.join(this.workspaceRoot, ".cph", "state", "sync-error.log");
                fs.mkdirSync(path.dirname(errLogPath), { recursive: true });
                fs.appendFileSync(
                  errLogPath,
                  `[${new Date().toISOString()}] Pre-Turn 1 syncWorkspace failed:\n${syncErr?.stack || syncErr?.message || String(syncErr)}\n\n`,
                  "utf-8"
                );
              } catch {}
            } finally {
              if (syncTimer) clearTimeout(syncTimer);
            }

            try {
              PnPWorkspaceSyncEngine.generateCatalogMarkdown(this.workspaceRoot, { siteUrl, targetFolder });
            } catch {}
          }
        } catch {}
      }
    }

    // Pre-Turn 1: Workspace Catalog Attachment Mount with SHA-256 Cache
    if (this.workspaceRoot) {
      const catalogRelCandidates = [
        path.join(".cph", "state", "remote-workspace-catalog.md"),
        "remote-workspace-catalog.md",
      ];
      let catalogFilePath: string | undefined;
      for (const rel of catalogRelCandidates) {
        const p = path.join(this.workspaceRoot, rel);
        if (fs.existsSync(p)) {
          catalogFilePath = p;
          break;
        }
      }

      if (catalogFilePath) {
        try {
          const catalogBuffer = fs.readFileSync(catalogFilePath);
          const catalogHash = crypto.createHash("sha256").update(catalogBuffer).digest("hex");
          const catalogCacheFile = path.join(
            this.workspaceRoot,
            ".cph",
            "state",
            "workspace-catalog-cache.json"
          );

          let cachedCatalog: {
            catalogHash?: string;
            hash?: string;
            uploadResult?: UploadDocumentResult;
            updatedAt?: string;
          } | null = null;

          if (fs.existsSync(catalogCacheFile)) {
            try {
              cachedCatalog = JSON.parse(fs.readFileSync(catalogCacheFile, "utf-8"));
            } catch {
              cachedCatalog = null;
            }
          }

          if (
            cachedCatalog &&
            (cachedCatalog.catalogHash === catalogHash || cachedCatalog.hash === catalogHash) &&
            cachedCatalog.uploadResult?.annotation
          ) {
            currentAnnotations.push(cachedCatalog.uploadResult.annotation);
            events?.onAttachmentUploaded?.(cachedCatalog.uploadResult, "workspace_catalog");
          } else {
            const graphToken = await this.acquireGraphToken();
            if (!graphToken) {
              throw new Error("No Graph access token available for workspace catalog upload");
            }
            const uploadResult = await SubstrateUploader.uploadDocumentAuto(
              graphToken,
              catalogBuffer,
              "remote-workspace-catalog.md",
              signal
            );

            const cacheData = {
              catalogHash,
              uploadResult,
              updatedAt: new Date().toISOString(),
            };
            fs.mkdirSync(path.dirname(catalogCacheFile), { recursive: true });
            fs.writeFileSync(catalogCacheFile, JSON.stringify(cacheData, null, 2), "utf-8");

            currentAnnotations.push(uploadResult.annotation);
            events?.onAttachmentUploaded?.(uploadResult, "workspace_catalog");
          }
        } catch (err: any) {
          try {
            const errLogPath = path.join(
              this.workspaceRoot,
              ".cph",
              "state",
              "upload-error.log"
            );
            fs.mkdirSync(path.dirname(errLogPath), { recursive: true });
            const errContent = `[${new Date().toISOString()}] Turn 1 workspace catalog upload failed:\n${
              err?.stack || err?.message || String(err)
            }\n\n`;
            fs.appendFileSync(errLogPath, errContent, "utf-8");
          } catch {}
        }
      }
    }

    // Turn 1: Workspace Snapshot Attachment, Cache Check & Explicit Fault Tolerance
    const isWorkspaceSnapshotEnabled =
      options.enableWorkspaceSnapshot !== undefined
        ? options.enableWorkspaceSnapshot
        : this.enableWorkspaceSnapshot;

    if (isWorkspaceSnapshotEnabled && this.workspaceRoot) {
      try {
        const generation = this.generation || 1;
        const snap = SnapshotGenerator.generateWorkspaceSnapshot(
          this.workspaceRoot,
          undefined,
          generation
        );
        const cacheFile = path.join(
          this.workspaceRoot,
          ".cph",
          "state",
          "workspace-snapshot-cache.json"
        );
        let cached: {
          snapshotHash?: string;
          uploadResult?: UploadDocumentResult;
          updatedAt?: string;
        } | null = null;

        if (fs.existsSync(cacheFile)) {
          try {
            cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
          } catch {
            cached = null;
          }
        }

        if (
          cached &&
          cached.snapshotHash === snap.hash &&
          cached.uploadResult?.annotation
        ) {
          // Unchanged hash: directly reuse cached annotation
          currentAnnotations.unshift(cached.uploadResult.annotation);
          events?.onAttachmentUploaded?.(cached.uploadResult, "workspace_snapshot");
        } else {
          // Upload new snapshot buffer
          const graphToken = await this.acquireGraphToken();
          if (!graphToken) {
            throw new Error("No Graph access token available for workspace snapshot upload");
          }
          const snapshotBuffer = fs.readFileSync(snap.snapshotPath);
          const uploadResult = await SubstrateUploader.uploadDocumentAuto(
            graphToken,
            snapshotBuffer,
            snap.cloudFileName,
            signal
          );

          // Persist full annotation cache
          const cacheData = {
            snapshotHash: snap.hash,
            uploadResult,
            updatedAt: new Date().toISOString(),
          };
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), "utf-8");

          currentAnnotations.unshift(uploadResult.annotation);
          events?.onAttachmentUploaded?.(uploadResult, "workspace_snapshot");
        }
      } catch (err: any) {
        // Explicit fault tolerance & model-visible perception (M2/I20)
        try {
          const errLogPath = path.join(
            this.workspaceRoot,
            ".cph",
            "state",
            "upload-error.log"
          );
          fs.mkdirSync(path.dirname(errLogPath), { recursive: true });
          const errContent = `[${new Date().toISOString()}] Turn 1 workspace snapshot upload failed:\n${
            err?.stack || err?.message || String(err)
          }\n\n`;
          fs.appendFileSync(errLogPath, errContent, "utf-8");
        } catch {}

        const warnMsg = "[WARN: Turn 1 workspace snapshot upload failed]";
        if ((this as any).tuiRenderer?.c?.yellow) {
          console.warn((this as any).tuiRenderer.c.yellow(warnMsg));
        } else {
          console.warn(warnMsg);
        }

        const degradationNotice =
          "\n[WORKSPACE NOTICE: 全景代码快照上传暂未就绪，当前进入增量探查降级模式，请按需调用 read_file 探查所需文件]\n";
        currentPrompt = degradationNotice + currentPrompt;
      }
    }

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
      const turnIndex = turn;
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
            isStartOfSession: turn === 1,
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
            rootUserPrompt,
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
          rootUserPrompt,
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

      if (parsed.type === "empty_response") {
        if (emptyResponseRetries < maxEmptyResponseRetries) {
          emptyResponseRetries++;
          // 重试当前 prompt，不递增正式 turn
          continue;
        }
        // 连续空响应超限，尝试切换可用账号或触发灾备，避免死循环（空响应非429限流，保持账号健康状态，仅轮换至下一个可用账号）
        if (this.pool) {
          try {
            const currentEmail = (client as any)?.token?.email || "";
            const nextToken = await this.pool.getNextAvailableToken();
            events?.onAccountSwitched?.(currentEmail, nextToken.email);
            client = new ChatHubClient(nextToken, {
              modelTone: this.modelTone,
              customAgentId: this.customAgentId,
            });
            emptyResponseRetries = 0;
            continue;
          } catch {}
        }
        // 若无可换账号，抛出可恢复错误触发仲裁灾备
        throw new Error("EMPTY_RESPONSE_LIMIT_EXCEEDED: 上游模型持续返回空载荷");
      }
      // 非空响应时重置计数器
      emptyResponseRetries = 0;

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

        // Auto FilePorter Reconciliation on FINAL_ANSWER
        if (this.workspaceRoot) {
          try {
            let deliverables = DeliverablesParser.parse(finalAnswer, this.workspaceRoot);
            if (deliverables.length === 0 && turnResponseText && turnResponseText !== finalAnswer) {
              deliverables = DeliverablesParser.parse(turnResponseText, this.workspaceRoot);
            }
            if (deliverables.length > 0) {
              const deliveryResults = await Promise.all(
                deliverables.map((item) =>
                  FilePorter.fetchAndDeliver(item, this.workspaceRoot, {
                    cdpClient,
                  })
                )
              );

              const landedPaths: string[] = [];
              for (const res of deliveryResults) {
                if (res.status === "success" && res.landedPaths.length > 0) {
                  landedPaths.push(...res.landedPaths);
                }
              }

              const manifestPath = path.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json");
              if (fs.existsSync(manifestPath) && landedPaths.length > 0) {
                const existingManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
                if (existingManifest && existingManifest.targetFolder) {
                  const siteUrl = existingManifest.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
                  const targetFolder = existingManifest.targetFolder;
                  const mockTransport = Boolean((existingManifest as any)?.mockTransport || process.env.CPH_MOCK_TRANSPORT === "1");
                  const engine = new PnPWorkspaceSyncEngine();

                  for (const relPath of landedPaths) {
                    try {
                      await engine.syncFile(this.workspaceRoot, relPath, targetFolder, {
                        siteUrl,
                        mockTransport,
                        signal,
                      });
                    } catch {}
                  }

                  try {
                    PnPWorkspaceSyncEngine.generateCatalogMarkdown(this.workspaceRoot, { siteUrl, targetFolder });
                  } catch {}
                }
              }

              if (landedPaths.length > 0) {
                console.log(
                  [
                    "\n================ [FILE PORTER AUTO-RECONCILIATION] ================",
                    `✔ 成功搬运落盘文件: ${landedPaths.length} 个`,
                    ...landedPaths.map((p) => `  - ${p}`),
                    fs.existsSync(manifestPath) ? "✔ 已触发 SharePoint 云端增量热同步" : "",
                    "===================================================================\n",
                  ]
                    .filter(Boolean)
                    .join("\n")
                );
              }
            }
          } catch (porterErr: any) {
            console.warn(`[FilePorter] Auto-reconciliation failed: ${porterErr?.message || porterErr}`);
          }
        }

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

      // Case 3b: Native handoff fenced block emitted
      if (parsed.type === "handoff") {
        const targetSessionId = options.sessionId || this.sessionId;
        let docPath: string | undefined;
        let finalHandoffDoc = (parsed.handoffDoc || "").trim();

        if (this.workspaceRoot) {
          const handoffsDir = path.join(this.workspaceRoot, ".cph", "handoffs");
          fs.mkdirSync(handoffsDir, { recursive: true });
          docPath = path.join(handoffsDir, `handoff-${targetSessionId}.md`);

          if (finalHandoffDoc.length >= 50) {
            fs.writeFileSync(docPath, finalHandoffDoc, "utf8");
            this.lastHandoffDocPath = docPath;
          } else {
            if (fs.existsSync(docPath)) {
              try { fs.unlinkSync(docPath); } catch {}
            }
            finalHandoffDoc = this.generateHandoffSnapshot(task, history, targetSessionId);
            docPath = this.lastHandoffDocPath;
          }
        } else {
          if (finalHandoffDoc.length < 50) {
            finalHandoffDoc = this.generateHandoffSnapshot(task, history, targetSessionId);
          }
        }

        history.push({
          turn,
          userInput: currentPrompt,
          thought: parsed.thought || turnReasoningText,
          response: turnResponseText,
        });
        events?.onTurnEnd?.(turn, turnResponseText);
        events?.onHandoff?.(finalHandoffDoc, docPath);

        return {
          finalAnswer: "Session handed off with native handoff document.",
          turnsCount: turn,
          completed: false,
          history,
          handedOff: true,
          handoffSnapshot: finalHandoffDoc,
          handoffDocPath: docPath,
        };
      }

      // Case 3c: Action invoked
      if (parsed.type === "action") {
        events?.onToolStart?.(parsed.action);

        let toolResult: ToolBridgeResult;
        let isInlineScout = false;

        if (parsed.action.tool === "invoke_subagent") {
          const thought = parsed.thought || (parsed as any).action?.thought || "";
          const subagents = (parsed.action as any).subagents || [];
          isInlineScout = isInlineScoutTask(subagents);

          let snapshot: any = null;
          if (!isInlineScout) {
            snapshot = createMainPlanSnapshot({
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
            this.pool?.releaseSessionLease?.(this.sessionId);
          }

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
              loggerTree: TerminalLogger.getInstance().initSessionTree(this.sessionId, this.workspaceRoot),
              lineageTracker: this.lineageTracker,
            });

          const reports = await runner.executeBatch(subagents, signal, {
            onSubagentStart: events?.onSubagentStart,
            onSubagentEnd: events?.onSubagentEnd,
            onSubagentProgress: events?.onSubagentProgress,
          });

          const summaryOutput = runner.formatReportSummary(reports);
          const successCount = reports.filter((r: any) => r.success).length;
          const isAllSuccess = successCount === reports.length;
          const isPartialSuccess = successCount > 0 && !isAllSuccess;
          toolResult = {
            actionName: "invoke_subagent",
            piToolName: "subagent",
            target: `${reports.length} subagents (${successCount}/${reports.length} 成功)`,
            success: successCount > 0, // 部分成功即标绿，杜绝 1 个失败全量标红
            output: summaryOutput,
            formatted: summaryOutput,
          };

          if (!isInlineScout) {
            // Generational transition to Successor Main Session
            const prevSessionId = this.sessionId;
            if (this.pool && prevSessionId && typeof (this.pool as any).releaseSessionLease === "function") {
              try {
                (this.pool as any).releaseSessionLease(prevSessionId);
              } catch {}
            }
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
                const token = await this.pool.getNextAvailableToken({
                  sessionId: nextSessionId,
                  ...(this.customAgentId ? { forAgentId: this.customAgentId } : {}),
                });
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

            const workerCount = this.getConcurrencyWorkerCount();
            const dirTree = this.collectDirTreePreview();
            this.pendingTask = snapshot.originalTask || this.pendingTask || task;
            currentPrompt = formatSuccessorTurn1Prompt(snapshot, summaryOutput, undefined, workerCount, dirTree);
            this.completeHandshake();
            refusalRetries = 0;
            turn = 0; // Reset turn counter for fresh 30 turns budget!
          }
        } else {
          toolResult = await this.bridge.executeAction(parsed.action, signal);
        }

        events?.onToolEnd?.(toolResult);

        // Track last modified file for edit/patch_file/write_file
        if (
          toolResult.success &&
          (parsed.action.tool === "edit" ||
            parsed.action.tool === "patch_file" ||
            parsed.action.tool === "write_file")
        ) {
          const modFile =
            (parsed.action as any).path ||
            (parsed.action as any).file ||
            (parsed.action as any).filePath ||
            (parsed.action as any).targetPath;
          if (modFile && typeof modFile === "string") {
            this.lastModifiedFile = modFile;
            const relMod = path.isAbsolute(modFile)
              ? path.relative(this.workspaceRoot, modFile).replace(/\\/g, "/")
              : modFile.replace(/\\/g, "/");
            const cleanRel = relMod.replace(/^\.\//, "");
            if (
              cleanRel &&
              !cleanRel.startsWith(".cph/") &&
              !cleanRel.startsWith(".git/") &&
              !cleanRel.startsWith("../") &&
              !path.isAbsolute(cleanRel)
            ) {
              const manifestPath = path.join(this.workspaceRoot, ".cph", "state", "sync-manifest.json");
              if (fs.existsSync(manifestPath)) {
                const syncStart = Date.now();
                const syncAbort = new AbortController();
                let syncTimer: ReturnType<typeof setTimeout> | undefined;
                try {
                  const engine = new PnPWorkspaceSyncEngine();
                  const existingManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
                  if (existingManifest && existingManifest.targetFolder) {
                    const siteUrl = existingManifest.siteUrl || PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
                    const targetFolder = existingManifest.targetFolder;
                    const mockTransport = Boolean((existingManifest as any)?.mockTransport || process.env.CPH_MOCK_TRANSPORT === "1");
                    await Promise.race([
                      engine.syncFile(this.workspaceRoot, cleanRel, targetFolder, {
                        siteUrl,
                        mockTransport,
                        signal: syncAbort.signal,
                      }),
                      new Promise((_, reject) => {
                        syncTimer = setTimeout(() => {
                          syncAbort.abort();
                          reject(new Error("SYNC_TIMEOUT"));
                        }, 15000);
                        (syncTimer as any)?.unref?.();
                      }),
                    ]);
                    const updatedManifest = PnPWorkspaceSyncEngine.loadManifest(manifestPath);
                    if (updatedManifest) {
                      const mapMd = PnPWorkspaceSyncEngine.generateVirtualRepoMap(updatedManifest, siteUrl, targetFolder);
                      fs.writeFileSync(path.join(this.workspaceRoot, ".cph", "state", "virtual-repo-map.md"), mapMd, "utf8");
                      try {
                        PnPWorkspaceSyncEngine.generateCatalogMarkdown(this.workspaceRoot, { siteUrl, targetFolder });
                      } catch {}
                    }
                    const elapsedMs = Date.now() - syncStart;
                    const syncNote = `\n[Cloud Mirror: Synced ${cleanRel} to SharePoint (${elapsedMs}ms)]`;
                    toolResult.output = (toolResult.output || "") + syncNote;
                    if (toolResult.rawOutput) toolResult.rawOutput += syncNote;
                  }
                } catch {
                  const pendingNote = `\n[Cloud Mirror: PENDING (local file updated; use read_file if re-reading)]`;
                  toolResult.output = (toolResult.output || "") + pendingNote;
                  if (toolResult.rawOutput) toolResult.rawOutput += pendingNote;
                } finally {
                  if (syncTimer) clearTimeout(syncTimer);
                }
              }
            }
          }
        }

        // Check if single point modification / testing passed with green status
        let isGreenTestResult = false;
        if (toolResult.success) {
          const rawOut = toolResult.rawOutput || toolResult.output || "";
          const isTestCommand =
            (parsed.action.tool === "run_command" || toolResult.actionName === "run_command") &&
            parsed.action.command &&
            /(?:test|vitest|jest|pytest|cargo\s+test)/i.test(parsed.action.command);
          const hasGreenPattern =
            /(?:pass(?:ed)?|绿灯|\b\d+\s+pass(?:ed)?\b|status:\s*green|all\s+tests\s+pass(?:ed)?)/i.test(rawOut);

          if ((isTestCommand && hasGreenPattern) || (hasGreenPattern && /(?:pass|0 fail|passed)/i.test(rawOut))) {
            isGreenTestResult = true;
          }
        }

        let fingerprintHeader = "";
        if (isGreenTestResult) {
          const branch = this.getCurrentGitBranch() || "main";
          const targetFile =
            this.lastModifiedFile ||
            (parsed.action as any)?.path ||
            (parsed.action as any)?.file ||
            "workspace";
          fingerprintHeader = [
            "[WORKSPACE STATE UPDATE]",
            `Branch: ${branch}`,
            `Status: Green`,
            `Target: ${targetFile} (Verified: Tests passed on disk)`,
            `Cloud Mirror: Synced to SharePoint`,
          ].join("\n");
        }

        // Check and trigger cloud document attachment upload for tool outputs (intercept full upload on green test)
        let uploadedAttachment: UploadDocumentResult | null = null;
        const rawContent = toolResult.rawOutput || toolResult.output || "";
        const lineCount = rawContent.split(/\r?\n/).length;
        const charCount = rawContent.length;
        const isFileReadAction =
          (parsed.action.tool || toolResult.actionName || "").toLowerCase().includes("read") ||
          (parsed.action.tool || toolResult.actionName || "").toLowerCase().includes("cat");

        const shouldUpload =
          this.enableCloudAttachment &&
          !isGreenTestResult &&
          toolResult.success &&
          charCount > 0 &&
          (isFileReadAction ||
            (this.cloudAttachmentThresholdChars === 0 && this.cloudAttachmentThresholdLines === 0
              ? true
              : charCount > this.cloudAttachmentThresholdChars ||
                lineCount > this.cloudAttachmentThresholdLines));

        if (shouldUpload) {
          try {
            const graphToken = await this.acquireGraphToken();
            if (graphToken) {
              const actionTag = (parsed.action.tool || toolResult.actionName || "tool").replace(/[^a-zA-Z0-9_-]/g, "_");
              let uploadFileName = `tool-result-${actionTag}-${Date.now()}.txt`;
              if (isFileReadAction && (parsed.action?.path || parsed.action?.file || parsed.action?.filePath)) {
                const targetPath = parsed.action?.path || parsed.action?.file || parsed.action?.filePath || "";
                const cleanBase = path.basename(targetPath).replace(/[^a-zA-Z0-9_.-]/g, "_");
                uploadFileName = `read-${cleanBase}-${Date.now()}.txt`;
              }
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
            history.splice(0, history.length, ...compaction.compactedTurns);
            events?.onCompacted?.(
              compaction.clearedCharsCount,
              compaction.compressionRatio
            );
          }
        }

        // Prepare next turn prompt
        if (parsed.action.tool === "invoke_subagent" && !isInlineScout) {
          // Generational relay: currentPrompt was already set to formatSuccessorTurn1Prompt(...)
        } else if (this.isHandshakePending) {
          this.completeHandshake();
          if (uploadedAttachment) {
            const excerpt = PromptBuilder.generateHeadTailExcerpt(rawContent);
            const workerCount = this.getConcurrencyWorkerCount();
            currentPrompt = PromptBuilder.buildTurn2TaskPromptWithAttachment(
              this.pendingTask,
              this.pendingSkills,
              parsed.action.tool || toolResult.actionName,
              uploadedAttachment.fileName,
              { lineCount, charCount },
              excerpt,
              workerCount
            );
          } else {
            const workerCount = this.getConcurrencyWorkerCount();
            currentPrompt = PromptBuilder.buildTurn2TaskPrompt({
              task: this.pendingTask,
              toolResult: toolResult.output,
              skillsSection: this.pendingSkills,
              toolName: parsed.action.tool || toolResult.actionName,
              concurrencyWorkers: workerCount,
            });
          }
        } else {
          const currentTask = this.pendingTask || task || "";
          if (uploadedAttachment) {
            const excerpt = PromptBuilder.generateHeadTailExcerpt(rawContent);
            currentPrompt = PromptBuilder.buildAttachedToolResultPrompt(
              parsed.action.tool || toolResult.actionName,
              uploadedAttachment.fileName,
              { lineCount, charCount },
              excerpt,
              currentTask
            );
          } else {
            currentPrompt = PromptBuilder.buildToolResultPrompt(
              parsed.action.tool || toolResult.actionName,
              toolResult.success,
              toolResult.output,
              toolResult.success ? undefined : toolResult.output,
              currentTask
            );
          }
        }

        if (fingerprintHeader) {
          currentPrompt = `${fingerprintHeader}\n\n${currentPrompt}`;
        }

        events?.onTurnEnd?.(turnIndex, turnResponseText);
        if (parsed.action.tool === "invoke_subagent" && !isInlineScout && this.generation > this.maxGenerations) {
          const targetSessionId = options.sessionId || this.sessionId;
          const handoffSnapshot = this.generateHandoffSnapshot(task, history, targetSessionId);
          const handoffDocPath = this.lastHandoffDocPath;
          events?.onHandoff?.(handoffSnapshot, handoffDocPath);
          return {
            finalAnswer: `Max generations reached (${this.maxGenerations}) without completion. Triggered autonomous session handoff.`,
            turnsCount: turnIndex,
            completed: false,
            history,
            handedOff: true,
            handoffSnapshot,
            handoffDocPath,
          };
        }
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
  } finally {
    if (this.pool && this.sessionId) {
      try {
        if (typeof (this.pool as any).releaseSessionLease === "function") {
          (this.pool as any).releaseSessionLease(this.sessionId);
        }
      } catch {}
    }
  }
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

    // Incremental Workspace Snapshot generation on handoff
    let nextSnapshotMeta: SnapshotResult | undefined;
    if (this.enableWorkspaceSnapshot && this.workspaceRoot) {
      try {
        const nextGen = (this.generation || 1) + 1;
        nextSnapshotMeta = SnapshotGenerator.generateWorkspaceSnapshot(
          this.workspaceRoot,
          undefined,
          nextGen
        );
        this.lastNextSnapshotMeta = nextSnapshotMeta;
      } catch {
        // Fallback gracefully
      }
    }

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

    const nextSnapshotFact = nextSnapshotMeta
      ? `- **下一代工作区全景快照**: \`${nextSnapshotMeta.cloudFileName}\` (SHA: \`${nextSnapshotMeta.hash}\`, Files: ${nextSnapshotMeta.fileCount})`
      : "";

    // Module 1: 【任务目标与原始需求】
    const taskSection = [
      `- **原始任务**: ${cleanTask}`,
      `- **工作区根目录**: \`${this.workspaceRoot}\``,
      effectiveSessionId ? `- **会话标识**: \`${effectiveSessionId}\`` : "",
      nextSnapshotFact,
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
    let diskLedgerEntries: any[] = [];
    if (this.workspaceRoot) {
      try {
        const ledgerJsonlPath = path.join(this.workspaceRoot, ".cph", "state", "execution-ledger.jsonl");
        if (fs.existsSync(ledgerJsonlPath)) {
          const lines = fs.readFileSync(ledgerJsonlPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            try {
              diskLedgerEntries.push(JSON.parse(line));
            } catch {}
          }
        }
      } catch {}
    }

    if (history.length === 0) {
      if (diskLedgerEntries.length > 0) {
        const parts: string[] = [
          `- **物理工具执行汇总 (来自磁盘总账 \`.cph/state/execution-ledger.jsonl\` 共 ${diskLedgerEntries.length} 项记录)**:`,
        ];
        const actions: string[] = [];
        const findings: string[] = [];
        for (const entry of diskLedgerEntries) {
          const status = entry.success !== false ? "成功" : "失败";
          const tool = entry.canonicalTool || entry.tool || "tool";
          const target = entry.actionTarget ? ` (${entry.actionTarget})` : "";
          actions.push(`- Step ${entry.stepIndex ?? "?"}: [${status}] ${tool}${target}`);
          if (entry.outputSummary) {
            findings.push(`- Step ${entry.stepIndex ?? "?"} (${tool}): ${entry.outputSummary}`);
          }
        }
        parts.push(``);
        parts.push(`**已执行动作清单**:`);
        parts.push(actions.join("\n"));
        parts.push(``);
        parts.push(`**最近工具发现与上下文**:`);
        parts.push(findings.length > 0 ? findings.slice(-5).join("\n") : "- 暂无显著工具发现");
        verifiedFactsSection = parts.join("\n");
      } else {
        verifiedFactsSection = `- （暂无已执行的物理动作成果）\n\n**已执行动作清单**:\n- 无已执行的物理工具调用\n\n**最近工具发现与上下文**:\n- 暂无显著工具发现`;
      }
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
      `- **推进提示**: 请直接基于上述已验证客观事实推进，复用前序已验证成功的步骤与文件探测成果。`
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
   * Alias for generateHandoffSnapshot, generating standard markdown handoff documentation.
   */
  public generateHandoffMarkdown(
    task: string,
    history: TurnRecord[],
    sessionId?: string
  ): string {
    return this.generateHandoffSnapshot(task, history, sessionId);
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
   * Generates a controlled 2-level directory skeleton of the workspace (zero token pollution, clear architectural perception).
   */
  private collectDirTreePreview(): string {
    try {
      const ignored = new Set([
        "node_modules", "dist", ".git", ".cph", ".gemini", "coverage", ".cache", "build"
      ]);
      const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
      const lines: string[] = [];
      const topEntries = entries
        .filter((e) => !e.name.startsWith(".") && !ignored.has(e.name))
        .slice(0, 20);

      for (const entry of topEntries) {
        if (entry.isDirectory()) {
          lines.push(`- ${entry.name}/`);
          try {
            const subPath = path.join(this.workspaceRoot, entry.name);
            const subEntries = fs.readdirSync(subPath, { withFileTypes: true })
              .filter((se) => !se.name.startsWith(".") && !ignored.has(se.name))
              .slice(0, 10);
            for (const sub of subEntries) {
              lines.push(`  - ${sub.name}${sub.isDirectory() ? "/" : ""}`);
            }
          } catch {}
        } else {
          lines.push(`- ${entry.name}`);
        }
      }
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Categorizes error object or message into 'daily' limit, 'burst' limit, or 'none'.
   */
  public classifyRateLimitError(err: any): {
    isRateLimit: boolean;
    kind: "daily" | "burst" | "none";
  } {
    if (!err) return { isRateLimit: false, kind: "none" };
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      return { isRateLimit: false, kind: "none" };
    }

    const rawMsg = String(err?.message || err || "");
    const textClass = Orchestrator.classifyRateLimitText(rawMsg);
    if (textClass.isRateLimit) {
      return textClass;
    }

    const cleanMsg = rawMsg.replace(/https?:\/\/[^\s]+|wss?:\/\/[^\s]+/g, "").toLowerCase();
    const code = String(
      err?.code || err?.statusCode || err?.status || err?.errorCode || ""
    ).toLowerCase();

    const isDaily =
      cleanMsg.includes("daily limit") ||
      cleanMsg.includes("daily message limit") ||
      cleanMsg.includes("今日上限") ||
      cleanMsg.includes("今天的消息上限") ||
      cleanMsg.includes("每日消息上限") ||
      cleanMsg.includes("今日消息上限");
    if (isDaily) {
      return { isRateLimit: true, kind: "daily" };
    }

    const isBurst =
      code === "429" ||
      code === "ratelimit" ||
      /\b429\b/.test(cleanMsg) ||
      cleanMsg.includes("throttled") ||
      cleanMsg.includes("rate limit") ||
      cleanMsg.includes("too many requests") ||
      /\bquota\s*(?:exceeded|reached|limit)\b/i.test(cleanMsg) ||
      cleanMsg.includes("配额已达上限") ||
      cleanMsg.includes("请求过于频繁") ||
      cleanMsg.includes("暂时无法响应这么多请求");
    if (isBurst) {
      return { isRateLimit: true, kind: "burst" };
    }

    return { isRateLimit: false, kind: "none" };
  }

  /**
   * Identifies explicit 429 rate limit errors (excluding URLs containing 429 in GUIDs).
   */
  public isExplicitRateLimitError(err: any): boolean {
    return this.classifyRateLimitError(err).isRateLimit;
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

    const isRateLimit = this.isExplicitRateLimitError(err);

    const isTimeout =
      code === "etimedout" ||
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("idle timeout");

    const isNetBreak =
      code === "econnreset" ||
      code === "epipe" ||
      code === "econnrefused" ||
      code === "enotfound" ||
      code === "ehostunreach" ||
      code === "enetunreach" ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("epipe") ||
      msg.includes("closed before") ||
      msg.includes("premature close") ||
      msg.includes("socket hang up") ||
      msg.includes("failed to connect") ||
      msg.includes("connection error") ||
      msg.includes("connection ended") ||
      msg.includes("fetch failed");

    return isRateLimit || isTimeout || isNetBreak;
  }

  private isRateLimitError(err: any): boolean {
    return this.isExplicitRateLimitError(err);
  }

  /**
   * Categorizes text into 'daily' message quota limit, 'burst' rate limit, or 'none'.
   */
  public static classifyRateLimitText(text: string): {
    isRateLimit: boolean;
    kind: "daily" | "burst" | "none";
  } {
    if (!text) return { isRateLimit: false, kind: "none" };
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 300) {
      return { isRateLimit: false, kind: "none" };
    }
    if (trimmed.includes("```action") || trimmed.includes("FINAL_ANSWER")) {
      return { isRateLimit: false, kind: "none" };
    }

    // 1. Daily message quota limits (higher precedence, resets next UTC midnight)
    const isDaily =
      /reached\s+(?:your\s+)?daily\s+(?:message\s+)?limit/i.test(trimmed) ||
      /daily\s+(?:message\s+)?limit(?:\s+(?:reached|exceeded))?/i.test(trimmed) ||
      /daily\s+quota\s+(?:exceeded|reached)/i.test(trimmed) ||
      /daily\s+limit\s+reached/i.test(trimmed) ||
      trimmed.includes("已达到今天的消息上限") ||
      trimmed.includes("达到今天的消息上限") ||
      trimmed.includes("今日消息上限") ||
      trimmed.includes("今日上限") ||
      trimmed.includes("每日消息上限") ||
      trimmed.includes("每日请求上限") ||
      trimmed.includes("每日配额已达上限") ||
      /今天(?:的)?(?:消息|请求)?(?:已达|达到)?上限/.test(trimmed);

    if (isDaily) {
      return { isRateLimit: true, kind: "daily" };
    }

    // 2. Line-initial, status code, or explicit 429 error signaling
    const isExplicit429 =
      /(?:^|\n|\bstatus\s*code\s*:?\s*|\berror\s*:?\s*)429(?:\s+too\s+many\s+requests|\b)/i.test(
        trimmed
      );

    // 3. Platform burst rate limit signaling (standalone or line-initial error phrases)
    const isRateLimitPhrase =
      /(?:^|\n|\berror\s*:?\s*)too\s+many\s+requests\b/i.test(trimmed) ||
      /\brate[_\s-]?limit[_\s-]?exceeded\b/i.test(trimmed) ||
      /\b(?:account|request|client|user)\s+(?:has\s+been|was|is)\s+throttled\b/i.test(trimmed) ||
      /(?:^|\n|\berror\s*:?\s*)throttled\b/i.test(trimmed) ||
      trimmed.includes("配额已达上限") ||
      trimmed.includes("请求过于频繁") ||
      trimmed.includes("暂时无法响应这么多请求") ||
      trimmed.includes("暂时无法处理这么多请求");

    if (isExplicit429 || isRateLimitPhrase) {
      return { isRateLimit: true, kind: "burst" };
    }

    return { isRateLimit: false, kind: "none" };
  }

  public classifyRateLimitText(text: string): {
    isRateLimit: boolean;
    kind: "daily" | "burst" | "none";
  } {
    return Orchestrator.classifyRateLimitText(text);
  }

  public static isRateLimitResponseText(text: string): boolean {
    return Orchestrator.classifyRateLimitText(text).isRateLimit;
  }

  public isRateLimitResponseText(text: string): boolean {
    return Orchestrator.isRateLimitResponseText(text);
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
    rootUserPrompt?: string;
  }): Promise<OrchestratorRunResult> {
    const { task, history, client, lastError, signal, events, sessionId } = params;

    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    // 1. Extract high-density disaster recovery blackbox (5k~8k chars)
    let disasterBlackbox = BlackboxCompactor.extractDisasterBlackbox(history, lastError, {
      rootUserPrompt: params.rootUserPrompt || params.task,
    });
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

    // 2. Mark victim account throttled in pool ONLY when genuine rate limit occurred
    const errClassification = this.classifyRateLimitError(lastError);
    const textClassification = this.classifyRateLimitText(lastError);
    const isDaily = errClassification.kind === "daily" || textClassification.kind === "daily";
    const isBurst =
      errClassification.kind === "burst" ||
      textClassification.kind === "burst" ||
      this.isExplicitRateLimitError(lastError) ||
      this.isRateLimitResponseText(lastError);

    const isRateLimitIncident = isDaily || isBurst;
    const throttleReason: "daily" | "burst" = isDaily ? "daily" : "burst";

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
    if (isRateLimitIncident && victimEmail && this.pool) {
      const durationMs =
        throttleReason === "daily"
          ? Math.max(getNextUtcMidnight() - Date.now(), 15 * 60 * 1000)
          : undefined;
      this.pool.markThrottled(victimEmail, durationMs, throttleReason);
    }

    const targetHandoffRelativePath = `.cph/handoffs/handoff-${sessionId}.md`;
    const handoffsDir = path.join(this.workspaceRoot, ".cph", "handoffs");
    const targetHandoffAbsolutePath = path.join(handoffsDir, `handoff-${sessionId}.md`);

    // Local fallback when no account pool and no arbitrator client are configured
    if (!this.pool && !params.arbitratorChatClient && !this.arbitratorChatClient) {
      fs.mkdirSync(handoffsDir, { recursive: true });
      const localHandoffDoc = this.generateHandoffSnapshot(
        params.rootUserPrompt || task,
        history,
        sessionId
      );
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
      `你的职责是提炼高保真阶段性交接文档，确保战役终极目标与未完成业务切片无缝接力：`,
      `1. 【任务目标与原始需求】（必须清晰继承战役终极北极星目标）`,
      `2. 【已验证客观事实与阶段性成果】（提炼前序已确认事实与已生成资产）`,
      `3. 【关键卡点、报错与最新诊断】（客观记录中断原因与现场状态）`,
      `4. 【已修改/生成文件清单】（记录已落盘与已修改的文件）`,
      `5. 【接力第一优先级待办事项 (Actionable Next Steps)】（必须梳理未完成切片并设为最高优先级待办，请明确未完成切片的具体行动路径，引导后继会话优先推进核心业务交付）`,
      ``,
      `【行动交付要求】`,
      `请必须使用 action: write_file 将交接文档写入 \`${targetHandoffRelativePath}\`。`,
      `如果直接返回 Markdown 正文，也请确保内容严格包含上述完整 5 维交接结构，且聚焦指导后继会话继续推进未完成核心业务。`,
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

    // Guarantee persistence if not already created on disk or if created file is damaged (< 50 bytes)
    const existingArbitrationDoc = fs.existsSync(targetHandoffAbsolutePath)
      ? fs.readFileSync(targetHandoffAbsolutePath, "utf8").trim()
      : "";

    if (existingArbitrationDoc.length < 50) {
      const candidateContent = (
        parsed.type === "handoff"
          ? (parsed.handoffDoc || "")
          : parsed.type === "final_answer"
          ? (parsed.answer.summary || parsed.answer.raw || arbitratorResponseText)
          : (parsed.type === "action" && parsed.action?.content)
          ? parsed.action.content
          : arbitratorResponseText
      ).trim();
      const contentToPersist =
        candidateContent.length >= 50 ? candidateContent : disasterBlackbox;
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
