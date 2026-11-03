/**
 * Query keys of the organization surface (O02). The knowledgeBaseId namespaces
 * every knowledge-base-scoped list so switching or invalidating one knowledgeBase can
 * never leak into another knowledgeBase's cache entries.
 */

export const organizationQueryKeys = {
  knowledgeBases: ['organization', 'knowledge-bases'] as const,
  members: (knowledgeBaseId: string) => ['organization', knowledgeBaseId, 'members'] as const,
  invitations: (knowledgeBaseId: string) => ['organization', knowledgeBaseId, 'invitations'] as const,
  folderAccess: (knowledgeBaseId: string) => ['organization', knowledgeBaseId, 'folder-access'] as const,
  teamspaces: (knowledgeBaseId: string) => ['organization', knowledgeBaseId, 'teamspaces'] as const,
};

export type OrganizationQueryKey =
  | typeof organizationQueryKeys.knowledgeBases
  | ReturnType<(typeof organizationQueryKeys)['members']>
  | ReturnType<(typeof organizationQueryKeys)['teamspaces']>;
