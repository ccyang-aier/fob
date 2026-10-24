'use client';

import { FolderSimple } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { useProjectResources } from './project-resources';
import { messages } from './i18n/project-workspace-pages';
import styles from './project-workspace-pages.module.css';

export function ProjectSelectionEmpty() {
  const { t } = useTranslation(messages);
  const { status } = useProjectResources();
  return <section className={styles.page}><div className={styles.empty}><FolderSimple size={36} weight="duotone" aria-hidden /><h2>{t(status === 'loading' ? 'loading' : 'selectProject')}</h2>{status !== 'loading' && <p>{t('selectDescription')}</p>}</div></section>;
}
