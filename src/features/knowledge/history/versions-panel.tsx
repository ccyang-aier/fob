'use client';
import { useQuery } from '@tanstack/react-query';
import { ClockCounterClockwise } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { messages } from '../sharing/collaboration.messages';
import { activityMessages } from './activity.messages';
import { createHistoryApi, type HistoryApi } from './history-api';
import { VersionList } from './version-list';
import styles from './history-panel.module.css';

const defaultApi = createHistoryApi();
export interface VersionsPanelProps { knowledgeBaseId: string; pageId: string; selectedId: string | null; onSelect(id: string | null): void; api?: HistoryApi }
export function VersionsPanel({ knowledgeBaseId, pageId, selectedId, onSelect, api = defaultApi }: VersionsPanelProps) {
  const { t } = useTranslation(activityMessages);
  const { t: versionT } = useTranslation(messages);
  const versions = useQuery({ queryKey: [knowledgeBaseId, 'history', pageId], queryFn: () => api.list(knowledgeBaseId, pageId), refetchInterval: 15_000 });
  const entries = versions.data?.checkpoints ?? [];
  return <section aria-label={t('versions')} className={styles.versionPanel}>
    <button type="button" className={`fob-action ${styles.currentVersion}`} data-surface="plain" data-active={!selectedId || undefined} aria-current={!selectedId ? 'true' : undefined} onClick={() => onSelect(null)}>{t('currentVersion')}</button>
    {versions.isPending ? <p role="status" className={styles.empty}>{t('loading')}</p>
      : versions.isError ? <div className={styles.error}><AppAlert tone="error" title={t('failed')} /><Button variant="outline" size="sm" onClick={() => void versions.refetch()}>{t('retry')}</Button></div>
        : !entries.length ? <div className={styles.empty}><ClockCounterClockwise size={24} /><strong>{versionT('noVersions')}</strong></div>
          : <VersionList entries={entries} selectedId={selectedId} onSelect={onSelect} />}
  </section>;
}
