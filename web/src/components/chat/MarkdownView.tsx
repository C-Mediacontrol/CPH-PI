import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import css from './MarkdownView.module.css';

interface MarkdownViewProps {
  content: string;
}

function CodeBlockItem({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy code:', err);
    }
  };

  return (
    <div className={css.codeBlock}>
      <div className={css.codeHeader}>
        <span className={css.codeLang}>{lang || 'CODE'}</span>
        <button
          type="button"
          className={css.copyBtn}
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className={css.codePre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderFormattedLine(lineText: string, keyPrefix: string): React.ReactNode {
  // 简易行内解析：`code` 和 **bold**
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(lineText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(lineText.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`${keyPrefix}-code-${match.index}`} className={css.inlineCode}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < lineText.length) {
    parts.push(lineText.substring(lastIndex));
  }

  return parts;
}

export function MarkdownView({ content }: MarkdownViewProps): React.JSX.Element {
  if (!content) {
    return <div className={css.markdownBody} />;
  }

  // 按照代码块进行切片
  const segments: Array<{ type: 'code' | 'text'; content: string; lang?: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.substring(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'code',
      lang: match[1] || 'text',
      content: match[2].trimEnd(),
    });
    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.substring(lastIndex),
    });
  }

  return (
    <div className={css.markdownBody}>
      {segments.map((seg, sIdx) => {
        if (seg.type === 'code') {
          return (
            <CodeBlockItem
              key={`seg-code-${sIdx}`}
              code={seg.content}
              lang={seg.lang || 'text'}
            />
          );
        }

        // 处理普通文本段落
        const lines = seg.content.split('\n');
        return (
          <React.Fragment key={`seg-text-${sIdx}`}>
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              const lineKey = `line-${sIdx}-${lIdx}`;

              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lineKey} className={css.heading3}>
                    {renderFormattedLine(trimmed.slice(4), lineKey)}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h3 key={lineKey} className={css.heading2}>
                    {renderFormattedLine(trimmed.slice(3), lineKey)}
                  </h3>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h2 key={lineKey} className={css.heading1}>
                    {renderFormattedLine(trimmed.slice(2), lineKey)}
                  </h2>
                );
              }
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={lineKey} className={css.listItem}>
                    <span className={css.listBullet}>•</span>
                    <div>{renderFormattedLine(trimmed.slice(2), lineKey)}</div>
                  </div>
                );
              }
              if (!trimmed) {
                return <div key={lineKey} style={{ height: 6 }} />;
              }

              return (
                <p key={lineKey} className={css.paragraph}>
                  {renderFormattedLine(line, lineKey)}
                </p>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default MarkdownView;
