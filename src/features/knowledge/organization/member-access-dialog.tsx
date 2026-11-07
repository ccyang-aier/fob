'use client';

import { useDeferredValue, useRef, useState } from 'react';
import { Check, FileText, FolderOutline } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberResourceAccess, ResourcePermission } from '@fob/shared/knowledge/contracts';
import type { MemberRow } from './list-mutations';
import { DirectorySelect } from './directory-select';
import { DirectorySearch, PermissionBadge, RoleLabel } from './management-ui';
import { DialogButton, ListStateShell, ModalDialog } from './ui';
import { useMemberAccess, useUpdateMemberAccess } from './member-access-data';
import { organizationErrorTextOf } from './errors';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export function MemberAccessDialog({ knowledgeBaseId, member, onClose, notify }: {
  knowledgeBaseId: string; member: MemberRow; onClose: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
}) {
  const { t } = useTranslation(managementMessages);
  const [kind, setKind] = useState<'folder' | 'document'>('folder');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const query = useMemberAccess({ knowledgeBaseId, userId: member.userId, kind, query: deferred, limit: 50 });
  const update = useUpdateMemberAccess(knowledgeBaseId);
  const pending = useRef(false);
  const rows = query.data?.pages.flatMap(page => page.items) ?? [];
  const sources = { direct: t('sourceDirect'), inherited: t('sourceInherited'), default: t('sourceBaseline'), none: t('sourceNone'), rebuilding: t('sourceRebuilding') };
  const options = [
    { value: 'inherit', label: t('retainInherited') },
    { value: 'view', label: t('view'), description: t('viewDescription') },
    { value: 'edit', label: t('edit'), description: t('editDescription') },
    { value: 'full', label: t('full'), description: t('fullDescription') },
  ];
  async function change(row: MemberResourceAccess, value: string) {
    if (pending.current) return;
    pending.current = true;
    try {
      await update.mutateAsync({ knowledgeBaseId, userId: member.userId, kind: row.kind, resourceId: row.id,
        expectedRevision: row.revision, level: value === 'inherit' ? null : value as ResourcePermission });
      notify('success', t('memberAccessSaved'));
    } catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { pending.current = false; }
  }
  return <ModalDialog open width="w-[760px]" title={t('memberAccessFor', { name: member.name })}
    footerStyle={{ paddingTop: 12 }}
    onClose={() => { if (!pending.current) onClose(); }} footer={<DialogButton onClick={onClose} disabled={update.isPending}><Check size={16} aria-hidden />{t('close')}</DialogButton>}>
    <div className={styles.accessProfile}><UserAvatar name={member.name} image={member.image} className={styles.accessAvatar} />
      <div className={styles.identity}><span className={styles.name}>{member.name}</span><span className={styles.email}>{member.email}</span></div>
      <RoleLabel role={member.role} />
    </div>
    <div className={styles.accessToolbar}>
      <div className={styles.subtabs} role="tablist" aria-label={t('resourceAccess')} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'folder' : event.key === 'End' ? 'document' : kind === 'folder' ? 'document' : 'folder';
        setKind(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
      }}>
        {(['folder', 'document'] as const).map(value => <button key={value} type="button" role="tab" data-kind={value}
          id={`member-access-${value}-tab`} aria-controls="member-access-results" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1}
          className={cn('fob-action', styles.subtab)} onClick={() => setKind(value)}>{t(value === 'folder' ? 'folders' : 'documents')}</button>)}
      </div>
      <DirectorySearch label={t('searchResources')} clearLabel={t('clearSearch')} value={search} onChange={setSearch} />
    </div>
    <div id="member-access-results" role="tabpanel" aria-labelledby={`member-access-${kind}-tab`} className={styles.accessResults}>
      <ListStateShell state={query.isError ? 'error' : query.isPending ? 'loading' : rows.length ? 'ready' : 'empty'}
        error={query.error} onRetry={() => void query.refetch()} emptyTitle={t('noMemberResources')}>
        <div className={styles.tableWrap}><table className={cn(styles.table, styles.accessTable)} aria-label={t('resourceAccess')}>
          <thead><tr><th scope="col">{t('resource')}</th><th scope="col">{t('effectiveAccess')}</th><th scope="col">{t('individualAccess')}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td><div className={styles.resourceName}>{row.kind === 'folder' ? <FolderOutline size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
              <div className={styles.identity}><span className={styles.name} title={row.name}>{row.name || t('untitledResource')}</span>{row.folderName ? <span className={styles.email}>{row.folderName}</span> : null}</div></div></td>
            <td><span className={styles.accessMobileLabel} aria-hidden>{t('effectiveAccess')}</span><div className={styles.identity}><PermissionBadge level={row.effective} /><span className={styles.accessSource}>{sources[row.source]}</span></div></td>
            <td><span className={styles.accessMobileLabel} aria-hidden>{t('individualAccess')}</span><DirectorySelect label={t('accessFor', { name: row.name || t('untitledResource') })} compact
              value={row.direct ?? 'inherit'} options={options} disabled={!row.canManage || update.isPending || row.source === 'rebuilding'}
              valueDisplay={row.direct ? <PermissionBadge level={row.direct} /> : <span className={styles.inheritValue}>{t('retainInherited')}</span>}
              onChange={value => void change(row, value)} /></td>
          </tr>)}</tbody>
        </table></div>
      </ListStateShell>
      {query.hasNextPage ? <div className={styles.accessMore}><Button size="sm" variant="ghost" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('loadMoreResources')}</Button></div> : null}
    </div>
    <p className={styles.hint}>{t('memberAccessHint')}</p>
  </ModalDialog>;
}
