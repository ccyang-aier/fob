'use client';
import { useState } from 'react';
import Link from 'next/link';
import { documentInviteAcceptSchema, pageScopeSchema } from '@fob/shared/knowledge/contracts';
import { useIdentity } from '@/features/identity/identity-provider';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { useTranslation } from '@/lib/i18n';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { documentLink } from '../editor/document-link';
import { messages } from './collaboration.messages';
import styles from './document-collaboration.module.css';

export function DocumentInvitationScene() {
  const { t } = useTranslation(messages), identity = useIdentity();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function accept() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const input = documentInviteAcceptSchema.parse(Object.fromEntries(new URLSearchParams(window.location.hash.slice(1))));
      const { origin } = await getFobApiOrigin();
      const response = await authenticatedFetch(`${origin}/api/document-invitations/accept`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error(t('unavailable'));
      const scope = pageScopeSchema.parse(await response.json());
      window.location.assign(documentLink(window.location.href, { ...scope, source: 'server' }));
    } catch (cause) { setError(cause instanceof Error && cause.message === t('unavailable') ? cause.message : t('failed')); }
    finally { setBusy(false); }
  }
  return <main className={`${styles.surface} ${styles.public}`}><header><strong>Fob</strong><Link href="/">{t('openFob')}</Link></header><article><h1>{t('acceptInvitation')}</h1><p>{t('invitationHint')}</p>
    {error && <AppAlert tone="error" title={error} />}
    {identity.session.status === 'authenticated' ? <><p>{identity.session.user.email}</p><Button loading={busy} onClick={() => void accept()}>{t('accept')}</Button></> : <Button onClick={identity.openSignIn}>{t('signIn')}</Button>}
  </article></main>;
}
