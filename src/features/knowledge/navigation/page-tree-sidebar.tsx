'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './page-tree-sidebar.messages';
import type { ReactNode } from 'react';
import { Warning, XCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CanvasState, TreeSkeletonRows } from '../canvas-states';
import { KnowledgeNavigationPortal } from './system-navigation';
import styles from './knowledge-sidebar.module.css';

export function PageTreeSidebar({
  treeArea,
  footer,
}: {
  treeArea: ReactNode;
  footer?: ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <KnowledgeNavigationPortal><section
      aria-label={knowledgeT('knowledgeBaseSidebar')}
      className={styles.sidebar}
    >
      {treeArea}
      {footer}
    </section></KnowledgeNavigationPortal>
  );
}

export function TreeLoading() {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <div
      role="status"
      aria-label={knowledgeT('loadingPageTree')}
      className="min-h-0 flex-1 overflow-hidden"
    >
      <TreeSkeletonRows />
    </div>
  );
}

export function TreeError({ onRetry }: { onRetry: () => void }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <CanvasState
      className="min-h-[200px] flex-1"
      tone="error"
      announce="assertive"
      icon={<XCircle className="size-5" aria-hidden />}
      title={knowledgeT('unableToLoadPageTree')}
      hint={knowledgeT('unableToReadFoldersRetryLater')}
      actions={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {knowledgeT('retry')}
        </Button>
      }
    />
  );
}

export function TreeForbidden() {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <CanvasState
      className="min-h-[200px] flex-1"
      icon={<Warning className="size-5" aria-hidden />}
      title={knowledgeT('unableToBrowsePageTree')}
      hint={knowledgeT('yourRoleCannotViewThisDirectoryContactThe')}
      announce="polite"
    />
  );
}
