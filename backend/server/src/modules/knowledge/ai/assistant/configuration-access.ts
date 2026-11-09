import { canConfigureAssistant } from '@fob/shared/knowledge/contracts';
import { KnowledgeAccessError, requireKnowledgeScopes, type KnowledgeRequestContext } from '../../access';

export function requireAssistantConfiguration(actor: KnowledgeRequestContext): void {
  requireKnowledgeScopes(actor, ['read']);
  if (!canConfigureAssistant(actor.role)) throw new KnowledgeAccessError('INSUFFICIENT_SCOPE');
}
