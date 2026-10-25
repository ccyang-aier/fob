'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
    <MotionConfig reducedMotion="never">
      <TooltipProvider delayDuration={280}>
        <CompanionLayer><Companion /></CompanionLayer>
      </TooltipProvider>
    </MotionConfig>
  );
}

function Companion() {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
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
    const summon = () => { keyboardOpen.current = false; setOpen(true); controller.wake(); };
    window.addEventListener(OPEN_COMPANION_EVENT, summon);
    return () => { controller.dispose(); runtime.current = null; window.removeEventListener(OPEN_COMPANION_EVENT, summon); };
  }, []);

  useEffect(() => {
    if (open && keyboardOpen.current) widgetRef.current?.querySelector<HTMLButtonElement>('[role="toolbar"] button:not(:disabled)')?.focus({ preventScroll: true });
    keyboardOpen.current = false;
  }, [open]);

  function collapse() { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
  function interact(fromKeyboard = false) {
    keyboardOpen.current = fromKeyboard;
    setOpen(current => !current);
    runtime.current?.interact();
  }

  return (
    <section
      ref={widgetRef}
      className={styles.widget}
      aria-label={`Feather · ${t('精灵')}`}
      data-companion
      data-open={open}
      data-companion-state={state.label}
      {...drag}
      onKeyDown={event => {
        const fromMenu = event.target instanceof Element && event.target.closest('[role="menu"]');
        if (open && event.key === 'Escape' && !fromMenu) { event.preventDefault(); event.stopPropagation(); collapse(); }
      }}
    >
      <AnimatePresence initial={false}>
        {open ? <CompanionToolbar key="toolbar" id={panelId} state={state} onFeed={() => { void runtime.current?.feed(); }} onAction={action => runtime.current?.act(action)} /> : null}
      </AnimatePresence>
      <div
        ref={triggerRef}
        className={styles.trigger}
        role="button"
        tabIndex={0}
        data-companion-drag
        aria-label={t('互动')}
        aria-describedby={descriptionId}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={event => interact(event.detail === 0)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interact(true); }
        }}
      >
        <div className={styles.scene}><CompanionCharacter sceneRef={sceneRef} /></div>
      </div>
      <AnimatePresence initial={false}>{state.speech && <CompanionSpeech key="speech" anchor={triggerRef} text={state.speech} />}</AnimatePresence>
      <span id={descriptionId} className="sr-only">{t('拖动')} · {t('心情')} {Math.round(state.mood)} · {t('饱腹')} {Math.round(state.full)}</span>
      {open ? <button type="button" className={`fob-action ${styles.close}`} aria-label={t('收起')} onClick={collapse}><X size={12} aria-hidden /></button> : null}
    </section>
  );
}
