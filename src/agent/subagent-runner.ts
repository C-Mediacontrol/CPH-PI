import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CopilotOrchestrator, type OrchestratorRunOptions } from "./orchestrator.ts";
import { ToolBridge, type SubagentTaskSpec } from "../protocol/tool-bridge.ts";
import type { SessionLoggerTree } from "../ui/terminal-logger.ts";
import { AccountPool } from "../auth/account-pool.ts";
import { SessionLineageTracker } from "../session/lineage-tracker.ts";
import { SkillLoader, type Skill } from "../skills/skill-loader.ts";

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
}

export interface SubagentTaskReport {
  id: string;
  role: "researcher" | "coder";
  description: string;
  success: boolean;
  finalAnswer: string;
  turnsCount: number;
  durationMs: number;
  error?: string;
  targetSessionId?: string;
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

  constructor(options: SubagentRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.mainSessionId = options.mainSessionId;
    this.coderAgentId = options.coderAgentId || DEFAULT_CODER_AGENT_ID;
    this.researcherAgentId = options.researcherAgentId || DEFAULT_RESEARCHER_AGENT_ID;
    this.pool = options.pool;
    this.chatClientFactory = options.chatClientFactory;
    this.loggerTree = options.loggerTree;
    this.modelTone = options.modelTone || "Gpt_61_Sol_Reasoning";
    this.createOrchestratorFn = options.createOrchestratorFn;
    this.lineageTracker = options.lineageTracker;
    this.maxAutonomousHops = options.maxAutonomousHops || 5;
  }

  public async executeBatch(
    tasks: SubagentTaskSpec[],
    signal?: AbortSignal,
    events?: {
      onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec) => void;
      onSubagentEnd?: (report: SubagentTaskReport) => void;
      onSubagentProgress?: (id: string, turn: number, delta?: string, action?: any) => void;
    }
  ): Promise<SubagentTaskReport[]> {
    const poolStatus = (this.pool?.getPoolStatus?.() || []) as any[];
    const activeAllowedAccounts = poolStatus.filter(
      (acc) => acc.isAllowed !== false && !acc.isThrottled
    );
    const effectiveCapacity = Math.max(1, activeAllowedAccounts.length || poolStatus.length || 1);
    const maxConcurrency = Math.max(1, Math.min(effectiveCapacity, tasks.length));

    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_QUEUE_SCHEDULED",
      totalTasks: tasks.length,
      maxConcurrency,
      poolSize: poolStatus.length,
      timestamp: Date.now(),
    });

    const settled: PromiseSettledResult<SubagentTaskReport>[] = new Array(tasks.length);

    if (maxConcurrency <= 1) {
      // Strict serial queue execution for single account protection
      for (let index = 0; index < tasks.length; index++) {
        if (signal?.aborted) {
          settled[index] = {
            status: "rejected",
            reason: new Error("Subagent execution aborted"),
          };
          continue;
        }
        const taskSpec = tasks[index];
        const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
        const role = taskSpec.role === "coder" ? "coder" : "researcher";
        try {
          const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
          settled[index] = { status: "fulfilled", value: report };
        } catch (err) {
          settled[index] = { status: "rejected", reason: err };
        }
      }
    } else {
      // Sliding window concurrency limited strictly to maxConcurrency
      let cursor = 0;
      const worker = async () => {
        while (cursor < tasks.length) {
          if (signal?.aborted) return;
          const index = cursor++;
          const taskSpec = tasks[index];
          const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
          const role = taskSpec.role === "coder" ? "coder" : "researcher";
          try {
            const report = await this.runSingleSubagent(subId, role, taskSpec, signal, events);
            settled[index] = { status: "fulfilled", value: report };
          } catch (err) {
            settled[index] = { status: "rejected", reason: err };
          }
        }
      };
      const workers = Array.from({ length: maxConcurrency }, () => worker());
      await Promise.all(workers);
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
      if (result.status === "fulfilled") {
        return {
          ...result.value,
          targetSessionId: activeMainSessionId,
        };
      }
      const role = tasks[idx].role === "coder" ? "coder" : "researcher";
      const reason = result.reason;
      const isThrottled =
        reason?.code === "ALL_ACCOUNTS_THROTTLED" ||
        /all accounts.*(?:throttled|rate limit|429)|429.*throttled/i.test(
          reason?.message || String(reason)
        );

      let errorMsg = String(reason?.message || reason);
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
      }

      return {
        id: `sub-${idx + 1}`,
        role,
        description: tasks[idx].description,
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
    events?.onSubagentStart?.(subId, role, spec);
    this.loggerTree?.logTimelineEvent({
      type: "SUBAGENT_STARTED",
      subagentId: subId,
      role,
      description: spec.description,
      timestamp: startTime,
    });

    const customAgentId = role === "coder" ? this.coderAgentId : this.researcherAgentId;
    const logStream = this.loggerTree?.createSubagentLogStream(subId, role);

    let hopCount = 0;
    let currentTaskPrompt = spec.prompt;
    let currentSessionId = `${this.mainSessionId}_${subId}_${role}`;
    let previousSessionId: string | undefined = undefined;
    let totalTurns = 0;
    let lastFinalAnswer = "";
    let completed = false;

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
          signal,
          events: {
            onDelta: (delta: string) => {
              logStream?.write(delta);
              events?.onSubagentProgress?.(subId, -1, delta);
            },
            onTurnStart: (turn: number) => {
              logStream?.write(`\n--- [Hop ${hopCount}] Turn ${turn} ---\n`);
              events?.onSubagentProgress?.(subId, turn);
            },
            onToolStart: (action: any) => {
              const actName = action?.tool || action?.action || "tool";
              const target = action?.path || action?.filePath || action?.command || "";
              logStream?.write(`\n[Tool Start] ${actName} ${target}\n`);
              events?.onSubagentProgress?.(subId, -1, undefined, action);
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

          this.loggerTree?.logTimelineEvent({
            type: "SUBAGENT_CONTINUED",
            subagentId: subId,
            role,
            hop: hopCount,
            nextHop: hopCount + 1,
            handoffDocPath: docPath,
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

      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success,
        finalAnswer,
        turnsCount: totalTurns,
        durationMs,
        targetSessionId,
      };

      events?.onSubagentEnd?.(report);
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_FINISHED",
        subagentId: subId,
        role,
        success: report.success,
        turnsCount: report.turnsCount,
        durationMs,
        targetSessionId,
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
      };
      events?.onSubagentEnd?.(report);
      return report;
    } finally {
      if (logStream) {
        logStream.end();
      }
    }
  }

  public formatReportSummary(reports: SubagentTaskReport[]): string {
    const parts: string[] = [
      `### 🎯 子代理多会话并发执行报告 (共 ${reports.length} 个子任务)`,
      ``,
    ];

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      const statusIcon = r.success ? "✅ 成功" : "❌ 失败";
      const durationSec = (r.durationMs / 1000).toFixed(1);
      parts.push(`#### [Sub-${i + 1}] [${r.role}] ${r.description}`);
      parts.push(`- **状态**: ${statusIcon} (耗时 ${durationSec}s, 共 ${r.turnsCount} 轮)`);
      parts.push(`- **交付结论**:`);
      parts.push(r.finalAnswer.trim());
      parts.push(``);
    }

    return parts.join("\n");
  }
}
