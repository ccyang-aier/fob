'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './document-navigation-actions.messages';

import { useState } from 'react';
import type { Page, Teamspace } from '@fob/shared/knowledge/contracts';
import { useCreateTeamspaceMutation } from '../organization/hooks';
import { DialogButton, ModalDialog, NameField } from '../organization/ui';
import type { DocumentAction } from '../dense-sidebar/document-action-menu-content';
import { usePageTreeOperations, type TreeNotifier } from './page-operations';
import { NavigationDialogPortal } from './navigation-dialog-portal';
import { CreateDocumentDialog, type DocumentCreation } from './create-document-dialog';
import { DocumentShareDialog } from '../sharing/document-share-dialog';
import { documentLink } from '../editor/document-link';
import { useSidebarCollections } from './sidebar-collections';

const knowledgeT = createTranslator(knowledgeMessages);

export function useDocumentNavigationActions({
  knowledgeBaseId,
  userId,
  pages,
  teamspaces,
  canEdit,
  onOpenPage,
  notify,
}: {
  knowledgeBaseId: string;
  userId: string;
  pages: readonly Page[];
  teamspaces: readonly Teamspace[];
  canEdit: boolean;
  onOpenPage: (id: string) => void;
  notify: TreeNotifier;
}) {
  const operations = usePageTreeOperations(knowledgeBaseId, { canEdit, notify });
  const createFolder = useCreateTeamspaceMutation(knowledgeBaseId);
  const { collections, toggleStar, toggleDraft } = useSidebarCollections(userId, knowledgeBaseId);
  const [renaming, setRenaming] = useState<Pick<Page, 'id' | 'title'> | null>(null);
  const [title, setTitle] = useState('');
  const [creation, setCreation] = useState<{
    teamspaceId?: string;
    parentId: string | null;
    resolve: (id: string | null) => void;
  } | null>(null);
  const [sharing, setSharing] = useState<Page | null>(null);
  function create(teamspaceId?: string, parentId: string | null = null): Promise<string | null> {
    if (!canEdit) {
      notify('error', knowledgeT('youCannotCreateDocuments'));
      return Promise.resolve(null);
    }
    return new Promise((resolve) => setCreation({ teamspaceId, parentId, resolve }));
  }
  function closeCreation() {
    creation?.resolve(null);
    setCreation(null);
  }
  async function submitCreation(input: DocumentCreation) {
    try {
      const folderId =
        input.teamspaceId ??
        (await createFolder.mutateAsync({ name: knowledgeT('document'), defaultAccess: 'edit' }))
          .id;
      const id = await operations.createPage({ ...input, teamspaceId: folderId });
      if (id) {
        creation?.resolve(id);
        setCreation(null);
        onOpenPage(id);
      }
      return id;
    } catch {
      notify('error', knowledgeT('unableToCreateDocumentPleaseRetry'));
      return null;
    }
  }
  function closeRename() {
    setRenaming(null);
  }
  function act(id: string, action: DocumentAction) {
    const page = pages.find((item) => item.id === id);
    if (!page) return;
    if (action === 'share') {
      setSharing(page);
      return;
    }
    if (action === 'open-tab') {
      window.open(
        documentLink(window.location.href, { knowledgeBaseId, pageId: id, source: 'server' }),
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    if (action === 'toggle-draft') {
      const wasDraft = collections.drafts.includes(id);
      toggleDraft(id);
      notify('success', wasDraft ? knowledgeT('removedFromDrafts') : knowledgeT('addedToDrafts'));
      return;
    }
    if (action === 'toggle-star') {
      toggleStar(id);
      return;
    }
    if (!canEdit) {
      notify('error', knowledgeT('youCannotEditDocuments'));
      return;
    }
    if (action === 'rename') {
      setRenaming(page);
      setTitle(page.title);
    }
    if (action === 'trash') void operations.recyclePage(id);
  }
  const dialogs = (
    <>
      {creation ? (
        <NavigationDialogPortal>
          <CreateDocumentDialog
            teamspaces={teamspaces}
            target={creation}
            onClose={closeCreation}
            onCreate={submitCreation}
          />
        </NavigationDialogPortal>
      ) : null}
      {renaming ? (
        <NavigationDialogPortal>
          <ModalDialog
            open
            title={knowledgeT('renameDocument')}
            onClose={closeRename}
            footer={
              <>
                <DialogButton onClick={closeRename}>{knowledgeT('cancel')}</DialogButton>
                <DialogButton
                  variant="primary"
                  disabled={operations.hasPending(renaming.id)}
                  onClick={() => {
                    void operations.renamePage(renaming.id, title).then(closeRename);
                  }}
                >
                  {knowledgeT('save')}
                </DialogButton>
              </>
            }
          >
            <NameField
              label={knowledgeT('documentName')}
              value={title}
              onChange={setTitle}
              autoFocus
              maxLength={500}
            />
          </ModalDialog>
        </NavigationDialogPortal>
      ) : null}
      {sharing ? (
        <NavigationDialogPortal>
          <DocumentShareDialog
            title={sharing.title}
            target={{ knowledgeBaseId, pageId: sharing.id, source: 'server' }}
            onClose={() => setSharing(null)}
          />
        </NavigationDialogPortal>
      ) : null}
    </>
  );
  return { operations, create, act, dialogs };
}
