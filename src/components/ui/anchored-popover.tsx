'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot } from '@/lib/overlay-root';
import { cn } from '@/lib/utils';
import styles from './anchored-popover.module.css';

export type PopoverAnchor = HTMLElement | { left: number; top: number; right: number; bottom: number; width?: number; height?: number };

/** A non-modal surface for small, anchored forms and context menus. */
export function AnchoredPopover({ anchor, onClose, label, children, width = 260, align = 'start', role = 'dialog', className, restoreFocusTo, autoFocus = true, onMouseEnter, onMouseLeave }: {
  anchor: PopoverAnchor; onClose: () => void; label: string; children: ReactNode;
  width?: number | 'max-content'; align?: 'start' | 'end'; role?: 'dialog' | 'menu'; className?: string; restoreFocusTo?: HTMLElement;
  autoFocus?: boolean; onMouseEnter?: () => void; onMouseLeave?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function position() {
      const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
      const bounds = panel!.getBoundingClientRect();
      const left = align === 'end' ? rect.right - bounds.width : rect.left;
      const below = rect.bottom + 7;
      const above = rect.top - bounds.height - 7;
      const top = below + bounds.height <= window.innerHeight - 8 || above < 8 ? below : above;
      panel!.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
      panel!.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
      panel!.style.visibility = 'visible';
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const focus = panel.querySelector<HTMLElement>('[data-autofocus], [autofocus], [role^="menuitem"]:not([disabled])');
    if (autoFocus) (focus ?? panel).focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      const trigger = restoreFocusTo ?? (anchor instanceof HTMLElement ? anchor : null);
      if (trigger?.isConnected && (panel.contains(document.activeElement) || document.activeElement === document.body)) trigger.focus({ preventScroll: true });
    };
  }, [anchor, align, restoreFocusTo, autoFocus]);

  useEffect(() => {
    function pointerDown(event: Event) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !(anchor instanceof HTMLElement && anchor.contains(target)) && !restoreFocusTo?.contains(target)) onClose();
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); onClose();
      }
    }
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('focusin', pointerDown, true);
    return () => { document.removeEventListener('pointerdown', pointerDown, true); document.removeEventListener('keydown', keyDown, true); document.removeEventListener('focusin', pointerDown, true); };
  }, [anchor, onClose, restoreFocusTo]);

  return createPortal(<div ref={panelRef} role={role} aria-label={label} tabIndex={-1} data-density={role === 'menu' ? 'compact' : undefined} className={cn(styles.popover, role === 'menu' && 'menu-surface', className)}
    style={{ width, visibility: 'hidden' }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onKeyDown={event => {
      if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])')];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }}>{children}</div>, getOverlayRoot() ?? document.body);
}
