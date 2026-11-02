'use client';

import { profileLearningReplySchema, type PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeResourceRequest } from '../data/resource-http';
import { useActiveLearning } from './use-active-learning';

export function useProfileLearning(scope: PageScope, enabled: boolean) {
  useActiveLearning(`${scope.knowledgeBaseId}:${scope.pageId}`,enabled,seconds => knowledgeResourceRequest(
    scope.knowledgeBaseId,'discovery/profile/learning',profileLearningReplySchema,
    { method: 'POST', body: JSON.stringify({ pageId: scope.pageId, seconds }) },
  ));
}
