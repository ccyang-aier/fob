'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { openSettings } from '@/lib/settings-navigation';
import { requestOpenPageBlock } from '@/features/knowledge/editor/open-target';
import { CompanionChat } from './chat/companion-chat';
import { useCompanionChatContext } from './chat/companion-context';
import { useCompanionConversation } from './chat/use-companion-conversation';
import type { CompanionChatScope } from './chat/types';
import { X } from '@/components/icons';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n/react';
import { CompanionCharacter } from './companion-character';
import { CompanionToolbar } from './companion-toolbar';
import { CompanionLayer } from './companion-layer';
import { CompanionSpeech } from './companion-speech';
import { createCompanionRuntime, initialCompanionState, type CompanionRuntime } from './companion-runtime';
import { messages } from './companion.messages';
import { OPEN_COMPANION_EVENT } from './companion-events';
import { useCompanionDrag } from './use-companion-drag';
import styles from './companion-widget.module.css';

export function CompanionWidget() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={280}>
        <CompanionLayer><Companion /></CompanionLayer>
      </TooltipProvider>
    </MotionConfig>
  );
}

function Companion() {
  const { t } = useTranslation(messages);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const context = useCompanionChatContext();
  const scope = useMemo<CompanionChatScope | null>(() => context.status === 'ready' && context.userId && context.knowledgeBaseId
    ? { userId: context.userId, knowledgeBaseId: context.knowledgeBaseId, pageId: context.document?.pageId ?? null }
    : null, [context.status, context.userId, context.knowledgeBaseId, context.document?.pageId]);
  const chat = useCompanionConversation(scope, chatOpen);
  const [state, setState] = useState(initialCompanionState);
  const widgetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<CompanionRuntime | null>(null);
  const keyboardOpen = useRef(false);
  const panelId = useId();
  const descriptionId = useId();
  const drag = useCompanionDrag(widgetRef);

  useEffect(() => {
    const controller = createCompanionRuntime(sceneRef.current!, setState);
    runtime.current = controller;
    const summon = () => { setToolsOpen(false); setChatOpen(true); controller.wake(); };
    window.addEventListener(OPEN_COMPANION_EVENT, summon);
    return () => { controller.dispose(); runtime.current = null; window.removeEventListener(OPEN_COMPANION_EVENT, summon); };
  }, []);

  useEffect(() => {
    if (toolsOpen && keyboardOpen.current) widgetRef.current?.querySelector<HTMLButtonElement>('[role="toolbar"] button:not(:disabled)')?.focus({ preventScroll: true });
    keyboardOpen.current = false;
  }, [toolsOpen]);

  function collapseTools() { setToolsOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
  function closeChat() { setChatOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
  function openTools(fromKeyboard = false) {
    keyboardOpen.current = fromKeyboard; setChatOpen(false); setToolsOpen(true); runtime.current?.wake();
  }
  function interact() {
    setToolsOpen(false);
    setChatOpen(current => !current);
    runtime.current?.interact();
  }

  return (
    <section
      ref={widgetRef}
      className={styles.widget}
      aria-label={`Feather · ${t('精灵')}`}
      data-companion
      data-open={toolsOpen}
      data-chat-open={chatOpen || undefined}
      data-companion-state={state.label}
      {...drag}
      onKeyDown={event => {
        const fromMenu = event.target instanceof Element && event.target.closest('[role="menu"]');
        if (toolsOpen && event.key === 'Escape' && !fromMenu) { event.preventDefault(); event.stopPropagation(); collapseTools(); }
      }}
    >
      <AnimatePresence initial={false}>
        {toolsOpen ? <CompanionToolbar key="toolbar" id={panelId} state={state} onFeed={() => { void runtime.current?.feed(); }} onAction={action => runtime.current?.act(action)} /> : null}
      </AnimatePresence>
      <div
        ref={triggerRef}
        className={styles.trigger}
        role="button"
        tabIndex={0}
        data-companion-drag
        aria-label={t('对话')}
        aria-describedby={descriptionId}
        aria-haspopup="dialog"
        aria-expanded={chatOpen || toolsOpen}
        aria-controls={toolsOpen ? panelId : undefined}
        onClick={interact}
        onContextMenu={event => { event.preventDefault(); openTools(); }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interact(); }
          else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); openTools(true); }
          else if (event.key === 'Escape' && chatOpen) { event.preventDefault(); event.stopPropagation(); closeChat(); }
        }}
      >
        <div className={styles.scene}><CompanionCharacter sceneRef={sceneRef} /></div>
      </div>
      <CompanionChat key={`${context.userId ?? 'guest'}:${context.knowledgeBaseId ?? 'none'}`} open={chatOpen} anchor={triggerRef} context={context} chat={chat}
        onClose={closeChat} onSource={source => { if (context.status === 'ready' && context.knowledgeBaseId) requestOpenPageBlock({ knowledgeBaseId: context.knowledgeBaseId, pageId: source.pageId, blockId: source.blockId }); }}
        onSettings={() => { setChatOpen(false); openSettings('ai'); }} onInteract={() => openTools(true)} />
      <AnimatePresence initial={false}>{!chatOpen && state.speech && <CompanionSpeech key="speech" anchor={triggerRef} text={state.speech} />}</AnimatePresence>
      <span id={descriptionId} className="sr-only">{t('对话提示')} · {t('拖动')} · {t('心情')} {Math.round(state.mood)} · {t('饱腹')} {Math.round(state.full)}</span>
      {toolsOpen ? <button type="button" className={`fob-action ${styles.close}`} aria-label={t('收起')} onClick={collapseTools}><X size={12} aria-hidden /></button> : null}
    </section>
  );
}
