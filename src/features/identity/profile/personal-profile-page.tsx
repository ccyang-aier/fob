'use client';

import { useDeferredValue, useId } from 'react';
import type { ProfileResource } from '@fob/shared/knowledge/contracts';
import { useIdentity } from '../identity-context';
import { useTranslation } from '@/lib/i18n';
import { usePageSessionState } from '@/lib/page-session-state';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { ArrowLeft } from '@/components/icons';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { usePersonalProfile } from '@/features/knowledge/profile/use-personal-profile';
import { ProfileHeader } from './profile-header';
import { ActivityCalendar } from './activity-calendar';
import { ActivityTimeline } from './activity-timeline';
import { ProfileSidebar } from './profile-sidebar';
import { ProfileResourceList } from './profile-resources';
import { messages } from './messages';
import styles from './profile.module.css';

export type ProfileSection = 'activity' | 'documents' | 'folders' | 'saved' | 'following' | 'followers';
type OpenResource = (resource: Pick<ProfileResource, 'id' | 'kind'>) => void;
const sections = ['activity','documents','folders','saved'] as const;

export function PersonalProfilePage({ onOpenResource }: { onOpenResource: OpenResource }) {
  return <KnowledgeQueryProvider><ProfileContent onOpenResource={onOpenResource} /></KnowledgeQueryProvider>;
}

function ProfileContent({ onOpenResource }: { onOpenResource: OpenResource }) {
  const { t } = useTranslation(messages);
  const { session, openSignIn } = useIdentity();
  const resources = useKnowledgeBaseResources();
  const { notify } = useAppAlert();
  const [section, setSection] = usePageSessionState<ProfileSection>('profile:section', 'activity');
  const [selected, setSelected] = usePageSessionState<string | undefined>('profile:day', undefined);
  const [documentFilter, setDocumentFilter] = usePageSessionState<{ q: string; sort: 'recent' | 'name' }>('profile:document-filter', { q: '',sort: 'recent' });
  const deferredFilter = useDeferredValue(documentFilter);
  const profile = usePersonalProfile(selected, section === 'documents' ? 'documents' : 'activity', deferredFilter);
  const id = useId();
  async function refresh() {
    if (!profile.base) { notify('info', t('chooseBase')); return; }
    if (profile.base?.source === 'local') { notify('success', t('refreshDone')); return; }
    const result = await profile.refresh();
    notify(result.isError ? 'error' : 'success', result.isError ? t('loadFailed') : t('refreshDone'));
  }
  function toggleStar(resource: ProfileResource) {
    try { profile.toggleStar(resource.id); notify('success', t(resource.starred ? 'unsavedSuccess' : 'savedSuccess')); }
    catch { notify('error', t('savingFailed')); }
  }
  if (session.status === 'checking') return <ProfileLoading label={t('loading')} />;
  if (session.status !== 'authenticated') return <EmptyState label={t('signIn')} description={t('signInHint')} actions={<Button variant="outline" onClick={openSignIn}>{t('login')}</Button>} />;
  const base = profile.base;
  if (!base) return <div className={styles.page}><ProfileHeader onSection={setSection} onRefresh={() => void refresh()} /><EmptyState label={t('chooseBase')} description={resources.error ?? t('chooseBaseHint')} actions={<Button variant="outline" onClick={resources.openCreateKnowledgeBase}>{t('createBase')}</Button>} /></div>;
  const actions = { onOpen: onOpenResource, onToggleStar: toggleStar, knowledgeBaseId: base.id, source: base.source };
  return <div className={styles.page}>
    <ProfileHeader data={profile.data} onSection={setSection} onRefresh={() => void refresh()} />
    <div className={styles.navigation}><div className={styles.tabs} role="tablist" aria-label={t('profile')}>
      {sections.map((tab,index) => <button key={tab} type="button" role="tab" id={`${id}-tab-${tab}`} aria-controls={`${id}-panel`} aria-selected={section === tab} tabIndex={section === tab || (!sections.includes(section as typeof sections[number]) && index === 0) ? 0 : -1} onClick={() => setSection(tab)} onKeyDown={event => {
        if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index+(event.key === 'ArrowLeft' ? 3 : 1))%4; setSection(sections[next]); document.getElementById(`${id}-tab-${sections[next]}`)?.focus(); }
      }}>{t(tab)}</button>)}
    </div><span className={styles.scope}>{t(base.source === 'local' ? 'localScope' : 'scope', { name: base.name })}</span></div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${sections.includes(section as typeof sections[number]) ? section : 'activity'}`} className={styles.tabPanel}>
      {profile.loading && !profile.data ? <ProfileLoading label={t('loading')} /> : profile.error && !profile.data ? <div className={styles.error}><AppAlert tone="error" title={t('loadFailed')} description={profile.error.message === 'LOCAL_STORAGE_UNAVAILABLE' ? undefined : profile.error.message} /><Button variant="outline" onClick={() => void refresh()}>{t('retry')}</Button></div> : profile.data ? <>
        {profile.error ? <AppAlert tone="error" title={t('loadFailed')} /> : null}
        {section === 'activity' ? <div className={styles.columns}>
          <div className={styles.mainColumn}><ActivityCalendar calendar={profile.data.calendar} selected={selected} onSelect={date => setSelected(current => current === date ? undefined : date)} /><ActivityTimeline activities={profile.data.activities} selected={selected} onClear={() => setSelected(undefined)} onOpen={onOpenResource} nextOffset={profile.data.nextActivityOffset} onMore={() => void profile.loadMore()} loading={profile.fetching} /></div>
          <ProfileSidebar data={profile.data} selected={selected} changing={profile.changing} onSection={setSection} {...actions} />
        </div> : section === 'following' || section === 'followers' ? <div className={styles.relationships}><Button variant="ghost" onClick={() => setSection('activity')}><ArrowLeft size={16} />{t('back')}</Button><h2>{t(section)}</h2><EmptyState label={t('relationshipsUnavailable')} description={t('relationshipsHint')} actions={<Button variant="outline" onClick={() => setSection('saved')}>{t('savedAndFollowed')}</Button>} /></div> : <ProfileResourceList key={section} section={section} resources={section === 'documents' ? profile.data.documents : section === 'folders' ? profile.data.folders : profile.data.saved} nextOffset={section === 'documents' ? profile.data.nextDocumentOffset : null} onMore={() => void profile.loadMore()} loading={profile.fetching} query={section === 'documents' ? { ...documentFilter, onChange: setDocumentFilter } : undefined} {...actions} />}
      </> : null}
    </div>
  </div>;
}

function ProfileLoading({ label }: { label: string }) {
  return <div className={styles.loading} role="status" aria-label={label}><span className={styles.loadingLine} /><div className={styles.loadingColumns}><div /><div /></div><span className={styles.srOnly}>{label}</span></div>;
}
