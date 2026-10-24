'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './create-teamspace-dialog.messages';
import { useState } from 'react';
import { useCreateTeamspaceMutation } from '../organization/hooks';
import { DialogButton, ModalDialog, NameField } from '../organization/ui';
import { organizationErrorTextOf } from '@/features/knowledge/organization/errors';
import type { Teamspace } from '@fob/shared/knowledge/contracts';
import type { TeamspaceAccess } from '../data/knowledge-catalog-client';
import { DefaultAccessField } from '../organization/default-access-field';

export function CreateTeamspaceDialog({
  knowledgeBaseId,
  open,
  onClose,
  onCreated,
}: {
  knowledgeBaseId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (folder: Teamspace) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [name, setName] = useState('');
  const [access, setAccess] = useState<TeamspaceAccess>('edit');
  const mutation = useCreateTeamspaceMutation(knowledgeBaseId);
  function close() {
    setName('');
    setAccess('edit');
    mutation.reset();
    onClose();
  }
  function submit() {
    if (!name.trim() || mutation.isPending) return;
    mutation.mutate(
      { name: name.trim(), defaultAccess: access },
      {
        onSuccess: (folder) => {
          onCreated(folder);
          close();
        },
      },
    );
  }
  return (
    <ModalDialog
      open={open}
      onClose={close}
      title={knowledgeT('newFolder')}
      footer={
        <>
          <DialogButton onClick={close}>{knowledgeT('cancel')}</DialogButton>
          <DialogButton
            variant="primary"
            disabled={!name.trim() || mutation.isPending}
            onClick={submit}
          >
            {mutation.isPending ? knowledgeT('creating') : knowledgeT('createFolder')}
          </DialogButton>
        </>
      }
    >
      <NameField
        label={knowledgeT('folderName')}
        value={name}
        onChange={setName}
        onSubmit={submit}
        autoFocus
        placeholder={knowledgeT('enterFolderName')}
      />
      <DefaultAccessField value={access} onChange={setAccess} disabled={mutation.isPending} />
      {mutation.isError ? (
        <p role="alert" className="mt-3 text-[12px] text-[var(--err-ink)]">
          {organizationErrorTextOf(mutation.error)}
        </p>
      ) : null}
    </ModalDialog>
  );
}
