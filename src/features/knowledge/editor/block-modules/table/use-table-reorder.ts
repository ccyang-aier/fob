'use client';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { TableGeometry } from './use-table-geometry';
import { moveTableAxisTo } from './table-move';

export function useTableReorder({ editor, getPos, shellRef, geometry, select, onStart }: {
  editor: Editor; getPos: () => number | undefined; shellRef: RefObject<HTMLDivElement | null>; geometry: TableGeometry | null;
  select: (axis: 'row' | 'column', index: number) => void; onStart: () => void;
}) {
  const [drop, setDrop] = useState<{ axis: 'row' | 'column'; boundary: number; valid: boolean } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => () => cleanupRef.current?.(), []);
  const start = (event: ReactPointerEvent<HTMLButtonElement>, axis: 'row' | 'column', from: number) => {
    const pos = getPos();
    const shell = shellRef.current;
    if (event.button !== 0 || !geometry || !shell || typeof pos !== 'number') return;
    event.preventDefault();
    cleanupRef.current?.();
    onStart();
    select(axis, from);
    const original = editor.state.doc.nodeAt(pos);
    const document = shell.ownerDocument;
    const window = document.defaultView!;
    const edges = axis === 'column' ? geometry.columns : geometry.rows;
    let point = { x: event.clientX, y: event.clientY };
    const initial = point;
    let moved = false, boundary = from;
    let frame = 0;
    const oldCursor = document.body.style.cursor;
    let scrollParent = shell.parentElement;
    while (scrollParent && !(scrollParent.scrollHeight > scrollParent.clientHeight && /auto|scroll/.test(window.getComputedStyle(scrollParent).overflowY))) scrollParent = scrollParent.parentElement;
    const verticalScroll = scrollParent ?? document.scrollingElement;
    const update = () => {
      const bounds = shell.querySelector('table')!.getBoundingClientRect();
      const coordinate = axis === 'column' ? point.x - bounds.left : point.y - bounds.top;
      const index = edges.slice(1).findIndex(edge => coordinate < edge);
      const cell = index < 0 ? edges.length - 2 : index;
      boundary = coordinate < (edges[cell] + edges[cell + 1]) / 2 ? cell : cell + 1;
      const currentPos = getPos();
      const valid = typeof currentPos === 'number' && editor.state.doc.nodeAt(currentPos) === original && moveTableAxisTo(editor.state, undefined, currentPos, axis, from, boundary);
      setDrop(current => current?.axis === axis && current.boundary === boundary && current.valid === valid ? current : { axis, boundary, valid });
    };
    const tick = () => {
      const bounds = shell.getBoundingClientRect();
      if (axis === 'column') shell.scrollLeft += point.x < bounds.left + 24 ? -8 : point.x > bounds.right - 24 ? 8 : 0;
      if (verticalScroll) {
        const bounds = scrollParent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
        verticalScroll.scrollTop += point.y < bounds.top + 32 ? -8 : point.y > bounds.bottom - 32 ? 8 : 0;
      }
      update();
      frame = window.requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      if (!moved && Math.hypot(point.x - initial.x, point.y - initial.y) >= 5) {
        moved = true;
        document.body.style.cursor = 'grabbing';
        tick();
      }
      if (moved) update();
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      window.cancelAnimationFrame(frame);
      document.body.style.cursor = oldCursor;
      setDrop(null);
      cleanupRef.current = null;
    };
    const finish = () => {
      if (moved) {
        suppressClickUntil.current = Date.now() + 250;
        const currentPos = getPos();
        if (editor.isEditable && typeof currentPos === 'number' && editor.state.doc.nodeAt(currentPos) === original) moveTableAxisTo(editor.state, tr => editor.view.dispatch(tr), currentPos, axis, from, boundary);
      }
      cleanup();
    };
    const cancel = () => { if (moved) suppressClickUntil.current = Date.now() + 250; cleanup(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    cleanupRef.current = cleanup;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
  };
  return { drop, start, suppressClick: () => Date.now() < suppressClickUntil.current };
}
