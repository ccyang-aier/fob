'use client';

import { useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './callout-node-view.messages';
/**
 * The callout NodeView (E05): a light tinted card over the shared schema's
 * `callout` node — a quiet tone-derived surface,
 * and an emoji chip that opens a compact popover (curated emoji grid + tone
 * swatches). `tone` is a free string attr in the schema; unknown values fall
 * back to the neutral rendering, and the editable state gates the chip.
 *
 * The editable `block+` content lives in NodeViewContent so a contentDOM
 * exists — required for ProseMirror/y-prosemirror content binding.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
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
}

function CALLOUT_TONES(locale?: Locale): Record<string, CalloutTone> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    neutral: { label: knowledgeT('neutral'), accent: '#6d7d92', wash: '#f7f9fc' },
    info: { label: knowledgeT('info'), accent: '#3077cc', wash: '#f2f7ff' },
    success: { label: knowledgeT('success'), accent: '#2e916d', wash: '#f0faf5' },
    warn: { label: knowledgeT('warning'), accent: '#c18a31', wash: '#fff9ed' },
    danger: { label: knowledgeT('error'), accent: '#c65652', wash: '#fff4f3' },
  };
}

export function CalloutNodeView({ node, editor, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const emoji = String(node.attrs.emoji || '💡');
  // tone is a free string attr; anything unknown renders as neutral.
  const tone = CALLOUT_TONES(locale)[String(node.attrs.tone)] ?? CALLOUT_TONES(locale).neutral;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const closeAndFocusChip = () => {
    setOpen(false);
    chipRef.current?.focus();
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
      data-block-id={node.attrs.blockId}
      className={styles.root}
      style={{ '--callout-accent': tone.accent, '--callout-wash': tone.wash } as CSSProperties}
    >
      <div ref={rootRef} className={styles.inner}>
        <button
          ref={chipRef}
          type="button"
          aria-label={knowledgeT('setCalloutIconAndTone')}
          aria-expanded={open}
          data-document-callout-icon
          aria-haspopup="dialog"
          title={knowledgeT('setCalloutIconAndTone')}
          disabled={!editor.isEditable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (editor.isEditable ? setOpen((value) => !value) : undefined)}
          className={styles.iconButton}
        >
          <span aria-hidden>{emoji}</span>
        </button>
        <div className={styles.content}>
          <NodeViewContent className={styles.editable} />
        </div>
        {open ? (
          <div
            role="dialog"
            aria-label={knowledgeT('calloutStyle')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeAndFocusChip();
              }
            }}
            className={styles.menu}
          >
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
                    closeAndFocusChip();
                  }}
                  className={styles.emojiOption}
                >
                  <span aria-hidden>{candidate}</span>
                </button>
              ))}
            </div>
            <div className={styles.menuTitle}>{knowledgeT('calloutLevel')}</div>
            <div className={styles.toneGrid}>
              {Object.entries(CALLOUT_TONES(locale)).map(([name, candidate]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={knowledgeT('toneValue', { v0: candidate.label })}
                  aria-pressed={name === String(node.attrs.tone)}
                  onClick={() => {
                    updateAttributes({ tone: name });
                    closeAndFocusChip();
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
            </div>
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
