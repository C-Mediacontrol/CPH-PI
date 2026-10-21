import React, { useState, useMemo } from 'react';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Terminal,
  FileCode,
  Copy,
  Check,
} from 'lucide-react';
import type { ToolCall } from '../../types/protocol';
import css from './ToolCard.module.css';

export interface ToolCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
}

export function ToolCard({ tool, defaultExpanded }: ToolCardProps): React.JSX.Element {
  // 运行中或有输出时默认展开，除非显式指定
  const [expanded, setExpanded] = useState<boolean>(
    defaultExpanded !== undefined
      ? defaultExpanded
      : tool.status === 'running' || Boolean(tool.output || tool.diff)
  );
  const [copied, setCopied] = useState(false);

  const argsSummary = useMemo(() => {
    if (!tool.args || Object.keys(tool.args).length === 0) {
      return '';
    }
    // 特殊提取高频字段
    if (typeof tool.args.command === 'string') {
      return `$ ${tool.args.command}`;
    }
    if (typeof tool.args.path === 'string') {
      return tool.args.path;
    }
    if (typeof tool.args.filePath === 'string') {
      return tool.args.filePath;
    }
    if (typeof tool.args.query === 'string') {
      return `"${tool.args.query}"`;
    }

    try {
      return Object.entries(tool.args)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ');
    } catch {
      return JSON.stringify(tool.args);
    }
  }, [tool.args]);

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  const renderStatusIcon = () => {
    switch (tool.status) {
      case 'running':
        return <Loader2 className={css.spinner} size={14} />;
      case 'completed':
        return <CheckCircle2 size={14} color="var(--dsw-static-green-500, #22c55e)" />;
      case 'failed':
        return <AlertCircle size={14} color="var(--dsw-static-red-500, #ef4444)" />;
      default:
        return null;
    }
  };

  const renderDiff = (diffText: string) => {
    const lines = diffText.split('\n');
    return (
      <div className={css.diffContainer}>
        {lines.map((line, idx) => {
          let lineClass = css.diffContext;
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass = css.diffAdded;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass = css.diffDeleted;
          } else if (line.startsWith('@@')) {
            lineClass = css.diffMeta;
          }
          return (
            <div key={idx} className={`${css.diffLine} ${lineClass}`}>
              {line}
            </div>
          );
        })}
      </div>
    );
  };

  const formattedDuration = tool.durationMs
    ? tool.durationMs >= 1000
      ? `${(tool.durationMs / 1000).toFixed(1)}s`
      : `${tool.durationMs}ms`
    : null;

  return (
    <div className={css.card}>
      <button
        type="button"
        className={css.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        title={expanded ? '折叠工具执行' : '展开工具执行'}
      >
        <div className={css.headerLeft}>
          <div className={css.statusIcon}>{renderStatusIcon()}</div>
          <span className={css.toolTag}>{tool.name}</span>
          {argsSummary && <span className={css.argsPreview}>{argsSummary}</span>}
        </div>

        <div className={css.headerRight}>
          {formattedDuration && <span className={css.duration}>{formattedDuration}</span>}
          <div className={`${css.chevron} ${expanded ? css.chevronExpanded : ''}`}>
            <ChevronDown size={14} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className={css.body}>
          {tool.diff && (
            <div>
              <div className={css.terminalBar}>
                <span className={css.terminalTitle}>
                  <FileCode size={13} color="var(--dsw-static-deepseek-500, #4176e6)" />
                  代码变更 (Diff)
                </span>
                <button
                  type="button"
                  className={css.copyBtn}
                  onClick={(e) => copyToClipboard(tool.diff!, e)}
                  title="复制 Diff"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              {renderDiff(tool.diff)}
            </div>
          )}

          {tool.output && (
            <div>
              <div className={css.terminalBar}>
                <span className={css.terminalTitle}>
                  <Terminal size={13} color="var(--dsw-static-deepseek-500, #4176e6)" />
                  控制台输出
                </span>
                <button
                  type="button"
                  className={css.copyBtn}
                  onClick={(e) => copyToClipboard(tool.output!, e)}
                  title="复制输出"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className={css.outputPre}>{tool.output}</pre>
            </div>
          )}

          {!tool.diff && !tool.output && (
            <div className={css.emptyBody}>
              {tool.status === 'running' ? '命令正在执行中...' : '命令执行完毕，无文本输出'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolCard;
