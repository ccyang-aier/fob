import type { Pool } from 'pg';
import { invitationOperations } from './invitations';
import { memberOperations } from './members';

/** KnowledgeBase membership and directory are knowledge-base resources. */
export function createKnowledgeOrganizationService(pool: Pool) {
  return { ...memberOperations(pool), ...invitationOperations(pool) };
}

export type KnowledgeOrganizationService = ReturnType<typeof createKnowledgeOrganizationService>;
