'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './create-knowledge-base-dialog.messages';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '@/features/identity/identity-provider';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { knowledgeCatalogClient } from '../data/knowledge-catalog-client';
import { organizationErrorTextOf } from './errors';
import { organizationQueryKeys } from './keys';
import { ModalDialog, NameField } from './ui';

export function CreateKnowledgeBaseDialog({
  open,
  onClose,
  onCreated,
  onCreateLocal,
  projectId,
  initialSource = 'local',
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string, source: 'local' | 'server') => void;
  onCreateLocal: (name: string) => string;
  projectId: string | null;
  initialSource?: 'local' | 'server';
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { session } = useIdentity();
  const [name, setName] = useState('');
  const source = initialSource;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () =>
      source === 'local'
        ? { id: onCreateLocal(name.trim()) }
        : knowledgeCatalogClient.createKnowledgeBase({ name: name.trim(), projectIds: projectId ? [projectId] : [] }),
    onSuccess: async (base) => {
      if (source === 'server')
        await queryClient.invalidateQueries({ queryKey: organizationQueryKeys.knowledgeBases });
      onCreated(base.id, source);
      setName('');
      onClose();
    },
  });
  function close() {
    if (!mutation.isPending) {
      setName('');
      mutation.reset();
      onClose();
    }
  }
  function submit() {
    if (name.trim() && projectId && !mutation.isPending && (source === 'local' || session.status === 'authenticated')) mutation.mutate();
  }
  return (
    <ModalDialog
      open={open}
      onClose={close}
      title={knowledgeT('newKnowledgeBase')}
      footer={
        <>
          <Button variant="outline" disabled={mutation.isPending} onClick={close}>
            {knowledgeT('cancel')}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={
              !name.trim() ||
              !projectId ||
              mutation.isPending ||
              (source === 'server' && session.status !== 'authenticated')
            }
            onClick={submit}
          >
            {knowledgeT('createKnowledgeBase')}
          </Button>
        </>
      }
    >
      <NameField
        label={knowledgeT('knowledgeBaseName')}
        value={name}
        onChange={setName}
        onSubmit={submit}
        autoFocus
        placeholder={knowledgeT('enterKnowledgeBaseName')}
        maxLength={120}
      />
      <p className="text-[12px] text-[var(--muted)]">{knowledgeT('availableInCurrentProject')}</p>
      {mutation.isError ? (
        <AppAlert tone="error" title={source === 'local'
            ? knowledgeT('unableToSaveLocallyCheckBrowserStorageSpace')
            : organizationErrorTextOf(mutation.error)} />
      ) : null}
    </ModalDialog>
  );
}
