import React, { useEffect, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import { ReasoningRow } from './ReasoningRow';
import { ToolCard } from './ToolCard';
import { StatsPills } from './StatsPills';
import { Composer } from './Composer';
import { MarkdownView } from './MarkdownView';
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
  } = useAppStore();

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

  // 自动平滑滚动到底部
  useEffect(() => {
    if (scrollBottomRef.current) {
      scrollBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [turns]);

  return (
    <div className={css.chatContainer}>
      {/* 顶部会话栏 */}
      <header className={css.chatHeader}>
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
        </div>

        <div className={css.headerRight}>
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

      {/* 消息滚动流 */}
      <div className={css.scrollArea} ref={scrollAreaRef}>
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
              <ShieldCheck size={14} color="var(--dsw-static-deepseek-500)" style={{ flexShrink: 0 }} />
              <span>支持本地单一真实源 (SSOT) 对账、93 天可恢复删除、以及 Copilot 原生文件生成与搬运。</span>
            </div>
          </div>
        ) : turns.length === 0 ? (
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
            {turns.map((turn) => {
              return (
                <div key={turn.id} className={css.turnItem}>
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
              );
            })}
            <div ref={scrollBottomRef} style={{ height: 1 }} />
          </div>
        )}
      </div>

      {/* 底部 Composer 输入器 */}
      <Composer />
    </div>
  );
}

export default ChatView;
