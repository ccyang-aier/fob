'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { acceptKnowledgeBaseInvitationInputSchema } from '@fob/shared/knowledge/contracts';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useIdentity } from '@/features/identity/identity-context';
import { useTranslation } from '@/lib/i18n';
import { DocumentInvitationScene } from '../sharing/document-invitation-scene';
import { invitationClient } from './invitation-client';
import { isOrganizationDataError, organizationErrorTextOf } from './errors';
import { messages } from './invitation-scene.messages';
import styles from '../sharing/document-collaboration.module.css';

function subscribe(listener: () => void) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }

/** Both invitation kinds reuse the existing statically exported /invite route. */
export function InvitationScene() {
  const { t } = useTranslation(messages);
  const fragment = useSyncExternalStore(subscribe, () => window.location.hash, () => null);
  if (fragment === null) return <main className={`${styles.surface} ${styles.public}`}><p role="status">{t('loading')}</p></main>;
  return new URLSearchParams(fragment.slice(1)).get('kind') === 'knowledge-base'
    ? <KnowledgeBaseInvitationScene key={fragment} fragment={fragment} /> : <DocumentInvitationScene />;
}

function KnowledgeBaseInvitationScene({ fragment }: { fragment: string }) {
  const { t } = useTranslation(messages);
  const identity = useIdentity();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [joined, setJoined] = useState(false);
  const pending = useRef(false), requestScope = useRef<AbortController | null>(null);
  useEffect(() => { const scope = new AbortController(); requestScope.current = scope; return () => scope.abort(); }, []);
  const params = new URLSearchParams(fragment.slice(1));
  params.delete('kind');
  const input = acceptKnowledgeBaseInvitationInputSchema.safeParse(Object.fromEntries(params));

  function openBase(id: string) {
    const url = new URL('/', window.location.origin);
    url.search = new URLSearchParams({ knowledgeBase: id, source: 'server' }).toString();
    window.location.assign(url.href);
  }

  async function accept() {
    if (pending.current || !input.success || identity.session.status !== 'authenticated') return;
    const signal = requestScope.current?.signal;
    pending.current = true; setBusy(true); setError('');
    try {
      const base = await invitationClient.accept(input.data, signal);
      if (!signal?.aborted) openBase(base.id);
    } catch (cause) {
      if (signal?.aborted) return;
      if (isOrganizationDataError(cause) && cause.code === 'CONFLICT') setJoined(true);
      else setError(isOrganizationDataError(cause) && cause.code === 'INVITATION_INVALID' ? t('invalid') : organizationErrorTextOf(cause));
    } finally { if (!signal?.aborted) { pending.current = false; setBusy(false); } }
  }

  return <main className={`${styles.surface} ${styles.public}`}>
    <header><strong>Fob</strong><Link href="/">{t('openFob')}</Link></header>
    <article><h1>{t('title')}</h1><p>{t('hint')}</p><p>{t('readOnly')}</p>
      {!input.success ? <AppAlert tone="error" title={t('invalid')} /> : <>
        {error ? <AppAlert tone="error" title={error} /> : null}
        {identity.session.status === 'checking' ? <p role="status">{t('loading')}</p> : identity.session.status === 'authenticated' ? <>
          <p>{identity.session.user.email}</p>
          {joined ? <><p>{t('joined')}</p><Button onClick={() => openBase(input.data.knowledgeBaseId)}>{t('open')}</Button></> : <Button loading={busy} onClick={() => void accept()}>{t('accept')}</Button>}
          <Button variant="ghost" disabled={busy} onClick={identity.openSwitchAccount}>{t('switchAccount')}</Button>
        </> : <Button onClick={identity.openSignIn}>{t('login')}</Button>}
      </>}
    </article>
  </main>;
}
