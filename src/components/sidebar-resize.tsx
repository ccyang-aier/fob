'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/sidebar-resize.messages';

/**
 * 侧栏宽度拖拽（工作台侧栏与设置侧栏共用）：
 * 拖拽期间由全局 pointermove 更新宽度并夹在上下限内，松手后恢复宽度过渡。
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ComponentProps,
} from 'react';

import { cn } from '@/lib/utils';

const MIN_WIDTH = 204;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 224;

export function useSidebarWidth(defaultWidth = DEFAULT_WIDTH) {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointerX: number; width: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      setWidth(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.width + event.clientX - start.pointerX)),
      );
    };
    const stop = () => {
      dragStart.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('lostpointercapture', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragging]);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStart.current = { pointerX: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  return { width, dragging, startResize };
}

/** 侧栏右缘拖拽手柄：全系统共享即时出现的 2px 黑色指示线。 */
export function SidebarResizeHandle({
  dragging,
  onPointerDown,
  className,
  'aria-label': label,
  title,
  ...props
}: {
  dragging: boolean;
} & Omit<ComponentProps<'button'>, 'children' | 'style'>) {
  const uiText = useTranslation(messages).t;
  return (
    <button
      {...props}
      type="button"
      aria-label={label ?? uiText('拖拽调整侧栏宽度')}
      title={title ?? label ?? uiText('拖拽调整侧栏宽度')}
      onPointerDown={onPointerDown}
      data-resize-axis="x"
      data-resizing={dragging || undefined}
      className={cn(
        'fob-resize-handle fob-sidebar-resize absolute inset-y-0 right-0 z-30 w-2',
        className,
      )}
    />
  );
}
