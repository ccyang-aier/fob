'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './styles.module.css';

type Size = { width: number; height: number; autoHeight: boolean; autoWidth: boolean };
type ResizeAxis = 'x' | 'y' | 'nw-se';
type Gesture = { axis: ResizeAxis; pointer: number; x: number; y: number; pixels: number; scale: number; minWidth: number; startWidth: number; startHeight: number; ratio: number; direction: number; factor: number; initial: Size; next: Size; element: HTMLButtonElement; frame: HTMLElement };
const zones = [{ axis: 'x', label: 'resizeGraphicWidth' }, { axis: 'y', label: 'resizeGraphicHeight' }, { axis: 'nw-se', label: 'blockSize' }] as const;

/** Preview the whole block locally; persist one undoable change when the pointer is released. */
export function GraphicBlockResize({ props, width, height, autoHeight, autoWidth, minHeight, frameSelector = '[data-fob-node]', proportional = false, minWidthPixels = 120 }: {
  props: NodeViewProps; width: number; height: number; autoHeight: boolean; autoWidth: boolean; minHeight: number; frameSelector?: string; proportional?: boolean; minWidthPixels?: number;
}) {
  const { t } = useTranslation(richMessages);
  const hint = useId();
  const gesture = useRef<Gesture | null>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const { editor, getPos, node } = props;
  const align = String(node.attrs.align || 'left');
  const startEdge = align === 'right';
  const commit = (next: Size) => props.updateAttributes(proportional ? { width: next.width, autoWidth: next.autoWidth } : next);
  const read = useCallback((): Size | null => {
    if (editor.isDestroyed) return null;
    const pos = getPos();
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return current?.type === node.type ? { width: Number(current.attrs.width || 100), height: Number(current.attrs.height || 360), autoHeight: current.attrs.autoHeight !== false, autoWidth: current.attrs.autoWidth !== false } : null;
  }, [editor, getPos, node.type]);
  const finish = useCallback(() => {
    const drag = gesture.current;
    gesture.current = null;
    if (drag) {
      drag.element.dataset.resizing = 'false';
      if (drag.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
    }
    const current = read();
    const element = drag?.frame ?? handle.current?.closest<HTMLElement>(frameSelector);
    if (element && current) { element.style.width = current.autoWidth ? '' : `${current.width}%`; element.style.height = current.autoHeight ? '' : `${current.height}px`; element.dataset.graphicAutoHeight = String(current.autoHeight); element.dataset.graphicAutoWidth = String(current.autoWidth); }
  }, [read, frameSelector]);
  useEffect(() => () => finish(), [finish]);
  useEffect(() => {
    const drag = gesture.current;
    if (drag && (drag.initial.width !== width || drag.initial.height !== height || drag.initial.autoHeight !== autoHeight || drag.initial.autoWidth !== autoWidth)) finish();
  }, [width, height, autoHeight, autoWidth, finish]);
  useEffect(() => { finish(); }, [node.attrs.src, align, finish]);
  const restore = (axis: ResizeAxis) => { finish(); if (editor.isEditable) props.updateAttributes(proportional ? { autoWidth: true } : axis === 'x' ? { autoWidth: true } : axis === 'y' ? { autoHeight: true } : { autoWidth: true, autoHeight: true }); };
  return <><span id={hint} hidden data-document-export-omit>{t('resizeGraphicHint')}</span>
    {zones.map(({ axis, label }) => <button key={axis} ref={axis === 'nw-se' ? handle : undefined} type="button" className={`fob-resize-handle ${styles.graphicResize}`} data-resize-axis={startEdge && axis === 'nw-se' ? 'ne-sw' : axis} data-resize-edge={startEdge ? 'start' : 'end'} data-resize-feedback="cursor" data-graphic-resize={axis} data-document-export-omit
    aria-label={t(label)} aria-describedby={hint}
    onPointerDown={event => {
      const element = event.currentTarget.closest<HTMLElement>(frameSelector), initial = read();
      if (event.button !== 0 || !element || !initial || !editor.isEditable || gesture.current) return;
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement;
      if (!parent || !rect.width || !rect.height || !element.offsetWidth || !element.offsetHeight) return;
      event.preventDefault(); event.stopPropagation();
      const scaleX = rect.width / element.offsetWidth, scaleY = rect.height / element.offsetHeight;
      const style = getComputedStyle(parent);
      const pixels = (parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)) * scaleX;
      if (pixels <= 0) return;
      const minWidth = Math.max(1, Math.min(100, minWidthPixels * scaleX / pixels * 100));
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.resizing = 'true';
      gesture.current = { axis, pointer: event.pointerId, x: event.clientX, y: event.clientY, pixels, scale: scaleY, minWidth, startWidth: rect.width / pixels * 100, startHeight: rect.height / scaleY, ratio: rect.width / rect.height, direction: startEdge ? -1 : 1, factor: align === 'center' ? 2 : 1, initial, next: initial, element: event.currentTarget, frame: element };
    }}
    onPointerMove={event => {
      const drag = gesture.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = (event.clientX - drag.x) * drag.direction, dy = event.clientY - drag.y;
      if (proportional) {
        const delta = drag.axis === 'x' ? dx * drag.factor : drag.axis === 'y' ? dy * drag.ratio
          : (dx / drag.factor + dy / drag.ratio) / (1 / drag.factor ** 2 + 1 / drag.ratio ** 2);
        const nextWidth = Math.max(drag.minWidth, Math.min(100, drag.startWidth + delta / drag.pixels * 100));
        drag.next = { ...drag.initial, width: Math.ceil(nextWidth), autoWidth: false };
        drag.frame.style.width = `${nextWidth}%`; drag.frame.dataset.graphicAutoWidth = 'false';
        return;
      }
      const width = drag.axis === 'y' ? drag.initial.width : Math.round(Math.max(drag.minWidth, Math.min(100, drag.startWidth + dx * drag.factor / drag.pixels * 100)) * 1000) / 1000;
      const height = drag.axis === 'x' ? drag.initial.height : Math.max(minHeight, Math.min(1200, drag.startHeight + (event.clientY - drag.y) / drag.scale));
      const autoHeight = drag.axis === 'x' && drag.initial.autoHeight;
      const autoWidth = drag.axis === 'y' && drag.initial.autoWidth;
      drag.next = { width: drag.axis === 'y' ? drag.initial.width : Math.ceil(width), height: Math.round(height), autoHeight, autoWidth };
      drag.frame.style.width = autoWidth ? '' : `${width}%`; drag.frame.style.height = autoHeight ? '' : `${height}px`; drag.frame.dataset.graphicAutoHeight = String(autoHeight); drag.frame.dataset.graphicAutoWidth = String(autoWidth);
    }}
    onPointerUp={event => {
      const drag = gesture.current, current = read();
      if (!drag || drag.pointer !== event.pointerId) return;
      finish();
      if (editor.isEditable && current && current.width === drag.initial.width && current.height === drag.initial.height && current.autoHeight === drag.initial.autoHeight && current.autoWidth === drag.initial.autoWidth
        && (current.width !== drag.next.width || current.height !== drag.next.height || current.autoHeight !== drag.next.autoHeight || current.autoWidth !== drag.next.autoWidth)) commit(drag.next);
    }}
    onPointerCancel={() => finish()} onLostPointerCapture={() => finish()}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); restore(axis); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return; }
      if (event.key === 'Home' && editor.isEditable) { event.preventDefault(); event.stopPropagation(); restore(axis); return; }
      const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!editor.isEditable || !keys.includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const current = read();
      if (!current) return;
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      const frame = event.currentTarget.closest<HTMLElement>(frameSelector);
      const startHeight = current.autoHeight && frame ? frame.offsetHeight : current.height;
      const parent = frame?.parentElement, parentStyle = parent ? getComputedStyle(parent) : null;
      const available = parent ? parent.clientWidth - (parseFloat(parentStyle?.paddingLeft ?? '') || 0) - (parseFloat(parentStyle?.paddingRight ?? '') || 0) : 0;
      const startWidth = current.autoWidth && frame && available ? frame.offsetWidth / available * 100 : current.width;
      if (proportional) {
        const ratio = frame?.offsetHeight ? frame.offsetWidth / frame.offsetHeight : 1;
        const delta = vertical && available ? 20 * ratio / available * 100 : 1;
        props.updateAttributes({ width: Math.ceil(Math.max(available ? Math.min(100, minWidthPixels / available * 100) : 1, Math.min(100, startWidth + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -delta : delta)))), autoWidth: false });
        return;
      }
      props.updateAttributes({ width: vertical ? current.width : Math.ceil(Math.max(available ? Math.min(100, minWidthPixels / available * 100) : 1, Math.min(100, startWidth + (event.key === 'ArrowLeft' ? -1 : 1)))),
        height: vertical ? Math.max(minHeight, Math.min(1200, startHeight + (event.key === 'ArrowUp' ? -20 : 20))) : current.height,
        autoHeight: vertical ? false : current.autoHeight, autoWidth: vertical ? current.autoWidth : false });
    }} />)}</>;
}
