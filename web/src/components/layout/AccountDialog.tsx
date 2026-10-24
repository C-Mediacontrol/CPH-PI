import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../services/store';
import styles from './AccountDialog.module.css';
import {
  Users,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  KeyRound,
  Plus,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Loader2,
} from 'lucide-react';

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
    pkceAuthLoading,
    pkceSession,
    pkceResult,
    pkceError,
    startPkceAuth,
    completePkceAuth,
    clearPkceState,
  } = useAppStore();

  const [isPkceOpen, setIsPkceOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState('');
  const [redirectInput, setRedirectInput] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPkceOpen) {
          handleClosePkce();
        } else if (accountModalOpen) {
          setAccountModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [accountModalOpen, isPkceOpen, setAccountModalOpen]);

  if (!accountModalOpen) return null;

  const total = accounts.length;
  const readyCount = accounts.filter(
    (a) => a.isAvailable && !a.isThrottled && !a.authExpired && a.isAllowed
  ).length;
  const expiredCount = accounts.filter((a) => a.authExpired).length;
  const throttledCount = accounts.filter((a) => a.isThrottled && !a.authExpired).length;
  const hasWhitelist = allowedAccounts !== null && allowedAccounts.length > 0;

  const handleResetWhitelist = () => {
    setAccountWhitelist(null);
  };

  const handleOnlyReady = () => {
    const readyEmails = accounts
      .filter((a) => !a.isThrottled && !a.authExpired)
      .map((a) => a.email);
    setAccountWhitelist(readyEmails);
  };

  const handleStartPkce = (email?: string) => {
    setTargetEmail(email || '');
    setRedirectInput('');
    setCopied(false);
    clearPkceState();
    setIsPkceOpen(true);
    startPkceAuth(email);
  };

  const handleClosePkce = () => {
    setIsPkceOpen(false);
    setTargetEmail('');
    setRedirectInput('');
    setCopied(false);
    clearPkceState();
  };

  const handleCopyUrl = async () => {
    if (!pkceSession?.authUrl) return;
    try {
      await navigator.clipboard.writeText(pkceSession.authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板异常回退
    }
  };

  const handleOpenBrowser = () => {
    if (!pkceSession?.authUrl) return;
    window.open(pkceSession.authUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCompleteExchange = () => {
    const url = redirectInput.trim();
    if (!url) return;
    const expected = pkceSession?.targetEmail || targetEmail || undefined;
    completePkceAuth(url, pkceSession?.state, expected);
  };

  return (
    <>
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
              {expiredCount > 0 && (
                <span className={`${styles.statBadge} ${styles.statBadgeExpired}`}>
                  凭据已过期: {expiredCount}
                </span>
              )}
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
              <button
                className={styles.btnAddAccount}
                onClick={() => handleStartPkce()}
                title="发起 OAuth PKCE 授权流程以登录或添加 M365 账号"
              >
                <Plus size={13} />
                + OAuth 快捷登录 / 添加账号
              </button>
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
                title="仅允许当前未处于 429 冷却或凭据失效状态的账号"
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
                const isExpired = Boolean(account.authExpired);

                let cardClass = styles.accountCard;
                if (isExpired) {
                  cardClass += ` ${styles.accountCardExpired}`;
                } else if (!isAllowed) {
                  cardClass += ` ${styles.accountCardDisabled}`;
                } else if (isThrottled) {
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
                        {isExpired ? (
                          <span className={`${styles.statusTag} ${styles.tagAuthExpired}`}>
                            凭据已过期 (需重登)
                          </span>
                        ) : isThrottled ? (
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

                      {isExpired && account.authErrorReason && (
                        <div className={styles.authErrorRow}>
                          <AlertCircle size={12} className={styles.authErrorIcon} />
                          <span className={styles.authErrorText} title={account.authErrorReason}>
                            失效原因: {account.authErrorReason}
                          </span>
                        </div>
                      )}

                      <div className={styles.metaRow}>
                        <div className={styles.metaItem}>
                          <Clock size={12} />
                          累计请求: {account.totalRequests} 次
                        </div>
                        <div className={styles.metaItem}>
                          <AlertTriangle size={12} />
                          触发限额: {account.throttledCount} 次
                        </div>
                        {isExpired ? (
                          <div className={styles.metaItem} style={{ color: '#dc2626' }}>
                            <AlertCircle size={12} />
                            凭据已失效，请点击右侧重新授权
                          </div>
                        ) : account.isAvailable && isAllowed && !isThrottled ? (
                          <div className={styles.metaItem} style={{ color: '#059669' }}>
                            <CheckCircle2 size={12} />
                            支持多轮长任务
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.cardActions}>
                      {isExpired ? (
                        <button
                          className={styles.reauthBtn}
                          onClick={() => handleStartPkce(account.email)}
                          title="使用 OAuth PKCE 重新登录刷新凭据"
                        >
                          <KeyRound size={12} />
                          🔑 重新授权
                        </button>
                      ) : isThrottled ? (
                        <button
                          className={styles.resetBtn}
                          onClick={() => resetAccountCooldown(account.email)}
                          title="立即解除 429 冷却状态"
                        >
                          <RefreshCw size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                          重置冷却
                        </button>
                      ) : null}
                      <label className={styles.switch} title="点击切换账号启用状态">
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

      {/* 两步 PKCE 交互授权面板 */}
      {isPkceOpen && (
        <div className={styles.pkceBackdrop} onClick={handleClosePkce}>
          <div className={styles.pkceModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pkceHeader}>
              <div className={styles.pkceHeaderLeft}>
                <div className={styles.pkceIcon}>
                  <KeyRound size={18} />
                </div>
                <div>
                  <div className={styles.pkceTitle}>Microsoft 365 OAuth PKCE 快捷授权</div>
                  <div className={styles.pkceDesc}>
                    遵循 RFC 7636 安全授权码流程，生成官方凭据并安全落盘
                  </div>
                </div>
              </div>
              <button
                className={styles.closeBtn}
                onClick={handleClosePkce}
                title="关闭授权面板 (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.pkceBody}>
              {/* 目标账号提示 */}
              {(pkceSession?.targetEmail || targetEmail) && (
                <div className={styles.targetEmailBanner}>
                  <KeyRound size={14} style={{ flexShrink: 0 }} />
                  <span>
                    目标重新授权账号: <strong>{pkceSession?.targetEmail || targetEmail}</strong>
                    （请在浏览器登录时选择该账号）
                  </span>
                </div>
              )}

              {/* 错误提示条 */}
              {pkceError && (
                <div className={styles.errorBanner}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>凭据授权出现问题</div>
                    <div>{pkceError}</div>
                  </div>
                </div>
              )}

              {/* 换票结果展示 */}
              {pkceResult ? (
                pkceResult.emailMismatch ? (
                  <div className={styles.mismatchAlert}>
                    <div className={styles.alertTitleRow}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span className={styles.alertTitle}>账号错位提示</span>
                    </div>
                    <div className={styles.alertDesc}>
                      已成功更新账号 <strong>{pkceResult.email}</strong> 的凭据，但与原定目标账号 <strong>{pkceResult.expectedEmail}</strong> 不一致，原账号仍需单独授权。
                    </div>
                    <div className={styles.alertActions}>
                      {pkceResult.expectedEmail && (
                        <button
                          className={styles.btnSecondary}
                          onClick={() => handleStartPkce(pkceResult.expectedEmail)}
                        >
                          为 {pkceResult.expectedEmail} 重新授权
                        </button>
                      )}
                      <button className={styles.btnSuccessClose} onClick={handleClosePkce}>
                        确认并关闭
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.successAlert}>
                    <div className={styles.alertTitleRow}>
                      <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                      <span className={styles.alertTitle}>凭据换取与账号入池成功</span>
                    </div>
                    <div className={styles.alertDesc}>
                      账号 <strong>{pkceResult.email}</strong> 授权凭据已安全落盘并更新至账号池，即时就绪参与轮转调度。
                    </div>
                    <div className={styles.alertActions}>
                      <button className={styles.btnSuccessClose} onClick={handleClosePkce}>
                        完成
                      </button>
                    </div>
                  </div>
                )
              ) : pkceAuthLoading && !pkceSession ? (
                <div className={styles.pkceLoadingBox}>
                  <Loader2 size={24} className={styles.spin} />
                  <span>正在生成安全挑战码与微软官方授权链接...</span>
                </div>
              ) : (
                <>
                  {/* Step 1 */}
                  <div className={styles.pkceStepBox}>
                    <div className={styles.stepHeader}>
                      <div className={styles.stepNumber}>1</div>
                      <div className={styles.stepTitle}>访问微软官方登录链接</div>
                    </div>
                    <div className={styles.stepDesc}>
                      请在浏览器中打开以下链接，登录您的 Microsoft 365 组织或学校账号。建议使用隐私/无痕窗口以方便选择特定账号：
                    </div>
                    <div className={styles.urlContainer}>
                      <input
                        type="text"
                        readOnly
                        value={pkceSession?.authUrl || '正在准备授权链接...'}
                        className={styles.urlInput}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                    </div>
                    <div className={styles.stepBtnRow}>
                      <button
                        type="button"
                        className={styles.btnCopy}
                        onClick={handleCopyUrl}
                        disabled={!pkceSession?.authUrl}
                        title="复制授权链接到剪贴板"
                      >
                        {copied ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                        <span>{copied ? '已复制到剪贴板' : '复制链接'}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.btnOpenBrowser}
                        onClick={handleOpenBrowser}
                        disabled={!pkceSession?.authUrl}
                        title="在默认浏览器新标签页中打开"
                      >
                        <ExternalLink size={13} />
                        <span>在浏览器打开</span>
                      </button>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className={styles.pkceStepBox}>
                    <div className={styles.stepHeader}>
                      <div className={styles.stepNumber}>2</div>
                      <div className={styles.stepTitle}>粘贴重定向回调 URL 完成换票</div>
                    </div>
                    <div className={styles.stepDesc}>
                      完成登录后，浏览器将重定向至一个通常显示为空白页或无法访问的地址（形如 <code>https://login.microsoftonline.com/common/oauth2/nativeclient?code=...</code>）。请直接复制浏览器地址栏中的完整网址，粘贴至下方输入框：
                    </div>
                    <div className={styles.redirectInputWrapper}>
                      <input
                        type="text"
                        className={styles.redirectInput}
                        placeholder="https://login.microsoftonline.com/common/oauth2/nativeclient?code=..."
                        value={redirectInput}
                        onChange={(e) => setRedirectInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && redirectInput.trim() && !pkceAuthLoading) {
                            handleCompleteExchange();
                          }
                        }}
                      />
                    </div>
                    <div className={styles.stepBtnRow}>
                      <button
                        type="button"
                        className={styles.btnSubmitExchange}
                        onClick={handleCompleteExchange}
                        disabled={!redirectInput.trim() || pkceAuthLoading}
                      >
                        {pkceAuthLoading ? (
                          <>
                            <Loader2 size={13} className={styles.spin} />
                            <span>正在换取凭据并同步账号池...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={13} />
                            <span>完成凭据换票</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className={styles.pkceFooter}>
              <span className={styles.pkceFooterHint}>
                说明：换票成功后 Refresh Token 将自动加密保存至本地凭据管理中，支持长任务持续续期。
              </span>
              <button className={styles.btnSecondary} onClick={handleClosePkce}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
