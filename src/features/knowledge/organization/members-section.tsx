'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';
import { CaretDown, DotsThree, Trash, UserPlus, UsersThree } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIdentity } from '@/features/identity/identity-context';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberRole } from './client';
import { useChangeMemberRoleMutation, useMembersQuery, useRemoveMemberMutation } from './hooks';
import { useBulkMemberRoleMutation, useInvitationsQuery } from './management-data';
import type { MemberRow } from './list-mutations';
import { assignableRoles, canManageMember, memberRoleLabels } from './view-model';
import { ConfirmDialog, ListStateShell, flattenPages, queryListState } from './ui';
import { DirectorySearch, RoleLabel, TableCheck } from './management-ui';
import { MemberInvitationDialog } from './member-invitation-dialog';
import { invitationClient } from './invitation-client';
import { organizationErrorTextOf } from './errors';
import { organizationQueryKeys } from './keys';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

const roleOrder: MemberRole[] = ['owner', 'admin', 'member', 'guest'];

export function MembersSection({ knowledgeBaseId, actorRole, notify, onMembershipChange }: {
  knowledgeBaseId: string; actorRole: MemberRole; notify: (kind: 'success' | 'error', text: string) => void;
  onMembershipChange?: () => void;
}) {
  const { locale, t } = useTranslation(managementMessages);
  const { session } = useIdentity();
  const client = useQueryClient();
  const membersQuery = useMembersQuery(knowledgeBaseId);
  const invitationsQuery = useInvitationsQuery(knowledgeBaseId, actorRole === 'owner' || actorRole === 'admin');
  const changeRole = useChangeMemberRoleMutation(knowledgeBaseId);
  const bulkRole = useBulkMemberRoleMutation(knowledgeBaseId);
  const removeMutation = useRemoveMemberMutation(knowledgeBaseId);
  const [tab, setTab] = useState<'joined' | 'pending'>('joined');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [revoking, setRevoking] = useState<KnowledgeBaseInvitation | null>(null);
  const [revokingBusy, setRevokingBusy] = useState(false);
  const [invite, setInvite] = useState<{ email: string; reissue: boolean } | null>(null);
  const actionPending = useRef(false);
  const members = flattenPages<MemberRow>(membersQuery.data);
  const owners = members.filter((member) => member.role === 'owner').length;
  const manageable = (member: MemberRow) => canManageMember(actorRole, member.role) && !(member.role === 'owner' && owners === 1);
  const selectedIds = selected.filter((id) => members.some((member) => member.userId === id && manageable(member)));
  const normalized = search.trim().toLocaleLowerCase(locale);
  const filtered = members.filter((member) => `${member.name}\n${member.email}`.toLocaleLowerCase(locale).includes(normalized))
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, locale));
  const selectable = filtered.filter(manageable).slice(0, 100);
  const allSelected = selectable.length > 0 && selectable.every((member) => selectedIds.includes(member.userId));
  const invitations = (invitationsQuery.data ?? []).filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt);
  const activeInvitations = invitations.filter((invitation) => Date.parse(invitation.expiresAt) > invitationsQuery.dataUpdatedAt);
  const visibleInvitations = invitations.filter((invitation) => invitation.email.toLocaleLowerCase(locale).includes(normalized))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const busy = changeRole.isPending || bulkRole.isPending || removeMutation.isPending;
  const labels = memberRoleLabels(locale);
  const roles = assignableRoles(actorRole);
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '—';

  async function updateRoles(ids: string[], role: MemberRole) {
    if (!ids.length || actionPending.current) return;
    actionPending.current = true;
    try {
      if (ids.length === 1) await changeRole.mutateAsync({ userId: ids[0]!, role });
      else await bulkRole.mutateAsync({ userIds: ids, role });
      setSelected([]); notify('success', t('changed')); onMembershipChange?.();
    } catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { actionPending.current = false; }
  }
  async function removeMember() {
    if (!removing || actionPending.current) return;
    actionPending.current = true;
    try { await removeMutation.mutateAsync(removing.userId); setRemoving(null); notify('success', t('removed')); onMembershipChange?.(); }
    catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { actionPending.current = false; }
  }
  async function revoke() {
    if (!revoking || actionPending.current) return;
    actionPending.current = true; setRevokingBusy(true);
    try {
      await invitationClient.revoke(knowledgeBaseId, revoking.id);
      await client.invalidateQueries({ queryKey: organizationQueryKeys.invitations(knowledgeBaseId) });
      setRevoking(null); notify('success', t('revoked'));
    } catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { actionPending.current = false; setRevokingBusy(false); }
  }

  return <div className={styles.page}>
    <header className={styles.header}><h1 className={styles.title}>{t('members')}{membersQuery.isSuccess ? <span className={styles.count}>{t('memberCount', { count: members.length })}</span> : null}</h1>
      {actorRole === 'owner' ? <Button size="sm" className={styles.button} onClick={() => setInvite({ email: '', reissue: false })}><UserPlus size={16} aria-hidden />{t('invite')}</Button> : null}
    </header>
    <div className={styles.toolbar}>
      <div className={styles.subtabs} role="tablist" aria-label={t('members')} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !['owner', 'admin'].includes(actorRole)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'joined' : event.key === 'End' ? 'pending' : tab === 'joined' ? 'pending' : 'joined';
        setTab(next); if (next === 'pending') setSelected([]);
        event.currentTarget.querySelector<HTMLButtonElement>(`#members-${next}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id="members-joined-tab" aria-selected={tab === 'joined'} tabIndex={tab === 'joined' ? 0 : -1} aria-controls="members-table-panel" className={cn('fob-action', styles.subtab)} onClick={() => { setTab('joined'); void membersQuery.refetch(); }}>{t('joined')} {membersQuery.isSuccess ? members.length : ''}</button>
        {actorRole === 'owner' || actorRole === 'admin' ? <button type="button" role="tab" id="members-pending-tab" aria-selected={tab === 'pending'} tabIndex={tab === 'pending' ? 0 : -1} aria-controls="members-table-panel" className={cn('fob-action', styles.subtab)} onClick={() => { setTab('pending'); setSelected([]); void invitationsQuery.refetch(); }}>{t('pending')} {invitationsQuery.isSuccess ? activeInvitations.length : ''}</button> : null}
      </div>
      <DirectorySearch value={search} onChange={setSearch} label={t('searchMembers')} clearLabel={t('clearSearch')} />
    </div>
    {tab === 'joined' && selectedIds.length ? <div className={styles.bulk} role="region" aria-label={t('selected', { count: selectedIds.length })}>
      <strong>{t('selected', { count: selectedIds.length })}</strong>
      <DropdownMenu><DropdownMenuTrigger asChild><button type="button" disabled={busy} className="fob-action" data-surface="plain"><UsersThree size={16} aria-hidden />{t('changeRole')}<CaretDown size={12} aria-hidden /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">{roles.map((role) => <DropdownMenuItem key={role} onSelect={() => void updateRoles(selectedIds, role)}>{labels[role]}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className="fob-action" data-surface="plain" disabled={busy} onClick={() => setSelected([])}>{t('cancelSelection')}</button>
    </div> : null}
    <div id="members-table-panel" role="tabpanel" aria-labelledby={tab === 'joined' ? 'members-joined-tab' : 'members-pending-tab'}>
      {tab === 'joined' ? <ListStateShell state={queryListState(membersQuery)} error={membersQuery.error} onRetry={() => void membersQuery.refetch()} emptyTitle={t('noMembers')}>
        <div className={styles.tableWrap}><table className={cn(styles.table, styles.memberTable)} aria-label={t('members')}><thead><tr>
          <th className={styles.checkCell}><TableCheck label={t('selectAll')} checked={allSelected} mixed={!allSelected && selectedIds.length > 0} disabled={!selectable.length || busy} onChange={() => setSelected(allSelected ? [] : selectable.map((member) => member.userId))} /></th>
          <th scope="col">{t('members')}</th><th scope="col">{t('role')}</th><th scope="col">{t('joinedAt')}</th><th scope="col" className={styles.actions}><span className="sr-only">{t('actions')}</span></th>
        </tr></thead><tbody>{filtered.map((member) => <tr key={member.userId} data-selected={selectedIds.includes(member.userId) || undefined}>
          <td className={styles.checkCell}><TableCheck label={t('selectMember', { name: member.name })} checked={selectedIds.includes(member.userId)} disabled={!manageable(member) || busy || (selectedIds.length >= 100 && !selectedIds.includes(member.userId))}
            onChange={() => setSelected(selectedIds.includes(member.userId) ? selectedIds.filter((id) => id !== member.userId) : [...selectedIds, member.userId])} /></td>
          <td><div className={styles.person}><UserAvatar name={member.name} image={member.image} className={styles.avatar} /><div className={styles.identity}><span className={styles.name}>{member.name}{session.status === 'authenticated' && member.userId === session.user.id ? <span className={styles.self}>{t('you')}</span> : null}</span><span className={styles.email} title={member.email}>{member.email}</span></div></div></td>
          <td>{manageable(member) ? <DropdownMenu><DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={t('roleFor', { name: member.name })} className={cn('fob-action', styles.roleButton)} data-surface="plain"><RoleLabel role={member.role} /><CaretDown size={12} aria-hidden /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={member.role} onValueChange={(value) => { if (value !== member.role) void updateRoles([member.userId], value as MemberRole); }}>{roles.map((role) => <DropdownMenuRadioItem key={role} value={role}>{labels[role]}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu> : <RoleLabel role={member.role} />}</td>
          <td className={styles.date}>{formatDate(member.joinedAt)}</td><td className={styles.actions}>{manageable(member) ? <DropdownMenu><DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={t('actionsFor', { name: member.name })} className={cn('fob-action', styles.rowAction)} data-surface="plain"><DotsThree size={18} aria-hidden /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}><Trash size={14} aria-hidden />{t('removeMember')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</td>
        </tr>)}</tbody></table>{!filtered.length ? <div className={styles.empty}>{t('noResults')}<Button variant="ghost" size="sm" onClick={() => setSearch('')}>{t('clearFilters')}</Button></div> : null}</div>
      </ListStateShell> : invitationsQuery.isPending ? <ListStateShell state="loading" emptyTitle={t('noInvitations')}>{null}</ListStateShell> : invitationsQuery.isError ? <ListStateShell state="error" error={invitationsQuery.error} onRetry={() => void invitationsQuery.refetch()} emptyTitle={t('noInvitations')}>{null}</ListStateShell> : <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={t('pending')}><thead><tr><th scope="col">{t('email')}</th><th scope="col">{t('role')}</th><th scope="col">{t('invitedAt')}</th><th scope="col">{t('invitationStatus')}</th><th scope="col" className={styles.actions}><span className="sr-only">{t('actions')}</span></th></tr></thead>
          <tbody>{visibleInvitations.map((invitation) => <tr key={invitation.id}><td><span className={styles.name}>{invitation.email}</span><span className={styles.email}>{t('expiresAt')} {formatDate(invitation.expiresAt)}</span></td><td><RoleLabel role={invitation.role} /></td><td className={styles.date}>{formatDate(invitation.createdAt)}</td><td className={styles.date}>{Date.parse(invitation.expiresAt) > invitationsQuery.dataUpdatedAt ? t('waiting') : t('expired')}</td>
            <td className={styles.actions}><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={cn('fob-action', styles.rowAction)} data-surface="plain" aria-label={t('actionsFor', { name: invitation.email })}><DotsThree size={18} aria-hidden /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
              {actorRole === 'owner' ? <DropdownMenuItem onSelect={() => setInvite({ email: invitation.email, reissue: true })}>{t('reissue')}</DropdownMenuItem> : null}<DropdownMenuItem variant="destructive" disabled={!canManageMember(actorRole, invitation.role)} onSelect={() => setRevoking(invitation)}>{t('revoke')}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu></td></tr>)}</tbody></table>
        {!visibleInvitations.length ? <div className={styles.empty}>{search ? t('noResults') : t('noInvitations')}</div> : null}
      </div>}
    </div>
    {tab === 'joined' && membersQuery.isSuccess ? <p className={styles.footer} role="status">{search ? t('showing', { visible: filtered.length, total: members.length }) : t('total', { count: members.length })}</p> : tab === 'pending' && invitationsQuery.isSuccess ? <p className={styles.footer}>{t('invitationCount', { count: invitations.length })}</p> : null}
    {invite ? <MemberInvitationDialog key={invite.email} knowledgeBaseId={knowledgeBaseId} members={members} {...invite} onClose={() => setInvite(null)} notify={notify} /> : null}
    <ConfirmDialog open={!!removing} onClose={() => { if (!actionPending.current) setRemoving(null); }} onConfirm={() => void removeMember()} busy={removeMutation.isPending} title={t('removeMember')} confirmLabel={t('remove')} body={t('removeBody', { name: removing?.name ?? '' })} />
    <ConfirmDialog open={!!revoking} onClose={() => { if (!actionPending.current) setRevoking(null); }} onConfirm={() => void revoke()} busy={revokingBusy} title={t('revoke')} confirmLabel={t('revoke')} body={t('revokeBody', { email: revoking?.email ?? '' })} />
  </div>;
}
