'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './messages';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { List, Plus } from '@/components/icons';
import { DocumentShareButton } from '../../../sharing/document-share-dialog';
import { DocumentMoreMenu, type DocumentMenuActions } from '../document-more-menu';
import { DocumentStarButton } from '../document-star';
import styles from './styles.module.css';

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

  const headerRef = useRef<HTMLElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const leading = leadingRef.current;
    const actions = actionsRef.current;
    if (!header || !leading || !actions) return;
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      const inset = Math.ceil(Math.max(
        leading.getBoundingClientRect().right - bounds.left,
        bounds.right - actions.getBoundingClientRect().left,
      ) + 12);
      header.style.setProperty('--document-title-inset', `${inset}px`);
      header.dataset.titleRoom = String(bounds.width - inset * 2 >= 80);
    };
    const observer = new ResizeObserver(measure);
    [header, leading, actions].forEach(element => observer.observe(element));
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={headerRef} className={styles.header} data-title-room="false">
      <div ref={leadingRef} className={styles.leading}>
        {pdfNavigation && <button
          type="button"
          className={`fob-action ${styles.iconButton}`}
          data-surface="plain"
          data-variant="hover"
          aria-label={knowledgeT('pdfThumbnails')}
          title={knowledgeT(pdfNavigation.open ? 'collapseThumbnails' : 'expandThumbnails')}
          aria-expanded={pdfNavigation.open}
          aria-controls={pdfNavigation.id}
          onClick={pdfNavigation.onToggle}
        >
          <List aria-hidden size={16} />
        </button>}
        <DocumentStarButton starred={starred} onToggle={onToggleStar} />
      </div>
      <div className={styles.readingTitle} aria-hidden="true">
        <span>{title || knowledgeT('untitledDocument')}</span>
      </div>
      <div ref={actionsRef} className={styles.actions}>
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
