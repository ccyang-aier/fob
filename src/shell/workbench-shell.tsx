'use client';

import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getProjectUiSession } from '@/lib/project-ui-session';
import { ProjectUiSessionContext } from '@/lib/page-session-state';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-provider';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useProjectResources } from '@/features/project/project-resources';
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
  const { scopeKey, principal } = useProjectResources();
  const session = useMemo(() => getProjectUiSession(scopeKey ?? `${principal}:no-project`), [scopeKey, principal]);
  return <ProjectUiSessionContext value={session}><WorkbenchChrome /></ProjectUiSessionContext>;
}

const serverSessionStatus = { ready: false, error: null };
// Survives the resource provider's remount when the account identity changes.
const startupEntry = createWorkbenchStartup();
function WorkbenchChrome() {
  useMenuMotion();
  const { session: identity } = useIdentity();
  const session = useContext(ProjectUiSessionContext)!;
  const sessionStatus = useSyncExternalStore(session.subscribe, session.getStatus, () => serverSessionStatus);
  const { notify } = useAppAlert();
  const { t } = useTranslation(messages);
  const reported = useRef<typeof session | null>(null);
  useEffect(() => { if (sessionStatus.error && reported.current !== session) { reported.current = session; notify('error', t('页面恢复保存失败')); } }, [session, sessionStatus.error, notify, t]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const settingsSection = useSettingsSection();
  const { scopeKey, status } = useProjectResources();
  const [view, setView, settingsOpen, navigation, search] = useWorkbenchView(scopeKey);
  const tabs = useWorkbenchTabs(scopeKey, view, search, identity.status !== 'checking' && status !== 'loading' && sessionStatus.ready, startupEntry);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => { applyAppearancePrefs(readAppearancePrefs()); }, []);
  useEffect(() => {
    setOverlayRoot(frameRef.current);
    return () => setOverlayRoot(null);
  }, []);
  function changeView(next: WorkbenchView) {
    if (next === 'settings') setView(next);
    else tabs.open(next);
  }
  return <TooltipProvider>
    <div className="h-dvh w-full p-[var(--win-frame-inset)]">
      <div ref={frameRef} className={`${styles.frame} flex h-full w-full min-w-[660px] min-h-[540px] flex-col overflow-hidden text-[var(--ink)] shadow-[var(--win-shadow)]`}>
        <div className="flex min-h-0 flex-1">
          <div className={`${styles.navigation} flex shrink-0`}><NavigationSidebar open={!sidebarCollapsed} onCollapse={() => setSidebarCollapsed(true)} onExpand={() => setSidebarCollapsed(false)} view={view} onViewChange={changeView} onProjectChange={() => {}} /></div>
          <div className={styles.workspace}>
            <div className={styles.systemBar}><SystemBar onNavigate={changeView} navigation={navigation}>{tabs.ready ? <WorkbenchTabBar key={scopeKey ?? 'no-project'} tabs={tabs.tabs} active={tabs.active} revealRequest={tabs.revealRequest} onActivate={tabs.activate} onClose={tabs.close} onReorder={tabs.reorder} onPin={tabs.pin} onReload={tabs.reload} onDuplicate={tabs.duplicate} onNew={tabs.newTab} /> : <div className="flex-1" />}</SystemBar></div>
            <main className={styles.content}>
              {tabs.ready && <WorkbenchPanels tabs={tabs.tabs} active={tabs.active} onNavigate={changeView} />}
            </main>
          </div>
        </div>
        <SettingsDialog open={settingsOpen} section={settingsSection} onSectionChange={setSettingsSection} onClose={closeSettings} />
      </div>
    </div>
  </TooltipProvider>;
}
