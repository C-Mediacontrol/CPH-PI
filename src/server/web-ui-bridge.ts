import crypto from "node:crypto";
import {
  createEnvelope,
  parseEnvelope,
  type WsEnvelope,
} from "./protocol-types.ts";
import type {
  CopilotAction,
  ToolBridgeResult,
} from "../protocol/tool-bridge.ts";
import type { OrchestratorEvents } from "../agent/orchestrator.ts";

export interface WebUiDispatchHandlers {
  onPrompt?: (text: string, attachments?: string[]) => Promise<void> | void;
  onInterrupt?: (mode: "soft" | "hard") => Promise<void> | void;
  onSyncSnapshot?: (sessionId?: string, lastTurn?: number) => Promise<any> | any;
  onSwitchSession?: (sessionId: string) => Promise<void> | void;
  onReadFile?: (relativePath: string) => Promise<string> | string;
}

export interface PendingApproval {
  id: string;
  action: CopilotAction;
  timestamp?: number;
  resolve: (approved: boolean) => void;
}

export interface PendingQuestion {
  id: string;
  questions: any[];
  timestamp?: number;
  resolve: (answers: any) => void;
}

export class WebUiBridge implements OrchestratorEvents {
  private clients = new Set<any>();
  private handlers: WebUiDispatchHandlers = {};
  private pendingApprovals = new Map<string, PendingApproval>();
  private pendingQuestions = new Map<string, PendingQuestion>();

  public addClient(ws: any): void {
    this.clients.add(ws);
  }

  public removeClient(ws: any): void {
    this.clients.delete(ws);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public setDispatchHandlers(handlers: WebUiDispatchHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  public broadcast(type: string, payload: any): void {
    const env = createEnvelope(type, payload);
    const raw = JSON.stringify(env);
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        try {
          ws.send(raw);
        } catch {
          // Client may have disconnected or encountered socket error
        }
      }
    }
  }

  // --- OrchestratorEvents Listeners ---
  public onDelta = (chunk: string): void => {
    this.broadcast("turn:delta", { chunk });
  };

  public onReasoning = (chunk: string): void => {
    this.broadcast("turn:reasoning", { chunk });
  };

  public onTurnStart = (turn: number): void => {
    this.broadcast("turn:start", { turn });
  };

  public onTurnEnd = (turn: number, response: string): void => {
    this.broadcast("turn:end", { turn, response });
  };

  public onToolStart = (action: CopilotAction): void => {
    this.broadcast("tool:start", { action });
  };

  public onToolEnd = (result: ToolBridgeResult): void => {
    this.broadcast("tool:end", { result });
  };

  public onSubagentStart = (
    id: string,
    role: string,
    spec: any,
    hop?: number,
    account?: string
  ): void => {
    this.broadcast("subagent:lifecycle", {
      id,
      role,
      spec,
      hop,
      account,
      status: "started",
    });
  };

  public onSubagentEnd = (
    idOrReport: any,
    role?: string,
    result?: any,
    durationMs?: number
  ): void => {
    if (typeof idOrReport === "object" && idOrReport !== null) {
      const report = idOrReport;
      this.broadcast("subagent:lifecycle", {
        id: report.id,
        role: report.role,
        result: report.finalAnswer ?? report.result,
        durationMs: report.durationMs,
        status: report.success === false ? "failed" : "completed",
        report,
      });
    } else {
      this.broadcast("subagent:lifecycle", {
        id: idOrReport,
        role,
        result,
        durationMs,
        status: "completed",
      });
    }
  };

  public onSubagentProgress = (
    id: string,
    turn: number,
    delta?: string,
    action?: any,
    hopCount?: number,
    account?: string
  ): void => {
    this.broadcast("subagent:progress", {
      id,
      turn,
      delta,
      action,
      hopCount,
      account,
    });
  };

  public onAccountSwitched = (oldEmail: string, newEmail: string): void => {
    this.broadcast("account:switched", { oldEmail, newEmail });
  };

  public onRefusalIntercepted = (refusalText: string, retryAttempt: number): void => {
    this.broadcast("agent:refusal", { refusalText, retryAttempt });
  };

  public onCompacted = (clearedChars: number, ratio: number): void => {
    this.broadcast("session:compacted", { clearedChars, ratio });
  };

  public onCompleted = (finalAnswer: string): void => {
    this.broadcast("agent:completed", { finalAnswer });
  };

  public onError = (err: Error): void => {
    this.broadcast("agent:error", {
      message: err?.message,
      stack: err?.stack,
    });
  };

  // --- Human-in-the-Loop Controls ---
  public requestApproval(action: CopilotAction): Promise<boolean> {
    const id = `appr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();
    return new Promise((resolve) => {
      this.pendingApprovals.set(id, { id, action, timestamp, resolve });
      this.broadcast("tool:approval-required", {
        approvalId: id,
        id,
        action,
        timestamp,
      });
    });
  }

  public getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  public requestQuestionAnswer(questionId: string, questions: any[]): Promise<any> {
    const timestamp = Date.now();
    return new Promise((resolve) => {
      this.pendingQuestions.set(questionId, {
        id: questionId,
        questions,
        timestamp,
        resolve,
      });
      this.broadcast("question:ask", {
        questionId,
        id: questionId,
        questions,
        timestamp,
      });
    });
  }

  // --- Client Message Dispatcher ---
  public onClientMessage(ws: any, raw: string): void {
    const env = parseEnvelope(raw);
    if (!env) return;

    switch (env.type) {
      case "prompt:send":
        this.handlers.onPrompt?.(env.payload?.text, env.payload?.attachments);
        break;

      case "tool:approve": {
        const approvalId = env.payload?.approvalId ?? env.payload?.id;
        if (approvalId && this.pendingApprovals.has(approvalId)) {
          const item = this.pendingApprovals.get(approvalId)!;
          this.pendingApprovals.delete(approvalId);
          item.resolve(true);
        }
        break;
      }

      case "tool:reject": {
        const approvalId = env.payload?.approvalId ?? env.payload?.id;
        if (approvalId && this.pendingApprovals.has(approvalId)) {
          const item = this.pendingApprovals.get(approvalId)!;
          this.pendingApprovals.delete(approvalId);
          item.resolve(false);
        }
        break;
      }

      case "question:answer": {
        const questionId = env.payload?.questionId ?? env.payload?.id;
        if (questionId && this.pendingQuestions.has(questionId)) {
          const item = this.pendingQuestions.get(questionId)!;
          this.pendingQuestions.delete(questionId);
          item.resolve(env.payload?.answers ?? env.payload?.answer);
        }
        break;
      }

      case "execution:interrupt":
        this.handlers.onInterrupt?.(env.payload?.mode || "soft");
        break;

      case "session:sync-snapshot":
        if (this.handlers.onSyncSnapshot) {
          Promise.resolve(
            this.handlers.onSyncSnapshot(
              env.payload?.sessionId,
              env.payload?.lastTurn
            )
          )
            .then((snapshot) => {
              if (ws && ws.readyState === 1) {
                ws.send(
                  JSON.stringify(
                    createEnvelope("session:snapshot-response", snapshot, env.id)
                  )
                );
              }
            })
            .catch(() => {});
        }
        break;

      case "session:switch":
        this.handlers.onSwitchSession?.(
          env.payload?.sessionId ?? env.payload?.id
        );
        break;

      case "workspace:file-read":
        if (this.handlers.onReadFile) {
          Promise.resolve(
            this.handlers.onReadFile(env.payload?.relativePath)
          )
            .then((content) => {
              if (ws && ws.readyState === 1) {
                ws.send(
                  JSON.stringify(
                    createEnvelope("workspace:file-response", content, env.id)
                  )
                );
              }
            })
            .catch(() => {});
        }
        break;
    }
  }
}
