'use client';

/**
 * 锚定浮层面板（U06）——列菜单、筛选编辑器与选项选择器共用的浮层原语。
 *
 * 与 U03 的自绘菜单同一取舍：知识库未引入 Radix Popover 原语，而这里的面板
 * 需要承载自由内容（输入、列表、按钮），所以用一个聚焦的小组件自绘——
 * portal 到共享 overlay 根、按触发元素矩形定位并钳制视口、Escape 与外点
 * 关闭、初始焦点交由内容（autofocus 输入或首个菜单项）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot } from '@/lib/overlay-root';
import { cn } from '@/lib/utils';

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  right: number;
  width: number;
}

export function AnchoredPanel({
  anchor,
  onClose,
  label,
  children,
  width = 240,
  align = 'start',
  className,
}: {
  /** 触发元素的矩形（getBoundingClientRect 结果），面板挂在其下方。 */
  anchor: AnchorRect;
  onClose: () => void;
  /** 无障碍名称（菜单 / 对话框语义）。 */
  label: string;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end';
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    const preferLeft = align === 'start' ? anchor.left : anchor.right - rect.width;
    const left = Math.min(Math.max(margin, preferLeft), Math.max(margin, window.innerWidth - rect.width - margin));
    const belowTop = anchor.bottom + 6;
    const top = belowTop + rect.height + margin > window.innerHeight
      ? Math.max(margin, anchor.top - rect.height - 6)
      : belowTop;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = 'visible';
    setMeasured(true);
  }, [anchor, align]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  const overlayRoot = getOverlayRoot() ?? document.body;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{ left: anchor.left, top: anchor.bottom + 6, width, visibility: measured ? undefined : 'hidden' }}
      className={cn(
        'menu-surface fixed z-50 rounded-[8px] border bg-elevated p-1.5 text-[12px] text-[var(--ink)]',
        className,
      )}
    >
      {children}
    </div>,
    overlayRoot,
  );
}

/** 从一个 DOM 元素取锚定矩形（未挂载时为退化矩形，面板退化为视口左上）。 */
export function anchorRectOf(element: HTMLElement | null): AnchorRect {
  if (!element) return { left: 0, top: 0, bottom: 0, right: 0, width: 0 };
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right, width: rect.width };
}
