'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './create-document-dialog.messages';
import { useState } from 'react';
import type { Teamspace } from '@fob/shared/knowledge/contracts';
import { PermissionSelect } from '../organization/permission-select';
import { DialogButton, ModalDialog, NameField } from '../organization/ui';

export type DocumentCreation = {
  teamspaceId?: string;
  parentId: string | null;
  title: string;
  kind: 'doc' | 'database';
  icon: string | null;
  cover: string | null;
  inheritsPermissions: boolean;
};

export function CreateDocumentDialog({
  teamspaces,
  target,
  onClose,
  onCreate,
}: {
  teamspaces: readonly Teamspace[];
  target: { teamspaceId?: string; parentId: string | null };
  onClose: () => void;
  onCreate: (input: DocumentCreation) => Promise<string | null>;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const folderId = target.teamspaceId ?? teamspaces[0]?.id;
  const parentId = target.parentId;
  const [title, setTitle] = useState('');
  const [inherits, setInherits] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit() {
    if (busy || !title.trim()) return;
    setBusy(true);
    setFailed(false);
    const id = await onCreate({
      teamspaceId: folderId || undefined,
      parentId: parentId || null,
      title: title.trim(),
      kind: 'doc',
      icon: null,
      cover: null,
      inheritsPermissions: inherits,
    });
    setBusy(false);
    if (id) onClose();
    else setFailed(true);
  }
  return (
    <ModalDialog
      open
      width="w-[440px] max-w-[calc(100vw-32px)]"
      title={knowledgeT('newDocument')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <DialogButton disabled={busy} onClick={onClose}>
            {knowledgeT('cancel')}
          </DialogButton>
          <DialogButton
            variant="primary"
            disabled={busy || !title.trim()}
            onClick={() => void submit()}
          >
            {busy ? knowledgeT('creating') : knowledgeT('createDocument')}
          </DialogButton>
        </>
      }
    >
      <fieldset disabled={busy} className="grid gap-4">
        <NameField
          label={knowledgeT('documentName')}
          value={title}
          onChange={setTitle}
          onSubmit={() => void submit()}
          autoFocus
          maxLength={500}
        />
        <p className="text-[11px] leading-relaxed text-[var(--muted-strong)]">
          {knowledgeT('captureTextImagesAndRichContent')}
        </p>
        <PermissionSelect
          label={knowledgeT('documentPermissions')}
          value={inherits ? 'inherit' : 'independent'}
          disabled={busy}
          onChange={(value) => setInherits(value === 'inherit')}
          options={[
            {
              value: 'inherit',
              label: knowledgeT('inheritParentPermissions'),
              description: knowledgeT('useMemberGrantsAndDefaultAccessFromThe'),
            },
            {
              value: 'independent',
              label: knowledgeT('independentPermissions'),
              description: knowledgeT('theCreatorKeepsFullControlOtherMembersNeed'),
            },
          ]}
        />
      </fieldset>
      {failed ? (
        <p role="alert" className="mt-3 text-[12px] text-[var(--err-ink)]">
          {knowledgeT('unableToCreateCheckTheErrorAndRetry')}
        </p>
      ) : null}
    </ModalDialog>
  );
}
