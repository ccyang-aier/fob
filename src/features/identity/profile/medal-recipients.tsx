'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { profileMedalRecipientsSchema,type ProfileMedalAward,type ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { Trophy,Users } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useIdentity } from '../identity-context';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { knowledgeResourceRequest } from '@/features/knowledge/data/resource-http';
import { profileTimeZone } from '@/features/knowledge/profile/profile-time';
import { messages } from './messages';
import styles from './medal-wall.module.css';

export function MedalRecipients({ medal,awards }:{medal:ProfileMedalId;awards:readonly ProfileMedalAward[]}) {
  const { t,locale }=useTranslation(messages);
  const { selectedKnowledgeBase:base,principal }=useKnowledgeBaseResources();
  const { session }=useIdentity();
  const query=useInfiniteQuery({
    queryKey:['knowledge',base?.id,'profile-medal-recipients',principal,medal],
    enabled:base?.source==='server' && principal!=='guest',initialPageParam:0,
    queryFn:({ signal,pageParam }) => knowledgeResourceRequest(base!.id,`discovery/profile/medals/${medal}?offset=${pageParam}`,profileMedalRecipientsSchema,{ signal }),
    getNextPageParam:page => page.nextOffset ?? undefined,
  });
  const localAward=awards.find(award => award.id===medal);
  const recipients=base?.source==='local'
    ? localAward && session.status==='authenticated' ? [{ userId:session.user.id,name:session.user.name,image:session.user.image,earnedAt:localAward.earnedAt }] : []
    : query.data?.pages.flatMap(page => page.recipients) ?? [];
  const total=base?.source==='local' ? recipients.length : query.data?.pages[0]?.total;
  const dates=new Intl.DateTimeFormat(locale,{ timeZone:profileTimeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' });
  const pending=base?.source==='server' && query.isPending;
  return <section className={styles.recipients} aria-label={t('recipients')}>
    <div className={styles.listHeading}><h4>{t('recipients')}</h4>{total!==undefined ? <span>{t('recipientsCount',{ count:total })}</span> : null}</div>
    {pending ? <div className={styles.loading} role="status"><span className={styles.srOnly}>{t('loadingRecipients')}</span>{[0,1].map(index => <div className={styles.personSkeleton} key={index} aria-hidden><i /><span><b /><b /></span></div>)}</div>
      : query.isError && base?.source==='server' ? <div className={styles.loadError}><AppAlert tone="error" title={t('recipientsFailed')} /><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>{t('retry')}</Button></div>
      : recipients.length ? <div className={styles.recipientScroll} role="region" aria-label={t('recipientsList')} tabIndex={0}><ol className={styles.people}>{recipients.map((person,index) => <li key={person.userId}>
        <UserAvatar name={person.name} image={person.image} className={styles.avatar} />
        <div className={styles.personInfo}><div className={styles.personName}><strong title={person.name}>{person.name}</strong>{person.userId===principal ? <small>{t('you')}</small> : null}</div>
          <time dateTime={person.earnedAt}>{dates.format(new Date(person.earnedAt))}</time>
        </div>
        {index===0 ? <span className={styles.firstStamp} title={t('firstRecipient')}><Trophy size={12} aria-hidden /><span>{t('firstRecipientShort')}</span></span> : null}
      </li>)}</ol>{query.hasNextPage ? <Button type="button" variant="ghost" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t('loadMore')}</Button> : null}</div>
      : <div className={styles.empty}><Users size={26} aria-hidden /><p>{t('noRecipients')}</p></div>}
  </section>;
}
