import React, { useState, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  X,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  History,
  ShieldCheck,
  Cloud,
  Sparkles,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import css from './WorkspaceDialog.module.css';

export function WorkspaceDialog(): React.JSX.Element | null {
  const {
    workspaceModalOpen,
    setWorkspaceModalOpen,
    workspaceRoot,
    cloudWorkspace,
    cloudVerifyState,
    verifyCloudWorkspace,
    clearCloudVerifyState,
    recentWorkspaces,
    setWorkspaceRoot,
    workspaceError,
    clearWorkspaceError,
  } = useAppStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [inputPath, setInputPath] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [targetFolder, setTargetFolder] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (workspaceModalOpen) {
      setStep(1);
      setInputPath(workspaceRoot || '');
      setSiteUrl(
        cloudWorkspace?.siteUrl ||
          'https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN'
      );
      setTargetFolder(
        cloudWorkspace?.targetFolder || '/Shared Documents/workspace-mirror'
      );
      clearWorkspaceError();
      clearCloudVerifyState();
    }
  }, [
    workspaceModalOpen,
    workspaceRoot,
    cloudWorkspace,
    clearWorkspaceError,
    clearCloudVerifyState,
  ]);

  if (!workspaceModalOpen) {
    return null;
  }

  const handleCopyCurrent = () => {
    if (!workspaceRoot) return;
    navigator.clipboard?.writeText(workspaceRoot);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleOpenWithoutCloud = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setWorkspaceRoot(trimmed, null);
    setWorkspaceModalOpen(false);
  };

  const handleCompleteWithCloud = () => {
    const trimmedPath = inputPath.trim();
    const trimmedSite = siteUrl.trim();
    const trimmedFolder = targetFolder.trim();
    if (!trimmedPath || !trimmedSite || !trimmedFolder) return;

    setWorkspaceRoot(trimmedPath, {
      siteUrl: trimmedSite,
      targetFolder: trimmedFolder,
      verified: true,
    });
    setWorkspaceModalOpen(false);
  };

  const handleVerify = () => {
    if (!siteUrl.trim() || !targetFolder.trim()) return;
    verifyCloudWorkspace({
      siteUrl: siteUrl.trim(),
      targetFolder: targetFolder.trim(),
      workspaceRoot: inputPath.trim(),
    });
  };

  const isRemembered = Boolean(
    cloudWorkspace?.siteUrl &&
      cloudWorkspace?.targetFolder &&
      inputPath.trim() === (workspaceRoot || '')
  );

  const isVerifyFailed = cloudVerifyState.result?.valid === false;
  const isVerifySuccess = cloudVerifyState.result?.valid === true;

  return (
    <div
      className={css.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setWorkspaceModalOpen(false);
        }
      }}
    >
      <div className={css.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div className={css.header}>
          <div className={css.headerLeft}>
            <div className={css.headerIcon}>
              {step === 1 ? <FolderOpen size={18} /> : <Cloud size={18} />}
            </div>
            <span className={css.headerTitle}>
              {step === 1 ? '选择工作区 (Workspace)' : '配置 SharePoint 云端镜像'}
            </span>
          </div>

          <button
            type="button"
            className={css.closeBtn}
            onClick={() => setWorkspaceModalOpen(false)}
            title="关闭窗口"
            aria-label="关闭窗口"
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-Stage Wizard Step Indicator */}
        <div className={css.stepsBar}>
          <div
            className={`${css.stepChip} ${step === 1 ? css.stepChipActive : ''}`}
            onClick={() => setStep(1)}
            style={{ cursor: 'pointer' }}
          >
            <span className={css.stepNumber}>1</span>
            <span>本地路径选择</span>
          </div>
          <div className={css.stepDivider} />
          <div
            className={`${css.stepChip} ${step === 2 ? css.stepChipActive : ''}`}
            onClick={() => {
              if (inputPath.trim()) setStep(2);
            }}
            style={{ cursor: inputPath.trim() ? 'pointer' : 'default' }}
          >
            <span className={css.stepNumber}>2</span>
            <span>SharePoint 镜像</span>
          </div>
        </div>

        {/* Body */}
        <div className={css.body}>
          {step === 1 ? (
            /* STEP 1: 本地工作区路径选择 */
            <>
              {/* 当前活跃工作区展示 */}
              <div className={css.section}>
                <span className={css.sectionLabel}>
                  <Folder size={14} color="var(--dsw-static-deepseek-500)" />
                  当前活跃工作区
                </span>
                <div className={css.currentCard}>
                  <span className={css.currentPath}>
                    {workspaceRoot || '未选择工作区 (点击下方指定)'}
                  </span>
                  {workspaceRoot && (
                    <button
                      type="button"
                      className={css.copyBtn}
                      onClick={handleCopyCurrent}
                      title="复制路径"
                    >
                      {copied ? (
                        <>
                          <Check size={12} color="var(--dsw-static-green-500)" />
                          <span>已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>复制</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* 路径输入 */}
              <div className={css.section}>
                <span className={css.sectionLabel}>输入本地工作区绝对路径</span>
                <div className={css.inputRow}>
                  <input
                    type="text"
                    className={css.pathInput}
                    placeholder="例如: E:\projects\my-app 或 C:\workspace"
                    value={inputPath}
                    onChange={(e) => {
                      setInputPath(e.target.value);
                      if (workspaceError) clearWorkspaceError();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && inputPath.trim()) {
                        setStep(2);
                      } else if (e.key === 'Escape') {
                        setWorkspaceModalOpen(false);
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>

              {/* 错误提示框 */}
              {workspaceError && (
                <div className={css.errorAlert}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{workspaceError}</span>
                </div>
              )}

              {/* 最近访问工作区 */}
              {recentWorkspaces && recentWorkspaces.length > 0 && (
                <div className={css.section}>
                  <span className={css.sectionLabel}>
                    <History size={13} />
                    最近工作区
                  </span>
                  <div className={css.recentList}>
                    {recentWorkspaces.map((path) => {
                      const isCurrent = path === workspaceRoot;
                      return (
                        <button
                          key={path}
                          type="button"
                          className={css.recentItem}
                          data-current={isCurrent}
                          onClick={() => {
                            setInputPath(path);
                            setStep(2);
                          }}
                          title={`选择并配置镜像: ${path}`}
                        >
                          <span>{path}</span>
                          {isCurrent && (
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--dsw-static-deepseek-500)',
                              }}
                            >
                              当前
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 1 底部操作按钮 */}
              <div className={css.modalActions}>
                <button
                  type="button"
                  className={css.btnGhost}
                  disabled={!inputPath.trim()}
                  onClick={() => handleOpenWithoutCloud(inputPath)}
                  title="仅挂载本地目录，不启用云端备份镜像"
                >
                  直接打开 (跳过云端)
                </button>

                <div className={css.actionGroupRight}>
                  <button
                    type="button"
                    className={css.btnPrimary}
                    disabled={!inputPath.trim()}
                    onClick={() => setStep(2)}
                  >
                    <span>下一步: 配置云端镜像</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* STEP 2: SharePoint 云端镜像配置 */
            <>
              {/* 本地路径摘要 */}
              <div className={css.summaryCard}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--dsw-alias-label-secondary)',
                      display: 'block',
                      marginBottom: 2,
                    }}
                  >
                    已选本地工作区:
                  </span>
                  <span className={css.summaryPath}>{inputPath}</span>
                </div>
                <button
                  type="button"
                  className={css.btnGhost}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setStep(1)}
                >
                  修改
                </button>
              </div>

              {/* 已记忆配置徽章 */}
              {isRemembered && (
                <div className={css.badgeRemembered}>
                  <Sparkles size={14} />
                  <span>已记忆此本地工作区的云端仓库配置，无需重新输入</span>
                </div>
              )}

              {/* SharePoint Site URL */}
              <div className={css.formGroup}>
                <label className={css.fieldLabel}>
                  <Cloud size={13} color="var(--dsw-static-deepseek-500)" />
                  SharePoint 站点 URL (Site URL)
                </label>
                <input
                  type="text"
                  className={css.fieldInput}
                  value={siteUrl}
                  placeholder="https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
                  onChange={(e) => setSiteUrl(e.target.value)}
                />
              </div>

              {/* Target Folder */}
              <div className={css.formGroup}>
                <label className={css.fieldLabel}>
                  <FolderOpen size={13} color="var(--dsw-static-deepseek-500)" />
                  云端镜像目标目录 (Target Folder)
                </label>
                <input
                  type="text"
                  className={css.fieldInput}
                  value={targetFolder}
                  placeholder="/Shared Documents/workspace-mirror"
                  onChange={(e) => setTargetFolder(e.target.value)}
                />
              </div>

              {/* 校验区 */}
              <div className={css.verifySection}>
                <button
                  type="button"
                  className={css.verifyBtn}
                  onClick={handleVerify}
                  disabled={
                    cloudVerifyState.loading ||
                    !siteUrl.trim() ||
                    !targetFolder.trim()
                  }
                >
                  {cloudVerifyState.loading ? (
                    <>
                      <Loader2 size={13} className={css.spinner} />
                      <span>正在校验云端镜像连通性...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={13} />
                      <span>测试校验云端镜像 (Verify)</span>
                    </>
                  )}
                </button>

                {isVerifySuccess && (
                  <div className={css.verifySuccessAlert}>
                    <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                    <span>
                      校验通过，可安全挂载 (
                      {cloudVerifyState.result?.reason || '云端目录已对账就绪'})
                    </span>
                  </div>
                )}

                {isVerifyFailed && (
                  <div className={css.verifyErrorAlert}>
                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>云端镜像校验未通过:</div>
                      <div>{cloudVerifyState.result?.reason}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2 底部操作按钮 */}
              <div className={css.modalActions}>
                <button
                  type="button"
                  className={css.btnSecondary}
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft size={14} />
                  <span>上一步</span>
                </button>

                <div className={css.actionGroupRight}>
                  <button
                    type="button"
                    className={css.btnGhost}
                    onClick={() => handleOpenWithoutCloud(inputPath)}
                    title="仅挂载本地目录，跳过云端"
                  >
                    跳过云端挂载
                  </button>

                  <button
                    type="button"
                    className={css.btnPrimary}
                    disabled={
                      isVerifyFailed ||
                      !siteUrl.trim() ||
                      !targetFolder.trim() ||
                      cloudVerifyState.loading
                    }
                    onClick={handleCompleteWithCloud}
                    title={
                      isVerifyFailed
                        ? '校验未通过，请检查云端配置或选择跳过'
                        : '完成配置并安全挂载'
                    }
                  >
                    <Check size={14} />
                    <span>完成并挂载</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer Note */}
        <div className={css.footer}>
          <ShieldCheck size={14} color="var(--dsw-static-deepseek-500)" />
          <span>
            AGENTS.md 准则 7 & 8：本地单一真实源 (SSOT) 对账与云端 93 天可恢复删除全权兜底。
          </span>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDialog;
