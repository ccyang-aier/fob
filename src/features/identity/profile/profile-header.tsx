'use client';

import { useState } from 'react';
import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { Emoji, DotsThree, User, LinkSimple, ArrowClockwise, Trophy, CheckCircle } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '../identity-context';
import { presenceDisplay } from '../presence';
import { AccountProfile } from '../components/account-profile';
import { useTranslation } from '@/lib/i18n';
import { activityStreak, profileDay } from '@/features/knowledge/profile/profile-calendar';
import { messages } from './messages';
import type { ProfileSection } from './personal-profile-page';
import styles from './profile.module.css';

export function ProfileHeader({ data, onSection, onRefresh }: { data?: PersonalProfile; onSection: (section: ProfileSection) => void; onRefresh: () => void }) {
  const { session, presence } = useIdentity();
  const { t, locale } = useTranslation(messages);
  const { notify } = useAppAlert();
  const [editing, setEditing] = useState(false);
  const [honors, setHonors] = useState(false);
  if (session.status !== 'authenticated') return null;
  const user = session.user, status = presenceDisplay(presence, locale);
  const streak = activityStreak(data?.calendar ?? [], profileDay(new Date()));
  const badges = [
    { key: 'gardener', emoji: '🏅', title: t('gardener'), hint: t('gardenerHint', { count: data?.documentTotal ?? 0 }), earned: Boolean(data?.documentTotal) },
    { key: 'creator', emoji: '🔥', title: t('creator'), hint: t('creatorHint', { count: streak }), earned: streak >= 7 },
    { key: 'sharing', emoji: '🏅', title: t('sharing'), hint: t('sharingHint', { count: data?.sharedDocuments ?? 0 }), earned: Boolean(data?.sharedDocuments) },
  ];
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); notify('success', t('copied')); }
    catch { notify('error', t('copyFailed')); }
  }
  return <>
    <header className={styles.header}>
      <Tooltip><TooltipTrigger asChild><div className={styles.portrait} tabIndex={0} aria-label={t('liveStatus', { status: status.label })}>
        <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
        <span className={styles.presence} style={{ backgroundColor: status.color }} aria-hidden />
      </div></TooltipTrigger><TooltipContent>{status.label}</TooltipContent></Tooltip>
      <div className={styles.identity}>
        <div className={styles.identityHeading}><h1>{user.name}</h1><div className={styles.badges} aria-label={t('honors')}>
          {badges.map(badge => <Tooltip key={badge.key}><TooltipTrigger asChild><button className={`fob-action ${styles.badge}`} data-earned={badge.earned} type="button" onClick={() => setHonors(value => !value)} aria-expanded={honors}>
            <Emoji value={badge.emoji} size={24} /><span>{badge.title}</span>
          </button></TooltipTrigger><TooltipContent>{t(badge.earned ? 'earned' : 'locked')} · {badge.hint}</TooltipContent></Tooltip>)}
        </div></div>
        <p className={styles.handle}><span>@{user.email.split('@')[0]}</span><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={t(user.emailVerified ? 'verified' : 'unverified')}>{user.emailVerified ? <CheckCircle size={14} aria-hidden /> : null}</span></TooltipTrigger><TooltipContent>{t(user.emailVerified ? 'verified' : 'unverified')}</TooltipContent></Tooltip></p>
        <p className={styles.bio}>{t('intro')}</p>
      </div>
      <div className={styles.headerSide}>
        <div className={styles.actions}><Button variant="outline" className={styles.editButton} onClick={() => setEditing(value => !value)} aria-expanded={editing}><User size={16} aria-hidden />{t('edit')}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className={styles.moreButton} aria-label={t('more')}><DotsThree size={18} aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void copyLink()}><LinkSimple size={16} />{t('copy')}</DropdownMenuItem><DropdownMenuItem onSelect={onRefresh}><ArrowClockwise size={16} />{t('refresh')}</DropdownMenuItem><DropdownMenuItem onSelect={() => setHonors(value => !value)}><Trophy size={16} />{t('honors')}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className={styles.stats}>
          {([{ section: 'documents', value: data?.documentTotal }, { section: 'folders', value: data?.folders.length }, { section: 'following', value: undefined }, { section: 'followers', value: undefined }] as const).map(stat => <Tooltip key={stat.section}><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.stat}`} onClick={() => onSection(stat.section)} aria-label={[t(stat.section), stat.value ?? t(stat.section === 'following' || stat.section === 'followers' ? 'relationshipsUnavailable' : 'chooseBase')].join(' · ')}><strong>{stat.value ?? '—'}</strong><span>{t(stat.section)}</span></button></TooltipTrigger><TooltipContent>{stat.section === 'following' || stat.section === 'followers' ? t('relationshipsUnavailable') : t(stat.section)}</TooltipContent></Tooltip>)}
        </div>
      </div>
    </header>
    {honors ? <section className={styles.honors} aria-label={t('honors')}>{badges.map(badge => <div key={badge.key}><Emoji value={badge.emoji} size={30} /><div><strong>{badge.title}<small>{t(badge.earned ? 'earned' : 'locked')}</small></strong><p>{badge.hint}</p></div></div>)}</section> : null}
    {editing ? <AccountProfile onClose={() => setEditing(false)} /> : null}
  </>;
}
