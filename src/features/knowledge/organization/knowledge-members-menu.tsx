'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createKnowledgeBaseInvitationInputSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeBaseMemberSummary } from '@fob/shared/knowledge/contracts';
import { UsersThree, Envelope, LinkSimple, Eye, Clock } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-context';
import { presenceDisplay } from '@/features/identity/presence';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeBaseResources, type KnowledgeBaseResource } from '../data/knowledge-base-resources';
import { KnowledgeQueryProvider } from '../data/provider';
import { allOrganizationPages, knowledgeBaseMemberDirectory } from './member-directory';
import { invitationClient, knowledgeBaseInvitationLink, type CreatedKnowledgeBaseInvitation } from './invitation-client';
import { organizationErrorTextOf } from './errors';
import { memberRoleLabels } from './view-model';
import { messages } from './knowledge-members-menu.messages';
import styles from './knowledge-members-menu.module.css';

export function KnowledgeMembersButton({ className, onManage }: { className?: string; onManage: () => void }) {
  const resources = useKnowledgeBaseResources();
  return <MembersTrigger key={resources.scopeKey ?? resources.principal} className={className} onManage={onManage} />;
}

function MembersTrigger({ className, onManage }: { className?: string; onManage: () => void }) {
  const { t } = useTranslation(messages);
  const { session, openSignIn } = useIdentity();
  const resources = useKnowledgeBaseResources();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const base = resources.selectedKnowledgeBase;
  return <>
    <Tooltip><TooltipTrigger asChild>
      <button type="button" className={`fob-action ${className ?? ''}`} data-surface="plain" aria-label={t('title')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
        disabled={session.status === 'checking' || resources.status === 'loading'}
        onClick={event => { const trigger = event.currentTarget; setAnchor(current => current ? null : trigger); }}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setAnchor(event.currentTarget); } }}>
        <UsersThree size={16} aria-hidden />
      </button>
    </TooltipTrigger><TooltipContent side="bottom">{t('title')}</TooltipContent></Tooltip>
    {anchor ? <AnchoredPopover anchor={anchor} onClose={close} label={t('title')} width={432} align="end" className={styles.popover}>
      {session.status !== 'authenticated' ? <div className={styles.notice}><h2>{t('title')}</h2><Button variant="outline" onClick={() => { close(); openSignIn(); }}>{t('login')}</Button></div>
        : base?.source === 'server' ? <KnowledgeQueryProvider><ServerMembers base={base} onManage={() => { close(); onManage(); }} /></KnowledgeQueryProvider>
          : <div className={styles.notice}><h2>{base?.name ?? t('title')}</h2><p>{t(base ? 'local' : 'select')}</p><Button variant="outline" size="sm" onClick={() => { close(); resources.openCreateKnowledgeBase(); }}>{t('createBase')}</Button></div>}
    </AnchoredPopover> : null}
  </>;
}

function ServerMembers({ base, onManage }: { base: KnowledgeBaseResource; onManage: () => void }) {
  const { t, locale } = useTranslation(messages);
  const { session } = useIdentity();
  const { notify } = useAppAlert();
  const principal = session.status === 'authenticated' ? session.user.id : 'guest';
  const directory = useQuery({ queryKey: ['knowledge', base.id, 'member-directory', principal], queryFn: ({ signal }) => knowledgeBaseMemberDirectory(base.id, signal), staleTime: 0, refetchInterval: 30_000 });
  const owner = !directory.isError && directory.data?.role === 'owner';
  const invitations = useQuery({ queryKey: ['knowledge', base.id, 'member-invitations', principal], queryFn: ({ signal }) => allOrganizationPages(options => invitationClient.list(base.id, options), signal), enabled: owner, staleTime: 0, refetchInterval: 30_000 });
  const [email, setEmail] = useState(''), [fieldError, setFieldError] = useState(''), [error, setError] = useState('');
  const [activeInvite, setActiveInvite] = useState<CreatedKnowledgeBaseInvitation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false), requestScope = useRef<AbortController | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const emailId = useId();
  useEffect(() => { const scope = new AbortController(); requestScope.current = scope; return () => scope.abort(); }, []);
  const members = directory.isError ? [] : [...(directory.data?.members ?? [])].sort((a,b) => Number(b.role === 'owner')-Number(a.role === 'owner') || a.name.localeCompare(b.name, locale));
  const observedAt = Math.max(directory.dataUpdatedAt, invitations.dataUpdatedAt);
  const waiting = invitations.isError ? [] : (invitations.data ?? []).filter(item => !item.acceptedAt && !item.revokedAt && new Date(item.expiresAt).getTime() > observedAt);
  const replacing = waiting.some(item => item.email === email.trim().toLowerCase());
  const liveInvite = activeInvite && new Date(activeInvite.invitation.expiresAt).getTime() > observedAt
    && !invitations.data?.some(item => item.id === activeInvite.invitation.id && (item.acceptedAt || item.revokedAt)) ? activeInvite : null;

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !owner) return;
    const parsed = createKnowledgeBaseInvitationInputSchema.safeParse({ knowledgeBaseId: base.id, email: email.trim() });
    if (!parsed.success) { setFieldError(t('invalidEmail')); return; }
    if (members.some(member => member.email.toLowerCase() === parsed.data.email)) { setFieldError(t('duplicate')); return; }
    const signal = requestScope.current?.signal;
    pending.current = true; setBusy('create'); setError(''); setFieldError('');
    try {
      const created = await invitationClient.create(base.id, parsed.data.email, signal);
      if (signal?.aborted) return;
      setActiveInvite(created);
      await invitations.refetch();
      if (!signal?.aborted) setEmail('');
    } catch (cause) { if (!signal?.aborted) setError(organizationErrorTextOf(cause)); }
    finally { if (!signal?.aborted) { pending.current = false; setBusy(null); } }
  }

  async function revoke(id: string) {
    if (pending.current || !owner) return;
    const signal = requestScope.current?.signal;
    pending.current = true; setBusy(id); setError('');
    try {
      await invitationClient.revoke(base.id, id, signal);
      if (signal?.aborted) return;
      if (activeInvite?.invitation.id === id) setActiveInvite(null);
      await invitations.refetch();
      if (!signal?.aborted) notify('success', t('revoked'));
    } catch (cause) { if (!signal?.aborted) setError(organizationErrorTextOf(cause)); }
    finally { if (!signal?.aborted) { pending.current = false; setBusy(null); } }
  }

  async function copy() {
    if (!liveInvite) return;
    try { await navigator.clipboard.writeText(knowledgeBaseInvitationLink(window.location.origin, liveInvite)); notify('success', t('copied')); }
    catch { notify('error', t('copyFailed')); }
  }

  return <div className={styles.content}>
    <header className={styles.heading}><div><h2>{t('title')}</h2>{directory.data && !directory.isError ? <span className={styles.count}>{members.length}</span> : null}</div><p>{base.name}</p></header>
    {owner ? <form className={styles.inviteForm} onSubmit={event => void invite(event)} noValidate aria-label={t('invite')} aria-busy={busy === 'create'}>
      <div className={styles.emailInput} data-invalid={Boolean(fieldError)}><Envelope size={16} aria-hidden /><input ref={emailInput} id={emailId} data-autofocus autoFocus type="email" name="email" autoComplete="email" maxLength={254} aria-label={t('email')} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? `${emailId}-error` : replacing ? `${emailId}-hint` : undefined} placeholder={t('placeholder')} value={email} readOnly={Boolean(busy)} onChange={event => { setEmail(event.target.value); setFieldError(''); setError(''); }} /></div>
      <Button type="submit" className={styles.inviteButton} loading={busy === 'create'} disabled={!email.trim() || Boolean(busy && busy !== 'create')}>{t(replacing ? 'reissue' : 'invite')}</Button>
    </form> : null}
    {fieldError ? <p className={styles.fieldError} role="alert" id={`${emailId}-error`}>{fieldError}</p> : null}
    {owner && replacing && !fieldError ? <p className={styles.fieldHint} id={`${emailId}-hint`}>{t('replacing')}</p> : null}
    {error ? <AppAlert tone="error" title={error} /> : null}
    <div className={styles.accessNote}><span className={styles.noteIcon}>{liveInvite ? <LinkSimple size={20} aria-hidden /> : <Eye size={20} aria-hidden />}</span><div><strong>{t(liveInvite ? 'ready' : 'publicAccess')}</strong><p>{liveInvite ? t('expires', { email: liveInvite.invitation.email }) : t('privateAccess')}</p></div>{liveInvite ? <Button variant="outline" size="sm" className={styles.copyButton} disabled={Boolean(busy)} onClick={() => void copy()}>{t('copy')}</Button> : null}</div>
    {directory.isPending ? <div className={styles.state} role="status">{t('loading')}</div> : directory.isError ? <div className={styles.state}><AppAlert tone="error" title={t('failed')} description={organizationErrorTextOf(directory.error)} /><Button variant="outline" size="sm" onClick={() => void directory.refetch()}>{t('retry')}</Button></div> : <>
      <div className={styles.listHeading}><span>{t('joined')}</span><span>{members.length}</span></div>
      <ul className={styles.members} aria-label={t('joined')}>{members.map(member => <JoinedMember member={member} key={member.userId} />)}</ul>
      {!members.length ? <p className={styles.state}>{t('empty')}</p> : null}
    </>}
    {owner && waiting.length ? <section className={styles.pending}><div className={styles.listHeading}><span>{t('pending')}</span><span>{waiting.length}</span></div>{waiting.map(item => <div className={styles.pendingRow} key={item.id}><span className={styles.pendingIcon}><Clock size={16} aria-hidden /></span><div className={styles.pendingIdentity}><strong>{item.email}</strong><small>{t('expiresOn', { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(item.expiresAt)) })}</small></div><div className={styles.pendingActions}><Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => { setEmail(item.email); setFieldError(''); setError(''); emailInput.current?.focus(); }}>{t('reinvite')}</Button><Button variant="ghost" size="sm" loading={busy === item.id} disabled={Boolean(busy && busy !== item.id)} onClick={() => void revoke(item.id)}>{t('revoke')}</Button></div></div>)}</section> : null}
    {owner && invitations.isError ? <div className={styles.state}><AppAlert tone="error" title={t('pendingFailed')} /><Button variant="outline" size="sm" onClick={() => void invitations.refetch()}>{t('retry')}</Button></div> : null}
    {!directory.isError && directory.data ? <footer className={styles.footer}><Button variant="ghost" size="sm" onClick={onManage}>{t('manage')}</Button></footer> : null}
  </div>;
}

function JoinedMember({ member }: { member: KnowledgeBaseMemberSummary }) {
  const { t, locale } = useTranslation(messages);
  const { session, presence } = useIdentity();
  const self = session.status === 'authenticated' && session.user.id === member.userId;
  const status = presenceDisplay(presence, locale);
  return <li className={styles.member}>
    <UserAvatar name={member.name} image={member.image} className={styles.avatar} />
    <div className={styles.memberIdentity}><strong>{member.name}{self ? <small>（{t('you')}）</small> : null}</strong><span>{member.email}</span></div>
    <div className={styles.memberStatus}><span>{memberRoleLabels(locale)[member.role]}</span>{self ? <small style={{ color: status.color }}><i aria-hidden style={{ backgroundColor: status.color }} />{status.label}</small> : null}</div>
  </li>;
}
