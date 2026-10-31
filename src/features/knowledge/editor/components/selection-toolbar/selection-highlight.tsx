'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Highlighter, SelectionCheck } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { useTranslation } from '@/lib/i18n';
import { TableColorPicker } from '../../block-modules/table/table-color-picker';
import { parseTableColor } from '../../block-modules/table/table-color';
import { knowledgeMessages } from './messages';
import styles from './styles.module.css';

const presets = [
  ['yellowHighlight', '#fff2b3'], ['orangeHighlight', '#ffe3cc'],
  ['pinkHighlight', '#fbe0ec'], ['purpleHighlight', '#eee3ff'],
  ['blueHighlight', '#dceeff'], ['greenHighlight', '#dff3e3'],
  ['cyanHighlight', '#dff4f2'],
] as const;

export function SelectionHighlight({ editor, onOpenChange }: {
  editor: Editor; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(knowledgeMessages);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastColor = useRef('#fff2b3');
  const selection = useRef({ from: 0, to: 0 });
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null;
  const [pinned, setPinned] = useState(false);
  const [custom, setCustom] = useState(false);
  const [color, setColor] = useState('#fff2b3');
  const highlight = useEditorState({ editor, selector: ({ editor }) => ({
    active: editor.isActive('highlight'), color: editor.getAttributes('highlight').color,
  }) });
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const close = () => {
    cancelClose();
    setAnchor(null);
    onOpenChange(false);
  };
  const show = (element: HTMLButtonElement, pin = false) => {
    cancelClose();
    if (!open) {
      selection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
      const current = editor.getAttributes('highlight').color;
      setColor(typeof current === 'string' && parseTableColor(current) ? current : lastColor.current);
      setCustom(false);
      setPinned(pin);
      setAnchor(element);
      onOpenChange(true);
    } else if (pin) setPinned(true);
  };
  const leave = () => {
    cancelClose();
    if (!pinned) closeTimer.current = setTimeout(close, 180);
  };
  const apply = (value: string | null, range = selection.current) => {
    const chain = editor.chain().focus().setTextSelection(range);
    if (value) {
      lastColor.current = value;
      chain.setMark('highlight', { color: value });
    }
    else chain.unsetMark('highlight');
    chain.run();
    close();
  };
  const toggle = () => {
    const active = editor.isActive('highlight');
    const current = editor.getAttributes('highlight').color;
    if (active && typeof current === 'string' && parseTableColor(current)) lastColor.current = current;
    apply(active ? null : lastColor.current,
      open ? selection.current : { from: editor.state.selection.from, to: editor.state.selection.to });
  };
  return <>
    <button type="button" className={styles.tool}
      aria-label={t('highlight')} title={t(highlight.active ? 'cancelHighlight' : 'highlight')} aria-haspopup="dialog" aria-expanded={open}
      aria-pressed={highlight.active} disabled={!editor.can().toggleMark('highlight')}
      onMouseEnter={event => show(event.currentTarget)} onMouseLeave={leave}
      onClick={toggle}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        show(event.currentTarget, true);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-selection-highlight] button')?.focus());
      }}>
      <Highlighter size={16} />
    </button>
    {anchor && <AnchoredPopover anchor={anchor} label={t('highlightColor')}
      onClose={close} width={custom ? 244 : 164} align="end" autoFocus={false} className={styles.highlightPanel}
      onMouseEnter={cancelClose} onMouseLeave={leave}>
      <div data-selection-highlight onFocusCapture={() => setPinned(true)}>
        <div className={styles.highlightPresets} role="group" aria-label={t('presetHighlights')}>
          {presets.map(([label, value]) => <button key={value} type="button"
            className={`fob-action ${styles.highlightSwatch}`} data-surface="plain"
            aria-label={t(label)} title={t(label)} aria-pressed={highlight.color === value}
            onClick={() => apply(value)}>
            <span style={{ backgroundColor: value }} />
            {highlight.color === value && <SelectionCheck size={20} />}
          </button>)}
          <button type="button" className={`fob-action ${styles.highlightSwatch}`} data-surface="plain"
            aria-label={t('customColor')} title={t('customColor')} aria-expanded={custom}
            onClick={() => { setCustom(!custom); setPinned(true); }}>
            <span className={styles.highlightCustomSwatch} aria-hidden />
          </button>
        </div>
        {custom && <div className={styles.highlightCustom}>
          <TableColorPicker value={color} onChange={setColor} trapFocus={false} />
          <button type="button" className={`fob-action ${styles.highlightApply}`} data-surface="muted"
            onClick={() => apply(color)}>{t('apply')}</button>
        </div>}
      </div>
    </AnchoredPopover>}
  </>;
}
