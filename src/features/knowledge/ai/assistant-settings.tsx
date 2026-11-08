'use client';

import type { AssistantSettings } from '@fob/shared/knowledge/contracts';
import { useIdentity } from '@/features/identity/identity-context';
import { AIConnectionForm } from '@/features/settings/ai/connection-form';
import { useTranslation } from '@/lib/i18n';
import { DocumentModal } from '../sharing/document-modal';
import { assistantMessages } from './assistant.messages';

export function AssistantSettingsDialog({ knowledgeBaseId, value, onSaved, onClose }: { knowledgeBaseId: string; value: AssistantSettings; onSaved(): void; onClose(): void }) {
  const { t } = useTranslation(assistantMessages);
  const { session } = useIdentity();
  if (session.status !== 'authenticated') return null;
  return <DocumentModal title={t('settings')} onClose={onClose}>
    <AIConnectionForm key={`${session.user.id}:${knowledgeBaseId}`} compact knowledgeBaseId={knowledgeBaseId} userId={session.user.id} value={value} onSaved={onSaved} onChecked={onSaved} onDone={onClose} onCancel={onClose} />
  </DocumentModal>;
}
