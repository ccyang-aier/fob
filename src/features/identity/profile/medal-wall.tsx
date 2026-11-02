'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { profileMedalRecipientsSchema, type ProfileMedalAward, type ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { Check, LockSimple, Trophy, X } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { useIdentity } from '../identity-context';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { knowledgeResourceRequest } from '@/features/knowledge/data/resource-http';
import { profileMedalIds } from '@/features/knowledge/profile/profile-medals';
import { profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { MedalArt, medalRules } from './medal-art';
import { messages } from './messages';
import styles from './medal-wall.module.css';

function MedalRecipients({ medal, awards }: { medal: ProfileMedalId; awards: readonly ProfileMedalAward[] }) {
  const { t,locale } = useTranslation(messages);
  const { selectedKnowledgeBase: base,principal } = useKnowledgeBaseResources();
  const { session } = useIdentity();
  const query = useInfiniteQuery({
    queryKey: ['knowledge',base?.id,'profile-medal-recipients',principal,medal],
    enabled: base?.source==='server' && principal!=='guest',
    initialPageParam: 0,
    queryFn: ({ signal,pageParam }) => knowledgeResourceRequest(base!.id,`discovery/profile/medals/${medal}?offset=${pageParam}`,profileMedalRecipientsSchema,{ signal }),
    getNextPageParam: page => page.nextOffset ?? undefined,
  });
  const localAward = awards.find(award => award.id===medal);
  const recipients = base?.source==='local'
    ? localAward && session.status==='authenticated' ? [{ userId: session.user.id,name: session.user.name,image: session.user.image,earnedAt: localAward.earnedAt }] : []
    : query.data?.pages.flatMap(page => page.recipients) ?? [];
  const dates = new Intl.DateTimeFormat(locale,{ timeZone: profileTimeZone,year: 'numeric',month: 'short',day: 'numeric',hour: '2-digit',minute: '2-digit' });
  return <section className={styles.recipients} aria-label={t('recipients')}>
    <div className={styles.listHeading}><h3>{t('recipients')}</h3></div>
    {base?.source==='server' && query.isPending ? <div className={styles.loading} role="status">{t('loading')}</div>
      : query.isError && base?.source==='server' ? <div className={styles.loadError}><AppAlert tone="error" title={t('recipientsFailed')} /><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>{t('retry')}</Button></div>
      : recipients.length ? <ul className={styles.people}>{recipients.map(person => <li key={person.userId}><UserAvatar name={person.name} image={person.image} className={styles.avatar} /><div className={styles.personInfo}><span className={styles.personName}>{person.name}{person.userId===principal ? <small>{t('you')}</small> : null}</span><time dateTime={person.earnedAt} title={t('awardedAt')}>{dates.format(new Date(person.earnedAt))}</time></div></li>)}</ul>
      : <p className={styles.empty}>{t('noRecipients')}</p>}
    {query.hasNextPage ? <Button type="button" variant="ghost" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('loadMore')}</Button> : null}
    <p className={styles.scope}>{t(base?.source==='local' ? 'localOwner' : 'recipientsScope')}</p>
  </section>;
}

export function MedalWall({ awards, initialMedal, onClose }: { awards: readonly ProfileMedalAward[]; initialMedal?: ProfileMedalId; onClose: () => void }) {
  const { t,locale } = useTranslation(messages);
  const [selected,setSelected] = useState<ProfileMedalId>(initialMedal ?? 'gardener');
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef<HTMLElement | null>(null), titleId = useId();
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  },[]);
  function close() {
    const trigger = returnFocus.current;
    dialog.current?.close(); onClose();
    window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
  }
  const earned = new Map(awards.map(award => [award.id,award.earnedAt]));
  const selectedDate = earned.get(selected);
  const dates = new Intl.DateTimeFormat(locale,{ timeZone: profileTimeZone,year: 'numeric',month: 'long',day: 'numeric' });
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onClose={event => { event.stopPropagation(); onClose(); }} onClick={event => { if (event.target===event.currentTarget) close(); }}>
    <header className={styles.header}><div><span className={styles.titleIcon}><Trophy size={18} aria-hidden /></span><h2 id={titleId}>{t('medalWall')}</h2></div><Button type="button" variant="ghost" size="icon-sm" aria-label={t('closeMedals')} onClick={close}><X size={16} aria-hidden /></Button></header>
    <div className={styles.body}>
      <div className={styles.wallLayout}>
      <section className={styles.showcase} aria-label={t('medalWall')}>
      <div className={styles.progress}><span>{t('collectionProgress',{ earned: earned.size,total: profileMedalIds.length })}</span><span className={styles.progressTrack} aria-hidden><i style={{ width: `${earned.size/profileMedalIds.length*100}%` }} /></span></div>
      <div className={styles.collection}>
        {profileMedalIds.map(id => <button key={id} type="button" className={`fob-action ${styles.medalCard}`} data-surface="plain" data-earned={earned.has(id)} aria-pressed={selected===id} aria-label={`${t(id)} · ${t(earned.has(id) ? 'earned' : 'locked')}`} onClick={() => setSelected(id)}>
          <MedalArt id={id} locked={!earned.has(id)} /><strong>{t(id)}</strong><span className={styles.awardState}>{earned.has(id) ? <Check size={12} aria-hidden /> : <LockSimple size={12} aria-hidden />}{t(earned.has(id) ? 'earned' : 'locked')}</span>
        </button>)}
      </div>
      <div className={styles.detail}>
        <div className={styles.detailHeading}><h3>{t(selected)}</h3><p>{t(medalRules[selected])}</p>{selectedDate ? <span className={styles.earnedDate}><Check size={12} aria-hidden />{dates.format(new Date(selectedDate))}</span> : null}</div>
      </div>
      </section>
      <MedalRecipients key={selected} medal={selected} awards={awards} />
      </div>
    </div>
  </dialog>;
}
