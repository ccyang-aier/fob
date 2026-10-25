'use client';

import { useEffect, useMemo } from 'react';
import { Extension, type JSONContent } from '@tiptap/core';
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
  const extensions = useMemo(() => [...applyEditorBlockModules(createKnowledgeExtensions(), context), createBlockIdExtension({ pageId: contentId }), ...createBlockEditingExtensions(), ...createSlashPasteExtensions(), standaloneHistory], [contentId, context]);
  const editor = useEditor({ extensions, immediatelyRender: false, content, editable, editorProps: { attributes: { 'aria-label': label } }, onUpdate: ({ editor: current }) => onChange(current.getJSON()) }, [extensions]);
  useEditorLocale(editor, locale, label, placeholder);
  useEffect(() => { if (editor && editor.isEditable !== editable) editor.setEditable(editable); }, [editor, editable]);
  useEffect(() => { if (synchronize && editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content, { emitUpdate: false }); }, [editor, content, synchronize]);
  return editor;
}
