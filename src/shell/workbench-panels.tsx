'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { KnowledgePage } from '@/features/knowledge/knowledge-page';
import { ProjectMembersPage } from '@/features/project/members/members-page';
import { ProjectSelectionEmpty } from '@/features/project/project-workspace-pages';
import { useProjectResources } from '@/features/project/project-resources';
import { PageVisibility } from '@/lib/page-visibility';
import { PageSessionNamespace } from '@/lib/page-session-state';
import { usePageScrollRestoration } from '@/lib/use-page-scroll-restoration';
import type { WorkbenchView } from './workbench-view';
import { workbenchPanelId, workbenchTabId, type WorkbenchTab } from './workbench-tabs';
import styles from './workbench-shell.module.css';

export function WorkbenchPanels({ tabs, active, onNavigate }: {
  tabs: WorkbenchTab[]; active: string;
  onNavigate: (view: WorkbenchView) => void;
}) {
  const { selectedProject, scopeKey } = useProjectResources();
  // Tab order must not move live editor/iframe hosts in the document.
  return tabs.toSorted((a, b) => a.instance - b.instance).map(tab => {
    const visible = tab.key === active;
    // Keep actual DOM/editors mounted: hiding must not destroy collaboration or undo.
    return <PageSessionNamespace key={`${scopeKey}:${tab.instance}:${tab.revision ?? 0}`} name={`page:${tab.instance}`}><WorkbenchPanel tab={tab} visible={visible}>
        {!selectedProject || !scopeKey ? <ProjectSelectionEmpty />
          : tab.view === 'members' ? <ProjectMembersPage />
          : <KnowledgePage onOpenSettings={() => onNavigate('settings')} />}
    </WorkbenchPanel></PageSessionNamespace>;
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
