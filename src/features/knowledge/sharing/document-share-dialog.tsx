'use client';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CaretLeft, Globe, LinkSimple, Question, ShareNetwork, Users, X } from '@/components/icons';
import { documentInvitationInputSchema, documentInvitationReplySchema } from '@fob/shared/knowledge/contracts';
import type { PageScope, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { useAppAlert } from '@/components/app-alert-provider';
import { Button } from '@/components/ui/button';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/user-avatar';
import { AppAlert } from '@/components/app-alert';
import { documentLink, type DocumentLinkTarget } from '../editor/document-link';
import { DocumentModal } from './document-modal';
import { collaborationRequest, mutationReply, useDocumentDirectory, useDocumentSharing } from './collaboration-api';
import { messages } from './collaboration.messages';
import styles from './document-collaboration.module.css';

export function DocumentAvatar({ name, image }: { name: string; image?: string | null }) {
  return <span className={styles.avatar}><UserAvatar name={name} image={image} /></span>;
}
export function DocumentSwitch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange(): void }) {
  return <button type="button" className={styles.switch} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}><span /></button>;
}
function PermissionOptions({ remove = false }: { remove?: boolean }) {
  const { t } = useTranslation(messages);
  return <>{(['view', 'comment', 'edit', 'full'] as const).map(level => <option key={level} value={level}>{t(level)}</option>)}{remove && <option value="remove">{t('remove')}</option>}</>;
}
function SharingContents({ scope, settings = false }: { scope: PageScope; settings?: boolean }) {
  const { t } = useTranslation(messages), { notify } = useAppAlert(), client = useQueryClient();
  const sharing = useDocumentSharing(scope), data = sharing.data;
  const [picker, setPicker] = useState(false), [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{ principal?: string; email?: string; name: string } | null>(null);
  const [level, setLevel] = useState<PermissionLevel>('view'), [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState(''), [error, setError] = useState(''), [expiry, setExpiry] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const directory = useDocumentDirectory(scope, deferredQuery, picker && Boolean(data?.canManage));
  const internalLink = typeof window === 'undefined' ? '' : documentLink(window.location.href, { ...scope, source: 'server' });
  const publicLink = data?.publication?.token ? new URL(`/share#${data.publication.token}`, window.location.href).href : '';
  const publicationExpiry = (value = expiry) => value === null || value === 'current' ? data?.publication?.expiresAt ?? null : value === 'never' ? null : new Date(Date.now() + Number(value) * 86_400_000).toISOString();
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); notify('success', t('copied')); } catch { notify('error', t('copyFailed')); } }
  async function mutate(path: string, body: unknown, success = 'updated' as 'updated' | 'published' | 'unpublished' | 'revoked', method?: string) {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      await collaborationRequest(scope, path, mutationReply, body, undefined, method);
      await client.invalidateQueries({ queryKey: [scope.knowledgeBaseId, 'knowledge', 'pages'] });
      notify('success', t(success)); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); return false; }
    finally { setBusy(false); }
  }
  async function revokeInvitation(id: string) {
    if (await mutate(`/invitations/${id}`, {}, 'revoked', 'DELETE') && inviteUrl.includes(id)) setInviteUrl('');
  }
  async function add() {
    if (!selection || busy) return;
    if (selection.principal) {
      if (await mutate('/permissions', { principal: selection.principal, level })) { setPicker(false); setSelection(null); setQuery(''); }
    } else {
      setBusy(true); setError('');
      try {
        const result = await collaborationRequest(scope, '/invitations', documentInvitationReplySchema, { email: selection.email, level });
        const url = new URL('/invite', window.location.href); url.hash = new URLSearchParams(result).toString();
        setInviteUrl(url.href); setPicker(false); setSelection(null); setQuery('');
        await sharing.refetch(); notify('success', t('inviteCreated'));
      } catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
      finally { setBusy(false); }
    }
  }
  function linkInput(value: string, label: string) {
    return <div className={styles.link}><input aria-label={label} value={value} readOnly onFocus={event => event.target.select()} /><button className={`fob-action ${styles.iconButton}`} aria-label={t('copyLink')} onClick={() => void copy(value)}><LinkSimple size={18} /></button></div>;
  }
  if (sharing.isPending) return <div className={styles.state} role="status">{t('loading')}</div>;
  if (!data) return <div className={styles.state}><AppAlert tone="error" title={sharing.error instanceof Error ? sharing.error.message : t('failed')} /><Button variant="outline" onClick={() => void sharing.refetch()}>{t('retry')}</Button></div>;
  const availableUsers = directory.data?.users ?? [], availableGroups = directory.data?.groups ?? [];
  const validEmail = documentInvitationInputSchema.safeParse({ email: query.trim(), level });
  return <>
    <div className={styles.search}>
      {picker && <button className={`fob-action ${styles.iconButton}`} aria-label={t('back')} onClick={() => { setPicker(false); setQuery(''); setSelection(null); }}><CaretLeft size={20} /></button>}
      {data.canManage ? <input aria-label={t('addOrInvite')} placeholder={t('addOrInvite')} value={query} onFocus={() => setPicker(true)} onChange={event => { setQuery(event.target.value); setPicker(true); setSelection(null); }} onKeyDown={event => { if (event.key === 'Escape' && picker) { event.preventDefault(); event.stopPropagation(); setPicker(false); setQuery(''); } }} /> : <span className={styles.rowText}>{t('shareDocument')}</span>}
      {!picker && <button className={`fob-action ${styles.iconButton}`} aria-label={t('copyLink')} title={t('copyLink')} onClick={() => void copy(internalLink)}><LinkSimple size={19} /></button>}
    </div>
    {picker ? <>
      <div className={styles.suggestions}>
        {directory.isPending ? <p>{t('loading')}</p> : directory.isError ? <AppAlert tone="error" title={t('failed')} /> : <>
          {availableUsers.map(person => <Candidate key={person.id} name={person.name} image={<DocumentAvatar name={person.name} image={person.image} />} detail={person.email}
            selected={selection?.principal === `user:${person.id}`} onClick={() => setSelection({ principal: `user:${person.id}`, name: person.name })} />)}
          {availableGroups.map(group => <Candidate key={group.id} name={group.name} image={<Users size={22} />} selected={selection?.principal === `group:${group.id}`} onClick={() => setSelection({ principal: `group:${group.id}`, name: group.name })} />)}
          {!availableUsers.length && !availableGroups.length && !(validEmail.success && data.canInvite) && <p>{t('noMatches')}</p>}
          {validEmail.success && data.canInvite && !availableUsers.some(person => person.email.toLowerCase() === query.toLowerCase().trim()) && <Candidate name={t('inviteEmail', { email: query })} image={<Users size={22} />} selected={selection?.email === query.trim()} onClick={() => setSelection({ email: query.trim(), name: query.trim() })} />}
        </>}
      </div>
      {selection && <div className={styles.selection}><select aria-label={t('settings')} value={level} onChange={event => setLevel(event.target.value as PermissionLevel)}><PermissionOptions /></select><Button size="sm" loading={busy} onClick={() => void add()}>{t(selection.email ? 'invite' : 'add')}</Button></div>}
    </> : <div className={styles.content}>
      {data.grants.map(grant => <div className={styles.row} key={grant.principal}>
        {grant.principal.startsWith('user:') ? <DocumentAvatar name={grant.name} image={grant.image} /> : <Users size={24} className="shrink-0" />}
        <div className={styles.rowText}><strong>{grant.name}</strong>{grant.inherited && <small>{t('inherited', { source: grant.source })}</small>}</div>
        <div className={styles.level}><select aria-label={`${grant.name} · ${t('settings')}`} value={grant.level} disabled={!data.canManage || grant.inherited || busy}
          onChange={event => void mutate('/permissions', { principal: grant.principal, level: event.target.value === 'remove' ? null : event.target.value })}><PermissionOptions remove /></select>
          <Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={t('permissionHelp')}><Question size={14} /></span></TooltipTrigger><TooltipContent>{grant.inherited ? t('inherited', { source: grant.source }) : t('permissionHelp')}</TooltipContent></Tooltip>
        </div>
      </div>)}
      {data.canManage && <>
        <div className={styles.row}><span className={styles.globe}><Globe size={16} /></span><div className={styles.rowText}><strong>{t('publish')}</strong><small>{t('publicHint')}</small></div>
          <DocumentSwitch label={t('publish')} checked={Boolean(data.publication)} disabled={busy} onChange={() => void mutate('/publication', { enabled: !data.publication, expiresAt: publicationExpiry() }, data.publication ? 'unpublished' : 'published')} /></div>
        {data.publication && <>
          {publicLink ? linkInput(publicLink, t('publicLink')) : <Button variant="outline" size="sm" loading={busy} onClick={() => void mutate('/publication', { enabled: true, rotate: true })}>{t('regenerate')}</Button>}
          <div className={styles.publicationOptions}><span>{data.publication.expiresAt ? new Date(data.publication.expiresAt).toLocaleString() : t('never')}</span><button className={`fob-action ${styles.iconButton}`} title={t('regenerate')} aria-label={t('regenerate')} disabled={busy} onClick={() => void mutate('/publication', { enabled: true, rotate: true, expiresAt: publicationExpiry() })}><LinkSimple size={15} /></button></div>
        </>}
        {inviteUrl && linkInput(inviteUrl, t('invitationLink'))}
        {data.invitations.map(invitation => <div className={styles.row} key={invitation.id}><div className={styles.rowText}><strong>{invitation.email}</strong><small>{t('pending')} · {t(invitation.level)}</small></div><button className={`fob-action ${styles.iconButton}`} aria-label={`${t('revoke')} ${invitation.email}`} disabled={busy} onClick={() => void revokeInvitation(invitation.id)}><X size={16} /></button></div>)}
        {settings && <details className={styles.settings}><summary>{t('settings')}</summary>
          <div className={styles.row}><div className={styles.rowText}><strong>{t('inherit')}</strong><small>{t('inheritHint')}</small></div><DocumentSwitch checked={data.inheritsPermissions} label={t('inherit')} disabled={busy} onChange={() => void mutate('/inheritance', { inheritsPermissions: !data.inheritsPermissions })} /></div>
          <label className={styles.publicationOptions}>{t('expiry')}<select aria-label={t('expiry')} disabled={busy} value={expiry ?? (data.publication?.expiresAt ? 'current' : 'never')} onChange={event => { const value = event.target.value; setExpiry(value); if (data.publication) void mutate('/publication', { enabled: true, expiresAt: publicationExpiry(value) }); }}>{data.publication?.expiresAt && <option value="current">{new Date(data.publication.expiresAt).toLocaleString()}</option>}{[['never', 'never'], ['1', 'day'], ['7', 'week'], ['30', 'month']].map(([value, label]) => <option key={value} value={value}>{t(label as 'never')}</option>)}</select></label>
        </details>}
      </>}
    </div>}
    {error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}
  </>;
}
function Candidate({ name, image, detail, selected, onClick }: { name: string; image: ReactNode; detail?: string; selected: boolean; onClick(): void }) {
  return <button className={`fob-action ${styles.candidate}`} aria-pressed={selected} onClick={onClick}>{image}<span className={styles.rowText}>{name}{detail && <small>{detail}</small>}</span>{selected && <Check size={18} />}</button>;
}
function ShareBody({ target, settings }: { target: DocumentLinkTarget; settings?: boolean }) {
  const { t } = useTranslation(messages);
  return target.source === 'server' ? <SharingContents scope={target} settings={settings} /> : <p className={styles.empty}>{t('localShare')}</p>;
}
export function DocumentShareDialog({ target, onClose, settings }: { title: string; target: DocumentLinkTarget; onClose(): void; settings?: boolean }) {
  const { t } = useTranslation(messages);
  return <DocumentModal title={t('shareDocument')} onClose={onClose}><ShareBody target={target} settings={settings} /></DocumentModal>;
}
export function DocumentShareButton({ target, className }: { target: DocumentLinkTarget; className?: string }) {
  const { t } = useTranslation(messages), [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <><button type="button" aria-label={t('share')} aria-expanded={Boolean(anchor)} className={`fob-action ${className ?? ''}`} onClick={event => setAnchor(anchor ? null : event.currentTarget)}><ShareNetwork size={16} aria-hidden /><span>{t('share')}</span></button>
    {anchor && <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} label={t('shareDocument')} width={400} align="end" className={`${styles.surface} ${styles.popover}`}><ShareBody target={target} /></AnchoredPopover>}
  </>;
}
