import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../services/store';
import { wsClient } from '../../services/client-ws';
import styles from './SkillDialog.module.css';
import {
  Sparkles,
  X,
  Search,
  RotateCcw,
  CheckCircle2,
  Paperclip,
  Check,
} from 'lucide-react';

export const SkillDialog: React.FC = () => {
  const {
    availableSkills,
    agentMountedSkills,
    skillModalOpen,
    setSkillModalOpen,
    toggleSkillMounted,
    setAgentMountedSkills,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'mounted' | 'dynamic'>('all');

  useEffect(() => {
    if (skillModalOpen) {
      wsClient.send('skills:list');
    }
  }, [skillModalOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && skillModalOpen) {
        setSkillModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [skillModalOpen, setSkillModalOpen]);

  // Set of lowercase mounted names for fast lookup
  const mountedSet = useMemo(() => {
    return new Set(agentMountedSkills.map((s) => s.toLowerCase().trim()));
  }, [agentMountedSkills]);

  // Filter skills by search query and active tab
  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return availableSkills.filter((s) => {
      const isMounted = mountedSet.has(s.name.toLowerCase());
      if (activeTab === 'mounted' && !isMounted) return false;
      if (activeTab === 'dynamic' && isMounted) return false;

      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    });
  }, [availableSkills, mountedSet, searchQuery, activeTab]);

  const mountedCount = useMemo(() => {
    return availableSkills.filter((s) => mountedSet.has(s.name.toLowerCase())).length;
  }, [availableSkills, mountedSet]);

  const dynamicCount = Math.max(0, availableSkills.length - mountedCount);

  if (!skillModalOpen) return null;

  const handleResetDefaults = () => {
    setAgentMountedSkills(['handoff', 'subagent']);
  };

  return (
    <div className={styles.backdrop} onClick={() => setSkillModalOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Sparkles size={18} />
            </div>
            <div>
              <div className={styles.headerTitle}>技能挂载与附件筛分配置</div>
              <div className={styles.headerDesc}>
                筛分哪些技能已预置于 Agent 知识库（免附件轻量唤醒），哪些技能随任务动态挂载附件
              </div>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setSkillModalOpen(false)}
            title="关闭 (Esc)"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className={styles.toolbar}>
          <div className={styles.searchRow}>
            <div className={styles.searchInputWrapper}>
              <Search size={14} className={styles.searchIcon} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="搜索技能名称或描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              className={styles.resetBtn}
              onClick={handleResetDefaults}
              title="恢复为系统推荐内置技能: handoff, subagent"
              type="button"
            >
              <RotateCcw size={13} />
              <span>恢复默认</span>
            </button>
          </div>

          <div className={styles.filterTabsRow}>
            <div className={styles.filterTabs}>
              <button
                type="button"
                className={`${styles.filterTab} ${
                  activeTab === 'all' ? styles.filterTabActive : ''
                }`}
                onClick={() => setActiveTab('all')}
              >
                全部 ({availableSkills.length})
              </button>
              <button
                type="button"
                className={`${styles.filterTab} ${
                  activeTab === 'mounted' ? styles.filterTabActive : ''
                }`}
                onClick={() => setActiveTab('mounted')}
              >
                Agent 内置 ({mountedCount})
              </button>
              <button
                type="button"
                className={`${styles.filterTab} ${
                  activeTab === 'dynamic' ? styles.filterTabActive : ''
                }`}
                onClick={() => setActiveTab('dynamic')}
              >
                动态挂载 ({dynamicCount})
              </button>
            </div>
            <div className={styles.statsText}>
              已内置免传: {mountedCount} 个 · 随任务附件: {dynamicCount} 个
            </div>
          </div>
        </div>

        {/* Body / Skill Cards List */}
        <div className={styles.body}>
          {filteredSkills.length === 0 ? (
            <div className={styles.emptyState}>
              <Sparkles size={24} style={{ opacity: 0.4 }} />
              <div>未找到匹配的工程技能</div>
            </div>
          ) : (
            filteredSkills.map((skill) => {
              const isMounted = mountedSet.has(skill.name.toLowerCase());
              return (
                <div
                  key={skill.name}
                  className={`${styles.skillCard} ${
                    isMounted ? styles.skillCardMounted : ''
                  }`}
                >
                  <div className={styles.skillInfo}>
                    <div className={styles.skillTitleRow}>
                      <span className={styles.skillName}>{skill.name}</span>
                      {isMounted ? (
                        <span className={styles.badgeMounted}>
                          <CheckCircle2 size={11} />
                          <span>Agent 内置 (免附件)</span>
                        </span>
                      ) : (
                        <span className={styles.badgeDynamic}>
                          <Paperclip size={11} />
                          <span>随任务挂载 (全量附件)</span>
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <div className={styles.skillDesc} title={skill.description}>
                        {skill.description}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${
                      isMounted ? styles.toggleBtnToDynamic : styles.toggleBtnToMounted
                    }`}
                    onClick={() => toggleSkillMounted(skill.name)}
                    title={
                      isMounted
                        ? '切换为动态随任务挂载模式 (随任务下发附件或注入正文)'
                        : '切换为 Agent 内置模式 (已上传知识库，无需上传附件)'
                    }
                  >
                    {isMounted ? (
                      <>
                        <RotateCcw size={12} />
                        <span>改为动态附件</span>
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        <span>设为内置免传</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerNote}>
            💡 <strong>免附件治理准则</strong>：已在 Copilot Studio 智能体上传知识库的技能（如 handoff、subagent）开启【内置】后，对话首轮将直接唤醒规范，单次节省 4000+ Tokens 并杜绝 WAF 截断。
          </div>
          <button
            type="button"
            className={styles.footerCloseBtn}
            onClick={() => setSkillModalOpen(false)}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};

export default SkillDialog;
