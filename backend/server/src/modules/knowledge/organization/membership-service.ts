import type { Pool } from 'pg';
import { invitationOperations } from './invitations';
import { memberOperations } from './members';
import { memberAccessOperations } from './member-access';

/** KnowledgeBase membership and directory are knowledge-base resources. */
export function createKnowledgeOrganizationService(pool: Pool) {
  return { ...memberOperations(pool), ...invitationOperations(pool), ...memberAccessOperations(pool) };
}

export type KnowledgeOrganizationService = ReturnType<typeof createKnowledgeOrganizationService>;
