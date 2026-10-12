import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { BlackboxCompactor } from "./blackbox-compactor.ts";
import { ResilientParser } from "../protocol/resilient-parser.ts";
import { ChatHubClient } from "../transport/chathub-client.ts";
import { HandoffDocumentGenerator } from "./handoff-generator.ts";
import type { ToolBridge } from "../protocol/tool-bridge.ts";
import type { AccountPool } from "../auth/account-pool.ts";
import type { SessionLineageTracker } from "../session/lineage-tracker.ts";
import type {
  IOrchestratorChatClient,
  TurnRecord,
  OrchestratorEvents,
  OrchestratorRunResult,
} from "./orchestrator.ts";

export interface DisasterArbitratorParams {
  task: string;
  history: TurnRecord[];
  client: IOrchestratorChatClient;
  lastError: string;
  signal?: AbortSignal;
  events?: OrchestratorEvents;
  sessionId: string;
  workspaceRoot: string;
  modelTone: string;
  customAgentId?: string;
  pool?: AccountPool;
  bridge: ToolBridge;
  lineageTracker?: SessionLineageTracker;
  arbitratorChatClient?: IOrchestratorChatClient;
  chatClientFactory?: (
    token: any,
    options: { modelTone?: string; customAgentId?: string }
  ) => IOrchestratorChatClient;
  lastPartialOutput?: {
    reasoning?: string;
    response?: string;
  };
  generateHandoffSnapshot?: (
    task: string,
    history: TurnRecord[],
    sessionId?: string
  ) => string;
}

export class DisasterArbitrator {
  /**
   * Executes the Orchestrator A -> B -> C Disaster Recovery Arbitration Pipeline.
   * Invoked when Session A encounters 429 rate limit or disconnection.
   */
  public static async execute(
    params: DisasterArbitratorParams
  ): Promise<OrchestratorRunResult> {
    const {
      task,
      history,
      client,
      lastError,
      signal,
      events,
      sessionId,
      workspaceRoot,
      modelTone,
      customAgentId,
      pool,
      bridge,
      lineageTracker,
      chatClientFactory,
    } = params;

    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    // 1. Extract high-density disaster recovery blackbox (5k~8k chars)
    let disasterBlackbox = BlackboxCompactor.extractDisasterBlackbox(history, lastError);
    if (
      params.lastPartialOutput &&
      (params.lastPartialOutput.reasoning || params.lastPartialOutput.response)
    ) {
      if (
        !disasterBlackbox.includes(params.lastPartialOutput.response || "___nonexistent___") &&
        !disasterBlackbox.includes(params.lastPartialOutput.reasoning || "___nonexistent___")
      ) {
        disasterBlackbox +=
          `\n\n### [中断前未完结部分输出 (Partial Output Before Crash)]\n` +
          (params.lastPartialOutput.reasoning
            ? `- **Reasoning**: ${params.lastPartialOutput.reasoning}\n`
            : "") +
          (params.lastPartialOutput.response
            ? `- **Response**: ${params.lastPartialOutput.response}\n`
            : "");
      }
    }
    if (events?.onDisasterOccurred) {
      await Promise.resolve(events.onDisasterOccurred(disasterBlackbox, lastError));
    }

    // 2. Mark victim account throttled in pool
    let victimEmail =
      (client as any)?.token?.email ||
      (client as any)?.email ||
      "";
    if (!victimEmail && pool?.refreshAccountList) {
      const accounts = pool.refreshAccountList();
      if (accounts && accounts.length > 0) {
        victimEmail = accounts[0].email;
      }
    }
    if (victimEmail && pool) {
      pool.markThrottled(victimEmail);
    }

    const targetHandoffRelativePath = `.cph/handoffs/handoff-${sessionId}.md`;
    const handoffsDir = path.join(workspaceRoot, ".cph", "handoffs");
    const targetHandoffAbsolutePath = path.join(handoffsDir, `handoff-${sessionId}.md`);

    const generateSnapshot = (t: string, h: TurnRecord[], s: string) => {
      if (params.generateHandoffSnapshot) {
        return params.generateHandoffSnapshot(t, h, s);
      }
      return HandoffDocumentGenerator.generate({
        task: t,
        history: h,
        sessionId: s,
        workspaceRoot,
      }).document;
    };

    // Local fallback when no account pool and no arbitrator client are configured
    if (!pool && !params.arbitratorChatClient) {
      fs.mkdirSync(handoffsDir, { recursive: true });
      const localHandoffDoc = generateSnapshot(task, history, sessionId);
      fs.writeFileSync(targetHandoffAbsolutePath, localHandoffDoc, "utf8");

      if (events?.onHandoff) {
        events.onHandoff(localHandoffDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `Transport error recovered via local handoff snapshot. Handoff document generated.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: true,
        disasterBlackbox,
        handoffSnapshot: localHandoffDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 3. Obtain next available account token from pool
    let nextToken: any;
    try {
      if (!pool) {
        if (params.arbitratorChatClient) {
          nextToken = { email: "arbitrator@example.com" };
        } else {
          throw new Error("No account pool configured for disaster recovery");
        }
      } else {
        nextToken = await pool.getNextAvailableToken(
          customAgentId ? { forAgentId: customAgentId } : undefined
        );
      }
    } catch (poolErr: any) {
      // Scenario 3: All accounts throttled / pool exhausted -> graceful local fallback
      fs.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# 🔄 CPH-PI 容灾降级交接文档 (All Accounts Throttled)`,
        `> ⚠️ 账号池所有可用账号均已耗尽频控 (${poolErr.message || String(poolErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox,
      ].join("\n");

      fs.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");

      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `429 Rate limit encountered. All accounts in pool throttled: ${poolErr.message || String(poolErr)}`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId: undefined,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 4. Resolve Arbitrator ChatClient (Session B)
    const arbitratorSessionId = `ses_arb_${crypto.randomUUID()}`;
    const nextEmail = nextToken?.email || "next-account";

    if (lineageTracker) {
      lineageTracker.register({
        sessionId: arbitratorSessionId,
        role: "main",
        status: "active",
        predecessorId: sessionId,
      });
      lineageTracker.linkSuccessor(sessionId, arbitratorSessionId);
    }

    if (victimEmail && nextEmail && events?.onAccountSwitched) {
      events.onAccountSwitched(victimEmail, nextEmail);
    }

    if (events?.onArbitratorHandoffStart) {
      await Promise.resolve(events.onArbitratorHandoffStart(arbitratorSessionId, nextEmail));
    }

    let arbitratorClient: IOrchestratorChatClient;
    if (params.arbitratorChatClient) {
      arbitratorClient = params.arbitratorChatClient;
    } else if (chatClientFactory) {
      arbitratorClient = chatClientFactory(nextToken, {
        modelTone,
        customAgentId,
      });
    } else {
      arbitratorClient = new ChatHubClient(nextToken, {
        modelTone,
        customAgentId,
      });
    }

    // 5. Construct 1-turn prompt for Arbitrator Session B
    const arbitratorPrompt = [
      `【前序会话事故黑匣子快照 (Disaster Recovery Blackbox)】`,
      disasterBlackbox,
      ``,
      `【交接仲裁任务】`,
      `前序会话因突发 429 频控/断连异常中断。你是交接仲裁者 (Handoff Arbitrator)。`,
      `请调用 handoff 技能（或输出标准 5 维交接文档），提炼出高保真阶段性交接文档：`,
      `1. 【任务目标与原始需求】`,
      `2. 【已验证客观事实与阶段性成果】`,
      `3. 【关键卡点、报错与最新诊断】`,
      `4. 【已修改/生成文件清单】`,
      `5. 【接力第一优先级待办事项 (Actionable Next Steps)】`,
      ``,
      `请必须使用 action: write_file 将交接文档写入 \`${targetHandoffRelativePath}\`。`,
      `如果直接返回 Markdown 正文，也请确保内容包含上述完整 5 维交接结构。`,
    ].join("\n");

    let arbitratorResponseText = "";
    try {
      const arbRes = await arbitratorClient.sendMessage({
        text: arbitratorPrompt,
        conversationId: crypto.randomUUID(),
        sessionId: arbitratorSessionId,
        requestId: crypto.randomUUID(),
        signal,
      });
      arbitratorResponseText = arbRes.text;
    } catch (arbErr: any) {
      if (signal?.aborted || arbErr?.name === "AbortError" || arbErr?.message?.includes("aborted")) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      // Graceful local fallback on arbitrator communication failure
      fs.mkdirSync(handoffsDir, { recursive: true });
      const fallbackDoc = [
        `# 🔄 CPH-PI 容灾降级交接文档 (Arbitrator Session Failed)`,
        `> ⚠️ 仲裁会话执行异常 (${arbErr.message || String(arbErr)})，本地保障黑匣子生成与落盘。`,
        ``,
        disasterBlackbox,
      ].join("\n");
      fs.writeFileSync(targetHandoffAbsolutePath, fallbackDoc, "utf8");

      if (events?.onHandoff) {
        events.onHandoff(fallbackDoc, targetHandoffAbsolutePath);
      }

      return {
        finalAnswer: `429 Disaster recovery partial: arbitrator session failed (${arbErr.message || String(arbErr)}), blackbox persisted locally.`,
        turnsCount: history.length,
        completed: false,
        history,
        handedOff: true,
        disasterRecovered: false,
        disasterBlackbox,
        handoffSnapshot: fallbackDoc,
        handoffDocPath: targetHandoffAbsolutePath,
        arbitratorSessionId,
        lastPartialOutput: params.lastPartialOutput,
      };
    }

    // 6. Handle tool invocation in Session B and guarantee disk persistence
    fs.mkdirSync(handoffsDir, { recursive: true });
    const parsed = ResilientParser.parse(arbitratorResponseText);

    if (parsed.type === "action") {
      events?.onToolStart?.(parsed.action);
      const toolResult = await bridge.executeAction(parsed.action, signal);
      events?.onToolEnd?.(toolResult);
    }

    // Guarantee persistence if not already created on disk by write_file
    if (!fs.existsSync(targetHandoffAbsolutePath)) {
      const contentToPersist =
        parsed.type === "handoff"
          ? parsed.handoffDoc
          : parsed.type === "final_answer"
          ? (parsed.answer.summary || parsed.answer.raw || arbitratorResponseText)
          : (parsed.type === "action" && parsed.action?.content)
          ? parsed.action.content
          : arbitratorResponseText;
      fs.writeFileSync(targetHandoffAbsolutePath, contentToPersist, "utf8");
    }

    const finalDocContent = fs.existsSync(targetHandoffAbsolutePath)
      ? fs.readFileSync(targetHandoffAbsolutePath, "utf8")
      : disasterBlackbox;

    if (events?.onArbitratorHandoffComplete) {
      await Promise.resolve(
        events.onArbitratorHandoffComplete(targetHandoffAbsolutePath, arbitratorSessionId)
      );
    }
    if (events?.onHandoff) {
      events.onHandoff(finalDocContent, targetHandoffAbsolutePath);
    }

    return {
      finalAnswer: `429 Disaster recovered via arbitrator session ${arbitratorSessionId}. Handoff document generated.`,
      turnsCount: history.length,
      completed: false,
      history,
      handedOff: true,
      disasterRecovered: true,
      disasterBlackbox,
      handoffSnapshot: finalDocContent,
      handoffDocPath: targetHandoffAbsolutePath,
      arbitratorSessionId,
      lastPartialOutput: params.lastPartialOutput,
    };
  }
}
