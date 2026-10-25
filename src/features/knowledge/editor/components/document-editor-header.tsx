'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-editor-header.messages';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { List, Plus } from '@/components/icons';
import { DocumentShareButton } from '../../sharing/document-share-dialog';
import { DocumentMoreMenu, type DocumentMenuActions } from './document-more-menu';
import { DocumentStarButton } from './document-star-button';
import { useDocumentNavigation } from '../document-tools';
import styles from './document-editor-header.module.css';

export function DocumentEditorHeader({
  editor,
  title,
  avatarName,
  starred,
  onToggleStar,
  onCreateDocument,
  canCreateDocument = true,
  menuActions,
  presence,
  pdfNavigation,
}: {
  editor: Editor | null;
  folderName: string;
  title: string;
  avatarName: string;
  starred: boolean;
  onOpenSidebar: () => void;
  onToggleStar: () => void;
  onCreateDocument: () => void;
  canCreateDocument?: boolean;
  shareDescription: string;
  menuActions: DocumentMenuActions;
  presence?: ReactNode;
  pdfNavigation?: { open: boolean; id: string; onToggle: () => void };
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const navigation = useDocumentNavigation();

  return (
    <header className={styles.header}>
      <div className={styles.leading}>
        <button
          ref={navigation?.outlineTrigger}
          type="button"
          className={`fob-action ${styles.iconButton}`}
          data-surface="plain"
          data-active-emphasis="strong"
          aria-label={pdfNavigation ? knowledgeT('pdfThumbnails') : knowledgeT('documentOutline')}
          title={
            pdfNavigation
              ? pdfNavigation.open
                ? knowledgeT('collapseThumbnails')
                : knowledgeT('expandThumbnails')
              : navigation?.outlineOpen
                ? knowledgeT('collapseOutline')
                : knowledgeT('expandOutline')
          }
          aria-expanded={pdfNavigation?.open ?? navigation?.outlineOpen ?? false}
          aria-controls={pdfNavigation?.id ?? navigation?.outlineId}
          disabled={!pdfNavigation && !navigation?.onToggleOutline}
          onClick={pdfNavigation?.onToggle ?? navigation?.onToggleOutline}
        >
          <List aria-hidden size={16} />
        </button>
        <DocumentStarButton starred={starred} onToggle={onToggleStar} />
      </div>
      <div className={styles.actions}>
        <span className={styles.presence}>
          {presence ?? (
            <span className={styles.avatar} title={avatarName || knowledgeT('me')}>
              {Array.from(avatarName || knowledgeT('me'))[0]?.toUpperCase()}
            </span>
          )}
        </span>
        <DocumentShareButton target={menuActions.target} className={`${styles.outlineButton} ${styles.shareButton}`} />
        <button
          type="button"
          aria-label={knowledgeT('newDocument')}
          className={`fob-action ${styles.outlineButton} ${styles.createButton}`}
          disabled={!canCreateDocument}
          title={
            canCreateDocument ? knowledgeT('newDocument') : knowledgeT('youCannotCreateDocuments')
          }
          onClick={onCreateDocument}
        >
          <Plus aria-hidden size={16} />
          <span className={styles.createLabel}>{knowledgeT('new')}</span>
        </button>
        <DocumentMoreMenu
          editor={editor}
          title={title}
          starred={starred}
          onToggleStar={onToggleStar}
          actions={menuActions}
        />
      </div>
    </header>
  );
}
