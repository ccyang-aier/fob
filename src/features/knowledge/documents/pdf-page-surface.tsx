'use client';
import { useUiMessage } from '../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './pdf-page-surface.messages';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
import { orderPdfText } from './pdf-text-order';
import styles from './file-preview.module.css';
export type PdfHighlight = {
  id: string;
  anchor: PdfCommentAnchor;
  count: number;
  resolved: boolean;
};
/** Nearby pages alone allocate a high-resolution canvas and selectable TextLayer. */
export function PdfPageSurface({
  pdf,
  page,
  width,
  zoom,
  root,
  thumbnail = false,
  aspect,
  highlights = [],
  activeThreadId,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  width: number;
  zoom: number;
  root: React.RefObject<HTMLDivElement | null>;
  thumbnail?: boolean;
  aspect: number;
  highlights?: PdfHighlight[];
  activeThreadId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(page === 1),
    [pageAspect, setPageAspect] = useState(aspect),
    [error, setError] = useUiMessage(knowledgeMessages, '');
  const displayWidth = thumbnail ? width : (Math.min(Math.max(160, width - 48), 1200) * zoom) / 100;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setNear(entries[0].isIntersecting), {
      root: root.current,
      rootMargin: thumbnail ? '200px' : '800px',
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [root, thumbnail]);
  useEffect(() => {
    if (!near || !canvas.current) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let textLayer: InstanceType<(typeof import('pdfjs-dist'))['TextLayer']> | undefined;
    const surface = canvas.current,
      text = layer.current;
    void (async () => {
      const content = await pdf.getPage(page);
      if (cancelled) return;
      const base = content.getViewport({ scale: 1 }),
        viewport = content.getViewport({ scale: displayWidth / base.width });
      setPageAspect(base.height / base.width);
      setError('');
      const ratio = thumbnail
        ? 1
        : Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
          );
      surface.width = Math.floor(viewport.width * ratio);
      surface.height = Math.floor(viewport.height * ratio);
      surface.style.width = `${viewport.width}px`;
      surface.style.height = `${viewport.height}px`;
      if (text) {
        text.replaceChildren();
        text.style.setProperty('--scale-factor', String(viewport.scale));
        text.style.setProperty('--total-scale-factor', String(viewport.scale));
      }
      render = content.render({ canvas: surface, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (cancelled || !text) return;
      const engine = await import('pdfjs-dist');
      const textContent = orderPdfText(
        await content.getTextContent({ disableNormalization: true }),
        (x, y) => viewport.convertToViewportPoint(x, y),
      );
      textLayer = new engine.TextLayer({
        textContentSource: textContent,
        container: text,
        viewport,
      });
      await textLayer.render();
    })().catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException')
        setError({ key: 'unableToRenderThisPageOpenTheFile' });
    });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, displayWidth, near, thumbnail, setError]);
  const annotations = highlights.filter((item) =>
    item.anchor.pages.some((part) => part.page === page),
  );
  return (
    <div
      ref={host}
      className={styles.pdfPage}
      data-pdf-page={thumbnail ? undefined : page}
      style={{ width: displayWidth, height: displayWidth * pageAspect }}
    >
      {near && (
        <>
          <canvas
            ref={canvas}
            aria-label={
              thumbnail
                ? knowledgeT('pageValueThumbnail', { v0: page })
                : knowledgeT('pdfPageValue', { v0: page })
            }
          />
          {!thumbnail && (
            <div ref={layer} data-pdf-text className={`textLayer ${styles.textLayer}`} />
          )}
        </>
      )}
      {error && (
        <div role="alert" className={styles.pageError}>
          {error}
        </div>
      )}
      {!thumbnail && (
        <div className={styles.pdfAnnotations}>
          {annotations.map((item) => {
            const rects = item.anchor.pages.find((part) => part.page === page)!.rects;
            return (
              <div
                key={item.id}
                data-active={activeThreadId === item.id}
                data-resolved={item.resolved}
                className={styles.pdfAnnotation}
              >
                {rects.map((rect, index) => (
                  <span
                    key={index}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))}
                <button
                  aria-label={knowledgeT('viewAnnotationOnPageValueValue', {
                    v0: page,
                    v1: item.anchor.quote,
                  })}
                  title={item.anchor.quote}
                  style={{
                    left: `${Math.min(98, (rects.at(-1)!.x + rects.at(-1)!.width) * 100)}%`,
                    top: `${rects.at(-1)!.y * 100}%`,
                  }}
                  onClick={() => onSelect?.(item.id)}
                >
                  {item.count}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
