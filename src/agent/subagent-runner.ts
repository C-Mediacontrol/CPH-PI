import path from "node:path";
import crypto from "node:crypto";
import { CopilotOrchestrator, type OrchestratorRunOptions } from "./orchestrator.ts";
import { ToolBridge, type SubagentTaskSpec } from "../protocol/tool-bridge.ts";
import type { SessionLoggerTree } from "../ui/terminal-logger.ts";
import { AccountPool } from "../auth/account-pool.ts";

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
  }

  public async executeBatch(
    tasks: SubagentTaskSpec[],
    signal?: AbortSignal,
    events?: {
      onSubagentStart?: (id: string, role: string, spec: SubagentTaskSpec) => void;
      onSubagentEnd?: (report: SubagentTaskReport) => void;
      onSubagentProgress?: (id: string, turn: number, delta?: string) => void;
    }
  ): Promise<SubagentTaskReport[]> {
    const promises = tasks.map((taskSpec, index) => {
      const subId = `sub-${index + 1}-${crypto.randomBytes(3).toString("hex")}`;
      const role = taskSpec.role === "coder" ? "coder" : "researcher";
      return this.runSingleSubagent(subId, role, taskSpec, signal, events);
    });

    const settled = await Promise.allSettled(promises);
    return settled.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const role = tasks[idx].role === "coder" ? "coder" : "researcher";
      return {
        id: `sub-${idx + 1}`,
        role,
        description: tasks[idx].description,
        success: false,
        finalAnswer: `子代理执行异常中断: ${String(result.reason)}`,
        turnsCount: 0,
        durationMs: 0,
        error: String(result.reason),
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
    const subSessionId = `${this.mainSessionId}_${subId}_${role}`;
    const logStream = this.loggerTree?.createSubagentLogStream(subId, role);

    try {
      const orchestrator = this.createOrchestratorFn
        ? this.createOrchestratorFn({
            workspaceRoot: this.workspaceRoot,
            customAgentId,
            subagentRole: role,
            sessionId: subSessionId,
            pool: this.pool,
            chatClientFactory: this.chatClientFactory,
            modelTone: this.modelTone,
          })
        : new CopilotOrchestrator({
            workspaceRoot: this.workspaceRoot,
            customAgentId,
            sessionId: subSessionId,
            pool: this.pool,
            chatClientFactory: this.chatClientFactory,
            modelTone: this.modelTone,
            maxTurns: spec.maxTurns || 15,
            activeSkills: [], // 子代理零技能挂载，最大化上下文给代码
          });

      const res = await orchestrator.run({
        task: spec.prompt,
        signal,
        events: {
          onDelta: (delta: string) => {
            logStream?.write(delta);
            events?.onSubagentProgress?.(subId, -1, delta);
          },
          onTurnStart: (turn: number) => {
            logStream?.write(`\n--- Turn ${turn} ---\n`);
            events?.onSubagentProgress?.(subId, turn);
          },
        },
      });

      const durationMs = Date.now() - startTime;
      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success: res.completed,
        finalAnswer: res.finalAnswer || "子代理已完成，未提供详细文字总结。",
        turnsCount: res.turnsCount,
        durationMs,
      };

      events?.onSubagentEnd?.(report);
      this.loggerTree?.logTimelineEvent({
        type: "SUBAGENT_FINISHED",
        subagentId: subId,
        role,
        success: report.success,
        turnsCount: report.turnsCount,
        durationMs,
        timestamp: Date.now(),
      });

      return report;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const report: SubagentTaskReport = {
        id: subId,
        role,
        description: spec.description,
        success: false,
        finalAnswer: `子任务执行失败: ${err.message}`,
        turnsCount: 0,
        durationMs,
        error: err.message,
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
