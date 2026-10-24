'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './page-tree-sidebar.messages';
import type { ReactNode } from 'react';
import { Warning, XCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { KnowledgeBaseHeader, type KnowledgeBaseSummary } from '../knowledge-base-header';
import { CanvasState, TreeSkeletonRows } from '../canvas-states';
import styles from './knowledge-sidebar.module.css';

export function PageTreeSidebar({
  collapsed,
  onCollapse,
  knowledgeBases,
  activeKnowledgeBaseId,
  onSelectKnowledgeBase,
  onCreateKnowledgeBase,
  onOpenSettings,
  treeArea,
  footer,
  createLabel,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  knowledgeBases: readonly KnowledgeBaseSummary[];
  activeKnowledgeBaseId: string | null;
  onSelectKnowledgeBase: (id: string) => void;
  onCreateKnowledgeBase: () => void;
  onOpenSettings: () => void;
  treeArea: ReactNode;
  footer?: ReactNode;
  createLabel?: string;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <aside
      aria-label={knowledgeT('knowledgeBaseSidebar')}
      aria-hidden={collapsed}
      inert={collapsed}
      data-collapsed={collapsed}
      className={cn('flex h-full min-h-0 flex-col', styles.sidebar)}
    >
      <KnowledgeBaseHeader
        knowledgeBases={knowledgeBases}
        activeKnowledgeBaseId={activeKnowledgeBaseId}
        onSelectKnowledgeBase={onSelectKnowledgeBase}
        onCollapse={onCollapse}
        onCreateKnowledgeBase={onCreateKnowledgeBase}
        onOpenSettings={onOpenSettings}
        createLabel={createLabel}
      />
      {treeArea}
      {footer}
    </aside>
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
      icon={<XCircle className="size-5" aria-hidden weight="fill" />}
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
      icon={<Warning className="size-5" aria-hidden weight="fill" />}
      title={knowledgeT('unableToBrowsePageTree')}
      hint={knowledgeT('yourRoleCannotViewThisDirectoryContactThe')}
      announce="polite"
    />
  );
}
