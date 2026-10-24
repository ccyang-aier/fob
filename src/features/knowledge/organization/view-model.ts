import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './view-model.messages';
/**
 * Pure presentation logic of the organization UI (O02): list state machine,
 * role-authority rendering rules and the root default-access presentation with
 * the P02 rebuild notice. No React here, so every rule is directly testable.
 */

import type { MemberRole } from '@/features/knowledge/organization/client';
import type { TeamspaceAccess } from '../data/knowledge-catalog-client';

/** The four observable list states plus the ready state they lead to. */
export type OrganizationListState =
  'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'empty' | 'ready';

export type ListStateInput = {
  /** TanStack Query status: 'pending' while loading, 'error' on failure. */
  status: 'pending' | 'error' | 'success';
  /** Normalized domain error code, if any. */
  errorCode?: string | null;
  /** Item count of the successfully loaded page(s). */
  itemCount?: number | null;
};

export function deriveListState(input: ListStateInput): OrganizationListState {
  if (input.status === 'pending') return 'loading';
  if (input.status === 'error') {
    if (input.errorCode === 'UNAUTHENTICATED') return 'unauthenticated';
    if (input.errorCode === 'FORBIDDEN') return 'forbidden';
    return 'error';
  }
  return (input.itemCount ?? 0) === 0 ? 'empty' : 'ready';
}

export function memberRoleLabels(locale?: Locale): Record<MemberRole, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    owner: knowledgeT('owner'),
    admin: knowledgeT('administrator'),
    member: knowledgeT('members'),
    guest: knowledgeT('guest'),
  };
}

/** Directory (members, groups, teamspaces) is closed to guests. */
export function canBrowseDirectory(role: MemberRole): boolean {
  return role !== 'guest';
}

/** KnowledgeBase management: creating groups/teamspaces, renames, defaults. */
export function canManageOrganization(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Roles the actor may assign; mirrors the backend `requireRoleAuthority` matrix. */
export function assignableRoles(role: MemberRole): MemberRole[] {
  if (role === 'owner') return ['owner', 'admin', 'member', 'guest'];
  if (role === 'admin') return ['member', 'guest'];
  return [];
}

/** Whether the actor may touch (change role / remove) one specific member row. */
export function canManageMember(actorRole: MemberRole, targetRole: MemberRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'member' || targetRole === 'guest';
  return false;
}

export type DefaultAccessOption = {
  value: TeamspaceAccess;
  label: string;
  description: string;
};

export function defaultAccessOptions(locale?: Locale): readonly DefaultAccessOption[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    {
      value: null,
      label: knowledgeT('explicitGrantsOnly'),
      description: knowledgeT('rootPagesHaveNoDefaultAccessOnlyExplicitly'),
    },
    {
      value: 'view',
      label: knowledgeT('canView'),
      description: knowledgeT('knowledgeBaseMembersCanViewPagesInThis'),
    },
    {
      value: 'comment',
      label: knowledgeT('canComment'),
      description: knowledgeT('knowledgeBaseMembersCanViewAndCommentOn'),
    },
    {
      value: 'edit',
      label: knowledgeT('canEdit'),
      description: knowledgeT('knowledgeBaseMembersCanEditPageContentBy'),
    },
    {
      value: 'full',
      label: knowledgeT('fullControl'),
      description: knowledgeT('knowledgeBaseMembersCanEditMoveAndShare'),
    },
  ];
}

export function defaultAccessLabel(value: TeamspaceAccess, locale?: Locale): string {
  const options = defaultAccessOptions(locale);
  return (options.find((option) => option.value === value) ?? options[0]).label;
}

export function defaultAccessDescription(value: TeamspaceAccess, locale?: Locale): string {
  const options = defaultAccessOptions(locale);
  return (options.find((option) => option.value === value) ?? options[0]).description;
}

/**
 * P02 semantics: changing the root default access fences every page of the
 * teamspace in the same transaction — existing grants stop working immediately
 * and an asynchronous rebuild restores access under the new default.
 */
export function defaultAccessRebuildNotice(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return knowledgeT('changingDefaultAccessImmediatelyInvalidatesExistingPermissionsFor');
}

/** Only an actual default change on an existing teamspace needs the rebuild confirmation. */
export function needsAccessRebuildConfirmation(
  current: TeamspaceAccess,
  next: TeamspaceAccess,
): boolean {
  return current !== next;
}
