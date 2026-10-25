'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { useStandaloneEditor } from '../editor/use-standalone-editor';
import { DocumentEditorContent } from '../editor/editor-layout';
import type { EditorBlockContext } from '../editor/block-modules/types';
import { createOverviewAutosave, type OverviewSaveState } from './overview-autosave';
import { messages } from './messages';
import styles from './discovery.module.css';

const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
function validContent(value: unknown): JSONContent {
  try { const node = knowledgeSchema.nodeFromJSON(value); node.check(); return node.type === knowledgeSchema.topNodeType ? node.toJSON() : empty; }
  catch { return empty; }
}

/** Persistence adapter only: uses the same editor assembly and body as local documents. */
export function FolderOverviewEditor({ content, revision, contentId, draftKey, context, editable, onSave }: {
  content: unknown; revision: number; contentId: string; draftKey: string; context: EditorBlockContext; editable: boolean; onSave(content: JSONContent, revision: number): Promise<number>;
}) {
  const { t } = useTranslation(messages), [state, setState] = useState<OverviewSaveState>('saved'), [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `fob.folder.overview-draft:${draftKey}`;
  const initial = useMemo(() => {
    if (editable) try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (saved && Number.isInteger(saved.revision) && saved.content) return { content: validContent(saved.content), revision: saved.revision, restored: true }; } catch { /* Server content remains available when browser storage is unavailable. */ }
    return { content: validContent(content), revision, restored: false };
    // A folder owns one editor lifetime. Later remote values are reconciled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [queue] = useState(() => createOverviewAutosave(initial, onSave, (next, _cause, draft) => {
    try { if (next === 'saved') localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(draft)); } catch { /* The live editor keeps the unsaved content and reports server failures. */ }
  }));
  const editor = useStandaloneEditor({ content: initial.content, contentId, context, label: t('description'), editable, synchronize: false, placeholder: t('overviewPlaceholder'), onChange: value => {
    queue.update(value); clearTimeout(timer.current); timer.current = setTimeout(() => { void queue.flush(); }, 600);
  } });
  useEffect(() => { queue.setWriter(onSave); }, [queue, onSave]);
  useEffect(() => queue.subscribe((next, cause) => { setState(next); setError(cause instanceof Error ? cause.message : cause ? t('failed') : ''); }), [queue, t]);
  useEffect(() => {
    if (initial.restored) { queue.restore(); void queue.flush(); }
    return () => { clearTimeout(timer.current); void queue.flush(); };
  }, [queue, initial.restored]);
  useEffect(() => {
    const next = validContent(content);
    if (editor && queue.receive(next, revision) && JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) editor.commands.setContent(next, { emitUpdate: false });
  }, [content, revision, queue, editor]);
  return <div className={styles.overview} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { clearTimeout(timer.current); void queue.flush(); } }}>
    <DocumentEditorContent editor={editor} className={styles.overviewContent} />
    {state === 'saving' && <span className={styles.overviewSaveState} role="status">{t('savingOverview')}</span>}
    {state === 'error' && <div className={styles.overviewError}><AppAlert tone="error" title={error || t('failed')} /><Button size="sm" variant="outline" onClick={() => void queue.flush()}>{t('retry')}</Button></div>}
  </div>;
}
