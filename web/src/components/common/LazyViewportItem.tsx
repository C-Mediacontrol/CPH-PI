import React, { useRef } from 'react';
import clsx from 'clsx';
import { useIntersectionObserver } from '../../hooks/useIntersectionObserver';
import css from './LazyViewportItem.module.css';

export interface LazyViewportItemProps {
  children: React.ReactNode;
  fallbackHeight?: number | string;
  className?: string;
  forceActive?: boolean;
}

/**
 * 视口懒挂载容器组件
 * 结合 CSS content-visibility 与 useIntersectionObserver 视口检测
 * 处于可视区或 forceActive 时挂载完整子组件树；离屏时渲染轻量占位骨架
 */
export function LazyViewportItem({
  children,
  fallbackHeight = 120,
  className,
  forceActive = false,
}: LazyViewportItemProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisible = useIntersectionObserver(containerRef, {
    rootMargin: '250px 0px',
    disabled: forceActive,
  });

  const formattedHeight =
    typeof fallbackHeight === 'number' ? `${fallbackHeight}px` : fallbackHeight;

  const containerStyle: React.CSSProperties = {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${formattedHeight}`,
  };

  const shouldRenderChildren = forceActive || isVisible;

  return (
    <div
      ref={containerRef}
      className={clsx(css.lazyItem, className)}
      style={containerStyle}
    >
      {shouldRenderChildren ? (
        children
      ) : (
        <div
          className={css.lazyPlaceholder}
          style={{ height: formattedHeight, minHeight: formattedHeight }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
