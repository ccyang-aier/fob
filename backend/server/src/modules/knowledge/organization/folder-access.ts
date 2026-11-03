import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { knowledgeBaseScopeSchema, permissionLevels, updateFolderAccessInputSchema } from '@fob/shared/knowledge/contracts';
import type { FolderAccessPolicy, FolderMemberGrant } from '@fob/shared/knowledge/contracts';
import { member, teamspace, teamspaceMemberAccess } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { requireManager } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { inKnowledgeBase, requireDirectory } from './context';
import type { TeamspacePermissionInvalidator } from './teamspaces';

type Folder = Pick<typeof teamspace.$inferSelect, 'id' | 'parentId' | 'name' | 'defaultAccess' | 'inheritsAccess' | 'metadata'>;
type Grant = FolderMemberGrant & { teamspaceId: string };

/** Resolve positive grants from a complete, single-library folder tree. */
export function resolveFolderAccess(knowledgeBaseId: string, folders: readonly Folder[], entries: readonly Grant[]): FolderAccessPolicy[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const explicit = new Map<string, FolderMemberGrant[]>();
  for (const { teamspaceId, userId, level } of entries) {
    const list = explicit.get(teamspaceId) ?? [];
    list.push({ userId, level }); explicit.set(teamspaceId, list);
  }
  const resolved = new Map<string, FolderAccessPolicy>();
  const visiting = new Set<string>();
  function visit(id: string): FolderAccessPolicy {
    const cached = resolved.get(id); if (cached) return cached;
    const folder = byId.get(id);
    if (!folder || visiting.has(id)) throw new ResourceRequestError('CONFLICT', 'Folder permission inheritance is incomplete or cyclic.', 409);
    visiting.add(id);
    const parent = folder.inheritsAccess && folder.parentId ? visit(folder.parentId) : null;
    const grants = new Map((parent?.grants ?? []).map((grant) => [grant.userId, grant]));
    for (const grant of explicit.get(id) ?? []) {
      const previous = grants.get(grant.userId);
      if (!previous || permissionLevels.indexOf(grant.level) >= permissionLevels.indexOf(previous.level)) grants.set(grant.userId, { ...grant, sourceId: id });
    }
    const policy: FolderAccessPolicy = {
      knowledgeBaseId, teamspaceId: id, parentId: folder.parentId, name: folder.name,
      inheritsAccess: folder.inheritsAccess, defaultAccess: folder.defaultAccess,
      revision: folder.metadata.revision ?? 0,
      effectiveDefaultAccess: parent ? parent.effectiveDefaultAccess : folder.defaultAccess,
      defaultSourceId: parent?.defaultSourceId ?? id,
      explicit: explicit.get(id) ?? [], grants: [...grants.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
    };
    visiting.delete(id); resolved.set(id, policy); return policy;
  }
  return folders.map((folder) => visit(folder.id));
}

export async function readFolderAccess(db: ResourceTransaction, knowledgeBaseId: string) {
  const folders = await db.select({ id: teamspace.id, parentId: teamspace.parentId, name: teamspace.name, defaultAccess: teamspace.defaultAccess, inheritsAccess: teamspace.inheritsAccess, metadata: teamspace.metadata })
    .from(teamspace).where(eq(teamspace.knowledgeBaseId, knowledgeBaseId));
  const grants = await db.select({ teamspaceId: teamspaceMemberAccess.teamspaceId, userId: teamspaceMemberAccess.userId, level: teamspaceMemberAccess.level })
    .from(teamspaceMemberAccess).where(eq(teamspaceMemberAccess.knowledgeBaseId, knowledgeBaseId));
  return resolveFolderAccess(knowledgeBaseId, folders, grants);
}

export function folderAccessOperations(pool: Pool, permissions: TeamspacePermissionInvalidator) {
  return {
    async listFolderAccess(identity: FobIdentity, input: unknown) {
      const scope = parseInput(knowledgeBaseScopeSchema, input);
      return inKnowledgeBase(pool, identity, scope.knowledgeBaseId, false, async ({ db, role }) => {
        requireDirectory(role); return readFolderAccess(db, scope.knowledgeBaseId);
      });
    },
    async updateFolderAccess(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(updateFolderAccessInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role }) => {
        requireManager(role);
        const target = and(eq(teamspace.knowledgeBaseId, parsed.knowledgeBaseId), eq(teamspace.id, parsed.teamspaceId));
        const [folder] = await db.select().from(teamspace).where(target).for('update');
        if (!folder) throw new ResourceRequestError('TEAMSPACE_NOT_FOUND', 'Folder was not found.', 404);
        if ((folder.metadata.revision ?? 0) !== parsed.expectedRevision) throw new ResourceRequestError('CONFLICT', 'Folder permissions have changed. Reopen this dialog and try again.', 409);
        if (parsed.inheritsAccess && !folder.parentId) throw new ResourceRequestError('INVALID_INPUT', 'A root folder cannot inherit folder permissions.', 400);
        if (parsed.grants.length) {
          const users = await db.select({ id: member.userId }).from(member).where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), inArray(member.userId, parsed.grants.map((grant) => grant.userId))));
          if (users.length !== parsed.grants.length) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Only members of this knowledge base can be granted folder access.', 404);
        }
        await db.update(teamspace).set({ inheritsAccess: parsed.inheritsAccess, defaultAccess: parsed.defaultAccess, metadata: { ...folder.metadata, revision: (folder.metadata.revision ?? 0) + 1 }, updatedAt: sql`clock_timestamp()` }).where(target);
        await db.delete(teamspaceMemberAccess).where(and(eq(teamspaceMemberAccess.knowledgeBaseId, parsed.knowledgeBaseId), eq(teamspaceMemberAccess.teamspaceId, parsed.teamspaceId)));
        if (parsed.grants.length) await db.insert(teamspaceMemberAccess).values(parsed.grants.map((grant) => ({ ...grant, knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId })));
        await permissions.invalidate(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId });
        return (await readFolderAccess(db, parsed.knowledgeBaseId)).find((policy) => policy.teamspaceId === parsed.teamspaceId)!;
      });
    },
  };
}
