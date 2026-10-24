import { useState, useEffect } from 'react';

export interface UseIntersectionObserverOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
  disabled?: boolean;
}

/**
 * 视口感知监听 Hook
 * 基于原生 IntersectionObserver 提供 250px 缓冲区，在进入视口前静默挂载
 * 保持优雅降级支持与流式常驻激活控制
 */
export function useIntersectionObserver<T extends Element = Element>(
  targetRef: React.RefObject<T | null>,
  options?: UseIntersectionObserverOptions
): boolean {
  const disabled = options?.disabled ?? false;
  const rootMargin = options?.rootMargin ?? '250px 0px';
  const threshold = options?.threshold ?? 0;
  const root = options?.root ?? null;

  // SSR 或缺少 IntersectionObserver 支持时优雅降级为在屏激活
  const isSupported =
    typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';

  const [isIntersecting, setIsIntersecting] = useState<boolean>(() => {
    if (!isSupported || disabled) {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!isSupported || disabled) {
      setIsIntersecting(true);
      return;
    }

    const element = targetRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry) {
          setIsIntersecting(entry.isIntersecting);
        }
      },
      {
        root,
        rootMargin,
        threshold,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [targetRef, root, rootMargin, threshold, disabled, isSupported]);

  if (disabled || !isSupported) {
    return true;
  }

  return isIntersecting;
}
