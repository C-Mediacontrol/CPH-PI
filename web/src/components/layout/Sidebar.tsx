import React, { useMemo } from 'react';
import {
  Bot,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  Folder,
  ChevronDown,
  Users,
  Cpu,
  Sparkles,
  Cloud,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import css from './Sidebar.module.css';

export function Sidebar(): React.JSX.Element {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    sessions,
    activeSessionId,
    selectSession,
    createNewSession,
    workspaceRoot,
    cloudWorkspace,
    cloudSyncing,
    syncCloudWorkspace,
    setWorkspaceModalOpen,
    accounts,
    agentConfig,
    availableSkills,
    agentMountedSkills,
    setAccountModalOpen,
    setAgentModalOpen,
    setSkillModalOpen,
  } = useAppStore();

  const readyCount = useMemo(
    () => accounts.filter((a) => a.isAvailable && !a.isThrottled && a.isAllowed).length,
    [accounts]
  );
  const throttledCount = useMemo(() => accounts.filter((a) => a.isThrottled).length, [accounts]);
  const customAgentCount = useMemo(() => {
    let count = 0;
    if (agentConfig.customAgentId) count++;
    if (agentConfig.coderAgentId) count++;
    return count;
  }, [agentConfig]);

  const mountedSkillsCount = useMemo(() => {
    const set = new Set(agentMountedSkills.map((s) => s.toLowerCase().trim()));
    return availableSkills.filter((s) => set.has(s.name.toLowerCase())).length;
  }, [availableSkills, agentMountedSkills]);

  const workspaceName = useMemo(() => {
    if (!workspaceRoot) return '未选择工作区';
    const parts = workspaceRoot.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || workspaceRoot;
  }, [workspaceRoot]);

  return (
    <div className={css.sidebar} data-collapsed={sidebarCollapsed}>
      {/* 顶部标题栏与折叠按钮 */}
      <div className={css.header}>
        {!sidebarCollapsed && (
          <div className={css.logoRow}>
            <Bot size={18} color="var(--dsw-static-deepseek-500, #4176e6)" />
            <span>CPH-PI 智能体</span>
            <span className={css.logoBadge}>M365</span>
          </div>
        )}
        <button
          className={css.actionBtn}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          type="button"
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* 工作区选择与切换入口 */}
      {!sidebarCollapsed ? (
        <>
          <div
            className={css.workspaceRow}
            onClick={() => setWorkspaceModalOpen(true)}
            title={workspaceRoot ? `当前工作区: ${workspaceRoot} (点击切换)` : '点击选择工作区'}
            role="button"
            tabIndex={0}
          >
            <div className={css.workspaceIcon}>
              <Folder size={15} />
            </div>
            <div className={css.workspaceInfo}>
              <div className={css.workspaceNameRow}>
                <span className={css.workspaceName}>{workspaceName}</span>
                <ChevronDown size={13} className={css.workspaceChevron} />
              </div>
              <span className={css.workspacePath} title={workspaceRoot || '未选择工作区'}>
                {workspaceRoot || '点击选择工作区...'}
              </span>
            </div>
          </div>

          {/* 云端镜像 mini 状态与同步条 */}
          {cloudWorkspace ? (
            <div className={css.cloudMiniRow}>
              <div
                className={css.cloudMiniLeft}
                onClick={() => setWorkspaceModalOpen(true)}
                title={`SharePoint 云端镜像: ${cloudWorkspace.targetFolder}\n站点: ${cloudWorkspace.siteUrl}\n点击查看或修改`}
              >
                <span className={css.cloudMiniDot} />
                <Cloud size={12} className={css.cloudMiniIcon} />
                <span className={css.cloudMiniFolder}>{cloudWorkspace.targetFolder}</span>
              </div>
              <button
                className={css.cloudMiniSyncBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  syncCloudWorkspace();
                }}
                disabled={cloudSyncing}
                type="button"
                title="立即发起 SharePoint 云端增量对账同步"
              >
                <RefreshCw size={10} className={cloudSyncing ? css.spinning : undefined} />
                <span>{cloudSyncing ? '同步中' : '同步'}</span>
              </button>
            </div>
          ) : workspaceRoot ? (
            <div
              className={css.cloudMiniUnlinked}
              onClick={() => setWorkspaceModalOpen(true)}
              title="点击配置 SharePoint 云端工作区镜像"
            >
              <span className={css.cloudMiniUnlinkedDot} />
              <Cloud size={12} className={css.cloudMiniUnlinkedIcon} />
              <span>未配置云端镜像</span>
            </div>
          ) : null}
        </>
      ) : (
        <button
          className={css.railWorkspaceBtn}
          onClick={() => setWorkspaceModalOpen(true)}
          title={workspaceRoot ? `当前工作区: ${workspaceRoot} (点击切换)` : '点击选择工作区'}
          aria-label="切换工作区"
          type="button"
        >
          <Folder size={16} />
        </button>
      )}

      {/* 新建会话按钮 */}
      <button
        className={css.newChatBtn}
        onClick={createNewSession}
        title="新建会话"
        aria-label="新建会话"
        type="button"
      >
        <MessageSquarePlus size={16} />
        {!sidebarCollapsed && <span>新建会话</span>}
      </button>

      {/* 历史会话列表 */}
      <div className={css.sessionList}>
        {sessions.length === 0 && !sidebarCollapsed && (
          <div className={css.emptyHint}>暂无历史会话</div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={css.sessionItem}
            data-active={s.id === activeSessionId}
            onClick={() => selectSession(s.id)}
            title={s.title}
            type="button"
          >
            <MessageSquare size={15} />
            {!sidebarCollapsed && <span className={css.sessionTitle}>{s.title}</span>}
          </button>
        ))}
      </div>

      {/* 账号池与智能体快捷治理入口 */}
      {!sidebarCollapsed ? (
        <div className={css.managementSection}>
          <button
            className={css.manageBtn}
            onClick={() => setAccountModalOpen(true)}
            type="button"
            title="查看或配置 M365 账号池与限额状态"
          >
            <div className={css.manageBtnLeft}>
              <Users size={15} color="var(--dsw-static-deepseek-500, #4176e6)" />
              <span>账号池管理</span>
            </div>
            <span
              className={`${css.manageBtnBadge} ${
                throttledCount > 0
                  ? css.manageBtnBadgeWarning
                  : css.manageBtnBadgeSuccess
              }`}
            >
              {throttledCount > 0 ? `${throttledCount} 冷却中` : `${readyCount} 就绪`}
            </span>
          </button>

          <button
            className={css.manageBtn}
            onClick={() => setAgentModalOpen(true)}
            type="button"
            title="绑定与管理 Copilot 智能体 (Main / Coder / Researcher)"
          >
            <div className={css.manageBtnLeft}>
              <Cpu size={15} color="#10b981" />
              <span>智能体配置</span>
            </div>
            <span className={css.manageBtnBadge}>
              {customAgentCount > 0 ? `${customAgentCount} 自定义` : '默认'}
            </span>
          </button>

          <button
            className={css.manageBtn}
            onClick={() => setSkillModalOpen(true)}
            type="button"
            title="配置技能挂载模式与附件筛分 (Agent内置免附件 vs 动态随任务挂载)"
          >
            <div className={css.manageBtnLeft}>
              <Sparkles size={15} color="#8b5cf6" />
              <span>技能筛分配置</span>
            </div>
            <span className={css.manageBtnBadge}>
              {mountedSkillsCount > 0 ? `${mountedSkillsCount} 内置` : '动态挂载'}
            </span>
          </button>
        </div>
      ) : (
        <div className={css.managementSection}>
          <button
            className={css.railManageBtn}
            onClick={() => setAccountModalOpen(true)}
            type="button"
            title={`账号池管理: ${readyCount} 个就绪`}
          >
            <Users size={16} />
          </button>
          <button
            className={css.railManageBtn}
            onClick={() => setAgentModalOpen(true)}
            type="button"
            title="智能体编排与绑定"
          >
            <Cpu size={16} />
          </button>
          <button
            className={css.railManageBtn}
            onClick={() => setSkillModalOpen(true)}
            type="button"
            title={`技能挂载筛分: ${mountedSkillsCount} 个 Agent 内置`}
          >
            <Sparkles size={16} />
          </button>
        </div>
      )}

      {/* 底部版本标识 */}
      <div className={css.footer}>
        {!sidebarCollapsed && (
          <span className={css.footerText}>CPH-PI v0.1.0 · Copilot 控制核</span>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
