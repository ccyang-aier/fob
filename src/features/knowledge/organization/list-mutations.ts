/**
 * Pure optimistic-update reducers (O02).
 *
 * The hooks layer applies these to cached list pages before the request settles
 * and restores the previous snapshot on failure; keeping them pure makes the
 * apply/rollback semantics directly testable without React.
 */

import type { MemberRole, Group, GroupMember, KnowledgeBaseMemberSummary } from '@/features/knowledge/organization/client';
import type { Teamspace } from '@fob/shared/knowledge/contracts';

export type MemberRow = KnowledgeBaseMemberSummary;
export type GroupRow = Group;
export type GroupMemberRow = GroupMember;
export type TeamspaceRow = Teamspace;

export function upsertByKey<T>(items: readonly T[], keyOf: (item: T) => string, next: T): T[] {
  const key = keyOf(next);
  const index = items.findIndex((item) => keyOf(item) === key);
  if (index === -1) return [...items, next];
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

export function patchByKey<T>(items: readonly T[], keyOf: (item: T) => string, target: string, patch: Partial<T>): T[] {
  const index = items.findIndex((item) => keyOf(item) === target);
  if (index === -1) return items.slice();
  const copy = items.slice();
  copy[index] = { ...copy[index]!, ...patch };
  return copy;
}

export function removeByKey<T>(items: readonly T[], keyOf: (item: T) => string, target: string): T[] {
  return items.filter((item) => keyOf(item) !== target);
}

/** Renaming a group also renames it inside any expanded member-management rows. */
export function renameGroupRow(items: readonly GroupRow[], id: string, name: string): GroupRow[] {
  return patchByKey(items, (group) => group.id, id, { name });
}

export function applyMemberRole(items: readonly MemberRow[], userId: string, role: MemberRole): MemberRow[] {
  return patchByKey(items, (member) => member.userId, userId, { role });
}

export function applyTeamspacePatch(items: readonly TeamspaceRow[], id: string, patch: TeamspacePatchRows): TeamspaceRow[] {
  return patchByKey(items, (teamspace) => teamspace.id, id, patch);
}

export type TeamspacePatchRows = { name?: string; defaultAccess?: Teamspace['defaultAccess'] };
