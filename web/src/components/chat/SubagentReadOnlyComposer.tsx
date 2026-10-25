import React from 'react';
import { ShieldAlert, ArrowLeft, Lock } from 'lucide-react';
import { useAppStore } from '../../services/store';
import css from './SubagentReadOnlyComposer.module.css';

export interface SubagentReadOnlyComposerProps {
  onBack?: () => void;
}

export function SubagentReadOnlyComposer({
  onBack,
}: SubagentReadOnlyComposerProps): React.JSX.Element | null {
  const { focusedSubagentId, subagentsMap, setFocusedSubagentId } = useAppStore();

  if (!focusedSubagentId) {
    return null;
  }

  const sub = subagentsMap[focusedSubagentId];
  const roleText = sub?.role || '子代理';

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      setFocusedSubagentId(null);
    }
  };

  return (
    <div className={css.container}>
      <div className={css.bannerCard}>
        <div className={css.bannerLeft}>
          <div className={css.iconWrap}>
            <ShieldAlert size={20} />
          </div>

          <div className={css.textBlock}>
            <div className={css.titleRow}>
              <strong className={css.titleText}>子代理独立视图 (只读模式)</strong>
              <span className={css.lockTag}>
                <Lock size={10} />
                锁定输入
              </span>
            </div>

            <div className={css.desc}>
              <span>
                当前正在单机审阅 <span className={css.subagentRole}>{roleText}</span> (
                <span className={css.subagentRef}>{focusedSubagentId}</span>) 的独立执行流与思考链。主会话正在等待汇总...
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={css.backBtn}
          onClick={handleBack}
          title="退出当前子代理聚焦视图，返回主任务对话"
        >
          <ArrowLeft size={15} />
          <span>返回主会话</span>
        </button>
      </div>
    </div>
  );
}

export default SubagentReadOnlyComposer;
