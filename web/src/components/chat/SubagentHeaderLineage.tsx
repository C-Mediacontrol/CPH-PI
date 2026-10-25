import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  GitBranch,
  Search,
  Code2,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  Maximize2,
  PanelRightOpen,
  ArrowLeft,
  User,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { SubagentState } from '../../types/protocol';
import css from './SubagentHeaderLineage.module.css';

export function SubagentHeaderLineage(): React.JSX.Element | null {
  const {
    subagentsMap,
    focusedSubagentId,
    setFocusedSubagentId,
    setActiveSubagentAsideId,
    setActiveRightbarTab,
    setRightbarCollapsed,
  } = useAppStore();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const subagents: SubagentState[] = useMemo(() => {
    return Object.values(subagentsMap).sort((a, b) => a.startTime - b.startTime);
  }, [subagentsMap]);

  // 点击外部关闭与 Escape 监听
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (subagents.length === 0) {
    return null;
  }

  const runningCount = subagents.filter((s) => s.status === 'running').length;
  const completedCount = subagents.filter((s) => s.status === 'completed').length;
  const failedCount = subagents.filter((s) => s.status === 'failed').length;

  const hasRunning = runningCount > 0;
  const hasFailed = failedCount > 0;
  const allCompleted = completedCount === subagents.length;

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const getRoleIcon = (role?: string) => {
    const normalized = (role || '').toLowerCase();
    if (normalized.includes('research') || normalized.includes('search')) {
      return <Search size={12} />;
    }
    if (normalized.includes('code') || normalized.includes('dev')) {
      return <Code2 size={12} />;
    }
    return <Bot size={12} />;
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className={`${css.statusBadge} ${css.statusRunning}`}>
            <Loader2 size={10} className={css.spinner} />
            <span>运行中</span>
          </span>
        );
      case 'completed':
        return (
          <span className={`${css.statusBadge} ${css.statusCompleted}`}>
            <CheckCircle2 size={10} color="var(--dsw-static-green-500, #22c55e)" />
            <span>完成</span>
          </span>
        );
      case 'failed':
        return (
          <span className={`${css.statusBadge} ${css.statusFailed}`}>
            <AlertCircle size={10} color="var(--dsw-static-red-500, #ef4444)" />
            <span>失败</span>
          </span>
        );
      case 'queued':
      default:
        return (
          <span className={`${css.statusBadge} ${css.statusQueued}`}>
            <Clock size={10} color="var(--dsw-static-amber-500, #f59e0b)" />
            <span>排队</span>
          </span>
        );
    }
  };

  const focusedSub = focusedSubagentId ? subagentsMap[focusedSubagentId] : null;

  const handleFocus = (subId: string) => {
    setFocusedSubagentId(subId);
    setIsOpen(false);
  };

  const handleOpenAside = (subId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveSubagentAsideId(subId);
    setActiveRightbarTab('subagent');
    setRightbarCollapsed(false);
    setIsOpen(false);
  };

  const handleRestoreMain = () => {
    setFocusedSubagentId(null);
    setIsOpen(false);
  };

  return (
    <div className={css.container} ref={containerRef}>
      {/* 触发按钮 */}
      <button
        type="button"
        className={`${css.triggerBtn} ${isOpen ? css.triggerBtnActive : ''} ${
          focusedSubagentId ? css.triggerBtnFocused : ''
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title="查看子代理会话谱系树与聚焦切换"
      >
        <span
          className={`${css.statusDot} ${
            hasRunning
              ? css.dotRunning
              : hasFailed
              ? css.dotFailed
              : allCompleted
              ? css.dotCompleted
              : css.dotQueued
          }`}
        />

        <GitBranch size={13} />

        <span className={css.triggerText}>
          {subagents.length} 个子代理
          {hasRunning && (
            <span style={{ color: 'var(--dsw-static-green-500, #22c55e)', fontSize: 11 }}>
              ({runningCount} 运行中)
            </span>
          )}
        </span>

        {focusedSub && (
          <span className={css.focusedTag} title={`当前聚焦视角: ${focusedSub.id}`}>
            聚焦: {focusedSub.role || focusedSub.id}
          </span>
        )}

        <div className={`${css.chevron} ${isOpen ? css.chevronOpen : ''}`}>
          <ChevronDown size={13} />
        </div>
      </button>

      {/* 谱系下拉浮层 */}
      {isOpen && (
        <div className={css.dropdown} role="dialog" aria-label="子代理会话谱系">
          <div className={css.dropdownHeader}>
            <div className={css.dropdownTitle}>
              <GitBranch size={14} color="var(--dsw-static-deepseek-400, #7aaaff)" />
              <span>子代理会话谱系 (Subagent Lineage)</span>
            </div>
            <div className={css.dropdownCounter}>
              {completedCount}/{subagents.length} 完成
            </div>
          </div>

          <div className={css.treeList} role="tree">
            {subagents.map((sub) => {
              const isFocused = sub.id === focusedSubagentId;
              const durationText = formatDuration(sub.durationMs);
              const promptText = sub.spec?.description || sub.spec?.prompt;

              return (
                <div
                  key={sub.id}
                  className={`${css.treeItem} ${isFocused ? css.treeItemActive : ''}`}
                  role="treeitem"
                  aria-selected={isFocused}
                  onClick={() => handleFocus(sub.id)}
                  title={`点击聚焦中央视窗审阅 ${sub.id}`}
                >
                  <div className={css.treeItemRow}>
                    <div className={css.treeItemLeft}>
                      <span className={css.roleIcon}>{getRoleIcon(sub.role)}</span>
                      <span className={css.subId}>{sub.id}</span>
                      <span className={css.roleBadge}>{sub.role}</span>
                      {sub.account && (
                        <span className={css.accountBadge}>
                          <User size={9} />
                          {sub.account.includes('@') ? sub.account.split('@')[0] : sub.account}
                        </span>
                      )}
                      {isFocused && <span className={css.focusedPill}>当前聚焦</span>}
                    </div>

                    <div className={css.treeItemRight}>
                      {durationText && <span className={css.duration}>{durationText}</span>}
                      {renderStatusBadge(sub.status)}
                    </div>
                  </div>

                  {promptText && <div className={css.itemPrompt}>{promptText}</div>}

                  <div className={css.itemActions}>
                    <button
                      type="button"
                      className={`${css.actionBtn} ${isFocused ? css.actionBtnFocus : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFocus(sub.id);
                      }}
                      title="聚焦中央主视窗只读查看该子代理"
                    >
                      <Maximize2 size={11} />
                      <span>{isFocused ? '已在中央聚焦' : '中央聚焦'}</span>
                    </button>

                    <button
                      type="button"
                      className={css.actionBtn}
                      onClick={(e) => handleOpenAside(sub.id, e)}
                      title="在右侧抽屉栏比对打开"
                    >
                      <PanelRightOpen size={11} />
                      <span>在侧栏打开</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={css.dropdownFooter}>
            <span className={css.footerHint}>
              {focusedSubagentId ? '当前处于子代理审阅模式' : '主会话视角'}
            </span>
            <button
              type="button"
              className={css.restoreBtn}
              onClick={handleRestoreMain}
              title="退出子代理视角，返回主任务会话"
            >
              <ArrowLeft size={13} />
              <span>恢复主会话视角</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SubagentHeaderLineage;
