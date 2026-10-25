'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getKnowledgeUiSession } from '@/lib/knowledge-ui-session';
import { KnowledgeUiSessionContext } from '@/lib/page-session-state';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-provider';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { KnowledgeNavigationProvider } from '@/features/knowledge/navigation/system-navigation';
import { KNOWLEDGE_NAVIGATED } from '@/features/knowledge/navigation/document-navigation-location';
import { SettingsDialog } from '@/features/settings/settings-dialog';
import { closeSettings, setSettingsSection, useSettingsSection } from '@/lib/settings-navigation';
import { useMenuMotion } from '@/lib/use-menu-motion';
import { applyAppearancePrefs, readAppearancePrefs } from '@/lib/appearance';
import { setOverlayRoot } from '@/lib/overlay-root';
import { useWorkbenchView, type WorkbenchView } from './workbench-view';
import { NavigationSidebar } from './navigation-sidebar';
import { SystemBar } from './system-bar';
import { WorkbenchTabBar } from './workbench-tab-bar';
import { WorkbenchPanels } from './workbench-panels';
import { useWorkbenchTabs } from './use-workbench-tabs';
import { createWorkbenchStartup } from './workbench-tabs';
import styles from './workbench-shell.module.css';

export function WorkbenchShell() {
  const { scopeKey, principal } = useKnowledgeBaseResources();
  const session = useMemo(() => getKnowledgeUiSession(scopeKey ?? `${principal}:no-knowledge-base`), [scopeKey, principal]);
  return <KnowledgeUiSessionContext value={session}><WorkbenchChrome /></KnowledgeUiSessionContext>;
}

const serverSessionStatus = { ready: false, error: null };
// Survives the resource provider's remount when the account identity changes.
const startupEntry = createWorkbenchStartup();
function WorkbenchChrome() {
  useMenuMotion();
  const { session: identity } = useIdentity();
  const session = useContext(KnowledgeUiSessionContext)!;
  const sessionStatus = useSyncExternalStore(session.subscribe, session.getStatus, () => serverSessionStatus);
  const { notify } = useAppAlert();
  const { t } = useTranslation(messages);
  const reported = useRef<typeof session | null>(null);
  useEffect(() => { if (sessionStatus.error && reported.current !== session) { reported.current = session; notify('error', t('页面恢复保存失败')); } }, [session, sessionStatus.error, notify, t]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 760px)');
    const collapseOnNarrowScreen = () => { if (narrow.matches) setSidebarCollapsed(true); };
    collapseOnNarrowScreen();
    narrow.addEventListener('change', collapseOnNarrowScreen);
    window.addEventListener(KNOWLEDGE_NAVIGATED, collapseOnNarrowScreen);
    return () => { narrow.removeEventListener('change', collapseOnNarrowScreen); window.removeEventListener(KNOWLEDGE_NAVIGATED, collapseOnNarrowScreen); };
  }, []);
  const settingsSection = useSettingsSection();
  const { scopeKey, status } = useKnowledgeBaseResources();
  const [view, setView, settingsOpen, navigation, search] = useWorkbenchView(scopeKey);
  const tabs = useWorkbenchTabs(scopeKey, view, search, identity.status !== 'checking' && status !== 'loading' && sessionStatus.ready, startupEntry);
  const activeKnowledge = tabs.tabs.find(tab => tab.key === tabs.active && tab.view === 'knowledge');
  const [lastKnowledgeKey, setLastKnowledgeKey] = useState<string | null>(null);
  if (activeKnowledge && lastKnowledgeKey !== activeKnowledge.key) setLastKnowledgeKey(activeKnowledge.key);
  const navigationOwner = activeKnowledge?.key ?? tabs.tabs.find(tab => tab.key === lastKnowledgeKey && tab.view === 'knowledge')?.key ?? tabs.tabs.find(tab => tab.view === 'knowledge')?.key;
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), []);
  const frameRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [horizontalPanes, setHorizontalPanes] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHorizontalPanes(entry.contentRect.width >= 640));
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, []);
  const splitHeaders = horizontalPanes ? tabs.split : undefined;
  const renderTabBar = (items = tabs.tabs, selected = tabs.active, secondary = false) => <WorkbenchTabBar key={`${scopeKey ?? 'no-knowledge-base'}:${secondary ? 'right' : 'left'}`} tabs={items} active={selected} split={tabs.split} revealRequest={tabs.revealRequest} onActivate={tabs.activate} onClose={tabs.close} onReorder={instances => tabs.reorder([...instances, ...tabs.tabs.filter(tab => !items.includes(tab)).map(tab => tab.instance)])} onPin={tabs.pin} onReload={tabs.reload} onDuplicate={tabs.duplicate} onSplit={tabs.splitTab} onUnsplit={tabs.unsplit} onNew={tabs.newTab} showNewTab={!secondary} totalTabs={tabs.tabs.length} />;
  useEffect(() => { applyAppearancePrefs(readAppearancePrefs()); }, []);
  useEffect(() => {
    setOverlayRoot(frameRef.current);
    return () => setOverlayRoot(null);
  }, []);
  function changeView(next: WorkbenchView) {
    if (next === 'settings') setView(next);
    else if (next === 'knowledge' && navigationOwner) tabs.activate(navigationOwner);
    else tabs.open(next);
  }
  return <KnowledgeNavigationProvider onExpand={expandSidebar}><TooltipProvider>
    <div className="h-dvh w-full p-[var(--win-frame-inset)]">
      <div ref={frameRef} className={`${styles.frame} flex h-full w-full min-h-[320px] flex-col overflow-hidden text-[var(--ink)] shadow-[var(--win-shadow)]`}>
        <div className="flex min-h-0 flex-1">
          <div className={`${styles.navigation} flex shrink-0`}><NavigationSidebar open={!sidebarCollapsed} onCollapse={() => setSidebarCollapsed(true)} onExpand={() => setSidebarCollapsed(false)} view={view} onViewChange={changeView} onKnowledgeBaseChange={() => {}} /></div>
          {!sidebarCollapsed && <button type="button" className={styles.navigationScrim} aria-label={t('收起主导航')} onClick={() => setSidebarCollapsed(true)} />}
          <div ref={workspaceRef} className={styles.workspace}>
            <div className={styles.systemBar}><SystemBar onNavigate={changeView} navigation={navigation} splitRatio={splitHeaders?.ratio} secondary={tabs.ready && splitHeaders ? renderTabBar(tabs.tabs.filter(tab => tab.key === splitHeaders.right), splitHeaders.right, true) : undefined}>{tabs.ready ? splitHeaders ? renderTabBar(tabs.tabs.filter(tab => tab.key !== splitHeaders.right), tabs.active === splitHeaders.right ? splitHeaders.left : tabs.active) : renderTabBar() : <div className="flex-1" />}</SystemBar></div>
            <main className={styles.content}>
              {tabs.ready && <WorkbenchPanels tabs={tabs.tabs} active={tabs.active} split={tabs.split} navigationOwner={navigationOwner} onActivateNavigation={tabs.activate} onReportDocument={tabs.reportDocument} onReportTitle={tabs.reportTitle} onSplitDocument={tabs.splitTab} onTogglePin={tabs.pin} onResizeSplit={tabs.resizeSplit} />}
            </main>
          </div>
        </div>
        <SettingsDialog open={settingsOpen} section={settingsSection} onSectionChange={setSettingsSection} onClose={closeSettings} />
      </div>
    </div>
  </TooltipProvider></KnowledgeNavigationProvider>;
}
