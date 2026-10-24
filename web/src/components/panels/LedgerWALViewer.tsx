import React, { useState, useMemo, useEffect } from 'react';
import {
  ScrollText,
  HardDrive,
  Copy,
  Check,
  Terminal,
  FileCode,
  Eye,
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { LedgerEntry } from '../../types/protocol';
import { LazyViewportItem } from '../common/LazyViewportItem';
import css from './LedgerWALViewer.module.css';

export function LedgerWALViewer(): React.JSX.Element {
  const { ledgerEntries } = useAppStore();
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(35);

  useEffect(() => {
    setVisibleCount(35);
  }, [filterText, statusFilter]);

  const copyToClipboard = (text: string, key: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  };

  const filteredEntries = useMemo(() => {
    return ledgerEntries.filter((entry) => {
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'success'
          ? entry.exitCode === 0
          : entry.exitCode !== 0;

      if (!matchStatus) return false;

      if (!filterText.trim()) return true;
      const lower = filterText.toLowerCase();
      return (
        entry.toolName.toLowerCase().includes(lower) ||
        entry.argsHash.toLowerCase().includes(lower) ||
        (entry.evidencePath && entry.evidencePath.toLowerCase().includes(lower))
      );
    });
  }, [ledgerEntries, statusFilter, filterText]);

  const displayedEntries = filteredEntries.slice(0, visibleCount);

  const metrics = useMemo(() => {
    const total = ledgerEntries.length;
    const successes = ledgerEntries.filter((e) => e.exitCode === 0).length;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 100;
    const totalMs = ledgerEntries.reduce((acc, curr) => acc + (curr.durationMs || 0), 0);
    return { total, rate, totalMs };
  }, [ledgerEntries]);

  const getToolIcon = (name: string) => {
    switch (name.toLowerCase()) {
      case 'bash':
      case 'terminal':
      case 'sh':
        return <Terminal size={13} />;
      case 'patch_file':
      case 'write_file':
      case 'edit':
        return <FileCode size={13} />;
      case 'read_file':
      case 'view_file':
        return <Eye size={13} />;
      case 'git_status':
      case 'git':
        return <GitBranch size={13} />;
      default:
        return <Terminal size={13} />;
    }
  };

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleRow}>
          <div className={css.titleArea}>
            <span className={css.titleIcon}>
              <ScrollText size={16} />
            </span>
            <span className={css.title}>物理执行账本 (WAL)</span>
          </div>
          <div className={css.liveBadge}>
            <span className={css.pulseDot} />
            <span>零 Token 证据持久化</span>
          </div>
        </div>

        <div className={css.pathRow}>
          <div className={css.walPath} title="底层预写日志 (Write-Ahead Log)">
            <HardDrive size={12} />
            <span>.cph/state/ledger.wal</span>
          </div>
          <span className={css.rule7Badge}>AGENTS.md 准则 7</span>
        </div>
      </div>

      <div className={css.metricsBar}>
        <div className={css.metricItem}>
          <span className={css.metricLabel}>总执行步数</span>
          <span className={css.metricValue}>{metrics.total}</span>
        </div>
        <div className={css.metricItem}>
          <span className={css.metricLabel}>成功率</span>
          <span className={css.metricValue} style={{ color: 'var(--dsw-static-green-500, #15803d)' }}>
            {metrics.rate}%
          </span>
        </div>
        <div className={css.metricItem}>
          <span className={css.metricLabel}>总耗时</span>
          <span className={css.metricValue}>{metrics.totalMs}ms</span>
        </div>
      </div>

      <div className={css.filterBar}>
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--dsw-alias-label-caption)' }} />
          <input
            type="text"
            className={css.searchInput}
            style={{ paddingLeft: 26 }}
            placeholder="过滤工具名称、哈希或证据路径..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
        <div className={css.statusFilter}>
          <button
            className={css.filterBtn}
            data-active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            type="button"
          >
            全部
          </button>
          <button
            className={css.filterBtn}
            data-active={statusFilter === 'success'}
            onClick={() => setStatusFilter('success')}
            type="button"
          >
            成功 (0)
          </button>
          <button
            className={css.filterBtn}
            data-active={statusFilter === 'failure'}
            onClick={() => setStatusFilter('failure')}
            type="button"
          >
            异常 (Err)
          </button>
        </div>
      </div>

      <div className={css.entriesList}>
        {filteredEntries.length === 0 ? (
          <div className={css.emptyState}>
            <ScrollText size={36} className={css.emptyIcon} />
            <div className={css.emptyTitle}>暂无账本记录</div>
            <div className={css.emptyDesc}>
              底层工具执行事实将自动追加写入磁盘预写日志（<code>.cph/state/</code>），不占用大模型工作内存上下文 Token。
            </div>
          </div>
        ) : (
          <>
            {displayedEntries.map((entry: LedgerEntry) => {
              const isExpanded = expandedId === entry.stepId;
              const isSuccess = entry.exitCode === 0;
              const timeStr = new Date(entry.timestamp).toLocaleTimeString();

              return (
                <LazyViewportItem
                  key={entry.stepId}
                  fallbackHeight={isExpanded ? 160 : 54}
                  forceActive={isExpanded}
                >
                  <div
                    className={css.entryCard}
                    data-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : entry.stepId)}
                  >
                    <div className={css.entryTop}>
                      <div className={css.stepBadgeArea}>
                        <span className={css.stepNum}>#{String(entry.stepId).padStart(2, '0')}</span>
                        <span className={css.toolTag}>
                          {getToolIcon(entry.toolName)}
                          <span>{entry.toolName}</span>
                        </span>
                      </div>

                      <span className={`${css.exitCode} ${isSuccess ? css.exitSuccess : css.exitFailure}`}>
                        {isSuccess ? <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 3 }} /> : <XCircle size={11} style={{ display: 'inline', marginRight: 3 }} />}
                        exit {entry.exitCode}
                      </span>
                    </div>

                    <div className={css.entryMetaRow}>
                      <span className={css.metaItem}>
                        <Clock size={11} />
                        {entry.durationMs}ms
                      </span>
                      <span>•</span>
                      <span>{timeStr}</span>
                      <span>•</span>
                      <span className={css.hashBadge} title={`参数哈希: ${entry.argsHash}`}>
                        {entry.argsHash.slice(0, 15)}...
                      </span>
                      <button
                        className={css.copyBtn}
                        onClick={(e) => copyToClipboard(entry.argsHash, `hash-${entry.stepId}`, e)}
                        title="复制完整参数哈希"
                        type="button"
                      >
                        {copiedKey === `hash-${entry.stepId}` ? <Check size={11} color="var(--dsw-static-green-500)" /> : <Copy size={11} />}
                      </button>
                    </div>

                    {entry.evidencePath && (
                      <div className={css.evidenceRow}>
                        <span className={css.evidencePath} title={entry.evidencePath}>
                          <HardDrive size={11} />
                          <span>{entry.evidencePath}</span>
                        </span>
                        <button
                          className={css.copyBtn}
                          onClick={(e) => copyToClipboard(entry.evidencePath!, `ev-${entry.stepId}`, e)}
                          title="复制证据落盘路径"
                          type="button"
                        >
                          {copiedKey === `ev-${entry.stepId}` ? <Check size={11} color="var(--dsw-static-green-500)" /> : <Copy size={11} />}
                        </button>
                      </div>
                    )}

                    {isExpanded && (
                      <div className={css.expandedDetail}>
                        <div className={css.detailRow}>
                          <span className={css.detailLabel}>步数序号:</span>
                          <span className={css.detailValue}>第 #{entry.stepId} 步 (单调递增)</span>
                        </div>
                        <div className={css.detailRow}>
                          <span className={css.detailLabel}>记录时间戳:</span>
                          <span className={css.detailValue}>{new Date(entry.timestamp).toISOString()}</span>
                        </div>
                        <div className={css.detailRow}>
                          <span className={css.detailLabel}>参数 SHA-256:</span>
                          <span className={css.detailValue} style={{ wordBreak: 'break-all' }}>
                            {entry.argsHash}
                          </span>
                        </div>
                        <div className={css.detailRow}>
                          <span className={css.detailLabel}>执行状态:</span>
                          <span
                            className={css.detailValue}
                            style={{ color: isSuccess ? 'var(--dsw-static-green-500, #15803d)' : 'var(--dsw-static-red-500, #b91c1c)' }}
                          >
                            {isSuccess ? '执行成功 (Exit Code 0)' : `执行失败 (Exit Code ${entry.exitCode})`}
                          </span>
                        </div>

                        <div className={css.ruleNotice}>
                          <strong>正交分层持久化：</strong> 工具事实与证据物理落盘至{' '}
                          <code>.cph/state/</code>，严格保障模型上下文不被长日志污染。
                        </div>
                      </div>
                    )}
                  </div>
                </LazyViewportItem>
              );
            })}
            {visibleCount < filteredEntries.length && (
              <div className={css.loadMoreContainer}>
                <button
                  type="button"
                  className={css.loadMoreBtn}
                  onClick={() => setVisibleCount((prev) => prev + 35)}
                >
                  加载更多记录 (已展示 {displayedEntries.length} / {filteredEntries.length}，剩余 {filteredEntries.length - displayedEntries.length} 项)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default LedgerWALViewer;
