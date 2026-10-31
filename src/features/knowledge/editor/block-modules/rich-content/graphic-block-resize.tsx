'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

type Size = { width: number; height: number };
type ResizeAxis = 'x' | 'y' | 'nw-se';
type Gesture = { axis: ResizeAxis; pointer: number; x: number; y: number; pixels: number; scale: number; minWidth: number; initial: Size; next: Size; element: HTMLButtonElement; frame: HTMLElement };
const zones = [{ axis: 'x', label: 'resizeGraphicWidth' }, { axis: 'y', label: 'resizeGraphicHeight' }, { axis: 'nw-se', label: 'blockSize' }] as const;

/** Preview the whole block locally; persist one undoable change when the pointer is released. */
export function GraphicBlockResize({ props, width, height, minHeight }: {
  props: NodeViewProps; width: number; height: number; minHeight: number;
}) {
  const { t } = useTranslation(richMessages);
  const hint = useId();
  const gesture = useRef<Gesture | null>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const { editor, getPos, node } = props;
  const read = useCallback((): Size | null => {
    if (editor.isDestroyed) return null;
    const pos = getPos();
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return current?.type === node.type ? { width: Number(current.attrs.width || 100), height: Number(current.attrs.height || 360) } : null;
  }, [editor, getPos, node.type]);
  const finish = useCallback(() => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag) {
      drag.element.dataset.resizing = 'false';
      if (drag.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
    }
    const current = read();
    const element = drag?.frame ?? handle.current?.closest<HTMLElement>('[data-fob-node]');
    if (element && current) { element.style.width = `${current.width}%`; element.style.height = `${current.height}px`; }
  }, [read]);
  useEffect(() => () => finish(), [finish]);
  useEffect(() => {
    const drag = gesture.current;
    if (drag && (drag.initial.width !== width || drag.initial.height !== height)) finish();
  }, [width, height, finish]);
  return <><span id={hint} hidden data-document-export-omit>{t('resizeGraphicHint')}</span>
    {zones.map(({ axis, label }) => <button key={axis} ref={axis === 'nw-se' ? handle : undefined} type="button" className={`fob-resize-handle ${styles.graphicResize}`} data-resize-axis={axis} data-resize-feedback="cursor" data-graphic-resize={axis} data-document-export-omit
    aria-label={t(label)} aria-describedby={hint}
    onPointerDown={event => {
      const element = event.currentTarget.closest<HTMLElement>('[data-fob-node]'), initial = read();
      if (event.button !== 0 || !element || !initial || !editor.isEditable || gesture.current) return;
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement;
      if (!parent || !rect.width || !rect.height || !element.offsetWidth || !element.offsetHeight) return;
      event.preventDefault(); event.stopPropagation();
      const scaleX = rect.width / element.offsetWidth, scaleY = rect.height / element.offsetHeight;
      const style = getComputedStyle(parent);
      const pixels = (parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)) * scaleX;
      if (pixels <= 0) return;
      const minWidth = Math.max(25, Math.min(100, 280 * scaleX / pixels * 100));
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.resizing = 'true';
      gesture.current = { axis, pointer: event.pointerId, x: event.clientX, y: event.clientY, pixels, scale: scaleY, minWidth, initial, next: initial, element: event.currentTarget, frame: element };
    }}
    onPointerMove={event => {
      const drag = gesture.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      const width = drag.axis === 'y' ? drag.initial.width : Math.round(Math.max(drag.minWidth, Math.min(100, Math.max(drag.minWidth, drag.initial.width) + (event.clientX - drag.x) / drag.pixels * 100)) * 1000) / 1000;
      const height = drag.axis === 'x' ? drag.initial.height : Math.max(minHeight, Math.min(1200, drag.initial.height + (event.clientY - drag.y) / drag.scale));
      drag.next = { width: drag.axis === 'y' ? drag.initial.width : Math.ceil(width), height: Math.round(height) };
      drag.frame.style.width = `${width}%`; drag.frame.style.height = `${height}px`;
    }}
    onPointerUp={event => {
      const drag = gesture.current, current = read();
      if (!drag || drag.pointer !== event.pointerId) return;
      finish();
      if (editor.isEditable && current && current.width === drag.initial.width && current.height === drag.initial.height
        && (current.width !== drag.next.width || current.height !== drag.next.height)) props.updateAttributes(drag.next);
    }}
    onPointerCancel={() => finish()} onLostPointerCapture={() => finish()}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return; }
      const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!editor.isEditable || !keys.includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const current = read();
      if (!current) return;
      props.updateAttributes({ width: Math.max(25, Math.min(100, current.width + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0))),
        height: Math.max(minHeight, Math.min(1200, current.height + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0))) });
    }} />)}</>;
}
