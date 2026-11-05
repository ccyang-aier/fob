'use client';

import { useRef, useState } from 'react';
import { resourcePermission, type FolderAccessPolicy, type FolderMemberGrant, type PermissionLevel } from '@fob/shared/knowledge/contracts';
import { FolderOutline, Trash } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberRow } from './list-mutations';
import { PermissionBadge, TableCheck } from './management-ui';
import { DirectorySelect } from './directory-select';
import { DialogButton, ModalDialog } from './ui';
import { useUpdateFolderAccess } from './management-data';
import { folderPermissionFor } from './folder-access-model';
import { organizationErrorTextOf } from './errors';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

const levels: PermissionLevel[] = ['view', 'edit', 'full'];
type Notify = (kind: 'success' | 'error', message: string) => void;

function AccessSelect({ value, onChange, label, nullable = false, disabled = false, compact = false }: {
  value: PermissionLevel | null; onChange: (value: PermissionLevel | null) => void; label: string; nullable?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const { t } = useTranslation(managementMessages);
  const descriptions = { view: t('viewDescription'), comment: t('commentDescription'), edit: t('editDescription'), full: t('fullDescription') };
  const options = [
    ...(nullable ? [{ value: 'none', label: t('noAccess'), description: t('noAccessDescription') }] : []),
    ...levels.map(level => ({ value: level, label: t(level), description: descriptions[level] })),
  ];
  return <DirectorySelect label={label} value={resourcePermission(value) ?? 'none'} options={options} compact={compact} disabled={disabled}
    valueDisplay={value ? <PermissionBadge level={value} /> : <span className={styles.noAccessValue}>{t('noAccess')}</span>}
    onChange={next => onChange(next === 'none' ? null : next as PermissionLevel)} />;
}

function MemberPicker({ members, value, onChange, label, disabled = false }: {
  members: MemberRow[]; value: string; onChange: (value: string) => void; label: string; disabled?: boolean;
}) {
  const { t } = useTranslation(managementMessages);
  return <DirectorySelect label={label} value={value} onChange={onChange} disabled={disabled} searchable placeholder={t('chooseMember')}
    options={members.map(member => ({ value: member.userId, label: member.name, description: member.email,
      leading: <UserAvatar name={member.name} image={member.image} className={styles.pickerAvatar} /> }))} />;
}

function FolderPicker({ folders, value, onChange, disabled = false }: {
  folders: FolderAccessPolicy[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const { t } = useTranslation(managementMessages);
  return <DirectorySelect label={t('folder')} value={value} onChange={onChange} disabled={disabled} searchable
    options={folders.map(folder => ({ value: folder.teamspaceId, label: folder.name, leading: <FolderOutline size={16} aria-hidden className={styles.folderIcon} /> }))} />;
}

export function FolderPolicyDialog({ folder, folders, members, canManage, onClose, notify }: {
  folder: FolderAccessPolicy; folders: FolderAccessPolicy[]; members: MemberRow[]; canManage: boolean; onClose: () => void; notify: Notify;
}) {
  const { t } = useTranslation(managementMessages);
  const [inheritsAccess, setInheritsAccess] = useState(folder.inheritsAccess);
  const [defaultAccess, setDefaultAccess] = useState(folder.defaultAccess);
  const [grants, setGrants] = useState<FolderMemberGrant[]>(folder.explicit);
  const mutation = useUpdateFolderAccess(folder.knowledgeBaseId);
  const pending = useRef(false);
  const byMember = new Map(members.map((member) => [member.userId, member]));
  const parent = folders.find((item) => item.teamspaceId === folder.parentId);
  const inheritedGrants = inheritsAccess ? parent?.grants ?? [] : [];
  async function save() {
    if (pending.current) return; pending.current = true;
    try {
      await mutation.mutateAsync({ knowledgeBaseId: folder.knowledgeBaseId, teamspaceId: folder.teamspaceId, expectedRevision: folder.revision, inheritsAccess, defaultAccess, grants });
      notify('success', t('accessSaved')); onClose();
    } catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { pending.current = false; }
  }
  return <ModalDialog open onClose={() => { if (!pending.current) onClose(); }} title={t('folderAccessFor', { name: folder.name })} width="w-[520px]"
    footer={<><DialogButton disabled={mutation.isPending} onClick={onClose}>{canManage ? t('cancel') : t('close')}</DialogButton>{canManage ? <DialogButton variant="primary" loading={mutation.isPending} onClick={() => void save()}>{t('save')}</DialogButton> : null}</>}>
    <div className={styles.form}>
      {folder.parentId ? <div className={styles.inlineCheck}><TableCheck label={t('inheritsParent')} checked={inheritsAccess} disabled={!canManage || mutation.isPending} onChange={() => setInheritsAccess(!inheritsAccess)} /><span>{t('inheritsParent')}{parent ? ` · ${parent.name}` : ''}</span></div> : null}
      {inheritsAccess ? <><p className={styles.hint}>{t('inheritHint')}</p><div className={styles.effective}><span>{t('defaultAccess')}</span><PermissionBadge level={parent?.effectiveDefaultAccess ?? null} /></div></> : <div className={styles.field}><span className={styles.fieldLabel}>{t('defaultAccess')}</span><AccessSelect label={t('defaultAccess')} nullable disabled={!canManage || mutation.isPending} value={defaultAccess} onChange={setDefaultAccess} /><p className={styles.hint}>{t('defaultHint')}</p></div>}
      <div className={styles.field}><div className={styles.sectionLabel}><span>{t('grants')}</span><span className={styles.sectionCount}>{grants.length}</span></div><div className={styles.grantList}>
        {grants.map((grant) => <div className={styles.grantRow} key={grant.userId}><UserAvatar name={byMember.get(grant.userId)?.name ?? t('unknownMember')} image={byMember.get(grant.userId)?.image} className={styles.grantAvatar} /><div className={styles.identity}><span className={styles.name}>{byMember.get(grant.userId)?.name ?? t('unknownMember')}</span><span className={styles.email}>{byMember.get(grant.userId)?.email}</span></div>
          <AccessSelect compact label={t('accessFor', { name: byMember.get(grant.userId)?.name ?? '' })} value={grant.level} disabled={!canManage || mutation.isPending} onChange={(level) => { if (level) setGrants(grants.map((row) => row.userId === grant.userId ? { ...row, level } : row)); }} />
          {canManage ? <button type="button" className={cn('fob-action', styles.rowAction, styles.danger)} data-surface="plain" aria-label={t('removeGrant', { name: byMember.get(grant.userId)?.name ?? '' })} disabled={mutation.isPending} onClick={() => setGrants(grants.filter((row) => row.userId !== grant.userId))}><Trash size={14} aria-hidden /></button> : null}
        </div>)}
        {inheritedGrants.filter((grant) => !grants.some((row) => row.userId === grant.userId)).map((grant) => <div className={styles.grantRow} key={`inherited-${grant.userId}`}><UserAvatar name={byMember.get(grant.userId)?.name ?? t('unknownMember')} image={byMember.get(grant.userId)?.image} className={styles.grantAvatar} /><div className={styles.identity}><span className={styles.name}>{byMember.get(grant.userId)?.name ?? t('unknownMember')}</span><span className={styles.email}>{t('sourceFrom', { name: folders.find((item) => item.teamspaceId === grant.sourceId)?.name ?? '' })}</span></div><PermissionBadge level={grant.level} /></div>)}
        {!grants.length && !inheritedGrants.length ? <p className={styles.hint}>{t('noExplicit')}</p> : null}
      </div></div>
      {canManage && members.some((member) => !grants.some((grant) => grant.userId === member.userId)) ? <div className={styles.field}><span className={styles.fieldLabel}>{t('addGrant')}</span><MemberPicker members={members.filter(member => !grants.some(grant => grant.userId === member.userId))} value="" label={t('chooseMember')} disabled={mutation.isPending} onChange={userId => setGrants([...grants, { userId, level: 'view' }])} /></div> : null}
      {canManage ? <p className={styles.notice}>{t('saveHint')}</p> : null}
    </div>
  </ModalDialog>;
}

export function AddFolderGrantDialog({ knowledgeBaseId, folders, members, onClose, notify }: {
  knowledgeBaseId: string; folders: FolderAccessPolicy[]; members: MemberRow[]; onClose: () => void; notify: Notify;
}) {
  const { t } = useTranslation(managementMessages);
  const [folderId, setFolderId] = useState(folders[0]?.teamspaceId ?? '');
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('view');
  const mutation = useUpdateFolderAccess(knowledgeBaseId);
  const pending = useRef(false);
  const folder = folders.find((item) => item.teamspaceId === folderId);
  async function save() {
    if (pending.current || !folder || !userId) return; pending.current = true;
    try {
      await mutation.mutateAsync({ knowledgeBaseId, teamspaceId: folder.teamspaceId, expectedRevision: folder.revision, defaultAccess: folder.defaultAccess, inheritsAccess: folder.inheritsAccess, grants: [...folder.explicit.filter((grant) => grant.userId !== userId), { userId, level }] });
      notify('success', t('accessSaved')); onClose();
    } catch (error) { notify('error', t('failed', { error: organizationErrorTextOf(error) })); }
    finally { pending.current = false; }
  }
  return <ModalDialog open title={t('addGrant')} onClose={() => { if (!pending.current) onClose(); }} footer={<><DialogButton onClick={onClose} disabled={mutation.isPending}>{t('cancel')}</DialogButton><DialogButton variant="primary" disabled={!folder || !userId} loading={mutation.isPending} onClick={() => void save()}>{t('addGrant')}</DialogButton></>}>
    <div className={styles.form}>
      <div className={styles.field}><span className={styles.fieldLabel}>{t('folder')}</span><FolderPicker folders={folders} value={folderId} disabled={mutation.isPending} onChange={setFolderId} /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>{t('grantFor')}</span><MemberPicker label={t('grantFor')} members={members} value={userId} disabled={mutation.isPending} onChange={setUserId} /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>{t('accessLevel')}</span><AccessSelect label={t('accessLevel')} value={level} disabled={mutation.isPending} onChange={(value) => { if (value) setLevel(value); }} /></div>
      <p className={styles.notice}>{t('saveHint')}</p>
    </div>
  </ModalDialog>;
}

export function EffectiveFolderAccessDialog({ folders, members, onClose }: { folders: FolderAccessPolicy[]; members: MemberRow[]; onClose: () => void }) {
  const { t } = useTranslation(managementMessages);
  const [folderId, setFolderId] = useState(folders[0]?.teamspaceId ?? '');
  const [userId, setUserId] = useState(members[0]?.userId ?? '');
  const folder = folders.find((item) => item.teamspaceId === folderId);
  const member = members.find((item) => item.userId === userId);
  const access = folder && member ? folderPermissionFor(folder, member) : null;
  return <ModalDialog open title={t('effectivePermissions')} onClose={onClose} footer={<DialogButton onClick={onClose}>{t('close')}</DialogButton>}>
    <div className={styles.form}>
      <div className={styles.field}><span className={styles.fieldLabel}>{t('folder')}</span><FolderPicker folders={folders} value={folderId} onChange={setFolderId} /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>{t('members')}</span><MemberPicker label={t('members')} members={members} value={userId} onChange={setUserId} /></div>
      <div className={styles.effective}><span>{member?.name}</span><PermissionBadge level={access?.level ?? null} /></div>
      <p className={styles.hint}>{access?.level ? `${access.individual ? t('sourceMember') : t('sourceDefault')} · ${t('sourceFrom', { name: folders.find((item) => item.teamspaceId === access.sourceId)?.name ?? '' })}` : t('noEffective')}</p>
      <p className={styles.notice}>{t('effectiveHint')}</p>
    </div>
  </ModalDialog>;
}
