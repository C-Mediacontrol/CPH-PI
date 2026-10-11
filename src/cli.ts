import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { CopilotOrchestrator, type IOrchestratorChatClient } from "./agent/orchestrator.ts";
import { InterruptController } from "./agent/interrupt-controller.ts";
import { TuiRenderer, type SessionStatusInfo } from "./ui/tui-renderer.ts";
import { AccountPool } from "./auth/account-pool.ts";
import { ToolBridge, type MappedQuestionArgs } from "./protocol/tool-bridge.ts";
import { SkillLoader, type Skill } from "./skills/skill-loader.ts";
import { SkillRegistry } from "./skills/skill-registry.ts";
import { SessionManager, type SessionRecord } from "./session/session-manager.ts";
import { ChatHubClient } from "./transport/chathub-client.ts";
import { TerminalLogger } from "./ui/terminal-logger.ts";
import {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
} from "./agent/subagent-runner.ts";

export {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
};

export interface WorkspaceConfig {
  customAgentId?: string;
  modelTone?: string;
  allowedAccounts?: string[];
  debug?: boolean;
  debugLogPath?: string;
}

export interface CphPiCliOptions {
  workspaceRoot?: string;
  workspace?: string;
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
  private debug: boolean = false;
  private debugLogPath?: string;

  constructor(options: CphPiCliOptions = {}) {
    this.workspaceRoot = path.resolve(
      options.workspaceRoot || options.workspace || process.env.CPH_PI_ORIGINAL_CWD || process.cwd()
    );

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
    this.maxAutonomousHandoffHops = options.maxAutonomousHandoffHops ?? 10;
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
    this.bridge =
      options.bridge ||
      new ToolBridge({
        cwd: this.workspaceRoot,
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
        pool: this.pool,
        chatClient: this.chatClient,
        arbitratorChatClient: this.arbitratorChatClient,
        chatClientFactory: this.chatClientFactory,
        bridge: this.bridge,
        activeSkills: this.skillRegistry.getActiveSkills(),
        customAgentId: this.customAgentId,
        coderAgentId: this.coderAgentId,
        researcherAgentId: this.researcherAgentId,
        timeoutMs,
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
          this.orchestrator.isHandshakePending = false;
        }
        return latest;
      }
    }

    if (this.resumeSessionId) {
      const loaded = this.sessionManager.loadSession(this.resumeSessionId);
      if (loaded) {
        this.currentSession = loaded;
        if (loaded.turns && loaded.turns.length > 0) {
          this.orchestrator.isHandshakePending = false;
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
    const currentAcc =
      session.currentAccount ||
      statuses.find((s) => !s.isThrottled)?.email ||
      statuses[0]?.email;

    const agentBadge = this.customAgentId
      ? (this.customAgentId.length > 15
          ? this.customAgentId.slice(0, 12) + "..."
          : this.customAgentId)
      : "通用握手模式";

    const info: SessionStatusInfo = {
      sessionId: session.id,
      turnCount: session.turnCount,
      maxTurns: session.maxTurns,
      estimatedTokens:
        estimatedChars > 0 ? Math.round(estimatedChars / 3.5) : undefined,
      compactionRatio: this.lastCompactionRatio,
      currentAccount: currentAcc,
      agentName: agentBadge,
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
      this.rl.close();
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
      const lower = trimmed.toLowerCase();
      if (
        lower === "/help" ||
        lower === "/status" ||
        lower === "/reset" ||
        lower === "/exit" ||
        lower === "/quit" ||
        lower === "/sessions" ||
        lower === "/new" ||
        lower.startsWith("/new ") ||
        lower === "/resume" ||
        lower.startsWith("/resume ") ||
        lower === "/continue" ||
        lower.startsWith("/continue ") ||
        lower === "/relay" ||
        lower.startsWith("/relay ") ||
        lower === "/skills" ||
        lower.startsWith("/skills ") ||
        lower.startsWith("/skill ") ||
        lower === "/agent" ||
        lower.startsWith("/agent ") ||
        lower === "/accounts" ||
        lower.startsWith("/accounts ") ||
        lower === "/debug" ||
        lower.startsWith("/debug ") ||
        lower === "/model" ||
        lower.startsWith("/model ")
      ) {
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
   * Dispatches slash commands.
   */
  public async handleCommand(command: string): Promise<void> {
    const cmd = command.toLowerCase().trim();

    if (cmd === "/help") {
      const help = [
        chalk.bold.cyan("\n可用命令列表:"),
        `  ${chalk.bold.yellow("/help")}        - 显示本帮助信息与按键说明`,
        `  ${chalk.bold.yellow("/status")}      - 查看当前会话诊断卡与账号池状态`,
        `  ${chalk.bold.yellow("/accounts")}    - 查看或配置账号池白名单 (/accounts enable|disable|set|reset)`,
        `  ${chalk.bold.yellow("/agent [id|clear]")} - 查看、绑定或解除专属智能体`,
        `  ${chalk.bold.yellow("/model [tone]")}      - 查看或动态切换当前模型风格`,
        `  ${chalk.bold.yellow("/debug [on|off|path]")} - 查看、开启或关闭终端输出实时落盘`,
        `  ${chalk.bold.yellow("/new [title]")} - 开启新会话 (重置两轮握手基准探测)`,
        `  ${chalk.bold.yellow("/sessions")}    - 查看当前工作区所有历史会话列表`,
        `  ${chalk.bold.yellow("/resume <id>")} - 恢复指定 ID 的历史会话 (自动续跑脱困快照)`,
        `  ${chalk.bold.yellow("/continue [任务]")} - 自动续跑当前或最近接力会话 (别名 /relay)`,
        `  ${chalk.bold.yellow("/relay [任务]")}    - 快捷接力推进当前或最近会话成果快照`,
        `  ${chalk.bold.yellow("/skills")}      - 列出所有已发现的原生技能与激活状态`,
        `  ${chalk.bold.yellow("/skills find")} - 搜索指定关键词的技能 (如 /skills find tdd)`,
        `  ${chalk.bold.yellow("/skill <name>")} - 切换指定技能的激活/停用状态`,
        `  ${chalk.bold.yellow("/<skill> <任务>")}- 快捷以专属技能模式执行任务 (如 /brainstorming 设计需求)`,
        `  ${chalk.bold.yellow("/reset")}       - 归档当前会话并开启新会话`,
        `  ${chalk.bold.yellow("/exit")}        - 安全退出终端 (或输入 /quit)`,
        "",
        chalk.bold.cyan("输入技巧与按键控制:"),
        `  ${chalk.green('"""')} 多行块   - 首行输入 """ 进入多行模式，再次输入 """ 提交`,
        `  ${chalk.green('\\')} 行尾续行    - 行末输入 \\ 可在下一行继续输入`,
        `  ${chalk.green('Ctrl+C')}        - 运行中：中止当前网络流与子进程，保留上下文`,
        `                   空闲中：1.5 秒内连按两次退出终端`,
        "",
      ].join("\n");
      process.stdout.write(help);
      return;
    }

    if (cmd === "/reset") {
      if (this.currentSession) {
        this.currentSession.status = "completed";
        this.sessionManager.saveSession(this.currentSession);
      }

      this.currentSession = this.sessionManager.createSession({
        title: "新会话",
        workspaceRoot: this.workspaceRoot,
        maxTurns: this.maxTurns,
        modelTone: this.modelTone,
      });

      this.orchestrator = new CopilotOrchestrator({
        workspaceRoot: this.workspaceRoot,
        modelTone: this.modelTone,
        maxTurns: this.maxTurns,
        pool: this.pool,
        chatClient: this.chatClient,
        arbitratorChatClient: this.arbitratorChatClient,
        chatClientFactory: this.chatClientFactory,
        bridge: this.bridge,
        activeSkills: this.skillRegistry.getActiveSkills(),
        customAgentId: this.customAgentId,
        timeoutMs: this.timeoutSec * 1000,
      } as any);
      (this.orchestrator as any).timeoutMs = this.timeoutSec * 1000;
      this.lastCompactionRatio = undefined;

      process.stdout.write(
        chalk.green(`\n✔ 会话历史与上下文已重置。新会话已开启: ${this.currentSession.id}\n\n`)
      );
      return;
    }

    if (cmd === "/new" || cmd.startsWith("/new ")) {
      let title: string | undefined = undefined;
      if (cmd.startsWith("/new ")) {
        title = command.slice("/new ".length).trim();
      }

      if (this.currentSession) {
        this.currentSession.status = "completed";
        this.sessionManager.saveSession(this.currentSession);
      }

      this.currentSession = this.sessionManager.createSession({
        title: title || "新会话",
        workspaceRoot: this.workspaceRoot,
        maxTurns: this.maxTurns,
        modelTone: this.modelTone,
      });

      this.orchestrator.resetHandshake();
      this.lastCompactionRatio = undefined;

      process.stdout.write(
        chalk.green(
          `\n✔ 新会话已开启: ${this.currentSession.id}${title ? ` ("${title}")` : ""}\n  状态机已重置为 Turn 1 纯净基准探测握手。\n\n`
        )
      );
      return;
    }

    if (cmd === "/sessions") {
      process.stdout.write(this.formatSessionsList() + "\n");
      return;
    }

    if (cmd === "/resume" || cmd.startsWith("/resume ")) {
      const parts = command.trim().split(/\s+/);
      const targetId = parts[1];
      if (!targetId) {
        process.stdout.write(chalk.yellow("\n请输入要恢复的会话 ID，例如: /resume ses_123\n\n"));
        return;
      }

      const loaded = this.sessionManager.loadSession(targetId);
      if (!loaded) {
        process.stdout.write(
          chalk.red(`\n未找到会话 ID: "${targetId}"。输入 /sessions 查看可用历史会话。\n\n`)
        );
        return;
      }

      if (this.currentSession && this.currentSession.id !== loaded.id) {
        this.sessionManager.saveSession(this.currentSession);
      }

      this.currentSession = loaded;
      if ((loaded.turns && loaded.turns.length > 0) || loaded.handoffSnapshot) {
        this.orchestrator.isHandshakePending = false;
      } else {
        this.orchestrator.resetHandshake();
      }

      process.stdout.write(
        chalk.green(
          `\n✔ 已恢复会话: ${loaded.id} ("${loaded.title}") [已进行 ${loaded.turnCount} 轮]\n\n`
        )
      );

      if (loaded.handoffSnapshot || loaded.status === "handed_off" || this.pendingHandoffSnapshot) {
        this.pendingHandoffSnapshot = loaded.handoffSnapshot || this.pendingHandoffSnapshot;
        const customPrompt = parts.slice(2).join(" ").trim();
        const resumeInstruction = customPrompt || "请根据前序会话成果快照继续推进剩余需求";
        await this.executeTask(resumeInstruction);
      }
      return;
    }

    if (
      cmd === "/continue" ||
      cmd.startsWith("/continue ") ||
      cmd === "/relay" ||
      cmd.startsWith("/relay ")
    ) {
      let customInstruction = "";
      if (cmd.startsWith("/continue ")) {
        customInstruction = command.trim().slice("/continue ".length).trim();
      } else if (cmd.startsWith("/relay ")) {
        customInstruction = command.trim().slice("/relay ".length).trim();
      }
      const resumeInstruction = customInstruction || "请根据前序会话成果快照继续推进剩余需求";

      let targetSession: SessionRecord | null = null;
      if (
        this.currentSession &&
        (this.currentSession.handoffSnapshot ||
          this.currentSession.status === "handed_off" ||
          this.pendingHandoffSnapshot)
      ) {
        targetSession = this.currentSession;
      } else {
        const sessions = this.sessionManager.listSessions();
        const candidate =
          sessions.find((s) => s.handoffSnapshot || s.status === "handed_off") ||
          sessions.find((s) => s.status === "active") ||
          sessions[0];
        if (candidate) {
          targetSession = this.sessionManager.loadSession(candidate.id);
        }
      }

      if (!targetSession) {
        process.stdout.write(
          chalk.yellow("\n未发现可接力的历史会话或成果快照。输入 /sessions 查看可用会话。\n\n")
        );
        return;
      }

      if (this.currentSession && this.currentSession.id !== targetSession.id) {
        this.sessionManager.saveSession(this.currentSession);
      }

      this.currentSession = targetSession;
      this.pendingHandoffSnapshot =
        targetSession.handoffSnapshot || this.pendingHandoffSnapshot;

      if ((targetSession.turns && targetSession.turns.length > 0) || targetSession.handoffSnapshot) {
        this.orchestrator.isHandshakePending = false;
      } else {
        this.orchestrator.resetHandshake();
      }

      process.stdout.write(
        chalk.green(
          `\n✔ 正在接力推进会话: ${targetSession.id} ("${targetSession.title}")\n\n`
        )
      );

      await this.executeTask(resumeInstruction);
      return;
    }

    if (cmd === "/status") {
      process.stdout.write(this.getDiagnosticCard() + "\n");
      return;
    }

    if (cmd === "/accounts" || cmd.startsWith("/accounts ")) {
      const args = command.trim().slice("/accounts".length).trim();
      this.handleAccountsCommand(args);
      return;
    }

    if (cmd === "/agent" || cmd.startsWith("/agent ")) {
      const args = command.trim().slice("/agent".length).trim();
      this.handleAgentCommand(args);
      return;
    }

    if (cmd === "/model" || cmd.startsWith("/model ")) {
      const args = command.trim().slice("/model".length).trim();
      this.handleModelCommand(args);
      return;
    }

    if (cmd === "/skills") {
      const allSkills = this.skillRegistry.getAvailableSkills();
      if (allSkills.length === 0) {
        process.stdout.write(chalk.yellow("\n未在工作区或全局发现可用技能。\n\n"));
        return;
      }
      const activeNames = new Set(
        this.skillRegistry.getActiveSkills().map((s) => s.name.toLowerCase())
      );
      const lines = [
        chalk.bold.cyan(`\n[CPH-PI 可用原生技能列表 (共 ${allSkills.length} 个)]`),
        ...allSkills.map((s) => {
          const isActive = activeNames.has(s.name.toLowerCase());
          const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
          const name = isActive ? chalk.bold.green(s.name) : chalk.bold.white(s.name);
          const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
          return `  ${mark} ${name}${desc}`;
        }),
        "",
        chalk.dim("提示: 输入 /skill <name> 切换激活状态 | /skills find <kw> 搜索 | /<skill-name> <任务> 直接激活并运行"),
        "",
      ];
      process.stdout.write(lines.join("\n"));
      return;
    }

    if (cmd.startsWith("/skills find")) {
      const kw = command.slice("/skills find".length).trim();
      if (!kw) {
        process.stdout.write(chalk.yellow("\n请输入要搜索的技能关键词，例如: /skills find tdd\n\n"));
        return;
      }
      const matched = this.skillRegistry.searchSkills(kw);
      if (matched.length === 0) {
        process.stdout.write(chalk.yellow(`\n未找到匹配关键词 "${kw}" 的技能。\n\n`));
        return;
      }
      const activeNames = new Set(
        this.skillRegistry.getActiveSkills().map((s) => s.name.toLowerCase())
      );
      const lines = [
        chalk.bold.cyan(`\n[搜索结果: 匹配 "${kw}" 的技能 (共 ${matched.length} 个)]`),
        ...matched.map((s) => {
          const isActive = activeNames.has(s.name.toLowerCase());
          const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
          const name = isActive ? chalk.bold.green(s.name) : chalk.bold.white(s.name);
          const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
          return `  ${mark} ${name}${desc}`;
        }),
        "",
      ];
      process.stdout.write(lines.join("\n"));
      return;
    }

    if (cmd.startsWith("/skill ")) {
      const name = command.slice("/skill ".length).trim();
      if (!name) {
        process.stdout.write(chalk.yellow("\n请输入技能名称，例如: /skill brainstorming\n\n"));
        return;
      }
      const res = this.skillRegistry.toggleSkill(name);
      if (!res.skill) {
        process.stdout.write(chalk.red(`\n未找到技能: "${name}"。输入 /skills 查看可用列表。\n\n`));
      } else if (res.active) {
        process.stdout.write(
          chalk.green(
            `\n✔ 已激活技能: ${res.skill.name}${res.skill.description ? ` (${res.skill.description})` : ""}\n\n`
          )
        );
      } else {
        process.stdout.write(chalk.yellow(`\n○ 已停用技能: ${res.skill.name}\n\n`));
      }
      return;
    }

    if (cmd === "/debug" || cmd.startsWith("/debug ")) {
      const parts = command.trim().split(/\s+/);
      const arg = parts[1]?.toLowerCase();
      const customPath =
        parts[1] && !["on", "off", "true", "false", "status"].includes(arg)
          ? parts.slice(1).join(" ")
          : undefined;

      if (!arg || arg === "status") {
        const statusStr = this.debug ? chalk.green("已开启") : chalk.yellow("已关闭");
        const logPath =
          TerminalLogger.getInstance().getLogFilePath() || this.debugLogPath || "(默认路径)";
        process.stdout.write(
          chalk.cyan(
            `\n[Debug 终端落盘状态]\n  状态: ${statusStr}\n  日志路径: ${chalk.white(logPath)}\n\n`
          )
        );
        return;
      }

      if (arg === "off" || arg === "false") {
        this.setDebugMode(false);
        this.saveWorkspaceConfig({ debug: false });
        process.stdout.write(chalk.yellow("\n○ Debug 模式已关闭，停止终端输出落盘。\n\n"));
        return;
      }

      if (arg === "on" || arg === "true" || customPath) {
        const targetPath = customPath || (parts[2] ? parts.slice(2).join(" ") : undefined);
        this.setDebugMode(true, targetPath);
        const actualLog = TerminalLogger.getInstance().getLogFilePath();
        this.saveWorkspaceConfig({ debug: true, debugLogPath: targetPath });
        process.stdout.write(
          chalk.green(`\n✔ Debug 模式已开启，终端实时输出落盘至: ${chalk.bold(actualLog)}\n\n`)
        );
        return;
      }
    }

    if (cmd === "/exit" || cmd === "/quit") {
      process.stdout.write(chalk.gray("\n退出 CPH-PI 终端。再见！\n"));
      this.close();
      process.exit(0);
    }

    process.stdout.write(chalk.red(`\n未知命令: ${command}。输入 /help 查看可用命令。\n\n`));
  }

  /**
   * Generates formatted runtime and session diagnostic card.
   */
  public getDiagnosticCard(): string {
    const statuses = this.pool.getPoolStatus();
    const available = statuses.filter((s) => !s.isThrottled).length;
    const total = statuses.length;
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
      `  当前/首选账号: ${chalk.cyan(currentSession.currentAccount || (statuses.find((s) => !s.isThrottled)?.email || "默认"))}`,
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
        const throttleBadge = s.isThrottled ? chalk.red("(429限频冷却)") : chalk.green("(就绪)");
        const allowedBadge = isAllowed ? chalk.cyan("(已启用)") : chalk.gray("(已跳过)");
        return `  ${mark} ${emailStr} ${throttleBadge} ${allowedBadge}`;
      }),
      chalk.gray("──────────────────────────────────────────────────"),
      hasFilter
        ? chalk.yellow(`  当前白名单限制: 仅启用 ${allowed.length} 个账号，其余已跳过`)
        : chalk.dim("  当前白名单限制: 未设置 (默认全部账号轮转)"),
      "",
      chalk.dim("提示: /accounts enable <email> 启用 | /accounts disable <email> 跳过 | /accounts set <e1,e2> 批量设置 | /accounts reset 全量重置"),
      "",
    ];
    return lines.join("\n");
  }

  /**
   * Handles /accounts command to inspect, enable, disable, set or reset account whitelist.
   */
  public handleAccountsCommand(args?: string): void {
    const raw = args ? args.trim() : "";
    if (!raw) {
      process.stdout.write(this.formatAccountsList() + "\n");
      return;
    }

    const parts = raw.split(/\s+/);
    const sub = parts[0].toLowerCase();
    const rest = raw.slice(parts[0].length).trim();

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
      chalk.red(`\n未知子命令: "${sub}"。可用子命令: /accounts [set|enable|disable|reset]\n\n`)
    );
  }

  /**
   * Executes a task using CopilotOrchestrator, guarded by InterruptController and Autonomous Handoff Loop.
   */
  public async executeTask(task: string, overrideSkills?: Skill[]): Promise<void> {
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
    if (this.pendingHandoffSnapshot) {
      currentTaskPrompt = `【前序会话脱困成果快照】\n${this.pendingHandoffSnapshot}\n\n【接力执行需求】\n${task}`;
      this.pendingHandoffSnapshot = undefined;
    }

    let hopCount = 0;

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
          events: {
            onDelta: (d) => this.renderer.renderTextChunk(d),
            onReasoning: (r) => this.renderer.renderReasoningChunk(r),
            onTurnStart: (turn) => this.renderer.renderTurnHeader(turn),
            onToolStart: (action) => this.renderer.renderToolBadge(action),
            onToolEnd: (result) => this.renderer.renderToolResult(result),
            onRefusalIntercepted: (refusal, attempt) =>
              this.renderer.renderRefusalWarning(refusal, attempt),
            onCompacted: (cleared, ratio) => {
              this.lastCompactionRatio = ratio;
              this.renderer.renderCompactedNotice(cleared, ratio);
            },
            onAccountSwitched: (oldEmail, newEmail) =>
              this.renderer.renderAccountSwitchedNotice(oldEmail, newEmail),
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
            onSuccessorAwakened: (newSessionId, generation) =>
              this.renderer.renderSuccessorAwakeningBanner(newSessionId, generation),
          },
        });

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
              handoffSnapshot: result.handoffSnapshot,
              handoffDocPath: result.handoffDocPath,
              disasterBlackbox: result.disasterBlackbox,
            });

            this.currentSession = newSession;
            currentSession = newSession;
            this.orchestrator.resetHandshake();
            this.lastCompactionRatio = undefined;

            if (result.disasterRecovered) {
              this.renderer.renderDisasterSuccessorBanner(
                newSession.id,
                hopCount,
                this.maxAutonomousHandoffHops,
                result.handoffDocPath
              );

              currentTaskPrompt = `【自主容灾接力延续任务 - 阶段 ${nextStage}】\n前序会话遭遇突发限流/中断，已由仲裁会话提炼高保真交接文档，请查阅以下交接文档并使用健康账号继续攻坚，优先推进卡点并完成剩余任务：\n\n${result.handoffSnapshot}\n\n【接力执行需求】\n请根据上述交接文档中的【接力第一优先级待办事项 (Actionable Next Steps)】与【任务目标与原始需求】，继续执行并最终给出完整的 FINAL_ANSWER。`;
            } else {
              this.renderer.renderAutonomousHandoffBanner(
                newSession.id,
                hopCount,
                this.maxAutonomousHandoffHops,
                result.handoffDocPath
              );

              currentTaskPrompt = `【自主接力延续任务 - 阶段 ${nextStage}】\n前序会话已达成阶段性成果并已安全脱困，请查阅以下高保真 5 维交接文档，并紧密承接前序工作，优先推进卡点并完成剩余任务：\n\n${result.handoffSnapshot}\n\n【接力执行需求】\n请根据上述交接文档中的【接力第一优先级待办事项 (Actionable Next Steps)】与【任务目标与原始需求】，继续执行并最终给出完整的 FINAL_ANSWER。`;
            }

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

export interface ParsedCliArgs {
  help: boolean;
  version: boolean;
  workspaceRoot?: string;
  modelTone?: string;
  hasExplicitModel?: boolean;
  maxTurns?: number;
  maxAutonomousHandoffHops?: number;
  timeoutSec?: number;
  task?: string;
  continueLast?: boolean;
  resumeSessionId?: string;
  customAgentId?: string;
  hasExplicitAgent?: boolean;
  coderAgentId?: string;
  researcherAgentId?: string;
  allowedAccounts?: string[];
  debug?: boolean;
  debugLogPath?: string;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    help: false,
    version: false,
  };

  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      i++;
    } else if (arg === "-v" || arg === "--version") {
      result.version = true;
      i++;
    } else if (arg === "-c" || arg === "--continue") {
      result.continueLast = true;
      i++;
    } else if (arg === "-r" || arg === "--resume") {
      result.resumeSessionId = args[++i];
      i++;
    } else if (arg.startsWith("--resume=")) {
      result.resumeSessionId = arg.slice("--resume=".length);
      i++;
    } else if (arg.startsWith("-r=")) {
      result.resumeSessionId = arg.slice("-r=".length);
      i++;
    } else if (arg === "-w" || arg === "--workspace") {
      result.workspaceRoot = args[++i];
      i++;
    } else if (arg.startsWith("--workspace=")) {
      result.workspaceRoot = arg.slice("--workspace=".length);
      i++;
    } else if (arg === "-a" || arg === "--agent") {
      result.customAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      result.hasExplicitAgent = true;
      i++;
    } else if (arg.startsWith("--agent=")) {
      result.customAgentId = ChatHubClient.normalizeAgentId(arg.slice("--agent=".length));
      result.hasExplicitAgent = true;
      i++;
    } else if (arg.startsWith("-a=")) {
      result.customAgentId = ChatHubClient.normalizeAgentId(arg.slice("-a=".length));
      result.hasExplicitAgent = true;
      i++;
    } else if (arg === "--coder-agent" || arg === "--coder-agent-id") {
      result.coderAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      i++;
    } else if (arg.startsWith("--coder-agent=")) {
      result.coderAgentId = ChatHubClient.normalizeAgentId(arg.slice("--coder-agent=".length));
      i++;
    } else if (arg.startsWith("--coder-agent-id=")) {
      result.coderAgentId = ChatHubClient.normalizeAgentId(arg.slice("--coder-agent-id=".length));
      i++;
    } else if (arg === "--researcher-agent" || arg === "--researcher-agent-id") {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(args[++i]);
      i++;
    } else if (arg.startsWith("--researcher-agent=")) {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(arg.slice("--researcher-agent=".length));
      i++;
    } else if (arg.startsWith("--researcher-agent-id=")) {
      result.researcherAgentId = ChatHubClient.normalizeAgentId(arg.slice("--researcher-agent-id=".length));
      i++;
    } else if (arg === "--accounts" || arg === "-acc") {
      const val = args[++i];
      if (val) {
        result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      }
      i++;
    } else if (arg.startsWith("--accounts=")) {
      const val = arg.slice("--accounts=".length);
      result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg.startsWith("-acc=")) {
      const val = arg.slice("-acc=".length);
      result.allowedAccounts = val.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === "-m" || arg === "--model" || arg === "--tone" || arg === "--model-tone") {
      result.modelTone = args[++i];
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--model=")) {
      result.modelTone = arg.slice("--model=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("-m=")) {
      result.modelTone = arg.slice("-m=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--tone=")) {
      result.modelTone = arg.slice("--tone=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg.startsWith("--model-tone=")) {
      result.modelTone = arg.slice("--model-tone=".length);
      result.hasExplicitModel = true;
      i++;
    } else if (arg === "--max-turns") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.maxTurns = val;
      i++;
    } else if (arg.startsWith("--max-turns=")) {
      const val = parseInt(arg.slice("--max-turns=".length), 10);
      if (!isNaN(val)) result.maxTurns = val;
      i++;
    } else if (arg === "--max-hops" || arg === "--hops") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg.startsWith("--max-hops=")) {
      const val = parseInt(arg.slice("--max-hops=".length), 10);
      if (!isNaN(val)) result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg.startsWith("--hops=")) {
      const val = parseInt(arg.slice("--hops=".length), 10);
      if (!isNaN(val)) result.maxAutonomousHandoffHops = val;
      i++;
    } else if (arg === "-d" || arg === "--debug") {
      result.debug = true;
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        const nextArg = args[i + 1];
        if (
          nextArg.endsWith(".log") ||
          nextArg.endsWith(".txt") ||
          nextArg.includes("/") ||
          nextArg.includes("\\") ||
          nextArg.includes(".")
        ) {
          result.debugLogPath = args[++i];
        }
      }
      i++;
    } else if (arg.startsWith("--debug=")) {
      result.debug = true;
      result.debugLogPath = arg.slice("--debug=".length);
      i++;
    } else if (arg === "--log" || arg === "--log-file") {
      result.debug = true;
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        result.debugLogPath = args[++i];
      }
      i++;
    } else if (arg.startsWith("--log=")) {
      result.debug = true;
      result.debugLogPath = arg.slice("--log=".length);
      i++;
    } else if (arg.startsWith("--log-file=")) {
      result.debug = true;
      result.debugLogPath = arg.slice("--log-file=".length);
      i++;
    } else if (arg === "--timeout") {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val) && val > 0) result.timeoutSec = val;
      i++;
    } else if (arg.startsWith("--timeout=")) {
      const val = parseInt(arg.slice("--timeout=".length), 10);
      if (!isNaN(val) && val > 0) result.timeoutSec = val;
      i++;
    } else if (arg === "-t") {
      const nextArg = args[i + 1];
      const num = nextArg !== undefined ? parseInt(nextArg, 10) : NaN;
      if (!isNaN(num) && String(num) === nextArg?.trim() && num > 0) {
        result.timeoutSec = num;
        i += 2;
      } else {
        result.task = args[++i];
        i++;
      }
    } else if (arg.startsWith("-t=")) {
      const raw = arg.slice("-t=".length);
      const num = parseInt(raw, 10);
      if (!isNaN(num) && String(num) === raw.trim() && num > 0) {
        result.timeoutSec = num;
      } else {
        result.task = raw;
      }
      i++;
    } else if (arg === "--task") {
      result.task = args[++i];
      i++;
    } else if (arg.startsWith("--task=")) {
      result.task = arg.slice("--task=".length);
      i++;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
      i++;
    } else {
      // Ignore other flags
      i++;
    }
  }

  if (!result.hasExplicitModel) {
    result.modelTone = "Gpt_61_Sol_Reasoning";
  }

  if (!result.customAgentId) {
    result.customAgentId = DEFAULT_MAIN_AGENT_ID;
  }
  if (!result.coderAgentId) {
    result.coderAgentId = DEFAULT_CODER_AGENT_ID;
  }
  if (!result.researcherAgentId) {
    result.researcherAgentId = DEFAULT_RESEARCHER_AGENT_ID;
  }

  const baseDir = process.env.CPH_PI_ORIGINAL_CWD || process.cwd();

  // If workspaceRoot was not explicitly set via flags (-w / --workspace)
  if (!result.workspaceRoot) {
    if (positional.length > 0) {
      const first = positional[0];
      if (first === "." || first === "./" || first === ".\\") {
        result.workspaceRoot = baseDir;
        positional.shift();
      } else {
        const resolved = path.isAbsolute(first) ? first : path.resolve(baseDir, first);
        let isDir = false;
        try {
          isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
        } catch {
          isDir = false;
        }
        if (isDir) {
          result.workspaceRoot = resolved;
          positional.shift();
        }
      }
    }
  }

  // Fallback priority: CPH_PI_ORIGINAL_CWD > process.cwd()
  if (!result.workspaceRoot) {
    result.workspaceRoot = baseDir;
  }

  if (!result.task && positional.length > 0) {
    result.task = positional.join(" ");
  }

  return result;
}

export function getHelpText(): string {
  return [
    chalk.bold.cyan("CPH-PI: Copilot-Pi Hybrid Autonomous Coding Agent"),
    "",
    chalk.bold("用法 (Usage):"),
    `  cph-pi [选项] [任务描述...]`,
    `  bun run src/cli.ts [选项] [任务描述...]`,
    "",
    chalk.bold("选项 (Options):"),
    `  ${chalk.green("-h, --help")}              显示帮助信息并退出`,
    `  ${chalk.green("-v, --version")}           显示版本号并退出`,
    `  ${chalk.green("-c, --continue")}          接续最近活跃的会话`,
    `  ${chalk.green("-r, --resume <id>")}       恢复指定 ID 的历史会话`,
    `  ${chalk.green("-w, --workspace <path>")}   指定工作区根目录 (默认: 当前目录)`,
    `  ${chalk.green("-a, --agent <id|url>")}     指定专属自建主协调智能体 ID 或 M365 分享链接 (默认: 主协调智能体)`,
    `  ${chalk.green("--coder-agent-id <id|url>")} 指定代码实现子智能体 ID (默认: 代码实现智能体)`,
    `  ${chalk.green("--researcher-agent-id <id|url>")} 指定深度调研子智能体 ID (默认: 深度调研智能体)`,
    `  ${chalk.green("-m, --model <tone>")}       指定模型风格 (默认: Gpt_61_Sol_Reasoning)`,
    `  ${chalk.green("-acc, --accounts <list>")}   设置允许启用的账号白名单 (逗号分隔，其余默认跳过)`,
    `  ${chalk.green("-d, --debug [path]")}       启用 Debug 模式并实时落盘终端输出到本地日志 (默认: .cph/logs/)`,
    `  ${chalk.green("--log <path>")}             指定终端输出落盘日志文件路径 (自动启用 Debug 模式)`,
    `  ${chalk.green("-t, --timeout <seconds>")}  单轮请求超时时间 (默认: 600 秒)`,
    `  ${chalk.green("--max-turns <n>")}          单任务最大推理循环轮数 (默认: 30)`,
    `  ${chalk.green("--max-hops, --hops <n>")}   连续自主接力跃迁上限 (默认: 10)`,
    `  ${chalk.green("--task <prompt>")}          非交互式直接执行任务并退出`,
    "",
    chalk.bold("交互模式命令 (Interactive Commands):"),
    `  ${chalk.yellow("/help")}        显示终端帮助与交互快捷键`,
    `  ${chalk.yellow("/status")}      查看当前会话诊断卡与账号池状态`,
    `  ${chalk.yellow("/accounts")}    查看或配置账号池白名单 (/accounts enable|disable|set|reset)`,
    `  ${chalk.yellow("/agent [id|clear]")} 查看、绑定或解除工作区专属智能体`,
    `  ${chalk.yellow("/model [tone]")}    查看或动态切换模型风格`,
    `  ${chalk.yellow("/debug [on|off|path]")} 查看、开启或关闭终端输出实时落盘`,
    `  ${chalk.yellow("/new [title]")} 开启新会话 (重置两轮握手基准探测)`,
    `  ${chalk.yellow("/sessions")}    查看当前工作区所有历史会话列表`,
    `  ${chalk.yellow("/resume <id>")} 恢复指定 ID 的历史会话 (自动续跑脱困快照)`,
    `  ${chalk.yellow("/continue [任务]")} 自动续跑当前或最近接力会话 (别名 /relay)`,
    `  ${chalk.yellow("/relay [任务]")}    快捷接力推进当前或最近会话成果快照`,
    `  ${chalk.yellow("/skills")}      查看所有检测到的原生技能与激活状态`,
    `  ${chalk.yellow("/skills find")} 搜索指定关键词的技能 (如 /skills find tdd)`,
    `  ${chalk.yellow("/skill <name>")} 切换指定技能的激活状态`,
    `  ${chalk.yellow("/reset")}       归档当前会话并开启新会话`,
    `  ${chalk.yellow("/exit")}        退出终端 (或 /quit)`,
    "",
    chalk.bold("键盘与中断控制 (Keyboard Controls):"),
    `  ${chalk.magenta('"""')} 多行输入      在首行输入 """ 开启多行输入，再次输入 """ 提交`,
    `  ${chalk.magenta('\\')} 行尾续行       行末尾输入 \\ 在下一行继续输入`,
    `  ${chalk.magenta("Ctrl+C")} 中断流/命令 任务运行中按 Ctrl+C 中止当前流与工具执行，保留会话`,
    `  ${chalk.magenta("Ctrl+C (连按两次)")} 空闲中 1.5 秒内连按两次安全退出终端`,
  ].join("\n");
}

export function printHelp(): string {
  const text = getHelpText();
  process.stdout.write(text + "\n");
  return text;
}

export function renderHelpBanner(): string {
  return getHelpText();
}

export const parseArgs = parseCliArgs;

export interface RunCliResult {
  exitCode: number;
  mode: "help" | "version" | "task" | "interactive";
  output?: string;
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
  };

  const cli = new CphPiCli(options);

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

