import chalk from "chalk";
import { TerminalLogger } from "../ui/terminal-logger.ts";
import type { SessionRecord } from "../session/session-manager.ts";

export interface ICliApp {
  getWorkspaceRoot(): string;
  getModelTone(): string;
  setModelTone(tone: string): void;
  getMaxTurns(): number;
  getTimeoutSec(): number;
  getCustomAgentId(): string | undefined;
  setCustomAgentId(id: string | undefined): void;
  getPool(): any;
  getOrchestrator(): any;
  getSessionManager(): any;
  getSkillRegistry(): any;
  getCurrentSession(): SessionRecord | null;
  setCurrentSession(session: SessionRecord | null): void;
  getPendingHandoffSnapshot(): string | undefined;
  setPendingHandoffSnapshot(snapshot?: string): void;
  setLastCompactionRatio(ratio?: number): void;
  executeTask(task: string, overrideSkills?: any[]): Promise<void>;
  close(): void;
  getDiagnosticCard(): string;
  formatSessionsList(): string;
  formatAccountsList(): string;
  handleAccountsCommand(args?: string): Promise<void> | void;
  handleAgentCommand(args?: string): void;
  handleModelCommand(args?: string): void;
  isDebugModeEnabled(): boolean;
  getDebugLogPath(): string | undefined;
  setDebugMode(enabled: boolean, logPath?: string): void;
  saveWorkspaceConfig(config: any): void;
  resetSessionAndOrchestrator(title?: string): SessionRecord;
  ledger?: any;
}

export type SlashCommandHandler = (
  cli: ICliApp,
  args: string,
  rawCommand: string
) => Promise<boolean | void> | boolean | void;

/**
 * Builtin slash commands table
 */
export const BUILTIN_SLASH_COMMANDS: Record<string, SlashCommandHandler> = {
  "/help": (_cli) => {
    const help = [
      chalk.bold.cyan("\n可用命令列表:"),
      `  ${chalk.bold.yellow("/help")}        - 显示本帮助信息与按键说明`,
      `  ${chalk.bold.yellow("/status")}      - 查看当前会话诊断卡与账号池状态`,
      `  ${chalk.bold.yellow("/accounts")}    - 查看或配置账号池 (/accounts login|enable|disable|set|reset)`,
      `  ${chalk.bold.yellow("/agent [id|clear]")} - 查看、绑定或解除专属智能体`,
      `  ${chalk.bold.yellow("/model [tone]")}      - 查看或动态切换当前模型风格`,
      `  ${chalk.bold.yellow("/debug [on|off|path]")} - 查看、开启或关闭终端输出实时落盘`,
      `  ${chalk.bold.yellow("/new [title]")} - 开启新会话 (重置两轮握手基准探测)`,
      `  ${chalk.bold.yellow("/sessions")}    - 查看当前工作区所有历史会话列表`,
      `  ${chalk.bold.yellow("/resume <id>")} - 恢复指定 ID 的历史会话 (自动续跑脱困快照)`,
      `  ${chalk.bold.yellow("/continue [任务]")} - 自动续跑当前或最近接力会话 (别名 /relay)`,
      `  ${chalk.bold.yellow("/relay [任务]")}    - 快捷接力推进当前或最近会话成果快照`,
      `  ${chalk.bold.yellow("/skills")}      - 列出所有技能并显示 [Agent内置] / [动态附件] 标识`,
      `  ${chalk.bold.yellow("/skills mounted")} - 查看已在 Agent 挂载与动态挂载的筛分总览`,
      `  ${chalk.bold.yellow("/skills mount <name>")} - 将技能设为 Agent 内置免附件轻量化唤醒`,
      `  ${chalk.bold.yellow("/skills unmount <name>")} - 将技能恢复为动态随任务挂载全量附件`,
      `  ${chalk.bold.yellow("/skills find <kw>")} - 搜索指定关键词的技能 (如 /skills find tdd)`,
      `  ${chalk.bold.yellow("/skill <name>")} - 切换指定技能的激活/停用状态`,
      `  ${chalk.bold.yellow("/<skill> <任务>")}- 快捷以专属技能模式执行任务 (如 /brainstorming 设计需求)`,
      `  ${chalk.bold.yellow("/audit")}       - 查看执行总账 (Execution Ledger) 审计状态与快照摘要`,
      `  ${chalk.bold.yellow("/clear")}       - 清空当前终端屏幕显示`,
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
  },

  "/clear": () => {
    process.stdout.write("\x1Bc");
    process.stdout.write(chalk.green("\n✔ 终端显示已清空。\n\n"));
  },

  "/audit": (cli) => {
    const ledger = cli.ledger;
    const entries = ledger && typeof ledger.getEntries === "function" ? ledger.getEntries() : [];
    const currentSession = cli.getCurrentSession();
    const info = [
      chalk.bold.cyan("\n[CPH-PI 安全审计与执行总账 (Execution Ledger)]"),
      chalk.gray("──────────────────────────────────────────────────"),
      `  工作区目录:      ${chalk.white(cli.getWorkspaceRoot())}`,
      `  当前活跃会话:    ${currentSession ? chalk.green(currentSession.id) : chalk.gray("无")}`,
      `  总账事件记录目:  ${chalk.green(String(entries.length))} 条`,
      `  当前会话已走轮数:${chalk.yellow(String(currentSession?.turnCount || 0))} 轮`,
      chalk.gray("──────────────────────────────────────────────────"),
      chalk.dim("  执行总账物理预写日志 (WAL) 由系统自动实时落盘于 .cph/state/。"),
      "",
    ].join("\n");
    process.stdout.write(info);
  },

  "/reset": (cli) => {
    const newSession = cli.resetSessionAndOrchestrator("新会话");
    process.stdout.write(
      chalk.green(`\n✔ 会话历史与上下文已重置。新会话已开启: ${newSession.id}\n\n`)
    );
  },

  "/new": (cli, args) => {
    const title = args.trim() || undefined;
    const currentSession = cli.getCurrentSession();
    if (currentSession) {
      currentSession.status = "completed";
      cli.getSessionManager().saveSession(currentSession);
    }

    const session = cli.getSessionManager().createSession({
      title: title || "新会话",
      workspaceRoot: cli.getWorkspaceRoot(),
      maxTurns: cli.getMaxTurns(),
      modelTone: cli.getModelTone(),
    });

    cli.setCurrentSession(session);
    cli.getOrchestrator().resetHandshake();
    cli.setLastCompactionRatio(undefined);

    process.stdout.write(
      chalk.green(
        `\n✔ 新会话已开启: ${session.id}${title ? ` ("${title}")` : ""}\n  状态机已重置为 Turn 1 纯净基准探测握手。\n\n`
      )
    );
  },

  "/sessions": (cli) => {
    process.stdout.write(cli.formatSessionsList() + "\n");
  },

  "/resume": async (cli, args, rawCommand) => {
    const parts = rawCommand.trim().split(/\s+/);
    const targetId = parts[1];
    if (!targetId) {
      process.stdout.write(chalk.yellow("\n请输入要恢复的会话 ID，例如: /resume ses_123\n\n"));
      return;
    }

    const loaded = cli.getSessionManager().loadSession(targetId);
    if (!loaded) {
      process.stdout.write(
        chalk.red(`\n未找到会话 ID: "${targetId}"。输入 /sessions 查看可用历史会话。\n\n`)
      );
      return;
    }

    const currentSession = cli.getCurrentSession();
    if (currentSession && currentSession.id !== loaded.id) {
      cli.getSessionManager().saveSession(currentSession);
    }

    cli.setCurrentSession(loaded);
    if ((loaded.turns && loaded.turns.length > 0) || loaded.handoffSnapshot) {
      cli.getOrchestrator().completeHandshake();
    } else {
      cli.getOrchestrator().resetHandshake();
    }

    process.stdout.write(
      chalk.green(
        `\n✔ 已恢复会话: ${loaded.id} ("${loaded.title}") [已进行 ${loaded.turnCount} 轮]\n\n`
      )
    );

    const pending = cli.getPendingHandoffSnapshot();
    if (loaded.handoffSnapshot || loaded.status === "handed_off" || pending) {
      cli.setPendingHandoffSnapshot(loaded.handoffSnapshot || pending);
      const customPrompt = parts.slice(2).join(" ").trim();
      const resumeInstruction = customPrompt || "请根据前序会话成果快照继续推进剩余需求";
      await cli.executeTask(resumeInstruction);
    }
  },

  "/continue": async (cli, args) => {
    await handleContinueOrRelay(cli, args);
  },

  "/relay": async (cli, args) => {
    await handleContinueOrRelay(cli, args);
  },

  "/status": (cli) => {
    process.stdout.write(cli.getDiagnosticCard() + "\n");
  },

  "/accounts": async (cli, args) => {
    await cli.handleAccountsCommand(args);
  },

  "/agent": (cli, args) => {
    cli.handleAgentCommand(args);
  },

  "/model": (cli, args) => {
    cli.handleModelCommand(args);
  },

  "/skills": (cli, args) => {
    const trimmed = args.trim();

    // 1. /skills mounted
    if (trimmed === "mounted") {
      const allSkills = cli.getSkillRegistry().getAvailableSkills();
      const mountedNames = cli.getSkillRegistry().getAgentMountedSkills();
      const mountedSkills = allSkills.filter((s: any) => mountedNames.has(s.name.toLowerCase()));
      const dynamicSkills = allSkills.filter((s: any) => !mountedNames.has(s.name.toLowerCase()));

      const lines = [
        chalk.bold.cyan(`\n[技能挂载筛分总览 (共 ${allSkills.length} 个技能)]`),
        chalk.gray("──────────────────────────────────────────────────"),
        chalk.bold.cyan(`◈ Agent 内置已挂载技能 (免附件/轻量通知, 共 ${mountedSkills.length} 个):`),
        mountedSkills.length === 0
          ? chalk.gray("  (暂无内置技能)")
          : mountedSkills
              .map(
                (s: any) =>
                  `  ${chalk.cyan("●")} ${chalk.bold.white(s.name)}${s.description ? chalk.gray(` - ${s.description}`) : ""}`
              )
              .join("\n"),
        "",
        chalk.bold.yellow(`◈ 动态随任务挂载技能 (全量附件/Prompt正文注入, 共 ${dynamicSkills.length} 个):`),
        dynamicSkills.length === 0
          ? chalk.gray("  (暂无动态技能)")
          : dynamicSkills
              .map(
                (s: any) =>
                  `  ${chalk.yellow("○")} ${chalk.white(s.name)}${s.description ? chalk.gray(` - ${s.description}`) : ""}`
              )
              .join("\n"),
        chalk.gray("──────────────────────────────────────────────────"),
        chalk.dim("提示: /skills mount <name> 设为内置免附件 | /skills unmount <name> 设为动态附件\n"),
      ];
      process.stdout.write(lines.join("\n"));
      return;
    }

    // 2. /skills mount <name>
    if (trimmed.startsWith("mount")) {
      const name = trimmed.slice("mount".length).trim();
      if (!name) {
        process.stdout.write(chalk.yellow("\n请输入要挂载为内置的技能名称，例如: /skills mount handoff\n\n"));
        return;
      }
      const skill = cli.getSkillRegistry().findSkill(name);
      if (!skill) {
        process.stdout.write(chalk.red(`\n未找到技能: "${name}"。输入 /skills 查看可用列表。\n\n`));
        return;
      }
      cli.getSkillRegistry().setAgentMounted(skill.name, true);
      const mountedArr = Array.from(cli.getSkillRegistry().getAgentMountedSkills());
      cli.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
      process.stdout.write(
        chalk.green(
          `\n✔ 已将技能 "${skill.name}" 设为 Agent 内置已挂载模式 (免附件传输，指令轻量化唤醒)。\n  配置已保存至 .cph/config.json\n\n`
        )
      );
      return;
    }

    // 3. /skills unmount <name>
    if (trimmed.startsWith("unmount")) {
      const name = trimmed.slice("unmount".length).trim();
      if (!name) {
        process.stdout.write(chalk.yellow("\n请输入要移除内置的技能名称，例如: /skills unmount handoff\n\n"));
        return;
      }
      const skill = cli.getSkillRegistry().findSkill(name);
      if (!skill) {
        process.stdout.write(chalk.red(`\n未找到技能: "${name}"。输入 /skills 查看可用列表。\n\n`));
        return;
      }
      cli.getSkillRegistry().setAgentMounted(skill.name, false);
      const mountedArr = Array.from(cli.getSkillRegistry().getAgentMountedSkills());
      cli.saveWorkspaceConfig({ agentMountedSkills: mountedArr });
      process.stdout.write(
        chalk.yellow(
          `\n○ 已将技能 "${skill.name}" 恢复为动态随任务挂载模式 (全量附件/Prompt正文注入)。\n  配置已保存至 .cph/config.json\n\n`
        )
      );
      return;
    }

    // 4. /skills find <kw>
    if (trimmed.startsWith("find")) {
      const kw = trimmed.slice("find".length).trim();
      if (!kw) {
        process.stdout.write(chalk.yellow("\n请输入要搜索的技能关键词，例如: /skills find tdd\n\n"));
        return;
      }
      const matched = cli.getSkillRegistry().searchSkills(kw);
      if (matched.length === 0) {
        process.stdout.write(chalk.yellow(`\n未找到匹配关键词 "${kw}" 的技能。\n\n`));
        return;
      }
      const activeNames = new Set(
        cli.getSkillRegistry().getActiveSkills().map((s: any) => s.name.toLowerCase())
      );
      const lines = [
        chalk.bold.cyan(`\n[搜索结果: 匹配 "${kw}" 的技能 (共 ${matched.length} 个)]`),
        ...matched.map((s: any) => {
          const isActive = activeNames.has(s.name.toLowerCase());
          const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
          const isMounted = cli.getSkillRegistry().isAgentMounted(s.name);
          const modeTag = isMounted ? chalk.cyan("[Agent内置]") : chalk.gray("[动态附件]");
          const name = isActive ? chalk.bold.green(s.name) : chalk.bold.white(s.name);
          const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
          return `  ${mark} ${name} ${modeTag}${desc}`;
        }),
        "",
      ];
      process.stdout.write(lines.join("\n"));
      return;
    }

    // 5. Default /skills
    const allSkills = cli.getSkillRegistry().getAvailableSkills();
    if (allSkills.length === 0) {
      process.stdout.write(chalk.yellow("\n未在工作区或全局发现可用技能。\n\n"));
      return;
    }
    const activeNames = new Set(
      cli.getSkillRegistry().getActiveSkills().map((s: any) => s.name.toLowerCase())
    );
    const lines = [
      chalk.bold.cyan(`\n[CPH-PI 可用原生技能列表 (共 ${allSkills.length} 个)]`),
      ...allSkills.map((s: any) => {
        const isActive = activeNames.has(s.name.toLowerCase());
        const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
        const isMounted = cli.getSkillRegistry().isAgentMounted(s.name);
        const modeTag = isMounted ? chalk.cyan("[Agent内置]") : chalk.gray("[动态附件]");
        const name = isActive ? chalk.bold.green(s.name) : chalk.bold.white(s.name);
        const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
        return `  ${mark} ${name} ${modeTag}${desc}`;
      }),
      "",
      chalk.dim("提示: /skill <name> 切换激活 | /skills mounted 查看分类 | /skills mount|unmount <name> 筛分挂载 | /<skill-name> <任务> 直接运行"),
      "",
    ];
    process.stdout.write(lines.join("\n"));
  },

  "/skill": (cli, args) => {
    const name = args.trim();
    if (!name) {
      process.stdout.write(chalk.yellow("\n请输入技能名称，例如: /skill brainstorming\n\n"));
      return;
    }
    const res = cli.getSkillRegistry().toggleSkill(name);
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
  },

  "/debug": (cli, args, rawCommand) => {
    const parts = rawCommand.trim().split(/\s+/);
    const arg = parts[1]?.toLowerCase();
    const customPath =
      parts[1] && !["on", "off", "true", "false", "status"].includes(arg)
        ? parts.slice(1).join(" ")
        : undefined;

    if (!arg || arg === "status") {
      const isEnabled = cli.isDebugModeEnabled();
      const statusStr = isEnabled ? chalk.green("已开启") : chalk.yellow("已关闭");
      const logPath =
        TerminalLogger.getInstance().getLogFilePath() || cli.getDebugLogPath() || "(默认路径)";
      process.stdout.write(
        chalk.cyan(
          `\n[Debug 终端落盘状态]\n  状态: ${statusStr}\n  日志路径: ${chalk.white(logPath)}\n\n`
        )
      );
      return;
    }

    if (arg === "off" || arg === "false") {
      cli.setDebugMode(false);
      cli.saveWorkspaceConfig({ debug: false });
      process.stdout.write(chalk.yellow("\n○ Debug 模式已关闭，停止终端输出落盘。\n\n"));
      return;
    }

    if (arg === "on" || arg === "true" || customPath) {
      const targetPath = customPath || (parts[2] ? parts.slice(2).join(" ") : undefined);
      cli.setDebugMode(true, targetPath);
      const actualLog = TerminalLogger.getInstance().getLogFilePath();
      cli.saveWorkspaceConfig({ debug: true, debugLogPath: targetPath });
      process.stdout.write(
        chalk.green(`\n✔ Debug 模式已开启，终端实时输出落盘至: ${chalk.bold(actualLog)}\n\n`)
      );
      return;
    }
  },

  "/exit": (cli) => {
    process.stdout.write(chalk.gray("\n退出 CPH-PI 终端。再见！\n"));
    cli.close();
    process.exit(0);
  },

  "/quit": (cli) => {
    process.stdout.write(chalk.gray("\n退出 CPH-PI 终端。再见！\n"));
    cli.close();
    process.exit(0);
  },
};

async function handleContinueOrRelay(cli: ICliApp, customInstruction: string): Promise<void> {
  const resumeInstruction = customInstruction.trim() || "请根据前序会话成果快照继续推进剩余需求";

  let targetSession: SessionRecord | null = null;
  const current = cli.getCurrentSession();
  const pending = cli.getPendingHandoffSnapshot();

  if (current && (current.handoffSnapshot || current.status === "handed_off" || pending)) {
    targetSession = current;
  } else {
    const sessions = cli.getSessionManager().listSessions();
    const candidate =
      sessions.find((s: SessionRecord) => s.handoffSnapshot || s.status === "handed_off") ||
      sessions.find((s: SessionRecord) => s.status === "active") ||
      sessions[0];
    if (candidate) {
      targetSession = cli.getSessionManager().loadSession(candidate.id);
    }
  }

  if (!targetSession) {
    process.stdout.write(
      chalk.yellow("\n未发现可接力的历史会话或成果快照。输入 /sessions 查看可用会话。\n\n")
    );
    return;
  }

  if (current && current.id !== targetSession.id) {
    cli.getSessionManager().saveSession(current);
  }

  cli.setCurrentSession(targetSession);
  cli.setPendingHandoffSnapshot(targetSession.handoffSnapshot || pending);

  if ((targetSession.turns && targetSession.turns.length > 0) || targetSession.handoffSnapshot) {
    cli.getOrchestrator().completeHandshake();
  } else {
    cli.getOrchestrator().resetHandshake();
  }

  process.stdout.write(
    chalk.green(
      `\n✔ 正在接力推进会话: ${targetSession.id} ("${targetSession.title}")\n\n`
    )
  );

  await cli.executeTask(resumeInstruction);
}

/**
 * Checks if a trimmed input string is a recognized builtin slash command
 */
export function isBuiltinSlashCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;
  const verb = trimmed.split(/\s+/)[0].toLowerCase();
  return Object.prototype.hasOwnProperty.call(BUILTIN_SLASH_COMMANDS, verb);
}

/**
 * Dispatches a slash command to the registered handler.
 * Returns true if handled, false if unknown.
 */
export async function dispatchSlashCommand(cli: ICliApp, rawCommand: string): Promise<boolean> {
  const trimmed = rawCommand.trim();
  if (!trimmed.startsWith("/")) return false;

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();
  const args = trimmed.slice(parts[0].length).trim();

  const handler = BUILTIN_SLASH_COMMANDS[verb];
  if (handler) {
    await handler(cli, args, trimmed);
    return true;
  }

  return false;
}

