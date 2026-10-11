import crypto from "crypto";
import type { ActiveSessionToken } from "../auth/token-manager.ts";
import {
  RECORD_SEPARATOR,
  type ChatHubOptions,
  type ChatMessagePayload,
  type SendMessageParams,
  type ChatResponse,
  type MessageCallbacks,
  type ChatHubEvents,
} from "./types.ts";

export class ChatHubClient {
  private token: ActiveSessionToken;
  private options: ChatHubOptions;

  constructor(token: ActiveSessionToken, options?: ChatHubOptions) {
    this.token = token;
    this.options = {
      modelTone: "Gpt_61_Sol_Reasoning", // default for GPT-6.1 Sol / M365 Reasoning
      scenario: "OfficeWebIncludedCopilot",
      licenseType: "Starter",
      agentHost: "Bizchat.FullScreen",
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
      timeoutMs: options?.timeoutMs ?? 600_000,
      idleTimeoutMs: options?.idleTimeoutMs ?? 90_000,
      ...options,
    };
  }

  /**
   * Helper to normalize an Agent ID from either a raw string or a full Copilot Agent URL
   */
  public static normalizeAgentId(input?: string): string | undefined {
    if (!input) return undefined;
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/\/chat\/agent\/([^?&#]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]).trim();
      return decoded || undefined;
    }
    return trimmed;
  }

  public updateToken(newToken: ActiveSessionToken): void {
    this.token = newToken;
  }

  public getToken(): ActiveSessionToken {
    return this.token;
  }

  /**
   * Helper to encode an object into a SignalR record frame terminated by \x1e
   */
  public static encodeSignalR(obj: any): string {
    return JSON.stringify(obj) + RECORD_SEPARATOR;
  }

  /**
   * Helper to decode a raw string into parsed SignalR frames
   */
  public static decodeSignalRFrames(raw: string): any[] {
    const frames = raw.split(RECORD_SEPARATOR).filter(Boolean);
    const result: any[] = [];
    for (const frame of frames) {
      try {
        result.push(JSON.parse(frame));
      } catch {
        // Skip malformed frame
      }
    }
    return result;
  }

  /**
   * Build Sydney / ChatHub WebSocket URL
   */
  public buildWsUrl(conversationId: string, sessionId: string, requestId: string): string {
    const params = new URLSearchParams({
      chatsessionid: requestId,
      clientrequestid: requestId,
      "X-SessionId": sessionId,
      ConversationId: conversationId,
      access_token: this.token.accessToken,
      source: '"officeweb"',
      product: "Office",
      agentHost: this.options.agentHost || "Bizchat.FullScreen",
      licenseType: this.options.licenseType || "Starter",
      agent: this.options.customAgentId ? "Agent" : "web",
      scenario: this.options.scenario || "OfficeWebIncludedCopilot",
    });

    if (this.options.customAgentId) {
      params.set("gptId", `${this.options.customAgentId}@MOS3`);
      params.set("agent", "Agent");
      params.set("agentHost", "Bizchat.FullScreen");
    }

    if (this.options.wsBaseUrl) {
      const base = this.options.wsBaseUrl.replace(/\/+$/, "");
      return `${base}/${this.token.oid}@${this.token.tid}?${params.toString()}`;
    }

    return `wss://substrate.office.com/m365Copilot/Chathub/${this.token.oid}@${this.token.tid}?${params.toString()}`;
  }

  /**
   * Send a prompt to Copilot and stream the response
   */
  public async sendMessage(
    payload: ChatMessagePayload | SendMessageParams,
    events?: MessageCallbacks | ChatHubEvents
  ): Promise<ChatResponse> {
    const signal = payload.signal;

    // Check pre-aborted state
    if (signal?.aborted) {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const wsUrl = this.buildWsUrl(
      payload.conversationId,
      payload.sessionId,
      payload.requestId
    );

    return new Promise((resolve, reject) => {
      let isSettled = false;
      let hasSentChat = false;
      let fullText = "";
      let reasoningText = "";
      const rawMessages: any[] = [];
      const rawFrames: any[] = [];
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let ws: WebSocket;

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
        try {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close();
          }
        } catch {}
      };

      const settleReject = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        reject(err);
      };

      const settleResolve = (response: ChatResponse) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve(response);
      };

      const abortListener = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        settleReject(err);
      };

      if (signal) {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      // Overall safety maximum deadline (default: 600s = 10 minutes)
      const timeoutMs = this.options.timeoutMs ?? 600_000;
      timeoutTimer = setTimeout(() => {
        settleReject(new Error(`ChatHub request timed out after ${Math.round(timeoutMs / 1000)}s without completion`));
      }, timeoutMs);

      // Connection idle keepalive timeout (default: 90s, resets on every incoming frame)
      const idleTimeoutMs = this.options.idleTimeoutMs ?? 90_000;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (isSettled) return;
        idleTimer = setTimeout(() => {
          settleReject(
            new Error(
              `ChatHub connection idle timeout: no data received from server for ${Math.round(idleTimeoutMs / 1000)}s`
            )
          );
        }, idleTimeoutMs);
      };
      resetIdleTimer();

      try {
        // Bun/Node WebSocket with headers
        ws = new (globalThis.WebSocket as any)(wsUrl, {
          headers: {
            Origin: "https://m365.cloud.microsoft",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
        });
      } catch (wsInitErr: any) {
        settleReject(new Error(`Failed to initialize WebSocket: ${wsInitErr.message}`));
        return;
      }

      if (typeof (ws as any).on === "function") {
        (ws as any).on("message", () => {
          resetIdleTimer();
        });
      }

      ws.onopen = () => {
        if (signal?.aborted) {
          abortListener();
          return;
        }
        resetIdleTimer();
        // Step 1: Send SignalR handshake
        ws.send(ChatHubClient.encodeSignalR({ protocol: "json", version: 1 }));
      };

      ws.onmessage = async (event) => {
        if (isSettled) return;
        resetIdleTimer();
        const raw = typeof event.data === "string" ? event.data : event.data.toString();
        const frames = raw.split(RECORD_SEPARATOR).filter(Boolean);

        for (const frame of frames) {
          try {
            const msg = JSON.parse(frame);
            rawFrames.push(msg);
            events?.onRawFrame?.(msg);

            // Step 2: Handshake response is empty object {}
            if (!hasSentChat && Object.keys(msg).length === 0) {
              hasSentChat = true;

              const chatArguments: any = {
                source: "officeweb",
                clientCorrelationId: crypto.randomUUID(),
                sessionId: payload.sessionId,
                optionsSets: payload.optionsSets || [
                  "search_result_progress_messages_with_search_queries",
                  "update_textdoc_response_after_streaming",
                  "deepleo_networking_timeout_10minutes_canmore",
                  "enable_search_result_progress_messages",
                  "cwc_fileupload_odb",
                  "enable_batch_token_processing",
                  "flux_v3_references",
                  "flux_v3_references_entities",
                  "flux_v3_references_ci",
                  "add_filestore_filetype",
                  "rich_responses",
                ],
                allowedMessageTypes: [
                  "Chat",
                  "Suggestion",
                  "Disengaged",
                  "Progress",
                  "EndOfRequest",
                  "InternalLoaderMessage",
                ],
                conversationId: payload.conversationId,
                traceId: crypto.randomUUID(),
                isStartOfSession: payload.isStartOfSession ?? false,
                productThreadType: "Office",
                clientInfo: { clientPlatform: "mcmcopilot-web", clientAppName: "Office" },
                tone: payload.tone || this.options.modelTone || "Gpt_61_Sol_Reasoning",
                streamingMode: "ConciseWithPadding",
                message: {
                  author: "user",
                  inputMethod: "Keyboard",
                  text: payload.text,
                  requestId: payload.requestId,
                  locationInfo: { timeZoneOffset: 8, timeZone: this.options.timeZone || "Asia/Shanghai" },
                  locale: this.options.locale || "zh-CN",
                  messageType: "Chat",
                  experienceType: "Default",
                },
                plugins: [{ Id: "BingWebSearch", Source: "BuiltIn" }],
              };

              if (this.options.customAgentId) {
                chatArguments.threadLevelGptId = {
                  id: this.options.customAgentId,
                  source: "MOS3",
                };
                chatArguments.gpts = [
                  {
                    id: this.options.customAgentId,
                    source: "MOS3",
                    version: "1.0.0",
                  },
                ];
              }

              // Attach document / image annotations if provided
              if (payload.annotations && payload.annotations.length > 0) {
                chatArguments.message.entityAnnotationTypes = [
                  "People",
                  "File",
                  "Event",
                  "Email",
                  "TeamsMessage",
                ];
                chatArguments.message.messageAnnotations = payload.annotations;
              }

              const chatFrame = {
                arguments: [chatArguments],
                invocationId: "0",
                target: "chat",
                type: 4,
              };

              const metricsFrame = {
                arguments: [
                  {
                    Timestamps: {
                      ConnectionStart: "",
                      UserInputStart: "",
                      ConnectionEstablished: "",
                      UserInputSubmit: "",
                    },
                  },
                ],
                target: "Metrics",
                type: 1,
              };

              ws.send(
                ChatHubClient.encodeSignalR(chatFrame) +
                ChatHubClient.encodeSignalR(metricsFrame)
              );
              continue;
            }

            // Step 3: Heartbeat ping frame (type 6)
            if (msg.type === 6) {
              resetIdleTimer();
              events?.onHeartbeat?.();
              ws.send(ChatHubClient.encodeSignalR({ type: 6 }));
              continue;
            }

            // Step 4: Stream delta update (type 1)
            if (msg.type === 1 && msg.target === "update") {
              for (const arg of msg.arguments || []) {
                if (arg.writeAtCursor) {
                  fullText += arg.writeAtCursor;
                  resetIdleTimer();
                  if (events?.onDelta) {
                    await events.onDelta({ type: "text", content: arg.writeAtCursor, raw: arg });
                    resetIdleTimer();
                  }
                }
                for (const m of arg.messages || []) {
                  rawMessages.push(m);
                  // Bot reasoning / CoT stream
                  if (m.messageType === "Progress" || m.messageType === "InternalLoaderMessage") {
                    const progressText = m.text || "";
                    if (progressText) {
                      reasoningText += progressText + "\n";
                      resetIdleTimer();
                      if (events?.onDelta) {
                        await events.onDelta({ type: "reasoning", content: progressText, raw: m });
                        resetIdleTimer();
                      }
                      if (events?.onReasoning) {
                        await events.onReasoning(progressText);
                        resetIdleTimer();
                      }
                    }
                  } else if ((m.author === "bot" || m.messageType === "Disengaged" || m.messageType === "OffTopic") && m.text) {
                    // Check for rate limit keywords in bot message
                    if (/rate limit|too many requests|配额已达上限|请稍后再试/i.test(m.text)) {
                      events?.onRateLimitDetected?.(this.token.email);
                    }
                    fullText = m.text;
                    resetIdleTimer();
                  }
                }
              }
            }

            // Step 5: Completion frame (type 2)
            if (msg.type === 2) {
              const result = msg.result || msg.item?.result;
              const errorCode =
                result?.errorCode ||
                result?.code ||
                (typeof msg.error === "string" && msg.error.includes("GptNotAvailable") ? "GptNotAvailable" : undefined) ||
                (typeof msg.error === "string" && msg.error.includes("GptAccessForbidden") ? "GptAccessForbidden" : undefined);

              if (errorCode === "GptNotAvailable" || errorCode === "GptAccessForbidden") {
                const agentId = this.options.customAgentId || "";
                const errorMsg =
                  result?.message ||
                  result?.errorMessage ||
                  msg.error ||
                  `Agent access error: ${errorCode}`;
                events?.onAgentUnavailable?.(this.token.email, agentId, errorCode, errorMsg);
                const err: any = new Error(`[${errorCode}] ${errorMsg}`);
                err.errorCode = errorCode;
                err.agentId = agentId;
                settleReject(err);
                return;
              }

              settleResolve({
                text: fullText,
                reasoning: reasoningText,
                conversationId: payload.conversationId,
                sessionId: payload.sessionId,
                requestId: payload.requestId,
                rawMessages,
                rawFrames,
              });
              return;
            }

            // Step 6: End of stream invocation (type 3)
            if (msg.type === 3) {
              settleResolve({
                text: fullText,
                reasoning: reasoningText,
                conversationId: payload.conversationId,
                sessionId: payload.sessionId,
                requestId: payload.requestId,
                rawMessages,
                rawFrames,
              });
              return;
            }
          } catch {
            // Ignore corrupted frame
          }
        }
      };

      ws.onerror = (err: any) => {
        settleReject(new Error(`WebSocket connection error: ${err?.message || String(err)}`));
      };

      ws.onclose = (ev) => {
        if (!hasSentChat) {
          // Code 1006 / 1008 usually indicates auth failure or rate limit
          if (ev.code === 1008 || ev.code === 1006) {
            events?.onRateLimitDetected?.(this.token.email);
          }
          settleReject(
            new Error(`WebSocket closed prematurely (${ev.code}): ${ev.reason || "unknown reason"}`)
          );
        } else if (!isSettled) {
          // If closed after chat was sent but before type 2/3 frame
          settleResolve({
            text: fullText,
            reasoning: reasoningText,
            conversationId: payload.conversationId,
            sessionId: payload.sessionId,
            requestId: payload.requestId,
            rawMessages,
            rawFrames,
          });
        }
      };
    });
  }
}

