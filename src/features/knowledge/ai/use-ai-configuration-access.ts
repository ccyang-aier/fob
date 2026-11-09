'use client';

import { canConfigureAssistant } from '@fob/shared/knowledge/contracts';
import { useIdentity } from '@/features/identity/identity-context';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';

export function useAIConfigurationAccess() {
  const { session } = useIdentity();
  const { status, selectedKnowledgeBase, selectedKnowledgeBaseRole } = useKnowledgeBaseResources();
  return session.status === 'authenticated' && status === 'ready'
    && selectedKnowledgeBase?.source === 'server' && canConfigureAssistant(selectedKnowledgeBaseRole);
}
