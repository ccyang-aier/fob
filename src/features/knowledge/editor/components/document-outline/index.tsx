'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { knowledgeMessages } from './messages';
import styles from './styles.module.css';

export type OutlineHeading = { id: string; pos: number; level: number; title: string };
type OutlineProps = {
  id: string;
  headings: OutlineHeading[];
  activeHeading: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  previewHeading?: number | null;
  onPreview?: (index: number) => void;
};

/** Indent by actual ancestry, including documents that skip heading levels. */
export function outlineDepths(headings: OutlineHeading[]) {
  const ancestors: number[] = [];
  return headings.map(({ level }) => {
    while (ancestors.length && ancestors[ancestors.length - 1] >= level) ancestors.pop();
    const depth = ancestors.length;
    ancestors.push(level);
    return depth;
  });
}

export function DocumentOutline({ id, headings, activeHeading, previewHeading, onPreview, onClose, onNavigate }: OutlineProps) {
  const { t } = useTranslation(knowledgeMessages);
  const depths = outlineDepths(headings);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector('[aria-current="location"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeHeading]);
  return <div ref={panel} id={id} className={styles.panel} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('nav button')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }}>
    {headings.length ? <nav className={styles.chapters} aria-label={t('documentSections')}>
      {headings.map((heading, index) => <button key={heading.id} type="button"
        className={`fob-action ${styles.chapter}`} style={{ paddingInlineStart: 8 + depths[index] * 12 }}
        title={heading.title} aria-current={index === activeHeading ? 'location' : undefined}
        data-surface="plain" data-active={index === previewHeading || undefined}
        data-autofocus={index === Math.max(0, activeHeading) ? '' : undefined}
        onPointerEnter={() => onPreview?.(index)} onFocus={() => onPreview?.(index)}
        onClick={() => onNavigate(index)}>{heading.title}</button>)}
    </nav> : <div className={styles.empty} role="status"><strong>{t('noSectionsYet')}</strong><p>{t('addHeadingsToNavigateTheDocumentHere')}</p></div>}
  </div>;
}

export function DocumentOutlineNavigation({ open, pinned, onHoverChange, restoreFocusTo, ...props }: OutlineProps & {
  open: boolean; pinned: boolean; onHoverChange: (value: boolean) => void;
  restoreFocusTo?: HTMLElement;
}) {
  const { t } = useTranslation(knowledgeMessages);
  const [rail, setRail] = useState<HTMLButtonElement | null>(null);
  const ticks = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null);
  const animationFrame = useRef(0);
  const [previewHeading, setPreviewHeading] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paintDock = (position: number | null) => {
    const lines = ticks.current?.children;
    if (!lines) return;
    const highlighted = position === null ? -1 : Math.round(position);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] as HTMLElement;
      const base = Number(line.dataset.baseWidth);
      const distance = position === null ? Infinity : Math.abs(index - position);
      const influence = Math.max(0, 1 - distance / 2.5) ** 2;
      const active = index === highlighted;
      line.style.width = `${active ? 38 : base + (38 - base) * influence}px`;
      line.style.setProperty('--dock-ink', `${active ? 100 : influence * 55}%`);
      line.dataset.dockActive = String(active);
    }
  };
  const preview = (position: number | null) => {
    pointer.current = position;
    setPreviewHeading(position === null ? null : Math.round(position));
    if (!animationFrame.current) animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = 0;
      paintDock(pointer.current);
    });
  };
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const enter = () => { cancelClose(); onHoverChange(true); };
  const enterWithKeyboard = () => {
    enter();
    requestAnimationFrame(() => {
      const panel = document.getElementById(props.id);
      (panel?.querySelector<HTMLButtonElement>('[data-autofocus]') ?? panel?.querySelector<HTMLButtonElement>('nav button'))?.focus();
    });
  };
  const leave = () => { cancelClose(); closeTimer.current = setTimeout(() => { preview(null); onHoverChange(false); }, 180); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); cancelAnimationFrame(animationFrame.current); }, []);
  useEffect(() => {
    // Pointer motion updates only the line layer; the editor never renders per frame.
    const frame = requestAnimationFrame(() => paintDock(pointer.current));
    return () => cancelAnimationFrame(frame);
  }, [props.activeHeading, props.headings]);
  useEffect(() => {
    if (open) return;
    const frame = requestAnimationFrame(() => preview(null));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const depths = outlineDepths(props.headings);
  return <>
    <button ref={setRail} type="button" className={`fob-action ${styles.rail}`}
      data-variant="text"
      style={{ height: props.headings.length * 10 + 16, visibility: props.headings.length ? undefined : 'hidden' }} disabled={!props.headings.length}
      aria-label={t('documentSections')} aria-expanded={open} aria-controls={open ? props.id : undefined}
      aria-haspopup="dialog" onMouseEnter={enter} onMouseLeave={leave}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch' || !ticks.current || !props.headings.length) return;
        const bounds = ticks.current.getBoundingClientRect();
        if (!bounds.height) return;
        preview(Math.max(0, Math.min(props.headings.length - 1,
          (event.clientY - bounds.top) / bounds.height * props.headings.length - 0.5)));
      }}
      onClick={(event) => { if (event.detail === 0) enterWithKeyboard(); else enter(); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); enterWithKeyboard(); } }}>
      <span ref={ticks} className={styles.ticks} style={{ gridTemplateRows: `repeat(${Math.max(1, props.headings.length)}, minmax(0, 1fr))` }} aria-hidden>{props.headings.map((heading, index) => <span key={heading.id}
        className={styles.tick} data-base-width={Math.max(4, 18 - depths[index] * 6)}
        style={{ width: Math.max(4, 18 - depths[index] * 6) }} />)}</span>
    </button>
    {open && rail && <AnchoredPopover
      anchor={rail} side="right" width={320} label={t('documentSections')}
      className={styles.floatingPanel} autoFocus={pinned} restoreFocusTo={restoreFocusTo}
      onClose={props.onClose} onMouseEnter={enter} onMouseLeave={leave}>
      <DocumentOutline {...props} previewHeading={previewHeading} onPreview={preview} />
    </AnchoredPopover>}
  </>;
}
