'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-document-editor.messages';
import { useEffect, useMemo } from 'react';
import { Extension } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import { history, redo, undo } from '@tiptap/pm/history';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { applyEditorBlockModules } from '../editor/block-modules';
import { createSlashPasteExtensions, SlashMenuLayer } from '../editor/commands';
import { DocumentEditorBody, DocumentEditorFrame, DocumentHeading } from '../editor/editor-layout';
import { DocumentEditorHeader } from '../editor/components/document-editor-header';
import { createBlockEditingExtensions } from '../editor/extensions';
import { TaskProgress } from '../editor/block-modules/task-list/task-progress';
import type { LocalDocument } from './local-library';
import type { createLocalLibraryStore } from './local-library';
import { PageIconPicker } from '../navigation/page-icon-picker';
import {
  revealBlockInEditor,
  subscribeOpenPageTarget,
  takeStagedBlockHighlight,
} from '../editor/open-target';
import { useEditorLocale } from '../editor/use-editor-locale';

const localHistory = Extension.create({
  name: 'localHistory',
  addProseMirrorPlugins: () => [history()],
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch),
      'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch),
      'Mod-y': () => redo(this.editor.state, this.editor.view.dispatch),
    };
  },
});

export function LocalDocumentEditor({
  knowledgeBaseId,
  store,
  document,
  folderName,
  onChange,
  onBack,
  onOpenSidebar,
  onCreateDocument,
}: {
  knowledgeBaseId: string;
  store: ReturnType<typeof createLocalLibraryStore>;
  document: LocalDocument;
  folderName: string;
  onChange: (patch: Partial<LocalDocument>) => boolean;
  onBack: () => void;
  onOpenSidebar: () => void;
  onCreateDocument: () => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const extensions = useMemo(
    () => [
      ...applyEditorBlockModules(createKnowledgeExtensions(), {
        localKnowledgeBaseId: knowledgeBaseId,
        localPageId: document.id,
        getLocalPages: () => {
          const library = store.getSnapshot();
          return library.documents
            .filter((item) => !item.deleted)
            .map((item) => ({
              ...item,
              knowledgeBaseId: item.baseId,
              knowledgeBaseName: library.bases.find((base) => base.id === item.baseId)?.name,
            }));
        },
        subscribeLocalPages: store.subscribe,
      }),
      createBlockIdExtension({ pageId: document.id }),
      ...createBlockEditingExtensions(),
      ...createSlashPasteExtensions(),
      localHistory,
    ],
    [document.id, knowledgeBaseId, store],
  );
  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      content: document.body,
      editorProps: { attributes: { 'aria-label': knowledgeT('pageContent') } },
      onUpdate: ({ editor: current }) => onChange({ body: current.getJSON() }),
    },
    [extensions],
  );
  useEditorLocale(editor, locale, knowledgeT('pageContent'));

  // Two panes can display the same local document; external edits must reach both.
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(document.body))
      editor.commands.setContent(document.body, { emitUpdate: false });
  }, [editor, document.body]);
  useEffect(() => {
    if (!editor) return;
    const scope = { knowledgeBaseId, pageId: document.id };
    const staged = takeStagedBlockHighlight(scope);
    if (staged) revealBlockInEditor(editor.view, staged.blockId);
    return subscribeOpenPageTarget((target) => {
      if (
        target.knowledgeBaseId === knowledgeBaseId &&
        target.pageId === document.id &&
        target.blockId
      )
        revealBlockInEditor(editor.view, target.blockId);
    });
  }, [editor, knowledgeBaseId, document.id]);

  return (
    <DocumentEditorFrame
      appearanceScope={`local:${knowledgeBaseId}:${document.id}`}
      navigation={{
        editor,
        title: document.title,
        target: { knowledgeBaseId: document.baseId, pageId: document.id, source: 'local' },
      }}
      header={
        <DocumentEditorHeader
          editor={editor}
          folderName={folderName}
          title={document.title}
          avatarName={knowledgeT('me')}
          starred={document.starred}
          onOpenSidebar={onOpenSidebar}
          onToggleStar={() => onChange({ starred: !document.starred })}
          onCreateDocument={onCreateDocument}
          shareDescription={knowledgeT('localDocumentsAreStoredOnlyInThisBrowser')}
          menuActions={{
            target: { knowledgeBaseId: document.baseId, pageId: document.id, source: 'local' },
            onDelete: () => {
              if (!onChange({ deleted: true })) throw new Error('save-failed');
              onBack();
            },
          }}
        />
      }
    >
      <DocumentEditorBody
        editor={editor}
        before={
          <DocumentHeading
            title={document.title}
            icon={
              <PageIconPicker
                value={document.icon}
                onChange={async (icon) => {
                  if (!onChange({ icon })) throw new Error('Icon save failed');
                }}
              />
            }
            onTitleChange={(title) => onChange({ title })}
            metadata={
              <>
                <span>{knowledgeT('updatedByYouSavedLocally')}</span>
                <TaskProgress editor={editor} />
                <span>{knowledgeT('viewedOnlyByYou')}</span>
              </>
            }
          />
        }
      />
      <SlashMenuLayer editor={editor} />
    </DocumentEditorFrame>
  );
}
