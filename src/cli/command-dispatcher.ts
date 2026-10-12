import chalk from "chalk";
import { TerminalLogger } from "../ui/terminal-logger.ts";
import { CopilotOrchestrator } from "../agent/orchestrator.ts";
import type { SessionRecord } from "../session/session-manager.ts";
import type { CphPiCli } from "../cli.ts";

export type CommandHandler = (
  command: string,
  args: string
) => Promise<boolean | void> | boolean | void;

export class CommandDispatcher {
  private handlers: Map<string, CommandHandler> = new Map();

  constructor(private cli: CphPiCli) {
    this.registerDefaults();
  }

  public register(name: string, handler: CommandHandler): void {
    this.handlers.set(name.toLowerCase(), handler);
  }

  public hasCommand(name: string): boolean {
    const lower = name.toLowerCase().trim();
    const cmd = lower.split(/\s+/)[0];
    return this.handlers.has(cmd);
  }

  public async dispatch(command: string): Promise<boolean> {
    const trimmed = command.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = trimmed.slice(parts[0].length).trim();

    const handler = this.handlers.get(cmd);
    if (handler) {
      await handler(trimmed, args);
      return true;
    }

    process.stdout.write(
      chalk.red(`\n未知命令: ${command}。输入 /help 查看可用命令。\n\n`)
    );
    return false;
  }

  private registerDefaults(): void {
    // 1. /help
    this.register("/help", () => {
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
    });

    // 2. /reset
    this.register("/reset", () => {
      const current = this.cli.getCurrentSession();
      if (current) {
        current.status = "completed";
        this.cli.getSessionManager().saveSession(current);
      }

      const newSession = this.cli.getSessionManager().createSession({
        title: "新会话",
        workspaceRoot: this.cli.getWorkspaceRoot(),
        maxTurns: this.cli.getMaxTurns(),
        modelTone: this.cli.getModelTone(),
      });
      this.cli.setCurrentSession(newSession);

      const timeoutMs = this.cli.getTimeoutSec() * 1000;
      const newOrch = new CopilotOrchestrator({
        workspaceRoot: this.cli.getWorkspaceRoot(),
        modelTone: this.cli.getModelTone(),
        maxTurns: this.cli.getMaxTurns(),
        pool: this.cli.getPool(),
        chatClient: this.cli.getChatClient(),
        arbitratorChatClient: this.cli.getArbitratorChatClient(),
        chatClientFactory: this.cli.getChatClientFactory(),
        bridge: this.cli.getBridge(),
        activeSkills: this.cli.getSkillRegistry().getActiveSkills(),
        customAgentId: this.cli.getCustomAgentId(),
        timeoutMs,
      });
      this.cli.setOrchestrator(newOrch);
      this.cli.setLastCompactionRatio(undefined);

      process.stdout.write(
        chalk.green(
          `\n✔ 会话历史与上下文已重置。新会话已开启: ${newSession.id}\n\n`
        )
      );
    });

    // 3. /new
    this.register("/new", (_command, args) => {
      const title = args.trim() || undefined;
      const current = this.cli.getCurrentSession();
      if (current) {
        current.status = "completed";
        this.cli.getSessionManager().saveSession(current);
      }

      const newSession = this.cli.getSessionManager().createSession({
        title: title || "新会话",
        workspaceRoot: this.cli.getWorkspaceRoot(),
        maxTurns: this.cli.getMaxTurns(),
        modelTone: this.cli.getModelTone(),
      });
      this.cli.setCurrentSession(newSession);

      this.cli.getOrchestrator().resetHandshake();
      this.cli.setLastCompactionRatio(undefined);

      process.stdout.write(
        chalk.green(
          `\n✔ 新会话已开启: ${newSession.id}${title ? ` ("${title}")` : ""}\n  状态机已重置为 Turn 1 纯净基准探测握手。\n\n`
        )
      );
    });

    // 4. /sessions
    this.register("/sessions", () => {
      process.stdout.write(this.cli.formatSessionsList() + "\n");
    });

    // 5. /resume
    this.register("/resume", async (command, args) => {
      const parts = command.trim().split(/\s+/);
      const targetId = parts[1];
      if (!targetId) {
        process.stdout.write(
          chalk.yellow("\n请输入要恢复的会话 ID，例如: /resume ses_123\n\n")
        );
        return;
      }

      const loaded = this.cli.getSessionManager().loadSession(targetId);
      if (!loaded) {
        process.stdout.write(
          chalk.red(
            `\n未找到会话 ID: "${targetId}"。输入 /sessions 查看可用历史会话。\n\n`
          )
        );
        return;
      }

      const current = this.cli.getCurrentSession();
      if (current && current.id !== loaded.id) {
        this.cli.getSessionManager().saveSession(current);
      }

      this.cli.setCurrentSession(loaded);
      if ((loaded.turns && loaded.turns.length > 0) || loaded.handoffSnapshot) {
        this.cli.getOrchestrator().resetHandshake(false);
      } else {
        this.cli.getOrchestrator().resetHandshake();
      }

      process.stdout.write(
        chalk.green(
          `\n✔ 已恢复会话: ${loaded.id} ("${loaded.title}") [已进行 ${loaded.turnCount} 轮]\n\n`
        )
      );

      if (
        loaded.handoffSnapshot ||
        loaded.status === "handed_off" ||
        this.cli.getPendingHandoffSnapshot()
      ) {
        this.cli.setPendingHandoffSnapshot(
          loaded.handoffSnapshot || this.cli.getPendingHandoffSnapshot()
        );
        const customPrompt = parts.slice(2).join(" ").trim();
        const resumeInstruction =
          customPrompt || "请根据前序会话成果快照继续推进剩余需求";
        await this.cli.executeTask(resumeInstruction);
      }
    });

    // 6. /continue and /relay
    const handleContinue = async (command: string) => {
      let customInstruction = "";
      const trimmed = command.trim();
      if (trimmed.startsWith("/continue ")) {
        customInstruction = trimmed.slice("/continue ".length).trim();
      } else if (trimmed.startsWith("/relay ")) {
        customInstruction = trimmed.slice("/relay ".length).trim();
      }
      const resumeInstruction =
        customInstruction || "请根据前序会话成果快照继续推进剩余需求";

      let targetSession: SessionRecord | null = null;
      const current = this.cli.getCurrentSession();
      if (
        current &&
        (current.handoffSnapshot ||
          current.status === "handed_off" ||
          this.cli.getPendingHandoffSnapshot())
      ) {
        targetSession = current;
      } else {
        const sessions = this.cli.getSessionManager().listSessions();
        const candidate =
          sessions.find((s) => s.handoffSnapshot || s.status === "handed_off") ||
          sessions.find((s) => s.status === "active") ||
          sessions[0];
        if (candidate) {
          targetSession = this.cli.getSessionManager().loadSession(candidate.id);
        }
      }

      if (!targetSession) {
        process.stdout.write(
          chalk.yellow(
            "\n未发现可接力的历史会话或成果快照。输入 /sessions 查看可用会话。\n\n"
          )
        );
        return;
      }

      if (current && current.id !== targetSession.id) {
        this.cli.getSessionManager().saveSession(current);
      }

      this.cli.setCurrentSession(targetSession);
      this.cli.setPendingHandoffSnapshot(
        targetSession.handoffSnapshot || this.cli.getPendingHandoffSnapshot()
      );

      if (
        (targetSession.turns && targetSession.turns.length > 0) ||
        targetSession.handoffSnapshot
      ) {
        this.cli.getOrchestrator().resetHandshake(false);
      } else {
        this.cli.getOrchestrator().resetHandshake();
      }

      process.stdout.write(
        chalk.green(
          `\n✔ 正在接力推进会话: ${targetSession.id} ("${targetSession.title}")\n\n`
        )
      );

      await this.cli.executeTask(resumeInstruction);
    };

    this.register("/continue", handleContinue);
    this.register("/relay", handleContinue);

    // 7. /status
    this.register("/status", () => {
      process.stdout.write(this.cli.getDiagnosticCard() + "\n");
    });

    // 8. /accounts
    this.register("/accounts", (_command, args) => {
      this.cli.handleAccountsCommand(args);
    });

    // 9. /agent
    this.register("/agent", (_command, args) => {
      this.cli.handleAgentCommand(args);
    });

    // 10. /model
    this.register("/model", (_command, args) => {
      this.cli.handleModelCommand(args);
    });

    // 11. /skills
    this.register("/skills", (command, args) => {
      if (args.startsWith("find")) {
        const kw = command.slice("/skills find".length).trim();
        if (!kw) {
          process.stdout.write(
            chalk.yellow(
              "\n请输入要搜索的技能关键词，例如: /skills find tdd\n\n"
            )
          );
          return;
        }
        const matched = this.cli.getSkillRegistry().searchSkills(kw);
        if (matched.length === 0) {
          process.stdout.write(
            chalk.yellow(`\n未找到匹配关键词 "${kw}" 的技能。\n\n`)
          );
          return;
        }
        const activeNames = new Set(
          this.cli
            .getSkillRegistry()
            .getActiveSkills()
            .map((s) => s.name.toLowerCase())
        );
        const lines = [
          chalk.bold.cyan(
            `\n[搜索结果: 匹配 "${kw}" 的技能 (共 ${matched.length} 个)]`
          ),
          ...matched.map((s) => {
            const isActive = activeNames.has(s.name.toLowerCase());
            const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
            const name = isActive
              ? chalk.bold.green(s.name)
              : chalk.bold.white(s.name);
            const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
            return `  ${mark} ${name}${desc}`;
          }),
          "",
        ];
        process.stdout.write(lines.join("\n"));
        return;
      }

      const allSkills = this.cli.getSkillRegistry().getAvailableSkills();
      if (allSkills.length === 0) {
        process.stdout.write(
          chalk.yellow("\n未在工作区或全局发现可用技能。\n\n")
        );
        return;
      }
      const activeNames = new Set(
        this.cli
          .getSkillRegistry()
          .getActiveSkills()
          .map((s) => s.name.toLowerCase())
      );
      const lines = [
        chalk.bold.cyan(
          `\n[CPH-PI 可用原生技能列表 (共 ${allSkills.length} 个)]`
        ),
        ...allSkills.map((s) => {
          const isActive = activeNames.has(s.name.toLowerCase());
          const mark = isActive ? chalk.green("[✓]") : chalk.gray("[ ]");
          const name = isActive
            ? chalk.bold.green(s.name)
            : chalk.bold.white(s.name);
          const desc = s.description ? chalk.gray(` - ${s.description}`) : "";
          return `  ${mark} ${name}${desc}`;
        }),
        "",
        chalk.dim(
          "提示: 输入 /skill <name> 切换激活状态 | /skills find <kw> 搜索 | /<skill-name> <任务> 直接激活并运行"
        ),
        "",
      ];
      process.stdout.write(lines.join("\n"));
    });

    // 12. /skill
    this.register("/skill", (_command, args) => {
      const name = args.trim();
      if (!name) {
        process.stdout.write(
          chalk.yellow("\n请输入技能名称，例如: /skill brainstorming\n\n")
        );
        return;
      }
      const res = this.cli.getSkillRegistry().toggleSkill(name);
      if (!res.skill) {
        process.stdout.write(
          chalk.red(
            `\n未找到技能: "${name}"。输入 /skills 查看可用列表。\n\n`
          )
        );
      } else if (res.active) {
        process.stdout.write(
          chalk.green(
            `\n✔ 已激活技能: ${res.skill.name}${res.skill.description ? ` (${res.skill.description})` : ""}\n\n`
          )
        );
      } else {
        process.stdout.write(
          chalk.yellow(`\n○ 已停用技能: ${res.skill.name}\n\n`)
        );
      }
    });

    // 13. /debug
    this.register("/debug", (command) => {
      const parts = command.trim().split(/\s+/);
      const arg = parts[1]?.toLowerCase();
      const customPath =
        parts[1] && !["on", "off", "true", "false", "status"].includes(arg)
          ? parts.slice(1).join(" ")
          : undefined;

      if (!arg || arg === "status") {
        const statusStr = this.cli.isDebugModeEnabled()
          ? chalk.green("已开启")
          : chalk.yellow("已关闭");
        const logPath =
          TerminalLogger.getInstance().getLogFilePath() ||
          this.cli.getDebugLogPath() ||
          "(默认路径)";
        process.stdout.write(
          chalk.cyan(
            `\n[Debug 终端落盘状态]\n  状态: ${statusStr}\n  日志路径: ${chalk.white(logPath)}\n\n`
          )
        );
        return;
      }

      if (arg === "off" || arg === "false") {
        this.cli.setDebugMode(false);
        this.cli.saveWorkspaceConfig({ debug: false });
        process.stdout.write(
          chalk.yellow("\n○ Debug 模式已关闭，停止终端输出落盘。\n\n")
        );
        return;
      }

      if (arg === "on" || arg === "true" || customPath) {
        const targetPath =
          customPath || (parts[2] ? parts.slice(2).join(" ") : undefined);
        this.cli.setDebugMode(true, targetPath);
        const actualLog = TerminalLogger.getInstance().getLogFilePath();
        this.cli.saveWorkspaceConfig({ debug: true, debugLogPath: targetPath });
        process.stdout.write(
          chalk.green(
            `\n✔ Debug 模式已开启，终端实时输出落盘至: ${chalk.bold(actualLog)}\n\n`
          )
        );
      }
    });

    // 14. /exit and /quit
    const handleExit = () => {
      process.stdout.write(chalk.gray("\n退出 CPH-PI 终端。再见！\n"));
      this.cli.close();
      process.exit(0);
    };
    this.register("/exit", handleExit);
    this.register("/quit", handleExit);
  }
}
