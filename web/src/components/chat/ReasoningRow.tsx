import React, { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import css from './ReasoningRow.module.css';

export interface ReasoningRowProps {
  text?: string;
  isStreaming?: boolean;
  durationMs?: number;
  defaultExpanded?: boolean;
}

export function ReasoningRow({
  text = '',
  isStreaming = false,
  durationMs,
  defaultExpanded,
}: ReasoningRowProps): React.JSX.Element | null {
  // 默认流式时展开，或者由用户自定。若未显式指定，流式开始时默认展开
  const [expanded, setExpanded] = useState<boolean>(
    defaultExpanded !== undefined ? defaultExpanded : Boolean(isStreaming || text)
  );

  // 如果没有内容且非流式状态，不渲染
  if (!text && !isStreaming) {
    return null;
  }

  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : null;

  return (
    <div className={css.container}>
      <button
        type="button"
        className={css.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        title={expanded ? '折叠思考过程' : '展开思考过程'}
      >
        <div className={css.headerLeft}>
          <div className={css.iconWrap}>
            <Brain size={15} />
          </div>
          <div className={css.titleText}>
            {isStreaming ? (
              <span className="text-shimmer-deep-diving">深度思考中...</span>
            ) : (
              <span className={css.completedTitle}>
                已深度思考
                {durationSec && (
                  <span className={css.durationBadge}>({durationSec}s)</span>
                )}
              </span>
            )}
          </div>
        </div>

        <div className={css.headerRight}>
          <div className={`${css.chevron} ${expanded ? css.chevronExpanded : ''}`}>
            <ChevronDown size={15} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className={css.body}>
          <div className={css.thoughtBox}>
            <pre className={css.thoughtText}>
              {text}
              {isStreaming && <span className={css.cursorShimmer} />}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReasoningRow;
