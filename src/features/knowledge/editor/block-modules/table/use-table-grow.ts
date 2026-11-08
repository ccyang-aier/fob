'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { yUndoPluginKey } from 'y-prosemirror';
import { appendTableAxes } from './table-grow';

type Axis = 'row' | 'column';
export function useTableGrow(editor: Editor, getPos: () => number | undefined, onStart: () => void) {
  const [growth, setGrowth] = useState<{ axis: Axis; count: number; size: number } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const append = (axis: Axis, count = 1) => {
    const pos = getPos();
    if (!editor.isEditable || typeof pos !== 'number') return;
    const manager = yUndoPluginKey.getState(editor.state)?.undoManager;
    manager?.stopCapturing();
    editor.commands.command(({ state, dispatch }) => appendTableAxes(pos, axis, count)(state,
      dispatch ? transaction => dispatch(closeHistory(transaction)) : undefined));
    manager?.stopCapturing();
    editor.view.focus();
  };
  const start = (event: ReactPointerEvent<HTMLButtonElement>, axis: Axis, size: number) => {
    const pos = getPos();
    if (event.button !== 0 || !editor.isEditable || typeof pos !== 'number') return;
    event.preventDefault();
    cleanup.current?.();
    onStart();
    const original = editor.state.doc.nodeAt(pos);
    const document = event.currentTarget.ownerDocument;
    const window = document.defaultView!;
    const origin = axis === 'row' ? event.clientY : event.clientX;
    let count = 1;
    setGrowth({ axis, count, size });
    const move = (event: PointerEvent) => {
      const distance = (axis === 'row' ? event.clientY : event.clientX) - origin;
      const next = Math.min(100, Math.max(1, Math.ceil(distance / size)));
      if (count !== next) { count = next; setGrowth({ axis, count, size }); }
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      setGrowth(null);
      cleanup.current = null;
    };
    const finish = () => {
      const currentPos = getPos();
      stop();
      if (typeof currentPos === 'number' && editor.state.doc.nodeAt(currentPos) === original) append(axis, count);
    };
    const cancel = () => stop();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    cleanup.current = stop;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
  };
  return { growth, start, append };
}
