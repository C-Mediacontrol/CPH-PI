import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { TokenManager, type StoredAccount } from "../src/auth/token-manager.ts";
import { ChatHubClient } from "../src/transport/chathub-client.ts";

export type ProbeStatus = "PASS" | "FORBIDDEN" | "NOT_AVAILABLE" | "THROTTLED" | "AUTH_FAIL" | "ERROR";

export interface ProbeAccountResult {
  email: string;
  status: ProbeStatus;
  isEligible: boolean;
  durationMs: number;
  errorMessage?: string;
  responseSnippet?: string;
}

export interface ProbeOptions {
  agentId?: string;
  workspaceRoot?: string;
  tokenManager?: TokenManager;
  sendProbeMessage?: (email: string, agentId: string) => Promise<{ text: string }>;
  apply?: boolean;
  timeoutMs?: number;
}

export const DEFAULT_DEV_AGENT_ID =
  "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";

/**
 * Probes access permission for a single account against a target agent.
 */
export async function probeAccountAccess(
  account: StoredAccount,
  agentId: string,
  options: ProbeOptions
): Promise<ProbeAccountResult> {
  const start = Date.now();
  const email = account.email;

  try {
    if (options.sendProbeMessage) {
      const res = await options.sendProbeMessage(email, agentId);
      return {
        email,
        status: "PASS",
        isEligible: true,
        durationMs: Date.now() - start,
        responseSnippet: (res.text || "").slice(0, 60).replace(/\n/g, " "),
      };
    }

    const tokenManager = options.tokenManager || new TokenManager();
    const activeToken = typeof (tokenManager as any).getActiveSessionToken === "function"
      ? await (tokenManager as any).getActiveSessionToken(account)
      : await tokenManager.getAccessToken(account.email);
    const client = new ChatHubClient(activeToken, {
      customAgentId: agentId,
      modelTone: "Gpt_61_Sol_Reasoning",
      timeoutMs: options.timeoutMs ?? 25000,
    });

    const conversationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const response = await client.sendMessage({
      text: "Ping: 专属智能体权限探测，请直接回复 PONG 即可。",
      conversationId,
      sessionId,
      requestId,
      isStartOfSession: true,
    });

    return {
      email,
      status: "PASS",
      isEligible: true,
      durationMs: Date.now() - start,
      responseSnippet: (response.text || "").slice(0, 60).replace(/\n/g, " "),
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const msg = err?.message || String(err);
    const errorCode = err?.errorCode || "";

    if (errorCode === "GptAccessForbidden" || msg.includes("GptAccessForbidden") || msg.includes("403")) {
      return {
        email,
        status: "FORBIDDEN",
        isEligible: false,
        durationMs,
        errorMessage: "GptAccessForbidden: 未对该账号授予此 Agent 访问权限",
      };
    }

    if (errorCode === "GptNotAvailable" || msg.includes("GptNotAvailable") || msg.includes("未提供")) {
      return {
        email,
        status: "NOT_AVAILABLE",
        isEligible: false,
        durationMs,
        errorMessage: "GptNotAvailable: 该 Agent 未发布或未对当前组织/租户开放",
      };
    }

    if (
      errorCode === "Throttled" ||
      msg.includes("429") ||
      msg.includes("Rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("配额已达上限")
    ) {
      return {
        email,
        status: "THROTTLED",
        isEligible: true, // Throttled means permissions are valid, but quota temporarily reached
        durationMs,
        errorMessage: "429 Throttled: 频控限额中 (具备访问权限)",
      };
    }

    if (msg.includes("refresh_token") || msg.includes("401") || msg.includes("auth")) {
      return {
        email,
        status: "AUTH_FAIL",
        isEligible: false,
        durationMs,
        errorMessage: `认证失效: ${msg.slice(0, 60)}`,
      };
    }

    return {
      email,
      status: "ERROR",
      isEligible: false,
      durationMs,
      errorMessage: msg.slice(0, 80),
    };
  }
}

/**
 * Probes all accounts in token store and optionally applies whitelist.
 */
export async function probeAllAccounts(options: ProbeOptions = {}): Promise<ProbeAccountResult[]> {
  const root = options.workspaceRoot || process.cwd();
  const tokenManager = options.tokenManager || new TokenManager();
  const accounts = tokenManager.loadAccounts();

  let targetAgentId = options.agentId;
  if (!targetAgentId) {
    const configPath = path.join(root, ".cph", "config.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        targetAgentId = config.customAgentId;
      } catch {}
    }
  }
  if (!targetAgentId) {
    targetAgentId = DEFAULT_DEV_AGENT_ID;
  }

  const results: ProbeAccountResult[] = [];
  for (const account of accounts) {
    const result = await probeAccountAccess(account, targetAgentId, options);
    results.push(result);
  }

  if (options.apply) {
    const eligibleEmails = results.filter((r) => r.isEligible).map((r) => r.email);
    const cphDir = path.join(root, ".cph");
    const configPath = path.join(cphDir, "config.json");

    fs.mkdirSync(cphDir, { recursive: true });
    let config: Record<string, any> = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8")) || {};
      } catch {}
    }

    config.allowedAccounts = eligibleEmails;
    config.customAgentId = targetAgentId;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  return results;
}

/**
 * Formats a clean ANSI/Markdown report.
 */
export function formatProbeReport(results: ProbeAccountResult[], agentId: string): string {
  const eligible = results.filter((r) => r.isEligible);
  const forbidden = results.filter((r) => !r.isEligible);

  const lines = [
    chalk.bold.cyan("\n╔══════════════════════════════════════════════════════════════════════════════╗"),
    chalk.bold.cyan("║           CPH-PI 专属智能体 (Custom Agent) 多账号权限探测诊断报告            ║"),
    chalk.bold.cyan("╚══════════════════════════════════════════════════════════════════════════════╝"),
    `  探测目标 Agent: ${chalk.bold.green(agentId)}`,
    `  探测账号总数:   ${chalk.bold.white(String(results.length))} 个`,
    `  权限就绪账号:   ${chalk.bold.green(String(eligible.length))} 个 (可授权/建议勾选)`,
    `  拦截/跳过账号:  ${chalk.bold.red(String(forbidden.length))} 个 (未授权/需跳过)`,
    chalk.gray("──────────────────────────────────────────────────────────────────────────────"),
    chalk.bold("序号 │ 账号邮箱                    │ 状态       │ 耗时    │ 权限诊断与详情"),
    chalk.gray("─────┼─────────────────────────────┼────────────┼─────────┼────────────────────────────────────"),
  ];

  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(3, " ");
    const email = r.email.padEnd(27, " ");
    let statusBadge = "";
    let detail = "";

    switch (r.status) {
      case "PASS":
        statusBadge = chalk.green("🟢 可用   ");
        detail = chalk.green("完整交互权限 (建议勾选)");
        break;
      case "THROTTLED":
        statusBadge = chalk.yellow("⏱️  限频   ");
        detail = chalk.yellow(r.errorMessage || "429 频控 (具备权限，建议勾选)");
        break;
      case "FORBIDDEN":
        statusBadge = chalk.red("🔴 拦截   ");
        detail = chalk.red(r.errorMessage || "GptAccessForbidden (未授权)");
        break;
      case "NOT_AVAILABLE":
        statusBadge = chalk.magenta("⚠️  未发布 ");
        detail = chalk.magenta(r.errorMessage || "GptNotAvailable (未共享)");
        break;
      case "AUTH_FAIL":
        statusBadge = chalk.red("❌ 认证失效");
        detail = chalk.red(r.errorMessage || "Token 失效");
        break;
      default:
        statusBadge = chalk.gray("❓ 异常   ");
        detail = chalk.gray(r.errorMessage || "未知错误");
    }

    const time = `${r.durationMs}ms`.padEnd(7, " ");
    lines.push(` ${num} │ ${email} │ ${statusBadge} │ ${time} │ ${detail}`);
  });

  lines.push(chalk.gray("──────────────────────────────────────────────────────────────────────────────"));
  if (eligible.length > 0) {
    lines.push(
      chalk.bold.green(`✔ 推荐白名单配置:`) +
        ` [ ${eligible.map((e) => `"${e.email}"`).join(", ")} ]`
    );
  } else {
    lines.push(chalk.bold.red("✖ 警告: 未探测到任何具备该 Agent 访问权限的账号！"));
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * CLI runner for probe tool
 */
async function runProbeCli() {
  const args = process.argv.slice(2);
  let agentId: string | undefined = undefined;
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--agent" || a === "-a") {
      agentId = ChatHubClient.normalizeAgentId(args[++i]);
    } else if (a.startsWith("--agent=")) {
      agentId = ChatHubClient.normalizeAgentId(a.slice("--agent=".length));
    } else if (a === "--apply") {
      apply = true;
    }
  }

  process.stdout.write(chalk.cyan("\n[+] 正在启动多账号权限自动化探测，请稍候...\n"));

  const results = await probeAllAccounts({
    agentId,
    apply,
    workspaceRoot: process.cwd(),
  });

  const targetAgent = agentId || DEFAULT_DEV_AGENT_ID;
  const report = formatProbeReport(results, targetAgent);
  process.stdout.write(report + "\n");

  if (apply) {
    const eligible = results.filter((r) => r.isEligible);
    process.stdout.write(
      chalk.bold.green(
        `✔ 已自动应用白名单到 .cph/config.json！\n  本次已勾选启用 ${eligible.length} 个账号，未勾选账号将在会话与容灾中自动跳过。\n\n`
      )
    );
  } else {
    process.stdout.write(
      chalk.dim(
        `💡 提示: 运行 bun run scripts/probe-agent-access.ts --apply 可一键将所有可用账号写入白名单。\n` +
          `   或者在 CPH-PI 交互终端中输入 /accounts set <账号1,账号2> 自定义指定。\n\n`
      )
    );
  }
}

if (import.meta.main) {
  runProbeCli().catch((err) => {
    console.error(chalk.red("探测运行异常:"), err);
    process.exit(1);
  });
}

