import type { Pool } from 'pg';
import { teamspaceOperations } from './teamspaces';
import { knowledgeBaseOperations } from './knowledge-bases';
import { folderAccessOperations } from './folder-access';
import { importLocalKnowledgeBase } from './import-local';
import type { TeamspacePermissionInvalidator } from './teamspaces';

/** All entry points receive server-authenticated identity, never an actor in input. */
export function createKnowledgeCatalogService(pool: Pool, dependencies: { permissions: TeamspacePermissionInvalidator }) {
  return { ...knowledgeBaseOperations(pool), ...teamspaceOperations(pool, dependencies.permissions), ...folderAccessOperations(pool, dependencies.permissions), importLocalKnowledgeBase: (identity: Parameters<typeof importLocalKnowledgeBase>[1], knowledgeBaseId: string, input: unknown) => importLocalKnowledgeBase(pool, identity, knowledgeBaseId, input) };
}

export type KnowledgeCatalogService = ReturnType<typeof createKnowledgeCatalogService>;
