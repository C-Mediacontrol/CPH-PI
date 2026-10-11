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

export interface TriAgentMatrixResult {
  email: string;
  main: ProbeAccountResult;
  coder: ProbeAccountResult;
  researcher: ProbeAccountResult;
  isFullEligible: boolean;
}

export interface ProbeOptions {
  agentId?: string;
  workspaceRoot?: string;
  tokenManager?: TokenManager;
  sendProbeMessage?: (email: string, agentId: string) => Promise<{ text: string }>;
  apply?: boolean;
  timeoutMs?: number;
}

export const DEFAULT_MAIN_AGENT_ID =
  "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
export const DEFAULT_CODER_AGENT_ID =
  "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296";
export const DEFAULT_RESEARCHER_AGENT_ID =
  "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c";
export const DEFAULT_DEV_AGENT_ID =
  "T_9feac605-583d-c37d-cb38-831efe727253.2d893690-5a50-4308-bb95-09fc0ece6464.gpt.1a1be0ff-8bb3-4b10-90f7-8666145e91d3";

/**
 * Resolves role aliases ('main', 'coder', 'researcher') or custom agent IDs.
 */
export function resolveAgentTarget(roleOrId?: string): {
  isTriAgent: boolean;
  agentId?: string;
  roleName?: string;
} {
  if (!roleOrId) {
    return { isTriAgent: true };
  }
  const normalized = roleOrId.trim().toLowerCase();
  if (normalized === "all" || normalized === "tri" || normalized === "tri-agent") {
    return { isTriAgent: true };
  }
  if (normalized === "main") {
    return {
      isTriAgent: false,
      agentId: DEFAULT_MAIN_AGENT_ID,
      roleName: "Main 主协调智能体",
    };
  }
  if (normalized === "coder") {
    return {
      isTriAgent: false,
      agentId: DEFAULT_CODER_AGENT_ID,
      roleName: "Coder 代码实现智能体",
    };
  }
  if (normalized === "researcher" || normalized === "searcher") {
    return {
      isTriAgent: false,
      agentId: DEFAULT_RESEARCHER_AGENT_ID,
      roleName: "Researcher 深度调研智能体",
    };
  }
  if (normalized === "dev") {
    return {
      isTriAgent: false,
      agentId: DEFAULT_DEV_AGENT_ID,
      roleName: "Dev 历史兼容智能体",
    };
  }
  return {
    isTriAgent: false,
    agentId: ChatHubClient.normalizeAgentId(roleOrId),
    roleName: "自定义 Agent",
  };
}

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
 * Probes all accounts in token store for a single target agent.
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
    targetAgentId = DEFAULT_MAIN_AGENT_ID;
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
 * Probes all accounts across Tri-Agent architecture (Main, Coder, Researcher).
 */
export async function probeAllAccountsTriAgent(
  options: ProbeOptions = {}
): Promise<TriAgentMatrixResult[]> {
  const root = options.workspaceRoot || process.cwd();
  const tokenManager = options.tokenManager || new TokenManager();
  const accounts = tokenManager.loadAccounts();

  const mainId = options.agentId || DEFAULT_MAIN_AGENT_ID;
  const coderId = DEFAULT_CODER_AGENT_ID;
  const researcherId = DEFAULT_RESEARCHER_AGENT_ID;

  const matrix: TriAgentMatrixResult[] = [];

  for (const account of accounts) {
    const mainRes = await probeAccountAccess(account, mainId, options);
    const coderRes = await probeAccountAccess(account, coderId, options);
    const researcherRes = await probeAccountAccess(account, researcherId, options);

    const isFullEligible = mainRes.isEligible && coderRes.isEligible && researcherRes.isEligible;
    matrix.push({
      email: account.email,
      main: mainRes,
      coder: coderRes,
      researcher: researcherRes,
      isFullEligible,
    });
  }

  if (options.apply) {
    const eligibleEmails = matrix.filter((m) => m.isFullEligible).map((m) => m.email);
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
    config.customAgentId = mainId;
    config.coderAgentId = coderId;
    config.researcherAgentId = researcherId;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  return matrix;
}

function formatStatusTag(status: ProbeStatus): string {
  switch (status) {
    case "PASS":
      return chalk.green("🟢 可用  ");
    case "THROTTLED":
      return chalk.yellow("⏱️  限频  ");
    case "FORBIDDEN":
      return chalk.red("🔴 拦截  ");
    case "NOT_AVAILABLE":
      return chalk.magenta("⚠️  未共享");
    case "AUTH_FAIL":
      return chalk.red("❌ 失效  ");
    default:
      return chalk.gray("❓ 异常  ");
  }
}

/**
 * Formats a clean ANSI/Markdown single-agent report.
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
    const statusBadge = formatStatusTag(r.status);
    let detail = "";

    switch (r.status) {
      case "PASS":
        detail = chalk.green("完整交互权限 (建议勾选)");
        break;
      case "THROTTLED":
        detail = chalk.yellow(r.errorMessage || "429 频控 (具备权限，建议勾选)");
        break;
      case "FORBIDDEN":
        detail = chalk.red(r.errorMessage || "GptAccessForbidden (未授权)");
        break;
      case "NOT_AVAILABLE":
        detail = chalk.magenta(r.errorMessage || "GptNotAvailable (未共享)");
        break;
      case "AUTH_FAIL":
        detail = chalk.red(r.errorMessage || "Token 失效");
        break;
      default:
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
 * Formats a clean ANSI/Markdown Tri-Agent Matrix report.
 */
export function formatProbeMatrixReport(results: TriAgentMatrixResult[]): string {
  const fullEligible = results.filter((r) => r.isFullEligible);
  const partialEligible = results.filter((r) => !r.isFullEligible && (r.main.isEligible || r.coder.isEligible || r.researcher.isEligible));
  const noneEligible = results.filter((r) => !r.main.isEligible && !r.coder.isEligible && !r.researcher.isEligible);

  const lines = [
    chalk.bold.cyan("\n╔══════════════════════════════════════════════════════════════════════════════════════════╗"),
    chalk.bold.cyan("║           CPH-PI Tri-Agent 三位一体专属智能体 多账号权限探测矩阵诊断报告                 ║"),
    chalk.bold.cyan("╚══════════════════════════════════════════════════════════════════════════════════════════╝"),
    `  探测矩阵:       [Main 主协调] + [Coder 代码实现] + [Researcher 深度调研]`,
    `  探测账号总数:   ${chalk.bold.white(String(results.length))} 个`,
    `  全就绪账号:     ${chalk.bold.green(String(fullEligible.length))} 个 (三角色全通，推荐勾选主力池)`,
    `  局部受限账号:   ${chalk.bold.yellow(String(partialEligible.length))} 个 (部分角色受阻，需在 M365 补充授权)`,
    `  完全未授权:     ${chalk.bold.red(String(noneEligible.length))} 个 (未共享/需跳过)`,
    chalk.gray("──────────────────────────────────────────────────────────────────────────────────────────"),
    chalk.bold("序号 │ 账号邮箱                    │ Main 主控  │ Coder 实现 │ Researcher │ 综合评级 │ 建议与诊断"),
    chalk.gray("─────┼─────────────────────────────┼────────────┼────────────┼────────────┼──────────┼─────────────────────"),
  ];

  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(3, " ");
    const email = r.email.padEnd(27, " ");
    const mainTag = formatStatusTag(r.main.status);
    const coderTag = formatStatusTag(r.coder.status);
    const resTag = formatStatusTag(r.researcher.status);

    let rating = "";
    let advice = "";

    if (r.isFullEligible) {
      rating = chalk.green("🌟 全就绪 ");
      advice = chalk.green("纳入主力全功能账号池");
    } else if (r.main.isEligible) {
      const missing = [];
      if (!r.coder.isEligible) missing.push("Coder");
      if (!r.researcher.isEligible) missing.push("Researcher");
      rating = chalk.yellow("⚠️  局部受限");
      advice = chalk.yellow(`主控可用，需补齐 ${missing.join("+")} 共享授权`);
    } else {
      rating = chalk.red("🔴 未授权 ");
      advice = chalk.red("未被授予主控权限，无法调度");
    }

    lines.push(` ${num} │ ${email} │ ${mainTag} │ ${coderTag} │ ${resTag} │ ${rating} │ ${advice}`);
  });

  lines.push(chalk.gray("──────────────────────────────────────────────────────────────────────────────────────────"));
  if (fullEligible.length > 0) {
    lines.push(
      chalk.bold.green(`✔ 推荐白名单配置 (全就绪账号):`) +
        ` [ ${fullEligible.map((e) => `"${e.email}"`).join(", ")} ]`
    );
  } else if (partialEligible.length > 0) {
    lines.push(
      chalk.bold.yellow(`⚠️ 暂无全就绪账号！以下账号可运行主控，但子代理将被拦截:`) +
        ` [ ${partialEligible.map((e) => `"${e.email}"`).join(", ")} ]\n` +
        chalk.cyan(`👉 请先前往 M365 Copilot 智能体管理界面为上述账号共享 Coder 与 Researcher 权限。`)
    );
  } else {
    lines.push(chalk.bold.red("✖ 警告: 未探测到任何具备 Agent 访问权限的账号！"));
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * CLI runner for probe tool
 */
async function runProbeCli() {
  const args = process.argv.slice(2);
  let rawRoleOrAgent: string | undefined = undefined;
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--agent" || a === "-a" || a === "--role" || a === "-r") {
      rawRoleOrAgent = args[++i];
    } else if (a.startsWith("--agent=")) {
      rawRoleOrAgent = a.slice("--agent=".length);
    } else if (a.startsWith("--role=")) {
      rawRoleOrAgent = a.slice("--role=".length);
    } else if (a === "--apply") {
      apply = true;
    }
  }

  const target = resolveAgentTarget(rawRoleOrAgent);

  if (target.isTriAgent) {
    process.stdout.write(
      chalk.cyan("\n[+] 正在启动 Tri-Agent 三位一体多账号权限矩阵自动化探测 (Main / Coder / Researcher)...\n")
    );

    const matrix = await probeAllAccountsTriAgent({
      apply,
      workspaceRoot: process.cwd(),
    });

    const report = formatProbeMatrixReport(matrix);
    process.stdout.write(report + "\n");

    if (apply) {
      const full = matrix.filter((r) => r.isFullEligible);
      process.stdout.write(
        chalk.bold.green(
          `✔ 已自动应用全功能白名单到 .cph/config.json！\n  本次已勾选启用 ${full.length} 个账号，并绑定默认 Tri-Agent 配置。\n\n`
        )
      );
    } else {
      process.stdout.write(
        chalk.dim(
          `💡 提示: 运行 bun run check:accounts:apply (或加 --apply) 可一键将所有全就绪账号写入白名单。\n` +
            `   若需单独探测特定角色，可运行 bun run check:accounts --role coder\n\n`
        )
      );
    }
  } else {
    process.stdout.write(
      chalk.cyan(`\n[+] 正在启动专属智能体权限探测: ${target.roleName || target.agentId}...\n`)
    );

    const results = await probeAllAccounts({
      agentId: target.agentId,
      apply,
      workspaceRoot: process.cwd(),
    });

    const report = formatProbeReport(results, target.agentId || DEFAULT_MAIN_AGENT_ID);
    process.stdout.write(report + "\n");

    if (apply) {
      const eligible = results.filter((r) => r.isEligible);
      process.stdout.write(
        chalk.bold.green(
          `✔ 已自动应用白名单到 .cph/config.json！\n  本次已勾选启用 ${eligible.length} 个账号。\n\n`
        )
      );
    }
  }
}

if (import.meta.main) {
  runProbeCli().catch((err) => {
    console.error(chalk.red("探测运行异常:"), err);
    process.exit(1);
  });
}
