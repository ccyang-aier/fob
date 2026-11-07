'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { CaretDown, CaretRight } from '@/components/icons';
import { usePageSessionState } from '@/lib/page-session-state';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from '../document-outline/messages';
import { createHeadingSectionsPlugin, headingSectionsKey, toggleHeadingSection } from '../../extensions/heading-sections';
import styles from './styles.module.css';

type Control = { id: string; title: string; left: number; top: number; folded: boolean };

export function HeadingSectionsControls({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation(knowledgeMessages);
  const layer = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = usePageSessionState<string[]>('heading-folds', []);
  const savedRef = useRef(saved);
  const [controls, setControls] = useState<Control[]>([]);
  useEffect(() => { savedRef.current = saved; }, [saved]);
  useEffect(() => {
    if (!editor) return;
    let registered = false, frame = 0;
    let previous = headingSectionsKey.getState(editor.state);
    const measure = () => {
      frame = 0;
      if (!layer.current || editor.isDestroyed || !registered) return;
      const state = headingSectionsKey.getState(editor.state);
      const origin = layer.current.getBoundingClientRect();
      const next: Control[] = [];
      state?.sections.forEach(({ id, pos }) => {
        const element = editor.view.nodeDOM(pos);
        if (!(element instanceof HTMLElement) || !element.getClientRects().length) return;
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        const line = parseFloat(computed.lineHeight) || rect.height;
        next.push({ id, title: element.textContent ?? '', folded: state!.folded.has(id),
          left: computed.direction === 'rtl' ? rect.right - origin.left + 4 : rect.left - origin.left - 28,
          top: rect.top - origin.top + Math.min(rect.height, line) / 2 - 12 });
      });
      setControls(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    const update = () => {
      const next = headingSectionsKey.getState(editor.state);
      if (next === previous) return;
      previous = next;
      if (next && !next.temporary) setSaved((current) => {
        const values = [...next.folded];
        return current.length === values.length && current.every((id) => next.folded.has(id)) ? current : values;
      });
      schedule();
    };
    const unbind = () => {
      observer.disconnect();
      if (registered && !editor.isDestroyed) editor.unregisterPlugin(headingSectionsKey);
      registered = false;
    };
    const bind = () => {
      unbind();
      if (editor.isDestroyed || !editor.view.dom.isConnected) return;
      editor.registerPlugin(createHeadingSectionsPlugin(savedRef.current));
      registered = true;
      previous = headingSectionsKey.getState(editor.state);
      observer.observe(editor.view.dom);
      if (layer.current?.parentElement) observer.observe(layer.current.parentElement);
      schedule();
    };
    editor.on('mount', bind); editor.on('unmount', unbind); editor.on('transaction', update);
    bind();
    return () => {
      editor.off('mount', bind); editor.off('unmount', unbind); editor.off('transaction', update);
      unbind(); cancelAnimationFrame(frame);
    };
  }, [editor, setSaved]);
  return <div ref={layer} className={styles.layer} data-document-export-omit>
    {controls.map(({ id, title, left, top, folded }) => <button key={id} type="button"
      className={`fob-action ${styles.toggle}`} style={{ left, top }}
      data-variant="hover"
      data-heading-toggle={id} aria-expanded={!folded}
      aria-label={t('valueSectionValue', { v0: t(folded ? 'expand' : 'collapse'), v1: title })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => { if (editor && !editor.isDestroyed) toggleHeadingSection(editor.view, id); }}>
      {folded ? <CaretRight size={16} /> : <CaretDown size={16} />}
    </button>)}
  </div>;
}
