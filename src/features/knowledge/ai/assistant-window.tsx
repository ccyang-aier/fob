'use client';

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot, OverlayRootContext } from '@/lib/overlay-root';
import { assistantWindowRect, assistantWindowViewport, ASSISTANT_WINDOW_STORAGE_KEY, parseAssistantWindowPosition, type AssistantWindowPosition, type AssistantWindowRect } from './assistant-window-geometry';
import styles from './assistant-window.module.css';

const interactive = 'button, a, input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role^="menuitem"], [data-no-drag]';
type Drag = { pointerId: number; clientX: number; clientY: number; left: number; top: number };

/** A modeless, movable assistant surface that keeps the document available. */
export function AssistantWindow({ header, children, label, moveLabel, moveHint, onClose, className, headerClassName }: {
  header: ReactNode; children: ReactNode; label: string; moveLabel: string; moveHint: string; onClose(): void;
  className?: string; headerClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const position = useRef<AssistantWindowPosition | null>(null), rectRef = useRef<AssistantWindowRect | null>(null);
  const [layout, setLayout] = useState<{ rect: AssistantWindowRect; host: HTMLElement } | null>(null), [dragging, setDragging] = useState(false);
  const hintId = useId();
  const ready = layout !== null;

  function updatePosition(next: AssistantWindowPosition) {
    const bounds = assistantWindowRect(assistantWindowViewport(window), next);
    position.current = { left: bounds.left, top: bounds.top };
    rectRef.current = bounds;
    setLayout(current => current ? { ...current, rect: bounds } : current);
  }
  function persistPosition() {
    if (!position.current) return;
    try { window.localStorage.setItem(ASSISTANT_WINDOW_STORAGE_KEY, JSON.stringify(position.current)); } catch { /* Storage can be unavailable in private sessions. */ }
  }

  useLayoutEffect(() => {
    const initialHost = getOverlayRoot() ?? document.body;
    // Keep a stable portal container so changing fullscreen hosts preserves the conversation subtree.
    const host = document.createElement('div');
    host.setAttribute('data-assistant-host', '');
    host.setAttribute('popover', 'manual');
    host.className = styles.portal;
    initialHost.append(host);
    let popover = typeof host.showPopover === 'function' && typeof host.hidePopover === 'function';
    let raiseFrame = 0;
    if (!popover) host.removeAttribute('popover');
    const hasModal = () => document.querySelectorAll('dialog:modal').length > 0;
    function hide() {
      if (popover && host.matches(':popover-open')) host.hidePopover();
    }
    function show(raise = false) {
      if (!popover || hasModal()) return;
      const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
      try {
        if (raise) hide();
        if (!host.matches(':popover-open')) host.showPopover();
        focused?.focus({ preventScroll: true });
      } catch {
        // Keep an ordinary fixed surface usable when the native top-layer API is unavailable.
        popover = false;
        host.removeAttribute('popover');
      }
    }
    function scheduleRaise() {
      if (raiseFrame || hasModal()) return;
      // Companion reattaches synchronously when dialogs close. Raise the assistant after that pass.
      raiseFrame = window.requestAnimationFrame(() => { raiseFrame = 0; if (host.isConnected) show(true); });
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog') || node.querySelector('dialog'))))) scheduleRaise();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    show();
    try { position.current = parseAssistantWindowPosition(window.localStorage.getItem(ASSISTANT_WINDOW_STORAGE_KEY)); } catch { /* Start at the default position when storage is unavailable. */ }
    function fit() {
      const bounds = assistantWindowRect(assistantWindowViewport(window), position.current);
      rectRef.current = bounds;
      setLayout({ rect: bounds, host });
    }
    function fullscreenChanged() {
      const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
      const target = document.fullscreenElement ?? initialHost;
      if (host.parentElement !== target) { hide(); target.append(host); }
      show(true);
      focused?.focus({ preventScroll: true });
      fit();
    }
    fit();
    const viewport = window.visualViewport;
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      observer.disconnect();
      if (raiseFrame) window.cancelAnimationFrame(raiseFrame);
      hide();
      host.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const panel = panelRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previousFocus?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.focus({ preventScroll: true });
    };
    // Capture entry focus once, after the portal exists; moving the surface must not recapture it.
  }, [ready]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest(interactive)) return;
    const bounds = rectRef.current;
    if (!bounds) return;
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, left: bounds.left, top: bounds.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    updatePosition({ left: active.left + event.clientX - active.clientX, top: active.top + event.clientY - active.clientY });
  }
  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    persistPosition();
  }
  function moveWithKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const bounds = rectRef.current, step = event.shiftKey ? 40 : 10;
    const offset = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!bounds || !offset) return;
    event.preventDefault();
    updatePosition({ left: bounds.left + offset[0], top: bounds.top + offset[1] });
    persistPosition();
  }
  function closeWithEscape(event: KeyboardEvent<HTMLDivElement>) {
    const panel = panelRef.current, target = event.target;
    if (event.key !== 'Escape' || event.defaultPrevented || !(target instanceof Element) || !panel?.contains(target)) return;
    // Menus and dialogs rendered through portals retain React bubbling; they own their Escape.
    const nestedSurface = target.closest('[role="menu"], [role="listbox"], [role="dialog"], dialog');
    if (nestedSurface !== panel) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  if (!layout) return null;
  return <OverlayRootContext value={layout.host}>{createPortal(<div ref={panelRef} role="dialog" aria-label={label} aria-modal="false" data-assistant-window="" data-dragging={dragging || undefined}
    className={[styles.window, className].filter(Boolean).join(' ')} style={layout.rect} onKeyDown={closeWithEscape}>
    <header className={[styles.header, headerClassName].filter(Boolean).join(' ')} role="group" tabIndex={0} aria-label={moveLabel} aria-describedby={hintId}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={moveWithKeyboard}>
      {header}
    </header>
    <div className={styles.content}>{children}</div>
    <span id={hintId} className={styles.hint}>{moveHint}</span>
  </div>, layout.host)}</OverlayRootContext>;
}
