import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CopilotOrchestrator, isInlineScoutTask, type OrchestratorRunOptions } from "./orchestrator.ts";
import { ToolBridge, type SubagentTaskSpec } from "../protocol/tool-bridge.ts";
import { TerminalLogger, type SessionLoggerTree } from "../ui/terminal-logger.ts";
import { AccountPool } from "../auth/account-pool.ts";
import { SessionLineageTracker } from "../session/lineage-tracker.ts";
import { SkillLoader, type Skill } from "../skills/skill-loader.ts";
import { SubstrateUploader } from "../transport/substrate-uploader.ts";
import { SnapshotGenerator } from "../workspace/snapshot-generator.ts";
import type { AttachmentAnnotation } from "../transport/types.ts";

/**
 * Clean candidate file path by stripping enclosing quotes/backticks and leading/trailing punctuation.
 */
function cleanCandidatePath(raw: string): string {
  let cleaned = raw.trim();
  // Strip quotes and backticks from edges
  cleaned = cleaned.replace(/^[`'"]+|[`'"]+$/g, "");
  // Strip trailing punctuation marks (ASCII and common full-width CJK punctuation/brackets)
  cleaned = cleaned.replace(
    /[,.;:!?`'"’”’\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\uFF09\u3011\u300B\)>\]}]+$/,
    ""
  );
  // Strip leading punctuation marks if any
  cleaned = cleaned.replace(
    /^[,\.;:!?`'"’”’\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F\uFF08\u3010\u300A\(<\[{]+/,
    ""
  );
  return cleaned.trim();
}

/**
 * Resolve candidate path against workspaceRoot and verify it exists and is a file.
 */
function resolveExistingFilePath(candidate: string, workspaceRoot: string): string | null {
  if (!candidate || typeof candidate !== "string") return null;
  const cleaned = cleanCandidatePath(candidate);
  if (!cleaned) return null;

  const tryCandidates = [cleaned];
  // If there's full-width Chinese punctuation embedded without space (e.g. "src/foo.ts，请分析")
  const cjkPunctIdx = cleaned.search(/[\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]/);
  if (cjkPunctIdx !== -1) {
    const beforePunct = cleanCandidatePath(cleaned.substring(0, cjkPunctIdx));
    if (beforePunct && beforePunct !== cleaned) {
      tryCandidates.push(beforePunct);
    }
  }

  for (const item of tryCandidates) {
    try {
      const absPath = path.isAbsolute(item) ? item : path.resolve(workspaceRoot, item);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        return absPath;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Extract target file path from SubagentTaskSpec if present and exists on disk.
 */
export function extractTargetFilePath(
  taskSpec: SubagentTaskSpec,
  workspaceRoot: string
): string | null {
  if (!taskSpec) return null;

  // a) Explicit targetPath / file / filePath
  const explicit =
    (taskSpec as any).targetPath ||
    (taskSpec as any).file ||
    (taskSpec as any).filePath;

  if (typeof explicit === "string" && explicit.trim()) {
    return resolveExistingFilePath(explicit, workspaceRoot);
  }

  // b) Check taskSpec.prompt and taskSpec.description
  const texts = [taskSpec.prompt, taskSpec.description].filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0
  );

  // Priority 1: Match prefix regex
  // 1a: Quoted prefix, e.g. 目标文件: "src/foo.ts" or `src/foo.ts`
  const quotedPrefixRegex =
    /(?:目标文件|针对文件|分析文件|读取文件|探查文件|target\s*file|file)[:：\s]+["'`]([^"'`\r\n]+)["'`]/gi;
  for (const text of texts) {
    quotedPrefixRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = quotedPrefixRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }

  // 1b: Unquoted prefix, e.g. 目标文件: src/foo.ts
  const unquotedPrefixRegex =
    /(?:目标文件|针对文件|分析文件|读取文件|探查文件|target\s*file|file)[:：\s]+([^\s\r\n`'"]+)/gi;
  for (const text of texts) {
    unquotedPrefixRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = unquotedPrefixRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }

  // Priority 2: Match backtick wrapped file path
  // `([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9_]{1,10})`
  const backtickRegex = /`([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9_]{1,10})`/g;
  for (const text of texts) {
    backtickRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = backtickRegex.exec(text)) !== null) {
      const resolved = resolveExistingFilePath(match[1], workspaceRoot);
      if (resolved) {
        return resolved;
      }
    }
  }

  // c) No valid match or file does not exist
  return null;
}

export const DEFAULT_MAIN_AGENT_ID =
  "T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852";
export const DEFAULT_CODER_AGENT_ID =
  "T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296";
export const DEFAULT_RESEARCHER_AGENT_ID =
  "T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c";

export interface SubagentRunnerOptions {
  workspaceRoot: string;
  mainSessionId: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  pool?: AccountPool | any;
  chatClientFactory?: (token: any, options: any) => any;
  loggerTree?: SessionLoggerTree;
  modelTone?: string;
  createOrchestratorFn?: (opts: any) => any;
  lineageTracker?: SessionLineageTracker;
  maxAutonomousHops?: number;
  staggerIntervalMs?: number;
}

export interface SubagentTaskReport {
  id: string;
  role: "researcher" | "coder";
  description: string;
  success: boolean;
  finalAnswer: string;
  deliverablePath?: string;
  turnsCount: number;
  durationMs: number;
  error?: string;
  targetSessionId?: string;
  hopCount?: number;
  handoffCount?: number;
  account?: string;
}

export class SubagentRunner {
  private workspaceRoot: string;
  private mainSessionId: string;
  private coderAgentId: string;
  private researcherAgentId: string;
  private pool?: any;
  private chatClientFactory?: any;
  private loggerTree?: SessionLoggerTree;
  private modelTone: string;
  private createOrchestratorFn?: (opts: any) => any;
  private lineageTracker?: SessionLineageTracker;
  private maxAutonomousHops: number;
  private staggerIntervalMs: number;

  constructor(options: SubagentRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.mainSessionId = options.mainSessionId;
    this.coderAgentId = options.coderAgentId || DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId = options.researcherAgentId || DEFAULT_RESEARCHER_AGENT_ID;
    this.pool = options.pool;
    this.chatClientFactory = options.chatClientFactory;
    this.loggerTree =
      options.loggerTree ||
      TerminalLogger.getInstance().initSessionTree(this.mainSessionId, this.workspaceRoot);
    this.modelTone = options.modelTone || "Gpt_61_Sol_Reasoning";
    this.createOrchestratorFn = options.createOrchestratorFn;
    this.lineageTracker = options.lineageTracker;
    this.maxAutonomousHops = options.maxAutonomousHops || 5;
    this.staggerIntervalMs =
      options.staggerIntervalMs ??
      (process.env.NODE_ENV === "test" || process.argv.some((a) => a.includes("test"))
        ? 0
        : 1500);
  }

  public async executeBatch(
    tasks: SubagentTaskSpec[],
    signal?: AbortSignal,
    events?: {
      onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec, hop?: number, account?: string) => void;
      onSubagentEnd?: (report: SubagentTaskReport) => void;
      onSubagentProgress?: (id: string, turn: number, delta?: string, action?: any, hopCount?: number, account?: string) => void;
    }
  ): Promise<SubagentTaskReport[]> {
    const poolStatus = (this.pool?.getPoolStatus?.() || []) as any[];
    const activeAllowedAccounts = poolStatus.filter(
      (acc) =>
        acc.isAllowed !== false &&
        !acc.isThrottled &&
        !acc.isLeased &&
        !acc.authExpired &&
        acc.isAvailable !== false
    );
    const effectiveCapacity =
      activeAllowedAccounts.length > 0
        ? activeAllowedAccounts.length
        : poolStatus.length > 0 && poolStatus.every((a) => a.isThrottled)
        ? 1
        : Math.max(1, poolStatus.length);
    const maxConcurrency = Math.max(1, Math.min(effectiveCapacity, tasks.length));

    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_QUEUE_SCHEDULED",
      totalTasks: tasks.length,
      maxConcurrency,
      poolSize: poolStatus.length,
      timestamp: Date.now(),
    });

    const settled: PromiseSettledResult<SubagentTaskReport>[] = new Array(tasks.length);

    // Group tasks by stage in ascending order (defaults to stage 1)
    const taskStageMap = tasks.map((t, idx) => ({
      index: idx,
      task: t,
      stage: Math.max(1, Math.floor(t.stage ?? 1)),
    }));
    const uniqueStages = Array.from(new Set(taskStageMap.map((t) => t.stage))).sort((a, b) => a - b);

    let circuitBreakerTriggered = false;

    for (const stage of uniqueStages) {
      const stageTasks = taskStageMap.filter((t) => t.stage === stage);

      if (circuitBreakerTriggered) {
        for (const item of stageTasks) {
          settled[item.index] = {
            status: "rejected",
            reason: new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 因前序阶段任务失败被自动熔断阻断`),
          };
        }
        continue;
      }

      if (maxConcurrency <= 1) {
        // Strict serial execution within stage
        for (const item of stageTasks) {
          if (circuitBreakerTriggered) {
            settled[item.index] = {
              status: "rejected",
              reason: new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 任务因前序任务失败被自动熔断阻断`),
            };
            continue;
          }
          if (signal?.aborted) {
            settled[item.index] = {
              status: "rejected",
              reason: new Error("Subagent execution aborted"),
            };
            continue;
          }
          const taskSpec = item.task;
          const subId = `sub-${item.index + 1}-${crypto.randomBytes(3).toString("hex")}`;
          const role = taskSpec.role === "coder" ? "coder" : "researcher";
          try {
            const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
            settled[item.index] = { status: "fulfilled", value: report };
          } catch (err) {
            settled[item.index] = { status: "rejected", reason: err };
          }
        }
      } else {
        // Sliding window concurrency within stage
        let stageCursor = 0;
        const stageWorker = async () => {
          while (stageCursor < stageTasks.length) {
            if (signal?.aborted) return;
            const itemIndex = stageCursor++;
            const item = stageTasks[itemIndex];
            const taskSpec = item.task;
            const subId = `sub-${item.index + 1}-${crypto.randomBytes(3).toString("hex")}`;
            const role = taskSpec.role === "coder" ? "coder" : "researcher";
            try {
              const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
              settled[item.index] = { status: "fulfilled", value: report };
            } catch (err) {
              settled[item.index] = { status: "rejected", reason: err };
            }
          }
        };
        const workers = Array.from(
          { length: Math.min(maxConcurrency, stageTasks.length) },
          (_, workerIdx) => {
            if (workerIdx === 0 || this.staggerIntervalMs <= 0) return stageWorker();
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                stageWorker().then(resolve, resolve);
              }, workerIdx * this.staggerIntervalMs);
            });
          }
        );
        await Promise.all(workers);
      }

      // Stage fallback guard: ensure all tasks in the current stage are settled (no holes)
      for (const item of stageTasks) {
        if (!settled[item.index]) {
          const reason = signal?.aborted
            ? new Error("Subagent execution aborted")
            : new Error(`STAGE_CIRCUIT_BREAKER: 阶段 ${stage} 任务因熔断或中断未执行`);
          settled[item.index] = {
            status: "rejected",
            reason,
          };
        }
      }

      // Check if any task in this stage failed to lock down next stages
      for (const item of stageTasks) {
        const res = settled[item.index];
        if (res?.status === "rejected" || (res?.status === "fulfilled" && !res.value.success)) {
          circuitBreakerTriggered = true;
          break;
        }
      }
    }

    // Global guard: ensure no empty slots remain in settled array
    for (let idx = 0; idx < tasks.length; idx++) {
      if (!settled[idx]) {
        settled[idx] = {
          status: "rejected",
          reason: new Error("STAGE_CIRCUIT_BREAKER: 任务未执行或被熔断阻断"),
        };
      }
    }

    const activeMainSessionId = this.lineageTracker
      ? this.lineageTracker.resolveActiveHead(this.mainSessionId)
      : this.mainSessionId;

    if (activeMainSessionId !== this.mainSessionId) {
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_REROUTED_TO_SUCCESSOR",
        originalMainSessionId: this.mainSessionId,
        activeMainSessionId,
        subagentCount: tasks.length,
        timestamp: Date.now(),
      });
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_DELIVERABLE_ROUTED",
        originalMainSessionId: this.mainSessionId,
        activeMainSessionId,
        timestamp: Date.now(),
      });
    }

    return settled.map((result, idx) => {
      const task = tasks[idx] || ({} as SubagentTaskSpec);
      const role = task.role === "coder" ? "coder" : "researcher";
      const description = task.description || `Task ${idx + 1}`;

      if (result?.status === "fulfilled" && result.value) {
        return {
          ...result.value,
          targetSessionId: activeMainSessionId,
        };
      }
      const reason = result?.reason;
      const isThrottled =
        reason?.code === "ALL_ACCOUNTS_THROTTLED" ||
        /all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(
          reason?.message || String(reason || "")
        );
      const isStageBreaker = String(reason?.message || reason || "").includes("STAGE_CIRCUIT_BREAKER");

      let errorMsg = String(reason?.message || reason || "STAGE_CIRCUIT_BREAKER");
      let finalAnswer = `子代理执行异常中断: ${errorMsg}`;

      if (isThrottled) {
        errorMsg = "ALL_ACCOUNTS_THROTTLED";
        finalAnswer =
          "❌ 子任务因全局账号池限流 (429) 中断，账号池枯竭。已保存现场断点，建议主会话等待冷却或通知用户介入。";
        this.loggerTree?.logTimelineEvent({
          type: "SUBAGENT_POOL_THROTTLED",
          subagentId: `sub-${idx + 1}`,
          role,
          targetSessionId: activeMainSessionId,
          timestamp: Date.now(),
        });
      } else if (isStageBreaker) {
        errorMsg = "STAGE_CIRCUIT_BREAKER";
        finalAnswer =
          "⚠️ 该任务因前序阶段执行失败触发阶段屏障熔断，已自动跳过执行以保护工作区。";
      }

      return {
        id: `sub-${idx + 1}`,
        role,
        description,
        success: false,
        finalAnswer,
        turnsCount: 0,
        durationMs: 0,
        error: errorMsg,
        targetSessionId: activeMainSessionId,
      };
    });

  }

  private async runSingleSubagent(
    subId: string,
    role: "researcher" | "coder",
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
    events?: any
  ): Promise<SubagentTaskReport> {
    const startTime = Date.now();
    const customAgentId = role === "coder" ? this.coderAgentId : this.researcherAgentId;
    let currentSessionId = `${this.mainSessionId}_${subId}_${role}`;

    let subagentAccount = "";
    try {
      const leaseRes = await this.pool?.acquireSessionLease?.(currentSessionId, { forAgentId: customAgentId });
      subagentAccount = leaseRes?.email || "";
    } catch {}
    if (!subagentAccount && this.pool?.getSessionLease) {
      subagentAccount = this.pool.getSessionLease(currentSessionId) || "";
    }

    events?.onSubagentStart?.(subId, role, spec, 1, subagentAccount);
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_STARTED",
      subagentId: subId,
      role,
      description: spec.description,
      account: subagentAccount || undefined,
      timestamp: startTime,
    });

    const logStream = this.loggerTree?.createSubagentLogStream(subId, role);
    logStream?.write(
      `\n=== 任务目标与初始提示词 (执行账号: ${subagentAccount || "默认"}) ===\n${spec.prompt}\n============================\n\n`
    );

    let hopCount = 0;
    let currentTaskPrompt = spec.prompt;
    const isScout = isInlineScoutTask([spec]);
    if (isScout) {
      currentTaskPrompt =
        `【斥候宏观侦察工单】：本阶段任务聚焦于目标文件的宏观结构概览与顶层大纲探查（顶层函数/类列表、对外导出与大致行号分布）。请在梳理出清晰目录大纲后，立即输出包含大纲与建议切片的 FINAL_ANSWER 结题，以便主控进入下一阶段精准拆解任务。\n\n` +
        currentTaskPrompt;
    }
    let previousSessionId: string | undefined = undefined;
    let totalTurns = 0;
    let lastFinalAnswer = "";
    let completed = false;

    // 单文件任务/局部微切片开局附件自动挂载探测
    let initialAnnotations: AttachmentAnnotation[] | undefined = undefined;
    const targetFilePath = extractTargetFilePath(spec, this.workspaceRoot);
    const specTargetFiles: string[] = Array.isArray((spec as any).targetFiles)
      ? (spec as any).targetFiles
      : [];
    const prerequisiteReports: string[] = Array.isArray((spec as any).prerequisiteReports)
      ? (spec as any).prerequisiteReports
      : [];

    if (specTargetFiles.length > 0) {
      try {
        let graphToken: string | undefined;
        if (this.pool && typeof this.pool.getGraphAccessToken === "function") {
          graphToken = await this.pool.getGraphAccessToken();
        }
        if (graphToken) {
          const sliceResult = SnapshotGenerator.generateScopedSubagentSlice(
            this.workspaceRoot,
            specTargetFiles,
            prerequisiteReports
          );
          if (sliceResult && fs.existsSync(sliceResult.slicePath)) {
            const sliceBuffer = fs.readFileSync(sliceResult.slicePath);
            const sliceName = `subagent-slice-${subId}-${path.basename(sliceResult.slicePath)}`;
            const uploaded = await SubstrateUploader.uploadDocumentAuto(
              graphToken,
              sliceBuffer,
              sliceName
            );
            if (uploaded && uploaded.annotation) {
              initialAnnotations = [uploaded.annotation];
              logStream?.write(
                `\n☁️ [开局局部微切片已直传挂载] ${sliceResult.slicePath} (${sliceName}, ${sliceResult.bytes} bytes)\n`
              );
            }
          }
        }
      } catch (err: any) {
        logStream?.write(
          `\n⚠️ [开局局部微切片直传失败，降级本地工具读取] ${err?.message || err}\n`
        );
      }
    } else if (targetFilePath && fs.existsSync(targetFilePath)) {
      try {
        let graphToken: string | undefined;
        if (this.pool && typeof this.pool.getGraphAccessToken === "function") {
          graphToken = await this.pool.getGraphAccessToken();
        }
        if (graphToken) {
          const fileContent = fs.readFileSync(targetFilePath, "utf8");
          const fileName = path.basename(targetFilePath);
          const uploaded = await SubstrateUploader.uploadDocumentToOneDrive(
            graphToken,
            fileContent,
            fileName
          );
          if (uploaded && uploaded.annotation) {
            initialAnnotations = [uploaded.annotation];
            logStream?.write(
              `\n☁️ [开局附件已直传挂载] ${targetFilePath} (${fileName})\n`
            );
          }
        }
      } catch (err: any) {
        logStream?.write(
          `\n⚠️ [开局附件直传失败，降级本地工具读取] ${err?.message || err}\n`
        );
      }
    }

    // 子代理仅挂载 handoff 技能，不挂载 subagent 技能
    let handoffSkills: Skill[] = [];
    try {
      const loader = new SkillLoader(this.workspaceRoot);
      const discovered = loader.discoverSkills();
      const handoff = discovered.find((s) => s.name.toLowerCase() === "handoff");
      if (handoff) {
        handoffSkills = [handoff];
      }
    } catch {
      // 忽略技能扫描异常
    }

    try {
      while (hopCount < this.maxAutonomousHops) {
        hopCount++;

        // 注册当前代会话节点至血缘追踪器
        if (this.lineageTracker) {
          this.lineageTracker.register({
            sessionId: currentSessionId,
            role,
            status: "active",
            parentSessionId: this.mainSessionId,
            predecessorId: previousSessionId,
          });
          this.lineageTracker.linkSubagent(this.mainSessionId, currentSessionId);
          if (previousSessionId) {
            this.lineageTracker.linkSuccessor(previousSessionId, currentSessionId);
          }
        }

        const orchestrator = this.createOrchestratorFn
          ? this.createOrchestratorFn({
              workspaceRoot: this.workspaceRoot,
              customAgentId,
              subagentRole: role,
              sessionId: currentSessionId,
              pool: this.pool,
              chatClientFactory: this.chatClientFactory,
              modelTone: this.modelTone,
              skills: ["handoff"],
              activeSkills: handoffSkills,
              task: currentTaskPrompt,
            })
          : new CopilotOrchestrator({
              workspaceRoot: this.workspaceRoot,
              customAgentId,
              sessionId: currentSessionId,
              pool: this.pool,
              chatClientFactory: this.chatClientFactory,
              modelTone: this.modelTone,
              maxTurns: spec.maxTurns || 30,
              activeSkills: handoffSkills,
            });

        const res = await orchestrator.run({
          task: currentTaskPrompt,
          initialAnnotations,
          signal,
          events: {
            onDelta: (delta: string) => {
              logStream?.write(delta);
              events?.onSubagentProgress?.(subId, -1, delta, undefined, hopCount, subagentAccount);
            },
            onTurnStart: (turn: number) => {
              if (this.pool?.getSessionLease) {
                const latest = this.pool.getSessionLease(currentSessionId);
                if (latest) subagentAccount = latest;
              }
              logStream?.write(`\n--- [Hop ${hopCount}] Turn ${turn} (账号: ${subagentAccount || "默认"}) ---\n`);
              events?.onSubagentProgress?.(subId, turn, undefined, undefined, hopCount, subagentAccount);
            },
            onToolStart: (action: any) => {
              const actName = action?.tool || action?.action || "tool";
              const target = action?.path || action?.filePath || action?.command || "";
              logStream?.write(`\n[Tool Start] ${actName} ${target}\n`);
              events?.onSubagentProgress?.(subId, -1, undefined, action, hopCount, subagentAccount);
            },
            onToolEnd: (toolRes: any) => {
              logStream?.write(`\n[Tool End] ${toolRes?.toolName || toolRes?.actionName} (success: ${toolRes?.success})\n`);
            },
          },
        });

        totalTurns += res.turnsCount || 0;
        lastFinalAnswer = res.finalAnswer || "";

        if (res.completed) {
          completed = true;
          if (this.lineageTracker) {
            this.lineageTracker.register({
              sessionId: currentSessionId,
              role,
              status: "completed",
              parentSessionId: this.mainSessionId,
              predecessorId: previousSessionId,
            });
          }
          break;
        }

        if (res.handedOff && res.handoffDocPath) {
          const docPath = res.handoffDocPath;
          const resolvedPath = path.isAbsolute(docPath)
            ? docPath
            : path.join(this.workspaceRoot, docPath);

          let docContent = "";
          if (fs.existsSync(resolvedPath)) {
            docContent = fs.readFileSync(resolvedPath, "utf8");
          } else {
            docContent = `（交接文档路径：${docPath}，前序总结：${res.finalAnswer || "无"}）`;
          }

          currentTaskPrompt =
            `【跨会话自主接力任务】前序子代理已达到 30 轮推理上限并输出交接文档。请根据下方交接文档中的【接力第一优先级待办事项】与【任务目标】，无缝接续攻坚并最终输出 FINAL_ANSWER：\n\n` +
            docContent;

          previousSessionId = currentSessionId;
          this.pool?.releaseSessionLease?.(previousSessionId);
          const nextSessionId = `${this.mainSessionId}_${subId}_${role}_hop${hopCount + 1}`;

          if (this.lineageTracker) {
            this.lineageTracker.register({
              sessionId: nextSessionId,
              role,
              status: "active",
              parentSessionId: this.mainSessionId,
              predecessorId: previousSessionId,
            });
            this.lineageTracker.linkSuccessor(previousSessionId, nextSessionId);
            this.lineageTracker.linkSubagent(this.mainSessionId, nextSessionId);
          }

          currentSessionId = nextSessionId;

          try {
            const nextLease = await this.pool?.acquireSessionLease?.(currentSessionId, { forAgentId: customAgentId });
            if (nextLease?.email) {
              subagentAccount = nextLease.email;
            }
          } catch {}
          if (!subagentAccount && this.pool?.getSessionLease) {
            subagentAccount = this.pool.getSessionLease(currentSessionId) || subagentAccount;
          }

          logStream?.write(
            `\n========================================\n` +
            `>>> [跨会话自主接力 Hop ${hopCount} -> ${hopCount + 1}] 新会话: ${nextSessionId} (账号: ${subagentAccount || "默认"}) <<<\n` +
            `========================================\n\n`
          );

          this.loggerTree?.logTimelineEvent({
            type: "SUBAGENT_CONTINUED",
            subagentId: subId,
            role,
            hop: hopCount,
            nextHop: hopCount + 1,
            handoffDocPath: docPath,
            account: subagentAccount || undefined,
            timestamp: Date.now(),
          });

          continue;
        }

        // 未完成且未产生交接文档，跳出循环
        break;
      }

      const durationMs = Date.now() - startTime;
      const success = completed;
      let finalAnswer = lastFinalAnswer;

      if (!success) {
        if (hopCount >= this.maxAutonomousHops) {
          finalAnswer =
            `子代理已达到最大自主接力代数上限 (${this.maxAutonomousHops} 代, 共 ${totalTurns} 轮)，任务尚未完全交付。` +
            (lastFinalAnswer ? ` 最后输出: ${lastFinalAnswer}` : "");
        } else if (!finalAnswer) {
          finalAnswer = `子代理执行结束，但未产生最终结论 (共 ${totalTurns} 轮)。`;
        }
      } else if (!finalAnswer) {
        finalAnswer = "子代理已完成，未提供详细文字总结。";
      }

      const targetSessionId = this.lineageTracker
        ? this.lineageTracker.resolveActiveHead(this.mainSessionId)
        : this.mainSessionId;

      const subHandoffCount = Math.max(0, hopCount - 1);
      logStream?.write(
        `\n=== [Subagent ${subId} Finished: ${success ? "SUCCESS" : "FAILED"}] ` +
        `(Total Turns: ${totalTurns}, Hops: ${hopCount}, 接手: ${subHandoffCount} 次, 账号: ${subagentAccount || "默认"}) ===\n`
      );

      // 3. 成果物理落盘: Harness 底层自动落盘为物理报告，主控只收引用 (TOC)
      let deliverablePath: string | undefined;
      try {
        const reportsDir = path.join(this.workspaceRoot, ".cph", "reports");
        fs.mkdirSync(reportsDir, { recursive: true });
        const reportFileName = `report-${role}-${subId}.md`;
        const absReportPath = path.join(reportsDir, reportFileName);
        const header = [
          `# 专项任务交付报告: ${spec.description}`,
          ``,
          `- **子任务 ID**: ${subId}`,
          `- **执行角色**: ${role}`,
          `- **最终状态**: ${success ? "SUCCESS (已完成)" : "FAILED (未达成)"}`,
          `- **执行耗时**: ${(durationMs / 1000).toFixed(1)}s (共 ${totalTurns} 轮, ${hopCount} 代)`,
          `- **物理落盘时间**: ${new Date().toISOString()}`,
          ``,
          `## 原始需求要求`,
          `\`\`\`text`,
          spec.prompt,
          `\`\`\``,
          ``,
          `## 交付结题内容`,
          ``,
        ].join("\n");
        fs.writeFileSync(absReportPath, header + finalAnswer + "\n", "utf8");
        deliverablePath = `.cph/reports/${reportFileName}`;
      } catch (saveErr) {}

      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success,
        finalAnswer,
        deliverablePath,
        turnsCount: totalTurns,
        durationMs,
        targetSessionId,
        hopCount,
        handoffCount: subHandoffCount,
        account: subagentAccount || undefined,
      };

      events?.onSubagentEnd?.(report);
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_FINISHED",
        subagentId: subId,
        role,
        account: subagentAccount || undefined,
        success: report.success,
        turnsCount: report.turnsCount,
        durationMs,
        targetSessionId,
        hopCount,
        handoffCount: subHandoffCount,
        timestamp: Date.now(),
      });

      return report;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const targetSessionId = this.lineageTracker
        ? this.lineageTracker.resolveActiveHead(this.mainSessionId)
        : this.mainSessionId;

      const isThrottled =
        err?.code === "ALL_ACCOUNTS_THROTTLED" ||
        /all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(err?.message || "");

      let errorMsg = err?.message || String(err);
      let finalAnswer = `子任务执行失败: ${errorMsg}`;

      if (isThrottled) {
        errorMsg = "ALL_ACCOUNTS_THROTTLED";
        finalAnswer =
          "❌ 子任务因全局账号池限流 (429) 中断，账号池枯竭。已保存现场断点，建议主会话等待冷却或通知用户介入。";
        this.loggerTree?.logTimelineEvent({
          type: "SUBAGENT_POOL_THROTTLED",
          subagentId: subId,
          role,
          targetSessionId,
          timestamp: Date.now(),
        });
      }

      const subHandoffCount = Math.max(0, hopCount - 1);
      logStream?.write(
        `\n=== [Subagent ${subId} Error: ${errorMsg}] ` +
        `(Hops: ${Math.max(1, hopCount)}, 接手: ${subHandoffCount} 次, 账号: ${subagentAccount || "默认"}) ===\n`
      );

      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success: false,
        finalAnswer,
        turnsCount: totalTurns,
        durationMs,
        error: errorMsg,
        targetSessionId,
        hopCount: Math.max(1, hopCount),
        handoffCount: subHandoffCount,
        account: subagentAccount || undefined,
      };
      events?.onSubagentEnd?.(report);
      return report;
    } finally {
      this.pool?.releaseSessionLease?.(currentSessionId);
      if (previousSessionId) {
        this.pool?.releaseSessionLease?.(previousSessionId);
      }
      if (logStream) {
        try {
          if (typeof (logStream as any).end === "function") {
            await new Promise<void>((resolve) => {
              let finished = false;
              const timer = setTimeout(() => {
                if (!finished) {
                  finished = true;
                  resolve();
                }
              }, 100);
              (logStream as any).end(() => {
                if (!finished) {
                  finished = true;
                  clearTimeout(timer);
                  resolve();
                }
              });
            });
          }
        } catch {}
      }
    }
  }

  public formatReportSummary(reports: SubagentTaskReport[]): string {
    if (!reports || !Array.isArray(reports)) {
      return "### 🎯 子代理多会话并发执行报告 (共 0 个子任务)\n";
    }

    const successCount = reports.filter((r) => r && r.success).length;
    const failedCount = reports.length - successCount;
    const isAllSuccess = successCount === reports.length;
    const isPartialSuccess = successCount > 0 && !isAllSuccess;

    const parts: string[] = [
      `### 🎯 子代理多会话并发执行报告 (共 ${reports.length} 个子任务 | ${successCount} 成功, ${failedCount} 失败)`,
      `**执行判定**: ${isAllSuccess ? "✅ 全量成功" : isPartialSuccess ? "🟡 部分成功 (Partial Success)" : "❌ 全部失败"}`,
      `**成果物理落盘说明**: 所有子任务的完整结题报告与证据链已由 Harness 底层自动落盘为物理报告文件（\`.cph/reports/\`）。主控会话只收取结构化目录索引（TOC），零 Token 额外开销。`,
      ``,
    ];

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      if (!r) continue;
      const statusIcon = r.success ? "✅ 成功" : "❌ 失败";
      const durationSec = ((r.durationMs ?? 0) / 1000).toFixed(1);
      const handoffs = r.handoffCount ?? Math.max(0, (r.hopCount || 1) - 1);
      const handoffLabel = handoffs > 0 ? ` (经 ${handoffs} 次接力)` : ` (接手 0 次)`;
      const accountBadge = r.account ? ` [账号: ${r.account}]` : "";
      const accountStatus = r.account ? `, 账号: ${r.account}` : "";
      const reportFile = r.deliverablePath || `.cph/reports/report-${r.role || "sub"}-${r.id}.md`;

      const rawAnswer = (r.finalAnswer || "").trim();
      const answerLines = rawAnswer.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const summarySnippet =
        answerLines.slice(0, 3).join("\n").slice(0, 300) || "（无详细文字摘要）";

      parts.push(`#### [Sub-${i + 1}] [${r.role || "unknown"}]${accountBadge} ${r.description || ""}${handoffLabel}`);
      parts.push(`- **状态**: ${statusIcon} (耗时 ${durationSec}s, 共 ${r.turnsCount ?? 0} 轮, 接手 ${handoffs} 次${accountStatus})`);
      parts.push(`- **物理报告文件**: \`${reportFile}\``);
      parts.push(`- **核心交付摘要**:`);
      parts.push(summarySnippet);
      parts.push(``);
    }

    parts.push(`---`);
    parts.push(`【主控对账与推进指引 (Plan Convergence Guidance)】:`);
    parts.push(`1. 对于状态为【✅ 成功】的子任务，其完整交付报告已落盘至对应物理文件，请立即使用 patch_file 将 plan.md 对应项更新打勾为 \`- [x] ...\`；`);
    if (failedCount > 0) {
      parts.push(`2. 对于状态为【❌ 失败】的 ${failedCount} 项子任务，仅对其发起针对性的单点重试或补充调研，请保护并复用已成功编写的计划，针对失败项进行定向补充！`);
    } else {
      parts.push(`2. 所有规划子任务均已圆满交付，若无后续 Stage，即可验证后收敛输出 FINAL_ANSWER。`);
    }

    return parts.join("\n");
  }
}
