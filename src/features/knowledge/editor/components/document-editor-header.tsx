'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-editor-header.messages';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { List, Plus, ShareNetwork } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  shareDescription,
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(
        `${title || knowledgeT('untitledDocument')}\n\n${editor?.getText() ?? ''}`,
      );
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.leading}>
        <button
          ref={navigation?.outlineTrigger}
          type="button"
          className={`fob-action ${styles.iconButton}`}
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
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) setCopyState('idle');
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={knowledgeT('share')}
              className={`${styles.outlineButton} ${styles.shareButton}`}
            >
              <ShareNetwork aria-hidden size={16} />
              <span className={styles.shareLabel}>{knowledgeT('share')}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.shareMenu}>
            <div className={styles.shareTitle}>{knowledgeT('shareDocument')}</div>
            <p className={styles.shareDescription}>{shareDescription}</p>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void copyContent();
              }}
            >
              {knowledgeT('copyTitleAndContent')}
            </DropdownMenuItem>
            {copyState !== 'idle' ? (
              <p role="status" className={styles.shareStatus} data-status={copyState}>
                {copyState === 'copied'
                  ? knowledgeT('copiedToClipboard')
                  : knowledgeT('unableToCopyCheckBrowserPermissions')}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
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
