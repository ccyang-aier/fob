'use client';

import type { ProfileResource } from '@fob/shared/knowledge/contracts';
import { useIdentity } from '../identity-context';
import { useTranslation } from '@/lib/i18n';
import { usePageSessionState } from '@/lib/page-session-state';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { usePersonalProfile } from '@/features/knowledge/profile/use-personal-profile';
import { ProfileHeader } from './profile-header';
import { ActivityCalendar } from './activity-calendar';
import { ActivityTimeline } from './activity-timeline';
import { ProfileSidebar } from './profile-sidebar';
import { ProfileDocuments } from './profile-resources';
import { messages } from './messages';
import styles from './profile.module.css';

type OpenResource = (resource: Pick<ProfileResource, 'id' | 'kind'>) => void;

export function PersonalProfilePage({ onOpenResource }: { onOpenResource: OpenResource }) {
  return (
    <div className={styles.viewport} data-page-scroll="personal-profile" tabIndex={-1}>
      <KnowledgeQueryProvider><ProfileContent onOpenResource={onOpenResource} /></KnowledgeQueryProvider>
    </div>
  );
}

function ProfileContent({ onOpenResource }: { onOpenResource: OpenResource }) {
  const { t } = useTranslation(messages);
  const { session, openSignIn } = useIdentity();
  const resources = useKnowledgeBaseResources();
  const { notify } = useAppAlert();
  const [selected, setSelected] = usePageSessionState<string | undefined>('profile:day', undefined);
  const profile = usePersonalProfile(selected);

  async function refresh() {
    if (!profile.base) { notify('info', t('chooseBase')); return; }
    if (profile.base.source === 'local') { notify('success', t('refreshDone')); return; }
    const result = await profile.refresh();
    notify(result.isError ? 'error' : 'success', result.isError ? t('loadFailed') : t('refreshDone'));
  }

  function toggleStar(resource: ProfileResource) {
    try { profile.toggleStar(resource.id); notify('success', t(resource.starred ? 'unsavedSuccess' : 'savedSuccess')); }
    catch { notify('error', t('savingFailed')); }
  }

  if (session.status === 'checking') return <ProfileLoading label={t('loading')} />;
  if (session.status !== 'authenticated') {
    return <EmptyState label={t('signIn')} description={t('signInHint')} actions={<Button variant="outline" onClick={openSignIn}>{t('login')}</Button>} />;
  }

  const base = profile.base;
  return (
    <div className={styles.page}>
      <ProfileHeader data={profile.data} scope={base ? t(base.source === 'local' ? 'localScope' : 'scope', { name: base.name }) : undefined} onRefresh={() => void refresh()} />
      {!base ? (
        <EmptyState label={t('chooseBase')} description={resources.error ?? t('chooseBaseHint')} actions={<Button variant="outline" onClick={resources.openCreateKnowledgeBase}>{t('createBase')}</Button>} />
      ) : (
        <>
          {profile.loading && !profile.data ? <ProfileLoading label={t('loading')} /> : profile.error && !profile.data ? (
            <div className={styles.error}>
              <AppAlert tone="error" title={t('loadFailed')} description={profile.error.message === 'LOCAL_STORAGE_UNAVAILABLE' ? undefined : profile.error.message} />
              <Button variant="outline" onClick={() => void refresh()}>{t('retry')}</Button>
            </div>
          ) : profile.data ? (
            <>
              {profile.error ? <AppAlert tone="error" title={t('loadFailed')} /> : null}
              <div className={styles.columns}>
                <div className={styles.mainColumn}>
                  <ActivityCalendar calendar={profile.data.calendar} selected={selected} onSelect={setSelected} />
                  <div className={styles.activityAndDocuments}>
                    <ActivityTimeline activities={profile.data.activities} selected={selected} onClear={() => setSelected(undefined)} onOpen={onOpenResource} nextOffset={profile.data.nextActivityOffset} onMore={() => void profile.loadMore()} loading={profile.fetching} />
                    <ProfileDocuments resources={profile.data.documents} total={profile.data.documentTotal} nextOffset={profile.data.nextDocumentOffset}
                      onMore={() => void profile.loadMoreDocuments()} loading={profile.documentsFetching} error={profile.documentsError}
                      onRetry={() => void profile.retryDocuments()} onOpen={onOpenResource} onToggleStar={toggleStar} knowledgeBaseId={base.id} source={base.source} />
                  </div>
                </div>
                <ProfileSidebar data={profile.data} selected={selected} changing={profile.changing} />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProfileLoading({ label }: { label: string }) {
  return <div className={styles.loading} role="status"><span className={styles.loadingLine} /><div className={styles.loadingColumns}><div /><div /></div><span className={styles.srOnly}>{label}</span></div>;
}
