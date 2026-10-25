'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Extension, type EditorEvents, type JSONContent } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import { history, redo, undo } from '@tiptap/pm/history';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { useLocale } from '@/lib/i18n';
import { applyEditorBlockModules } from './block-modules';
import type { EditorBlockContext } from './block-modules/types';
import { createBlockEditingExtensions } from './extensions';
import { createSlashPasteExtensions } from './commands';
import { useEditorLocale } from './use-editor-locale';

const standaloneHistory = Extension.create({
  name: 'localHistory',
  addProseMirrorPlugins: () => [history()],
  addKeyboardShortcuts() { return { 'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch), 'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch), 'Mod-y': () => redo(this.editor.state, this.editor.view.dispatch) }; },
});

/** The full document editor assembly for JSON-backed bodies, independent of persistence. */
export function useStandaloneEditor({ content, contentId, context, label, editable = true, synchronize = true, placeholder, onChange }: {
  content: JSONContent; contentId: string; context: EditorBlockContext; label: string; editable?: boolean; synchronize?: boolean; placeholder?: string; onChange(content: JSONContent): void;
}) {
  const locale = useLocale();
  const applyingExternal = useRef(false);
  // A slash insertion emits deletion + insertion before React commits either snapshot.
  // Acknowledging an intermediate local echo must never replace the newer transaction.
  const synchronization = useRef<{ editor: unknown; received: string; pending: Set<string>; latest: string | null }>({ editor: null, received: JSON.stringify(content), pending: new Set(), latest: null });
  const extensions = useMemo(() => [...applyEditorBlockModules(createKnowledgeExtensions(), context), createBlockIdExtension({ pageId: contentId }), ...createBlockEditingExtensions(), ...createSlashPasteExtensions(), standaloneHistory], [contentId, context]);
  const editor = useEditor({ extensions, immediatelyRender: false, content, editable, editorProps: { attributes: { 'aria-label': label } }, onUpdate: ({ editor: current }) => {
    if (applyingExternal.current) return;
    const body = current.getJSON(), serialized = JSON.stringify(body);
    let state = synchronization.current;
    if (state.editor !== current) state = synchronization.current = { editor: current, received: JSON.stringify(content), pending: new Set(), latest: null };
    state.pending.add(state.received); state.pending.add(serialized); state.latest = serialized;
    if (state.pending.size > 32) {
      const obsolete = [...state.pending].find(value => value !== state.received && value !== serialized);
      if (obsolete !== undefined) state.pending.delete(obsolete);
    }
    onChange(body);
  } }, [extensions]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const anticipate = ({ transaction, nextState }: EditorEvents['beforeTransaction']) => {
      if (applyingExternal.current || transaction.getMeta('preventUpdate') || editor.state.doc.eq(nextState.doc)) return;
      let state = synchronization.current;
      if (state.editor !== editor) state = synchronization.current = { editor, received: JSON.stringify(editor.getJSON()), pending: new Set(), latest: null };
      const incoming = JSON.stringify(nextState.doc.toJSON());
      state.pending.add(state.received); state.pending.add(incoming); state.latest = incoming;
    };
    // NodeViews flush React while updateState is still running, before onUpdate fires.
    editor.on('beforeTransaction', anticipate);
    return () => { editor.off('beforeTransaction', anticipate); };
  }, [editor]);
  useEditorLocale(editor, locale, label, placeholder);
  useEffect(() => { if (editor && !editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable); }, [editor, editable]);
  useEffect(() => {
    if (!synchronize || !editor || editor.isDestroyed) return;
    const incoming = JSON.stringify(content);
    let state = synchronization.current;
    if (state.editor !== editor) state = synchronization.current = { editor, received: incoming, pending: new Set(), latest: null };
    if (state.latest !== null && incoming !== state.latest && state.pending.has(incoming)) return;
    synchronization.current = { ...state, received: incoming, latest: null, pending: new Set() };
    if (JSON.stringify(editor.getJSON()) !== incoming) {
      applyingExternal.current = true;
      try { editor.commands.setContent(content, { emitUpdate: false }); }
      finally { applyingExternal.current = false; }
    }
  }, [editor, content, synchronize]);
  return editor;
}
