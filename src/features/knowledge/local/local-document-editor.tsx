'use client';

import { useKnowledgeNavigationActive } from '../navigation/system-navigation';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-document-editor.messages';
import { useEffect, useMemo } from 'react';
import { DocumentEditorBody, DocumentEditorFrame, DocumentHeading } from '../editor/editor-layout';
import { DocumentEditorHeader } from '../editor/components/document-editor-header';
import { TaskProgress } from '../editor/block-modules/task-list/task-progress';
import type { LocalDocument } from './local-library';
import type { createLocalLibraryStore } from './local-library';
import { PageIconPicker } from '../navigation/page-icon-picker';
import {
  revealBlockInEditor,
  subscribeOpenPageTarget,
  takeStagedBlockHighlight,
} from '../editor/open-target';
import { useStandaloneEditor } from '../editor/use-standalone-editor';

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
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const navigationActive = useKnowledgeNavigationActive();

  const context = useMemo(
    () => ({
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
    [document.id, knowledgeBaseId, store],
  );
  const editor = useStandaloneEditor({ content: document.body, contentId: document.id, context, label: knowledgeT('pageContent'), onChange: body => onChange({ body }) });
  useEffect(() => {
    if (!editor || !navigationActive) return;
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
  }, [editor, knowledgeBaseId, document.id, navigationActive]);

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
    </DocumentEditorFrame>
  );
}
