import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocket, type RawData } from "ws";
import { SessionManager } from "../session/session-manager.ts";
import { scanWorkspaceFiles, type WorkspaceFile } from "./file-tree.ts";
import { AccountPool, type AccountStatus } from "../auth/account-pool.ts";
import { ChatHubClient } from "../transport/chathub-client.ts";
import { SkillLoader, type Skill } from "../skills/skill-loader.ts";
import { SkillRegistry } from "../skills/skill-registry.ts";
import {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
} from "../agent/subagent-runner.ts";
import { PnPWorkspaceSyncEngine } from "../workspace/pnp-sync-engine.ts";

export interface CloudWorkspaceConfig {
  siteUrl: string;
  targetFolder: string;
  lastSyncedAt?: string;
  verified?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  output?: string;
  diff?: string;
  durationMs?: number;
}

export interface Turn {
  id: string;
  turnNumber: number;
  userMessage: {
    text: string;
    attachments?: Array<{ name: string; path: string; size?: number }>;
  };
  reasoning?: {
    text: string;
    isStreaming: boolean;
  };
  assistantText?: string;
  tools: ToolCall[];
  status: "streaming" | "completed" | "interrupted" | "error";
  metrics?: {
    durationMs: number;
    tokensIn?: number;
    tokensOut?: number;
    tps?: number;
    model: string;
  };
}

export interface LedgerEntry {
  stepId: number;
  timestamp: number;
  toolName: string;
  argsHash: string;
  exitCode: number;
  durationMs: number;
  evidencePath?: string;
}

export interface ContextMetrics {
  usedTokens: number;
  maxTokens: number;
  workingMemoryPercent: number;
  activeSkills: string[];
  fingerprintTOC: string[];
  activeAgent: string;
}

export interface AccountInfo {
  email: string;
  isAvailable: boolean;
  isThrottled: boolean;
  isAllowed: boolean;
  isLeased?: boolean;
  leasedBy?: string;
  cooldownUntil: number;
  cooldownRemainingSec: number;
  totalRequests: number;
  throttledCount: number;
  throttleReason?: "daily" | "burst" | "agent_ineligible";
}

export interface CustomAgentItem {
  id: string;
  name: string;
  agentId: string;
  role: "main" | "coder" | "researcher" | "custom";
  description?: string;
  createdAt?: number;
}

export interface AgentConfig {
  customAgentId?: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  defaultMain: string;
  defaultCoder: string;
  defaultResearcher: string;
  customAgents?: CustomAgentItem[];
}

export interface WsPacket<T = unknown> {
  type: string;
  payload?: T;
}

export interface RpcHandlerOptions {
  workspaceRoot?: string | null;
  sessionManager?: SessionManager;
  orchestrator?: any;
  ledger?: any;
  pool?: AccountPool;
  cliApp?: any;
  skillRegistry?: SkillRegistry;
  skillLoader?: SkillLoader;
}

export class RpcHandler {
  private ws: WebSocket;
  private options: RpcHandlerOptions;
  private sessionManager?: SessionManager;
  private activeSessionId: string | null = null;
  private inMemorySessions: SessionSummary[] = [];
  private turns: Turn[] = [];
  private running: boolean = false;
  private isInterrupted: boolean = false;
  private workspaceRoot: string | null = null;
  private cloudWorkspace: CloudWorkspaceConfig | null = null;
  private recentWorkspaces: string[] = [];
  private pool: AccountPool;
  private agentConfig: AgentConfig;
  private skillRegistry: SkillRegistry;
  private activeAbortController?: AbortController;

  public static getGlobalConfigPath(): string {
    if (process.env.CPH_GLOBAL_CONFIG_PATH) {
      return process.env.CPH_GLOBAL_CONFIG_PATH;
    }
    return path.join(os.homedir(), ".cph", "global-config.json");
  }

  private getGlobalConfigPath(): string {
    return RpcHandler.getGlobalConfigPath();
  }

  private saveGlobalConfig(updates: Record<string, any>): void {
    try {
      const globalConfigPath = this.getGlobalConfigPath();
      const dir = path.dirname(globalConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let current: Record<string, any> = {};
      if (fs.existsSync(globalConfigPath)) {
        try {
          current = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
        } catch {
          current = {};
        }
      }
      Object.assign(current, updates);
      fs.writeFileSync(globalConfigPath, JSON.stringify(current, null, 2), "utf-8");
    } catch (err: any) {
      console.warn("[RpcHandler] Failed to save global config:", err.message);
    }
  }

  constructor(ws: WebSocket, options: RpcHandlerOptions = {}) {
    this.ws = ws;
    this.options = options;

    if (typeof options.workspaceRoot === "string") {
      this.workspaceRoot = path.resolve(options.workspaceRoot);
    } else if (options.workspaceRoot === null) {
      this.workspaceRoot = null;
    } else {
      // options.workspaceRoot === undefined
      try {
        const globalConfigPath = this.getGlobalConfigPath();
        if (fs.existsSync(globalConfigPath)) {
          const raw = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
          if (
            raw.lastWorkspace &&
            typeof raw.lastWorkspace === "string" &&
            fs.existsSync(raw.lastWorkspace)
          ) {
            this.workspaceRoot = path.resolve(raw.lastWorkspace);
          } else {
            this.workspaceRoot = null;
          }
        } else {
          this.workspaceRoot = null;
        }
      } catch {
        this.workspaceRoot = null;
      }
    }

    if (this.workspaceRoot) {
      this.recentWorkspaces = [this.workspaceRoot];
      try {
        const configPath = path.join(this.workspaceRoot, ".cph", "config.json");
        if (fs.existsSync(configPath)) {
          const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (raw.cloudWorkspace) {
            this.cloudWorkspace = raw.cloudWorkspace;
          }
        }
      } catch {
        // ignore
      }
    } else {
      this.recentWorkspaces = [];
      this.cloudWorkspace = null;
    }

    this.pool = options.pool || new AccountPool();
    this.skillRegistry =
      options.skillRegistry ||
      (options.cliApp && typeof options.cliApp.getSkillRegistry === "function"
        ? options.cliApp.getSkillRegistry()
        : new SkillRegistry(
            options.skillLoader ||
              new SkillLoader(this.workspaceRoot || process.cwd())
          ));
    try {
      this.skillRegistry.loadSkills();
    } catch {
      // ignore
    }

    this.agentConfig = this.loadAgentConfig();

    if (this.workspaceRoot) {
      try {
        this.sessionManager =
          options.sessionManager || new SessionManager(this.workspaceRoot);
      } catch {
        // Fallback to in-memory mode if SessionManager initialization fails
      }
    } else {
      this.sessionManager = undefined;
    }

    this.ws.on("message", (data: RawData) => this.handleMessage(data));
    this.ws.on("error", (err) => {
      console.warn("[RpcHandler] WebSocket error:", err.message);
    });

    // Send initial snapshot on client connection
    this.sendSnapshot();
  }

  /**
   * Send a typed packet to the client
   */
  public send<T = unknown>(type: string, payload: T = {} as T): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type, payload }));
      } catch (err: any) {
        console.warn(`[RpcHandler] Failed to send packet ${type}:`, err.message);
      }
    }
  }

  /**
   * Handle incoming raw WebSocket messages
   */
  private handleMessage(data: RawData | string): void {
    try {
      const rawStr = typeof data === "string" ? data : data.toString("utf-8");
      const packet = JSON.parse(rawStr) as WsPacket<any>;
      if (!packet || typeof packet.type !== "string") return;

      switch (packet.type) {
        case "session:new":
          this.handleSessionNew(packet.payload);
          break;
        case "session:select":
          this.handleSessionSelect(packet.payload);
          break;
        case "workspace:set":
          this.handleWorkspaceSet(packet.payload);
          break;
        case "workspace:verify-cloud":
          this.handleWorkspaceVerifyCloud(packet.payload);
          break;
        case "workspace:sync-cloud":
          this.handleWorkspaceSyncCloud(packet.payload);
          break;
        case "accounts:list":
          this.send("accounts:update", this.getAccountsPayload());
          break;
        case "accounts:toggle":
          this.handleAccountToggle(packet.payload);
          break;
        case "accounts:whitelist":
          this.handleAccountWhitelist(packet.payload);
          break;
        case "accounts:reset-cooldown":
          this.handleAccountResetCooldown(packet.payload);
          break;
        case "agent:get":
          this.send("agent:update", this.getAgentConfigPayload());
          break;
        case "agent:set":
          this.handleAgentSet(packet.payload);
          break;
        case "agent:reset":
          this.handleAgentReset(packet.payload);
          break;
        case "agent:add-custom":
          this.handleAgentAddCustom(packet.payload);
          break;
        case "agent:remove-custom":
          this.handleAgentRemoveCustom(packet.payload);
          break;
        case "user:submit":
          this.handleUserSubmit(packet.payload);
          break;
        case "user:interrupt":
          this.handleUserInterrupt();
          break;
        case "skills:list":
          this.send("skills:update", {
            availableSkills: this.getAvailableSkillsPayload(),
            activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
            agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills()),
          });
          break;
        case "skills:activate":
          if (packet.payload?.name) {
            this.skillRegistry.activateSkill(packet.payload.name);
            const active = this.skillRegistry.getActiveSkills().map((s) => s.name);
            this.send("context:update", { activeSkills: active });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: active,
              agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills()),
            });
          }
          break;
        case "skills:deactivate":
          if (packet.payload?.name) {
            this.skillRegistry.deactivateSkill(packet.payload.name);
            const active = this.skillRegistry.getActiveSkills().map((s) => s.name);
            this.send("context:update", { activeSkills: active });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: active,
              agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills()),
            });
          }
          break;
        case "skills:toggle-mounted":
          if (packet.payload?.name) {
            const isMounted = this.skillRegistry.toggleAgentMounted(packet.payload.name);
            const mountedArr = Array.from(this.skillRegistry.getAgentMountedSkills());
            this.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
              agentMountedSkills: mountedArr,
            });
            this.send("terminal:chunk", {
              stream: "system",
              content: `[Skill Registry] 技能 [${packet.payload.name}] 挂载模式已切换为: ${isMounted ? "Agent 内置已挂载 (免附件)" : "动态随任务挂载 (全量附件)"}\n`,
            });
          }
          break;
        case "skills:set-mounted":
          if (Array.isArray(packet.payload?.names)) {
            this.skillRegistry.setAgentMountedSkills(packet.payload.names);
            const mountedArr = Array.from(this.skillRegistry.getAgentMountedSkills());
            this.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
            this.send("skills:update", {
              availableSkills: this.getAvailableSkillsPayload(),
              activeSkills: this.skillRegistry.getActiveSkills().map((s) => s.name),
              agentMountedSkills: mountedArr,
            });
            this.send("terminal:chunk", {
              stream: "system",
              content: `[Skill Registry] 已同步更新 Agent 内置挂载技能清单 (共 ${mountedArr.length} 项)\n`,
            });
          }
          break;
        default:
          break;
      }
    } catch (err: any) {
      console.warn("[RpcHandler] Failed to parse message:", err.message);
    }
  }

  /**
   * Retrieve session list from SessionManager or memory
   */
  private getSessionsList(): SessionSummary[] {
    if (this.sessionManager) {
      try {
        const list = this.sessionManager.listSessions();
        if (list && list.length > 0) {
          return list.map((item) => ({
            id: item.id,
            title: item.title,
            createdAt: new Date(item.createdAt).getTime(),
            updatedAt: new Date(item.updatedAt).getTime(),
            messageCount: item.turnCount || 0,
            cwd: item.workspaceRoot || this.options.workspaceRoot || process.cwd(),
          }));
        }
      } catch {
        // ignore
      }
    }

    if (this.inMemorySessions.length === 0) {
      const defaultId = `ses_${Date.now()}`;
      this.inMemorySessions.push({
        id: defaultId,
        title: "默认会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        cwd: this.options.workspaceRoot || process.cwd(),
      });
      this.activeSessionId = defaultId;
    }

    return this.inMemorySessions;
  }

  /**
   * Load turns for an active session
   */
  private loadSessionTurns(sessionId: string): void {
    if (!this.sessionManager) return;
    try {
      const record = this.sessionManager.loadSession(sessionId);
      if (record && Array.isArray(record.turns)) {
        this.turns = record.turns.map((t, idx) => ({
          id: `turn-${idx + 1}`,
          turnNumber: t.turnNumber || idx + 1,
          userMessage: { text: t.userInput || "" },
          reasoning: t.modelReasoning
            ? { text: t.modelReasoning, isStreaming: false }
            : undefined,
          assistantText: t.modelResponse || "",
          tools: (t.toolCalls || []).map((tc, tcIdx) => ({
            id: `tool-${idx}-${tcIdx}`,
            name: tc.tool,
            args: tc.args || {},
            status: tc.success === false ? "failed" : "completed",
            output: tc.output,
          })),
          status: "completed",
        }));
      } else {
        this.turns = [];
      }
    } catch {
      this.turns = [];
    }
  }

  /**
   * Get available skills payload for web client
   */
  public getAvailableSkillsPayload(): Array<{
    name: string;
    description: string;
    source: string;
    isAgentMounted: boolean;
  }> {
    return this.skillRegistry.getAvailableSkills().map((s) => ({
      name: s.name,
      description: s.description || "",
      source: s.source || "user",
      isAgentMounted: this.skillRegistry.isAgentMounted(s.name),
    }));
  }

  /**
   * Send the full session:snapshot packet to client
   */
  public sendSnapshot(): void {
    const sessions = this.getSessionsList();
    if (!this.activeSessionId && sessions.length > 0) {
      this.activeSessionId = sessions[0].id;
    }

    const activeSkillNames = this.skillRegistry.getActiveSkills().map((s) => s.name);
    const contextMetrics: ContextMetrics = {
      usedTokens: 18420,
      maxTokens: 128000,
      workingMemoryPercent: 14.4,
      activeSkills:
        activeSkillNames.length > 0
          ? activeSkillNames
          : ["handoff", "tdd", "systematic-debugging"],
      fingerprintTOC: [
        "CPH-PI/src/cli.ts",
        "CPH-PI/src/web/server.ts",
        "CPH-PI/src/session/session-manager.ts",
      ],
      activeAgent: this.agentConfig.customAgentId ? "专属智能体直连" : "cph-dev-agent",
    };

    const workspaceFiles = this.workspaceRoot ? scanWorkspaceFiles(this.workspaceRoot) : [];

    const accountsPayload = this.getAccountsPayload();

    this.send("session:snapshot", {
      sessions,
      activeSessionId: this.activeSessionId,
      turns: this.turns,
      ledgerEntries: [],
      contextMetrics,
      running: this.running,
      workspaceRoot: this.workspaceRoot,
      cloudWorkspace: this.cloudWorkspace,
      recentWorkspaces: this.recentWorkspaces,
      workspaceFiles,
      accounts: accountsPayload.accounts,
      allowedAccounts: accountsPayload.allowedAccounts,
      agentConfig: this.getAgentConfigPayload(),
      availableSkills: this.getAvailableSkillsPayload(),
      agentMountedSkills: Array.from(this.skillRegistry.getAgentMountedSkills()),
    });
  }

  /**
   * Handle workspace:set packet to dynamically switch host directory and cloud pairing
   */
  private handleWorkspaceSet(payload?: {
    path?: string;
    cloudWorkspace?: CloudWorkspaceConfig;
  }): void {
    if (!payload?.path && !this.workspaceRoot) {
      this.send("workspace:error", { message: "工作区路径不能为空" });
      return;
    }

    if (payload?.path) {
      const targetPath = path.resolve(payload.path);
      try {
        if (!fs.existsSync(targetPath)) {
          this.send("workspace:error", { message: `工作区路径不存在: ${targetPath}` });
          return;
        }
        const stat = fs.statSync(targetPath);
        if (!stat.isDirectory()) {
          this.send("workspace:error", { message: `指定路径不是有效文件夹: ${targetPath}` });
          return;
        }

        this.workspaceRoot = targetPath;
        this.options.workspaceRoot = targetPath;

        if (payload.cloudWorkspace !== undefined) {
          this.cloudWorkspace = payload.cloudWorkspace;
        }

        // Update recent workspaces (prepend, dedup, max 5)
        this.recentWorkspaces = [
          targetPath,
          ...this.recentWorkspaces.filter((p) => p !== targetPath),
        ].slice(0, 5);

        this.skillRegistry = new SkillRegistry(new SkillLoader(this.workspaceRoot));
        try {
          const configPath = path.join(this.workspaceRoot, ".cph", "config.json");
          if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            if (Array.isArray(raw.agentMountedSkills)) {
              this.skillRegistry.setAgentMountedSkills(raw.agentMountedSkills);
            }
            if (raw.cloudWorkspace && payload.cloudWorkspace === undefined) {
              this.cloudWorkspace = raw.cloudWorkspace;
            }
          }
          this.skillRegistry.loadSkills();
        } catch {
          // ignore
        }

        try {
          this.sessionManager = new SessionManager(this.workspaceRoot);
        } catch {
          // Fallback to current
        }

        this.saveWorkspaceConfig({
          workspaceRoot: this.workspaceRoot,
          cloudWorkspace: this.cloudWorkspace,
        });
        this.saveGlobalConfig({ lastWorkspace: this.workspaceRoot });

        const workspaceFiles = scanWorkspaceFiles(this.workspaceRoot);

        this.send("workspace:update", {
          workspaceRoot: this.workspaceRoot,
          cloudWorkspace: this.cloudWorkspace,
          recentWorkspaces: this.recentWorkspaces,
          workspaceFiles,
        });

        // Also refresh sessions list in new workspace
        this.sendSnapshot();
      } catch (err: any) {
        this.send("workspace:error", { message: `切换工作区失败: ${err.message}` });
      }
      return;
    }

    if (payload?.cloudWorkspace !== undefined) {
      this.cloudWorkspace = payload.cloudWorkspace;
      this.saveWorkspaceConfig({
        workspaceRoot: this.workspaceRoot,
        cloudWorkspace: this.cloudWorkspace,
      });
      const workspaceFiles = this.workspaceRoot ? scanWorkspaceFiles(this.workspaceRoot) : [];
      this.send("workspace:update", {
        workspaceRoot: this.workspaceRoot,
        cloudWorkspace: this.cloudWorkspace,
        recentWorkspaces: this.recentWorkspaces,
        workspaceFiles,
      });
      this.sendSnapshot();
    }
  }

  /**
   * Handle workspace:verify-cloud packet to verify SharePoint mirror before sync
   */
  private async handleWorkspaceVerifyCloud(payload?: {
    siteUrl?: string;
    targetFolder?: string;
    workspaceRoot?: string;
    mockTransport?: boolean;
  }): Promise<void> {
    const wsRoot = payload?.workspaceRoot || this.workspaceRoot;
    if (!wsRoot) {
      this.send("workspace:verify-result", {
        valid: false,
        reason: "未指定工作区路径 (No workspace root specified)",
        details: null,
      });
      return;
    }

    try {
      const engine = new PnPWorkspaceSyncEngine();
      const siteUrl =
        payload?.siteUrl ||
        this.cloudWorkspace?.siteUrl ||
        PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
      const targetFolder =
        payload?.targetFolder ||
        this.cloudWorkspace?.targetFolder ||
        PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

      const res = await engine.verifyCloudMirror({
        workspaceRoot: wsRoot,
        siteUrl,
        targetFolder,
        mockTransport: payload?.mockTransport,
      });

      this.send("workspace:verify-result", {
        valid: res.valid,
        reason: res.reason,
        details: res,
      });
    } catch (err: any) {
      this.send("workspace:verify-result", {
        valid: false,
        reason: err.message || "Cloud workspace verification failed",
        details: null,
      });
    }
  }

  /**
   * Handle workspace:sync-cloud packet to perform incremental SharePoint sync
   */
  private async handleWorkspaceSyncCloud(payload?: {
    siteUrl?: string;
    targetFolder?: string;
    workspaceRoot?: string;
    mockTransport?: boolean;
    skipVerify?: boolean;
  }): Promise<void> {
    const wsRoot = payload?.workspaceRoot || this.workspaceRoot;
    if (!wsRoot) {
      this.send("workspace:sync-report", {
        status: "failed",
        error: "未指定工作区路径 (No workspace root specified)",
      });
      return;
    }

    const siteUrl =
      payload?.siteUrl ||
      this.cloudWorkspace?.siteUrl ||
      PnPWorkspaceSyncEngine.DEFAULT_SITE_URL;
    const targetFolder =
      payload?.targetFolder ||
      this.cloudWorkspace?.targetFolder ||
      PnPWorkspaceSyncEngine.DEFAULT_TARGET_FOLDER;

    this.send("terminal:chunk", {
      stream: "system",
      content: `[SharePoint Sync] 开始云端对账: ${targetFolder}\n`,
    });

    try {
      const engine = new PnPWorkspaceSyncEngine();
      const report = await engine.syncCloudWorkspace({
        workspaceRoot: wsRoot,
        siteUrl,
        targetFolder,
        mockTransport: payload?.mockTransport,
        skipVerify: payload?.skipVerify,
      });

      const nowIso = new Date().toISOString();
      if (!this.cloudWorkspace) {
        this.cloudWorkspace = {
          siteUrl,
          targetFolder,
          verified: true,
          lastSyncedAt: nowIso,
        };
      } else {
        this.cloudWorkspace.lastSyncedAt = nowIso;
        this.cloudWorkspace.verified = true;
      }

      if (!this.workspaceRoot) {
        this.workspaceRoot = path.resolve(wsRoot);
      }
      this.saveWorkspaceConfig({ cloudWorkspace: this.cloudWorkspace });

      this.send("terminal:chunk", {
        stream: "system",
        content: `[SharePoint Sync] 对账完成: 同步 ${report.syncedCount} 个, 跳过 ${report.skippedCount} 个, 清理 ${report.prunedCount} 个, 失败 ${report.failedCount} 个 (${report.durationMs}ms)\n`,
      });

      this.send("workspace:sync-report", {
        status: "completed",
        report,
      });
    } catch (err: any) {
      this.send("terminal:chunk", {
        stream: "stderr",
        content: `[SharePoint Sync] 对账失败: ${err.message}\n`,
      });
      this.send("workspace:sync-report", {
        status: "failed",
        error: err.message,
      });
    }
  }

  /**
   * Handle session:new packet
   */
  private handleSessionNew(payload?: { title?: string }): void {
    const title = payload?.title || "新会话";
    let newId = `ses_${Date.now()}`;

    if (this.sessionManager) {
      try {
        const created = this.sessionManager.createSession({
          title,
          workspaceRoot: this.options.workspaceRoot,
        });
        newId = created.id;
      } catch {
        this.inMemorySessions.unshift({
          id: newId,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
          cwd: this.options.workspaceRoot || process.cwd(),
        });
      }
    } else {
      this.inMemorySessions.unshift({
        id: newId,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        cwd: this.options.workspaceRoot || process.cwd(),
      });
    }

    this.activeSessionId = newId;
    this.turns = [];
    this.sendSnapshot();
  }

  /**
   * Handle session:select packet
   */
  private handleSessionSelect(payload?: { sessionId: string }): void {
    if (payload?.sessionId) {
      this.activeSessionId = payload.sessionId;
      this.loadSessionTurns(payload.sessionId);
      this.sendSnapshot();
    }
  }

  /**
   * Handle user:submit packet
   */
  /**
   * Handle user:submit packet
   */
  public async handleUserSubmit(payload: {
    text: string;
    attachments?: Array<{ name: string; path: string; size?: number }>;
  }): Promise<void> {
    const rawText = payload?.text || "";
    this.running = true;
    this.isInterrupted = false;

    let targetSkill: Skill | undefined = undefined;
    let executionTask = rawText;

    if (rawText.trim().startsWith("/")) {
      const parsedSlash = this.skillRegistry.parseSlashCommand(rawText.trim());
      if (parsedSlash.skill) {
        targetSkill = parsedSlash.skill;
        this.skillRegistry.activateSkill(targetSkill.name);
        executionTask = parsedSlash.task || rawText;

        // Broadcast active skills update to UI
        const activeSkillNames = this.skillRegistry.getActiveSkills().map((s) => s.name);
        this.send("context:update", { activeSkills: activeSkillNames });
      }
    }

    const turnId = `turn-${Date.now()}`;
    const newTurn: Turn = {
      id: turnId,
      turnNumber: this.turns.length + 1,
      userMessage: {
        text: rawText,
        attachments: payload?.attachments,
      },
      reasoning: {
        text: targetSkill
          ? (this.skillRegistry.isAgentMounted(targetSkill.name)
              ? `🎯 已唤醒 Agent 内置技能: [${targetSkill.name}] (已内化于专属知识库，免附件轻量化传输)\n${targetSkill.description ? `说明: ${targetSkill.description}\n\n` : "\n"}`
              : `🎯 已动态全量挂载技能: [${targetSkill.name}] (随任务下发完整规范手册与附件)\n${targetSkill.description ? `说明: ${targetSkill.description}\n\n` : "\n"}`)
          : "",
        isStreaming: true,
      },
      assistantText: "",
      tools: [],
      status: "streaming",
    };
    this.turns.push(newTurn);

    if (this.options.orchestrator) {
      try {
        await this.runOrchestrator(newTurn, executionTask, targetSkill);
      } catch (err: any) {
        newTurn.status = "error";
        this.send("turn:end", { error: err?.message || String(err) });
      } finally {
        this.running = false;
      }
    } else {
      await this.runDefaultGeneration(newTurn, executionTask, targetSkill);
    }
  }

  /**
   * Run generation using the orchestrator with full event streaming
   */
  private async runOrchestrator(
    turn: Turn,
    task: string,
    targetSkill?: Skill
  ): Promise<void> {
    const orchestrator = this.options.orchestrator;
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const skillsToUse = targetSkill ? [targetSkill] : this.skillRegistry.getActiveSkills();
    const sessionId = this.activeSessionId || `ses_${Date.now()}`;
    const startTime = Date.now();
    let toolCounter = 0;

    // Check if orchestrator supports the full run(options) contract
    if (typeof orchestrator.run === "function") {
      try {
        await orchestrator.run({
          task,
          sessionId,
          signal: abortController.signal,
          activeSkills: skillsToUse,
          events: {
            onDelta: (chunk: string) => {
              if (this.isInterrupted) return;
              if (turn.reasoning) turn.reasoning.isStreaming = false;
              turn.assistantText = (turn.assistantText || "") + chunk;
              this.send("assistant:chunk", { chunk });
            },
            onReasoning: (chunk: string) => {
              if (this.isInterrupted) return;
              if (turn.reasoning) {
                turn.reasoning.text += chunk;
                turn.reasoning.isStreaming = true;
              }
              this.send("reasoning:chunk", { chunk });
            },
            onTurnStart: (turnNum: number) => {
              this.send("terminal:chunk", {
                stream: "system",
                content: `[Copilot Engine] 轮次 ${turnNum} 开始执行...\n`,
              });
            },
            onToolStart: (action: any) => {
              toolCounter++;
              const toolId = `tool-${Date.now()}-${toolCounter}`;
              const toolName = action?.tool || action?.action || "tool";
              const toolArgs = action?.args || action || {};
              const toolCall: ToolCall = {
                id: toolId,
                name: toolName,
                args: toolArgs,
                status: "running",
              };
              turn.tools.push(toolCall);
              this.send("tool:update", { tool: toolCall, turnId: turn.id });
              this.send("terminal:chunk", {
                stream: "stdout",
                content: `$ ${toolName} ${JSON.stringify(toolArgs)}\n`,
              });
            },
            onToolEnd: (result: any) => {
              const lastTool = turn.tools[turn.tools.length - 1];
              if (lastTool) {
                lastTool.status = result?.success === false ? "failed" : "completed";
                lastTool.output = result?.output || result?.content || "";
                lastTool.durationMs = result?.durationMs;
                if (result?.diff) lastTool.diff = result.diff;
                this.send("tool:update", { tool: lastTool, turnId: turn.id });
              }
              if (result?.stepId || result?.exitCode !== undefined) {
                const entry: LedgerEntry = {
                  stepId: result.stepId || toolCounter,
                  timestamp: Date.now(),
                  toolName: lastTool?.name || "tool",
                  argsHash: result.argsHash || "sha256:auto",
                  exitCode: result.exitCode ?? (result.success ? 0 : 1),
                  durationMs: result.durationMs || 0,
                  evidencePath: result.evidencePath,
                };
                this.send("wal:append", entry);
              }
            },
            onCompleted: (ans: string) => {
              if (turn.reasoning) turn.reasoning.isStreaming = false;
              turn.status = "completed";
              const durationMs = Date.now() - startTime;
              turn.metrics = {
                durationMs,
                model: "copilot-substrate",
                tps: 42,
              };
              this.send("turn:end", { metrics: turn.metrics });
            },
            onError: (err: Error) => {
              turn.status = "error";
              this.send("turn:end", { error: err.message });
            },
            onAttachmentUploaded: (attachment: any, toolName: string) => {
              this.send("terminal:chunk", {
                stream: "system",
                content: `[Substrate] 已无损上传附件: ${attachment.fileName || attachment.name} (${toolName})\n`,
              });
            },
          },
        });
      } catch (err: any) {
        if (abortController.signal.aborted || this.isInterrupted) {
          turn.status = "interrupted";
          this.send("turn:end", { status: "interrupted" });
        } else {
          throw err;
        }
      } finally {
        this.activeAbortController = undefined;
      }
    } else if (typeof orchestrator.runTurn === "function") {
      // Compatibility with runTurn test mocks
      await orchestrator.runTurn(task, {
        onReasoning: (chunk: string) => {
          if (this.isInterrupted) return;
          if (turn.reasoning) turn.reasoning.text += chunk;
          this.send("reasoning:chunk", { chunk });
        },
        onAssistant: (chunk: string) => {
          if (this.isInterrupted) return;
          if (turn.reasoning) turn.reasoning.isStreaming = false;
          turn.assistantText = (turn.assistantText || "") + chunk;
          this.send("assistant:chunk", { chunk });
        },
      });
      turn.status = "completed";
      this.send("turn:end", { metrics: turn.metrics });
    } else {
      await this.runDefaultGeneration(turn, task, targetSkill);
    }
  }

  /**
   * Default streaming execution for standalone/test modes
   */
  private async runDefaultGeneration(
    turn: Turn,
    text: string,
    targetSkill?: Skill
  ): Promise<void> {
    const startTime = Date.now();
    const isMounted = targetSkill ? this.skillRegistry.isAgentMounted(targetSkill.name) : false;

    const skillPrefix = targetSkill
      ? (isMounted
          ? `已唤醒 Agent 内置专业技能【${targetSkill.name}】(知识库内化免附件)。\n`
          : `已识别并动态全量挂载专业技能【${targetSkill.name}】(随任务下发附件)。\n`)
      : "";
    const r1 = `${skillPrefix}正在分析指令并检视工作区状态...\n`;
    if (turn.reasoning) turn.reasoning.text += r1;
    this.send("reasoning:chunk", { chunk: r1 });

    if (this.isInterrupted) return;
    await new Promise((r) => setTimeout(r, 15));
    if (this.isInterrupted) return;

    const r2 = targetSkill
      ? (isMounted
          ? `遵循 Agent 内置【${targetSkill.name}】规范执行，准备输出结果。\n`
          : `按照动态挂载【${targetSkill.name}】流程规范分析完成，准备输出结果。\n`)
      : "策略分析完毕，准备输出结果。\n";
    if (turn.reasoning) turn.reasoning.text += r2;
    this.send("reasoning:chunk", { chunk: r2 });

    if (this.isInterrupted) return;
    await new Promise((r) => setTimeout(r, 15));
    if (this.isInterrupted) return;

    if (turn.reasoning) turn.reasoning.isStreaming = false;

    const answer = targetSkill
      ? (isMounted
          ? `已按照 Agent 内置技能【${targetSkill.name}】规范接收任务: "${text}"。\n执行完成。`
          : `已按照动态挂载技能【${targetSkill.name}】规范接收任务: "${text}"。\n执行完成。`)
      : `已成功接收指令: "${text}"。\n执行完成。`;
    turn.assistantText = answer;
    this.send("assistant:chunk", { chunk: answer });

    if (this.isInterrupted) return;

    turn.status = "completed";
    const durationMs = Date.now() - startTime;
    turn.metrics = {
      durationMs,
      model: "copilot-gpt-4o",
      tps: 40,
    };

    this.send("turn:end", { metrics: turn.metrics });
    this.running = false;
  }

  /**
   * Handle user:interrupt packet
   */
  public handleUserInterrupt(): void {
    this.isInterrupted = true;
    this.running = false;

    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {
        // ignore
      }
    }

    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn && lastTurn.status === "streaming") {
      lastTurn.status = "interrupted";
      if (lastTurn.reasoning) {
        lastTurn.reasoning.isStreaming = false;
      }
    }

    if (
      this.options.orchestrator &&
      typeof this.options.orchestrator.interrupt === "function"
    ) {
      try {
        this.options.orchestrator.interrupt();
      } catch {
        // ignore
      }
    }

    this.send("turn:end", { status: "interrupted" });
  }

  /**
   * Load Agent configuration from workspace .cph/config.json
   */
  private loadAgentConfig(): AgentConfig {
    const config: AgentConfig = {
      defaultMain: DEFAULT_MAIN_AGENT_ID,
      defaultCoder: DEFAULT_CODER_AGENT_ID,
      defaultResearcher: DEFAULT_RESEARCHER_AGENT_ID,
      customAgents: [],
    };
    if (!this.workspaceRoot) return config;
    try {
      const configPath = path.join(this.workspaceRoot, ".cph", "config.json");
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (raw.customAgentId) config.customAgentId = raw.customAgentId;
        if (raw.coderAgentId) config.coderAgentId = raw.coderAgentId;
        if (raw.researcherAgentId) config.researcherAgentId = raw.researcherAgentId;
        if (Array.isArray(raw.customAgents)) config.customAgents = raw.customAgents;
        if (Array.isArray(raw.agentMountedSkills) && this.skillRegistry) {
          this.skillRegistry.setAgentMountedSkills(raw.agentMountedSkills);
        }
        if (raw.cloudWorkspace && !this.cloudWorkspace) {
          this.cloudWorkspace = raw.cloudWorkspace;
        }
      }
    } catch {
      // ignore
    }
    return config;
  }

  /**
   * Save configuration updates to .cph/config.json
   */
  private saveWorkspaceConfig(updates: Record<string, any>): void {
    if (!this.workspaceRoot) return;
    try {
      const cphDir = path.join(this.workspaceRoot, ".cph");
      if (!fs.existsSync(cphDir)) {
        fs.mkdirSync(cphDir, { recursive: true });
      }
      const configPath = path.join(cphDir, "config.json");
      let current: Record<string, any> = {};
      if (fs.existsSync(configPath)) {
        try {
          current = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch {
          current = {};
        }
      }
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) {
          delete current[k];
        } else {
          current[k] = v;
        }
      }
      fs.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");
    } catch (err: any) {
      console.warn("[RpcHandler] Failed to save workspace config:", err.message);
    }
  }

  /**
   * Get accounts payload with live remaining cooldown calculation
   */
  public getAccountsPayload(): { accounts: AccountInfo[]; allowedAccounts: string[] | null } {
    const statuses = this.pool.getPoolStatus();
    const allowed = this.pool.getAllowedAccounts();
    const now = Date.now();
    const accounts: AccountInfo[] = statuses.map((s) => ({
      email: s.email,
      isAvailable: s.isAvailable,
      isThrottled: s.isThrottled,
      isAllowed: s.isAllowed !== false,
      isLeased: s.isLeased,
      leasedBy: s.leasedBy,
      cooldownUntil: s.cooldownUntil,
      cooldownRemainingSec: Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000)),
      totalRequests: s.totalRequests,
      throttledCount: s.throttledCount,
      throttleReason: s.throttleReason,
    }));
    return { accounts, allowedAccounts: allowed ?? null };
  }

  /**
   * Get agent configuration payload
   */
  public getAgentConfigPayload(): AgentConfig {
    return { ...this.agentConfig };
  }

  /**
   * Handle account toggle (enable / skip single account)
   */
  private handleAccountToggle(payload?: { email: string; enabled: boolean }): void {
    if (!payload || !payload.email) return;
    const { email, enabled } = payload;
    if (enabled) {
      this.pool.enableAccount(email);
    } else {
      this.pool.disableAccount(email);
    }
    const allowed = this.pool.getAllowedAccounts();
    this.saveWorkspaceConfig({ allowedAccounts: allowed });
    this.send("accounts:update", this.getAccountsPayload());
  }

  /**
   * Handle whitelist batch update or reset
   */
  private handleAccountWhitelist(payload?: { emails: string[] | null }): void {
    if (!payload) return;
    const emails =
      Array.isArray(payload.emails) && payload.emails.length > 0 ? payload.emails : undefined;
    this.pool.setAllowedAccounts(emails);
    this.saveWorkspaceConfig({ allowedAccounts: emails });
    this.send("accounts:update", this.getAccountsPayload());
  }

  /**
   * Handle manual reset of 429 cooldown
   */
  private handleAccountResetCooldown(payload?: { email: string }): void {
    if (!payload || !payload.email) return;
    this.pool.resetCooldown(payload.email);
    this.send("accounts:update", this.getAccountsPayload());
  }

  /**
   * Handle setting agent ID (main/coder/researcher)
   */
  private handleAgentSet(payload?: { role: "main" | "coder" | "researcher" | "custom"; id?: string }): void {
    if (!payload || !payload.role) return;
    const rawId = payload.id ? payload.id.trim() : "";
    const normalized = rawId ? ChatHubClient.normalizeAgentId(rawId) : undefined;

    if (payload.role === "main" || payload.role === "custom") {
      this.agentConfig.customAgentId = normalized;
      this.saveWorkspaceConfig({ customAgentId: normalized });
      if (this.options.orchestrator?.setCustomAgentId) {
        this.options.orchestrator.setCustomAgentId(normalized);
      }
      if (this.options.cliApp?.setCustomAgentId) {
        this.options.cliApp.setCustomAgentId(normalized);
      }
    } else if (payload.role === "coder") {
      this.agentConfig.coderAgentId = normalized;
      this.saveWorkspaceConfig({ coderAgentId: normalized });
    } else if (payload.role === "researcher") {
      this.agentConfig.researcherAgentId = normalized;
      this.saveWorkspaceConfig({ researcherAgentId: normalized });
    }

    this.send("agent:update", this.getAgentConfigPayload());
  }

  /**
   * Handle resetting agent ID to default
   */
  private handleAgentReset(payload?: { role: "main" | "coder" | "researcher" | "all" }): void {
    const role = payload?.role || "all";
    if (role === "main" || role === "all") {
      this.agentConfig.customAgentId = undefined;
      this.saveWorkspaceConfig({ customAgentId: undefined });
      if (this.options.orchestrator?.setCustomAgentId) {
        this.options.orchestrator.setCustomAgentId(undefined);
      }
      if (this.options.cliApp?.setCustomAgentId) {
        this.options.cliApp.setCustomAgentId(undefined);
      }
    }
    if (role === "coder" || role === "all") {
      this.agentConfig.coderAgentId = undefined;
      this.saveWorkspaceConfig({ coderAgentId: undefined });
    }
    if (role === "researcher" || role === "all") {
      this.agentConfig.researcherAgentId = undefined;
      this.saveWorkspaceConfig({ researcherAgentId: undefined });
    }

    this.send("agent:update", this.getAgentConfigPayload());
  }

  /**
   * Handle adding a custom agent
   */
  private handleAgentAddCustom(payload?: { agent?: Partial<CustomAgentItem> }): void {
    if (!payload?.agent) return;
    const { name, agentId, role, description } = payload.agent;
    if (!name || !agentId) return;

    const normalizedId = ChatHubClient.normalizeAgentId(agentId.trim()) || agentId.trim();
    const newAgent: CustomAgentItem = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      agentId: normalizedId,
      role: role || "custom",
      description: description?.trim() || "",
      createdAt: Date.now(),
    };

    if (!Array.isArray(this.agentConfig.customAgents)) {
      this.agentConfig.customAgents = [];
    }
    this.agentConfig.customAgents.push(newAgent);
    this.saveWorkspaceConfig({ customAgents: this.agentConfig.customAgents });
    this.send("agent:update", this.getAgentConfigPayload());
  }

  /**
   * Handle removing a custom agent
   */
  private handleAgentRemoveCustom(payload?: { id?: string }): void {
    if (!payload?.id) return;
    if (!Array.isArray(this.agentConfig.customAgents)) {
      this.agentConfig.customAgents = [];
    }
    this.agentConfig.customAgents = this.agentConfig.customAgents.filter(
      (a) => a.id !== payload.id
    );
    this.saveWorkspaceConfig({ customAgents: this.agentConfig.customAgents });
    this.send("agent:update", this.getAgentConfigPayload());
  }
}

