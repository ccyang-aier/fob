'use client';

import { useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './callout-node-view.messages';
/**
 * The callout NodeView (E05): a light tinted card over the shared schema's
 * `callout` node — a quiet tone-derived surface,
 * and semantic notice icons. The type picker and emoji chip share a compact
 * popover, with the existing color picker for custom backgrounds. Unknown
 * tones fall back to neutral; all controls respect the editor's editability.
 *
 * The editable `block+` content lives in NodeViewContent so a contentDOM
 * exists — required for ProseMirror/y-prosemirror content binding.
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { CaretDown, CheckCircle, Info, Lightbulb, Warning, XCircle, ArrowLeft } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { TableColorPicker } from '../table/table-color-picker';
import styles from './callout.module.css';

const CALLOUT_EMOJI = [
  '💡',
  '✅',
  '⚠️',
  'ℹ️',
  '🔥',
  '⭐',
  '📌',
  '📝',
  '❗',
  '❓',
  '🎯',
  '🚀',
  '✨',
  '💬',
  '🔍',
  '🧠',
  '📎',
  '🗓️',
  '⚙️',
  '🛠️',
  '💼',
  '🎉',
  '👀',
  '🧪',
] as const;

interface CalloutTone {
  label: string;
  /** Icon and swatch color. */
  accent: string;
  /** Card wash; color-mix keeps both themes coherent. */
  wash: string;
  emoji: string;
}

function CALLOUT_TONES(locale?: Locale): Record<string, CalloutTone> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    neutral: { label: knowledgeT('neutral'), accent: '#626d7c', wash: '#f6f8fa', emoji: '💡' },
    info: { label: knowledgeT('info'), accent: '#2870ba', wash: '#f0f7ff', emoji: 'ℹ️' },
    success: { label: knowledgeT('success'), accent: '#198553', wash: '#effbf4', emoji: '✅' },
    warn: { label: knowledgeT('warning'), accent: '#9b721c', wash: '#fffaeb', emoji: '⚠️' },
    danger: { label: knowledgeT('error'), accent: '#bd4343', wash: '#fff3f2', emoji: '❗' },
  };
}

const NOTICE_ICONS = { '💡': Lightbulb, 'ℹ️': Info, '✅': CheckCircle, '⚠️': Warning, '❗': XCircle };

function customInk(background: string): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  if (background.length === 9 && Number.parseInt(background.slice(7), 16) < 192) return 'var(--ink)';
  return .2126 * r + .7152 * g + .0722 * b > .179 ? '#202020' : '#ffffff';
}

export function CalloutNodeView({ node, editor, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const emoji = String(node.attrs.emoji || '💡');
  const tones = CALLOUT_TONES(locale);
  const tone = tones[String(node.attrs.tone)] ?? tones.neutral;
  const background = node.attrs.tone === 'custom' && typeof node.attrs.background === 'string' ? node.attrs.background : null;
  const Icon = NOTICE_ICONS[emoji as keyof typeof NOTICE_ICONS];
  const [panel, setPanel] = useState<'icon' | 'tone' | 'custom' | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = panel !== null;

  const closeAndFocusTrigger = () => {
    setPanel(null);
    anchor?.focus();
  };

  return (
    // Registry attrs are serialized-only (`rendered: false`), so the visible
    // NodeView DOM re-emits the semantic markers itself; the clipboard/HTML
    // serializers stay schema-driven and unaffected by the NodeView.
    <NodeViewWrapper
      as="aside"
      {...HTMLAttributes}
      data-fob-node="callout"
      data-emoji={node.attrs.emoji}
      data-tone={node.attrs.tone}
      data-background={background}
      data-block-id={node.attrs.blockId}
      className={styles.root}
      style={{ '--callout-accent': background ? customInk(background) : tone.accent, '--callout-ink': background ? customInk(background) : tone.accent, '--callout-wash': background ?? tone.wash } as CSSProperties}
    >
      <div className={styles.inner}>
        <button
          type="button"
          aria-label={knowledgeT('setCalloutIconAndTone')}
          aria-expanded={open}
          data-document-callout-icon
          aria-haspopup="dialog"
          title={knowledgeT('setCalloutIconAndTone')}
          disabled={!editor.isEditable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { if (editor.isEditable) { setAnchor(event.currentTarget); setPanel((value) => value ? null : 'icon'); } }}
          className={styles.iconButton}
          contentEditable={false}
        >
          {Icon ? <Icon size={23} aria-hidden /> : <span aria-hidden>{emoji}</span>}
        </button>
        <div className={styles.content}>
          <NodeViewContent className={styles.editable} />
        </div>
        {editor.isEditable && <button type="button" className={`${styles.typeTrigger} fob-action`} data-surface="plain" data-document-export-omit contentEditable={false} aria-label={knowledgeT('calloutStyle')} aria-haspopup="dialog" aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { setAnchor(event.currentTarget); setPanel((value) => value ? null : 'tone'); }}>
          {background ? knowledgeT('custom') : knowledgeT('noticeValue', { v0: tone.label })}<CaretDown size={12} aria-hidden />
        </button>}
        {open && anchor ? (
          <AnchoredPopover anchor={anchor} onClose={() => setPanel(null)} label={knowledgeT('calloutStyle')} width={248} align="end" autoFocus={false} className={styles.menu}>
            {panel === 'custom' ? <>
              <button type="button" className={`${styles.back} fob-action`} data-surface="plain" aria-label={knowledgeT('backToStyles')} onClick={() => setPanel('tone')}><ArrowLeft size={14} aria-hidden />{knowledgeT('customBackground')}</button>
              <TableColorPicker value={background ?? tone.wash} onChange={(hex) => updateAttributes({ tone: 'custom', background: hex })} />
            </> : <>
            {panel === 'icon' && <>
            <div className={styles.menuTitle}>{knowledgeT('icon')}</div>
            <div className={styles.emojiGrid}>
              {CALLOUT_EMOJI.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-label={knowledgeT('iconValue', { v0: candidate })}
                  aria-pressed={candidate === emoji}
                  onClick={() => {
                    updateAttributes({ emoji: candidate });
                    closeAndFocusTrigger();
                  }}
                  className={styles.emojiOption}
                >
                  <span aria-hidden>{candidate}</span>
                </button>
              ))}
            </div>
            </>}
            <div className={styles.toneGrid}>
              {Object.entries(tones).map(([name, candidate]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={knowledgeT('toneValue', { v0: candidate.label })}
                  aria-pressed={name === String(node.attrs.tone)}
                  onClick={() => {
                    updateAttributes({ tone: name, background: null, emoji: candidate.emoji });
                    closeAndFocusTrigger();
                  }}
                  className={styles.toneOption}
                >
                  <span
                    aria-hidden
                    className={styles.swatch}
                    style={{ background: candidate.accent }}
                  />
                  {candidate.label}
                </button>
              ))}
              <button type="button" className={styles.toneOption} aria-label={knowledgeT('customBackground')} aria-pressed={node.attrs.tone === 'custom'} onClick={() => setPanel('custom')}><span className={styles.customSwatch} aria-hidden />{knowledgeT('custom')}</button>
            </div>
            </>}
          </AnchoredPopover>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
