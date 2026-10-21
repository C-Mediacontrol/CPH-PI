import React from 'react';
import { Files, Terminal, GitCompare, ScrollText, Cpu, PanelRightClose } from 'lucide-react';
import { useAppStore } from '../../services/store';
import type { RightbarTab } from '../../types/protocol';
import css from './Rightbar.module.css';

export interface RightbarProps {
  children?: React.ReactNode;
}

export function Rightbar({ children }: RightbarProps): React.JSX.Element {
  const { activeRightbarTab, setActiveRightbarTab, setRightbarCollapsed } = useAppStore();

  const tabs: Array<{ id: RightbarTab; label: string; icon: React.ReactNode }> = [
    { id: 'files', label: '工作区文件', icon: <Files size={14} /> },
    { id: 'terminal', label: '实时终端', icon: <Terminal size={14} /> },
    { id: 'diff', label: '差异审查', icon: <GitCompare size={14} /> },
    { id: 'ledger', label: '执行账本 (WAL)', icon: <ScrollText size={14} /> },
    { id: 'context', label: '上下文探针', icon: <Cpu size={14} /> },
  ];

  return (
    <div className={css.rightbar}>
      <div className={css.tabStrip}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={css.tabBtn}
            data-active={activeRightbarTab === t.id}
            onClick={() => setActiveRightbarTab(t.id)}
            type="button"
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <div className={css.tabSpacer} />
        <button
          className={css.collapseBtn}
          onClick={() => setRightbarCollapsed(true)}
          title="折叠右侧面板"
          aria-label="折叠右侧面板"
          type="button"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className={css.content}>
        {children || (
          <div style={{ padding: 16, color: 'var(--dsw-alias-label-secondary, #64748b)', fontSize: 13 }}>
            当前面板暂无内容 ({activeRightbarTab})
          </div>
        )}
      </div>
    </div>
  );
}

export default Rightbar;
