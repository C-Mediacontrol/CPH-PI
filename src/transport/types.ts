export const RECORD_SEPARATOR = "\x1e";

export interface ChatHubOptions {
  modelTone?: string; // default: "Gpt_61_Sol_Reasoning"
  customAgentId?: string; // Custom Copilot Agent ID (e.g. T_9feac...)
  scenario?: string; // default: "OfficeWebIncludedCopilot"
  licenseType?: string; // default: "Starter"
  agentHost?: string; // default: "Bizchat.FullScreen"
  locale?: string; // default: "zh-CN"
  timeZone?: string; // default: "Asia/Shanghai"
  wsBaseUrl?: string; // Custom WebSocket base URL (useful for mocking / proxies)
  timeoutMs?: number; // Overall max deadline in ms (default: 600,000, 10 mins)
  idleTimeoutMs?: number; // Connection idle timeout in ms (default: 90,000, resets on activity)
}

export interface AttachmentAnnotation {
  id: string; // docId returned from Substrate or SPO_<base64>_<driveItemId> for LocalFile
  text?: string;
  url?: string;
  messageAnnotationMetadata?: {
    "@type"?: string;
    annotationType?: string;
    fileType?: string;
    fileName?: string;
    webUrl?: string;
    driveId?: string;
  };
  messageAnnotationType: string; // "ImageFile", "LocalFile", or "File"
}

export interface ChatMessagePayload {
  text: string;
  conversationId: string;
  sessionId: string;
  requestId: string;
  isStartOfSession: boolean;
  annotations?: AttachmentAnnotation[];
  optionsSets?: string[];
  tone?: string;
  signal?: AbortSignal;
}

export interface SendMessageParams {
  text: string;
  conversationId: string;
  sessionId: string;
  requestId: string;
  isStartOfSession?: boolean;
  annotations?: AttachmentAnnotation[];
  optionsSets?: string[];
  tone?: string;
  signal?: AbortSignal;
}

export interface StreamDelta {
  type: "text" | "reasoning" | "progress" | "tool_call" | "final";
  content: string;
  raw?: any;
}

export type DeltaHandler = (delta: StreamDelta) => void | Promise<void>;

export interface MessageCallbacks {
  onDelta?: DeltaHandler;
  onReasoning?: (text: string) => void | Promise<void>;
  onRateLimitDetected?: (email: string) => void;
  onAgentUnavailable?: (email: string, agentId: string, errorCode: string, message: string) => void | Promise<void>;
  onHeartbeat?: () => void;
  onRawFrame?: (frame: any) => void;
}

export type ChatHubEvents = MessageCallbacks;

export interface ChatResponse {
  text: string;
  reasoning: string;
  conversationId: string;
  sessionId: string;
  requestId: string;
  rawMessages: any[];
  rawFrames?: any[];
}

