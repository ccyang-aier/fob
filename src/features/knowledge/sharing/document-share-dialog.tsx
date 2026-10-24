'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-share-dialog.messages';
import { useState } from 'react';
import { LinkSimple } from '@phosphor-icons/react';
import { DialogButton, ModalDialog } from '../organization/ui';
import { documentLink, type DocumentLinkTarget } from '../editor/document-link';

export function DocumentShareDialog({
  title,
  target,
  onClose,
}: {
  title: string;
  target: DocumentLinkTarget;
  onClose: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const link = documentLink(window.location.href, target);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }
  return (
    <ModalDialog
      open
      title={knowledgeT('shareDocument')}
      description={knowledgeT('membersWithAccessCanOpenThisDocumentUsing')}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose}>{knowledgeT('close')}</DialogButton>
          <DialogButton variant="primary" autoFocus onClick={() => void copy()}>
            {knowledgeT('copyLink')}
          </DialogButton>
        </>
      }
    >
      <p className="truncate text-[13px] font-medium text-[var(--ink)]" title={title}>
        {title || knowledgeT('untitledDocument')}
      </p>
      <label className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-[var(--muted-strong)]">
        <LinkSimple size={16} weight="bold" className="shrink-0" aria-hidden />
        <input
          aria-label={knowledgeT('documentShareLink')}
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ink-soft)] outline-none"
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
        />
      </label>
      {status !== 'idle' && (
        <p
          role={status === 'failed' ? 'alert' : 'status'}
          className="text-xs text-[var(--muted-strong)]"
        >
          {status === 'copied'
            ? knowledgeT('linkCopied')
            : knowledgeT('unableToCopySelectTheLinkAndCopy')}
        </p>
      )}
    </ModalDialog>
  );
}
