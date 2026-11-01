'use client';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { DocumentModal } from '../../sharing/document-modal';
import { useLocalLibrary } from '../../local/use-local-library';
import { importLocalFolderDocuments } from '../../local/local-document-operations';
import { LocalDocumentImport } from './local-document-import';
import { KnowledgeBaseDocumentImport } from './server-document-import';
import { messages } from '../management/document-management.messages';
import styles from '../management/document-management.module.css';

export function FolderImportDialog({ knowledgeBaseId, source, folder, onClose }: { knowledgeBaseId: string; source: 'server' | 'local'; folder: { id: string; name: string }; onClose(): void }) {
  const { t } = useTranslation(messages);
  return <DocumentModal title={t('import')} onClose={onClose}><div className={styles.body}>
    <p className={styles.location}>{t('importInto', { folder: folder.name })}</p>
    {source === 'server' ? <KnowledgeBaseDocumentImport knowledgeBaseId={knowledgeBaseId} teamspaceId={folder.id} /> : <LocalFolderImport knowledgeBaseId={knowledgeBaseId} folderId={folder.id} />}
    <div className={styles.actions}><Button size="sm" variant="outline" onClick={onClose}>{t('close')}</Button></div>
  </div></DocumentModal>;
}

function LocalFolderImport({ knowledgeBaseId, folderId }: { knowledgeBaseId: string; folderId: string }) {
  const { store } = useLocalLibrary(), { t } = useTranslation(messages);
  return <LocalDocumentImport knowledgeBaseId={knowledgeBaseId} onImport={items => {
    if (!store) throw new Error(t('missing'));
    importLocalFolderDocuments(store, { knowledgeBaseId, folderId }, items, t('missing'));
    return true;
  }} />;
}
