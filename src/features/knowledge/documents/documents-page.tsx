'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './documents-page.messages';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePageSessionState, usePageScrollKey } from '@/lib/page-session-state';
import { CaretRight, FileText, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import styles from './documents-page.module.css';
import { formatOf } from './document-visuals';
import { DocumentFolders } from './document-folders';
import { DocumentCollection } from './document-collection';
import { DocumentsToolbar } from './documents-toolbar';
import type { DocumentItem, DocumentFolder } from './types';
import { documentSourceLabel } from './document-metadata';
type Props = {
  documents: DocumentItem[];
  folders: DocumentFolder[];
  onOpen: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onCreate: () => void;
  onCreateFolder?: () => void;
  upload: ReactNode;
  renderMenu: (id: string) => ReactNode;
  canEdit?: boolean;
  onExpandSidebar?: () => void;
};
export function DocumentsPage({
  documents,
  folders,
  onOpen,
  onOpenFolder,
  onCreate,
  onCreateFolder,
  upload,
  renderMenu,
  canEdit = true,
  onExpandSidebar,
}: Props) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const uploadDialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = usePageSessionState('documents.search', '');
  const [filter, setFilter] = usePageSessionState('documents.filter', 'all');
  const [ascending, setAscending] = usePageSessionState('documents.ascending', false);
  const [layout, setLayout] = usePageSessionState<'table' | 'grid'>('documents.layout', 'table');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFolders, setAllFolders] = usePageSessionState('documents.folders', false);
  const scrollKey = usePageScrollKey('documents');
  const [uploadOpen, setUploadOpen] = useState(false);
  useEffect(() => {
    if (uploadOpen) uploadDialog.current?.showModal();
    else uploadDialog.current?.close();
  }, [uploadOpen]);
  const shown = useMemo(
    () =>
      documents
        .filter(
          (doc) =>
            doc.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
            (filter === 'all' ||
              (filter === 'starred' ? doc.starred : formatOf(doc.title) === filter)),
        )
        .sort((a, b) => (ascending ? 1 : -1) * a.updatedAt.localeCompare(b.updatedAt)),
    [documents, search, filter, ascending],
  );
  const visibleFolders = folders.filter((folder) =>
    folder.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const formats = [...new Set(documents.map((doc) => formatOf(doc.title)))];
  const selectedCount = shown.filter((doc) => selected.has(doc.id)).length;
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exportSelection() {
    const blob = new Blob(
      [
        knowledgeT('nameFormatUpdatedSource') +
          shown
            .filter((doc) => selected.has(doc.id))
            .map((doc) =>
              [
                doc.title,
                formatOf(doc.title),
                doc.updatedAt,
                documentSourceLabel(doc.source, locale),
              ]
                .map((value) => `"${value.replaceAll('"', '""')}"`)
                .join(','),
            )
            .join('\n'),
      ],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = knowledgeT('documentsCsv');
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className={styles.page} aria-label={knowledgeT('knowledgeBaseDocuments')}>
      <DocumentsToolbar
        count={documents.length}
        search={search}
        onSearch={setSearch}
        filter={filter}
        formats={formats}
        onFilter={setFilter}
        ascending={ascending}
        onSort={() => setAscending(!ascending)}
        layout={layout}
        onLayout={setLayout}
        canEdit={canEdit}
        onCreate={onCreate}
        onCreateFolder={onCreateFolder}
        onUpload={() => setUploadOpen(true)}
        selectedCount={selectedCount}
        onExport={exportSelection}
        onExpandSidebar={onExpandSidebar}
        onReset={() => {
          setSearch('');
          setFilter('all');
          setAscending(false);
          setLayout('table');
          setSelected(new Set());
          setAllFolders(false);
        }}
      />
      <div className={styles.content} data-page-scroll={scrollKey}>
        <div className={styles.sectionHeading}>
          <h2>
            {knowledgeT(folders.length === 1 ? 'oneFolderHeading' : 'folderHeading', {
              count: folders.length,
            })}
          </h2>
          <button onClick={() => setAllFolders(!allFolders)}>
            {allFolders ? knowledgeT('collapseFolders') : knowledgeT('allFolders')}
            <CaretRight size={14} />
          </button>
        </div>
        <DocumentFolders
          visibleFolders={visibleFolders}
          allFolders={allFolders}
          onOpenFolder={onOpenFolder}
          onCreateFolder={onCreateFolder}
          canEdit={canEdit}
        />
        <div className={styles.sectionHeading}>
          <h2>
            {knowledgeT(shown.length === 1 ? 'oneFileHeading' : 'fileHeading', {
              count: shown.length,
            })}
          </h2>
          {selectedCount ? (
            <div className={styles.selection} role="status">
              {knowledgeT('selected')} {selectedCount}{' '}
              {knowledgeT(selectedCount === 1 ? 'oneItem' : 'items')}
              <button onClick={exportSelection}>{knowledgeT('exportList')}</button>
              <button onClick={() => setSelected(new Set())}>{knowledgeT('clearSelection')}</button>
            </div>
          ) : null}
        </div>
        <DocumentCollection
          layout={layout}
          shown={shown}
          selected={selected}
          selectedCount={selectedCount}
          setSelected={setSelected}
          toggle={toggle}
          ascending={ascending}
          setAscending={setAscending}
          onOpen={onOpen}
          renderMenu={renderMenu}
        />
        {!shown.length ? (
          <div className={styles.empty}>
            <FileText size={32} />
            <strong>
              {search || filter !== 'all'
                ? knowledgeT('noMatchingDocuments')
                : knowledgeT('startOrganizingYourKnowledge')}
            </strong>
            <p>
              {search || filter !== 'all'
                ? knowledgeT('tryDifferentKeywordsOrResetFilters')
                : knowledgeT('createADocumentToCollectIdeasAndResources')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className={styles.control}
              onClick={
                search || filter !== 'all'
                  ? () => {
                      setSearch('');
                      setFilter('all');
                    }
                  : onCreate
              }
            >
              {search || filter !== 'all'
                ? knowledgeT('resetSearchAndFilters')
                : knowledgeT('newDocument')}
            </Button>
          </div>
        ) : null}
      </div>
      <dialog
        ref={uploadDialog}
        onCancel={() => setUploadOpen(false)}
        onClose={() => setUploadOpen(false)}
        className={styles.uploadDialog}
        aria-label={knowledgeT('uploadDocuments')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setUploadOpen(false);
        }}
      >
        <div className={styles.dialogHeader}>
          <h2>{knowledgeT('uploadDocuments')}</h2>
          <button
            autoFocus
            aria-label={knowledgeT('closeUpload')}
            onClick={() => setUploadOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        {uploadOpen ? upload : null}
      </dialog>
    </section>
  );
}
