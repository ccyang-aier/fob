import type { Pool } from 'pg';
import { teamspaceOperations } from './teamspaces';
import { knowledgeBaseOperations } from './knowledge-bases';
import { knowledgeProjectScopeOperations } from './project-scopes';
import type { TeamspacePermissionInvalidator } from './teamspaces';

/** All entry points receive server-authenticated identity, never an actor in input. */
export function createKnowledgeCatalogService(pool: Pool, dependencies: { permissions: TeamspacePermissionInvalidator }) {
  return { ...knowledgeBaseOperations(pool), ...knowledgeProjectScopeOperations(pool), ...teamspaceOperations(pool, dependencies.permissions) };
}

export type KnowledgeCatalogService = ReturnType<typeof createKnowledgeCatalogService>;
