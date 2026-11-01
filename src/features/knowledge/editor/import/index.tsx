'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FileArrowUp } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { DocumentModal } from '../../sharing/document-modal';
import { documentFileAccept } from '../../documents/previews/file-format';
import { insertDocumentFiles } from './insert-files';
import { messages } from './messages';

export function EditorDocumentImport({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const { t } = useTranslation(messages), { notify } = useAppAlert();
  const input = useRef<HTMLInputElement>(null), pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const active = new AbortController(); controller.current = active; return () => active.abort(); }, []);
  async function importFiles(files: readonly File[]) {
    if (pending.current || !files.length) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await insertDocumentFiles(editor, files, { unavailable: t('unavailable'), unsupported: t('unsupported'), tooLarge: t('tooLarge') }, controller.current?.signal);
      notify('success', t('done')); onClose();
    } catch (cause) {
      if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : t('failed'));
    } finally { pending.current = false; if (!controller.current?.signal.aborted) setBusy(false); }
  }
  return <DocumentModal title={t('title')} onClose={() => { if (!pending.current) onClose(); }}>
    <div className="p-6" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFiles([...event.dataTransfer.files]); }}>
      <div className="rounded-xl border border-dashed border-[var(--control-border)] bg-[var(--surface-subtle)] p-7 text-center">
        <FileArrowUp size={28} className="mx-auto mb-3 text-[var(--muted-strong)]" />
        <p className="mb-4 text-xs leading-6 text-[var(--muted-strong)]">{t('hint')}</p>
        <Button size="sm" loading={busy} onClick={() => input.current?.click()}>{t('choose')}</Button>
        <input ref={input} type="file" className="hidden" aria-label={t('choose')} accept={documentFileAccept} multiple disabled={busy} onChange={event => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
      </div>
      {error && <div className="mt-4"><AppAlert tone="error" title={error} /></div>}
    </div>
  </DocumentModal>;
}
