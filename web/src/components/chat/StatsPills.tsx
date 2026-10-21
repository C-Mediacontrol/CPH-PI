import React from 'react';
import { Clock, Cpu, Zap, Sparkles } from 'lucide-react';
import type { Turn } from '../../types/protocol';
import css from './StatsPills.module.css';

export interface StatsPillsProps {
  metrics?: Turn['metrics'];
}

export function StatsPills({ metrics }: StatsPillsProps): React.JSX.Element | null {
  if (!metrics) {
    return null;
  }

  const durationSec = (metrics.durationMs / 1000).toFixed(1);
  const totalTokens =
    metrics.tokensOut !== undefined || metrics.tokensIn !== undefined
      ? (metrics.tokensIn ?? 0) + (metrics.tokensOut ?? 0)
      : null;

  return (
    <div className={css.container}>
      <div className={css.pill} title="总耗时">
        <span className={css.icon}>
          <Clock size={12} />
        </span>
        <span>耗时 {durationSec}s</span>
      </div>

      {totalTokens !== null && (
        <div
          className={css.pill}
          title={
            metrics.tokensIn !== undefined && metrics.tokensOut !== undefined
              ? `输入: ${metrics.tokensIn} / 输出: ${metrics.tokensOut}`
              : `Token 消耗`
          }
        >
          <span className={css.icon}>
            <Cpu size={12} />
          </span>
          <span>{totalTokens.toLocaleString()} tokens</span>
        </div>
      )}

      {metrics.tps !== undefined && metrics.tps > 0 && (
        <div className={css.pill} title="生成速度">
          <span className={css.icon}>
            <Zap size={12} />
          </span>
          <span>{metrics.tps.toFixed(1)} tps</span>
        </div>
      )}

      <div className={`${css.pill} ${css.modelBadge}`} title="服务模型">
        <span className={css.icon}>
          <Sparkles size={12} />
        </span>
        <span>{metrics.model || 'Copilot M365'}</span>
      </div>
    </div>
  );
}

export default StatsPills;
