'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';
import { CaretDown, DotsThree, SelectionCheck, ShieldCheck, Trash, UserPlus, UsersThree, X } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIdentity } from '@/features/identity/identity-context';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePageVisible } from '@/lib/page-visibility';
import { memberRoles, type MemberRole } from './client';
import { useChangeMemberRoleMutation, useMembersQuery, useRemoveMemberMutation } from './hooks';
import { useBulkMemberRoleMutation, useInvitationsQuery } from './management-data';
import type { MemberRow } from './list-mutations';
import { assignableRoles, canManageMember, memberRoleLabels } from './view-model';
import { ConfirmDialog, ListStateShell, flattenPages, queryListState } from './ui';
import { DirectorySearch, RoleLabel, RoleMenuItems, TableCheck } from './management-ui';
import { MemberInvitationDialog } from './member-invitation-dialog';
import { MemberAccessDialog } from './member-access-dialog';
import { invitationClient } from './invitation-client';
import { organizationErrorTextOf } from './errors';
import { organizationQueryKeys } from './keys';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export function MembersSection({ knowledgeBaseId, actorRole, notify, onMembershipChange }: {
  knowledgeBaseId: string; actorRole: MemberRole; notify: (kind: 'success' | 'error', text: string) => void;
  onMembershipChange?: () => void;
}) {
  if (actorRole !== 'owner') return <ListStateShell state="forbidden" emptyTitle="">{null}</ListStateShell>;
  return <OwnerMembersSection knowledgeBaseId={knowledgeBaseId} actorRole={actorRole} notify={notify} onMembershipChange={onMembershipChange} />;
}

function OwnerMembersSection({ knowledgeBaseId, actorRole, notify, onMembershipChange }: {
  knowledgeBaseId: string; actorRole: MemberRole; notify: (kind: 'success' | 'error', text: string) => void;
  onMembershipChange?: () => void;
}) {
  const { locale, t } = useTranslation(managementMessages);
  const { session } = useIdentity();
  const visible = usePageVisible();
  const client = useQueryClient();
  const membersQuery = useMembersQuery(knowledgeBaseId);
  const invitationsQuery = useInvitationsQuery(knowledgeBaseId, actorRole === 'owner');
  const changeRole = useChangeMemberRoleMutation(knowledgeBaseId);
  const bulkRole = useBulkMemberRoleMutation(knowledgeBaseId);
  const removeMutation = useRemoveMemberMutation(knowledgeBaseId);
  const [tab, setTab] = useState<'joined' | 'pending'>('joined');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<MemberRole[]>([]);
  const [sort, setSort] = useState<{ field: 'name' | 'joinedAt'; direction: 'ascending' | 'descending' }>({ field: 'name', direction: 'ascending' });
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const [roleChange, setRoleChange] = useState<{ ids: string[]; role: MemberRole } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [revoking, setRevoking] = useState<KnowledgeBaseInvitation | null>(null);
  const [revokingBusy, setRevokingBusy] = useState(false);
  const [invite, setInvite] = useState<{ email: string; reissue: boolean } | null>(null);
  const actionPending = useRef(false);
  const members = flattenPages<MemberRow>(membersQuery.data);
  const owners = members.filter((member) => member.role === 'owner').length;
  const isManager = actorRole === 'owner';
  const manageable = (member: MemberRow) => canManageMember(actorRole)
    && !(session.status === 'authenticated' && member.userId === session.user.id) && !(member.role === 'owner' && owners === 1);
  const canInspect = (member: MemberRow) => isManager || session.status === 'authenticated' && member.userId === session.user.id;
  const inspectingMember = members.find(member => member.userId === accessUserId);
  const selectedIds = selected.filter((id) => members.some((member) => member.userId === id && manageable(member)));
  const normalized = search.trim().toLocaleLowerCase(locale);
  const filtered = members.filter((member) => (!roleFilter.length || roleFilter.includes(member.role))
    && `${member.name}\n${member.email}`.toLocaleLowerCase(locale).includes(normalized)).sort((a, b) => {
      const order = sort.field === 'name' ? a.name.localeCompare(b.name, locale) : (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '');
      return (sort.direction === 'ascending' ? order : -order) || a.userId.localeCompare(b.userId);
    });
  const selectable = filtered.filter(manageable).slice(0, 100);
  const allSelected = selectable.length > 0 && selectable.every((member) => selectedIds.includes(member.userId));
  const invitations = (invitationsQuery.data ?? []).filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt);
  const activeInvitations = invitations.filter((invitation) => Date.parse(invitation.expiresAt) > invitationsQuery.dataUpdatedAt);
  const visibleInvitations = invitations.filter((invitation) => invitation.email.toLocaleLowerCase(locale).includes(normalized))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const busy = changeRole.isPending || bulkRole.isPending || removeMutation.isPending;
  const roles = assignableRoles(actorRole);
  const labels = memberRoleLabels(locale);
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '—';
  const toggleSort = (field: typeof sort.field) => setSort(current => ({ field, direction: current.field === field && current.direction === 'ascending' ? 'descending' : 'ascending' }));

  async function updateRoles(ids: string[], role: MemberRole) {
    if (!ids.length || actionPending.current) return;
    actionPending.current = true;
    try {
      if (ids.length === 1) await changeRole.mutateAsync({ userId: ids[0]!, role });
      else await bulkRole.mutateAsync({ userIds: ids, role });
      setSelected([]); setRoleChange(null); notify('success', t('changed')); onMembershipChange?.();
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

  return <div className={styles.page} data-selecting={selectedIds.length > 0 || undefined} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !busy) setSelected([]);
  }}>
    <header className={styles.header}><h1 className={styles.title}>{t('members')}{membersQuery.isSuccess ? <span className={styles.count}>{t('memberCount', { count: members.length })}</span> : null}</h1>
      {isManager ? <Button size="sm" className={styles.button} onClick={() => setInvite({ email: '', reissue: false })}><UserPlus size={16} aria-hidden />{t('invite')}</Button> : null}
    </header>
    <div className={styles.toolbar}>
      <div className={styles.subtabs} role="tablist" aria-label={t('members')} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || actorRole !== 'owner') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'joined' : event.key === 'End' ? 'pending' : tab === 'joined' ? 'pending' : 'joined';
        setTab(next); if (next === 'pending') setSelected([]);
        event.currentTarget.querySelector<HTMLButtonElement>(`#members-${next}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id="members-joined-tab" aria-selected={tab === 'joined'} tabIndex={tab === 'joined' ? 0 : -1} aria-controls="members-table-panel" className={cn('fob-action', styles.subtab)} onClick={() => { setTab('joined'); void membersQuery.refetch(); }}><span>{t('joined')}</span>{membersQuery.isSuccess ? <span className={styles.tabCount}>{members.length}</span> : null}</button>
        {actorRole === 'owner' ? <button type="button" role="tab" id="members-pending-tab" aria-selected={tab === 'pending'} tabIndex={tab === 'pending' ? 0 : -1} aria-controls="members-table-panel" className={cn('fob-action', styles.subtab)} onClick={() => { setTab('pending'); setSelected([]); void invitationsQuery.refetch(); }}><span>{t('pending')}</span>{invitationsQuery.isSuccess ? <span className={styles.tabCount}>{activeInvitations.length}</span> : null}</button> : null}
      </div>
      <div className={styles.directoryFilters}>
        {tab === 'joined' ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" className={styles.button} aria-label={t('workspaceRole')} data-surface="plain">{!roleFilter.length ? t('allRoles') : roleFilter.length === 1 ? labels[roleFilter[0]!] : t('selectedRoles', { count: roleFilter.length })}<CaretDown size={12} aria-hidden /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.roleFilterMenu}>
            <DropdownMenuCheckboxItem checked={!roleFilter.length} indicator="none" onSelect={event => event.preventDefault()} onCheckedChange={() => setRoleFilter([])}>
              <span className={styles.check} data-checked={!roleFilter.length || undefined} aria-hidden>{!roleFilter.length ? <SelectionCheck /> : null}</span>{t('allRoles')}
            </DropdownMenuCheckboxItem>
            {memberRoles.map(role => <DropdownMenuCheckboxItem key={role} checked={roleFilter.includes(role)} indicator="none" onSelect={event => event.preventDefault()} onCheckedChange={() => setRoleFilter(current => { const next = current.includes(role) ? current.filter(item => item !== role) : [...current, role]; return next.length === memberRoles.length ? [] : next; })}>
              <span className={styles.check} data-checked={roleFilter.includes(role) || undefined} aria-hidden>{roleFilter.includes(role) ? <SelectionCheck /> : null}</span><RoleLabel role={role} />
            </DropdownMenuCheckboxItem>)}
          </DropdownMenuContent></DropdownMenu> : null}
        <DirectorySearch value={search} onChange={setSearch} label={t('searchMembers')} clearLabel={t('clearSearch')} />
      </div>
    </div>
    <div id="members-table-panel" role="tabpanel" aria-labelledby={tab === 'joined' ? 'members-joined-tab' : 'members-pending-tab'}>
      {tab === 'joined' ? <ListStateShell state={queryListState(membersQuery)} error={membersQuery.error} onRetry={() => void membersQuery.refetch()} emptyTitle={t('noMembers')}>
        <div className={styles.tableWrap}><table className={cn(styles.table, styles.memberTable)} aria-label={t('members')}><thead><tr>
          <th className={styles.checkCell}><TableCheck label={t('selectAll')} checked={allSelected} mixed={!allSelected && selectedIds.length > 0} disabled={!selectable.length || busy} onChange={() => setSelected(allSelected ? [] : selectable.map((member) => member.userId))} /></th>
          <th scope="col" aria-sort={sort.field === 'name' ? sort.direction : 'none'}><button type="button" className={cn('fob-action', styles.columnSort)} data-surface="plain" aria-label={t('sortName')} onClick={() => toggleSort('name')}>{t('members')}{sort.field === 'name' ? <CaretDown size={12} aria-hidden data-direction={sort.direction} /> : null}</button></th>{isManager ? <th scope="col">{t('email')}</th> : null}
          <th scope="col" aria-sort={sort.field === 'joinedAt' ? sort.direction : 'none'}><button type="button" className={cn('fob-action', styles.columnSort)} data-surface="plain" aria-label={t('sortJoined')} onClick={() => toggleSort('joinedAt')}>{t('joinedAt')}{sort.field === 'joinedAt' ? <CaretDown size={12} aria-hidden data-direction={sort.direction} /> : null}</button></th><th scope="col" title={t('workspaceRoleHint')}>{t('workspaceRole')}</th><th scope="col">{t('resourceAccess')}</th><th scope="col" className={styles.actions}><span className="sr-only">{t('actions')}</span></th>
        </tr></thead><tbody>{filtered.map((member) => <tr key={member.userId} data-selected={selectedIds.includes(member.userId) || undefined}>
          <td className={styles.checkCell}><TableCheck label={t('selectMember', { name: member.name })} checked={selectedIds.includes(member.userId)} disabled={!manageable(member) || busy || (selectedIds.length >= 100 && !selectedIds.includes(member.userId))}
            onChange={() => setSelected(selectedIds.includes(member.userId) ? selectedIds.filter((id) => id !== member.userId) : [...selectedIds, member.userId])} /></td>
          <td><div className={styles.person}><UserAvatar name={member.name} image={member.image} className={styles.avatar} /><span className={styles.name}>
            {canInspect(member) ? <button type="button" className={cn('fob-action', styles.memberName)} data-variant="text" onClick={() => setAccessUserId(member.userId)}>{member.name}</button> : member.name}
            {session.status === 'authenticated' && member.userId === session.user.id ? <span className={styles.self}>{t('you')}</span> : null}</span></div></td>
          {isManager ? <td className={styles.memberEmail} title={member.email}>{member.email}</td> : null}
          <td className={styles.date}>{formatDate(member.joinedAt)}</td><td><RoleLabel role={member.role} /></td>
          <td>{canInspect(member) ? <button type="button" className={cn('fob-action', styles.resourceAccessButton)} data-surface="plain" aria-label={t('inspectMemberAccess', { name: member.name })} onClick={() => setAccessUserId(member.userId)}><ShieldCheck size={14} aria-hidden />{member.directAccessCount == null ? t('inspectAccess') : t('individualAccessCount', { count: member.directAccessCount })}</button> : <span className={styles.none}>—</span>}</td>
          <td className={styles.actions}>{manageable(member) ? <DropdownMenu><DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={t('actionsFor', { name: member.name })} className={cn('fob-action', styles.rowAction)} data-surface="plain"><DotsThree size={18} aria-hidden /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAccessUserId(member.userId)}><ShieldCheck size={14} aria-hidden />{t('resourceAccess')}</DropdownMenuItem>
            <DropdownMenuSub><DropdownMenuSubTrigger><UsersThree size={14} aria-hidden />{t('changeRole')}</DropdownMenuSubTrigger><DropdownMenuSubContent className={styles.roleMenu}><RoleMenuItems roles={roles} value={member.role} onChange={role => setRoleChange({ ids: [member.userId], role })} /></DropdownMenuSubContent></DropdownMenuSub>
            <DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}><Trash size={14} aria-hidden />{t('removeMember')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu> : null}</td>
        </tr>)}</tbody></table>{!filtered.length ? <div className={styles.empty}>{t('noResults')}<Button variant="ghost" size="sm" onClick={() => { setSearch(''); setRoleFilter([]); }}>{t('clearFilters')}</Button></div> : null}</div>
      </ListStateShell> : invitationsQuery.isPending ? <ListStateShell state="loading" emptyTitle={t('noInvitations')}>{null}</ListStateShell> : invitationsQuery.isError ? <ListStateShell state="error" error={invitationsQuery.error} onRetry={() => void invitationsQuery.refetch()} emptyTitle={t('noInvitations')}>{null}</ListStateShell> : <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={t('pending')}><thead><tr><th scope="col">{t('email')}</th><th scope="col">{t('role')}</th><th scope="col">{t('invitedAt')}</th><th scope="col">{t('invitationStatus')}</th><th scope="col" className={styles.actions}><span className="sr-only">{t('actions')}</span></th></tr></thead>
          <tbody>{visibleInvitations.map((invitation) => <tr key={invitation.id}><td><span className={styles.name}>{invitation.email}</span><span className={styles.email}>{t('expiresAt')} {formatDate(invitation.expiresAt)}</span></td><td><RoleLabel role={invitation.role} /></td><td className={styles.date}>{formatDate(invitation.createdAt)}</td><td className={styles.date}>{Date.parse(invitation.expiresAt) > invitationsQuery.dataUpdatedAt ? t('waiting') : t('expired')}</td>
            <td className={styles.actions}><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={cn('fob-action', styles.rowAction)} data-surface="plain" aria-label={t('actionsFor', { name: invitation.email })}><DotsThree size={18} aria-hidden /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
              {canManageMember(actorRole) ? <DropdownMenuItem onSelect={() => setInvite({ email: invitation.email, reissue: true })}>{t('reissue')}</DropdownMenuItem> : null}<DropdownMenuItem variant="destructive" disabled={!canManageMember(actorRole)} onSelect={() => setRevoking(invitation)}>{t('revoke')}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu></td></tr>)}</tbody></table>
        {!visibleInvitations.length ? <div className={styles.empty}>{search ? t('noResults') : t('noInvitations')}</div> : null}
      </div>}
    </div>
    {tab === 'joined' && membersQuery.isSuccess ? <p className={styles.footer} role="status">{search || roleFilter.length ? t('showing', { visible: filtered.length, total: members.length }) : t('total', { count: members.length })}</p> : tab === 'pending' && invitationsQuery.isSuccess ? <p className={styles.footer}>{t('invitationCount', { count: invitations.length })}</p> : null}
    {tab === 'joined' && selectedIds.length > 0 && visible && !invite && !removing && !revoking && !inspectingMember && !roleChange ? createPortal(
      <div className={styles.bulkPosition}><div className={styles.bulk} role="toolbar" aria-label={t('selected', { count: selectedIds.length })}>
        <strong aria-live="polite">{t('selected', { count: selectedIds.length })}</strong><span className={styles.bulkSeparator} aria-hidden />
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" disabled={busy} className={styles.bulkAction} data-surface="plain"><UsersThree size={16} aria-hidden />{t('changeRole')}<CaretDown size={12} aria-hidden /></Button></DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className={styles.roleMenu}><RoleMenuItems roles={roles} onChange={role => setRoleChange({ ids: selectedIds, role })} /></DropdownMenuContent>
        </DropdownMenu>
        <span className={styles.bulkSeparator} aria-hidden />
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={styles.bulkClear} data-surface="plain" disabled={busy} onClick={() => setSelected([])} aria-label={t('cancelSelection')}><X size={16} aria-hidden /><span className="sr-only">{t('cancelSelection')}</span></Button></TooltipTrigger><TooltipContent>{t('cancelSelection')}</TooltipContent></Tooltip>
      </div></div>, document.body,
    ) : null}
    {invite ? <MemberInvitationDialog key={invite.email} knowledgeBaseId={knowledgeBaseId} members={members} {...invite} onClose={() => setInvite(null)} notify={notify} /> : null}
    {inspectingMember ? <MemberAccessDialog key={inspectingMember.userId} knowledgeBaseId={knowledgeBaseId} member={inspectingMember} onClose={() => setAccessUserId(null)} notify={notify} /> : null}
    <ConfirmDialog open={!!roleChange} onClose={() => { if (!actionPending.current) setRoleChange(null); }} onConfirm={() => { if (roleChange) void updateRoles(roleChange.ids, roleChange.role); }} busy={changeRole.isPending || bulkRole.isPending}
      danger={false} title={t('changeRole')} confirmLabel={t('save')} body={t('roleChangeBody', { count: roleChange?.ids.length ?? 0, role: roleChange ? labels[roleChange.role] : '' })} />
    <ConfirmDialog open={!!removing} onClose={() => { if (!actionPending.current) setRemoving(null); }} onConfirm={() => void removeMember()} busy={removeMutation.isPending} title={t('removeMember')} confirmLabel={t('remove')} body={t('removeBody', { name: removing?.name ?? '' })} />
    <ConfirmDialog open={!!revoking} onClose={() => { if (!actionPending.current) setRevoking(null); }} onConfirm={() => void revoke()} busy={revokingBusy} title={t('revoke')} confirmLabel={t('revoke')} body={t('revokeBody', { email: revoking?.email ?? '' })} />
  </div>;
}
