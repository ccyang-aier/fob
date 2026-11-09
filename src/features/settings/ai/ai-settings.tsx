'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/features/identity/identity-context';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { assistantErrorKey } from '@/features/knowledge/ai/errors';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { useAIConfigurationAccess } from '@/features/knowledge/ai/use-ai-configuration-access';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { useTranslation } from '@/lib/i18n';
import { PanelHeader } from '../general-settings';
import { AIConnectionForm } from './connection-form';
import { aiSettingsMessages } from './messages';
import styles from './ai-settings.module.css';

/** The settings shell sits outside the document data layer, so it owns a scoped client. */
export function AISettings() {
  const { t } = useTranslation(aiSettingsMessages);
  const { session } = useIdentity();
  const resources = useKnowledgeBaseResources();
  const canConfigureAI = useAIConfigurationAccess();
  const base = resources.selectedKnowledgeBase;
  if (!canConfigureAI || session.status !== 'authenticated' || !base || base.source !== 'server') return null;
  return <div className={styles.page}>
    <PanelHeader title={t('title')} />
    <KnowledgeQueryProvider key={`${session.user.id}:${base.id}`}><ScopedAISettings knowledgeBaseId={base.id} knowledgeBaseName={base.name} userId={session.user.id} /></KnowledgeQueryProvider>
  </div>;
}

function ScopedAISettings({ knowledgeBaseId, knowledgeBaseName, userId }: { knowledgeBaseId: string; knowledgeBaseName: string; userId: string }) {
  const { t } = useTranslation(aiSettingsMessages);
  const client = useQueryClient();
  const queryKey = [knowledgeBaseId, 'knowledge', 'pages', 'assistant', userId, 'settings'] as const;
  const settings = useQuery({ queryKey, queryFn: ({ signal }) => assistantApi.configuration(knowledgeBaseId, signal), retry: false });
  return <>
    <div className={styles.context}><p className={styles.scope}>{t('scope', { name: knowledgeBaseName })}</p><p className={styles.hint}>{t('personalScope')}</p></div>
    {settings.isPending ? <p className={styles.loading} role="status">{t('loading')}</p>
      : settings.isError ? <div className={styles.empty}><AppAlert tone="error" title={t(assistantErrorKey(settings.error instanceof AssistantRequestError ? settings.error.code : 'failed'))} action={<Button variant="ghost" size="sm" onClick={() => void settings.refetch()}>{t('retry')}</Button>} /></div>
        : <AIConnectionForm knowledgeBaseId={knowledgeBaseId} userId={userId} value={settings.data} onSaved={value => { client.setQueryData(queryKey, value); void settings.refetch(); }} onChecked={() => void settings.refetch()} />}
  </>;
}
