'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DocumentTabContext, type TabDocument } from '@/features/knowledge/editor/document-tab-context';
import { TemplatesPage } from '@/features/knowledge/templates/templates-page';
import { RewardsPage } from '@/features/rewards';
import { KnowledgePage } from '@/features/knowledge/knowledge-page';
import { KnowledgeNavigationScope } from '@/features/knowledge/navigation/system-navigation';
import { KnowledgeMembersPage } from '@/features/knowledge/organization/knowledge-members-page';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { PageVisibility } from '@/lib/page-visibility';
import { PageSessionNamespace } from '@/lib/page-session-state';
import { usePageScrollRestoration } from '@/lib/use-page-scroll-restoration';
import { workbenchPanelId, workbenchTabId, type WorkbenchTab, type WorkbenchSplit } from './workbench-tabs';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './workbench-shell.module.css';

export function WorkbenchPanels({ tabs, active, split, navigationOwner = active, onActivateNavigation, onReportDocument, onSplitDocument, onTogglePin, onResizeSplit }: {
  tabs: WorkbenchTab[]; active: string;
  split?: WorkbenchSplit;
  navigationOwner?: string;
  onActivateNavigation?: (key: string) => void;
  onReportDocument: (key: string, document: TabDocument | null) => void;
  onSplitDocument: (key: string, document: TabDocument) => void;
  onTogglePin: (key: string) => void;
  onResizeSplit: (ratio: number) => void;
}) {
  const { scopeKey } = useKnowledgeBaseResources();
  const host = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < 640));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  // Tab order must not move live editor/iframe hosts in the document.
  return <div ref={host} className={styles.panels} data-split={Boolean(split)} data-stacked={stacked} style={{ '--split-ratio': `${split?.ratio ?? 50}%` } as CSSProperties}>{tabs.toSorted((a, b) => a.instance - b.instance).map(tab => {
    const pane = split?.left === tab.key ? 'left' : split?.right === tab.key ? 'right' : undefined;
    const visible = tab.key === active || Boolean(pane);
    // Keep actual DOM/editors mounted: hiding must not destroy collaboration or undo.
    return <PageSessionNamespace key={`${scopeKey}:${tab.instance}:${tab.revision ?? 0}`} name={`page:${tab.instance}`}><KnowledgeNavigationScope selected={tab.key === navigationOwner} visible={visible} activate={() => onActivateNavigation?.(tab.key)}><DocumentTabPanel tab={tab} visible={visible} pane={pane} onActivate={onActivateNavigation} onReport={onReportDocument} onSplit={onSplitDocument} onPin={onTogglePin} /></KnowledgeNavigationScope></PageSessionNamespace>;
  })}{split && <SplitHandle host={host} ratio={split.ratio} stacked={stacked} onResize={onResizeSplit} />}</div>;
}

function DocumentTabPanel({ tab, visible, pane, onActivate, onReport, onSplit, onPin }: {
  tab: WorkbenchTab; visible: boolean; pane?: string;
  onActivate?: (key: string) => void; onReport: (key: string, document: TabDocument | null) => void;
  onSplit: (key: string, document: TabDocument) => void; onPin: (key: string) => void;
}) {
  const reportDocument = useCallback((document: TabDocument | null) => onReport(tab.key, document), [onReport, tab.key]);
  const splitDocument = useCallback((document: TabDocument) => onSplit(tab.key, document), [onSplit, tab.key]);
  const togglePin = useCallback(() => onPin(tab.key), [onPin, tab.key]);
  const value = useMemo(() => ({ search: tab.search, document: tab.document, pinned: Boolean(tab.pinned), reportDocument, splitDocument, togglePin }), [tab.search, tab.document, tab.pinned, reportDocument, splitDocument, togglePin]);
  return <DocumentTabContext value={value}><WorkbenchPanel tab={tab} visible={visible} pane={pane} onActivate={() => onActivate?.(tab.key)}>
    {tab.view === 'members' ? <KnowledgeMembersPage /> : tab.view === 'templates' ? <TemplatesPage /> : tab.view === 'rewards' ? <RewardsPage /> : <KnowledgePage />}
  </WorkbenchPanel></DocumentTabContext>;
}

function WorkbenchPanel({ tab, visible, pane, onActivate, children }: { tab: WorkbenchTab; visible: boolean; pane?: string; onActivate: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  usePageScrollRestoration(ref);
  useEffect(() => {
    // Native modal dialogs otherwise leave the whole window inert after browser Back.
    if (!visible) ref.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  }, [visible]);
  return <section ref={ref} role="tabpanel" data-pane={pane} onPointerDownCapture={onActivate} onFocusCapture={onActivate} id={workbenchPanelId(tab.instance)} aria-labelledby={workbenchTabId(tab.instance)} hidden={!visible} inert={!visible} className={styles.page}>
    <PageVisibility value={visible}>{children}</PageVisibility>
  </section>;
}

function SplitHandle({ host, ratio, stacked, onResize }: { host: { current: HTMLDivElement | null }; ratio: number; stacked: boolean; onResize: (ratio: number) => void }) {
  const [resizing, setResizing] = useState(false);
  const { t } = useTranslation(messages);
  return <button type="button" className={`fob-resize-handle ${styles.splitHandle}`} role="separator" aria-label={t('调整拆分视图')} aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(ratio)} data-resize-axis={stacked ? 'y' : 'x'} data-resizing={resizing || undefined}
    onDoubleClick={() => onResize(50)} onKeyDown={event => {
      const before = stacked ? 'ArrowUp' : 'ArrowLeft';
      const after = stacked ? 'ArrowDown' : 'ArrowRight';
      if ([before, after, 'Home', 'End'].includes(event.key)) { event.preventDefault(); onResize(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : ratio + (event.key === before ? -2 : 2)); }
    }} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
    onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !host.current) return; const box = host.current.getBoundingClientRect(); onResize(stacked ? (event.clientY - box.top) / box.height * 100 : (event.clientX - box.left) / box.width * 100); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)} />;
}
