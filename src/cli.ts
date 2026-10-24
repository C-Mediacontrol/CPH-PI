import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { startWebServer, stopWebServer, resolveWebDistDir, type WebServerInstance } from "./web/server.ts";
import { CopilotOrchestrator, type IOrchestratorChatClient } from "./agent/orchestrator.ts";
import { InterruptController } from "./agent/interrupt-controller.ts";
import { TuiRenderer, type SessionStatusInfo, type ActiveSubagentState, type SubagentLiveState } from "./ui/tui-renderer.ts";
import { AccountPool } from "./auth/account-pool.ts";
import { ToolBridge, type MappedQuestionArgs } from "./protocol/tool-bridge.ts";
import { SkillLoader, type Skill } from "./skills/skill-loader.ts";
import { SkillRegistry } from "./skills/skill-registry.ts";
import { SessionManager, type SessionRecord } from "./session/session-manager.ts";
import { ChatHubClient } from "./transport/chathub-client.ts";
import { TerminalLogger } from "./ui/terminal-logger.ts";
import { ExecutionLedger } from "./session/ledger/execution-ledger.ts";
import { SubstrateUploader } from "./transport/substrate-uploader.ts";
import type { AttachmentAnnotation } from "./transport/types.ts";
import {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
} from "./agent/subagent-runner.ts";

import {
  type ParsedCliArgs,
  parseCliArgs,
  getHelpText,
  printHelp,
  renderHelpBanner,
  parseArgs,
} from "./cli/args.ts";
import {
  isBuiltinSlashCommand,
  dispatchSlashCommand,
  BUILTIN_SLASH_COMMANDS,
} from "./cli/commands.ts";

export {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
};

export {
  type ParsedCliArgs,
  parseCliArgs,
  getHelpText,
  printHelp,
  renderHelpBanner,
  parseArgs,
};

export {
  isBuiltinSlashCommand,
  dispatchSlashCommand,
  BUILTIN_SLASH_COMMANDS,
};

export {
  startWebServer,
  stopWebServer,
  resolveWebDistDir,
  type WebServerInstance,
};

export interface WorkspaceConfig {
  customAgentId?: string;
  modelTone?: string;
  allowedAccounts?: string[];
  debug?: boolean;
  debugLogPath?: string;
  agentMountedSkills?: string[];
}

export interface CphPiCliOptions {
  workspaceRoot?: string;
  workspace?: string;
  ledger?: ExecutionLedger;
  modelTone?: string;
  maxTurns?: number;
  timeoutSec?: number;
  parsedArgs?: ParsedCliArgs;
  pool?: AccountPool;
  renderer?: TuiRenderer;
  interruptController?: InterruptController;
  chatClient?: IOrchestratorChatClient;
  arbitratorChatClient?: IOrchestratorChatClient;
  chatClientFactory?: (
    token: any,
    options: { modelTone?: string; customAgentId?: string }
  ) => IOrchestratorChatClient;
  bridge?: ToolBridge;
  skillRegistry?: SkillRegistry;
  skillLoader?: SkillLoader;
  sessionManager?: SessionManager;
  continueLast?: boolean;
  resumeSessionId?: string;
  isInteractive?: boolean;
  customAgentId?: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  maxAutonomousHandoffHops?: number;
  allowedAccounts?: string[];
  orchestrator?: CopilotOrchestrator;
  rl?: readline.Interface;
  debug?: boolean;
  debugLogPath?: string;
  cloudAttachmentThresholdChars?: number;
  cloudAttachmentThresholdLines?: number;
  graphTokenProvider?: () => Promise<string>;
  port?: number;
  host?: string;
  autoOpen?: boolean;
  distDir?: string;
}

export type CliOptions = CphPiCliOptions;

export class CphPiCli {
  private workspaceRoot: string;
  private modelTone: string;
  private maxTurns: number;
  private timeoutSec: number;
  private maxAutonomousHandoffHops: number;
  public customAgentId?: string;
  public coderAgentId?: string;
  public researcherAgentId?: string;
  private pool: AccountPool;
  private renderer: TuiRenderer;
  private interruptController: InterruptController;
  private orchestrator: CopilotOrchestrator;
  private chatClient?: IOrchestratorChatClient;
  public readonly ledger: ExecutionLedger;
  private arbitratorChatClient?: IOrchestratorChatClient;
  private chatClientFactory?: (
    token: any,
    options: { modelTone?: string; customAgentId?: string }
  ) => IOrchestratorChatClient;
  private bridge: ToolBridge;
  private skillRegistry: SkillRegistry;
  private sessionManager: SessionManager;
  private currentSession: SessionRecord | null = null;
  private continueLast: boolean = false;
  private resumeSessionId?: string;
  private lastCompactionRatio?: number;
  private rl?: readline.Interface;
  private multilineBuffer: string[] = [];
  private isMultilineMode: boolean = false;
  private isInteractive: boolean = false;
  private pendingHandoffSnapshot?: string;
  private graphTokenProvider?: () => Promise<string>;
  private debug: boolean = false;
  private debugLogPath?: string;

  constructor(options: CphPiCliOptions = {}) {
    this.workspaceRoot = path.resolve(
      options.workspaceRoot || options.workspace || process.env.CPH_PI_ORIGINAL_CWD || process.cwd()
    );
    this.ledger = options.ledger || new ExecutionLedger(this.workspaceRoot);

    const config = this.loadWorkspaceConfig();
    const cliAgentId = options.customAgentId
      ? ChatHubClient.normalizeAgentId(options.customAgentId)
      : undefined;
    const envAgentId = ChatHubClient.normalizeAgentId(process.env.CPH_COPILOT_AGENT_ID);
    this.customAgentId = cliAgentId ?? envAgentId ?? config.customAgentId;
    this.coderAgentId =
      (options.coderAgentId ? ChatHubClient.normalizeAgentId(options.coderAgentId) : undefined) ??
      DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId =
      (options.researcherAgentId ? ChatHubClient.normalizeAgentId(options.researcherAgentId) : undefined) ??
      DEFAULT_RESEARCHER_AGENT_ID;
    this.modelTone = options.modelTone || config.modelTone || "Gpt_61_Sol_Reasoning";

    this.maxTurns = options.maxTurns || 30;
    this.timeoutSec = options.timeoutSec ?? options.parsedArgs?.timeoutSec ?? 600;
    const timeoutMs = this.timeoutSec * 1000;
    this.maxAutonomousHandoffHops = options.maxAutonomousHandoffHops ?? 50;
    this.pool = options.pool || new AccountPool();
    const effectiveAllowedAccounts = options.allowedAccounts || config.allowedAccounts;
    if (effectiveAllowedAccounts && effectiveAllowedAccounts.length > 0) {
      this.pool.setAllowedAccounts(effectiveAllowedAccounts);
    }
    this.renderer = options.renderer || new TuiRenderer();
    this.chatClient = options.chatClient;
    this.arbitratorChatClient = options.arbitratorChatClient;
    this.chatClientFactory =
      options.chatClientFactory ||
      ((token: any, factoryOpts: { modelTone?: string; customAgentId?: string } = {}) => {
        return new ChatHubClient(token, {
          modelTone: factoryOpts.modelTone || this.modelTone,
          customAgentId: factoryOpts.customAgentId || this.customAgentId,
          timeoutMs,
        });
      });
    this.rl = options.rl;
    this.isInteractive = options.isInteractive ?? (this.rl !== undefined ? true : false);
    this.graphTokenProvider = options.graphTokenProvider;
    this.bridge =
      options.bridge ||
      new ToolBridge({
        cwd: this.workspaceRoot,
        ledger: this.ledger,
        onQuestion: async (qArgs) => {
          const answer = await this.handleInteractiveQuestion(qArgs);
          return ToolBridge.formatUserResponse(answer);
        },
      });
    this.sessionManager = options.sessionManager || new SessionManager(this.workspaceRoot);
    this.continueLast = options.continueLast ?? false;
    this.resumeSessionId = options.resumeSessionId;

    const loader = options.skillLoader || new SkillLoader(this.workspaceRoot);
    this.skillRegistry = options.skillRegistry || new SkillRegistry(loader);
    if (config.agentMountedSkills && Array.isArray(config.agentMountedSkills)) {
      this.skillRegistry.setAgentMountedSkills(config.agentMountedSkills);
    }
    this.skillRegistry.loadSkills();

    this.interruptController =
      options.interruptController ||
      new InterruptController({
        idleExitTimeoutMs: 1500,
        onPromptExit: (msg) => {
          process.stdout.write(`\n${chalk.yellow(msg)}\n> `);
        },
        onExit: () => {
          process.stdout.write(chalk.gray("\n退出 CPH-PI 终端。再见！\n"));
          this.close();
          process.exit(0);
        },
      });

    this.orchestrator =
      options.orchestrator ||
      new CopilotOrchestrator({
        workspaceRoot: this.workspaceRoot,
        modelTone: this.modelTone,
        maxTurns: this.maxTurns,
        maxGenerations: this.maxAutonomousHandoffHops,
        pool: this.pool,
        chatClient: this.chatClient,
        arbitratorChatClient: this.arbitratorChatClient,
        chatClientFactory: this.chatClientFactory,
        bridge: this.bridge,
        skillRegistry: this.skillRegistry,
        activeSkills: this.skillRegistry.getActiveSkills(),
        customAgentId: this.customAgentId,
        coderAgentId: this.coderAgentId,
        researcherAgentId: this.researcherAgentId,
        timeoutMs,
        cloudAttachmentThresholdChars: options.cloudAttachmentThresholdChars,
        cloudAttachmentThresholdLines: options.cloudAttachmentThresholdLines,
        graphTokenProvider: this.graphTokenProvider,
      } as any);
    (this.orchestrator as any).timeoutMs = timeoutMs;

    this.debug = options.debug ?? config.debug ?? false;
    this.debugLogPath = options.debugLogPath ?? config.debugLogPath;
    if (this.debug) {
      TerminalLogger.getInstance().start({
        logFilePath: this.debugLogPath,
        workspaceRoot: this.workspaceRoot,
      });
    }
  }

  public isDebugModeEnabled(): boolean {
    return this.debug;
  }

  public getDebugLogPath(): string | undefined {
    return this.debugLogPath || TerminalLogger.getInstance().getLogFilePath();
  }

  public setDebugMode(enabled: boolean, logPath?: string): void {
    this.debug = enabled;
    if (logPath) {
      this.debugLogPath = logPath;
    }
    if (enabled) {
      TerminalLogger.getInstance().start({
        logFilePath: this.debugLogPath,
        workspaceRoot: this.workspaceRoot,
      });
    } else {
      TerminalLogger.getInstance().stop();
    }
  }

  public getMaxAutonomousHandoffHops(): number {
    return this.maxAutonomousHandoffHops;
  }

  public setMaxAutonomousHandoffHops(hops: number): void {
    this.maxAutonomousHandoffHops = hops;
  }

  public getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  public getRenderer(): TuiRenderer {
    return this.renderer;
  }

  public getInterruptController(): InterruptController {
    return this.interruptController;
  }

  public getOrchestrator(): CopilotOrchestrator {
    return this.orchestrator;
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getCurrentSession(): SessionRecord | null {
    return this.currentSession;
  }

  public setCurrentSession(session: SessionRecord | null): void {
    this.currentSession = session;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Dynamically switch workspaceRoot, rebind ToolBridge, ExecutionLedger, SkillRegistry, and Orchestrator.
   */
  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = path.resolve(newRoot);
    this.ledger = new ExecutionLedger(this.workspaceRoot);
    if (this.bridge && typeof (this.bridge as any).setCwd === "function") {
      (this.bridge as any).setCwd(this.workspaceRoot, this.ledger);
    } else {
      this.bridge = new ToolBridge({
        cwd: this.workspaceRoot,
        ledger: this.ledger,
        onQuestion: async (qArgs) => {
          const answer = await this.handleInteractiveQuestion(qArgs);
          return ToolBridge.formatUserResponse(answer);
        },
      });
    }

    const loader = new SkillLoader(this.workspaceRoot);
    this.skillRegistry = new SkillRegistry(loader);
    const config = this.loadWorkspaceConfig();
    if (config.agentMountedSkills && Array.isArray(config.agentMountedSkills)) {
      this.skillRegistry.setAgentMountedSkills(config.agentMountedSkills);
    }
    try {
      this.skillRegistry.loadSkills();
    } catch {}

    if (this.orchestrator && typeof (this.orchestrator as any).setWorkspaceRoot === "function") {
      (this.orchestrator as any).setWorkspaceRoot(this.workspaceRoot, this.skillRegistry);
    } else {
      this.orchestrator = new CopilotOrchestrator({
        workspaceRoot: this.workspaceRoot,
        modelTone: this.modelTone,
        maxTurns: this.maxTurns,
        maxGenerations: this.maxAutonomousHandoffHops,
        pool: this.pool,
        chatClient: this.chatClient,
        arbitratorChatClient: this.arbitratorChatClient,
        chatClientFactory: this.chatClientFactory,
        bridge: this.bridge,
        skillRegistry: this.skillRegistry,
        activeSkills: this.skillRegistry.getActiveSkills(),
        customAgentId: this.customAgentId,
        coderAgentId: this.coderAgentId,
        researcherAgentId: this.researcherAgentId,
        timeoutMs: this.timeoutSec * 1000,
      } as any);
    }

    try {
      this.sessionManager = new SessionManager(this.workspaceRoot);
    } catch {}
  }

  public getModelTone(): string {
    return this.modelTone;
  }

  public setModelTone(tone: string): void {
    this.modelTone = tone;
  }

  public getMaxTurns(): number {
    return this.maxTurns;
  }

  public getPool(): AccountPool {
    return this.pool;
  }

  public getGraphTokenProvider(): (() => Promise<string>) | undefined {
    return this.graphTokenProvider;
  }

  public getPendingHandoffSnapshot(): string | undefined {
    return this.pendingHandoffSnapshot;
  }

  public setPendingHandoffSnapshot(snapshot?: string): void {
    this.pendingHandoffSnapshot = snapshot;
  }

  public getLastCompactionRatio(): number | undefined {
    return this.lastCompactionRatio;
  }

  public setLastCompactionRatio(ratio?: number): void {
    this.lastCompactionRatio = ratio;
  }

  public resetSessionAndOrchestrator(title: string = "新会话"): SessionRecord {
    if (this.currentSession) {
      this.currentSession.status = "completed";
      this.sessionManager.saveSession(this.currentSession);
    }

    this.currentSession = this.sessionManager.createSession({
      title,
      workspaceRoot: this.workspaceRoot,
      maxTurns: this.maxTurns,
      modelTone: this.modelTone,
    });

    this.orchestrator = new CopilotOrchestrator({
      workspaceRoot: this.workspaceRoot,
      modelTone: this.modelTone,
      maxTurns: this.maxTurns,
      maxGenerations: this.maxAutonomousHandoffHops,
      pool: this.pool,
      chatClient: this.chatClient,
      arbitratorChatClient: this.arbitratorChatClient,
      chatClientFactory: this.chatClientFactory,
      bridge: this.bridge,
      skillRegistry: this.skillRegistry,
      activeSkills: this.skillRegistry.getActiveSkills(),
      customAgentId: this.customAgentId,
      coderAgentId: this.coderAgentId,
      researcherAgentId: this.researcherAgentId,
      timeoutMs: this.timeoutSec * 1000,
    } as any);
    (this.orchestrator as any).timeoutMs = this.timeoutSec * 1000;
    this.lastCompactionRatio = undefined;

    return this.currentSession;
  }

  public getBridge(): ToolBridge {
    return this.bridge;
  }

  public getReadline(): readline.Interface | undefined {
    return this.rl;
  }

  public setReadline(rl?: readline.Interface): void {
    this.rl = rl;
  }

  public getTimeoutSec(): number {
    return this.timeoutSec;
  }

  public getTimeoutMs(): number {
    return this.timeoutSec * 1000;
  }

  public createChatClient(
    token: any,
    options: { modelTone?: string; customAgentId?: string } = {}
  ): IOrchestratorChatClient {
    if (this.chatClientFactory) {
      return this.chatClientFactory(token, options);
    }
    return new ChatHubClient(token, {
      modelTone: options.modelTone || this.modelTone,
      customAgentId: options.customAgentId || this.customAgentId,
      timeoutMs: this.timeoutSec * 1000,
    });
  }

  public static parseArgs(args: string[]): ParsedCliArgs {
    return parseCliArgs(args);
  }

  public parseArgs(args: string[]): ParsedCliArgs {
    return parseCliArgs(args);
  }

  public static printHelp(): string {
    return printHelp();
  }

  public printHelp(): string {
    return printHelp();
  }

  public static renderHelpBanner(): string {
    return renderHelpBanner();
  }

  public renderHelpBanner(): string {
    return renderHelpBanner();
  }

  public async startWebServer(options: {
    port?: number;
    host?: string;
    autoOpen?: boolean;
    distDir?: string;
  } = {}): Promise<WebServerInstance> {
    const port = options.port ?? 3000;
    const host = options.host ?? "127.0.0.1";
    const autoOpen = options.autoOpen ?? true;

    const targetDistDir = resolveWebDistDir(options.distDir);
    const webDistIndex = path.resolve(targetDistDir, "index.html");

    if (!fs.existsSync(webDistIndex)) {
      console.warn(
        chalk.yellow("⚠️  警告: 未找到前端构建产物 (web/dist/index.html)。请先运行: npm run web:build\n")
      );
    }

    return await startWebServer({
      port,
      host,
      autoOpen,
      distDir: targetDistDir,
      workspaceRoot: this.workspaceRoot,
      orchestrator: this.orchestrator,
      sessionManager: this.sessionManager,
      pool: this.pool,
      cliApp: this,
      skillRegistry: this.skillRegistry,
      debug: this.isDebugModeEnabled(),
      debugLogPath: this.getDebugLogPath(),
    });
  }

  /**
   * Handles interactive question prompted by ask_question tool.
   * Renders question prompt card, queries user via readline if available,
   * or falls back cleanly in non-interactive/closed-stdin scenarios.
   */
  public async handleInteractiveQuestion(qArgs: MappedQuestionArgs): Promise<string> {
    this.renderer.renderQuestionPrompt(qArgs.question, qArgs.options);

    // If non-interactive, stdin destroyed/closed, or readline not available
    if (!this.rl || !this.isInteractiveMode() || process.stdin.destroyed) {
      if (qArgs.options && qArgs.options.length > 0) {
        return qArgs.options[0];
      }
      return "[Non-interactive fallback: Auto-confirmed default]";
    }

    return new Promise<string>((resolve) => {
      let promptQuery = chalk.yellow("\n请输入你的选择或回答: ");
      if (qArgs.options && qArgs.options.length > 0) {
        promptQuery = chalk.yellow(`\n请选择 (1-${qArgs.options.length}) 或输入回答: `);
      }

      this.rl!.question(promptQuery, (answer: string) => {
        const trimmed = (answer || "").trim();
        if (qArgs.options && qArgs.options.length > 0) {
          const num = parseInt(trimmed, 10);
          if (!isNaN(num) && String(num) === trimmed && num >= 1 && num <= qArgs.options.length) {
            resolve(qArgs.options[num - 1]);
            return;
          }
        }
        resolve(trimmed || (qArgs.options && qArgs.options.length > 0 ? qArgs.options[0] : ""));
      });
    });
  }

  public isInteractiveMode(): boolean {
    return this.isInteractive || this.rl !== undefined;
  }

  public setInteractive(interactive: boolean): void {
    this.isInteractive = interactive;
  }

  public getPendingHandoffSnapshot(): string | undefined {
    return this.pendingHandoffSnapshot;
  }

  /**
   * Loads workspace configuration from <workspaceRoot>/.cph/config.json
   */
  public loadWorkspaceConfig(): WorkspaceConfig {
    const configPath = path.join(this.workspaceRoot, ".cph", "config.json");
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(content) || {};
      }
    } catch {
      // Gracefully handle missing or malformed configuration
    }
    return {};
  }

  /**
   * Persists workspace configuration updates to <workspaceRoot>/.cph/config.json
   */
  public saveWorkspaceConfig(updates: Partial<WorkspaceConfig>): void {
    const cphDir = path.join(this.workspaceRoot, ".cph");
    const configPath = path.join(cphDir, "config.json");
    try {
      fs.mkdirSync(cphDir, { recursive: true });
      let current: Record<string, any> = {};
      if (fs.existsSync(configPath)) {
        try {
          current = JSON.parse(fs.readFileSync(configPath, "utf-8")) || {};
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
    } catch {
      // Gracefully handle file system write issues
    }
  }

  /**
   * Initializes or restores the active session.
   */
  public initSession(): SessionRecord {
    if (this.currentSession) {
      return this.currentSession;
    }

    if (this.continueLast) {
      let latest = this.sessionManager.getLatestActiveSession();
      if (!latest) {
        const list = this.sessionManager.listSessions();
        const cand = list.find((s) => s.status !== "handed_off") || list[0];
        if (cand) {
          latest = this.sessionManager.loadSession(cand.id);
        }
      }
      if (latest) {
        this.currentSession = latest;
        if (latest.turns && latest.turns.length > 0) {
          this.orchestrator.completeHandshake();
        }
        return latest;
      }
    }

    if (this.resumeSessionId) {
      const loaded = this.sessionManager.loadSession(this.resumeSessionId);
      if (loaded) {
        this.currentSession = loaded;
        if (loaded.turns && loaded.turns.length > 0) {
          this.orchestrator.completeHandshake();
        }
        return loaded;
      } else {
        process.stdout.write(
          chalk.yellow(`\n未找到指定会话 "${this.resumeSessionId}"，已自动创建新会话。\n\n`)
        );
      }
    }

    this.currentSession = this.sessionManager.createSession({
      workspaceRoot: this.workspaceRoot,
      maxTurns: this.maxTurns,
      modelTone: this.modelTone,
    });
    return this.currentSession;
  }

  /**
   * Renders the status bar for the current active session.
   */
  public renderCurrentStatusBar(): void {
    const session = this.currentSession || this.initSession();

    let estimatedChars = 0;
    for (const t of session.turns || []) {
      estimatedChars += (t.userInput?.length || 0) + (t.modelResponse?.length || 0);
      if (t.toolCalls) {
        for (const tc of t.toolCalls) {
          estimatedChars += tc.output?.length || 0;
        }
      }
    }

    const statuses = this.pool.getPoolStatus();
    const activeAllowed = statuses.filter((s) => s.isAllowed !== false && !s.isThrottled);
    const activeSessionLease = this.pool?.getSessionLease
      ? this.pool.getSessionLease(session.id)
      : undefined;
    const currentAcc =
      session.currentAccount ||
      activeSessionLease ||
      activeAllowed[0]?.email ||
      statuses.find((s) => s.isAllowed !== false)?.email ||
      statuses[0]?.email;

    const agentBadge = this.customAgentId
      ? (this.customAgentId.length > 15
          ? this.customAgentId.slice(0, 12) + "..."
          : this.customAgentId)
      : "通用握手模式";

    const gen = this.orchestrator
      ? (this.orchestrator as any).getGeneration?.()
      : session.generation || 1;
    const handoffs = this.orchestrator
      ? (this.orchestrator as any).getHandoffCount?.()
      : session.handoffCount || 0;

    const info: SessionStatusInfo = {
      sessionId: session.id,
      turnCount: session.turnCount,
      maxTurns: session.maxTurns,
      estimatedTokens:
        estimatedChars > 0 ? Math.round(estimatedChars / 3.5) : undefined,
      compactionRatio: this.lastCompactionRatio,
      currentAccount: currentAcc,
      agentName: agentBadge,
      generation: gen,
      handoffCount: handoffs,
    };

    this.renderer.renderStatusBar(info);
  }

  /**
   * Formats all saved sessions into an aligned tabular view.
   */
  public formatSessionsList(): string {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) {
      return chalk.yellow("\n暂无历史会话记录。\n");
    }

    const currentId = this.currentSession?.id;
    const lines: string[] = [
      chalk.bold.cyan(`\n[历史会话列表 (共 ${sessions.length} 个)]`),
      chalk.gray("┌────┬─────────────────────────────┬──────────────────────────┬───────┬────────────┬─────────────────────┐"),
      chalk.gray("│    │ ") +
        chalk.bold.white("会话 ID") +
        "                     │ " +
        chalk.bold.white("标题") +
        "                     │ " +
        chalk.bold.white("轮次") +
        "  │ " +
        chalk.bold.white("状态") +
        "       │ " +
        chalk.bold.white("最后活跃时间") +
        chalk.gray("        │"),
      chalk.gray("├────┼─────────────────────────────┼──────────────────────────┼───────┼────────────┼─────────────────────┤"),
    ];

    for (const s of sessions) {
      const isCurrent = s.id === currentId;
      const mark = isCurrent ? chalk.green(" *  ") : "    ";
      const idPad = s.id.padEnd(27, " ");
      const idStr = isCurrent ? chalk.bold.green(idPad) : chalk.white(idPad);

      const titleRaw = s.title.length > 24 ? `${s.title.slice(0, 21)}...` : s.title;
      const titlePad = titleRaw.padEnd(24, " ");
      const titleStr = chalk.white(titlePad);

      const turnPad = `${s.turnCount}`.padStart(5, " ");
      const turnStr = chalk.yellow(turnPad);

      const statusColor =
        s.status === "active"
          ? chalk.green
          : s.status === "completed"
            ? chalk.blue
            : s.status === "handed_off"
              ? chalk.yellow
              : chalk.gray;
      const statusPad = s.status.padEnd(10, " ");
      const statusStr = statusColor(statusPad);

      const dateStr = s.updatedAt ? s.updatedAt.replace("T", " ").slice(0, 19) : "";
      const datePad = dateStr.padEnd(19, " ");
      const timeStr = chalk.gray(datePad);

      lines.push(
        chalk.gray("│") +
          mark +
          chalk.gray("│ ") +
          idStr +
          chalk.gray(" │ ") +
          titleStr +
          chalk.gray(" │ ") +
          turnStr +
          chalk.gray(" │ ") +
          statusStr +
          chalk.gray(" │ ") +
          timeStr +
          chalk.gray(" │")
      );
    }

    lines.push(
      chalk.gray("└────┴─────────────────────────────┴──────────────────────────┴───────┴────────────┴─────────────────────┘"),
      chalk.dim("提示: 输入 /resume <id> 恢复指定会话 | 输入 /new [标题] 开启新会话\n")
    );

    return lines.join("\n");
  }

  /**
   * Starts the interactive CLI session.
   */
  public async start(): Promise<void> {
    this.isInteractive = true;
    this.initSession();
    this.renderer.renderBanner(this.workspaceRoot);

    if (this.debug) {
      const currentLog = TerminalLogger.getInstance().getLogFilePath() || this.debugLogPath;
      process.stdout.write(
        chalk.magenta(`🐞 [Debug 模式] 终端输出已实时落盘至: ${chalk.bold(currentLog)}\n\n`)
      );
    }

    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan("cph-pi> "),
      });
    }

    // Intercept SIGINT in readline
    this.rl.on?.("SIGINT", () => {
      this.interruptController.handleSigint();
    });

    this.promptUser();

    this.rl.on?.("line", async (line: string) => {
      await this.handleInputLine(line);
    });

    this.rl.on?.("close", () => {
      this.interruptController.detach();
    });
  }

  public close(): void {
    if (this.rl) {
      if (typeof this.rl.close === "function") {
        this.rl.close();
      }
      this.rl = undefined;
    }
    this.isInteractive = false;
    this.interruptController.detach();
    TerminalLogger.getInstance().stop();
  }

  /**
   * Handles user input line or multi-line accumulation.
   */
  public async handleInputLine(line: string): Promise<void> {
    if (this.interruptController.isBusy()) {
      return;
    }

    const trimmed = line.trim();

    // 1. Triple-quote block detection (""")
    if (trimmed.startsWith('"""')) {
      if (this.isMultilineMode) {
        // Closing triple quote
        this.isMultilineMode = false;
        const task = this.multilineBuffer.join("\n").trim();
        this.multilineBuffer = [];
        if (task) {
          await this.executeTask(task);
        }
        this.promptUser();
        return;
      } else {
        // Opening triple quote
        this.isMultilineMode = true;
        const afterQuotes = trimmed.slice(3).trim();
        if (afterQuotes) {
          this.multilineBuffer.push(afterQuotes);
        }
        process.stdout.write(chalk.dim("... (输入多行文本，输入 \"\"\" 并回车结束)\n"));
        this.promptUser("... ");
        return;
      }
    }

    if (this.isMultilineMode) {
      this.multilineBuffer.push(line);
      this.promptUser("... ");
      return;
    }

    // Line continuation with trailing backslash (\)
    if (line.endsWith("\\")) {
      this.multilineBuffer.push(line.slice(0, -1));
      this.promptUser("... ");
      return;
    }

    if (this.multilineBuffer.length > 0) {
      this.multilineBuffer.push(line);
      const task = this.multilineBuffer.join("\n").trim();
      this.multilineBuffer = [];
      if (task) {
        await this.executeTask(task);
      }
      this.promptUser();
      return;
    }

    if (!trimmed) {
      this.promptUser();
      return;
    }

    // 2. Command handling
    if (trimmed.startsWith("/")) {
      if (isBuiltinSlashCommand(trimmed)) {
        await this.handleCommand(trimmed);
        this.promptUser();
        return;
      }

      // Check for skill slash commands (e.g. /brainstorming, /tdd, etc.)
      const parsedSlash = this.skillRegistry.parseSlashCommand(trimmed);
      if (parsedSlash.skill) {
        this.skillRegistry.activateSkill(parsedSlash.skill.name);
        this.renderer.renderSkillActivated(parsedSlash.skill.name);
        if (parsedSlash.task) {
          await this.executeTask(parsedSlash.task, [parsedSlash.skill]);
        } else {
          process.stdout.write(
            chalk.dim(`已激活技能 ${parsedSlash.skill.name}，请输入具体任务需求。\n`)
          );
        }
        this.promptUser();
        return;
      }

      process.stdout.write(
        chalk.red(`\n未知命令或技能: ${trimmed}。输入 /help 或 /skills 查看可用指令。\n\n`)
      );
      this.promptUser();
      return;
    }

    // 3. Normal task prompt execution
    await this.executeTask(trimmed);
    this.promptUser();
  }

  /**
   * Dispatches slash commands via commands table.
   */
  public async handleCommand(command: string): Promise<void> {
    const handled = await dispatchSlashCommand(this, command);
    if (!handled) {
      process.stdout.write(chalk.red(`\n未知命令: ${command}。输入 /help 查看可用命令。\n\n`));
    }
  }

  /**
   * Generates formatted runtime and session diagnostic card.
   */
  public getDiagnosticCard(): string {
    const statuses = this.pool.getPoolStatus();
    const hasAllowedFilter = this.pool.getAllowedAccounts() !== undefined;
    const allowedStatuses = hasAllowedFilter
      ? statuses.filter((s) => s.isAllowed !== false)
      : statuses;
    const available = allowedStatuses.filter((s) => !s.isThrottled).length;
    const total = allowedStatuses.length;
    const activeSkills = this.skillRegistry.getActiveSkills();
    const activeSkillStr =
      activeSkills.length > 0
        ? activeSkills.map((s) => s.name).join(", ")
        : "无 (全部待机)";

    const currentSession = this.currentSession || this.initSession();

    let estimatedChars = 0;
    for (const turn of currentSession.turns || []) {
      estimatedChars += (turn.userInput?.length || 0) + (turn.modelResponse?.length || 0);
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          estimatedChars += tc.output?.length || 0;
        }
      }
    }
    const tokenDisplay =
      estimatedChars > 0 ? `~${Math.round(estimatedChars / 3.5)} tokens` : "0 (全新)";
    const ratioDisplay =
      this.lastCompactionRatio !== undefined
        ? `${Math.round(this.lastCompactionRatio * 100)}%`
        : "0%";

    const agentDisplay = this.customAgentId
      ? chalk.green(this.customAgentId)
      : chalk.gray("无 (通用模式)");

    const activeSessionLease = this.pool?.getSessionLease
      ? this.pool.getSessionLease(currentSession.id)
      : undefined;
    const preferredEmail =
      currentSession.currentAccount ||
      activeSessionLease ||
      allowedStatuses.find((s) => !s.isThrottled)?.email ||
      allowedStatuses[0]?.email ||
      "默认";

    const lines = [
      chalk.bold.cyan("\n[CPH-PI 运行状态] - CPH-PI 运行与会话诊断卡"),
      chalk.gray("──────────────────────────────────────────────────"),
      `  当前会话 ID:   ${chalk.green(currentSession.id)}`,
      `  会话标题:      ${chalk.white(currentSession.title)}`,
      `  会话状态:      ${chalk.magenta(currentSession.status)}`,
      `  专属智能体:    ${agentDisplay}`,
      `  当前轮次:      ${chalk.yellow(`${currentSession.turnCount} / ${currentSession.maxTurns}`)}`,
      `  单次最大轮数:  ${chalk.white(String(this.maxTurns))}`,
      `  估算上下文:    ${chalk.cyan(tokenDisplay)} (历史压实率: ${ratioDisplay})`,
      `  创建时间:      ${chalk.gray(currentSession.createdAt)}`,
      `  更新时间:      ${chalk.gray(currentSession.updatedAt)}`,
      chalk.gray("──────────────────────────────────────────────────"),
      `  工作区目录:    ${chalk.white(this.workspaceRoot)}`,
      `  模型风格:      ${chalk.white(this.modelTone)}`,
      `  可用账号数:    ${chalk.green(`${available}/${total}`)}`,
      `  当前/首选账号: ${chalk.cyan(preferredEmail)}`,
      `  已激活技能:    ${chalk.magenta(activeSkillStr)}`,
      "",
    ];
    return lines.join("\n");
  }

  /**
   * Handles /agent command to view, bind or clear custom Copilot agent.
   */
  public handleAgentCommand(args?: string): void {
    const raw = args ? args.trim() : "";
    if (!raw) {
      if (this.customAgentId) {
        process.stdout.write(
          chalk.cyan(`\n[专属智能体当前绑定: ${this.customAgentId}]\n`) +
            chalk.dim(`提示: 输入 /agent <id|url> 切换绑定 | 输入 /agent clear 清除绑定\n\n`)
        );
      } else {
        process.stdout.write(
          chalk.yellow(`\n[当前未绑定专属智能体，处于通用握手模式]\n`) +
            chalk.dim(`提示: 输入 /agent <id|url> 绑定专属智能体\n\n`)
        );
      }
      return;
    }

    if (raw.toLowerCase() === "clear") {
      this.customAgentId = undefined;
      this.saveWorkspaceConfig({ customAgentId: undefined });
      this.orchestrator.setCustomAgentId(undefined);
      process.stdout.write(
        chalk.green(`\n✔ 已解除专属智能体绑定，已切换回通用握手基准模式。\n\n`)
      );
      return;
    }

    const normalized = ChatHubClient.normalizeAgentId(raw);
    if (!normalized) {
      process.stdout.write(chalk.red(`\n无效的智能体 ID 或 URL: "${raw}"\n\n`));
      return;
    }

    this.customAgentId = normalized;
    this.saveWorkspaceConfig({ customAgentId: normalized });
    this.orchestrator.setCustomAgentId(normalized);
    process.stdout.write(
      chalk.green(
        `\n✔ 专属智能体已绑定: ${normalized}\n  配置已保存至 .cph/config.json，已开启 WebSocket 直通推理模式。\n\n`
      )
    );
  }

  /**
   * Handles /model command to view or switch model tone.
   */
  public handleModelCommand(args?: string): void {
    const raw = args ? args.trim() : "";
    if (!raw) {
      process.stdout.write(
        chalk.cyan(`\n[当前模型风格: ${this.modelTone}]\n`) +
          chalk.dim(`提示: 输入 /model <tone> 切换模型风格 (如 /model Gpt_61_Sol_Reasoning 或 /model Creative)\n\n`)
      );
      return;
    }

    this.modelTone = raw;
    this.saveWorkspaceConfig({ modelTone: raw });
    (this.orchestrator as any).modelTone = raw;
    process.stdout.write(
      chalk.green(`\n✔ 模型风格已切换为: ${raw}\n  配置已保存至 .cph/config.json\n\n`)
    );
  }

  /**
   * Formats the accounts list with checkmarks and status badges.
   */
  public formatAccountsList(): string {
    const statuses = this.pool.getPoolStatus();
    const allowed = this.pool.getAllowedAccounts();
    const hasFilter = allowed !== undefined && allowed.length > 0;

    const lines = [
      chalk.bold.cyan(`\n[CPH-PI 账号池白名单与可用状态 (共 ${statuses.length} 个账号)]`),
      chalk.gray("──────────────────────────────────────────────────"),
      ...statuses.map((s) => {
        const isAllowed = s.isAllowed !== false;
        const mark = isAllowed ? chalk.green("[✓]") : chalk.gray("[ ]");
        const emailStr = isAllowed ? chalk.bold.white(s.email) : chalk.gray(s.email);
        let throttleBadge = s.isThrottled ? chalk.red("(429限频冷却)") : chalk.green("(就绪)");
        if (s.authExpired) {
          throttleBadge = chalk.red(`🔒 凭据已失效 (执行 /accounts login ${s.email} 刷新)`);
        }
        const allowedBadge = isAllowed ? chalk.cyan("(已启用)") : chalk.gray("(已跳过)");
        return `  ${mark} ${emailStr} ${throttleBadge} ${allowedBadge}`;
      }),
      chalk.gray("──────────────────────────────────────────────────"),
      hasFilter
        ? chalk.yellow(`  当前白名单限制: 仅启用 ${allowed.length} 个账号，其余已跳过`)
        : chalk.dim("  当前白名单限制: 未设置 (默认全部账号轮转)"),
      "",
      chalk.dim("提示: /accounts login <email> 刷新凭据 | /accounts enable <email> 启用 | /accounts disable <email> 跳过 | /accounts set <e1,e2> 批量设置 | /accounts reset 全量重置"),
      "",
    ];
    return lines.join("\n");
  }

  /**
   * Handles /accounts command to inspect, login, enable, disable, set or reset account whitelist.
   */
  public async handleAccountsCommand(args?: string): Promise<void> {
    const raw = args ? args.trim() : "";
    if (!raw) {
      process.stdout.write(this.formatAccountsList() + "\n");
      return;
    }

    const parts = raw.split(/\s+/);
    const sub = parts[0].toLowerCase();
    const rest = raw.slice(parts[0].length).trim();

    if (sub === "login") {
      const email = rest ? rest.trim() : undefined;
      await runCliPkceAuthFlow(this.pool, email, this.rl);
      return;
    }

    if (sub === "reset") {
      this.pool.setAllowedAccounts(undefined);
      this.saveWorkspaceConfig({ allowedAccounts: undefined });
      process.stdout.write(
        chalk.green("\n✔ 已重置账号白名单，所有账号均正常参与轮转。\n\n")
      );
      return;
    }

    if (sub === "set") {
      if (!rest) {
        process.stdout.write(
          chalk.yellow("\n请输入要允许的账号邮箱列表，逗号或空格分隔。例如: /accounts set acc1@a.com, acc2@b.com\n\n")
        );
        return;
      }
      const emails = rest.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      this.pool.setAllowedAccounts(emails);
      this.saveWorkspaceConfig({ allowedAccounts: this.pool.getAllowedAccounts() });
      process.stdout.write(
        chalk.green(`\n✔ 已更新账号白名单 (${emails.length} 个): ${emails.join(", ")}\n  配置已保存至 .cph/config.json，未包含账号将默认跳过。\n\n`)
      );
      return;
    }

    if (sub === "enable") {
      if (!rest) {
        process.stdout.write(
          chalk.yellow("\n请输入要启用的账号邮箱。例如: /accounts enable GSC.VFU2@cma-cgm.com\n\n")
        );
        return;
      }
      const email = rest.trim();
      this.pool.enableAccount(email);
      const updated = this.pool.getAllowedAccounts();
      this.saveWorkspaceConfig({ allowedAccounts: updated });
      process.stdout.write(
        chalk.green(`\n✔ 已启用账号: ${email}\n  配置已同步至 .cph/config.json\n\n`)
      );
      return;
    }

    if (sub === "disable") {
      if (!rest) {
        process.stdout.write(
          chalk.yellow("\n请输入要跳过的账号邮箱。例如: /accounts disable GSC.MLU@cma-cgm.com\n\n")
        );
        return;
      }
      const email = rest.trim();
      this.pool.disableAccount(email);
      const updated = this.pool.getAllowedAccounts();
      this.saveWorkspaceConfig({ allowedAccounts: updated });
      process.stdout.write(
        chalk.yellow(`\n○ 已跳过账号: ${email}\n  配置已同步至 .cph/config.json\n\n`)
      );
      return;
    }

    process.stdout.write(
      chalk.red(`\n未知子命令: "${sub}"。可用子命令: /accounts [login|set|enable|disable|reset]\n\n`)
    );
  }

  /**
   * Executes a task using CopilotOrchestrator, guarded by InterruptController and Autonomous Handoff Loop.
   */
  public async executeTask(task: string, overrideSkills?: Skill[]): Promise<void> {
    const rootTaskPrompt = task;
    const abortController = this.interruptController.beginBusy();
    const skillsToUse = overrideSkills || this.skillRegistry.getActiveSkills();

    let currentSession = this.initSession();
    const rootTitle =
      currentSession.title && currentSession.title !== "新会话"
        ? currentSession.title
        : task.slice(0, 40).replace(/\n/g, " ");

    if (currentSession.turns.length === 0 && (!currentSession.title || currentSession.title === "新会话")) {
      currentSession.title = rootTitle;
    }

    let currentTaskPrompt = task;
    let currentInitialAnnotations: AttachmentAnnotation[] | undefined = undefined;
    if (this.pendingHandoffSnapshot) {
      currentTaskPrompt = `【前序会话脱困成果快照】\n${this.pendingHandoffSnapshot}\n\n【接力执行需求】\n${task}`;
      this.pendingHandoffSnapshot = undefined;
    }

    let hopCount = 0;
    const activeSubagents = new Map<string, ActiveSubagentState>();
    const subagentStartTimes = new Map<string, number>();

    try {
      while (true) {
        if (abortController.signal.aborted) {
          break;
        }

        const result = await this.orchestrator.run({
          task: currentTaskPrompt,
          sessionId: currentSession.id,
          signal: abortController.signal,
          activeSkills: skillsToUse,
          initialAnnotations: currentInitialAnnotations,
          rootUserPrompt: rootTaskPrompt,
          events: {
            onDelta: (d) => this.renderer.renderTextChunk(d),
            onReasoning: (r) => this.renderer.renderReasoningChunk(r),
            onTurnStart: (turn) => {
              if (this.pool?.getSessionLease) {
                const leased = this.pool.getSessionLease(currentSession.id);
                if (leased) currentSession.currentAccount = leased;
              }
              this.renderer.renderTurnHeader(turn);
            },
            onToolStart: (action) => this.renderer.renderToolBadge(action),
            onToolEnd: (result) => this.renderer.renderToolResult(result),
            onSubagentStart: (id, role, spec, initialHop, account) => {
              subagentStartTimes.set(id, Date.now());
              const hop = initialHop || 1;
              activeSubagents.set(id, {
                id,
                role: role === "coder" ? "coder" : "researcher",
                account,
                description: spec?.description || spec?.prompt?.slice(0, 40) || id,
                status: "running",
                currentTurn: 1,
                durationMs: 0,
                lastAction: "正在启动会话与加载技能...",
                hopCount: hop,
                handoffCount: Math.max(0, hop - 1),
              });
              this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
            },
            onSubagentProgress: (id, turn, _delta, action, hopCount, account) => {
              const state = activeSubagents.get(id);
              if (!state) return;
              const startTime = subagentStartTimes.get(id) || Date.now();
              state.durationMs = Date.now() - startTime;
              let changed = false;
              if (account && account !== state.account) {
                state.account = account;
                changed = true;
              }
              if (hopCount && hopCount !== state.hopCount) {
                state.hopCount = hopCount;
                state.handoffCount = Math.max(0, hopCount - 1);
                changed = true;
              }
              if (turn > 0 && turn !== state.currentTurn) {
                state.currentTurn = turn;
                state.lastAction = `第 ${turn} 轮推理思考中...`;
                changed = true;
              }
              if (action) {
                const actName = action.tool || action.action || "tool";
                const target = action.path || action.filePath || action.command || "";
                state.lastAction = `${actName} ${target}`.trim();
                changed = true;
              }
              if (changed) {
                this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
              }
            },
            onSubagentEnd: (report) => {
              const state = activeSubagents.get(report.id);
              if (state) {
                state.status = report.success ? "completed" : "failed";
                state.durationMs =
                  report.durationMs ||
                  Date.now() - (subagentStartTimes.get(report.id) || Date.now());
                state.currentTurn = report.turnsCount || state.currentTurn;
                if (report.account) state.account = report.account;
                if (report.hopCount) state.hopCount = report.hopCount;
                if (report.handoffCount !== undefined) state.handoffCount = report.handoffCount;
                state.lastAction = report.success
                  ? "成果交付并完成自验证"
                  : `异常中断: ${report.error || "执行未完成"}`;
              }
              this.renderer.renderSubagentMatrix(Array.from(activeSubagents.values()));
            },
            onRefusalIntercepted: (refusal, attempt) =>
              this.renderer.renderRefusalWarning(refusal, attempt),
            onCompacted: (cleared, ratio) => {
              this.lastCompactionRatio = ratio;
              this.renderer.renderCompactedNotice(cleared, ratio);
            },
            onAccountSwitched: (oldEmail, newEmail) => {
              currentSession.currentAccount = newEmail;
              this.renderer.renderAccountSwitchedNotice(oldEmail, newEmail);
            },
            onCompleted: (ans) => this.renderer.renderFinalAnswer(ans),
            onError: (err) => this.renderer.renderError(err),
            onDisasterOccurred: (blackbox, err) =>
              this.renderer.renderDisasterBlackboxBanner(currentSession.id, err),
            onArbitratorHandoffStart: (arbId, email) =>
              this.renderer.renderArbitratorHandoffBanner(arbId, email),
            onArbitratorHandoffComplete: (_docPath, _arbId) => {},
            onAttachmentUploaded: (attachment, toolName) =>
              this.renderer.renderAttachmentUploadedNotice(attachment.fileName, toolName),
            onMainSessionVirtualized: (snapshot, path) =>
              this.renderer.renderMainVirtualizationBanner(
                snapshot?.originalSessionId || currentSession.id,
                path
              ),
            onSuccessorAwakened: (newSessionId, generation) => {
              currentSession.generation = generation;
              currentSession.handoffCount = Math.max(0, generation - 1);
              this.renderer.renderSuccessorAwakeningBanner(newSessionId, generation);
            },
          },
        });

        if (this.pool?.getSessionLease) {
          const leased = this.pool.getSessionLease(currentSession.id);
          if (leased) currentSession.currentAccount = leased;
        }

        currentInitialAnnotations = undefined;

        // Record turns and persist to disk
        const startTurnNum = currentSession.turns.length;
        if (result.history && result.history.length > 0) {
          for (let i = 0; i < result.history.length; i++) {
            const h = result.history[i];
            currentSession.turns.push({
              turnNumber: startTurnNum + i + 1,
              timestamp: new Date().toISOString(),
              userInput: h.userInput || "",
              modelReasoning: h.thought,
              modelResponse: h.response || "",
              toolCalls: h.toolName
                ? [
                    {
                      tool: h.toolName,
                      args: h.action,
                      output: h.toolOutput,
                      success: h.success,
                    },
                  ]
                : undefined,
            });
          }
        } else {
          currentSession.turns.push({
            turnNumber: startTurnNum + 1,
            timestamp: new Date().toISOString(),
            userInput: currentTaskPrompt,
            modelResponse: result.finalAnswer || "",
          });
        }
        currentSession.turnCount = currentSession.turns.length;

        if (this.orchestrator) {
          currentSession.generation =
            (this.orchestrator as any).getGeneration?.() || currentSession.generation || 1;
          currentSession.handoffCount =
            (this.orchestrator as any).getHandoffCount?.() || currentSession.handoffCount || 0;
        }

        if (result.completed) {
          currentSession.status = "completed";
          this.sessionManager.saveSession(currentSession);
          break;
        }

        if (result.handedOff) {
          currentSession.status = "handed_off";
          if (result.handoffSnapshot) {
            currentSession.handoffSnapshot = result.handoffSnapshot;
          }
          if (result.handoffDocPath) {
            currentSession.handoffDocPath = result.handoffDocPath;
          }
          if (result.disasterBlackbox) {
            currentSession.disasterBlackbox = result.disasterBlackbox;
          }
          this.sessionManager.saveSession(currentSession);

          if (!result.disasterRecovered) {
            process.stdout.write(
              chalk.yellow(
                `\n🔄 [Auto-Handoff] 当前会话已达单次推理上限，已自动提取成果快照并归档会话。\n\n`
              )
            );
            if (result.handoffSnapshot) {
              process.stdout.write(
                chalk.cyan(`【阶段性成果快照摘要】\n`) +
                  chalk.gray(result.handoffSnapshot) +
                  `\n\n`
              );
            }
          }

          if (abortController.signal.aborted) {
            break;
          }

          if (hopCount < this.maxAutonomousHandoffHops) {
            hopCount++;
            const nextStage = hopCount + 1;

            const newSession = this.sessionManager.createSession({
              title: `${rootTitle} (接力 ${hopCount})`,
              workspaceRoot: this.workspaceRoot,
              maxTurns: this.maxTurns,
              modelTone: this.modelTone,
              currentAccount: currentSession.currentAccount,
              handoffSnapshot: result.handoffSnapshot,
              handoffDocPath: result.handoffDocPath,
              disasterBlackbox: result.disasterBlackbox,
            });

            this.currentSession = newSession;
            currentSession = newSession;
            this.orchestrator.resetHandshake();
            this.lastCompactionRatio = undefined;

            let handoffAnnotation: AttachmentAnnotation | undefined = undefined;
            if (result.handoffSnapshot && this.graphTokenProvider) {
              try {
                const graphToken = await this.graphTokenProvider();
                if (graphToken) {
                  const uploadRes = await SubstrateUploader.uploadDocumentToOneDrive(
                    graphToken,
                    `handoff-${currentSession.id}.md`,
                    result.handoffSnapshot,
                    "markdown"
                  );
                  if (uploadRes?.annotation) {
                    handoffAnnotation = uploadRes.annotation;
                    currentInitialAnnotations = [handoffAnnotation];
                  }
                }
              } catch {
                // Graceful fallback to local document if upload fails
              }
            }

            if (result.disasterRecovered) {
              this.renderer.renderDisasterSuccessorBanner(
                newSession.id,
                hopCount,
                this.maxAutonomousHandoffHops,
                result.handoffDocPath
              );
            } else {
              this.renderer.renderAutonomousHandoffBanner(
                newSession.id,
                hopCount,
                this.maxAutonomousHandoffHops,
                result.handoffDocPath
              );
            }

            currentTaskPrompt = [
              `【自主${result.disasterRecovered ? "容灾" : ""}接力延续任务 - 阶段 ${nextStage}】`,
              `终极目标: ${rootTaskPrompt}`,
              `交接资产: 详细交接文档已通过附件无损挂载送达 (本地路径: ${result.handoffDocPath || "未落盘"})`,
              `物理账本: .cph/state/execution-ledger.md`,
              `【接力行动准则】`,
              `请基于${handoffAnnotation ? "附件中的交接文档" : "本地交接文档"}与物理清单，优先推进未完成的核心业务切片，严禁仅做基线核验即提前退出。`,
            ].join("\n");

            continue;
          } else {
            if (this.isInteractiveMode()) {
              const newSession = this.sessionManager.createSession({
                title: `${rootTitle} (接力)`,
                workspaceRoot: this.workspaceRoot,
                maxTurns: this.maxTurns,
                modelTone: this.modelTone,
                handoffSnapshot: result.handoffSnapshot,
                handoffDocPath: result.handoffDocPath,
                disasterBlackbox: result.disasterBlackbox,
              });

              if (result.handoffSnapshot) {
                newSession.turns.push({
                  turnNumber: 1,
                  timestamp: new Date().toISOString(),
                  userInput: `[前序会话脱困成果快照]\n${result.handoffSnapshot}`,
                  modelResponse: "已加载阶段性成果快照，随时接力推进剩余任务。",
                });
                newSession.turnCount = newSession.turns.length;
                this.sessionManager.saveSession(newSession);
              }

              this.currentSession = newSession;
              this.pendingHandoffSnapshot = result.handoffSnapshot;
              this.orchestrator.resetHandshake();
              this.lastCompactionRatio = undefined;

              process.stdout.write(
                chalk.green(
                  `✔ 已自动开启接力新会话: ${newSession.id}，阶段性快照已注入背景。\n\n`
                )
              );
            }

            process.stdout.write(
              chalk.yellow(
                `\n⚠️  [${result.disasterRecovered ? "Disaster-Recovery" : "Auto-Handoff"}] 已达到连续自主接力跃迁上限 (${this.maxAutonomousHandoffHops} 次接力)。\n` +
                  `   任务已安全挂起并保留当前全部进度。\n` +
                  (result.handoffDocPath ? `   交接文档已落盘至: ${result.handoffDocPath}\n` : "") +
                  `   如需继续推进，输入 /continue 或 /resume ${this.currentSession?.id || currentSession.id} 即可自动续跑，或直接输入新指令。\n\n`
              )
            );
            this.pendingHandoffSnapshot = result.handoffSnapshot;
            break;
          }
        }

        this.sessionManager.saveSession(currentSession);
        break;
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        this.renderer.renderAbortedNotice();
      } else {
        this.renderer.renderError(err);
      }
    } finally {
      this.interruptController.endBusy();
    }
  }

  private promptUser(customPrompt?: string): void {
    if (this.rl) {
      if (!this.isMultilineMode) {
        this.renderCurrentStatusBar();
      }
      this.rl.setPrompt(customPrompt ?? chalk.cyan("cph-pi> "));
      this.rl.prompt();
    }
  }
}

export const CPH_PI_VERSION = "0.1.0";

/**
 * Executes interactive PKCE authentication flow in CLI terminal
 */
export async function runCliPkceAuthFlow(
  pool: AccountPool,
  targetEmail?: string,
  customRl?: readline.Interface
): Promise<boolean> {
  const session = pool.startPkceAuth(targetEmail);

  process.stdout.write("\n" + chalk.bold.cyan("==================================================") + "\n");
  process.stdout.write(chalk.bold.cyan("           Microsoft 365 账号授权与换票           ") + "\n");
  process.stdout.write(chalk.bold.cyan("==================================================") + "\n\n");

  if (targetEmail) {
    process.stdout.write(chalk.yellow(`目标授权账号: ${chalk.bold(targetEmail)}\n\n`));
  }

  process.stdout.write(chalk.bold("请复制以下链接在系统浏览器中打开并完成登录:\n"));
  process.stdout.write(chalk.underline.blue(session.authUrl) + "\n\n");
  process.stdout.write(chalk.dim("登录完成后浏览器将跳转至空白页 (或显示无法访问)。\n"));
  process.stdout.write(chalk.dim("请从浏览器地址栏复制完整重定向 URL，或直接粘贴返回的 code 参数。\n\n"));

  const shouldCloseRl = !customRl;
  const rl =
    customRl ||
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  const input = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow("请输入重定向 URL 或 Code: "), (answer) => {
      resolve((answer || "").trim());
    });
  });

  if (shouldCloseRl) {
    rl.close();
  }

  if (!input) {
    process.stdout.write(chalk.red("\n✖ 输入为空，授权流程已取消。\n\n"));
    return false;
  }

  try {
    const result = await pool.completePkceAuth(input, session.state, targetEmail);
    if (!result.success) {
      process.stdout.write(
        chalk.red(`\n✖ 凭据刷新失败: ${(result as any).error || "授权验证未通过"}\n\n`)
      );
      return false;
    }

    if (result.emailMismatch) {
      process.stdout.write(
        chalk.yellow(
          `\n⚠️  检测到实际登录账号为 ${chalk.bold(result.email)}，原目标账号 ${chalk.bold(targetEmail)} 仍处于待重登状态。\n`
        ) +
          chalk.green(
            `✔ 账号 ${chalk.bold(result.email)} 已安全保存至 accounts.json 并就绪可用。\n\n`
          )
      );
    } else {
      process.stdout.write(
        chalk.green(
          `\n✔ 凭据刷新成功! 账号 ${chalk.bold(result.email)} 已安全保存至 accounts.json 并就绪可用。\n\n`
        )
      );
    }
    return true;
  } catch (err: any) {
    process.stdout.write(
      chalk.red(`\n✖ 授权流程发生异常: ${err.message || String(err)}\n\n`)
    );
    return false;
  }
}

export interface RunCliResult {
  exitCode: number;
  mode: "help" | "version" | "task" | "interactive" | "web" | "auth";
  output?: string;
  serverInstance?: WebServerInstance;
}

/**
 * CLI direct execution entry point supporting flags, tasks, and interactive mode
 */
export async function runCli(
  args: string[] = process.argv.slice(2),
  customOptions: CliOptions = {},
  isDirectRun: boolean = false
): Promise<RunCliResult> {
  const parsed = parseCliArgs(args);

  if (parsed.help) {
    const helpText = printHelp();
    if (isDirectRun) process.exit(0);
    return { exitCode: 0, mode: "help", output: helpText };
  }

  if (parsed.version) {
    const versionText = `CPH-PI v${CPH_PI_VERSION} (Copilot-Pi Hybrid Autonomous Coding Agent)`;
    process.stdout.write(versionText + "\n");
    if (isDirectRun) process.exit(0);
    return { exitCode: 0, mode: "version", output: versionText };
  }

  const options: CliOptions = {
    ...customOptions,
    workspaceRoot: parsed.workspaceRoot || customOptions.workspaceRoot,
    modelTone: parsed.hasExplicitModel ? parsed.modelTone : customOptions.modelTone,
    maxTurns: parsed.maxTurns ?? customOptions.maxTurns,
    timeoutSec: parsed.timeoutSec ?? customOptions.timeoutSec,
    maxAutonomousHandoffHops:
      parsed.maxAutonomousHandoffHops ?? customOptions.maxAutonomousHandoffHops,
    continueLast: parsed.continueLast ?? customOptions.continueLast,
    resumeSessionId: parsed.resumeSessionId || customOptions.resumeSessionId,
    customAgentId:
      customOptions.customAgentId !== undefined
        ? customOptions.customAgentId
        : (customOptions.chatClient && !parsed.hasExplicitAgent ? undefined : parsed.customAgentId),
    coderAgentId: parsed.coderAgentId || customOptions.coderAgentId,
    researcherAgentId: parsed.researcherAgentId || customOptions.researcherAgentId,
    allowedAccounts: parsed.allowedAccounts || customOptions.allowedAccounts,
    debug: parsed.debug ?? customOptions.debug,
    debugLogPath: parsed.debugLogPath || customOptions.debugLogPath,
    cloudAttachmentThresholdChars: customOptions.cloudAttachmentThresholdChars,
    cloudAttachmentThresholdLines: customOptions.cloudAttachmentThresholdLines,
    graphTokenProvider: customOptions.graphTokenProvider,
  };

  const cli = new CphPiCli(options);

  if (parsed.subcommand === "web") {
    // If no explicit workspace was specified on the CLI, adopt lastWorkspace from global config if valid
    if (!parsed.workspace && !customOptions.workspaceRoot) {
      try {
        const globalConfigPath = path.join(os.homedir(), ".cph", "global-config.json");
        if (fs.existsSync(globalConfigPath)) {
          const raw = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
          if (raw.lastWorkspace && typeof raw.lastWorkspace === "string" && fs.existsSync(raw.lastWorkspace)) {
            cli.setWorkspaceRoot(raw.lastWorkspace);
          }
        }
      } catch {}
    }

    const port = parsed.port ?? customOptions.port ?? 3000;
    const host = parsed.host ?? customOptions.host ?? "127.0.0.1";
    const autoOpen =
      customOptions.autoOpen !== undefined
        ? customOptions.autoOpen
        : parsed.noOpen
        ? false
        : true;

    const distDir = resolveWebDistDir(customOptions.distDir);
    const webDistIndex = path.resolve(distDir, "index.html");

    if (!fs.existsSync(webDistIndex)) {
      console.warn(
        chalk.yellow("⚠️  警告: 未找到前端构建产物 (web/dist/index.html)。请先运行: npm run web:build\n")
      );
    }

    const serverInstance = await startWebServer({
      port,
      host,
      autoOpen,
      distDir,
      workspaceRoot: cli.getWorkspaceRoot(),
      orchestrator: cli.getOrchestrator(),
      sessionManager: cli.getSessionManager(),
      pool: cli.getPool(),
      cliApp: cli,
      skillRegistry: cli.getSkillRegistry(),
      debug: cli.isDebugModeEnabled(),
      debugLogPath: cli.getDebugLogPath(),
      maxAutonomousHandoffHops: cli.getMaxAutonomousHandoffHops(),
      graphTokenProvider: cli.getGraphTokenProvider(),
    });

    const actualPort = serverInstance.port ?? port;
    process.stdout.write(
      chalk.bold.cyan(`\n🚀 CPH-PI Web 界面服务已就绪: http://${host}:${actualPort}\n`)
    );

    if (cli.isDebugModeEnabled()) {
      const logPath =
        cli.getDebugLogPath() || TerminalLogger.getInstance().getLogFilePath() || ".cph/logs/";
      process.stdout.write(
        chalk.green(`🐞 Debug 模式已开启，终端实时输出落盘至: ${chalk.bold(logPath)}\n`)
      );
    }

    if (isDirectRun) {
      await new Promise<void>((resolve) => {
        const shutdown = async () => {
          process.stdout.write(chalk.gray("\n正在关闭 Web 服务...\n"));
          await stopWebServer(serverInstance);
          resolve();
          process.exit(0);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
    }

    return { exitCode: 0, mode: "web", serverInstance };
  }

  if (parsed.subcommand === "auth") {
    if (parsed.authAction === "login" || !parsed.authAction) {
      const pool = cli.getPool();
      const success = await runCliPkceAuthFlow(pool, parsed.authTargetEmail, customOptions.rl);
      cli.close();
      if (isDirectRun) process.exit(success ? 0 : 1);
      return { exitCode: success ? 0 : 1, mode: "auth" };
    } else {
      process.stdout.write(
        chalk.yellow(`\n未知 auth 动作: "${parsed.authAction}"。可用命令: cph-pi auth login [email]\n\n`)
      );
      cli.close();
      if (isDirectRun) process.exit(1);
      return { exitCode: 1, mode: "auth" };
    }
  }

  if (parsed.task) {
    try {
      if (parsed.task.startsWith("/")) {
        const parsedSlash = cli.getSkillRegistry().parseSlashCommand(parsed.task);
        if (parsedSlash.skill) {
          cli.getSkillRegistry().activateSkill(parsedSlash.skill.name);
          cli.getRenderer().renderSkillActivated(parsedSlash.skill.name);
          await cli.executeTask(parsedSlash.task || parsed.task, [parsedSlash.skill]);
        } else {
          await cli.executeTask(parsed.task);
        }
      } else {
        await cli.executeTask(parsed.task);
      }
      cli.close();
      if (isDirectRun) process.exit(0);
      return { exitCode: 0, mode: "task" };
    } catch (err: any) {
      cli.close();
      if (isDirectRun) process.exit(1);
      return { exitCode: 1, mode: "task" };
    }
  }

  await cli.start();
  return { exitCode: 0, mode: "interactive" };
}

if (import.meta.main) {
  runCli(process.argv.slice(2), {}, true).catch((err) => {
    console.error(chalk.red("Fatal CLI error:"), err);
    process.exit(1);
  });
}

export { CphPiCli as CliApp };
export type { CphPiCli as CliApp };

