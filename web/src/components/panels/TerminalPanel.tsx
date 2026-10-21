import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Terminal,
  Trash2,
  ArrowDownToLine,
  Copy,
  Check,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { TerminalLog } from '../../types/protocol';
import css from './TerminalPanel.module.css';

export function TerminalPanel(): React.JSX.Element {
  const { terminalLogs, clearTerminalLogs } = useAppStore();
  const [selectedStream, setSelectedStream] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    if (selectedStream === 'all') return terminalLogs;
    return terminalLogs.filter((log) => log.stream === selectedStream);
  }, [terminalLogs, selectedStream]);

  useEffect(() => {
    if (autoScroll && scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, autoScroll]);

  const copyLogs = () => {
    const fullText = filteredLogs
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.stream}] ${l.content}`)
      .join('\n');
    navigator.clipboard?.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleArea}>
          <span className={css.titleIcon}>
            <Terminal size={15} />
          </span>
          <span className={css.title}>实时终端输出</span>
        </div>

        <div className={css.actionsArea}>
          <button
            className={css.actionBtn}
            data-active={autoScroll}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? '已启用自动滚动' : '已暂停自动滚动'}
            type="button"
          >
            <ArrowDownToLine size={13} />
            <span style={{ fontSize: 10 }}>自动滚动</span>
          </button>

          <button
            className={css.actionBtn}
            onClick={copyLogs}
            title="复制终端日志"
            type="button"
          >
            {copied ? <Check size={13} color="var(--dsw-static-green-500)" /> : <Copy size={13} />}
          </button>

          <button
            className={css.actionBtn}
            onClick={clearTerminalLogs}
            title="清空终端"
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className={css.filterBar}>
        <div className={css.streamTabs}>
          {[
            { id: 'all', label: '全部' },
            { id: 'stdout', label: '标准输出' },
            { id: 'stderr', label: '错误流' },
            { id: 'system', label: '系统' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={css.streamTab}
              data-active={selectedStream === tab.id}
              onClick={() => setSelectedStream(tab.id as any)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className={css.logCount}>{filteredLogs.length} 条事件</span>
      </div>

      <div className={css.terminalBody}>
        {filteredLogs.length === 0 ? (
          <div className={css.emptyState}>
            <Terminal size={32} style={{ opacity: 0.3 }} />
            <span>暂无终端输出记录</span>
          </div>
        ) : (
          filteredLogs.map((log: TerminalLog) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            return (
              <div key={log.id} className={css.logRow}>
                <span className={css.logTimestamp}>[{timeStr}]</span>
                <span className={css.streamTag} data-stream={log.stream}>
                  {log.stream}
                </span>
                <span className={css.logContent} data-stream={log.stream}>
                  {log.content}
                </span>
              </div>
            );
          })
        )}
        <div ref={scrollEndRef} />
      </div>

      <div className={css.promptBar}>
        <span className={css.promptLabel}>cph-pi@dev:~/repo$</span>
        <span className={css.cursor} />
      </div>
    </div>
  );
}

export default TerminalPanel;
