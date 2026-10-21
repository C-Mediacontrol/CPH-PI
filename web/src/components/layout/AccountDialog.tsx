import React, { useEffect } from 'react';
import { useAppStore } from '../../services/store';
import styles from './AccountDialog.module.css';
import { Users, X, RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

/**
 * Format seconds into human readable duration (e.g. Xh Ym Zs when > 60s)
 */
function formatRemaining(totalSec: number): string {
  if (totalSec <= 0) return '0s';
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export const AccountDialog: React.FC = () => {
  const {
    accounts,
    allowedAccounts,
    accountModalOpen,
    setAccountModalOpen,
    toggleAccount,
    setAccountWhitelist,
    resetAccountCooldown,
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && accountModalOpen) {
        setAccountModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [accountModalOpen, setAccountModalOpen]);

  if (!accountModalOpen) return null;

  const total = accounts.length;
  const readyCount = accounts.filter((a) => a.isAvailable && !a.isThrottled && a.isAllowed).length;
  const throttledCount = accounts.filter((a) => a.isThrottled).length;
  const hasWhitelist = allowedAccounts !== null && allowedAccounts.length > 0;

  const handleResetWhitelist = () => {
    setAccountWhitelist(null);
  };

  const handleOnlyReady = () => {
    const readyEmails = accounts.filter((a) => !a.isThrottled).map((a) => a.email);
    setAccountWhitelist(readyEmails);
  };

  return (
    <div className={styles.backdrop} onClick={() => setAccountModalOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Users size={18} />
            </div>
            <div>
              <div className={styles.headerTitle}>M365 账号池与限额治理</div>
              <div className={styles.headerDesc}>
                底层智能多账号负载均衡与 429 自动熔断冷却（支持单会话租约保障）
              </div>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setAccountModalOpen(false)}
            title="关闭 (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.statsRow}>
            <span className={styles.statBadge}>总账号: {total}</span>
            <span className={`${styles.statBadge} ${styles.statBadgeReady}`}>
              就绪: {readyCount}
            </span>
            {throttledCount > 0 && (
              <span className={`${styles.statBadge} ${styles.statBadgeThrottled}`}>
                限频冷却: {throttledCount}
              </span>
            )}
            {hasWhitelist && (
              <span className={styles.statBadge} style={{ background: '#fef3c7', color: '#92400e' }}>
                已启用白名单 ({allowedAccounts?.length} 个)
              </span>
            )}
          </div>
          <div className={styles.actionsGroup}>
            {hasWhitelist && (
              <button
                className={styles.btnSecondary}
                onClick={handleResetWhitelist}
                title="清除白名单限制，让所有可用账号参与轮转"
              >
                恢复全量轮转
              </button>
            )}
            <button
              className={styles.btnSecondary}
              onClick={handleOnlyReady}
              title="仅允许当前未处于 429 冷却状态的账号"
            >
              仅启用就绪账号
            </button>
          </div>
        </div>

        <div className={styles.contentList}>
          {accounts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: '13px' }}>
              正在加载本地账号池状态...
            </div>
          ) : (
            accounts.map((account) => {
              const isAllowed = account.isAllowed;
              const isThrottled = account.isThrottled;
              const isLeased = account.isLeased;

              let cardClass = styles.accountCard;
              if (!isAllowed) cardClass += ` ${styles.accountCardDisabled}`;
              else if (isThrottled) {
                if (account.throttleReason === 'daily') {
                  cardClass += ` ${styles.accountCardDaily}`;
                } else if (account.throttleReason === 'burst') {
                  cardClass += ` ${styles.accountCardBurst}`;
                } else {
                  cardClass += ` ${styles.accountCardThrottled}`;
                }
              }

              return (
                <div key={account.email} className={cardClass}>
                  <div className={styles.accountInfo}>
                    <div className={styles.accountEmailRow}>
                      <span className={styles.accountEmail}>{account.email}</span>
                      {isThrottled ? (
                        account.throttleReason === 'daily' ? (
                          <span className={`${styles.statusTag} ${styles.tagDailyLimit}`}>
                            每日上限 (次日 00:00 UTC / 08:00 北京时间重置) · 剩余 {formatRemaining(account.cooldownRemainingSec)}
                          </span>
                        ) : account.throttleReason === 'burst' ? (
                          <span className={`${styles.statusTag} ${styles.tagBurstLimit}`}>
                            并发频控 (阶梯退避中) · 剩余 {account.cooldownRemainingSec}s
                          </span>
                        ) : (
                          <span className={`${styles.statusTag} ${styles.tagThrottled}`}>
                            429 限流冷却中 ({account.cooldownRemainingSec}s)
                          </span>
                        )
                      ) : isLeased ? (
                        <span className={`${styles.statusTag} ${styles.tagLeased}`}>
                          租约独占中 ({account.leasedBy || '任务进行中'})
                        </span>
                      ) : isAllowed ? (
                        <span className={`${styles.statusTag} ${styles.tagReady}`}>
                          就绪可用
                        </span>
                      ) : (
                        <span className={`${styles.statusTag} ${styles.tagSkipped}`}>
                          已跳过 (白名单外)
                        </span>
                      )}
                    </div>
                    <div className={styles.metaRow}>
                      <div className={styles.metaItem}>
                        <Clock size={12} />
                        累计请求: {account.totalRequests} 次
                      </div>
                      <div className={styles.metaItem}>
                        <AlertTriangle size={12} />
                        触发限额: {account.throttledCount} 次
                      </div>
                      {account.isAvailable && isAllowed && !isThrottled && (
                        <div className={styles.metaItem} style={{ color: '#059669' }}>
                          <CheckCircle2 size={12} />
                          支持多轮长任务
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={styles.cardActions}>
                    {isThrottled && (
                      <button
                        className={styles.resetBtn}
                        onClick={() => resetAccountCooldown(account.email)}
                        title="立即解除 429 冷却状态"
                      >
                        <RefreshCw size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                        重置冷却
                      </button>
                    )}
                    <label className={styles.switch} title={isAllowed ? '点击停用' : '点击启用'}>
                      <input
                        type="checkbox"
                        checked={isAllowed}
                        onChange={(e) => toggleAccount(account.email, e.target.checked)}
                      />
                      <span className={styles.slider} />
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <div>提示：更改即时生效并同步至工作区配置，账号配额由微软云端实时动态下发。</div>
          <button
            className={styles.btnSecondary}
            onClick={() => setAccountModalOpen(false)}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
