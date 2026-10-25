import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../services/store';
import styles from './AgentDialog.module.css';
import { Bot, X, Check, RotateCcw, Cpu, Code2, Plus, Trash2 } from 'lucide-react';

export const AgentDialog: React.FC = () => {
  const {
    agentConfig,
    agentModalOpen,
    setAgentModalOpen,
    setAgentId,
    resetAgentId,
    addCustomAgent,
    removeCustomAgent,
  } = useAppStore();

  const [mainInput, setMainInput] = useState('');
  const [coderInput, setCoderInput] = useState('');

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [newRole, setNewRole] = useState<'main' | 'coder' | 'custom'>('custom');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    setMainInput(agentConfig.customAgentId || '');
    setCoderInput(agentConfig.coderAgentId || '');
  }, [agentConfig]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && agentModalOpen) {
        setAgentModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [agentModalOpen, setAgentModalOpen]);

  if (!agentModalOpen) return null;

  const handleSave = (role: 'main' | 'coder') => {
    const val = role === 'main' ? mainInput : coderInput;
    setAgentId(role, val.trim() || undefined);
  };

  const handleReset = (role: 'main' | 'coder') => {
    resetAgentId(role);
    if (role === 'main') setMainInput('');
    if (role === 'coder') setCoderInput('');
  };

  const handleResetAll = () => {
    resetAgentId('all');
    setMainInput('');
    setCoderInput('');
  };

  const handleAddCustom = () => {
    if (!newName.trim() || !newAgentId.trim()) return;
    addCustomAgent({
      name: newName.trim(),
      agentId: newAgentId.trim(),
      role: newRole,
      description: newDesc.trim() || undefined,
    });
    setNewName('');
    setNewAgentId('');
    setNewDesc('');
    setIsAdding(false);
  };

  return (
    <div className={styles.backdrop} onClick={() => setAgentModalOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Bot size={18} />
            </div>
            <div>
              <div className={styles.headerTitle}>Copilot 智能体编排与绑定</div>
              <div className={styles.headerDesc}>
                配置 Main 调度中枢与专项 Coder 的 Copilot Studio 智能体 ID
              </div>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setAgentModalOpen(false)}
            title="关闭 (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Main Agent Card */}
          <div className={styles.agentCard}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardTitleRow}>
                  <Cpu size={16} color="#4176e6" />
                  <span className={styles.cardTitle}>主协调智能体 (Main Agent)</span>
                  {agentConfig.customAgentId ? (
                    <span className={styles.badgeCustom}>自定义绑定</span>
                  ) : (
                    <span className={styles.badgeDefault}>通用/官方默认</span>
                  )}
                </div>
                <div className={styles.cardDesc}>
                  负责全局架构拆解、有向无环图 (plan.md) 物理立桩、两阶段调度与终局报告对账。
                </div>
              </div>
            </div>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                placeholder="输入 Copilot Agent ID 或分享链接 (留空恢复默认)"
                value={mainInput}
                onChange={(e) => setMainInput(e.target.value)}
              />
              <button
                className={styles.btnPrimary}
                onClick={() => handleSave('main')}
              >
                <Check size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                保存
              </button>
              {agentConfig.customAgentId && (
                <button
                  className={styles.btnSecondary}
                  onClick={() => handleReset('main')}
                  title="恢复为官方默认 ID"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
            <div className={styles.defaultHint}>
              默认: {agentConfig.defaultMain}
            </div>
          </div>

          {/* Coder Agent Card */}
          <div className={styles.agentCard}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardTitleRow}>
                  <Code2 size={16} color="#10b981" />
                  <span className={styles.cardTitle}>代码实施智能体 (Coder Agent)</span>
                  {agentConfig.coderAgentId ? (
                    <span className={styles.badgeCustom}>自定义绑定</span>
                  ) : (
                    <span className={styles.badgeDefault}>官方默认</span>
                  )}
                </div>
                <div className={styles.cardDesc}>
                  负责具体业务模块的外科手术级精准补丁（patch_file）、TDD 驱动实施与自动化单测。
                </div>
              </div>
            </div>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                placeholder="输入 Coder Agent ID (留空恢复默认)"
                value={coderInput}
                onChange={(e) => setCoderInput(e.target.value)}
              />
              <button
                className={styles.btnPrimary}
                onClick={() => handleSave('coder')}
              >
                <Check size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                保存
              </button>
              {agentConfig.coderAgentId && (
                <button
                  className={styles.btnSecondary}
                  onClick={() => handleReset('coder')}
                  title="恢复为官方默认 ID"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
            <div className={styles.defaultHint}>
              默认: {agentConfig.defaultCoder}
            </div>
          </div>

          {/* Custom Agents Section */}
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              自定义与扩展智能体池 ({agentConfig.customAgents?.length || 0})
            </div>
            {!isAdding && (
              <button
                className={styles.btnSecondary}
                onClick={() => setIsAdding(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Plus size={14} />
                添加智能体
              </button>
            )}
          </div>

          {/* Inline Add Custom Agent Form */}
          {isAdding && (
            <div className={styles.formCard}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                新增自定义 Copilot 智能体
              </div>
              <div className={styles.formRow}>
                <input
                  className={styles.input}
                  placeholder="智能体名称 (如: 安全代码审查员)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ flex: 2 }}
                />
                <select
                  className={styles.select}
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  style={{ flex: 1 }}
                >
                  <option value="custom">通用 (Custom)</option>
                  <option value="coder">代码实施 (Coder)</option>
                  <option value="main">主协调 (Coordinator)</option>
                </select>
              </div>
              <input
                className={styles.input}
                placeholder="智能体 ID 或 URL (Copilot Studio 分享链接)"
                value={newAgentId}
                onChange={(e) => setNewAgentId(e.target.value)}
              />
              <input
                className={styles.input}
                placeholder="简要功能描述与职责说明 (可选)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => {
                    setIsAdding(false);
                    setNewName('');
                    setNewAgentId('');
                    setNewDesc('');
                  }}
                >
                  取消
                </button>
                <button
                  className={styles.btnPrimary}
                  onClick={handleAddCustom}
                  disabled={!newName.trim() || !newAgentId.trim()}
                  style={{ opacity: !newName.trim() || !newAgentId.trim() ? 0.6 : 1 }}
                >
                  <Check size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  确认添加
                </button>
              </div>
            </div>
          )}

          {/* Custom Agents List */}
          {agentConfig.customAgents && agentConfig.customAgents.length > 0 && (
            <div className={styles.customList}>
              {agentConfig.customAgents.map((agent) => (
                <div key={agent.id} className={styles.customCard}>
                  <div className={styles.customCardLeft}>
                    <div className={styles.customCardHeader}>
                      <span className={styles.customName}>{agent.name}</span>
                      <span className={styles.badgeCustom}>{agent.role}</span>
                    </div>
                    <div className={styles.customId}>{agent.agentId}</div>
                    {agent.description && (
                      <div className={styles.customDesc}>{agent.description}</div>
                    )}
                  </div>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => removeCustomAgent(agent.id)}
                    title="删除此智能体"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.btnSecondary}
            onClick={handleResetAll}
            title="将智能体全部恢复为默认官方 Agent ID"
          >
            一键全部恢复默认
          </button>
          <button
            className={styles.btnPrimary}
            onClick={() => setAgentModalOpen(false)}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
