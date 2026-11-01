'use client';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { DocumentModal } from '../../sharing/document-modal';
import { messages } from './messages';
import styles from './styles.module.css';

export function PermanentDeleteDocumentDialog({ title, onClose, onDelete }: { title: string; onClose(): void; onDelete(): void }) {
  const { t } = useTranslation(messages);
  return <DocumentModal title={t('deleteTitle')} onClose={onClose}><div className={styles.deleteBody}><p>{t('deleteHint', { title })}</p><div className={styles.deleteActions}><Button size="sm" variant="outline" onClick={onClose}>{t('cancel')}</Button><Button size="sm" variant="outline" data-variant="destructive" className="text-[var(--err-ink)]" onClick={onDelete}>{t('deleteForever')}</Button></div></div></DocumentModal>;
}
