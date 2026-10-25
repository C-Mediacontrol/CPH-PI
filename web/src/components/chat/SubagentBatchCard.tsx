import React, { useState, useMemo } from 'react';
import {
  Search,
  Code2,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  Layers,
  Maximize2,
  PanelRightOpen,
  FileText,
  Copy,
  Check,
  Terminal,
  User,
  Brain,
} from 'lucide-react';
import type { ToolCall, SubagentState } from '../../types/protocol';
import { useAppStore } from '../../services/store';
import css from './SubagentBatchCard.module.css';

export interface SubagentBatchCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
}

export function SubagentBatchCard({
  tool,
  defaultExpanded,
}: SubagentBatchCardProps): React.JSX.Element {
  const { subagentsMap, setFocusedSubagentId, setActiveSubagentAsideId } = useAppStore();

  const [expanded, setExpanded] = useState<boolean>(
    defaultExpanded !== undefined
      ? defaultExpanded
      : tool.status === 'running' || Boolean(tool.output)
  );

  const [selectedSubId, setSelectedSubId] = useState<string | 'all'>('all');
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [actionsExpanded, setActionsExpanded] = useState<Record<string, boolean>>({});

  // 1. 匹配当前 tool.id 下的所有 subagents
  const subagents: SubagentState[] = useMemo(() => {
    const storeSubagents = Object.values(subagentsMap);
    const matching = storeSubagents.filter((s) => s.toolId === tool.id);
    if (matching.length > 0) {
      return matching;
    }

    // 若未显式绑定 toolId 但全局只有一批子代理，尝试使用未绑定 toolId 的条目
    const unassigned = storeSubagents.filter((s) => !s.toolId);
    if (unassigned.length > 0) {
      return unassigned;
    }

    // 回退尝试解析 tool.args?.subagents
    const rawSubagents = (tool.args as any)?.subagents;
    if (Array.isArray(rawSubagents) && rawSubagents.length > 0) {
      return rawSubagents.map((item: any, idx: number) => ({
        id: item.id || `sub-${idx + 1}`,
        toolId: tool.id,
        role: item.role || 'coder',
        spec: typeof item === 'object' ? item : { prompt: String(item) },
        status:
          tool.status === 'completed'
            ? 'completed'
            : tool.status === 'failed'
            ? 'failed'
            : 'queued',
        hopCount: item.hopCount || 0,
        currentTurn: 0,
        reasoning: '',
        actions: [],
        startTime: Date.now(),
        durationMs: tool.durationMs,
      }));
    }

    return [];
  }, [subagentsMap, tool.id, tool.args, tool.status, tool.durationMs]);

  // 2. 统计指标
  const counts = useMemo(() => {
    const total = subagents.length;
    const completed = subagents.filter((s) => s.status === 'completed').length;
    const running = subagents.filter((s) => s.status === 'running').length;
    const failed = subagents.filter((s) => s.status === 'failed').length;
    const queued = subagents.filter((s) => s.status === 'queued').length;
    return { total, completed, running, failed, queued };
  }, [subagents]);

  const stage = (tool.args as any)?.stage ?? (subagents[0]?.spec as any)?.stage ?? 1;

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const getRoleIcon = (role?: string) => {
    const normalized = (role || '').toLowerCase();
    if (normalized.includes('research') || normalized.includes('search')) {
      return <Search size={13} />;
    }
    if (normalized.includes('code') || normalized.includes('dev')) {
      return <Code2 size={13} />;
    }
    return <Bot size={13} />;
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className={`${css.statusBadge} ${css.statusRunning}`} title="运行中">
            <Loader2 size={11} className={css.spinner} />
            <span>运行中</span>
          </span>
        );
      case 'completed':
        return (
          <span className={`${css.statusBadge} ${css.statusCompleted}`} title="已完成">
            <CheckCircle2 size={11} color="var(--dsw-static-green-500, #22c55e)" />
            <span>完成</span>
          </span>
        );
      case 'failed':
        return (
          <span className={`${css.statusBadge} ${css.statusFailed}`} title="执行失败">
            <AlertCircle size={11} color="var(--dsw-static-red-500, #ef4444)" />
            <span>失败</span>
          </span>
        );
      case 'queued':
      default:
        return (
          <span className={`${css.statusBadge} ${css.statusQueued}`} title="就绪排队中">
            <Clock size={11} color="var(--dsw-static-amber-500, #f59e0b)" />
            <span>排队中</span>
          </span>
        );
    }
  };

  const handleCopyReport = async (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedReportId(id);
      setTimeout(() => setCopiedReportId(null), 2000);
    } catch (err) {
      console.warn('Failed to copy report:', err);
    }
  };

  const toggleReasoning = (subId: string) => {
    setReasoningExpanded((prev) => ({
      ...prev,
      [subId]: prev[subId] !== undefined ? !prev[subId] : false,
    }));
  };

  const toggleActions = (subId: string) => {
    setActionsExpanded((prev) => ({
      ...prev,
      [subId]: prev[subId] !== undefined ? !prev[subId] : false,
    }));
  };

  const displayedSubagents = useMemo(() => {
    if (selectedSubId === 'all') {
      return subagents;
    }
    const found = subagents.find((s) => s.id === selectedSubId);
    return found ? [found] : subagents;
  }, [selectedSubId, subagents]);

  const formattedToolDuration = formatDuration(tool.durationMs);

  return (
    <div className={css.batchCard}>
      {/* 顶栏卡片头部 */}
      <button
        type="button"
        className={css.batchHeader}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        title={expanded ? '折叠子代理调度批次' : '展开子代理调度批次'}
      >
        <div className={css.headerLeft}>
          <span className={css.stageBadge}>STAGE {stage}</span>
          <span className={css.summaryText}>
            并发子代理批处理 ({counts.total > 0 ? `${counts.completed}/${counts.total} 完成` : '执行中'})
          </span>

          <div className={css.badgeCounts}>
            {counts.running > 0 && (
              <span className={css.countItem}>
                <Loader2 size={11} className={css.spinner} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                {counts.running} 运行中
              </span>
            )}
            {counts.completed > 0 && (
              <span className={css.countItem}>
                <CheckCircle2 size={11} color="var(--dsw-static-green-500, #22c55e)" />
                {counts.completed} 成功
              </span>
            )}
            {counts.failed > 0 && (
              <span className={css.countItem}>
                <AlertCircle size={11} color="var(--dsw-static-red-500, #ef4444)" />
                {counts.failed} 失败
              </span>
            )}
            {counts.queued > 0 && (
              <span className={css.countItem}>
                <Clock size={11} color="var(--dsw-static-amber-500, #f59e0b)" />
                {counts.queued} 排队
              </span>
            )}
          </div>
        </div>

        <div className={css.headerRight}>
          {formattedToolDuration && <span className={css.duration}>{formattedToolDuration}</span>}
          <div className={`${css.chevron} ${expanded ? css.chevronExpanded : ''}`}>
            <ChevronDown size={14} />
          </div>
        </div>
      </button>

      {expanded && (
        <div>
          {/* 单选标签栏：支持用户独立切换各子代理 */}
          {subagents.length > 0 && (
            <div className={css.tabStrip}>
              <button
                type="button"
                className={`${css.tabBtn} ${selectedSubId === 'all' ? css.tabBtnActive : ''}`}
                onClick={() => setSelectedSubId('all')}
              >
                <Layers size={13} />
                <span>全部概览</span>
                <span className={css.tabBtnCount}>{subagents.length}</span>
              </button>

              {subagents.map((sub, idx) => {
                const isSelected = selectedSubId === sub.id;
                const label = sub.spec?.description
                  ? sub.spec.description.slice(0, 14)
                  : `${sub.role || 'sub'}-${idx + 1}`;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    className={`${css.tabBtn} ${isSelected ? css.tabBtnActive : ''}`}
                    onClick={() => setSelectedSubId(sub.id)}
                    title={`${sub.id} (${sub.role}): ${sub.spec?.prompt || ''}`}
                  >
                    {getRoleIcon(sub.role)}
                    <span>{label}</span>
                    {sub.status === 'running' && (
                      <Loader2 size={10} className={css.spinner} />
                    )}
                    {sub.status === 'completed' && (
                      <CheckCircle2 size={10} color="var(--dsw-static-green-500, #22c55e)" />
                    )}
                    {sub.status === 'failed' && (
                      <AlertCircle size={10} color="var(--dsw-static-red-500, #ef4444)" />
                    )}
                    {sub.status === 'queued' && (
                      <Clock size={10} color="var(--dsw-static-amber-500, #f59e0b)" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 子代理详情列表 */}
          {displayedSubagents.length > 0 ? (
            <div className={css.subagentList}>
              {displayedSubagents.map((sub) => {
                const isReasoningOpen =
                  reasoningExpanded[sub.id] !== undefined
                    ? reasoningExpanded[sub.id]
                    : sub.status === 'running' || Boolean(sub.reasoning);
                const isActionsOpen =
                  actionsExpanded[sub.id] !== undefined
                    ? actionsExpanded[sub.id]
                    : sub.status === 'running' || (sub.actions && sub.actions.length > 0);

                const subDuration = formatDuration(sub.durationMs);

                return (
                  <div key={sub.id} className={css.subagentItem}>
                    {/* 子代理头部条 */}
                    <div className={css.subagentHeader}>
                      <div className={css.subagentHeaderLeft}>
                        {getRoleIcon(sub.role)}
                        <span className={css.idBadge}>{sub.id}</span>
                        <span className={css.roleBadge}>{sub.role}</span>
                        {sub.account && (
                          <span className={css.accountBadge} title={`绑定账号: ${sub.account}`}>
                            <User size={10} />
                            {sub.account.includes('@') ? sub.account.split('@')[0] : sub.account}
                          </span>
                        )}
                        {renderStatusBadge(sub.status)}
                      </div>

                      <div className={css.subagentHeaderRight}>
                        {subDuration && <span className={css.duration}>{subDuration}</span>}
                        <div className={css.actionBtns}>
                          <button
                            type="button"
                            className={css.actionBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusedSubagentId(sub.id);
                            }}
                            title="聚焦中央主视窗只读查看该子代理"
                          >
                            <Maximize2 size={11} />
                            <span>聚焦中央</span>
                          </button>
                          <button
                            type="button"
                            className={css.actionBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSubagentAsideId(sub.id);
                            }}
                            title="在右侧抽屉栏比对打开"
                          >
                            <PanelRightOpen size={11} />
                            <span>在右侧栏打开</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 任务描述/Prompt */}
                    {(sub.spec?.prompt || sub.spec?.description) && (
                      <div className={css.subagentPrompt}>
                        {sub.spec.description || sub.spec.prompt}
                      </div>
                    )}

                    {/* 思考链折叠层 (Live CoT) */}
                    {(sub.reasoning || sub.status === 'running') && (
                      <div className={css.reasoningSection}>
                        <button
                          type="button"
                          className={css.reasoningHeader}
                          onClick={() => toggleReasoning(sub.id)}
                        >
                          <div className={css.reasoningHeaderLeft}>
                            <Brain size={12} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                            {sub.status === 'running' ? (
                              <span className={css.textShimmer}>深度思考中...</span>
                            ) : (
                              <span>已深度思考</span>
                            )}
                          </div>
                          <div className={`${css.chevron} ${isReasoningOpen ? css.chevronExpanded : ''}`}>
                            <ChevronDown size={12} />
                          </div>
                        </button>
                        {isReasoningOpen && (
                          <pre className={css.reasoningPre}>
                            {sub.reasoning || '等待思考流输出...'}
                            {sub.status === 'running' && <span className={css.cursorShimmer} />}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* 子工具调用流水线 */}
                    {sub.actions && sub.actions.length > 0 && (
                      <div className={css.actionList}>
                        <button
                          type="button"
                          className={css.reasoningHeader}
                          onClick={() => toggleActions(sub.id)}
                        >
                          <div className={css.reasoningHeaderLeft}>
                            <Terminal size={12} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                            <span>执行流水线 ({sub.actions.length})</span>
                          </div>
                          <div className={`${css.chevron} ${isActionsOpen ? css.chevronExpanded : ''}`}>
                            <ChevronDown size={12} />
                          </div>
                        </button>

                        {isActionsOpen &&
                          sub.actions.map((act, actIdx) => (
                            <div key={actIdx} className={css.actionItem}>
                              <div className={css.actionHeader}>
                                <span className={css.actionTool}>
                                  <Terminal size={10} />
                                  {act.tool}
                                </span>
                                {act.timestamp && (
                                  <span className={css.actionTime}>
                                    {new Date(act.timestamp).toLocaleTimeString()}
                                  </span>
                                )}
                              </div>
                              {act.args && (
                                <div className={css.actionArgs}>
                                  {typeof act.args === 'string'
                                    ? act.args
                                    : JSON.stringify(act.args)}
                                </div>
                              )}
                              {act.output && (
                                <div className={css.actionOutput}>{act.output}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}

                    {/* 阶段成果报告卡片 (Deliverable Report Card) */}
                    {sub.report && (
                      <div className={css.reportCard}>
                        <div className={css.reportHeader}>
                          <span className={css.reportTitle}>
                            <FileText size={13} />
                            阶段成果交付物
                          </span>
                          {renderStatusBadge(sub.report.success ? 'completed' : 'failed')}
                        </div>

                        {sub.report.deliverablePath && (
                          <div className={css.reportPath} title={sub.report.deliverablePath}>
                            {sub.report.deliverablePath}
                          </div>
                        )}

                        {(sub.report.finalAnswer || sub.report.description) && (
                          <div className={css.reportSummary}>
                            {sub.report.finalAnswer || sub.report.description}
                          </div>
                        )}

                        <div className={css.reportActions}>
                          <button
                            type="button"
                            className={css.reportBtn}
                            onClick={() => setActiveSubagentAsideId(sub.id)}
                          >
                            <PanelRightOpen size={11} />
                            <span>在侧栏查看</span>
                          </button>
                          <button
                            type="button"
                            className={`${css.reportBtn} ${css.reportBtnSecondary}`}
                            onClick={(e) =>
                              handleCopyReport(
                                sub.report?.finalAnswer || sub.report?.description || '',
                                sub.id,
                                e
                              )
                            }
                          >
                            {copiedReportId === sub.id ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copiedReportId === sub.id ? '已复制' : '复制报告'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : tool.output ? (
            <pre className={css.fallbackPre}>{tool.output}</pre>
          ) : (
            <div className={css.emptyState}>子代理调度准备中，暂无活动记录...</div>
          )}
        </div>
      )}
    </div>
  );
}

export default SubagentBatchCard;
