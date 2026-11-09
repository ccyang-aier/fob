'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/features/identity/identity-context';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { assistantErrorKey } from '@/features/knowledge/ai/errors';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { useTranslation } from '@/lib/i18n';
import { PanelHeader } from '../general-settings';
import { AIConnectionForm } from './connection-form';
import { aiSettingsMessages } from './messages';
import styles from './ai-settings.module.css';

/** The settings shell sits outside the document data layer, so it owns a scoped client. */
export function AISettings() {
  const { t } = useTranslation(aiSettingsMessages);
  const { session, openSignIn } = useIdentity();
  const resources = useKnowledgeBaseResources();
  const base = resources.selectedKnowledgeBase;
  return <div className={styles.page}>
    <PanelHeader title={t('title')} />
    {session.status === 'checking' || resources.status === 'loading' ? <p className={styles.loading} role="status">{t('loading')}</p>
      : session.status !== 'authenticated' ? <AISettingsUnavailable title={t('signIn')} description={t('signInHint')}><Button variant="outline" size="sm" onClick={openSignIn}>{t('signInAction')}</Button></AISettingsUnavailable>
        : resources.status === 'error' ? <div className={styles.empty}><AppAlert tone="error" title={resources.error ?? t('loadFailed')} action={<Button variant="ghost" size="sm" onClick={() => void resources.refreshKnowledgeBases()}>{t('retry')}</Button>} /></div>
          : !base ? <AISettingsUnavailable title={t('noKnowledgeBase')} description={t('noKnowledgeBaseHint')} />
            : base.source === 'local' ? <AISettingsUnavailable title={t('localOnly')} description={t('localHint')} />
              : <KnowledgeQueryProvider key={`${session.user.id}:${base.id}`}><ScopedAISettings knowledgeBaseId={base.id} knowledgeBaseName={base.name} userId={session.user.id} /></KnowledgeQueryProvider>}
  </div>;
}

function AISettingsUnavailable({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <div className={styles.empty}><p>{title}</p><p className={styles.hint}>{description}</p>{children}</div>;
}

function ScopedAISettings({ knowledgeBaseId, knowledgeBaseName, userId }: { knowledgeBaseId: string; knowledgeBaseName: string; userId: string }) {
  const { t } = useTranslation(aiSettingsMessages);
  const client = useQueryClient();
  const queryKey = [knowledgeBaseId, 'knowledge', 'pages', 'assistant', userId, 'settings'] as const;
  const settings = useQuery({ queryKey, queryFn: ({ signal }) => assistantApi.settings(knowledgeBaseId, signal), retry: false });
  return <>
    <div className={styles.context}><p className={styles.scope}>{t('scope', { name: knowledgeBaseName })}</p><p className={styles.hint}>{t('personalScope')}</p></div>
    {settings.isPending ? <p className={styles.loading} role="status">{t('loading')}</p>
      : settings.isError ? <div className={styles.empty}><AppAlert tone="error" title={t(assistantErrorKey(settings.error instanceof AssistantRequestError ? settings.error.code : 'failed'))} action={<Button variant="ghost" size="sm" onClick={() => void settings.refetch()}>{t('retry')}</Button>} /></div>
        : <AIConnectionForm knowledgeBaseId={knowledgeBaseId} userId={userId} value={settings.data} onSaved={value => { client.setQueryData(queryKey, value); void settings.refetch(); }} onChecked={() => void settings.refetch()} />}
  </>;
}
