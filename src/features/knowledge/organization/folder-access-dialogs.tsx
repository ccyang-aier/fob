'use client';

import { useRef, useState } from 'react';
import type { FolderAccessPolicy, FolderMemberGrant, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { Trash } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MemberRow } from './list-mutations';
import { PermissionBadge, TableCheck } from './management-ui';
import { DialogButton, ModalDialog } from './ui';
import { useUpdateFolderAccess } from './management-data';
import { folderPermissionFor } from './folder-access-model';
import { organizationErrorTextOf } from './errors';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

const levels: PermissionLevel[] = ['view', 'comment', 'edit', 'full'];
type Notify = (kind: 'success' | 'error', message: string) => void;

function AccessSelect({ value, onChange, label, nullable = false, disabled = false }: {
  value: PermissionLevel | null; onChange: (value: PermissionLevel | null) => void; label: string; nullable?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation(managementMessages);
  return <select className={styles.input} aria-label={label} value={value ?? ''} disabled={disabled} onChange={(event) => onChange((event.target.value || null) as PermissionLevel | null)}>
    {nullable ? <option value="">{t('noAccess')}</option> : null}{levels.map((level) => <option key={level} value={level}>{t(level)}</option>)}
  </select>;
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
  return <ModalDialog open onClose={() => { if (!pending.current) onClose(); }} title={t('folderAccessFor', { name: folder.name })} width="w-[480px]"
    footer={<><DialogButton disabled={mutation.isPending} onClick={onClose}>{canManage ? t('cancel') : t('close')}</DialogButton>{canManage ? <DialogButton variant="primary" loading={mutation.isPending} onClick={() => void save()}>{t('save')}</DialogButton> : null}</>}>
    <div className={styles.form}>
      {folder.parentId ? <div className={styles.inlineCheck}><TableCheck label={t('inheritsParent')} checked={inheritsAccess} disabled={!canManage || mutation.isPending} onChange={() => setInheritsAccess(!inheritsAccess)} /><span>{t('inheritsParent')}{parent ? ` · ${parent.name}` : ''}</span></div> : null}
      {inheritsAccess ? <><p className={styles.hint}>{t('inheritHint')}</p><div className={styles.effective}><span>{t('defaultAccess')}</span><PermissionBadge level={parent?.effectiveDefaultAccess ?? null} /></div></> : <label className={styles.field}>{t('defaultAccess')}<AccessSelect label={t('defaultAccess')} nullable disabled={!canManage || mutation.isPending} value={defaultAccess} onChange={setDefaultAccess} /><span className={styles.hint}>{t('defaultHint')}</span></label>}
      <div className={styles.field}><span>{t('grants')}</span><div className={styles.grantList}>
        {grants.map((grant) => <div className={styles.grantRow} key={grant.userId}><div className={styles.identity}><span className={styles.name}>{byMember.get(grant.userId)?.name ?? t('unknownMember')}</span><span className={styles.email}>{byMember.get(grant.userId)?.email}</span></div>
          <AccessSelect label={t('roleFor', { name: byMember.get(grant.userId)?.name ?? '' })} value={grant.level} disabled={!canManage || mutation.isPending} onChange={(level) => { if (level) setGrants(grants.map((row) => row.userId === grant.userId ? { ...row, level } : row)); }} />
          {canManage ? <button type="button" className={cn('fob-action', styles.rowAction, styles.danger)} data-surface="plain" aria-label={t('removeGrant', { name: byMember.get(grant.userId)?.name ?? '' })} disabled={mutation.isPending} onClick={() => setGrants(grants.filter((row) => row.userId !== grant.userId))}><Trash size={14} aria-hidden /></button> : null}
        </div>)}
        {inheritedGrants.filter((grant) => !grants.some((row) => row.userId === grant.userId)).map((grant) => <div className={styles.grantRow} key={`inherited-${grant.userId}`}><div className={styles.identity}><span className={styles.name}>{byMember.get(grant.userId)?.name ?? t('unknownMember')}</span><span className={styles.email}>{t('sourceFrom', { name: folders.find((item) => item.teamspaceId === grant.sourceId)?.name ?? '' })}</span></div><PermissionBadge level={grant.level} /></div>)}
        {!grants.length && !inheritedGrants.length ? <p className={styles.hint}>{t('noExplicit')}</p> : null}
      </div></div>
      {canManage && members.some((member) => !grants.some((grant) => grant.userId === member.userId)) ? <label className={styles.field}>{t('addGrant')}<select className={styles.input} value="" aria-label={t('chooseMember')} disabled={mutation.isPending} onChange={(event) => { if (event.target.value) setGrants([...grants, { userId: event.target.value, level: 'view' }]); }}><option value="">{t('chooseMember')}</option>{members.filter((member) => !grants.some((grant) => grant.userId === member.userId)).map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.email}</option>)}</select></label> : null}
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
      <label className={styles.field}>{t('folder')}<select autoFocus className={styles.input} value={folderId} disabled={mutation.isPending} onChange={(event) => setFolderId(event.target.value)}>{folders.map((item) => <option key={item.teamspaceId} value={item.teamspaceId}>{item.name}</option>)}</select></label>
      <label className={styles.field}>{t('grantFor')}<select className={styles.input} value={userId} disabled={mutation.isPending} onChange={(event) => setUserId(event.target.value)}><option value="">{t('chooseMember')}</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.email}</option>)}</select></label>
      <label className={styles.field}>{t('accessLevel')}<AccessSelect label={t('accessLevel')} value={level} disabled={mutation.isPending} onChange={(value) => { if (value) setLevel(value); }} /></label>
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
      <label className={styles.field}>{t('folder')}<select autoFocus className={styles.input} value={folderId} onChange={(event) => setFolderId(event.target.value)}>{folders.map((item) => <option key={item.teamspaceId} value={item.teamspaceId}>{item.name}</option>)}</select></label>
      <label className={styles.field}>{t('members')}<select className={styles.input} value={userId} onChange={(event) => setUserId(event.target.value)}>{members.map((item) => <option key={item.userId} value={item.userId}>{item.name} · {item.email}</option>)}</select></label>
      <div className={styles.effective}><span>{member?.name}</span><PermissionBadge level={access?.level ?? null} /></div>
      <p className={styles.hint}>{access?.level ? `${access.individual ? t('sourceMember') : t('sourceDefault')} · ${t('sourceFrom', { name: folders.find((item) => item.teamspaceId === access.sourceId)?.name ?? '' })}` : t('noEffective')}</p>
      <p className={styles.notice}>{t('effectiveHint')}</p>
    </div>
  </ModalDialog>;
}
