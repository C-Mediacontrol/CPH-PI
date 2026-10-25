import React, { useState } from 'react';
import {
  RotateCw,
  FileText,
  ShieldCheck,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import type { SessionHandoffPayload } from '../../types/protocol';
import css from './HandoffAnchorCard.module.css';

export interface HandoffAnchorCardProps {
  handoff: SessionHandoffPayload;
  onDismiss?: () => void;
}

export function HandoffAnchorCard({
  handoff,
  onDismiss,
}: HandoffAnchorCardProps): React.JSX.Element {
  const [copiedPath, setCopiedPath] = useState(false);
  const [memoExpanded, setMemoExpanded] = useState(true);

  const prevGeneration = handoff.generation > 1 ? handoff.generation - 1 : 1;
  const docBasename = handoff.handoffDocPath
    ? handoff.handoffDocPath.replace(/^.*[\\/]/, '')
    : '';

  const handleCopyPath = () => {
    if (handoff.handoffDocPath) {
      navigator.clipboard.writeText(handoff.handoffDocPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  return (
    <div className={css.card} role="region" aria-label="会话阶段接力桩">
      {/* 顶部标题栏 */}
      <div className={css.header}>
        <div className={css.headerLeft}>
          <div className={css.iconWrap}>
            <RotateCw size={15} />
          </div>
          <span className={css.title}>
            🔄 会话安全阶段接力桩 (Handoff Milestone Anchor)
          </span>
          <span className={css.generationBadge}>
            代际跃迁: Gen {prevGeneration} ➔ Gen {handoff.generation}
          </span>
        </div>

        <div className={css.headerRight}>
          {onDismiss && (
            <button
              type="button"
              className={css.dismissBtn}
              onClick={onDismiss}
              title="关闭提示"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 主体内容 */}
      <div className={css.body}>
        {/* 交接文档卡片 */}
        {handoff.handoffDocPath && (
          <div className={css.docRow}>
            <span className={css.docLabel}>交接文档:</span>
            <div
              className={css.docChip}
              title={handoff.handoffDocPath}
            >
              <FileText size={14} />
              <span className={css.docChipName}>{docBasename}</span>
              <span className={css.docChipPath}>({handoff.handoffDocPath})</span>
            </div>
            <button
              type="button"
              className={css.copyBtn}
              onClick={handleCopyPath}
              title="复制文档绝对路径"
            >
              {copiedPath ? (
                <>
                  <Check size={12} color="var(--dsw-static-green-400, #4ed17e)" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>复制路径</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* 可折叠备忘录摘要 */}
        {handoff.memoSnippet && (
          <div className={css.memoBlock}>
            <button
              type="button"
              className={css.memoToggle}
              onClick={() => setMemoExpanded(!memoExpanded)}
              aria-expanded={memoExpanded}
            >
              <div className={css.memoToggleLeft}>
                {memoExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className={css.memoTitle}>【交接备忘录摘要】</span>
              </div>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {memoExpanded ? '收起' : '展开'}
              </span>
            </button>
            {memoExpanded && (
              <div className={css.memoContent}>{handoff.memoSnippet}</div>
            )}
          </div>
        )}

        {/* 状态落盘通知条 */}
        <div className={css.noticeBanner}>
          <ShieldCheck size={16} className={css.noticeIcon} />
          <span>
            会话状态与产物已落盘至预写日志与磁盘快照。新一轮会话已自动就绪，下一条指令将自动挂载前序成果！
          </span>
        </div>
      </div>
    </div>
  );
}

export default HandoffAnchorCard;
