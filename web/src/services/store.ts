import { useSyncExternalStore } from 'react';
import type {
  SessionSummary,
  Turn,
  LedgerEntry,
  ContextMetrics,
  RightbarTab,
  ToolCall,
  WorkspaceFile,
  TerminalLog,
  DiffFile,
  AccountInfo,
  AgentConfig,
  SkillInfo,
  CloudWorkspaceConfig,
  CloudVerifyResult,
} from '../types/protocol';
import { wsClient } from './client-ws';

export interface AppState {
  connected: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  turns: Turn[];
  running: boolean;
  activeRightbarTab: RightbarTab;
  sidebarCollapsed: boolean;
  rightbarCollapsed: boolean;
  availableSkills: SkillInfo[];
  ledgerEntries: LedgerEntry[];
  contextMetrics: ContextMetrics;
  terminalLogs: TerminalLog[];
  workspaceFiles: WorkspaceFile[];
  diffFiles: DiffFile[];
  activeDiffFileId: string | null;
  selectedFilePath: string | null;
  workspaceRoot: string | null;
  cloudWorkspace: CloudWorkspaceConfig | null;
  cloudSyncing: boolean;
  cloudSyncReport: any | null;
  cloudVerifyState: { loading: boolean; result: CloudVerifyResult | null };
  recentWorkspaces: string[];
  workspaceModalOpen: boolean;
  workspaceError: string | null;
  accounts: AccountInfo[];
  allowedAccounts: string[] | null;
  agentConfig: AgentConfig;
  agentMountedSkills: string[];
  accountModalOpen: boolean;
  agentModalOpen: boolean;
  skillModalOpen: boolean;
}

export interface AppActions {
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightbarCollapsed: (collapsed: boolean) => void;
  setActiveRightbarTab: (tab: RightbarTab) => void;
  selectSession: (id: string) => void;
  createNewSession: () => void;
  submitPrompt: (text: string, attachments?: Array<{ name: string; path: string; size?: number }>) => void;
  interrupt: () => void;
  clearTerminalLogs: () => void;
  appendTerminalLog: (log: Omit<TerminalLog, 'id' | 'timestamp'>) => void;
  setActiveDiffFile: (id: string | null) => void;
  setSelectedFilePath: (path: string | null) => void;
  setWorkspaceRoot: (path: string, cloudWorkspace?: CloudWorkspaceConfig | null) => void;
  verifyCloudWorkspace: (options: { siteUrl?: string; targetFolder?: string; workspaceRoot?: string }) => void;
  syncCloudWorkspace: () => void;
  clearCloudVerifyState: () => void;
  setWorkspaceModalOpen: (open: boolean) => void;
  clearWorkspaceError: () => void;
  setAccountModalOpen: (open: boolean) => void;
  setAgentModalOpen: (open: boolean) => void;
  setSkillModalOpen: (open: boolean) => void;
  toggleAccount: (email: string, enabled: boolean) => void;
  setAccountWhitelist: (emails: string[] | null) => void;
  resetAccountCooldown: (email: string) => void;
  setAgentId: (role: 'main' | 'coder' | 'researcher' | 'custom', id?: string) => void;
  resetAgentId: (role?: 'main' | 'coder' | 'researcher' | 'all') => void;
  addCustomAgent: (agent: { name: string; agentId: string; role?: 'main' | 'coder' | 'researcher' | 'custom'; description?: string }) => void;
  removeCustomAgent: (id: string) => void;
  toggleSkillMounted: (name: string) => void;
  setAgentMountedSkills: (names: string[]) => void;
}

export type AppStore = AppState & AppActions;

const defaultLedgerEntries: LedgerEntry[] = [
  {
    stepId: 4,
    timestamp: Date.now() - 35000,
    toolName: 'bash',
    argsHash: 'sha256:e51f28b4c7',
    exitCode: 0,
    durationMs: 642,
    evidencePath: '.cph/state/step-004-evidence.json',
  },
  {
    stepId: 3,
    timestamp: Date.now() - 75000,
    toolName: 'patch_file',
    argsHash: 'sha256:3d7a8c91f0',
    exitCode: 0,
    durationMs: 115,
    evidencePath: '.cph/state/step-003-evidence.json',
  },
  {
    stepId: 2,
    timestamp: Date.now() - 120000,
    toolName: 'read_file',
    argsHash: 'sha256:9c12f458a2',
    exitCode: 0,
    durationMs: 18,
    evidencePath: '.cph/state/step-002-evidence.json',
  },
  {
    stepId: 1,
    timestamp: Date.now() - 180000,
    toolName: 'git_status',
    argsHash: 'sha256:4a8b139de6',
    exitCode: 0,
    durationMs: 42,
    evidencePath: '.cph/state/step-001-evidence.json',
  },
];

const defaultDiffFiles: DiffFile[] = [
  {
    id: 'diff-1',
    filename: 'CPH-PI/src/session/ledger/execution-ledger.ts',
    status: 'modified',
    additions: 12,
    deletions: 3,
    rawPatch: `--- a/CPH-PI/src/session/ledger/execution-ledger.ts\n+++ b/CPH-PI/src/session/ledger/execution-ledger.ts`,
    hunks: [
      {
        header: '@@ -45,11 +45,20 @@ export class ExecutionLedger {',
        oldStart: 45,
        oldLines: 11,
        newStart: 45,
        newLines: 20,
        lines: [
          { type: 'context', content: '  private walPath: string;', oldLineNumber: 45, newLineNumber: 45 },
          { type: 'context', content: '  private writeStream: fs.WriteStream | null = null;', oldLineNumber: 46, newLineNumber: 46 },
          { type: 'delete', content: '- // in-memory history log dump', oldLineNumber: 47 },
          { type: 'delete', content: '- private logs: string[] = [];', oldLineNumber: 48 },
          { type: 'add', content: '+ // AGENTS.md Rule 7: Orthogonal persistence and working memory', newLineNumber: 47 },
          { type: 'add', content: '+ // Zero-token overhead disk write-ahead log (.cph/state/ledger.wal)', newLineNumber: 48 },
          { type: 'add', content: '+ public appendEntry(entry: LedgerEntry): void {', newLineNumber: 49 },
          { type: 'add', content: '+   const line = JSON.stringify(entry) + "\\n";', newLineNumber: 50 },
          { type: 'add', content: '+   fs.appendFileSync(this.walPath, line, "utf8");', newLineNumber: 51 },
          { type: 'add', content: '+ }', newLineNumber: 52 },
          { type: 'context', content: '  public getStepCount(): number {', oldLineNumber: 49, newLineNumber: 53 },
          { type: 'context', content: '    return this.stepIndex;', oldLineNumber: 50, newLineNumber: 54 },
        ],
      },
    ],
  },
  {
    id: 'diff-2',
    filename: 'CPH-PI/src/agent/orchestrator.ts',
    status: 'modified',
    additions: 8,
    deletions: 2,
    rawPatch: `--- a/CPH-PI/src/agent/orchestrator.ts\n+++ b/CPH-PI/src/agent/orchestrator.ts`,
    hunks: [
      {
        header: '@@ -88,8 +88,14 @@ export class AgentOrchestrator {',
        oldStart: 88,
        oldLines: 8,
        newStart: 88,
        newLines: 14,
        lines: [
          { type: 'context', content: '  async runStep(step: ExecutionStep): Promise<StepResult> {', oldLineNumber: 88, newLineNumber: 88 },
          { type: 'delete', content: '-   prompt.injectFullHistory(this.logs);', oldLineNumber: 89 },
          { type: 'delete', content: '-   return this.callLLM();', oldLineNumber: 90 },
          { type: 'add', content: '+   // Mount TOC fingerprint reference instead of raw dump', newLineNumber: 89 },
          { type: 'add', content: '+   const tocHeader = this.ledger.buildFingerprintTOC();', newLineNumber: 90 },
          { type: 'add', content: '+   prompt.injectFingerprintHeader(tocHeader);', newLineNumber: 91 },
          { type: 'add', content: '+   return this.callLLM();', newLineNumber: 92 },
          { type: 'context', content: '  }', oldLineNumber: 91, newLineNumber: 93 },
        ],
      },
    ],
  },
];



const defaultTerminalLogs: TerminalLog[] = [
  { id: 'term-1', timestamp: Date.now() - 185000, stream: 'system', content: '[CPH-PI Kernel] Initializing Copilot Substrate session runtime...' },
  { id: 'term-2', timestamp: Date.now() - 184500, stream: 'system', content: '[CPH-PI WAL] State directory verified: .cph/state/ (zero-token disk persistence)' },
  { id: 'term-3', timestamp: Date.now() - 180000, stream: 'stdout', content: '$ git status --porcelain' },
  { id: 'term-4', timestamp: Date.now() - 179950, stream: 'stdout', content: ' M CPH-PI/src/session/ledger/execution-ledger.ts\n M CPH-PI/src/agent/orchestrator.ts\n?? .cph/state/ledger.wal' },
  { id: 'term-5', timestamp: Date.now() - 120000, stream: 'stdout', content: '$ read_file path="CPH-PI/src/cli.ts"' },
  { id: 'term-6', timestamp: Date.now() - 119980, stream: 'stdout', content: '[read_file] Success (35 lines, 827 bytes, hash sha256:9c12f458a2)' },
  { id: 'term-7', timestamp: Date.now() - 75000, stream: 'stdout', content: '$ patch_file path="CPH-PI/src/agent/orchestrator.ts"' },
  { id: 'term-8', timestamp: Date.now() - 74900, stream: 'stdout', content: '[patch_file] Applied 1 hunk cleanly (exit 0)' },
  { id: 'term-9', timestamp: Date.now() - 35000, stream: 'stdout', content: '$ bun test --bail' },
  { id: 'term-10', timestamp: Date.now() - 34358, stream: 'stdout', content: '✓ test/session/ledger.test.ts (4 tests passed)\n✓ test/agent/orchestrator.test.ts (6 tests passed)\n\nRan 10 tests across 2 files. [642ms]' },
];

const initialState: AppState = {
  connected: false,
  sessions: [],
  activeSessionId: null,
  turns: [],
  running: false,
  activeRightbarTab: 'files',
  sidebarCollapsed: false,
  rightbarCollapsed: false,
  availableSkills: [],
  ledgerEntries: defaultLedgerEntries,
  contextMetrics: {
    usedTokens: 18420,
    maxTokens: 128000,
    workingMemoryPercent: 14.4,
    activeSkills: ['handoff', 'tdd', 'systematic-debugging', 'code-review-and-quality'],
    fingerprintTOC: [
      'CPH-PI/src/cli.ts',
      'CPH-PI/src/session/ledger/execution-ledger.ts',
      'CPH-PI/src/agent/orchestrator.ts',
    ],
    activeAgent: 'cph-dev-agent',
  },
  terminalLogs: defaultTerminalLogs,
  workspaceFiles: [],
  diffFiles: defaultDiffFiles,
  activeDiffFileId: 'diff-1',
  selectedFilePath: null,
  workspaceRoot: null,
  cloudWorkspace: null,
  cloudSyncing: false,
  cloudSyncReport: null,
  cloudVerifyState: { loading: false, result: null },
  recentWorkspaces: [],
  workspaceModalOpen: false,
  workspaceError: null,
  accounts: [],
  allowedAccounts: null,
  agentConfig: {
    defaultMain: 'T_9ace94c8-cb78-caab-ddf7-4ae2d8f5a40d.93a3fbbc-c122-4a07-b670-857581a51135.gpt.94067efc-1741-4e5f-a603-b0573efa2852',
    defaultCoder: 'T_c7c2ff36-0f20-091f-6f1b-e6d9a241b5ea.4a89c07f-839b-4880-9ce0-d769c4ec9375.gpt.b5725a70-9850-4f60-8446-cb4fe2345296',
    defaultResearcher: 'T_970346be-8c26-0c5a-2f5e-e9f341d7614d.ac4af79e-acec-4578-8b0c-8d725dcf21ee.gpt.c0b8b1d4-a865-4c4c-a30e-dd3508e2bd7c',
  },
  accountModalOpen: false,
  agentModalOpen: false,
  skillModalOpen: false,
  agentMountedSkills: ['handoff', 'subagent'],
};


let globalState: AppState = { ...initialState };
const listeners = new Set<() => void>();

export function getAppState(): AppState {
  return globalState;
}

export function setState(updater: (prev: AppState) => AppState): void {
  globalState = updater(globalState);
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.error('[Store] Error in store listener:', err);
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AppState {
  return globalState;
}

const actions: AppActions = {
  setSidebarCollapsed: (collapsed: boolean) => {
    setState((s) => ({ ...s, sidebarCollapsed: collapsed }));
  },

  setRightbarCollapsed: (collapsed: boolean) => {
    setState((s) => ({ ...s, rightbarCollapsed: collapsed }));
  },

  setActiveRightbarTab: (tab: RightbarTab) => {
    setState((s) => ({ ...s, activeRightbarTab: tab, rightbarCollapsed: false }));
  },

  selectSession: (id: string) => {
    setState((s) => ({ ...s, activeSessionId: id }));
    wsClient.send('session:select', { sessionId: id });
  },

  createNewSession: () => {
    wsClient.send('session:new');
  },

  submitPrompt: (text: string, attachments?: Array<{ name: string; path: string; size?: number }>) => {
    const newTurnId = `turn-${Date.now()}`;
    const newTurn: Turn = {
      id: newTurnId,
      turnNumber: globalState.turns.length + 1,
      userMessage: { text, attachments },
      reasoning: { text: '', isStreaming: true },
      tools: [],
      status: 'streaming',
    };

    setState((s) => ({
      ...s,
      running: true,
      turns: [...s.turns, newTurn],
    }));

    wsClient.send('user:submit', { text, attachments });
  },

  interrupt: () => {
    setState((s) => {
      const turns = [...s.turns];
      const lastTurn = turns[turns.length - 1];
      if (lastTurn && lastTurn.status === 'streaming') {
        turns[turns.length - 1] = {
          ...lastTurn,
          status: 'interrupted',
          reasoning: lastTurn.reasoning ? { ...lastTurn.reasoning, isStreaming: false } : undefined,
        };
      }
      return { ...s, running: false, turns };
    });

    wsClient.send('user:interrupt');
  },

  clearTerminalLogs: () => {
    setState((s) => ({ ...s, terminalLogs: [] }));
  },

  appendTerminalLog: (log: Omit<TerminalLog, 'id' | 'timestamp'>) => {
    const newEntry: TerminalLog = {
      id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...log,
    };
    setState((s) => ({ ...s, terminalLogs: [...s.terminalLogs, newEntry] }));
  },

  setActiveDiffFile: (id: string | null) => {
    setState((s) => ({ ...s, activeDiffFileId: id }));
  },

  setSelectedFilePath: (path: string | null) => {
    setState((s) => ({ ...s, selectedFilePath: path }));
  },

  setWorkspaceRoot: (targetPath: string, cloudWorkspace?: CloudWorkspaceConfig | null) => {
    setState((s) => ({ ...s, workspaceError: null }));
    wsClient.send('workspace:set', { path: targetPath, cloudWorkspace });
  },

  verifyCloudWorkspace: (options: { siteUrl?: string; targetFolder?: string; workspaceRoot?: string }) => {
    setState((s) => ({ ...s, cloudVerifyState: { loading: true, result: null } }));
    wsClient.send('workspace:verify-cloud', options);
  },

  syncCloudWorkspace: () => {
    setState((s) => ({ ...s, cloudSyncing: true }));
    wsClient.send('workspace:sync-cloud', { workspaceRoot: globalState.workspaceRoot });
  },

  clearCloudVerifyState: () => {
    setState((s) => ({ ...s, cloudVerifyState: { loading: false, result: null } }));
  },

  setWorkspaceModalOpen: (open: boolean) => {
    setState((s) => ({ ...s, workspaceModalOpen: open, workspaceError: null }));
  },

  clearWorkspaceError: () => {
    setState((s) => ({ ...s, workspaceError: null }));
  },

  setAccountModalOpen: (open: boolean) => {
    setState((s) => ({ ...s, accountModalOpen: open }));
    if (open) {
      wsClient.send('accounts:list');
    }
  },

  setAgentModalOpen: (open: boolean) => {
    setState((s) => ({ ...s, agentModalOpen: open }));
    if (open) {
      wsClient.send('agent:get');
    }
  },

  toggleAccount: (email: string, enabled: boolean) => {
    wsClient.send('accounts:toggle', { email, enabled });
  },

  setAccountWhitelist: (emails: string[] | null) => {
    wsClient.send('accounts:whitelist', { emails });
  },

  resetAccountCooldown: (email: string) => {
    wsClient.send('accounts:reset-cooldown', { email });
  },

  setAgentId: (role: 'main' | 'coder' | 'researcher' | 'custom', id?: string) => {
    wsClient.send('agent:set', { role, id });
  },

  resetAgentId: (role?: 'main' | 'coder' | 'researcher' | 'all') => {
    wsClient.send('agent:reset', { role: role || 'all' });
  },

  addCustomAgent: (agent: { name: string; agentId: string; role?: 'main' | 'coder' | 'researcher' | 'custom'; description?: string }) => {
    wsClient.send('agent:add-custom', { agent });
  },

  removeCustomAgent: (id: string) => {
    wsClient.send('agent:remove-custom', { id });
  },

  setSkillModalOpen: (open: boolean) => {
    setState((s) => ({ ...s, skillModalOpen: open }));
  },

  toggleSkillMounted: (name: string) => {
    wsClient.send('skills:toggle-mounted', { name });
  },

  setAgentMountedSkills: (names: string[]) => {
    wsClient.send('skills:set-mounted', { names });
  },
};


export function useAppStore(): AppStore {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return {
    ...state,
    ...actions,
  };
}

// 绑定底层 WebSocket 流式事件至全局状态
wsClient.on('connection:change', ({ connected }: { connected: boolean }) => {
  setState((s) => ({ ...s, connected }));
  if (connected) {
    wsClient.send('skills:list');
  }
});

wsClient.on('session:snapshot', (payload: any) => {
  const skillsList = Array.isArray(payload.availableSkills) && payload.availableSkills.length > 0
    ? payload.availableSkills
    : undefined;

  const nextWorkspaceRoot = payload.workspaceRoot ?? null;
  const nextCloudWorkspace = payload.cloudWorkspace ?? null;

  setState((s) => ({
    ...s,
    sessions: payload.sessions || [],
    activeSessionId: payload.activeSessionId ?? s.activeSessionId,
    turns: payload.turns || [],
    ledgerEntries: payload.ledgerEntries || [],
    contextMetrics: payload.contextMetrics || s.contextMetrics,
    running: payload.running !== undefined ? payload.running : s.running,
    workspaceRoot: nextWorkspaceRoot,
    cloudWorkspace: nextCloudWorkspace,
    recentWorkspaces: payload.recentWorkspaces || s.recentWorkspaces,
    workspaceFiles: nextWorkspaceRoot ? (payload.workspaceFiles || s.workspaceFiles) : [],
    accounts: payload.accounts || s.accounts,
    allowedAccounts: payload.allowedAccounts !== undefined ? payload.allowedAccounts : s.allowedAccounts,
    agentConfig: payload.agentConfig || s.agentConfig,
    availableSkills: skillsList || s.availableSkills || [],
    agentMountedSkills: payload.agentMountedSkills || s.agentMountedSkills || ['handoff', 'subagent'],
  }));

  if (!skillsList) {
    wsClient.send('skills:list');
  }
});

wsClient.on('skills:update', (payload: any) => {
  setState((s) => ({
    ...s,
    availableSkills: payload.availableSkills || s.availableSkills,
    agentMountedSkills: payload.agentMountedSkills || s.agentMountedSkills,
    contextMetrics: payload.activeSkills
      ? { ...s.contextMetrics, activeSkills: payload.activeSkills }
      : s.contextMetrics,
  }));
});

wsClient.on('reasoning:chunk', ({ chunk }: { chunk: string }) => {
  setState((s) => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      const reasoning = lastTurn.reasoning || { text: '', isStreaming: true };
      turns[turns.length - 1] = {
        ...lastTurn,
        reasoning: {
          ...reasoning,
          text: (reasoning.text || '') + chunk,
          isStreaming: true,
        },
      };
    }
    return { ...s, turns };
  });
});

wsClient.on('assistant:chunk', ({ chunk }: { chunk: string }) => {
  setState((s) => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      turns[turns.length - 1] = {
        ...lastTurn,
        reasoning: lastTurn.reasoning ? { ...lastTurn.reasoning, isStreaming: false } : undefined,
        assistantText: (lastTurn.assistantText || '') + chunk,
      };
    }
    return { ...s, turns };
  });
});

wsClient.on('tool:update', (payload: { tool: ToolCall; turnId?: string }) => {
  setState((s) => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && payload && payload.tool) {
      const tools = [...lastTurn.tools];
      const idx = tools.findIndex((t) => t.id === payload.tool.id);
      if (idx >= 0) {
        tools[idx] = payload.tool;
      } else {
        tools.push(payload.tool);
      }
      turns[turns.length - 1] = { ...lastTurn, tools };
    }
    return { ...s, turns };
  });
});

wsClient.on('wal:append', (entry: LedgerEntry) => {
  setState((s) => ({
    ...s,
    ledgerEntries: [entry, ...s.ledgerEntries],
  }));
});

wsClient.on('context:update', (metrics: Partial<ContextMetrics>) => {
  setState((s) => ({
    ...s,
    contextMetrics: { ...s.contextMetrics, ...metrics },
  }));
});

wsClient.on('turn:end', ({ metrics }: { metrics?: Turn['metrics'] } = {}) => {
  setState((s) => {
    const turns = [...s.turns];
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      turns[turns.length - 1] = {
        ...lastTurn,
        status: 'completed',
        reasoning: lastTurn.reasoning ? { ...lastTurn.reasoning, isStreaming: false } : undefined,
        metrics: metrics || lastTurn.metrics,
      };
    }
    return { ...s, running: false, turns };
  });
});

wsClient.on('terminal:chunk', (data: { stream?: 'stdout' | 'stderr' | 'system'; content: string }) => {
  actions.appendTerminalLog({
    stream: data.stream || 'stdout',
    content: data.content,
  });
});

wsClient.on('files:update', (files: WorkspaceFile[]) => {
  setState((s) => ({ ...s, workspaceFiles: files }));
});

wsClient.on('diff:update', (diffs: DiffFile[]) => {
  setState((s) => ({
    ...s,
    diffFiles: diffs,
    activeDiffFileId: s.activeDiffFileId || (diffs.length > 0 ? diffs[0].id : null),
  }));
});

wsClient.on('workspace:update', (payload: any) => {
  const nextWorkspaceRoot = payload.workspaceRoot ?? null;
  const nextCloudWorkspace = payload.cloudWorkspace ?? null;
  setState((s) => ({
    ...s,
    workspaceRoot: nextWorkspaceRoot,
    cloudWorkspace: nextCloudWorkspace,
    recentWorkspaces: payload.recentWorkspaces || s.recentWorkspaces,
    workspaceFiles: nextWorkspaceRoot ? (payload.workspaceFiles || s.workspaceFiles) : [],
    workspaceError: null,
  }));
});

wsClient.on('workspace:verify-result', (payload: any) => {
  setState((s) => ({
    ...s,
    cloudVerifyState: { loading: false, result: payload },
  }));
});

wsClient.on('workspace:sync-report', (payload: any) => {
  setState((s) => ({
    ...s,
    cloudSyncing: false,
    cloudSyncReport: payload,
    cloudWorkspace:
      payload.status === 'completed' && s.cloudWorkspace
        ? { ...s.cloudWorkspace, lastSyncedAt: new Date().toISOString() }
        : s.cloudWorkspace,
  }));
  if (payload.status === 'completed') {
    actions.appendTerminalLog({
      stream: 'system',
      content: `[SharePoint Sync] 同步完成: ${payload.report?.syncedCount ?? 0} 个文件，耗时 ${payload.report?.durationMs ?? 0}ms`,
    });
  } else {
    actions.appendTerminalLog({
      stream: 'stderr',
      content: `[SharePoint Sync] 同步失败: ${payload.error || '未知错误'}`,
    });
  }
});

wsClient.on('workspace:error', (payload: { message?: string }) => {
  setState((s) => ({
    ...s,
    workspaceError: payload.message || '切换工作区失败',
  }));
});

wsClient.on('accounts:update', (payload: { accounts?: AccountInfo[]; allowedAccounts?: string[] | null }) => {
  setState((s) => ({
    ...s,
    accounts: payload.accounts || s.accounts,
    allowedAccounts: payload.allowedAccounts !== undefined ? payload.allowedAccounts : s.allowedAccounts,
  }));
});

wsClient.on('agent:update', (payload: Partial<AgentConfig>) => {
  setState((s) => ({
    ...s,
    agentConfig: { ...s.agentConfig, ...payload },
  }));
});


