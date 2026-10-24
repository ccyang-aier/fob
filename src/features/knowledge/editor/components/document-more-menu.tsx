'use client';

import { useUiMessage } from '../../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-more-menu.messages';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Bell,
  ChatCircleDots,
  ClockCounterClockwise,
  Copy,
  DotsThree,
  DownloadSimple,
  FileArrowUp,
  FileCode,
  FilePdf,
  FileText,
  LinkSimple,
  LockSimple,
  MagnifyingGlass,
  MarkdownLogo,
  Printer,
  PushPin,
  SplitHorizontal,
  Trash,
  Presentation,
  FolderSimple,
  SquaresFour,
} from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModalDialog } from '../../organization/ui';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { documentLink, type DocumentLinkTarget } from '../document-link';
import { useDocumentNavigation } from '../document-tools';
import { DocumentAppearanceMenu } from './document-appearance-menu';
import { DocumentStarMenuItem } from './document-star-menu-item';
import {
  documentContent,
  downloadDocument,
  printDocument,
  type ContentFormat,
} from './document-content-actions';
import styles from './document-more-menu.module.css';
import headerStyles from './document-editor-header.module.css';

export type DocumentMenuActions = {
  target: DocumentLinkTarget;
  onComments?: () => void;
  onHistory?: () => void;
  onDelete?: () => Promise<void> | void;
};

function ReservedItem({ children, icon }: { children: string; icon: ReactNode }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <DropdownMenuItem disabled className={styles.item} title={knowledgeT('notAvailableYet')}>
      <span className={styles.icon}>{icon}</span>
      {children}
      <span className={styles.pending}>{knowledgeT('comingSoon')}</span>
    </DropdownMenuItem>
  );
}

export function DocumentMoreMenu({
  editor,
  title,
  starred,
  onToggleStar,
  actions,
}: {
  editor: Editor | null;
  title: string;
  starred: boolean;
  onToggleStar: () => void;
  actions: DocumentMenuActions;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const navigation = useDocumentNavigation();
  const { notify } = useAppAlert();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useUiMessage(knowledgeMessages, '');
  const action = async (work: () => Promise<void> | void, success: string, failure?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
      notify('success', success);
    } catch (error) {
      notify(
        'error',
        failure
          ? error instanceof Error
            ? error.message
            : failure
          : knowledgeT('actionFailedCheckBrowserPermissionsOrRetryLater'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const copy = (format: ContentFormat | 'link') =>
    action(async () => {
      const content =
        format === 'link'
          ? documentLink(window.location.href, actions.target)
          : await documentContent(editor!, title, format);
      await navigator.clipboard.writeText(content);
    }, knowledgeT('copiedToClipboard'));
  const exportContent = (format: 'markdown' | 'html') =>
    action(
      async () => downloadDocument(await documentContent(editor!, title, format), title, format),
      knowledgeT('documentExported'),
    );
  const exportPdf = () =>
    action(
      async () => {
        notify('info', knowledgeT('generatingPdf'), undefined, { duration: 0 });
        const { exportDocumentPdf } = await import('./document-pdf-export');
        await exportDocumentPdf(editor!, title);
      },
      knowledgeT('pdfExported'),
      knowledgeT('unableToExportPdfRetryLater'),
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={headerStyles.moreButton}
            aria-label={knowledgeT('moreDocumentActions')}
            title={knowledgeT('moreDocumentActions')}
          >
            <DotsThree aria-hidden size={24} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={styles.menu}>
          <DropdownMenuGroup aria-label={knowledgeT('contentAndAppearance')}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={styles.item}>
                <Copy aria-hidden />
                {knowledgeT('copy')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={styles.submenu}>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={busy}
                  onSelect={() => void copy('link')}
                >
                  <LinkSimple aria-hidden />
                  {knowledgeT('copyLink')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void copy('text')}
                >
                  <FileText aria-hidden />
                  {knowledgeT('copyText')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void copy('markdown')}
                >
                  <MarkdownLogo aria-hidden />
                  {knowledgeT('copyMarkdown')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void copy('html')}
                >
                  <FileCode aria-hidden />
                  {knowledgeT('copyHtml')}
                </DropdownMenuItem>
                {actions.target.source === 'local' ? (
                  <p className={styles.hint}>{knowledgeT('localLinksOnlyWorkInTheBrowserWhere')}</p>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DocumentAppearanceMenu triggerClassName={styles.item} />
            <DropdownMenuItem
              className={styles.item}
              disabled={!editor || !navigation}
              onSelect={navigation?.onPresent}
            >
              <Presentation aria-hidden />
              {knowledgeT('present')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label={knowledgeT('followAndCollaborate')}>
            <DocumentStarMenuItem
              className={styles.item}
              starred={starred}
              onToggleStar={onToggleStar}
            />
            <ReservedItem icon={<Bell aria-hidden />}>{knowledgeT('subscribe')}</ReservedItem>
            <ReservedItem icon={<LockSimple aria-hidden />}>
              {knowledgeT('permissions')}
            </ReservedItem>
            <ReservedItem icon={<SquaresFour aria-hidden />}>
              {knowledgeT('createTemplate')}
            </ReservedItem>
            {actions.onComments ? (
              <DropdownMenuItem className={styles.item} onSelect={actions.onComments}>
                <ChatCircleDots aria-hidden />
                {knowledgeT('comments')}
              </DropdownMenuItem>
            ) : (
              <ReservedItem icon={<ChatCircleDots aria-hidden />}>
                {knowledgeT('comments')}
              </ReservedItem>
            )}
            {actions.onHistory ? (
              <DropdownMenuItem className={styles.item} onSelect={actions.onHistory}>
                <ClockCounterClockwise aria-hidden />
                {knowledgeT('history')}
              </DropdownMenuItem>
            ) : (
              <ReservedItem icon={<ClockCounterClockwise aria-hidden />}>
                {knowledgeT('history')}
              </ReservedItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label={knowledgeT('importAndOutput')}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={styles.item}>
                <DownloadSimple aria-hidden />
                {knowledgeT('export')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={styles.submenu}>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void exportContent('html')}
                >
                  <FileCode aria-hidden />
                  {knowledgeT('exportHtml')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void exportContent('markdown')}
                >
                  <FileText aria-hidden />
                  {knowledgeT('exportMarkdown')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={styles.item}
                  disabled={!editor || busy}
                  onSelect={() => void exportPdf()}
                >
                  <FilePdf aria-hidden />
                  {knowledgeT('exportPdf')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              className={styles.item}
              disabled={!editor || busy}
              onSelect={() =>
                void action(
                  async () => printDocument(await documentContent(editor!, title, 'html')),
                  knowledgeT('printWindowOpened'),
                )
              }
            >
              <Printer aria-hidden />
              {knowledgeT('print')}
            </DropdownMenuItem>
            <ReservedItem icon={<FileArrowUp aria-hidden />}>{knowledgeT('import')}</ReservedItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label={knowledgeT('organizeAndBrowse')}>
            <ReservedItem icon={<FolderSimple aria-hidden />}>{knowledgeT('move')}</ReservedItem>
            <DropdownMenuItem
              className={styles.item}
              disabled={!navigation?.onTogglePin}
              onSelect={(event) => {
                event.preventDefault();
                navigation?.onTogglePin?.();
              }}
            >
              <PushPin aria-hidden weight={navigation?.pinned ? 'fill' : 'regular'} />
              {navigation?.pinned ? knowledgeT('unpin') : knowledgeT('pin')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.item}
              disabled={!editor || !navigation?.onSplit}
              onSelect={navigation?.onSplit}
            >
              <SplitHorizontal aria-hidden />
              {knowledgeT('openInSplitView')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.item}
              disabled={!editor || !navigation}
              onSelect={navigation?.onSearch}
            >
              <MagnifyingGlass aria-hidden />
              {knowledgeT('searchDocument')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label={knowledgeT('deleteDocument')}>
            <DropdownMenuItem
              variant="destructive"
              className={styles.item}
              disabled={!actions.onDelete || busy}
              title={
                !actions.onDelete
                  ? knowledgeT('yourPermissionsDoNotAllowDeletingThisDocument')
                  : undefined
              }
              onSelect={() => {
                setDeleteError('');
                setConfirmDelete(true);
              }}
            >
              <Trash aria-hidden />
              {knowledgeT('delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModalDialog
        open={confirmDelete}
        width="w-[min(440px,calc(100vw-32px))]"
        onClose={() => {
          if (!busy) setConfirmDelete(false);
        }}
        title={knowledgeT('deleteDocument2')}
        description={knowledgeT('valueWillBeMovedToTrashYouCan', {
          v0: title.trim() || knowledgeT('untitledDocument'),
        })}
        footer={
          <>
            <button
              type="button"
              autoFocus
              className={styles.cancel}
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              {knowledgeT('cancel')}
            </button>
            <button
              type="button"
              className={styles.delete}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  try {
                    await actions.onDelete?.();
                    setConfirmDelete(false);
                  } catch (error) {
                    setDeleteError({ key: 'unableToDeleteTheDocumentWasKeptRetry' });
                    throw error;
                  }
                }, knowledgeT('documentMovedToTrash'))
              }
            >
              {busy ? knowledgeT('deleting') : knowledgeT('moveToTrash')}
            </button>
          </>
        }
      >
        {deleteError ? <AppAlert tone="error" title={deleteError} /> : null}
      </ModalDialog>
    </>
  );
}
