'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ArrowsOut, Minus, Plus, X } from '@/components/icons';
import { getOverlayRoot, OverlayRootContext } from '@/lib/overlay-root';
import { useTranslation } from '@/lib/i18n';
import { GraphicToolButton } from '../frame/tool-button';
import { richMessages } from '../frame/messages';
import { clampGraphicView, fittedGraphicView, zoomGraphicView, type GraphicView } from './state';
import type { GraphicSize } from './size';
import styles from '../frame/styles.module.css';

export function GraphicPreviewDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const { t } = useTranslation(richMessages);
  const titleId = useId(), hintId = useId();
  const [portalRoot] = useState(() => getOverlayRoot() ?? document.body);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const imageSize = useRef<GraphicSize>({ width: 1, height: 1 });
  const viewport = useRef<GraphicSize>({ width: 1, height: 1 });
  const [size, setSize] = useState<GraphicSize | null>(null);
  const [imageError, setImageError] = useState(false);
  const [view, setView] = useState<GraphicView>({ scale: 1, x: 0, y: 0 });
  const current = useRef(view);
  const drag = useRef<{ pointer: number; x: number; y: number; view: GraphicView } | null>(null);
  const publish = useCallback((next: GraphicView) => { current.current = next; setView(next); }, []);
  const fit = useCallback(() => publish(fittedGraphicView(imageSize.current, viewport.current)), [publish]);
  const zoom = useCallback((scale: number, anchor = { x: 0, y: 0 }) => publish(zoomGraphicView(current.current, scale, anchor, imageSize.current, viewport.current)), [publish]);
  useEffect(() => {
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    stage.current?.focus({ preventScroll: true });
    const blockScroll = (event: WheelEvent) => event.preventDefault();
    dialog.addEventListener('wheel', blockScroll, { passive: false });
    return () => { dialog.removeEventListener('wheel', blockScroll); dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [dialog]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      const width = element.clientWidth || rect.width, height = element.clientHeight || rect.height;
      if (width && height && (viewport.current.width !== width || viewport.current.height !== height)) { viewport.current = { width, height }; fit(); }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(current.current.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * .003), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, [fit, zoom]);
  return createPortal(<dialog ref={setDialog} className={styles.graphicViewer} aria-labelledby={titleId} aria-describedby={hintId} data-graphic-viewer data-document-export-omit
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === '+' || event.key === '=') zoom(current.current.scale * 1.25);
        else if (event.key === '-') zoom(current.current.scale / 1.25);
        else if (event.key === '0' || event.key === 'Home') fit();
        else publish(clampGraphicView({ ...current.current, x: current.current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: current.current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }, imageSize.current, viewport.current));
      }
    }}>
    <OverlayRootContext.Provider value={dialog ?? undefined}>
      <div className={styles.graphicViewerHeader}><span id={titleId}>{title}</span><GraphicToolButton label={t('closePreview')} onClick={onClose}><X size={18} aria-hidden /></GraphicToolButton></div>
      <div ref={stage} className={styles.graphicViewerStage} tabIndex={0} aria-label={t('graphicViewport')} data-graphic-viewport
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragging = 'true'; drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: current.current }; }}
        onPointerMove={event => { const start = drag.current; if (start?.pointer !== event.pointerId) return; publish(clampGraphicView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y }, imageSize.current, viewport.current)); }}
        onPointerUp={event => { if (drag.current?.pointer !== event.pointerId) return; drag.current = null; event.currentTarget.dataset.dragging = 'false'; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={event => { drag.current = null; event.currentTarget.dataset.dragging = 'false'; }} onLostPointerCapture={event => { drag.current = null; event.currentTarget.dataset.dragging = 'false'; }}
        onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); const fitted = fittedGraphicView(imageSize.current, viewport.current).scale; if (current.current.scale > fitted * 1.5) fit(); else zoom(fitted * 2, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }); }}>
        <Image src={src} alt={title} width={size?.width ?? 1} height={size?.height ?? 1} unoptimized draggable={false} className={styles.graphicViewerImage}
          style={{ width: size?.width ?? 1, height: size?.height ?? 1, visibility: size ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          onLoad={event => { const image = event.currentTarget; if (!image.naturalWidth || !image.naturalHeight) return; const next = { width: image.naturalWidth, height: image.naturalHeight }; imageSize.current = next; setSize(next); fit(); }} onError={() => setImageError(true)} />
        {imageError && <div className={styles.state} role="alert">{t('graphicPreviewError')}</div>}
      </div>
      <p id={hintId} className={styles.graphicViewerHint}>{t('graphicPreviewHint')}</p>
      <div className={styles.graphicViewerTools} role="group" aria-label={t('zoom')}>
        <GraphicToolButton label={t('zoomOut')} onClick={() => zoom(current.current.scale / 1.25)}><Minus size={18} aria-hidden /></GraphicToolButton>
        <button type="button" className={`fob-action ${styles.graphicZoomValue}`} data-surface="plain" aria-label={t('actualSize')} onClick={() => zoom(1)}>{Math.round(view.scale * 100)}%</button>
        <GraphicToolButton label={t('zoomIn')} onClick={() => zoom(current.current.scale * 1.25)}><Plus size={18} aria-hidden /></GraphicToolButton>
        <span className={styles.graphicViewerSeparator} />
        <GraphicToolButton label={t('fitGraphic')} onClick={fit}><ArrowsOut size={18} aria-hidden /></GraphicToolButton>
      </div>
    </OverlayRootContext.Provider>
  </dialog>, portalRoot);
}
