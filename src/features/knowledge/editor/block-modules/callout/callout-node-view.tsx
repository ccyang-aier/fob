'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './callout-node-view.messages';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { CaretDown, CheckCircle, ColorPalette, Emoji, Info, Lightbulb, Warning, XCircle, ArrowLeft, type Icon } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { EmojiPalette } from '@/components/ui/emoji-picker/palette';
import { TableColorPicker } from '../table/table-color-picker';
import { BlockActions } from '../block-actions';
import styles from './callout.module.css';

interface CalloutTone {
  label: string;
  accent: string;
  wash: string;
  icon: Icon;
}

function calloutTones(locale?: Locale): Record<string, CalloutTone> {
  const t = createTranslator(knowledgeMessages, locale);
  return {
    neutral: { label: t('neutral'), accent: '#626d7c', wash: '#f6f8fa', icon: Lightbulb },
    info: { label: t('info'), accent: '#2870ba', wash: '#f0f7ff', icon: Info },
    success: { label: t('success'), accent: '#198553', wash: '#effbf4', icon: CheckCircle },
    warn: { label: t('warning'), accent: '#9b721c', wash: '#fffaeb', icon: Warning },
    danger: { label: t('error'), accent: '#bd4343', wash: '#fff3f2', icon: XCircle },
  };
}

function customInk(background: string): string {
  const channels = [1, 3, 5].map(offset => Number.parseInt(background.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  if (background.length === 9 && Number.parseInt(background.slice(7), 16) < 192) return 'var(--ink)';
  return .2126 * r + .7152 * g + .0722 * b > .179 ? '#202020' : '#ffffff';
}

export function CalloutNodeView({ node, editor, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const { locale, t } = useTranslation(knowledgeMessages);
  const emoji = String(node.attrs.emoji || '💡');
  const tones = calloutTones(locale);
  const tone = tones[String(node.attrs.tone)] ?? tones.neutral;
  const background = node.attrs.tone === 'custom' && typeof node.attrs.background === 'string' ? node.attrs.background : null;
  const [panel, setPanel] = useState<'icon' | 'tone' | 'custom' | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const styleOpen = panel === 'tone' || panel === 'custom';
  const close = () => { setPanel(null); anchor?.focus({ preventScroll: true }); };

  return <NodeViewWrapper as="aside" {...HTMLAttributes} data-fob-node="callout" data-block-actions-root data-emoji={node.attrs.emoji} data-tone={node.attrs.tone} data-background={background} data-block-id={node.attrs.blockId} className={styles.root}
    style={{ '--callout-accent': background ? customInk(background) : tone.accent, '--callout-ink': background ? customInk(background) : tone.accent, '--callout-wash': background ?? tone.wash } as CSSProperties}>
    <div className={styles.inner}>
      <button type="button" aria-label={t('setCalloutIconAndTone')} aria-expanded={panel === 'icon'} aria-haspopup="dialog" data-document-callout-icon title={t('setCalloutIconAndTone')} disabled={!editor.isEditable} className={styles.iconButton} contentEditable={false}
        onMouseDown={event => event.preventDefault()} onClick={event => { if (editor.isEditable) { setAnchor(event.currentTarget); setPanel(value => value === 'icon' ? null : 'icon'); } }}>
        <Emoji value={emoji} size={22} />
      </button>
      <div className={styles.content}><NodeViewContent className={styles.editable} /></div>
    </div>
    {editor.isEditable && <BlockActions active={styleOpen}>
      <button type="button" className="fob-action" data-surface="plain" aria-label={t('calloutStyle')} aria-haspopup="dialog" aria-expanded={styleOpen}
        onClick={event => { setAnchor(event.currentTarget); setPanel(value => value === 'tone' || value === 'custom' ? null : 'tone'); }}>
        {background ? t('custom') : t('noticeValue', { v0: tone.label })}<CaretDown size={12} aria-hidden />
      </button>
    </BlockActions>}
    {panel && anchor && <AnchoredPopover anchor={anchor} onClose={() => setPanel(null)} label={panel === 'icon' ? t('setCalloutIconAndTone') : t('calloutStyle')} width={panel === 'icon' ? 296 : panel === 'custom' ? 248 : 168} align="end" autoFocus={panel === 'icon'} className={panel === 'icon' ? styles.emojiMenu : styles.menu}>
      {panel === 'icon' ? <EmojiPalette value={emoji} onSelect={next => { updateAttributes({ emoji: next }); close(); }} /> : panel === 'custom' ? <>
        <button type="button" className={'fob-action ' + styles.back} data-surface="plain" aria-label={t('backToStyles')} onClick={() => setPanel('tone')}><ArrowLeft size={14} aria-hidden />{t('customBackground')}</button>
        <TableColorPicker value={background ?? tone.wash} onChange={hex => updateAttributes({ tone: 'custom', background: hex })} />
      </> : <div className={styles.toneGrid}>
        {Object.entries(tones).map(([name, candidate]) => {
          const ToneIcon = candidate.icon;
          return <button key={name} type="button" aria-label={t('toneValue', { v0: candidate.label })} aria-pressed={name === String(node.attrs.tone)} className={styles.toneOption}
            onClick={() => { updateAttributes({ tone: name, background: null }); close(); }}>
            <ToneIcon size={16} aria-hidden style={{ color: candidate.accent }} />{candidate.label}
          </button>;
        })}
        <button type="button" className={styles.toneOption} aria-label={t('customBackground')} aria-pressed={node.attrs.tone === 'custom'} onClick={() => setPanel('custom')}><ColorPalette size={16} aria-hidden />{t('custom')}</button>
      </div>}
    </AnchoredPopover>}
  </NodeViewWrapper>;
}
