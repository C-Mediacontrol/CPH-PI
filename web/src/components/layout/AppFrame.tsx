import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../services/store';
import css from './AppFrame.module.css';

export interface AppFrameProps {
  sidebar: React.ReactNode;
  center: React.ReactNode;
  rightbar: React.ReactNode;
}

export function AppFrame({ sidebar, center, rightbar }: AppFrameProps): React.JSX.Element {
  const { sidebarCollapsed, rightbarCollapsed } = useAppStore();
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightbarWidth, setRightbarWidth] = useState(420);
  const [dragging, setDragging] = useState<'sidebar' | 'rightbar' | null>(null);

  const startDrag = useCallback(
    (side: 'sidebar' | 'rightbar', e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const targetElement = e.currentTarget;
      const pointerId = e.pointerId;

      try {
        targetElement.setPointerCapture(pointerId);
      } catch {
        // Fallback gracefully if pointer capture is unsupported
      }

      setDragging(side);
      const startX = e.clientX;
      const initialWidth = side === 'sidebar' ? sidebarWidth : rightbarWidth;

      const onPointerMove = (moveEvt: PointerEvent) => {
        const dx = moveEvt.clientX - startX;
        if (side === 'sidebar') {
          const next = Math.max(180, Math.min(initialWidth + dx, 400));
          setSidebarWidth(next);
        } else {
          const next = Math.max(300, Math.min(initialWidth - dx, 750));
          setRightbarWidth(next);
        }
      };

      const cleanup = () => {
        setDragging(null);
        try {
          if (targetElement.hasPointerCapture(pointerId)) {
            targetElement.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore release errors
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    },
    [sidebarWidth, rightbarWidth]
  );

  const activeSidebarW = sidebarCollapsed ? 56 : sidebarWidth;
  const activeRightbarW = rightbarCollapsed ? 0 : rightbarWidth;

  const frameStyle = {
    '--sidebar-w': `${activeSidebarW}px`,
    '--rightbar-w': `${activeRightbarW}px`,
  } as React.CSSProperties;

  return (
    <div
      className={css.frame}
      data-dragging={dragging !== null}
      style={frameStyle}
    >
      <aside className={css.sidebarCol}>{sidebar}</aside>

      {!sidebarCollapsed && (
        <div
          className={`${css.handle} ${css.handleLeft}`}
          data-active={dragging === 'sidebar'}
          onPointerDown={(e) => startDrag('sidebar', e)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Sidebar resize handle"
        />
      )}

      <main className={css.centerCol}>{center}</main>

      {!rightbarCollapsed && (
        <div
          className={`${css.handle} ${css.handleRight}`}
          data-active={dragging === 'rightbar'}
          onPointerDown={(e) => startDrag('rightbar', e)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Rightbar resize handle"
        />
      )}

      <aside className={css.rightbarCol} data-collapsed={rightbarCollapsed}>
        {rightbar}
      </aside>
    </div>
  );
}

export default AppFrame;
