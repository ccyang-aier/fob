'use client';

import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowsOut, MagnifyingGlassPlus } from '@/components/icons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import { BlockActions } from '../../block-actions';
import { BlockAlignmentMenu } from '../../block-alignment-menu';
import { GraphicBlockTitle } from './title';
import { GraphicBlockResize } from './graphic-resize';
import { GraphicToolButton } from './tool-button';
import { GraphicPreviewDialog } from '../graphic-preview';
import styles from './styles.module.css';

export function RichBlockFrame({ props, icon: Icon, title, actions, children, resizable = true, minHeight = 200, appearance = 'card', showHeader, preview, intrinsicWidth }: {
  props: NodeViewProps; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; title: string; actions?: ReactNode; children: ReactNode; resizable?: boolean; minHeight?: number; appearance?: 'card' | 'canvas'; showHeader?: boolean; preview?: string; intrinsicWidth?: number;
}) {
  const { t } = useTranslation(richMessages);
  const editable = useEditorState({ editor: props.editor, selector: ({ editor }) => editor.isEditable });
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; height: number; next: number } | null>(null);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const canvas = appearance === 'canvas';
  const autoHeight = canvas && props.node.attrs.autoHeight !== false;
  const autoWidth = canvas && props.node.attrs.autoWidth !== false;
  useEffect(() => {
    if (canvas) return;
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [canvas]);
  const height = Number(props.node.attrs.height || 360);
  const width = Number(props.node.attrs.width || 100);
  const savedTitle = String(props.node.attrs.title || '');
  const update = (attrs: { title?: string; height?: number; width?: number }) => {
    if (!props.editor.isDestroyed && props.editor.isEditable) props.updateAttributes(attrs);
  };
  async function toggleFullscreen() {
    try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); setError(false); }
    catch { setError(true); }
  }
  const tools = <BlockActions placement={canvas ? 'canvas' : 'outside'} touchVisibility={canvas ? 'on-demand' : 'always'}>
    {actions}
    {canvas && editable && <BlockAlignmentMenu props={props} />}
    {resizable && (canvas ? <GraphicToolButton label={t('enlargeGraphic')} disabled={!preview} onClick={() => setPreviewOpen(true)}><MagnifyingGlassPlus size={16} aria-hidden /></GraphicToolButton>
      : <button className={`fob-action ${styles.iconButton}`} data-surface="plain" type="button" title={t(fullscreen ? 'exitFullscreen' : 'fullscreen')} aria-label={t(fullscreen ? 'exitFullscreen' : 'fullscreen')} onClick={() => void toggleFullscreen()}><ArrowsOut size={16} aria-hidden /></button>)}
  </BlockActions>;
  return <TooltipProvider><NodeViewWrapper ref={root} as="div" {...props.HTMLAttributes} data-fob-node={props.node.type.name} data-block-actions-root data-block-id={props.node.attrs.blockId} data-block-align={canvas ? props.node.attrs.align : undefined} data-graphic-auto-height={canvas ? autoHeight : undefined} data-graphic-auto-width={canvas ? autoWidth : undefined} className={`${styles.root}${canvas ? ` ${styles.canvasFrame}` : ''}`} contentEditable={false}
    style={canvas ? { width: autoWidth ? undefined : `${width}%`, height: resizable && !autoHeight ? height : undefined, '--graphic-preferred-width': `${(intrinsicWidth ?? 320) + 18}px`, '--graphic-image-width': intrinsicWidth ? `${intrinsicWidth}px` : '100%' } as CSSProperties : undefined}
    role={canvas ? 'group' : undefined} aria-label={canvas ? String(props.node.attrs.title || title) : undefined} tabIndex={canvas ? 0 : undefined}
    onClick={canvas ? (event: MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && root.current?.contains(event.target) && !event.target.closest('button, a, input, textarea, [data-graphic-title-editing], [role="separator"]')) {
        root.current?.focus({ preventScroll: true });
        if (event.target.tagName === 'IMG' && preview) setPreviewOpen(true);
      }
    } : undefined}>
    {!canvas && (showHeader ?? true) && <div className={styles.header}>
      <Icon size={16} aria-hidden />
      <span className={styles.title}>{editable ? <input className={styles.titleInput} aria-label={t('blockTitle')} placeholder={title} value={String(props.node.attrs.title || '')} maxLength={500} onChange={event => { if (props.editor.isEditable) props.updateAttributes({ title: event.target.value }); }} /> : String(props.node.attrs.title || title)}</span>
    </div>}
    {!canvas && tools}
    {canvas ? <div className={styles.canvasSurface} data-graphic-surface>
      {tools}
      <div className={styles.body}>{children}</div>
      {resizable && editable && <GraphicBlockResize props={props} width={width} height={height} autoHeight={autoHeight} autoWidth={autoWidth} minHeight={80} />}
    </div> : <>
      {error && <div className={styles.error} role="alert" data-document-export-omit>{t('fullscreenError')}</div>}
      <div className={styles.body} style={resizable ? { height } : undefined}>{children}</div>
    </>}
    {canvas && <div className={styles.graphicCaption} data-graphic-caption>
      <GraphicBlockTitle key={`${editable}:${savedTitle}`} value={savedTitle} fallback={title} editable={editable} onCommit={title => {
        const pos = props.getPos();
        if (typeof pos !== 'number' || String(props.editor.state.doc.nodeAt(pos)?.attrs.title || '') !== savedTitle) return;
        update({ title });
      }} />
    </div>}
    {resizable && editable && !canvas && <div className={`fob-resize-handle ${styles.resize}`} role="separator" aria-label={t('resize')} aria-orientation="horizontal" aria-valuemin={minHeight} aria-valuemax={1200} aria-valuenow={height} tabIndex={0} data-resize-axis="y" data-document-export-omit
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.resizing = 'true'; start.current = { y: event.clientY, height, next: height }; }}
      onPointerMove={event => { if (!start.current) return; start.current.next = Math.round(Math.max(minHeight, Math.min(1200, start.current.height + event.clientY - start.current.y))); const body = root.current?.querySelector<HTMLElement>(`.${styles.body}`); if (body) body.style.height = `${start.current.next}px`; }}
      onPointerUp={event => { if (start.current && props.editor.isEditable) props.updateAttributes({ height: start.current.next }); start.current = null; event.currentTarget.dataset.resizing = 'false'; }}
      onPointerCancel={event => { start.current = null; event.currentTarget.dataset.resizing = 'false'; const body = root.current?.querySelector<HTMLElement>(`.${styles.body}`); if (body) body.style.height = `${height}px`; }}
      onLostPointerCapture={event => { event.currentTarget.dataset.resizing = 'false'; start.current = null; }}
      onKeyDown={event => { if (!props.editor.isEditable || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); props.updateAttributes({ height: Math.max(minHeight, Math.min(1200, height + (event.key === 'ArrowDown' ? 20 : -20))) }); }} />}
  </NodeViewWrapper>
    {canvas && previewOpen && preview && <GraphicPreviewDialog key={preview} src={preview} title={savedTitle || title} onClose={() => setPreviewOpen(false)} />}
  </TooltipProvider>;
}
