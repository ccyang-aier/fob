'use client';
import { useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, type JSONContent } from '@tiptap/core';
import { history, redo, undo } from '@tiptap/pm/history';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createBlockEditingExtensions } from '../editor/extensions';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

const History = Extension.create({ name: 'folderHistory', addProseMirrorPlugins: () => [history()], addKeyboardShortcuts() { return { 'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch), 'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch), 'Mod-y': () => redo(this.editor.state, this.editor.view.dispatch) }; } });
export function FolderDescriptionEditor({ content, onChange }: { content: unknown; onChange(content: JSONContent): void }) {
  const { t } = useTranslation(messages), [link, setLink] = useState<string | null>(null);
  const extensions = useMemo(() => [...createKnowledgeExtensions(), ...createBlockEditingExtensions(), History], []);
  const editor = useEditor({ extensions, immediatelyRender: false, content: (content ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as JSONContent, editorProps: { attributes: { 'aria-label': t('description') } }, onUpdate: ({ editor: current }) => onChange(current.getJSON()) }, [extensions]);
  function applyLink() { if (editor && link && /^(https?:\/\/|mailto:)/i.test(link.trim())) { editor.chain().focus().setMark('link', { href: link.trim() }).run(); setLink(null); } }
  return <div className={styles.editor}><div className={styles.editorToolbar} role="toolbar" aria-label={t('edit')}>
    <button type="button" className="fob-action" title={t('bold')} aria-label={t('bold')} onClick={() => editor?.chain().focus().toggleMark('bold').run()}><b>B</b></button>
    <button type="button" className="fob-action" title={t('italic')} aria-label={t('italic')} onClick={() => editor?.chain().focus().toggleMark('italic').run()}><i>I</i></button>
    <button type="button" className="fob-action" aria-label={t('heading')} onClick={() => editor?.chain().focus().toggleNode('heading', 'paragraph', { level: 2 }).run()}>H2</button>
    <button type="button" className="fob-action" onClick={() => editor?.chain().focus().toggleList('bulletList', 'listItem').run()}>{t('bullet')}</button>
    <button type="button" className="fob-action" onClick={() => setLink(link === null ? '' : null)}>{t('link')}</button>
  </div>{link !== null && <div className={styles.filterSearch}><input autoFocus type="url" aria-label={t('linkUrl')} placeholder="https://" value={link} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }} /><Button size="sm" variant="outline" disabled={!/^(https?:\/\/|mailto:)/i.test(link.trim())} onClick={applyLink}>{t('save')}</Button></div>}<div className={styles.editorBody}><EditorContent editor={editor} /></div></div>;
}
