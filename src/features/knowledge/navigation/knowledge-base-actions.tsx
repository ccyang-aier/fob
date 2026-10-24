'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './knowledge-base-actions.messages';
import { useState } from 'react';
import { useRemoveTeamspaceMutation, useUpdateTeamspaceMutation } from '../organization/hooks';
import type { Teamspace } from '@fob/shared/knowledge/contracts';
import {
  ConfirmDialog,
  DialogButton,
  ModalDialog,
  NameField,
  mutationErrorText,
} from '../organization/ui';
import { NavigationDialogPortal } from './navigation-dialog-portal';
import type { TreeNotifier } from './page-operations';

export function KnowledgeBaseActions({
  knowledgeBaseId,
  target,
  onClose,
  onRemoved,
  notify,
}: {
  knowledgeBaseId: string;
  target: { teamspace: Teamspace; action: 'rename' | 'delete' };
  onClose: () => void;
  onRemoved: (id: string) => void;
  notify: TreeNotifier;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [name, setName] = useState(target.teamspace.name);
  const update = useUpdateTeamspaceMutation(knowledgeBaseId);
  const remove = useRemoveTeamspaceMutation(knowledgeBaseId);
  async function submit() {
    if (update.isPending || remove.isPending || (target.action === 'rename' && !name.trim()))
      return;
    try {
      if (target.action === 'rename') {
        await update.mutateAsync({ id: target.teamspace.id, patch: { name: name.trim() } });
      } else {
        await remove.mutateAsync(target.teamspace.id);
        onRemoved(target.teamspace.id);
      }
      notify(
        'success',
        target.action === 'rename' ? knowledgeT('folderRenamed') : knowledgeT('folderDeleted'),
      );
      onClose();
    } catch (error) {
      notify(
        'error',
        mutationErrorText(
          target.action === 'rename' ? knowledgeT('renameFolder') : knowledgeT('deleteFolder'),
          error,
        ),
      );
    }
  }
  if (target.action === 'delete')
    return (
      <NavigationDialogPortal>
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={() => void submit()}
          title={knowledgeT('deleteFolder')}
          body={knowledgeT('deleteValueOnlyEmptyFoldersCanBeDeleted', {
            v0: target.teamspace.name,
          })}
          confirmLabel={remove.isPending ? knowledgeT('deleting') : knowledgeT('delete')}
          busy={remove.isPending}
        />
      </NavigationDialogPortal>
    );
  return (
    <NavigationDialogPortal>
      <ModalDialog
        open
        onClose={onClose}
        title={knowledgeT('renameFolder')}
        footer={
          <>
            <DialogButton onClick={onClose}>{knowledgeT('cancel')}</DialogButton>
            <DialogButton
              variant="primary"
              disabled={!name.trim() || update.isPending}
              onClick={() => void submit()}
            >
              {update.isPending ? knowledgeT('saving') : knowledgeT('save')}
            </DialogButton>
          </>
        }
      >
        <NameField
          label={knowledgeT('folderName')}
          value={name}
          onChange={setName}
          autoFocus
          onSubmit={() => void submit()}
        />
      </ModalDialog>
    </NavigationDialogPortal>
  );
}
