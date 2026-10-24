/**
 * Shared protocol types for CPH-PI Web Client
 * Supporting DeepSeek-style streaming turns, reasoning tokens,
 * tool calls, Ledger WAL entries, and Context inspection.
 */

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  diff?: string;
  durationMs?: number;
}

export interface Turn {
  id: string;
  turnNumber: number;
  userMessage: {
    text: string;
    attachments?: Array<{ name: string; path: string; size?: number }>;
  };
  reasoning?: {
    text: string;
    isStreaming: boolean;
  };
  assistantText?: string;
  tools: ToolCall[];
  status: 'streaming' | 'completed' | 'interrupted' | 'error';
  metrics?: {
    durationMs: number;
    tokensIn?: number;
    tokensOut?: number;
    tokens?: number;
    tps?: number;
    model: string;
  };
}

export interface LedgerEntry {
  stepId: number;
  timestamp: number;
  toolName: string;
  argsHash: string;
  exitCode: number;
  durationMs: number;
  evidencePath?: string;
}

export interface ContextMetrics {
  usedTokens: number;
  maxTokens: number;
  workingMemoryPercent: number;
  activeSkills: string[];
  fingerprintTOC: string[];
  activeAgent: string;
}

export interface SubagentTaskSpec {
  prompt?: string;
  description?: string;
  targetFile?: string;
  stage?: number;
}

export interface SubagentState {
  id: string;
  toolId?: string;
  role: "researcher" | "coder" | string;
  spec?: SubagentTaskSpec;
  status: "queued" | "running" | "completed" | "failed";
  account?: string;
  hopCount: number;
  currentTurn: number;
  reasoning: string;
  actions: Array<{ tool: string; args: any; output?: string; timestamp: number }>;
  report?: {
    id: string;
    role: string;
    description: string;
    success: boolean;
    finalAnswer: string;
    deliverablePath?: string;
    durationMs: number;
    turnsCount: number;
  };
  durationMs?: number;
  startTime: number;
}

export interface SessionHandoffPayload {
  predecessorSessionId: string;
  successorSessionId: string;
  handoffDocPath?: string;
  memoSnippet?: string;
  generation: number;
}

export type RightbarTab = 'files' | 'terminal' | 'diff' | 'ledger' | 'context' | 'subagent';

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  status?: 'modified' | 'added' | 'deleted' | 'untracked' | 'clean';
  children?: WorkspaceFile[];
}

export interface TerminalLog {
  id: string;
  timestamp: number;
  stream: 'stdout' | 'stderr' | 'system';
  content: string;
}

export interface DiffHunkLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface DiffFile {
  id: string;
  filename: string;
  oldPath?: string;
  newPath?: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  rawPatch?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: Array<{ name: string; path: string; size?: number }>;
  timestamp?: number;
}

export interface WsPacket<T = unknown> {
  type: string;
  payload: T;
}

export interface CloudWorkspaceConfig {
  siteUrl: string;
  targetFolder: string;
  lastSyncedAt?: string;
  verified?: boolean;
}

export interface CloudVerifyResult {
  valid: boolean;
  reason: string;
  details?: any;
}

export interface WorkspaceUpdatePayload {
  workspaceRoot: string | null;
  cloudWorkspace?: CloudWorkspaceConfig | null;
  recentWorkspaces: string[];
  workspaceFiles?: WorkspaceFile[];
}

export interface AccountInfo {
  email: string;
  isAvailable: boolean;
  isThrottled: boolean;
  isAllowed: boolean;
  isLeased?: boolean;
  leasedBy?: string;
  authExpired?: boolean;
  authErrorReason?: string;
  cooldownUntil: number;
  cooldownRemainingSec: number;
  totalRequests: number;
  throttledCount: number;
  throttleReason?: 'daily' | 'burst' | 'agent_ineligible' | 'auth_error';
}

export interface PkceSessionPayload {
  authSessionId: string;
  authUrl: string;
  state: string;
  targetEmail?: string;
  expiresAt?: number;
}

export interface PkceResultPayload {
  success: boolean;
  email: string;
  expectedEmail?: string;
  emailMismatch: boolean;
}

export interface PkceErrorPayload {
  message: string;
}

export interface CustomAgentItem {
  id: string;
  name: string;
  agentId: string;
  role: 'main' | 'coder' | 'researcher' | 'custom';
  description?: string;
  createdAt?: number;
}

export interface AgentConfig {
  customAgentId?: string;
  coderAgentId?: string;
  researcherAgentId?: string;
  defaultMain: string;
  defaultCoder: string;
  defaultResearcher: string;
  customAgents?: CustomAgentItem[];
}

export interface SkillInfo {
  name: string;
  description: string;
  source?: string;
  isAgentMounted?: boolean;
}




