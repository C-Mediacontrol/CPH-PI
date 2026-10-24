import React, { useState, useMemo } from 'react';
import clsx from 'clsx';
import css from './LazyTextCollapse.module.css';

export interface LazyTextCollapseProps {
  text: string;
  maxLines?: number;
  maxChars?: number;
  className?: string;
  preClassName?: string;
  copyable?: boolean;
  defaultExpanded?: boolean;
  children?: ((displayText: string, isExpanded: boolean) => React.ReactNode) | React.ReactNode;
}

/**
 * 视口超长文本智能截断组件
 * 当行数或字符数超过预设阈值时截断并提供展开/收起切换
 * 复制操作始终保证原始文本的完整保真度 (Rule 9)
 */
export function LazyTextCollapse({
  text,
  maxLines = 35,
  maxChars = 1800,
  className,
  preClassName,
  copyable = true,
  defaultExpanded = false,
  children,
}: LazyTextCollapseProps): React.JSX.Element | null {
  if (!text) {
    return null;
  }

  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [copied, setCopied] = useState<boolean>(false);

  const lines = useMemo(() => text.split('\n'), [text]);
  const isOverLines = lines.length > maxLines;
  const isOverChars = text.length > maxChars;
  const shouldTruncate = isOverLines || isOverChars;
  const remainingLines = Math.max(0, lines.length - maxLines);

  const displayText = useMemo(() => {
    if (!shouldTruncate || isExpanded) {
      return text;
    }
    if (isOverLines) {
      const sliced = lines.slice(0, maxLines).join('\n');
      if (sliced.length > maxChars) {
        return sliced.slice(0, maxChars) + '\n...';
      }
      return sliced;
    }
    return text.slice(0, maxChars) + '\n...';
  }, [text, lines, isOverLines, shouldTruncate, isExpanded, maxLines, maxChars]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  const renderContent = () => {
    if (typeof children === 'function') {
      return children(displayText, isExpanded);
    }
    if (children) {
      return children;
    }
    return <pre className={clsx(css.pre, preClassName)}>{displayText}</pre>;
  };

  if (!shouldTruncate) {
    return <div className={clsx(css.container, className)}>{renderContent()}</div>;
  }

  return (
    <div className={clsx(css.container, className)}>
      {renderContent()}
      <div className={css.actionBar}>
        <button
          type="button"
          className={css.toggleBtn}
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
        >
          <span>
            {isExpanded
              ? '▲ 收起完整输出'
              : remainingLines > 0
              ? `▼ 展开全部输出 (剩余 ${remainingLines} 行)`
              : '▼ 展开全部输出'}
          </span>
        </button>
        {copyable && (
          <button
            type="button"
            className={css.copyBtn}
            onClick={handleCopy}
            title="复制全部"
            aria-label="复制全部"
          >
            <span>{copied ? '已复制全部' : '📄 复制全部'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default LazyTextCollapse;
