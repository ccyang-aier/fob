'use client';

import { ArrowRight, Buildings, EnvelopeSimple, PushPin } from '@phosphor-icons/react';
import { UserAvatar } from '@/components/user-avatar';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import cardStyles from '@/components/ui/resource-card.module.css';
import { joinedDate, memberPortraits, orderedLabels, type DirectoryMember, type MemberLabel } from './members.data';
import { messages } from './members.messages';
import styles from './members.module.css';

export function MemberLabels({ labels }: { labels: MemberLabel[] }) {
  const { t } = useTranslation(messages);
  return <span className={styles.labels} aria-label={t('labels')}>
    {orderedLabels(labels).map(label => <span key={label.name} className={styles.label} data-pinned={label.pinned || undefined} title={label.pinned ? t('pinnedLabel', { name: label.name }) : label.name}>
      {label.pinned && <PushPin size={12} aria-hidden />}<span>{label.name}</span>
    </span>)}
    {!labels.length && <span className={styles.noLabels}>{t('noLabels')}</span>}
  </span>;
}

export function MemberPortrait({ member, className }: { member: DirectoryMember; className?: string }) {
  const image = member.portrait === null ? null : memberPortraits[member.portrait];
  return <UserAvatar name={member.name} image={image} className={cn(styles.avatar, className)} />;
}

export function MemberCollection({ members, mode, onOpen }: { members: DirectoryMember[]; mode: 'grid' | 'list'; onOpen: (member: DirectoryMember) => void }) {
  const { t, locale } = useTranslation(messages);
  if (mode === 'list') return <div className={styles.tableScroll}><table className={styles.table} aria-label={t('list')}>
    <thead><tr><th>{t('name')}</th><th>{t('department')}</th><th>{t('email')}</th><th>{t('labels')}</th><th>{t('joined')}</th><th><span className="sr-only">{t('details')}</span></th></tr></thead>
    <tbody>{members.map(member => <tr key={member.id}>
      <td><button type="button" className={`fob-action ${styles.person}`} aria-label={t('open', { name: member.name })} onClick={() => onOpen(member)}><MemberPortrait member={member} className={styles.listAvatar} /><span><strong>{member.name}</strong><small>{member.position || '—'}</small></span></button></td>
      <td>{member.department || '—'}</td><td>{member.email}</td><td className={styles.labelCell}><MemberLabels labels={member.labels} /></td>
      <td><time dateTime={member.joinedOn}>{joinedDate(member.joinedOn, locale)}</time></td>
      <td><button type="button" className={`fob-action ${styles.detailButton}`} aria-label={t('open', { name: member.name })} onClick={() => onOpen(member)}><ArrowRight size={16} /></button></td>
    </tr>)}</tbody>
  </table></div>;
  return <ul className={styles.grid} aria-label={t('grid')}>{members.map(member => <li key={member.id}>
    <button type="button" className={cn(cardStyles.card, styles.card)} aria-label={t('open', { name: member.name })} onClick={() => onOpen(member)}>
      <span className={styles.identity}><MemberPortrait member={member} /><span><strong className={styles.memberName}>{member.name}</strong><span className={styles.position}>{member.position || '—'}</span></span><ArrowRight size={16} className={styles.cardArrow} aria-hidden /></span>
      <span className={styles.contact}>
        <span><Buildings size={15} aria-hidden /><span>{member.department || '—'}</span></span>
        <span><EnvelopeSimple size={15} aria-hidden /><span>{member.email}</span></span>
      </span>
      <MemberLabels labels={member.labels} />
    </button>
  </li>)}</ul>;
}
