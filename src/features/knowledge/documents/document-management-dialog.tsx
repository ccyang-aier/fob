'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import type { DocumentLinkTarget } from '../editor/document-link';
import { DocumentModal } from '../sharing/document-modal';
import { useKnowledgePagesQuery } from '../data/pages-queries';
import { flattenKnowledgeBaseList, useKnowledgeTeamspacesQuery } from '../data/catalog-queries';
import { moveKnowledgePage, transferKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import { organizationQueryKeys } from '../organization/keys';
import { useLocalLibrary } from '../local/use-local-library';
import { getLocalFolderSession } from '../local/local-folder-session';
import { moveLocalDocument } from '../local/local-document-operations';
import { DocumentMoveForm } from './management/document-move-form';
import { messages } from './management/document-management.messages';
import styles from './management/document-management.module.css';

type ManagementProps = {
  target: DocumentLinkTarget;
  operation: 'move';
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function DocumentManagementDialog(props: Omit<ManagementProps, 'onBusyChange'>) {
  const { t } = useTranslation(messages);
  const [busy, setBusy] = useState(false);
  return <DocumentModal title={t(props.operation)} onClose={() => { if (!busy) props.onClose(); }}>
    <div className={styles.body}>
      {props.target.source === 'server'
        ? <ServerDocumentManagement {...props} onBusyChange={setBusy} />
        : <LocalDocumentManagement {...props} onBusyChange={setBusy} />}
    </div>
  </DocumentModal>;
}

function ServerDocumentManagement({ target, onClose, onBusyChange }: ManagementProps) {
  const { t } = useTranslation(messages), { notify } = useAppAlert();
  const client = useQueryClient();
  const pages = useKnowledgePagesQuery(target.knowledgeBaseId);
  const directory = useKnowledgeTeamspacesQuery(target.knowledgeBaseId);
  const folders = flattenKnowledgeBaseList(directory.data);
  const page = pages.data?.find(item => item.id === target.pageId && item.deletedAt === null);
  const folder = folders.find(item => item.id === page?.teamspaceId);
  if (pages.isError || directory.isError || directory.isFetchNextPageError) return <>
    <AppAlert tone="error" title={t('unavailable')} />
    <Button variant="outline" size="sm" onClick={() => { void pages.refetch(); void directory.refetch(); }}>{t('retry')}</Button>
  </>;
  if (pages.isPending || directory.isPending || directory.hasNextPage) return <p role="status">{t('loading')}</p>;
  if (!page || !folder) return <AppAlert tone="error" title={t('missing')} />;
  return <DocumentMoveForm
    folders={folders.filter(item => item.id !== page.teamspaceId || page.parentId !== null)}
    server onClose={onClose} onBusyChange={onBusyChange}
    onMove={async id => {
      if (!folders.some(item => item.id === id)) throw new Error(t('missing'));
      if (id === page.teamspaceId) {
        await moveKnowledgePage(target.knowledgeBaseId, { pageId: page.id, teamspaceId: id, parentId: null, afterPageId: null, operationId: crypto.randomUUID() });
      } else {
        await transferKnowledgePage(target.knowledgeBaseId, { pageId: page.id, targetTeamspaceId: id });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: knowledgeQueryKeys.pages(target.knowledgeBaseId) }),
        client.invalidateQueries({ queryKey: organizationQueryKeys.teamspaces(target.knowledgeBaseId) }),
      ]);
      notify('success', t('moved'));
    }}
  />;
}

function LocalDocumentManagement({ target, onClose, onBusyChange }: ManagementProps) {
  const { t } = useTranslation(messages), { notify } = useAppAlert();
  const { library, store, error } = useLocalLibrary();
  const document = library.documents.find(item => item.baseId === target.knowledgeBaseId && item.id === target.pageId && !item.deleted);
  const folders = library.folders.filter(item => item.knowledgeBaseId === target.knowledgeBaseId);
  if (error || !store || !document) return <AppAlert tone="error" title={t('missing')} />;
  const destinations = [...folders, ...(document.folderId ? [{ id: 'unfiled', name: t('unfiled') }] : [])].filter(item => item.id !== document.folderId);
  return <DocumentMoveForm folders={destinations} server={false} onClose={onClose} onBusyChange={onBusyChange} onMove={async id => {
    moveLocalDocument(store, target, id === 'unfiled' ? undefined : id, t('missing'));
    await getLocalFolderSession().flush(target.knowledgeBaseId);
    notify('success', t('moved'));
  }} />;
}
