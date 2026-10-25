'use client';

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { AnimatePresence, LayoutGroup, motion, Reorder, useDragControls, useIsPresent } from 'motion/react';
import { CaretLeft, CaretRight, PushPin, Plus, X, FileText, SplitHorizontal } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { workbenchPages, type WorkbenchPage } from './workbench-pages';
import { workbenchPanelId, workbenchTabId, type TabAction, type TabCloseAction, type WorkbenchTab, type WorkbenchSplit } from './workbench-tabs';
import { WorkbenchNewTabMenu, WorkbenchTabMenu } from './workbench-tab-menu';
import { useWorkbenchTabScroll } from './use-workbench-tab-scroll';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './workbench-tab-bar.module.css';

export function WorkbenchTabBar({ tabs, active, split, revealRequest, onActivate, onClose, onReorder, onPin, onReload, onDuplicate, onSplit, onUnsplit, onNew }: {
  tabs: WorkbenchTab[]; active: string; revealRequest: number;
  split?: WorkbenchSplit;
  onSplit: (key: string) => void; onUnsplit: () => void;
  onActivate: (key: string) => void; onClose: (key: string, action?: TabCloseAction) => void; onReorder: (instances: number[]) => void;
  onPin: (key: string) => void; onReload: (key: string) => void; onDuplicate: (key: string) => void; onNew: (view: WorkbenchPage) => void;
}) {
  const { t } = useTranslation(messages);
  const group = useId();
  const order = tabs.map(tab => tab.instance).join(',');
  const { strip, ref, viewport, newButton, dragging, edges, revealSelected, browse } = useWorkbenchTabScroll(active, revealRequest);
  const [context, setContext] = useState<{ instance: number; x: number; y: number } | null>(null);
  const [newContext, setNewContext] = useState<{ x: number; y: number } | null>(null);
  const [layout, setLayout] = useState({ order, tabs, reorder: false });
  if (layout.order !== order) {
    const previous = new Set(layout.tabs.map(tab => tab.instance));
    // Insert/remove changes the native scroll range. Only reorder the same items with FLIP.
    setLayout({ order, tabs, reorder: tabs.length === previous.size && tabs.every(tab => previous.has(tab.instance)) });
  }
  function focusSelected() { requestAnimationFrame(() => { ref.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true }); }); }
  function activate(key: string) { setContext(null); setNewContext(null); onActivate(key); }
  function close(key: string, action?: TabCloseAction) { setContext(null); onClose(key, action); focusSelected(); }
  function newTab(view: WorkbenchPage = 'knowledge') { setContext(null); setNewContext(null); onNew(view); focusSelected(); }
  function action(key: string, value: TabAction) {
    setContext(null);
    if (value === 'pin') onPin(key);
    else if (value === 'reload') onReload(key);
    else if (value === 'duplicate') { onDuplicate(key); focusSelected(); }
    else if (value === 'split') { onSplit(key); focusSelected(); }
    else if (value === 'unsplit') onUnsplit();
    else close(key, value);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      setContext({ instance: tabs[index].instance, x: bounds.left, y: bounds.bottom });
      return;
    }
    let next: number;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'Delete') { event.preventDefault(); close(tabs[index].key); return; }
    else return;
    event.preventDefault();
    activate(tabs[next].key);
    focusSelected();
  }
  const contextIndex = context ? tabs.findIndex(tab => tab.instance === context.instance) : -1;
  return <div ref={strip} className={styles.strip}>
    {edges.overflow && <button type="button" className={`fob-action ${styles.browse}`} aria-label={t('向左浏览页签')} title={t('向左浏览页签')} disabled={!edges.left} onClick={() => browse(-1)}><CaretLeft size={13} aria-hidden /></button>}
    <div className={styles.scroller} data-hidden-left={edges.left} data-hidden-right={edges.right}>
    <motion.div ref={viewport} layoutScroll className={styles.viewport}>
      <LayoutGroup id={group}>
        <Reorder.Group as="div" axis="x" values={tabs.map(tab => tab.instance)} onReorder={onReorder} ref={ref} role="tablist" aria-label={t('工作页面')} className={styles.tabs}>
        <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((tab, index) => {
            const page = workbenchPages[tab.view];
            const title = tab.document?.title || t(page.label);
            const selected = tab.key === active;
            return <TabItem key={tab.instance} tab={tab} inSplit={split?.left === tab.key || split?.right === tab.key} title={title} closeLabel={t('关闭页面', { name: title })} selected={selected} animatePosition={layout.reorder}
              onActivate={() => activate(tab.key)} onClose={() => close(tab.key)} onKeyDown={event => keyDown(event, index)}
              onDragStart={() => { dragging.current = true; activate(tab.key); }} onDragEnd={() => { dragging.current = false; revealSelected(); }}
              onContextMenu={event => { event.preventDefault(); setNewContext(null); setContext({ instance: tab.instance, x: event.clientX, y: event.clientY }); }} />;
          })}
        </AnimatePresence>
        </Reorder.Group>
      </LayoutGroup>
    </motion.div>
    </div>
    {edges.overflow && <button type="button" className={`fob-action ${styles.browse}`} aria-label={t('向右浏览页签')} title={t('向右浏览页签')} disabled={!edges.right} onClick={() => browse(1)}><CaretRight size={13} aria-hidden /></button>}
    <button ref={newButton} type="button" className={`fob-action ${styles.newTab}`} aria-label={t('新建标签页')} title={t('新建标签页')} aria-haspopup="menu" aria-expanded={Boolean(newContext)} onClick={() => newTab()}
      onContextMenu={event => { event.preventDefault(); setContext(null); setNewContext({ x: event.clientX, y: event.clientY }); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setContext(null); setNewContext({ x: bounds.left, y: bounds.bottom }); } }}><Plus size={17} aria-hidden /></button>
    {context && contextIndex >= 0 && <WorkbenchTabMenu key={context.instance} point={context} pinned={Boolean(tabs[contextIndex].pinned)} canSplit={Boolean(tabs[contextIndex].document)} inSplit={split?.left === tabs[contextIndex].key || split?.right === tabs[contextIndex].key} hasOthers={tabs.length > 1} onClose={() => setContext(null)} onAction={value => action(tabs[contextIndex].key, value)} onReturnFocus={focusSelected} />}
    {newContext && <WorkbenchNewTabMenu point={newContext} onClose={() => setNewContext(null)} onNew={newTab} onReturnFocus={() => newButton.current?.focus()} />}
  </div>;
}

function TabItem({ ref, tab, inSplit, title, closeLabel, selected, animatePosition, onActivate, onClose, onKeyDown, onContextMenu, onDragStart, onDragEnd }: {
  ref?: Ref<HTMLDivElement>; tab: WorkbenchTab; title: string; closeLabel: string; selected: boolean; animatePosition: boolean;
  inSplit?: boolean;
  onActivate: () => void; onClose: () => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const present = useIsPresent();
  const controls = useDragControls();
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const active = selected && present;
  const Icon = tab.document ? FileText : workbenchPages[tab.view].icon;
  return <Reorder.Item ref={ref} as="div" value={tab.instance} layout="position" dragListener={false} dragControls={controls} dragMomentum={false} dragTransition={{ bounceStiffness: 600, bounceDamping: 40 }}
    data-dragging={dragging} data-selected={active} data-pinned={Boolean(tab.pinned)} aria-hidden={!present || undefined} inert={!present} className={`fob-action ${styles.item}`}
    style={{ width: 128 + (tab.pinned ? 16 : 0) }} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96, transition: { duration: .12 } }} whileDrag={{ scale: 1.015 }} transition={{ type: 'spring', stiffness: 430, damping: 38, mass: .7, layout: animatePosition ? { type: 'spring', stiffness: 430, damping: 38, mass: .7 } : { duration: 0 } }}
    onDragStart={() => { moved.current = true; setDragging(true); onDragStart(); }} onDragEnd={() => { setDragging(false); onDragEnd(); }}
    onContextMenu={onContextMenu}>
    {active && <motion.span layoutId="selected-tab" className={styles.active} transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
    <button type="button" id={workbenchTabId(tab.instance)} role="tab" className={styles.select} aria-selected={active} aria-controls={workbenchPanelId(tab.instance)} aria-haspopup="menu" tabIndex={active ? 0 : -1} title={title}
      onPointerDown={event => { if (event.button === 0) { moved.current = false; controls.start(event, { distanceThreshold: 5 }); } }}
      onClick={event => { if (!moved.current || event.detail === 0) onActivate(); }} onKeyDown={onKeyDown}><Icon size={16} weight="fill" aria-hidden /><span>{title}</span>{inSplit && <SplitHorizontal size={12} aria-hidden />}{tab.pinned && <PushPin className={styles.pin} size={12} weight="fill" aria-hidden />}</button>
    <button type="button" className={`fob-action ${styles.close}`} data-variant="nested" aria-label={closeLabel} tabIndex={active ? 0 : -1} onClick={onClose}><X size={13} aria-hidden /></button>
  </Reorder.Item>;
}
