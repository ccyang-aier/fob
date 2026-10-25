'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Clock, Eye, PencilSimple, Sparkle } from '@/components/icons';
import type { DocumentPerson } from '@fob/shared/knowledge/contracts';
import type { Awareness } from 'y-protocols/awareness';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { UserAvatar } from '@/components/user-avatar';
import { awarenessColorFor, readAwarenessMembers } from '../../collaboration/awareness';
import type { AwarenessIdentity, AwarenessMember } from '../../collaboration/awareness';
import { knowledgeMessages } from './awareness-members.messages';
import { messages } from '../../sharing/collaboration.messages';
import styles from './awareness-members.module.css';

interface AwarenessMembersSnapshot { members: AwarenessMember[]; ownClientId: number }
const emptySnapshot: AwarenessMembersSnapshot = { members: [], ownClientId: 0 };
const snapshotCache = new WeakMap<Awareness, AwarenessMembersSnapshot>();
function awarenessSnapshot(awareness: Awareness): AwarenessMembersSnapshot {
  const cached = snapshotCache.get(awareness);
  if (cached) return cached;
  const snapshot = { members: readAwarenessMembers(awareness, awareness.clientID), ownClientId: awareness.clientID };
  snapshotCache.set(awareness, snapshot); return snapshot;
}
export function useAwarenessMembers(awareness: Awareness | null): AwarenessMembersSnapshot {
  const subscribe = useCallback((notify: () => void) => {
    if (!awareness) return () => {};
    snapshotCache.delete(awareness);
    const onChange = () => { snapshotCache.delete(awareness); notify(); };
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [awareness]);
  const getSnapshot = useCallback(() => awareness ? awarenessSnapshot(awareness) : emptySnapshot, [awareness]);
  return useSyncExternalStore(subscribe, getSnapshot, () => emptySnapshot);
}
const MAX_VISIBLE = 3;
function memberKey(member: AwarenessMember) { return `${member.kind}:${member.user.id}:${member.taskId ?? ''}`; }
function Avatar({ member, large = false }: { member: AwarenessMember; large?: boolean }) {
  const { t } = useTranslation(messages);
  return <span className={cn(styles.avatar, large && styles.largeAvatar)} title={`${member.user.name} · ${t(member.isEditing ? 'editing' : 'online')}`}>
    <UserAvatar name={member.user.name} image={member.user.image} className="size-full" />
    {member.kind === 'agent' && <span className={styles.agentBadge}><Sparkle size={9} /></span>}
  </span>;
}
function Profile({ member, person, own, connected }: { member: AwarenessMember; person?: DocumentPerson; own: boolean; connected: boolean }) {
  const { t, locale } = useTranslation(messages), [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  let time: string | null = null;
  try { if (member.timezone) time = new Intl.DateTimeFormat(locale, { timeZone: member.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now); } catch { /* Invalid remote zones are omitted. */ }
  const verified = person ? { ...member, user: { ...member.user, name: person.name, image: person.image } } : member;
  return <>
    <div className={styles.profileHeading}><Avatar member={verified} large /><div className={styles.profileIdentity}>
      <div className={styles.profileName}><strong>{verified.user.name}</strong>{person && (person.role === 'owner' || person.role === 'admin' || person.role === 'guest') && <span className={styles.roleBadge}>{t(person.role === 'owner' ? 'admin' : person.role)}</span>}</div>
      <p>{t(connected ? 'online' : 'connecting')}</p>
    </div></div>
    <div className={styles.divider} />
    {time && <div className={styles.infoRow}><Clock size={18} />{t('localTime', { time })}</div>}
    <div className={styles.infoRow}>{member.isEditing ? <PencilSimple size={18} /> : <Eye size={18} />}{t(member.isEditing ? 'editing' : 'viewing')}{own ? ` (${t('you')})` : ''}</div>
  </>;
}
export function AwarenessMembers({ awareness, identity, people = [], connected = Boolean(awareness) }: { awareness: Awareness | null; identity: AwarenessIdentity; people?: DocumentPerson[]; connected?: boolean }) {
  const { t } = useTranslation(knowledgeMessages), { t: copy } = useTranslation(messages);
  const { members } = useAwarenessMembers(awareness);
  const [card, setCard] = useState<{ anchor: HTMLElement; member: AwarenessMember; overflow?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const own: AwarenessMember = { clientId: awareness?.clientID ?? 0, user: { id: identity.userId, name: identity.name, image: identity.image },
    color: awarenessColorFor(identity.userId), kind: 'human', isEditing: awareness?.getLocalState()?.isEditing === true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const participants = [own, ...members.filter(member => member.kind !== 'human' || member.user.id !== identity.userId)];
  const visible = participants.slice(0, MAX_VISIBLE), overflow = participants.length - visible.length;
  const label = awareness ? t(participants.length === 1 ? 'oneMemberOnline' : 'valueMembersOnline', { v0: participants.length }) : t('currentDocumentMembers');
  const close = () => { clearTimeout(timer.current); setCard(null); };
  const liveMember = card ? participants.find(member => memberKey(member) === memberKey(card.member)) : undefined;
  return <span className={styles.stack} role="group" aria-label={label}>
    {visible.map((member, index) => <button key={memberKey(member)} type="button" className={styles.trigger} aria-label={index === 0 ? label : member.user.name}
      title={t('viewDocumentMembers')} aria-expanded={card?.member.user.id === member.user.id} onClick={event => { clearTimeout(timer.current); setCard(card?.member.user.id === member.user.id ? null : { anchor: event.currentTarget, member }); }}
      onMouseEnter={event => { clearTimeout(timer.current); const anchor = event.currentTarget; timer.current = setTimeout(() => setCard({ anchor, member }), 500); }}
      onMouseLeave={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setCard(null), 150); }}><Avatar member={member} /></button>)}
    {overflow > 0 && <button className={styles.overflow} title={t(overflow === 1 ? 'oneMoreMemberOnline' : 'valueMoreMembersOnline', { v0: overflow })} onClick={event => setCard({ anchor: event.currentTarget, member: own, overflow: true })}>+{overflow}</button>}
    {card && liveMember && <AnchoredPopover anchor={card.anchor} onClose={close} label={card.overflow ? t('documentMembers') : liveMember.user.name} width={card.overflow ? 264 : 'max-content'} align="end" className={styles.profile} autoFocus={false}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { timer.current = setTimeout(() => setCard(null), 150); }}>
      {card.overflow ? <div className={styles.memberList}>{participants.map(member => <button key={memberKey(member)} className={`fob-action ${styles.memberRow}`} onClick={() => setCard({ ...card, member, overflow: false })}><Avatar member={member} /><span>{member.user.name}<small>{copy(member.isEditing ? 'editing' : 'viewing')}</small></span></button>)}</div>
        : <Profile member={liveMember} person={people.find(person => person.id === liveMember.user.id)} own={liveMember.user.id === identity.userId} connected={connected} />}
    </AnchoredPopover>}
  </span>;
}
