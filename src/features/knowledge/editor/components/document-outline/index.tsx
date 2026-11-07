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

export function DocumentOutline({ id, headings, activeHeading, onClose, onNavigate }: OutlineProps) {
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
        data-autofocus={index === Math.max(0, activeHeading) ? '' : undefined}
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const enter = () => { cancelClose(); onHoverChange(true); };
  const enterWithKeyboard = () => {
    enter();
    requestAnimationFrame(() => document.getElementById(props.id)?.querySelector<HTMLButtonElement>('[data-autofocus], nav button')?.focus());
  };
  const leave = () => { cancelClose(); closeTimer.current = setTimeout(() => onHoverChange(false), 180); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const depths = outlineDepths(props.headings);
  return <>
    <button ref={setRail} type="button" className={`fob-action ${styles.rail}`}
      data-variant="hover"
      style={{ height: props.headings.length * 10 + 16, visibility: props.headings.length ? undefined : 'hidden' }} disabled={!props.headings.length}
      aria-label={t('documentSections')} aria-expanded={open} aria-controls={open ? props.id : undefined}
      aria-haspopup="dialog" onMouseEnter={enter} onMouseLeave={leave}
      onClick={(event) => { if (event.detail === 0) enterWithKeyboard(); else enter(); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); enterWithKeyboard(); } }}>
      <span className={styles.ticks} style={{ gridTemplateRows: `repeat(${Math.max(1, props.headings.length)}, minmax(0, 1fr))` }} aria-hidden>{props.headings.map((heading, index) => <span key={heading.id}
        className={styles.tick} data-active={index === props.activeHeading}
        style={{ width: index === props.activeHeading ? 26 : Math.max(4, 20 - depths[index] * 6) }} />)}</span>
    </button>
    {open && rail && <AnchoredPopover
      anchor={rail} side="right" width={320} label={t('documentSections')}
      className={styles.floatingPanel} autoFocus={pinned} restoreFocusTo={restoreFocusTo}
      onClose={props.onClose} onMouseEnter={enter} onMouseLeave={leave}>
      <DocumentOutline {...props} />
    </AnchoredPopover>}
  </>;
}
