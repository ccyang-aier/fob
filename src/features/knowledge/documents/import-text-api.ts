import type { KnowledgeApiInputs } from '../data/api-types';
import { runKnowledgeCall } from '../data/trpc-client';

export function importTextKnowledgePage(input: KnowledgeApiInputs['page']['importText']) {
  return runKnowledgeCall(input.knowledgeBaseId, undefined, client => client.page.importText.mutate(input));
}
