'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { KnowledgePage } from '@/features/knowledge/knowledge-page';
import { KnowledgeNavigationScope } from '@/features/knowledge/navigation/system-navigation';
import { KnowledgeMembersPage } from '@/features/knowledge/organization/knowledge-members-page';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { PageVisibility } from '@/lib/page-visibility';
import { PageSessionNamespace } from '@/lib/page-session-state';
import { usePageScrollRestoration } from '@/lib/use-page-scroll-restoration';
import { workbenchPanelId, workbenchTabId, type WorkbenchTab } from './workbench-tabs';
import styles from './workbench-shell.module.css';

export function WorkbenchPanels({ tabs, active, navigationOwner = active, onActivateNavigation }: {
  tabs: WorkbenchTab[]; active: string;
  navigationOwner?: string;
  onActivateNavigation?: (key: string) => void;
}) {
  const { scopeKey } = useKnowledgeBaseResources();
  // Tab order must not move live editor/iframe hosts in the document.
  return tabs.toSorted((a, b) => a.instance - b.instance).map(tab => {
    const visible = tab.key === active;
    // Keep actual DOM/editors mounted: hiding must not destroy collaboration or undo.
    return <PageSessionNamespace key={`${scopeKey}:${tab.instance}:${tab.revision ?? 0}`} name={`page:${tab.instance}`}><KnowledgeNavigationScope selected={tab.key === navigationOwner} visible={visible} activate={() => onActivateNavigation?.(tab.key)}><WorkbenchPanel tab={tab} visible={visible}>
        {tab.view === 'members' ? <KnowledgeMembersPage /> : <KnowledgePage />}
    </WorkbenchPanel></KnowledgeNavigationScope></PageSessionNamespace>;
  });
}

function WorkbenchPanel({ tab, visible, children }: { tab: WorkbenchTab; visible: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  usePageScrollRestoration(ref);
  useEffect(() => {
    // Native modal dialogs otherwise leave the whole window inert after browser Back.
    if (!visible) ref.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  }, [visible]);
  return <section ref={ref} role="tabpanel" id={workbenchPanelId(tab.instance)} aria-labelledby={workbenchTabId(tab.instance)} hidden={!visible} inert={!visible} className={styles.page}>
    <PageVisibility value={visible}>{children}</PageVisibility>
  </section>;
}
