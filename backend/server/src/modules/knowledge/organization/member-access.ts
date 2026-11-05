import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  folderAccessForMember, listMemberAccessInputSchema, resourcePermission, resourcePermissionRank,
  updateMemberAccessInputSchema,
} from '@fob/shared/knowledge/contracts';
import type { MemberResourceAccess } from '@fob/shared/knowledge/contracts';
import { member, page, pageAcl, pageEffectiveAcl, teamspace, teamspaceMemberAccess } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import type { FobIdentity } from '../../../platform/identity/identity';
import { currentIdentity, pageOf } from '../../../platform/resources/context';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { canManagePageAccess, expandRequestPrincipals } from '../permissions/authorization';
import { effectivePageAccessCondition } from '../permissions/queries';
import { permissionForMember } from '../permissions/effective';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { teamspacePermissionInvalidator } from '../permissions/fence';
import { refreshPagePermissions } from '../api/page-route-guards';
import { assertFolderManagerRetained, canManageFolder, readFolderAccess, readVisibleFolderAccess } from './folder-access';
import { inKnowledgeBase } from './context';

const manager = (role: string) => role === 'owner' || role === 'admin';

/** Per-member access inspection is an administrative view, or the member's own visible resources. */
export function memberAccessOperations(pool: Pool) {
  return {
    async listMemberAccess(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(listMemberAccessInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, false, async ({ db, role, actor }) => {
        if (!manager(role) && actor.userId !== parsed.userId) throw new ResourceRequestError('FORBIDDEN', 'Member access management is required.', 403);
        const [target] = await db.select({ userId: member.userId, role: member.role }).from(member)
          .where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, parsed.userId)));
        if (!target) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Knowledge base member was not found.', 404);
        const folders = await readVisibleFolderAccess(db, parsed.knowledgeBaseId, { userId: actor.userId, role });
        if (parsed.kind === 'folder') {
          const allPolicies = await readFolderAccess(db, parsed.knowledgeBaseId);
          const visible = new Set(folders.map(folder => folder.teamspaceId));
          const entries: MemberResourceAccess[] = allPolicies
            .filter(folder => visible.has(folder.teamspaceId) && (!parsed.cursor || folder.teamspaceId > parsed.cursor)
              && folder.name.toLocaleLowerCase().includes(parsed.query.toLocaleLowerCase()))
            .sort((left, right) => left.teamspaceId.localeCompare(right.teamspaceId))
            .slice(0, parsed.limit + 1).map(folder => {
              const effective = folderAccessForMember(folder, target);
              const direct = resourcePermission(folder.explicit.find(grant => grant.userId === target.userId)?.level ?? null);
              return { id: folder.teamspaceId, kind: 'folder', name: folder.name, folderName: null, direct,
                effective: effective.level, source: effective.level === null ? 'none'
                  : effective.individual ? effective.sourceId === folder.teamspaceId ? 'direct' : 'inherited' : 'default',
                revision: folder.revision, canManage: canManageFolder(folder, { userId: actor.userId, role }) };
            });
          return pageOf(entries, parsed.limit, entry => entry.id);
        }
        const actorPrincipals = await expandRequestPrincipals(db, parsed.knowledgeBaseId, actor.userId);
        const targetPrincipals = await expandRequestPrincipals(db, parsed.knowledgeBaseId, parsed.userId);
        const subject = `user:${parsed.userId}` as const;
        const rows = await db.select({ id: page.id, name: page.title, teamspaceId: page.teamspaceId,
          folderName: teamspace.name, revision: page.aclRevision, effective: pageEffectiveAcl, direct: pageAcl.level })
          .from(page).innerJoin(teamspace, and(eq(teamspace.knowledgeBaseId, page.knowledgeBaseId), eq(teamspace.id, page.teamspaceId)))
          .leftJoin(pageEffectiveAcl, and(eq(pageEffectiveAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageEffectiveAcl.pageId, page.id)))
          .leftJoin(pageAcl, and(eq(pageAcl.knowledgeBaseId, page.knowledgeBaseId), eq(pageAcl.pageId, page.id), eq(pageAcl.principal, subject), eq(pageAcl.inherited, false)))
          .where(and(effectivePageAccessCondition({ knowledgeBaseId: parsed.knowledgeBaseId, principals: actorPrincipals, required: 'view' }),
            parsed.cursor ? gt(page.id, parsed.cursor) : undefined,
            parsed.query ? sql`position(${parsed.query.toLocaleLowerCase()} in lower(${page.title})) > 0` : undefined))
          .orderBy(asc(page.id)).limit(parsed.limit + 1);
        const visibleFolderIds = new Set(folders.map(folder => folder.teamspaceId));
        const entries: MemberResourceAccess[] = rows.map(row => {
          const ready = row.effective?.revision === row.revision;
          const effective = ready && row.effective ? permissionForMember(target.role, targetPrincipals, row.effective) : null;
          const direct = resourcePermission(row.direct);
          const actorLevel = ready && row.effective ? permissionForMember(role, actorPrincipals, row.effective) : null;
          return { id: row.id, kind: 'document', name: row.name, folderName: visibleFolderIds.has(row.teamspaceId) ? row.folderName : null,
            direct, effective, source: !ready ? 'rebuilding' : effective === null ? 'none'
              : direct && resourcePermissionRank(direct) >= resourcePermissionRank(effective) ? 'direct' : 'inherited',
            revision: row.revision, canManage: actorLevel !== null && (manager(role) || actorLevel === 'full'
              || folders.some(folder => folder.teamspaceId === row.teamspaceId && canManageFolder(folder, { userId: actor.userId, role }))) };
        });
        return pageOf(entries, parsed.limit, entry => entry.id);
      });
    },
    async updateMemberAccess(identity: FobIdentity, input: unknown) {
      const parsed = parseInput(updateMemberAccessInputSchema, input);
      return inKnowledgeBase(pool, identity, parsed.knowledgeBaseId, true, async ({ db, role, actor }) => {
        if (!manager(role) && actor.userId !== parsed.userId) throw new ResourceRequestError('FORBIDDEN', 'Member access management is required.', 403);
        const [target] = await db.select({ id: member.userId }).from(member)
          .where(and(eq(member.knowledgeBaseId, parsed.knowledgeBaseId), eq(member.userId, parsed.userId)));
        if (!target) throw new ResourceRequestError('MEMBER_NOT_FOUND', 'Knowledge base member was not found.', 404);
        if (parsed.kind === 'folder') {
          const policy = (await readFolderAccess(db, parsed.knowledgeBaseId)).find(folder => folder.teamspaceId === parsed.resourceId);
          if (!policy || !canManageFolder(policy, { userId: actor.userId, role })) throw new ResourceRequestError('FORBIDDEN', 'Folder management permission is required.', 403);
          if (policy.revision !== parsed.expectedRevision) throw new ResourceRequestError('CONFLICT', 'Folder permissions changed. Refresh and retry.', 409);
          assertFolderManagerRetained(policy, [...policy.explicit.filter(grant => grant.userId !== parsed.userId), ...(parsed.level ? [{ userId: parsed.userId, level: parsed.level }] : [])]);
          await currentIdentity(db, identity);
          const scope = and(eq(teamspaceMemberAccess.knowledgeBaseId, parsed.knowledgeBaseId), eq(teamspaceMemberAccess.teamspaceId, parsed.resourceId), eq(teamspaceMemberAccess.userId, parsed.userId));
          await db.delete(teamspaceMemberAccess).where(scope);
          if (parsed.level) await db.insert(teamspaceMemberAccess).values({ knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.resourceId, userId: parsed.userId, level: parsed.level });
          await db.update(teamspace).set({ metadata: sql`jsonb_set(${teamspace.metadata}, '{revision}', to_jsonb(${policy.revision + 1}::int))`, updatedAt: sql`clock_timestamp()` })
            .where(and(eq(teamspace.knowledgeBaseId, parsed.knowledgeBaseId), eq(teamspace.id, parsed.resourceId)));
          await teamspacePermissionInvalidator.invalidate(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.resourceId });
          return { updated: true as const };
        }
        const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.resourceId };
        if (!await canManagePageAccess(db, scope, actor.userId)) throw new ResourceRequestError('FORBIDDEN', 'Document management permission is required.', 403);
        const [record] = await db.select({ revision: page.aclRevision }).from(page)
          .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.resourceId), isNull(page.deletedAt))).for('update');
        if (!record || record.revision !== parsed.expectedRevision) throw new ResourceRequestError('CONFLICT', 'Document permissions changed. Refresh and retry.', 409);
        const grants = await db.select({ principal: pageAcl.principal, level: pageAcl.level }).from(pageAcl)
          .where(and(eq(pageAcl.knowledgeBaseId, scope.knowledgeBaseId), eq(pageAcl.pageId, scope.pageId), eq(pageAcl.inherited, false)));
        const subject = `user:${parsed.userId}` as const;
        if (grants.some(grant => grant.principal === subject && grant.level === 'full') && parsed.level !== 'full'
          && !grants.some(grant => grant.principal !== subject && grant.level === 'full')) {
          throw new ResourceRequestError('CONFLICT', 'Retain at least one document manager before removing this grant.', 409);
        }
        const next = grants.filter(grant => grant.principal !== subject);
        if (parsed.level) next.push({ principal: subject, level: parsed.level });
        await currentIdentity(db, identity);
        await replaceAuthorizedPageAcl(db, { ...scope, grants: next });
        await refreshPagePermissions(db, scope);
        return { updated: true as const };
      });
    },
  };
}
