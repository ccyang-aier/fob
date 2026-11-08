'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { CanvasState } from '../canvas-states';
import { useLocalLibrary } from './use-local-library';
import { messages } from './local-folder.messages';

export function LocalFolderAccess({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const local = useLocalLibrary(), { t } = useTranslation(messages), { notify } = useAppAlert();
  const [busy, setBusy] = useState(false);
  const folder = local.state.folders[knowledgeBaseId];
  return <CanvasState title={t(folder?.state === 'error' ? 'invalid' : 'permission')} hint={folder?.error ?? t('permissionHint')} actions={<Button loading={busy} onClick={async () => {
    setBusy(true);
    try { await local.session?.authorize(knowledgeBaseId); }
    catch (cause) { notify('error', cause instanceof Error ? cause.message : t('denied')); }
    finally { setBusy(false); }
  }}>{t('authorize')}</Button>} />;
}

export function LocalFolderStatus({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const local = useLocalLibrary(), { t } = useTranslation(messages), { notify } = useAppAlert();
  const folder = local.state.folders[knowledgeBaseId];
  if (!folder) return null;
  if (folder.error) return <AppAlert tone="error" title={t('unsaved')} description={folder.error} action={<Button size="sm" variant="outline" loading={folder.pending} onClick={() => {
    void local.session?.retry(knowledgeBaseId).catch(cause => notify('error', cause instanceof Error ? cause.message : t('denied')));
  }}>{t('retry')}</Button>} />;
  return <div role="status" className="px-5 py-1 text-xs text-[var(--muted)]" aria-live="polite">{t(folder.pending ? 'saving' : 'saved', { folder: folder.name })}{local.state.recentError && <span className="ml-2">{t('recentUnavailable')}</span>}</div>;
}
