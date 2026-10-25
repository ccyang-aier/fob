'use client';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

export function RichContentLoading() {
  const { t } = useTranslation(richMessages);
  return <div className={styles.state} role="status">{t('loading')}</div>;
}
