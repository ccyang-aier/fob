'use client';

import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ArrowsOut } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

export function RichBlockFrame({ props, icon: Icon, title, actions, children, resizable = true, minHeight = 200 }: {
  props: NodeViewProps; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; title: string; actions?: ReactNode; children: ReactNode; resizable?: boolean; minHeight?: number;
}) {
  const { t } = useTranslation(richMessages);
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; height: number; next: number } | null>(null);
  const [error, setError] = useState(false);
  const height = Number(props.node.attrs.height || 360);
  return <NodeViewWrapper ref={root} as="div" {...props.HTMLAttributes} data-fob-node={props.node.type.name} data-block-id={props.node.attrs.blockId} className={styles.root} contentEditable={false}>
    <div className={styles.header}>
      <Icon size={16} aria-hidden />
      <span className={styles.title}>{props.editor.isEditable ? <input className={styles.titleInput} aria-label={t('blockTitle')} placeholder={title} value={String(props.node.attrs.title || '')} maxLength={500} onChange={event => props.updateAttributes({ title: event.target.value })} /> : String(props.node.attrs.title || title)}</span>
      <div className={styles.actions} data-document-export-omit>
        {actions}
        {resizable && <button className={`fob-action ${styles.iconButton}`} data-surface="plain" type="button" title={t('fullscreen')} aria-label={t('fullscreen')} onClick={async () => {
          try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); setError(false); }
          catch { setError(true); }
        }}><ArrowsOut size={16} aria-hidden /></button>}
      </div>
    </div>
    {error && <div className={styles.error} role="alert" data-document-export-omit>{t('fullscreenError')}</div>}
    <div className={styles.body} style={resizable ? { height } : undefined}>{children}</div>
    {resizable && props.editor.isEditable && <div className={`fob-resize-handle ${styles.resize}`} role="separator" aria-label={t('resize')} aria-orientation="horizontal" aria-valuemin={minHeight} aria-valuemax={1200} aria-valuenow={height} tabIndex={0} data-resize-axis="y" data-document-export-omit
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.resizing = 'true'; start.current = { y: event.clientY, height, next: height }; }}
      onPointerMove={event => { if (!start.current) return; start.current.next = Math.round(Math.max(minHeight, Math.min(1200, start.current.height + event.clientY - start.current.y))); const body = root.current?.querySelector<HTMLElement>(`.${styles.body}`); if (body) body.style.height = `${start.current.next}px`; }}
      onPointerUp={event => { if (start.current) props.updateAttributes({ height: start.current.next }); start.current = null; event.currentTarget.dataset.resizing = 'false'; }}
      onPointerCancel={event => { start.current = null; event.currentTarget.dataset.resizing = 'false'; const body = root.current?.querySelector<HTMLElement>(`.${styles.body}`); if (body) body.style.height = `${height}px`; }}
      onLostPointerCapture={event => { event.currentTarget.dataset.resizing = 'false'; start.current = null; }}
      onKeyDown={event => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); props.updateAttributes({ height: Math.max(minHeight, Math.min(1200, height + (event.key === 'ArrowDown' ? 20 : -20))) }); }} />}
  </NodeViewWrapper>;
}
