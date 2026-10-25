import React, { useState, useMemo } from 'react';
import {
  Bot,
  Search,
  Code2,
  X,
  Maximize2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  User,
  Copy,
  Check,
  Terminal,
  FileText,
  Brain,
  ChevronDown,
  Target,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { SubagentState } from '../../types/protocol';
import { MarkdownView } from '../chat/MarkdownView';
import css from './SubagentInspector.module.css';

export function SubagentInspector(): React.JSX.Element {
  const {
    subagentsMap,
    activeSubagentAsideId,
    setActiveSubagentAsideId,
    setFocusedSubagentId,
  } = useAppStore();

  const [copiedReport, setCopiedReport] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(true);
  const [actionsExpanded, setActionsExpanded] = useState(true);

  const allSubagents: SubagentState[] = useMemo(() => {
    return Object.values(subagentsMap).sort((a, b) => a.startTime - b.startTime);
  }, [subagentsMap]);

  const activeSubagent: SubagentState | null = useMemo(() => {
    if (!activeSubagentAsideId) return null;
    return subagentsMap[activeSubagentAsideId] || null;
  }, [subagentsMap, activeSubagentAsideId]);

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const getRoleIcon = (role?: string) => {
    const normalized = (role || '').toLowerCase();
    if (normalized.includes('research') || normalized.includes('search')) {
      return <Search size={14} />;
    }
    if (normalized.includes('code') || normalized.includes('dev')) {
      return <Code2 size={14} />;
    }
    return <Bot size={14} />;
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className={`${css.statusBadge} ${css.statusRunning}`} title="运行中">
            <Loader2 size={10} className={css.spinner} />
            <span>运行中</span>
          </span>
        );
      case 'completed':
        return (
          <span className={`${css.statusBadge} ${css.statusCompleted}`} title="已完成">
            <CheckCircle2 size={10} color="var(--dsw-static-green-500, #22c55e)" />
            <span>完成</span>
          </span>
        );
      case 'failed':
        return (
          <span className={`${css.statusBadge} ${css.statusFailed}`} title="执行失败">
            <AlertCircle size={10} color="var(--dsw-static-red-500, #ef4444)" />
            <span>失败</span>
          </span>
        );
      case 'queued':
      default:
        return (
          <span className={`${css.statusBadge} ${css.statusQueued}`} title="就绪排队中">
            <Clock size={10} color="var(--dsw-static-amber-500, #f59e0b)" />
            <span>排队</span>
          </span>
        );
    }
  };

  const handleCopyReport = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch (err) {
      console.warn('Failed to copy report:', err);
    }
  };

  // 1. 未选择侧栏审阅子代理或找不到对应子代理时的空状态
  if (!activeSubagentAsideId || !activeSubagent) {
    return (
      <div className={css.container}>
        <div className={css.header}>
          <div className={css.headerLeft}>
            <span className={css.headerIcon}>
              <Bot size={16} />
            </span>
            <span className={css.headerTitle}>子代理抽屉 (Inspector)</span>
          </div>
          {activeSubagentAsideId && (
            <button
              type="button"
              className={css.closeBtn}
              onClick={() => setActiveSubagentAsideId(null)}
              title="清除侧栏选择"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className={css.body}>
          <div className={css.emptyState}>
            <div className={css.emptyIcon}>
              <Bot size={36} />
            </div>
            <div className={css.emptyHint}>
              未选择侧栏审阅的子代理。在聊天流或顶栏点击 [◨ 在侧栏打开] 即可在此并排监视。
            </div>

            {allSubagents.length > 0 && (
              <div className={css.emptyListSection}>
                <div className={css.emptyListTitle}>或直接选择当前活动的子代理：</div>
                {allSubagents.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={css.emptyItemBtn}
                    onClick={() => setActiveSubagentAsideId(sub.id)}
                  >
                    <div className={css.emptyItemLeft}>
                      {getRoleIcon(sub.role)}
                      <span className={css.emptyItemId}>{sub.id}</span>
                      <span className={css.emptyItemRole}>({sub.role})</span>
                    </div>
                    {renderStatusBadge(sub.status)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. 正常激活状态
  const durationText = formatDuration(
    activeSubagent.durationMs ||
      (activeSubagent.startTime ? Date.now() - activeSubagent.startTime : undefined)
  );
  const specText = activeSubagent.spec?.prompt || activeSubagent.spec?.description;
  const isRunning = activeSubagent.status === 'running';

  return (
    <div className={css.container}>
      {/* 头部：标题、多子代理快速切换器与关闭按钮 */}
      <div className={css.header}>
        <div className={css.headerLeft}>
          <span className={css.headerIcon}>
            <Bot size={16} />
          </span>
          <span className={css.headerTitle}>子代理抽屉 (Inspector)</span>

          {allSubagents.length > 1 && (
            <select
              className={css.switcherSelect}
              value={activeSubagent.id}
              onChange={(e) => setActiveSubagentAsideId(e.target.value)}
              title="切换要比对审阅的子代理"
            >
              {allSubagents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} ({s.role}) - {s.status}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          className={css.closeBtn}
          onClick={() => setActiveSubagentAsideId(null)}
          title="关闭子代理抽屉"
          aria-label="关闭子代理抽屉"
        >
          <X size={15} />
        </button>
      </div>

      <div className={css.body}>
        {/* Hero Card：角色图标、ID、M365 账号徽章、状态指示器、耗时、聚焦按钮 */}
        <div className={css.heroCard}>
          <div className={css.heroTopRow}>
            <div className={css.heroIdentity}>
              <span className={css.roleIcon}>{getRoleIcon(activeSubagent.role)}</span>
              <span className={css.idBadge}>{activeSubagent.id}</span>
              <span className={css.roleBadge}>{activeSubagent.role}</span>
              {activeSubagent.account && (
                <span className={css.accountBadge} title={`绑定账号: ${activeSubagent.account}`}>
                  <User size={10} />
                  {activeSubagent.account.includes('@')
                    ? activeSubagent.account.split('@')[0]
                    : activeSubagent.account}
                </span>
              )}
            </div>

            <div className={css.heroRightMeta}>
              {durationText && <span className={css.durationBadge}>{durationText}</span>}
              {renderStatusBadge(activeSubagent.status)}
            </div>
          </div>

          <button
            type="button"
            className={css.focusCenterBtn}
            onClick={() => setFocusedSubagentId(activeSubagent.id)}
            title="将该子代理全屏聚焦到中央主视窗"
          >
            <Maximize2 size={12} />
            <span>🔍 聚焦到中央视窗</span>
          </button>
        </div>

        {/* Task Specification / Goal Card */}
        <div className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.cardTitle}>
              <Target size={14} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
              <span>任务目标与规格 (Task Spec)</span>
            </div>
          </div>

          {activeSubagent.spec?.targetFile && (
            <div className={css.targetFileBox} title={`目标文件: ${activeSubagent.spec.targetFile}`}>
              <FileText size={12} />
              <span>{activeSubagent.spec.targetFile}</span>
            </div>
          )}

          {specText && <div className={css.specPrompt}>{specText}</div>}
        </div>

        {/* Full Live CoT / Reasoning Process with markdown & text shimmer */}
        {(activeSubagent.reasoning || isRunning) && (
          <div className={css.card}>
            <button
              type="button"
              className={css.collapsibleToggle}
              onClick={() => setReasoningExpanded((prev) => !prev)}
              aria-expanded={reasoningExpanded}
            >
              <div className={css.cotHeaderLeft}>
                <Brain size={14} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
                {isRunning ? (
                  <span className="text-shimmer-deep-diving">
                    深度思考中...
                    <Loader2 size={11} className={css.spinner} style={{ marginLeft: 4 }} />
                  </span>
                ) : (
                  <span>实时思考链 (Live CoT)</span>
                )}
              </div>
              <div className={`${css.chevron} ${reasoningExpanded ? css.chevronExpanded : ''}`}>
                <ChevronDown size={14} />
              </div>
            </button>

            {reasoningExpanded && (
              <div className={css.reasoningBody}>
                {activeSubagent.reasoning ? (
                  <>
                    <MarkdownView content={activeSubagent.reasoning} />
                    {isRunning && <span className={css.cursorShimmer} />}
                  </>
                ) : (
                  <div style={{ color: 'var(--dsw-alias-label-caption, #64748b)' }}>
                    等待思考流输出...
                    <span className={css.cursorShimmer} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Child Tool Actions Pipeline (`tool`, `args`, `output`) */}
        <div className={css.card}>
          <button
            type="button"
            className={css.collapsibleToggle}
            onClick={() => setActionsExpanded((prev) => !prev)}
            aria-expanded={actionsExpanded}
          >
            <div className={css.cotHeaderLeft}>
              <Terminal size={14} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
              <span>子工具执行流水线</span>
              <span className={css.actionCountBadge}>{activeSubagent.actions.length}</span>
            </div>
            <div className={`${css.chevron} ${actionsExpanded ? css.chevronExpanded : ''}`}>
              <ChevronDown size={14} />
            </div>
          </button>

          {actionsExpanded && (
            <div className={css.actionsContainer}>
              {activeSubagent.actions.length > 0 ? (
                activeSubagent.actions.map((act, idx) => (
                  <div key={idx} className={css.actionItem}>
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
                          : JSON.stringify(act.args, null, 2)}
                      </div>
                    )}

                    {act.output && (
                      <div className={css.actionOutput}>{act.output}</div>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-caption, #64748b)' }}>
                  暂无子工具调用记录
                </div>
              )}
            </div>
          )}
        </div>

        {/* Deliverable Report Card with markdown renderer, deliverable path, and copy button */}
        {activeSubagent.report && (
          <div className={css.reportCard}>
            <div className={css.reportHeader}>
              <span className={css.reportTitle}>
                <FileText size={14} />
                阶段成果交付物 (Deliverable Report)
              </span>
              {renderStatusBadge(activeSubagent.report.success ? 'completed' : 'failed')}
            </div>

            {activeSubagent.report.deliverablePath && (
              <div
                className={css.reportPath}
                title={`交付物路径: ${activeSubagent.report.deliverablePath}`}
              >
                {activeSubagent.report.deliverablePath}
              </div>
            )}

            {(activeSubagent.report.finalAnswer || activeSubagent.report.description) && (
              <div className={css.reportContent}>
                <MarkdownView
                  content={
                    activeSubagent.report.finalAnswer || activeSubagent.report.description
                  }
                />
              </div>
            )}

            <div className={css.reportActions}>
              <button
                type="button"
                className={`${css.copyBtn} ${copiedReport ? css.copyBtnCopied : ''}`}
                onClick={() =>
                  handleCopyReport(
                    activeSubagent.report?.finalAnswer ||
                      activeSubagent.report?.description ||
                      ''
                  )
                }
              >
                {copiedReport ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedReport ? '已复制' : '复制报告'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SubagentInspector;
