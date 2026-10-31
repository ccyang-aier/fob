'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

function placeCaretAtEnd(element: HTMLElement) {
  const selection = window.getSelection(), range = document.createRange();
  range.selectNodeContents(element); range.collapse(false);
  selection?.removeAllRanges(); selection?.addRange(range);
}

/** Keyed by the persisted title so a remote rename discards a stale local draft. */
export function GraphicBlockTitle({ value, fallback, editable, onCommit }: { value: string; fallback: string; editable: boolean; onCommit: (title: string) => void }) {
  const { t } = useTranslation(richMessages);
  const [editing, setEditing] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  const active = useRef(false);
  useEffect(() => { if (editing) { text.current?.focus({ preventScroll: true }); if (text.current) placeCaretAtEnd(text.current); } }, [editing]);
  const normalize = (element: HTMLElement) => {
    const value = element.textContent || '', next = value.replace(/[\r\n]+/g, ' ').slice(0, 500);
    if (value !== next) { element.textContent = next; placeCaretAtEnd(element); }
    return next;
  };
  const commit = () => {
    if (!active.current) return;
    active.current = false;
    const next = text.current ? normalize(text.current).trim() : value;
    if (editable && next !== value) onCommit(next);
    setEditing(false);
  };
  if (editable && editing) return <span ref={text} className={`${styles.graphicTitle} ${styles.graphicTitleEdit}`} contentEditable="plaintext-only" suppressContentEditableWarning
    role="textbox" aria-label={t('blockTitle')} aria-multiline={false} data-placeholder={fallback} data-graphic-title-editing
    onInput={event => { if (!(event.nativeEvent as InputEvent).isComposing) normalize(event.currentTarget); }} onCompositionEnd={event => normalize(event.currentTarget)}
    onPaste={event => {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
      const insert = document.createTextNode(event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' '));
      range.deleteContents(); range.insertNode(insert); range.setStartAfter(insert); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range); normalize(event.currentTarget);
    }} onDrop={event => event.preventDefault()} onBlur={commit} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const frame = event.currentTarget.closest<HTMLElement>('[data-fob-node]');
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); frame?.focus({ preventScroll: true }); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); active.current = false; setEditing(false); frame?.focus({ preventScroll: true }); }
    }}>{value}</span>;
  return editable ? <button type="button" className={`fob-action ${styles.graphicTitle}`} data-surface="plain" data-document-export-text aria-label={`${t('renameTitle')}: ${value || fallback}`} title={value || fallback}
    onClick={() => { active.current = true; setEditing(true); }}>{value || fallback}</button>
    : <span className={styles.graphicTitle} title={value || fallback}>{value || fallback}</span>;
}
