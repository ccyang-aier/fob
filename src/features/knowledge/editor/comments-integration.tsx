'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comments-integration.messages';
/**
 * Comments wiring for the document frame's independent sidebar slot. The
 * controller owns anchors and mutations; this layer combines its overlays
 * and full-height rail with review/history panels beside the document.
 */

import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { PageScope, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { ChatCircleDots } from '@phosphor-icons/react';
import { PageComments } from '../comments/comments-controller';
import { usePageCommentThreads } from '../comments/comments-queries';
import { levelSatisfies } from './editor-state';
import { useDocumentReference } from './document-reference';
import styles from './comments-integration.module.css';

export { createCommentsEditorExtension } from '../comments/comments-plugin';

export function PageCommentsTrigger({
  scope,
  open,
  onToggle,
}: {
  scope: PageScope;
  open: boolean;
  onToggle: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const threads = usePageCommentThreads(scope.knowledgeBaseId, scope.pageId);
  const count = threads.data?.length ?? 0;
  return (
    <span>
      <button
        type="button"
        className={styles.trigger}
        aria-label={open ? knowledgeT('collapseCommentsPanel') : knowledgeT('expandCommentsPanel')}
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChatCircleDots aria-hidden size={15} />
        <span>
          {knowledgeT('comments')}
          {count > 0 ? ` ${count}` : ''}
        </span>
      </button>
    </span>
  );
}

export function PageCommentsLayer({
  scope,
  knowledgeBaseId,
  editor,
  level,
  children,
  railOpen,
  onRailOpenChange,
  currentUser,
}: {
  scope: PageScope;
  knowledgeBaseId: string;
  editor: Editor | null;
  level: PermissionLevel;
  children: ReactNode;
  railOpen?: boolean;
  onRailOpenChange?: (open: boolean) => void;
  currentUser: { id: string; name: string; image?: string | null } | null;
}) {
  const reference = useDocumentReference();
  return (
    <div className={styles.rail} data-document-sidebar>
      {children}
      <PageComments
        scope={scope}
        knowledgeBaseId={knowledgeBaseId}
        editor={editor}
        currentUser={currentUser}
        canComment={levelSatisfies(level, 'comment')}
        railOpen={railOpen}
        onRailOpenChange={onRailOpenChange}
        followDocumentLink={!reference?.fixed}
      />
    </div>
  );
}
