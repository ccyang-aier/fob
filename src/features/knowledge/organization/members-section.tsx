'use client';

import { useState } from 'react';
import { CaretDown, DotsThree, Funnel, MagnifyingGlass, Trash, UsersThree, X } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIdentity } from '@/features/identity/identity-context';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberRole } from './client';
import { useChangeMemberRoleMutation, useMembersQuery, useRemoveMemberMutation } from './hooks';
import type { MemberRow } from './list-mutations';
import { assignableRoles, canManageMember, memberRoleLabels } from './view-model';
import { ConfirmDialog, ListStateShell, flattenPages, mutationErrorText, queryListState } from './ui';
import { knowledgeMessages } from './members-section.messages';
import styles from './members-section.module.css';

const roleOrder: MemberRole[] = ['owner', 'admin', 'member', 'guest'];

/** Full, knowledge-base-scoped directory. Mutations retain authority checks and rollback. */
export function MembersSection({ knowledgeBaseId, actorRole, notify }: {
  knowledgeBaseId: string;
  actorRole: MemberRole;
  notify: (kind: 'success' | 'error', text: string) => void;
}) {
  const { locale, t } = useTranslation(knowledgeMessages);
  const { session } = useIdentity();
  const membersQuery = useMembersQuery(knowledgeBaseId);
  const changeRoleMutation = useChangeMemberRoleMutation(knowledgeBaseId);
  const removeMutation = useRemoveMemberMutation(knowledgeBaseId);
  const [removingMember, setRemovingMember] = useState<MemberRow | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<MemberRole | 'all'>('all');
  const members = flattenPages<MemberRow>(membersQuery.data);
  const state = queryListState(membersQuery);
  const labels = memberRoleLabels(locale);
  const query = search.trim().toLocaleLowerCase(locale);
  const filtered = members.filter(member =>
    (roleFilter === 'all' || member.role === roleFilter)
    && (!query || `${member.name}\n${member.email}`.toLocaleLowerCase(locale).includes(query)),
  ).sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, locale));
  const roles = assignableRoles(actorRole);
  const busy = changeRoleMutation.isPending || removeMutation.isPending;

  async function changeRole(member: MemberRow, role: MemberRole) {
    if (member.role === role || busy) return;
    try {
      await changeRoleMutation.mutateAsync({ userId: member.userId, role });
      notify('success', t('changedValueSRoleToValue', { v0: member.name, v1: labels[role] }));
    } catch (error) { notify('error', mutationErrorText(t('changeRole'), error)); }
  }

  async function removeMember() {
    const member = removingMember;
    if (!member || busy) return;
    try {
      await removeMutation.mutateAsync(member.userId);
      notify('success', t('removedValueFromKnowledgeBase', { v0: member.name }));
      setRemovingMember(null);
    } catch (error) { notify('error', mutationErrorText(t('removeMember'), error)); }
  }

  return <div className={styles.directory}>
    <div className={styles.toolbar}>
      <h2 className={styles.heading}>{t('allMembers')}{state === 'ready' || state === 'empty' ? <span className={styles.count}>{members.length}</span> : null}</h2>
      <div className={styles.filters}>
        <label className={styles.search}>
          <MagnifyingGlass size={15} aria-hidden />
          <input type="text" aria-label={t('searchMembers')} placeholder={t('searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} />
          {search ? <button type="button" className="fob-action" data-surface="plain" aria-label={t('clearSearch')} onClick={() => setSearch('')}><X size={12} aria-hidden /></button> : null}
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('fob-action', styles.filter)} data-surface="plain" data-filter-active={roleFilter !== 'all' ? true : undefined} aria-label={t('filterByRole')}>
              <Funnel size={14} aria-hidden />{roleFilter === 'all' ? t('allRoles') : labels[roleFilter]}<CaretDown size={12} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuRadioGroup value={roleFilter} onValueChange={value => setRoleFilter(value as MemberRole | 'all')}>
              <DropdownMenuRadioItem value="all">{t('allRoles')}</DropdownMenuRadioItem>
              {roleOrder.map(role => <DropdownMenuRadioItem key={role} value={role}>{labels[role]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <ListStateShell state={state} error={membersQuery.error} onRetry={() => void membersQuery.refetch()}
      emptyIcon={<UsersThree size={28} aria-hidden />} emptyTitle={t('noMembersInThisKnowledgeBase')} emptyHint={t('theKnowledgeBaseOwnerAppearsHereNewMembers')}>
      <table className={styles.table} aria-label={t('members')}>
        <thead><tr><th scope="col">{t('members')}</th><th scope="col">{t('email')}</th><th scope="col">{t('role')}</th><th scope="col"><span className="sr-only">{t('actions')}</span></th></tr></thead>
        <tbody>
          {filtered.map(member => {
            const manageable = canManageMember(actorRole, member.role);
            return <tr key={member.userId}>
              <td><div className={styles.person}>
                <UserAvatar name={member.name} image={member.image} className={styles.avatar} />
                <div className={styles.identity}>
                  <div className={styles.name}><span title={member.name}>{member.name}</span>{session.status === 'authenticated' && member.userId === session.user.id ? <span className={styles.self}>{t('you')}</span> : null}</div>
                  <span className={styles.mobileEmail} title={member.email}>{member.email}</span>
                </div>
              </div></td>
              <td className={styles.email} title={member.email}>{member.email}</td>
              <td>{manageable && roles.length > 0 ? <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={t('changeValueSRole', { v0: member.name })} className={cn('fob-action', styles.role)} data-surface="plain">{labels[member.role]}<CaretDown size={12} aria-hidden /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuRadioGroup value={member.role} onValueChange={value => void changeRole(member, value as MemberRole)}>
                    {roles.map(role => <DropdownMenuRadioItem key={role} value={role} disabled={busy}>{labels[role]}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu> : <span className={styles.role}>{labels[member.role]}</span>}</td>
              <td className={styles.actions}>{manageable ? <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" disabled={busy} className={cn('fob-action', styles.action)} data-surface="plain" aria-label={t('memberActions', { name: member.name })}><DotsThree size={16} aria-hidden /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40"><DropdownMenuItem variant="destructive" onSelect={() => setRemovingMember(member)}><Trash size={14} aria-hidden />{t('removeMember')}</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu> : null}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {filtered.length === 0 ? <div className={styles.noResults} role="status"><h3>{t('noResults')}</h3><p>{t('tryAnotherSearch')}</p><Button variant="outline" size="sm" onClick={() => { setSearch(''); setRoleFilter('all'); }}>{t('clearFilters')}</Button></div> : null}
      <p className={styles.footer} role="status">{t('showingMembers', { visible: filtered.length, total: members.length })}</p>
    </ListStateShell>
    <ConfirmDialog open={removingMember !== null} onClose={() => { if (!removeMutation.isPending) setRemovingMember(null); }} onConfirm={() => void removeMember()} busy={removeMutation.isPending} title={t('removeMember')} confirmLabel={t('remove')}
      body={removingMember ? <>{t('remove2')}<strong className="font-semibold text-[var(--ink)]">{removingMember.name}</strong>（{removingMember.email}{t('fromThisKnowledgeBaseAccessWillBeRevoked')}</> : null} />
  </div>;
}
