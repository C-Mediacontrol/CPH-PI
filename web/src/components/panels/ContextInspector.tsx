import React, { useState } from 'react';
import {
  Cpu,
  Sparkles,
  Layers,
  FileText,
  Copy,
  Check,
  ShieldCheck,
  BookOpen,
  Terminal,
  SlidersHorizontal,
} from 'lucide-react';
import { useAppStore } from '../../services/store';
import css from './ContextInspector.module.css';

export function ContextInspector(): React.JSX.Element {
  const { contextMetrics, agentMountedSkills, setSkillModalOpen } = useAppStore();
  const [copiedTOC, setCopiedTOC] = useState(false);

  const mountedSet = new Set(agentMountedSkills.map((s) => s.toLowerCase().trim()));

  const used = contextMetrics.usedTokens || 0;
  const max = contextMetrics.maxTokens || 128000;
  const pct = Math.min(100, Math.max(0, Math.round((used / max) * 1000) / 10));

  // Determine progress bar color based on usage
  const progressColor =
    pct > 80
      ? 'var(--dsw-static-red-500, #ef4444)'
      : pct > 60
      ? 'var(--dsw-static-amber-500, #f59e0b)'
      : 'var(--dsw-static-deepseek-400, #7aaaff)';

  const copyTOC = () => {
    const text = contextMetrics.fingerprintTOC.join('\n');
    navigator.clipboard?.writeText(text);
    setCopiedTOC(true);
    setTimeout(() => setCopiedTOC(false), 1500);
  };

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleRow}>
          <div className={css.titleArea}>
            <span className={css.titleIcon}>
              <Cpu size={16} />
            </span>
            <span className={css.title}>上下文探针</span>
          </div>
          <span className={css.modelBadge}>Copilot Substrate</span>
        </div>
        <div className={css.subtitle}>工作内存与物理持久化解耦监控 (AGENTS.md 准则 7)</div>
      </div>

      <div className={css.body}>
        {/* Working Memory Token Budget */}
        <div className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.cardTitle}>
              <Layers size={14} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
              <span>工作内存预算</span>
            </div>
            <span className={css.tokenPercent}>{pct}%</span>
          </div>

          <div className={css.tokenMetrics}>
            <span className={css.tokenValues}>{used.toLocaleString()} tokens</span>
            <span className={css.tokenLimit}>/ {max.toLocaleString()} 上限</span>
          </div>

          <div className={css.progressBarTrack}>
            <div
              className={css.progressBarFill}
              style={{
                width: `${pct}%`,
                background: progressColor,
              }}
            />
          </div>

          <div className={css.breakdownGrid}>
            <div className={css.breakdownItem}>
              <span className={css.breakdownLabel}>系统设定与技能</span>
              <span className={css.breakdownValue}>~4.2k tokens</span>
            </div>
            <div className={css.breakdownItem}>
              <span className={css.breakdownLabel}>TOC 物理指纹</span>
              <span className={css.breakdownValue}>~1.4k tokens</span>
            </div>
            <div className={css.breakdownItem}>
              <span className={css.breakdownLabel}>多轮交互工作内存</span>
              <span className={css.breakdownValue}>~{(Math.max(0, used - 5600)).toLocaleString()} tokens</span>
            </div>
            <div className={css.breakdownItem}>
              <span className={css.breakdownLabel}>剩余可用窗口</span>
              <span className={css.breakdownValue}>~{(Math.max(0, max - used)).toLocaleString()} tokens</span>
            </div>
          </div>
        </div>

        {/* Active Agent Identity */}
        <div className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.cardTitle}>
              <Sparkles size={14} style={{ color: '#d97706' }} />
              <span>当前活跃智能体</span>
            </div>
          </div>

          <div className={css.agentCardRow}>
            <span className={css.agentId}>{contextMetrics.activeAgent || 'cph-dev-agent'}</span>
            <span className={css.agentStatus}>工作内存活跃</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #475569)' }}>
            在物理工作区内自主执行，通过确凿的工具执行反馈形成严密工程闭环。
          </div>
        </div>

        {/* Active Skills Inventory */}
        <div className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.cardTitle}>
              <BookOpen size={14} style={{ color: '#16a34a' }} />
              <span>已挂载技能清单 ({contextMetrics.activeSkills.length})</span>
            </div>
            <button
              className={css.configSkillsBtn}
              onClick={() => setSkillModalOpen(true)}
              title="配置技能挂载模式与附件筛分"
              type="button"
            >
              <SlidersHorizontal size={11} />
              <span>筛分配置</span>
            </button>
          </div>

          <div className={css.skillsContainer}>
            {contextMetrics.activeSkills.map((skill) => {
              const isMounted = mountedSet.has(skill.toLowerCase());
              return (
                <span
                  key={skill}
                  className={`${css.skillChip} ${isMounted ? css.skillChipMounted : ''}`}
                  title={
                    isMounted
                      ? `已在 Agent 知识库内置 (免附件轻量唤醒): ${skill}`
                      : `动态随任务挂载 (全量附件注入): ${skill}`
                  }
                  onClick={() => setSkillModalOpen(true)}
                  style={{ cursor: 'pointer' }}
                >
                  <ShieldCheck
                    size={11}
                    style={{
                      color: isMounted
                        ? 'var(--dsw-static-deepseek-500, #4176e6)'
                        : '#16a34a',
                    }}
                  />
                  <span>{skill}</span>
                  <span
                    className={
                      isMounted ? css.chipModeBadgeMounted : css.chipModeBadgeDynamic
                    }
                  >
                    {isMounted ? '内置' : '动态'}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Prompt Fingerprint TOC */}
        <div className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.cardTitle}>
              <FileText size={14} style={{ color: 'var(--dsw-static-deepseek-500, #4176e6)' }} />
              <span>物理文件指纹 TOC (传引用挂载)</span>
            </div>
            <button
              className={css.copyBtn}
              onClick={copyTOC}
              title="复制文件指纹 TOC"
              type="button"
            >
              {copiedTOC ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
            </button>
          </div>

          <div className={css.tocList}>
            {contextMetrics.fingerprintTOC.map((filePath) => (
              <div key={filePath} className={css.tocItem}>
                <span className={css.tocPath} title={filePath}>
                  {filePath}
                </span>
                <span className={css.refBadge}>引用挂载</span>
              </div>
            ))}
          </div>
        </div>

        {/* Architectural Principle Callout */}
        <div className={css.rule7Explainer}>
          <div className={css.explainerTitle}>
            <Terminal size={12} />
            <span>准则 7：状态持久化与工作内存正交解耦</span>
          </div>
          <div className={css.explainerText}>
            大语言模型工作内存专注于维持高信噪比决策，严禁向上下文倾倒全量日志与长文件。物理执行证据与工具产物由底座安全持久化至 <code>.cph/state/</code>。
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContextInspector;
