import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { ChatHubClient } from "../transport/chathub-client.ts";
import {
  DEFAULT_MAIN_AGENT_ID,
  DEFAULT_CODER_AGENT_ID,
  DEFAULT_RESEARCHER_AGENT_ID,
} from "../agent/subagent-runner.ts";

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

/**
 * Parses command line arguments supporting polymorphism for -t (timeout vs task),
 * -d/--debug flags with optional log paths, multi-agent IDs, and workspace paths.
 */
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
    `  ${chalk.green("--max-hops, --hops <n>")}   连续自主接力跃迁上限 (默认: 50)`,
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

