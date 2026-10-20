/**
 * WebSocket Protocol Types for CPH-PI Agent Workbench
 */

export interface WsEnvelope<T = any> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  timestamp: number;
  turn?: number;
  attachments?: string[];
}

export interface TurnState {
  turn: number;
  status: "idle" | "running" | "completed" | "error";
  reasoning: string;
  content: string;
  response?: string;
  timestamp?: number;
}

export interface ToolCallState {
  id: string;
  action: {
    tool?: string;
    action?: string;
    name?: string;
    path?: string;
    filePath?: string;
    file?: string;
    command?: string;
    cmd?: string;
    content?: string;
    edits?: any[];
    options?: string[];
    question?: string;
    [key: string]: any;
  };
  status: "running" | "completed" | "failed" | "approval-required";
  result?: {
    actionName?: string;
    piToolName?: string;
    target?: string;
    success: boolean;
    output?: string;
    rawOutput?: string;
    formatted?: string;
    persistedFile?: string;
    [key: string]: any;
  };
  timestamp: number;
  approvalId?: string;
}

export interface ApprovalRequest {
  id: string;
  approvalId: string;
  action: {
    tool?: string;
    action?: string;
    name?: string;
    path?: string;
    command?: string;
    content?: string;
    [key: string]: any;
  };
  timestamp: number;
}

export interface QuestionItem {
  question: string;
  options?: string[];
  isMultiSelect?: boolean;
  [key: string]: any;
}

export interface QuestionRequest {
  id: string;
  questionId: string;
  questions: QuestionItem[];
  timestamp: number;
}

export interface AccountStatus {
  email: string;
  isAvailable?: boolean;
  isThrottled?: boolean;
  isAllowed?: boolean;
  isLeased?: boolean;
  leasedBy?: string;
  cooldownUntil?: number;
  lastUsedAt?: number;
  totalRequests?: number;
  throttledCount?: number;
  ineligibleAgents?: string[];
}

export interface SubagentState {
  id: string;
  role: string;
  status: "started" | "running" | "completed" | "failed";
  spec?: any;
  hop?: number;
  account?: string;
  turns?: number;
  delta?: string;
  currentAction?: any;
  result?: any;
  durationMs?: number;
  report?: any;
  timestamp?: number;
}

export interface LedgerItem {
  stepIndex: number;
  timestamp: number;
  role: "main" | "researcher" | "coder" | string;
  sessionId: string;
  tool: string;
  target: string;
  status: "SUCCESS" | "FAILURE";
  modifiedFiles?: string[];
  statusBadge?: string;
  briefSummary: string;
}

export interface SnapshotResponse {
  sessionId?: string;
  title?: string;
  turns?: any[];
  ledger?: LedgerItem[];
  [key: string]: any;
}
