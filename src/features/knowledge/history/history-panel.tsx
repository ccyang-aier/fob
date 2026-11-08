'use client';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { createHistoryApi, type HistoryApi } from './history-api';
import { VersionsPanel } from './versions-panel';
import { ActivityList } from './activity-list';
import { activityMessages } from './activity.messages';
import styles from './history-panel.module.css';
import collaborationStyles from '../sharing/document-collaboration.module.css';

const defaultApi = createHistoryApi();
const tabs = ['readers', 'versions'] as const;
type ActivityTab = typeof tabs[number];
export interface HistoryPanelProps { knowledgeBaseId: string; pageId: string; selectedVersionId: string | null; onSelectVersion(id: string | null): void; onClose(): void; api?: HistoryApi }

export function HistoryPanel({ knowledgeBaseId, pageId, selectedVersionId, onSelectVersion, onClose, api = defaultApi }: HistoryPanelProps) {
  const { t } = useTranslation(activityMessages);
  const id = useId();
  const [tab, setTab] = useState<ActivityTab>('readers');
  const activity = useQuery({ queryKey: [knowledgeBaseId, 'page-activity', pageId],
    queryFn: ({ signal }) => api.activity(knowledgeBaseId, pageId, signal), refetchInterval: 15_000 });
  return <section aria-label={t('activity')} className={`${styles.panel} ${collaborationStyles.surface}`}>
    <header className={styles.heading}><h2>{t('activity')}</h2>
      <button type="button" className={`fob-action ${styles.close}`} data-surface="muted" aria-label={t('close')} onClick={onClose}><X size={18} aria-hidden /></button>
    </header>
    <div role="tablist" aria-label={t('activity')} className={styles.activityTabs}>
      {tabs.map(value => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={tab === value}
        tabIndex={tab === value ? 0 : -1} className={`fob-action ${styles.activityTab}`} data-surface="plain" data-active={tab === value || undefined} onClick={() => setTab(value)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          setTab(tabs[index]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
        }}>{t(value)}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className={styles.activityBody}>
      {tab === 'versions' ? <VersionsPanel key={`${knowledgeBaseId}:${pageId}`} knowledgeBaseId={knowledgeBaseId} pageId={pageId} selectedId={selectedVersionId} onSelect={onSelectVersion} api={api} />
        : activity.isPending ? <p role="status" className={styles.empty}>{t('loading')}</p>
          : activity.isError ? <div className={styles.error}><AppAlert tone="error" title={t('failed')} /><Button variant="outline" size="sm" onClick={() => void activity.refetch()}>{t('retry')}</Button></div>
            : <ActivityList entries={activity.data.readers} />}
    </div>
  </section>;
}
