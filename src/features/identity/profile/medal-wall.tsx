'use client';

import { useEffect,useId,useRef,useState } from 'react';
import { profileMedalCatalog,profileMedalFamilies,type ProfileMedalAward,type ProfileMedalId,type ProfileMedalProgress } from '@fob/shared/knowledge/contracts';
import { Check,LockSimple,Trophy,X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { profileTimeZone } from '@/features/knowledge/profile/profile-time';
import { MedalArt,medalById,medalFamilyLabels,medalRules } from './medal-art';
import { MedalRecipients } from './medal-recipients';
import { messages } from './messages';
import styles from './medal-wall.module.css';

const tierLabels={ 1:'tierOne',2:'tierTwo',3:'tierThree' } as const;

export function MedalWall({ awards,progress,initialMedal,onClose }:{awards:readonly ProfileMedalAward[];progress:readonly ProfileMedalProgress[];initialMedal?:ProfileMedalId;onClose:() => void}) {
  const { t,locale }=useTranslation(messages);
  const [selected,setSelected]=useState<ProfileMedalId>(initialMedal ?? awards[0]?.id ?? 'gardener');
  const [onlyEarned,setOnlyEarned]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null),titleId=useId();
  useEffect(() => { returnFocus.current=document.activeElement as HTMLElement;if (dialog.current && !dialog.current.open) dialog.current.showModal(); },[]);
  function close() {
    const trigger=returnFocus.current;dialog.current?.close();onClose();
    window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll:true }); });
  }
  const earned=new Map(awards.map(award => [award.id,award.earnedAt]));
  const medal=medalById[selected],selectedDate=earned.get(selected),currentProgress=progress.find(item => item.id===selected);
  const dates=new Intl.DateTimeFormat(locale,{ timeZone:profileTimeZone,year:'numeric',month:'long',day:'numeric' });
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault();event.stopPropagation();close(); }} onClose={event => { event.stopPropagation();onClose(); }} onClick={event => { if (event.target===event.currentTarget) close(); }}>
    <header className={styles.header}><div className={styles.title}><Trophy size={18} aria-hidden /><h2 id={titleId}>{t('medalWall')}</h2><span>{t('collectionProgress',{ earned:earned.size,total:profileMedalCatalog.length })}</span></div><Button type="button" variant="ghost" size="icon-sm" aria-label={t('closeMedals')} onClick={close}><X size={16} aria-hidden /></Button></header>
    <div className={styles.body}><div className={styles.wallLayout}>
      <section className={styles.showcase} aria-label={t('allMedals')}>
        <div className={styles.collectionToolbar}><div className={styles.filters} role="group" aria-label={t('medalWall')}>
          <Button type="button" variant="ghost" size="sm" aria-pressed={!onlyEarned} onClick={() => setOnlyEarned(false)}>{t('allMedals')}<span>{profileMedalCatalog.length}</span></Button>
          <Button type="button" variant="ghost" size="sm" aria-pressed={onlyEarned} onClick={() => { setOnlyEarned(true);if (!earned.has(selected) && awards[0]) setSelected(awards[0].id); }}>{t('myMedals')}<span>{earned.size}</span></Button>
        </div></div>
        <div className={styles.seriesGrid}>{profileMedalFamilies.map(family => {
          const medals=profileMedalCatalog.filter(item => item.family===family && (!onlyEarned || earned.has(item.id)));
          if (!medals.length) return null;
          return <section key={family} className={styles.series} aria-label={t(medalFamilyLabels[family])}>
            <div className={styles.collection}>{medals.map(item => <button type="button" key={item.id} className={`fob-action ${styles.medalCard}`} data-surface="plain" aria-pressed={selected===item.id} aria-label={`${t(item.id)} · ${t(earned.has(item.id) ? 'earned' : 'locked')}`} onClick={() => setSelected(item.id)}>
              <span className={styles.artWrap}><MedalArt id={item.id} locked={!earned.has(item.id)} />{earned.has(item.id) ? <span className={styles.ownedMark}><Check size={12} /></span> : null}</span>
              <span className={styles.medalName}>{t(item.id)}</span><span className={styles.tierDots} aria-label={t(tierLabels[item.tier])}>{[1,2,3].map(tier => <i key={tier} data-on={tier<=item.tier} />)}</span>
            </button>)}</div>
          </section>;
        })}</div>
        {onlyEarned && !earned.size ? <div className={styles.emptyCollection}><Trophy size={28} aria-hidden /><p>{t('noEarnedMedals')}</p><Button type="button" variant="outline" size="sm" onClick={() => setOnlyEarned(false)}>{t('viewAllMedals')}</Button></div> : null}
      </section>
      <aside className={styles.detailPanel} aria-label={t(selected)}>
        <div className={styles.detailTopline}><span>{t(medalFamilyLabels[medal.family])}</span><span>{t(tierLabels[medal.tier])}</span></div>
        <div className={styles.medalHero}><MedalArt id={selected} hero /><h3>{t(selected)}</h3><p>{t(medalRules[medal.family],{ count:medal.target })}</p>
          <span className={styles.unlockState} data-earned={Boolean(selectedDate)}>{selectedDate ? <Check size={12} aria-hidden /> : <LockSimple size={12} aria-hidden />}{t(selectedDate ? 'earned' : 'locked')}</span>
        </div>
        <div className={styles.goal}><div><span>{t('unlockProgress')}</span><strong>{currentProgress ? t('progressValue',{ value:Math.min(currentProgress.value,medal.target),target:medal.target }) : t('unknownProgress')}</strong></div>
          <div className={styles.goalTrack} aria-hidden><i style={{ width:`${Math.min(1,(currentProgress?.value ?? 0)/medal.target)*100}%` }} /></div>
          {selectedDate ? <p>{t('unlockedOn',{ date:dates.format(new Date(selectedDate)) })}</p> : null}
        </div>
        <MedalRecipients key={selected} medal={selected} awards={awards} />
      </aside>
    </div></div>
  </dialog>;
}
