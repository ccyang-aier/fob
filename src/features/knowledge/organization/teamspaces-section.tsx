'use client';

import { useState, type CSSProperties } from 'react';
import { CaretDown, CaretRight, Eye, FolderOutline, ShieldCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberRole } from './client';
import { useMembersQuery } from './hooks';
import { useFolderAccessQuery } from './management-data';
import { DirectorySearch, PermissionBadge } from './management-ui';
import { AddFolderGrantDialog, EffectiveFolderAccessDialog, FolderPolicyDialog } from './folder-access-dialogs';
import { folderRows } from './folder-access-model';
import { ListStateShell, flattenPages } from './ui';
import type { MemberRow } from './list-mutations';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export function TeamspacesSection({ knowledgeBaseId, actorRole, notify }: {
  knowledgeBaseId: string; actorRole: MemberRole; notify: (kind: 'success' | 'error', message: string) => void;
}) {
  const { t } = useTranslation(managementMessages);
  const query = useFolderAccessQuery(knowledgeBaseId);
  const membersQuery = useMembersQuery(knowledgeBaseId);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: 'policy'; id: string } | { kind: 'add' | 'effective' } | null>(null);
  const folders = query.data ?? [];
  const members = flattenPages<MemberRow>(membersQuery.data).sort((a, b) => a.name.localeCompare(b.name));
  const columns = members.slice(0, 3);
  const rows = folderRows(folders, search.trim(), collapsed);
  const canManage = actorRole === 'owner' || actorRole === 'admin';
  const currentFolder = dialog?.kind === 'policy' ? folders.find((folder) => folder.teamspaceId === dialog.id) : null;
  const error = query.error ?? membersQuery.error;
  const state = query.isError || membersQuery.isError ? 'error' : query.isPending || membersQuery.isPending ? 'loading' : folders.length ? 'ready' : 'empty';
  const ready = state === 'ready';
  const inherit = <span className={styles.inherited}><span aria-hidden>↳</span>{t('inherited')}</span>;
  return <div className={styles.page}>
    <header className={styles.header}><h1 className={styles.title}>{t('folderPermissions')}</h1></header>
    <div className={styles.toolbar}>
      <DirectorySearch value={search} onChange={setSearch} label={t('searchFolders')} clearLabel={t('clearSearch')} />
      <div className={styles.toolbarActions}>
        <Button variant="outline" size="sm" className={styles.button} disabled={!ready || !members.length} onClick={() => setDialog({ kind: 'effective' })}><Eye size={16} aria-hidden />{t('effectivePermissions')}</Button>
        {canManage ? <Button size="sm" className={styles.button} disabled={!ready || !members.length} onClick={() => setDialog({ kind: 'add' })}><ShieldCheck size={16} aria-hidden />{t('addGrant')}</Button> : null}
      </div>
    </div>
    <ListStateShell state={state} error={error} onRetry={() => { void query.refetch(); void membersQuery.refetch(); }} emptyTitle={t('noFolders')}>
      <div className={styles.tableWrap}><table className={cn(styles.table, styles.matrix)} aria-label={t('folderPermissions')}><thead><tr>
        <th scope="col">{t('folder')}</th><th scope="col">{t('ordinaryMembers')}</th>{columns.map((member) => <th scope="col" key={member.userId} title={member.email}>{member.name}</th>)}<th scope="col">{t('exceptions')}</th>
      </tr></thead><tbody>{rows.map(({ folder, depth, hasChildren }) => <tr key={folder.teamspaceId}>
        <td><div className={cn(styles.folderCell, depth > 0 && styles.treeChild)} style={{ '--depth': depth } as CSSProperties}>
          {hasChildren ? <button type="button" className={cn('fob-action', styles.treeToggle)} data-variant="text" aria-expanded={!collapsed.has(folder.teamspaceId)} aria-label={t(collapsed.has(folder.teamspaceId) ? 'expandFolder' : 'collapseFolder', { name: folder.name })} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(folder.teamspaceId)) next.delete(folder.teamspaceId); else next.add(folder.teamspaceId); return next; })}>{collapsed.has(folder.teamspaceId) ? <CaretRight size={12} aria-hidden /> : <CaretDown size={12} aria-hidden />}</button> : <span className={styles.treeSpace} />}
          <FolderOutline size={16} aria-hidden className={styles.folderIcon} /><button type="button" className={cn('fob-action', styles.folderNameButton)} data-variant="text" onClick={() => setDialog({ kind: 'policy', id: folder.teamspaceId })} title={folder.name}><span className={styles.folderName}>{folder.name}</span></button>
        </div></td>
        <td><button type="button" className={cn('fob-action', styles.cellButton)} data-surface="plain" aria-label={`${folder.name} · ${t('defaultAccess')}`} onClick={() => setDialog({ kind: 'policy', id: folder.teamspaceId })}>{folder.inheritsAccess ? inherit : <PermissionBadge level={folder.defaultAccess} />}</button></td>
        {columns.map((member) => {
          const direct = folder.explicit.find((grant) => grant.userId === member.userId);
          const inherited = folder.grants.find((grant) => grant.userId === member.userId);
          return <td key={member.userId}><button type="button" className={cn('fob-action', styles.cellButton)} data-surface="plain" aria-label={`${folder.name} · ${member.name}`} onClick={() => setDialog({ kind: 'policy', id: folder.teamspaceId })}>{direct ? <PermissionBadge level={direct.level} /> : inherited ? inherit : <PermissionBadge level={null} />}</button></td>;
        })}
        <td><button type="button" className={cn('fob-action', styles.cellButton, styles.exceptions)} data-surface="plain" aria-label={`${folder.name} · ${t('exceptions')}`} onClick={() => setDialog({ kind: 'policy', id: folder.teamspaceId })}>{t('exceptionCount', { count: folder.explicit.length })}<CaretRight size={12} aria-hidden /></button></td>
      </tr>)}</tbody></table>{!rows.length ? <div className={styles.empty}>{t('noResults')}<Button variant="ghost" size="sm" onClick={() => setSearch('')}>{t('clearFilters')}</Button></div> : null}</div>
      <p className={cn(styles.footer, styles.legend)}><span>— {t('noAccess')}</span><span>↳ {t('inheritsParent')}</span><span>{t('individualColumnsHint')}</span>{members.length > 3 ? <span>{t('columnsHint')}</span> : null}</p>
    </ListStateShell>
    {currentFolder ? <FolderPolicyDialog key={currentFolder.teamspaceId} folder={currentFolder} folders={folders} members={members} canManage={canManage} onClose={() => setDialog(null)} notify={notify} /> : null}
    {dialog?.kind === 'add' ? <AddFolderGrantDialog knowledgeBaseId={knowledgeBaseId} folders={folders} members={members} onClose={() => setDialog(null)} notify={notify} /> : null}
    {dialog?.kind === 'effective' ? <EffectiveFolderAccessDialog folders={folders} members={members} onClose={() => setDialog(null)} /> : null}
  </div>;
}
