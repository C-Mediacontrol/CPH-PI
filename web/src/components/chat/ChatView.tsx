import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  Bot,
  Sparkles,
  Search,
  TestTube,
  Flame,
  Layers,
  Paperclip,
  AlertTriangle,
  XCircle,
  Users,
  FolderOpen,
  ShieldCheck,
  ArrowLeft,
  Target,
  Terminal,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  PanelRightOpen,
  Code2,
  User,
  Brain,
  FileText,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import { ReasoningRow } from './ReasoningRow';
import { ToolCard } from './ToolCard';
import { StatsPills } from './StatsPills';
import { Composer } from './Composer';
import { MarkdownView } from './MarkdownView';
import { SubagentHeaderLineage } from './SubagentHeaderLineage';
import { SubagentReadOnlyComposer } from './SubagentReadOnlyComposer';
import { HandoffAnchorCard } from './HandoffAnchorCard';
import { LazyViewportItem } from '../common/LazyViewportItem';
import { LazyTextCollapse } from '../common/LazyTextCollapse';
import css from './ChatView.module.css';

const QUICK_SUGGESTIONS = [
  {
    icon: Search,
    title: '架构与代码质量审计',
    prompt: '执行全面架构与代码质量审计，检查潜在逻辑矛盾与坏味道',
  },
  {
    icon: TestTube,
    title: 'TDD 驱动测试补全',
    prompt: '基于 TDD 流程针对核心接口编写行为验证测试并确保全部通过',
  },
  {
    icon: Flame,
    title: '排查运行时错误',
    prompt: '四阶段系统化排查定位当前模块中的异常报错，严守无根因不修复',
  },
  {
    icon: Layers,
    title: '模块依赖与重构梳理',
    prompt: '分析当前模块调用拓扑，提炼深层模块契约并输出重构建议',
  },
];

export function ChatView(): React.JSX.Element {
  const {
    turns,
    activeSessionId,
    sessions,
    connected,
    contextMetrics,
    submitPrompt,
    accounts,
    setAccountModalOpen,
    setAgentModalOpen,
    workspaceRoot,
    setWorkspaceModalOpen,
    subagentsMap,
    focusedSubagentId,
    setFocusedSubagentId,
    setActiveSubagentAsideId,
    setActiveRightbarTab,
    setRightbarCollapsed,
    handoffAnchor,
    clearHandoffAnchor,
  } = useAppStore();

  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const readyCount = useMemo(
    () => accounts.filter((a) => a.isAvailable && !a.isThrottled && a.isAllowed).length,
    [accounts]
  );
  const throttledCount = useMemo(() => accounts.filter((a) => a.isThrottled).length, [accounts]);

  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId);
  }, [sessions, activeSessionId]);

  const sessionTitle = activeSession?.title || '新任务会话';

  const focusedSub = focusedSubagentId ? subagentsMap[focusedSubagentId] : null;

  // 自动平滑滚动到底部
  useEffect(() => {
    if (scrollBottomRef.current) {
      scrollBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [turns, focusedSubagentId]);

  const handleCopyReport = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch (err) {
      console.warn('Failed to copy deliverable report:', err);
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const getSubRoleIcon = (role?: string) => {
    const normalized = (role || '').toLowerCase();
    if (normalized.includes('research') || normalized.includes('search')) {
      return <Search size={14} />;
    }
    if (normalized.includes('code') || normalized.includes('dev')) {
      return <Code2 size={14} />;
    }
    return <Bot size={14} />;
  };

  const renderSubStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className={`${css.statusBadge} ${css.statusRunning}`} title="正在运行中">
            <Loader2 size={11} className={css.spinner} />
            <span>运行中</span>
          </span>
        );
      case 'completed':
        return (
          <span className={`${css.statusBadge} ${css.statusCompleted}`} title="执行已完成">
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

  return (
    <div className={css.chatContainer}>
      {/* 顶部会话栏 */}
      <header className={css.chatHeader}>
        {focusedSubagentId ? (
          /* 聚焦子代理状态下的顶栏 */
          <div className={css.headerLeft}>
            <button
              type="button"
              className={css.focusedHeaderBackBtn}
              onClick={() => setFocusedSubagentId(null)}
              title="退出子代理视角，返回主任务会话"
            >
              <ArrowLeft size={13} />
              <span>返回主会话</span>
            </button>

            <div className={css.focusedHeaderTitle}>
              <span style={{ opacity: 0.65, fontSize: 12 }}>聚焦视角:</span>
              <span className={css.focusedSubagentTag}>
                {focusedSub ? `${focusedSub.role} (${focusedSub.id})` : focusedSubagentId}
              </span>
            </div>

            <SubagentHeaderLineage />
          </div>
        ) : (
          /* 主会话常规顶栏 */
          <div className={css.headerLeft}>
            <span className={css.sessionTitle} title={sessionTitle}>
              {sessionTitle}
            </span>
            <button
              className={css.agentBadge}
              onClick={() => setAgentModalOpen(true)}
              title="点击配置/绑定 Copilot 智能体"
              type="button"
              style={{ cursor: 'pointer', border: 'none' }}
            >
              <Bot size={13} />
              {contextMetrics.activeAgent || 'cph-dev-agent'}
            </button>

            <SubagentHeaderLineage />
          </div>
        )}

        <div className={css.headerRight}>
          {focusedSubagentId && focusedSub ? (
            <button
              type="button"
              className={css.heroAsideBtn}
              onClick={() => {
                setActiveSubagentAsideId(focusedSub.id);
                setActiveRightbarTab('subagent');
                setRightbarCollapsed(false);
              }}
              title="在右侧抽屉栏打开比对该子代理"
            >
              <PanelRightOpen size={13} />
              <span>在侧栏打开</span>
            </button>
          ) : (
            <button
              onClick={() => setAccountModalOpen(true)}
              title="点击查看与管理 M365 账号池"
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))',
                background: '#ffffff',
                color: throttledCount > 0 ? '#dc2626' : '#059669',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <Users size={13} />
              <span>
                {throttledCount > 0
                  ? `${throttledCount} 账号冷却`
                  : `${readyCount || accounts.length} 账号就绪`}
              </span>
            </button>
          )}

          <div className={css.statusIndicator}>
            <div
              className={`${css.statusDot} ${
                !connected ? css.statusDotDisconnected : ''
              }`}
            />
            <span>{connected ? 'WebSocket 已连接' : '离线重连中'}</span>
          </div>
        </div>
      </header>

      {/* 消息滚动流 / 独立子代理聚焦视窗 */}
      <div className={css.scrollArea} ref={scrollAreaRef}>
        {focusedSubagentId ? (
          /* ================================================================
             独立子代理聚焦流 (Focused Subagent Dedicated Stage)
             ================================================================ */
          <div className={css.focusedStageContainer}>
            {!focusedSub ? (
              <div className={css.cardSection} style={{ padding: 24, textAlign: 'center' }}>
                <p style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
                  未在当前会话记录中检索到子代理实体 (ID: {focusedSubagentId})
                </p>
                <button
                  type="button"
                  className={css.focusedHeaderBackBtn}
                  onClick={() => setFocusedSubagentId(null)}
                >
                  <ArrowLeft size={13} />
                  <span>返回主会话</span>
                </button>
              </div>
            ) : (
              <>
                {/* 1. 英雄概览卡片 */}
                <div className={css.focusedHeroCard}>
                  <div className={css.heroLeft}>
                    <div className={css.heroRoleIcon}>
                      {getSubRoleIcon(focusedSub.role)}
                    </div>
                    <span className={css.heroSubId}>{focusedSub.id}</span>
                    <span className={css.heroRoleBadge}>{focusedSub.role}</span>
                    {focusedSub.account && (
                      <span
                        className={css.heroAccountBadge}
                        title={`绑定 M365 账号: ${focusedSub.account}`}
                      >
                        <User size={11} />
                        <span>
                          {focusedSub.account.includes('@')
                            ? focusedSub.account.split('@')[0]
                            : focusedSub.account}
                        </span>
                      </span>
                    )}
                    <span className={css.heroMetaBadge}>
                      Hop {focusedSub.hopCount} · Turn {focusedSub.currentTurn}
                    </span>
                  </div>

                  <div className={css.heroRight}>
                    {formatDuration(focusedSub.durationMs) && (
                      <span className={css.heroDuration}>
                        耗时: {formatDuration(focusedSub.durationMs)}
                      </span>
                    )}
                    {renderSubStatusBadge(focusedSub.status)}
                    <button
                      type="button"
                      className={css.heroAsideBtn}
                      onClick={() => {
                        setActiveSubagentAsideId(focusedSub.id);
                        setActiveRightbarTab('subagent');
                        setRightbarCollapsed(false);
                      }}
                      title="在右侧抽屉栏打开对比监视"
                    >
                      <PanelRightOpen size={12} />
                      <span>侧栏比对</span>
                    </button>
                  </div>
                </div>

                {/* 2. 任务目标与执行规范卡片 */}
                <div className={css.cardSection}>
                  <div className={css.cardHeader}>
                    <div className={css.cardHeaderTitleLight}>
                      <Target size={15} color="var(--dsw-static-deepseek-500, #4176e6)" />
                      <span>任务目标与执行规范 (Task Goal & Spec)</span>
                    </div>
                    {focusedSub.spec?.stage !== undefined && (
                      <span className={css.focusedSubagentTag}>
                        STAGE {focusedSub.spec.stage}
                      </span>
                    )}
                  </div>
                  <div className={css.cardBody}>
                    {focusedSub.spec?.targetFile && (
                      <div className={css.targetFileBadge}>
                        <FileText size={12} />
                        <span>目标文件: {focusedSub.spec.targetFile}</span>
                      </div>
                    )}
                    <div className={css.promptCardText}>
                      {focusedSub.spec?.description ||
                        focusedSub.spec?.prompt ||
                        '未提供具体任务描述'}
                    </div>
                  </div>
                </div>

                {/* 3. 实时思考链 (Live CoT) */}
                <div className={css.cardSectionDark}>
                  <div className={css.cardHeaderDark}>
                    <div className={css.cardHeaderTitle}>
                      <Brain size={14} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                      <span>思考过程 / CoT (Chain of Thought)</span>
                    </div>
                    <div>
                      {focusedSub.status === 'running' ? (
                        <span className={css.thinkingShimmer}>深度思考中...</span>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#94a3b8' }}>已深度思考</span>
                      )}
                    </div>
                  </div>
                  <pre className={css.thinkingPre}>
                    {focusedSub.reasoning ||
                      (focusedSub.status === 'running'
                        ? '等待思考流输出...'
                        : '无独立思考链记录')}
                    {focusedSub.status === 'running' && (
                      <span className={css.thinkingCursor} />
                    )}
                  </pre>
                </div>

                {/* 4. 工具调用执行流 */}
                <div className={css.cardSectionDark}>
                  <div className={css.cardHeaderDark}>
                    <div className={css.cardHeaderTitle}>
                      <Terminal size={14} color="var(--dsw-static-deepseek-400, #7aaaff)" />
                      <span>工具调用链 (Tool Execution Stream)</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                      {focusedSub.actions?.length || 0} 次操作
                    </span>
                  </div>
                  {focusedSub.actions && focusedSub.actions.length > 0 ? (
                    <div className={css.actionList}>
                      {focusedSub.actions.map((act, aIdx) => (
                        <LazyViewportItem key={aIdx} fallbackHeight={90}>
                          <div className={css.actionItem}>
                            <div className={css.actionItemHeader}>
                              <span className={css.actionToolName}>
                                <Terminal size={11} />
                                #{aIdx + 1} {act.tool}
                              </span>
                              {act.timestamp && (
                                <span className={css.actionTimestamp}>
                                  {new Date(act.timestamp).toLocaleTimeString()}
                                </span>
                              )}
                            </div>
                            {act.args && (
                              <pre className={css.actionArgsPre}>
                                {typeof act.args === 'string'
                                  ? act.args
                                  : JSON.stringify(act.args, null, 2)}
                              </pre>
                            )}
                            {act.output && (
                              <LazyTextCollapse
                                text={act.output}
                                maxLines={30}
                                maxChars={1500}
                                preClassName={css.actionOutputPre}
                              />
                            )}
                          </div>
                        </LazyViewportItem>
                      ))}
                    </div>
                  ) : (
                    <div className={css.emptyActions}>
                      {focusedSub.status === 'running'
                        ? '子代理正在初始化与执行，尚未产生工具调用...'
                        : '该子代理执行未产生工具调用'}
                    </div>
                  )}
                </div>

                {/* 5. 最终交付成果报告预览 */}
                {focusedSub.report && (
                  <LazyViewportItem fallbackHeight={300}>
                    <div className={css.reportPreviewCard}>
                      <div className={css.reportPreviewHeader}>
                        <div className={css.reportPreviewTitle}>
                          <CheckCircle2 size={16} />
                          <span>最终交付成果报告 (Deliverable Report)</span>
                        </div>
                        <div className={css.reportPreviewMeta}>
                          {focusedSub.report.deliverablePath && (
                            <span className={css.reportDeliverablePath}>
                              📄 {focusedSub.report.deliverablePath}
                            </span>
                          )}
                          <span>{focusedSub.report.turnsCount} 轮</span>
                          {formatDuration(focusedSub.report.durationMs) && (
                            <span>{formatDuration(focusedSub.report.durationMs)}</span>
                          )}
                          <button
                            type="button"
                            className={css.reportCopyBtn}
                            onClick={() =>
                              handleCopyReport(
                                focusedSub.report?.finalAnswer ||
                                  focusedSub.report?.description ||
                                  ''
                              )
                            }
                            title="复制成果报告文本"
                          >
                            {copiedReport ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedReport ? '已复制' : '复制成果'}</span>
                          </button>
                        </div>
                      </div>
                      <div className={css.reportPreviewBody}>
                        <MarkdownView
                          content={
                            focusedSub.report.finalAnswer ||
                            focusedSub.report.description ||
                            '成果报告为空'
                          }
                        />
                      </div>
                    </div>
                  </LazyViewportItem>
                )}
              </>
            )}
            <div ref={scrollBottomRef} style={{ height: 1 }} />
          </div>
        ) : (
          /* ================================================================
             主会话常规视图 (Main Session Normal View)
             ================================================================ */
          <>
            {!workspaceRoot ? (
              <div className={css.noWorkspaceWrap}>
                <div className={css.noWorkspaceIcon}>
                  <FolderOpen size={32} />
                </div>
                <h1 className={css.noWorkspaceTitle}>欢迎使用 CPH-PI 自主编程终端</h1>
                <p className={css.noWorkspaceSubtitle}>
                  当前尚未选择工作区。选择本地工作区并关联 SharePoint 云端仓库后即可开始自主编程任务。
                </p>
                <button
                  type="button"
                  className={css.selectWorkspaceBtn}
                  onClick={() => setWorkspaceModalOpen(true)}
                >
                  <FolderOpen size={16} />
                  <span>📂 选择本地工作区</span>
                </button>

                <div className={css.guidanceTips}>
                  <ShieldCheck
                    size={14}
                    color="var(--dsw-static-deepseek-500)"
                    style={{ flexShrink: 0 }}
                  />
                  <span>
                    支持本地单一真实源 (SSOT) 对账、93 天可恢复删除、以及 Copilot 原生文件生成与搬运。
                  </span>
                </div>
              </div>
            ) : turns.length === 0 && !handoffAnchor ? (
              <div className={css.welcomeWrap}>
                <div className={css.welcomeLogo}>
                  <Sparkles size={28} />
                </div>
                <h1 className={css.welcomeTitle}>CPH-PI Autonomous Agent</h1>
                <p className={css.welcomeSubtitle}>
                  Copilot M365 Agent 专有控制核驱动 · 工业级工具链与物理沙盒调度
                </p>

                <div className={css.suggestionGrid}>
                  {QUICK_SUGGESTIONS.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={css.suggestionCard}
                        onClick={() => submitPrompt(item.prompt)}
                      >
                        <div className={css.suggestionIcon}>
                          <Icon size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {item.prompt}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={css.turnsInner}>
                {turns.map((turn, index) => {
                  const isLatest = index === turns.length - 1;
                  const isStreaming =
                    turn.status === 'streaming' || Boolean(turn.reasoning?.isStreaming);
                  const forceActive = isLatest || isStreaming;
                  const fallbackHeight =
                    (turn.tools && turn.tools.length > 0) ||
                    (turn.assistantText && turn.assistantText.length > 800)
                      ? 320
                      : 120;

                  return (
                    <LazyViewportItem
                      key={turn.id}
                      fallbackHeight={fallbackHeight}
                      forceActive={forceActive}
                    >
                      <div className={css.turnItem}>
                        {/* 用户提问气泡 */}
                        <div className={css.userRow}>
                          <div className={css.userBubble}>
                            {turn.userMessage.attachments &&
                              turn.userMessage.attachments.length > 0 && (
                                <div className={css.userAttachments}>
                                  {turn.userMessage.attachments.map((att, aIdx) => (
                                    <span
                                      key={`${att.name}-${aIdx}`}
                                      className={css.userAttachmentBadge}
                                    >
                                      <Paperclip size={11} />
                                      {att.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            <div>{turn.userMessage.text}</div>
                          </div>
                        </div>

                        {/* 助手响应区 */}
                        <div className={css.assistantRow}>
                          <div className={css.assistantAvatar}>
                            <Bot size={18} />
                          </div>

                          <div className={css.assistantBody}>
                            <div className={css.assistantNameRow}>
                              <span className={css.assistantName}>CPH-PI</span>
                            </div>

                            {/* 深度思考折叠区 */}
                            {(turn.reasoning?.text || turn.reasoning?.isStreaming) && (
                              <ReasoningRow
                                text={turn.reasoning?.text}
                                isStreaming={turn.reasoning?.isStreaming}
                                durationMs={turn.metrics?.durationMs}
                              />
                            )}

                            {/* 工具调用卡片列表 */}
                            {turn.tools && turn.tools.length > 0 && (
                              <div style={{ margin: '6px 0' }}>
                                {turn.tools.map((tool) => (
                                  <ToolCard key={tool.id} tool={tool} />
                                ))}
                              </div>
                            )}

                            {/* 助手文本输出 */}
                            {turn.assistantText && (
                              <MarkdownView content={turn.assistantText} />
                            )}

                            {/* 流式打字光标 */}
                            {turn.status === 'streaming' && !turn.reasoning?.isStreaming && (
                              <span className={css.typingIndicator} />
                            )}

                            {/* 中断状态 */}
                            {turn.status === 'interrupted' && (
                              <div>
                                <span className={`${css.statusPill} ${css.interruptedPill}`}>
                                  <AlertTriangle size={12} />
                                  生成已由用户中断
                                </span>
                              </div>
                            )}

                            {/* 错误状态 */}
                            {turn.status === 'error' && (
                              <div>
                                <span className={`${css.statusPill} ${css.errorPill}`}>
                                  <XCircle size={12} />
                                  任务执行出现异常
                                </span>
                              </div>
                            )}

                            {/* 性能指标胶囊 */}
                            {turn.metrics && turn.status === 'completed' && (
                              <StatsPills metrics={turn.metrics} />
                            )}
                          </div>
                        </div>
                      </div>
                    </LazyViewportItem>
                  );
                })}
                {handoffAnchor && (
                  <HandoffAnchorCard
                    handoff={handoffAnchor}
                    onDismiss={clearHandoffAnchor}
                  />
                )}
                <div ref={scrollBottomRef} style={{ height: 1 }} />
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部输入区：如果是子代理聚焦状态则挂载只读保护 Composer，否则挂载常规 Composer */}
      {focusedSubagentId ? (
        <SubagentReadOnlyComposer onBack={() => setFocusedSubagentId(null)} />
      ) : (
        <Composer />
      )}
    </div>
  );
}

export default ChatView;
