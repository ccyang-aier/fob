'use client';

import { useIdentity } from '@/features/identity/identity-context';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { usePublishCompanionWorkspace } from '@/features/companion/chat/companion-context';
import type { CompanionWorkspaceContext } from '@/features/companion/chat/companion-context-store';
import { useAIConfigurationAccess } from '@/features/knowledge/ai/use-ai-configuration-access';

/** The workbench owns account/library selection; the global pet consumes its scoped projection. */
export function CompanionContextBridge() {
  const { session } = useIdentity();
  const { selectedKnowledgeBase: base, status } = useKnowledgeBaseResources();
  const canConfigureAI = useAIConfigurationAccess();
  let state: CompanionWorkspaceContext['status'];
  if (session.status === 'checking') state = 'checking';
  else if (session.status === 'error' || status === 'error') state = 'error';
  else if (session.status !== 'authenticated') state = 'signed-out';
  else if (!base) state = status === 'loading' ? 'checking' : 'no-knowledge-base';
  else state = base.source === 'local' ? 'local' : 'ready';
  usePublishCompanionWorkspace({ status: state, userId: session.status === 'authenticated' ? session.user.id : null, knowledgeBaseId: base?.id ?? null, knowledgeBaseName: base?.name ?? '', canConfigureAI });
  return null;
}
