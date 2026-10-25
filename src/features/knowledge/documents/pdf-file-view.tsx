'use client';
import { useUiMessage } from '../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './pdf-file-view.messages';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot } from '@/lib/overlay-root';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
import { ChatCircleDots, X } from '@/components/icons';
import 'pdfjs-dist/web/pdf_viewer.css';
import { PdfPageSurface, type PdfHighlight } from './pdf-page-surface';
import { readPdfSelection } from './pdf-selection';
import styles from './file-preview.module.css';
export interface PdfComments {
  assetHash: string;
  canComment: boolean;
  highlights: PdfHighlight[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onCompose: (selection: { anchor: PdfCommentAnchor; x: number; y: number }) => void;
  locate: { anchor: PdfCommentAnchor; sequence: number } | null;
}
export function PdfFileView({
  blob,
  page,
  zoom,
  thumbnails,
  thumbnailsId,
  onThumbnailsChange,
  onPages,
  onPageChange,
  onZoomChange,
  comments,
}: {
  blob: Blob;
  page: number;
  zoom: number;
  thumbnails: boolean;
  thumbnailsId: string;
  onThumbnailsChange: (open: boolean) => void;
  onPages: (count: number) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  comments?: PdfComments;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const viewport = useRef<HTMLDivElement>(null),
    thumbs = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [aspect, setAspect] = useState(1.414);
  const [error, setError] = useUiMessage(knowledgeMessages, ''),
    [width, setWidth] = useState(800);
  const [selection, setSelection] = useState<ReturnType<typeof readPdfSelection>>(null);
  const [visiblePart, setVisiblePart] = useState({ top: 0, height: 1 });
  const reportedPage = useRef(page);
  const callbacks = useRef({ onPageChange, onZoomChange, onPages });
  const zoomPoint = useRef<{
    x: number;
    y: number;
    zoom: number;
    left: number;
    top: number;
    page?: number;
    pageX?: number;
    pageY?: number;
  } | null>(null);
  const scrollFrame = useRef(0);
  const readingPoint = useRef({ page, fraction: 0 });
  useLayoutEffect(() => {
    callbacks.current = { onPageChange, onZoomChange, onPages };
  });
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
      setSelection(null);
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scrollFrame.current);
    };
  }, []);
  useEffect(() => {
    const clearOutsideSelection = () => {
      const selected = document.getSelection();
      if (!selected || selected.isCollapsed || !viewport.current?.contains(selected.anchorNode))
        setSelection(null);
    };
    document.addEventListener('selectionchange', clearOutsideSelection);
    return () => document.removeEventListener('selectionchange', clearOutsideSelection);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined;
    void (async () => {
      const engine = await import('pdfjs-dist');
      engine.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      task = engine.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        cMapUrl: '/vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        wasmUrl: '/vendor/pdfjs/wasm/',
      });
      task.onPassword = () => {
        setError({ key: 'thisPdfIsPasswordProtectedDownloadItUnlock' });
        void task?.destroy();
      };
      const document = await task.promise;
      if (cancelled) return;
      const first = (await document.getPage(1)).getViewport({ scale: 1 });
      if (cancelled) return;
      setAspect(first.height / first.width);
      callbacks.current.onPages(document.numPages);
      setPdf(document);
    })().catch(() => {
      if (!cancelled) setError({ key: 'unableToReadPdfCheckWhetherTheFile' });
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob, setError]);
  useEffect(() => {
    const host = viewport.current;
    if (!host || !pdf) return;
    if (reportedPage.current === page && host.querySelector('[data-pdf-page]')) return;
    reportedPage.current = page;
    const target = host.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (target) host.scrollTo({ top: target.offsetTop - 24, behavior: 'instant' });
  }, [page, pdf]);
  useLayoutEffect(() => {
    const point = zoomPoint.current,
      host = viewport.current;
    if (!host) return;
    if (!point) {
      const element = host.querySelector<HTMLElement>(
        `[data-pdf-page="${readingPoint.current.page}"]`,
      );
      if (element)
        host.scrollTop = element.offsetTop + element.offsetHeight * readingPoint.current.fraction;
      return;
    }
    if (zoom === point.zoom) return;
    const ratio = zoom / point.zoom;
    const element = point.page
      ? host.querySelector<HTMLElement>(`[data-pdf-page="${point.page}"]`)
      : null;
    host.scrollLeft = element
      ? element.offsetLeft + element.offsetWidth * point.pageX! - point.x
      : (point.left + point.x) * ratio - point.x;
    host.scrollTop = element
      ? element.offsetTop + element.offsetHeight * point.pageY! - point.y
      : (point.top + point.y) * ratio - point.y;
    zoomPoint.current = null;
  }, [zoom, width]);
  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    function handleWheel(event: WheelEvent) {
      if (!host) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const bounds = host.getBoundingClientRect();
        const element = (event.target as Element).closest<HTMLElement>('[data-pdf-page]'),
          box = element?.getBoundingClientRect();
        zoomPoint.current = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          left: host.scrollLeft,
          top: host.scrollTop,
          zoom,
          ...(element && box
            ? {
                page: Number(element.dataset.pdfPage),
                pageX: (event.clientX - box.left) / box.width,
                pageY: (event.clientY - box.top) / box.height,
              }
            : {}),
        };
        callbacks.current.onZoomChange(
          Math.min(300, Math.max(50, zoom + (event.deltaY > 0 ? -10 : 10))),
        );
        return;
      }
    }
    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => host.removeEventListener('wheel', handleWheel);
  }, [zoom]);
  useEffect(() => {
    const target = comments?.locate;
    if (!target || !pdf) return;
    const number = target.anchor.pages[0].page;
    if (number > pdf.numPages) return;
    callbacks.current.onPageChange(number);
    const frame = requestAnimationFrame(() => {
      const host = viewport.current,
        element = host?.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`);
      if (host && element)
        host.scrollTo({
          top:
            element.offsetTop +
            element.offsetHeight * target.anchor.pages[0].rects[0].y -
            host.clientHeight * 0.3,
          behavior: 'smooth',
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [comments?.locate, pdf]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = thumbs.current,
        item = root?.querySelector<HTMLElement>(`[data-thumbnail="${page}"]`);
      if (!root || !item) return;
      const bounds = root.getBoundingClientRect(),
        box = item.getBoundingClientRect();
      if (box.top < bounds.top) root.scrollTop += box.top - bounds.top - 4;
      else if (box.bottom > bounds.bottom) root.scrollTop += box.bottom - bounds.bottom + 4;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, thumbnails, pdf, width]);
  const trackPage = useCallback(() => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const host = viewport.current;
      if (!host || !pdf) return;
      const bounds = host.getBoundingClientRect(),
        elements = [...host.querySelectorAll<HTMLElement>('[data-pdf-page]')];
      const visible = (item: HTMLElement) => {
        const box = item.getBoundingClientRect();
        return Math.max(0, Math.min(box.bottom, bounds.bottom) - Math.max(box.top, bounds.top));
      };
      const current = elements.reduce<HTMLElement | null>(
        (best, candidate) => (!best || visible(candidate) > visible(best) ? candidate : best),
        null,
      );
      if (!current) return;
      const box = current.getBoundingClientRect(),
        number = Number(current.dataset.pdfPage);
      readingPoint.current = { page: number, fraction: (bounds.top - box.top) / box.height };
      setVisiblePart({
        top: Math.max(0, (bounds.top - box.top) / box.height),
        height: Math.max(
          0,
          Math.min(
            1,
            (Math.min(bounds.bottom, box.bottom) - Math.max(bounds.top, box.top)) / box.height,
          ),
        ),
      });
      if (reportedPage.current !== number) {
        reportedPage.current = number;
        callbacks.current.onPageChange(number);
      }
    });
  }, [pdf]);
  useEffect(() => {
    trackPage();
  }, [trackPage, width, zoom, page]);
  return (
    <div className={styles.pdfReader}>
      {thumbnails && pdf && (
        <aside
          id={thumbnailsId}
          className={styles.pdfThumbnails}
          aria-label={knowledgeT('pdfThumbnails')}
        >
          <header>
            <strong>{knowledgeT('thumbnails')}</strong>
            <button
              aria-label={knowledgeT('collapseThumbnails')}
              onClick={() => onThumbnailsChange(false)}
            >
              <X size={14} />
            </button>
          </header>
          <div ref={thumbs} className={styles.pdfThumbnailList}>
            {Array.from({ length: pdf.numPages }, (_, index) => (
              <button
                key={index}
                data-thumbnail={index + 1}
                data-active={page === index + 1}
                aria-label={knowledgeT('goToPageValue', { v0: index + 1 })}
                aria-current={page === index + 1 ? 'page' : undefined}
                onClick={() => onPageChange(index + 1)}
              >
                <div className={styles.thumbnailImage}>
                  <PdfPageSurface
                    pdf={pdf}
                    page={index + 1}
                    width={112}
                    zoom={100}
                    aspect={aspect}
                    root={thumbs}
                    thumbnail
                  />
                  {page === index + 1 && (
                    <span
                      className={styles.thumbnailVisible}
                      style={{
                        top: `${visiblePart.top * 100}%`,
                        height: `${Math.max(0.04, visiblePart.height) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <span>
                  {knowledgeT('page')}
                  {index + 1} {knowledgeT('page2')}
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <div
        ref={viewport}
        className={styles.pdfViewport}
        tabIndex={0}
        aria-label={knowledgeT('continuouslyScrollingPdf')}
        onScroll={() => {
          setSelection(null);
          trackPage();
        }}
        onPointerUp={() => {
          if (comments?.canComment && viewport.current)
            setSelection(readPdfSelection(viewport.current, comments.assetHash));
        }}
        onKeyUp={() => {
          if (comments?.canComment && viewport.current)
            setSelection(readPdfSelection(viewport.current, comments.assetHash));
        }}
        onClick={(event) => {
          if (!comments || !window.getSelection()?.isCollapsed) return;
          const element = (event.target as HTMLElement).closest<HTMLElement>('[data-pdf-page]');
          if (!element) return;
          const box = element.getBoundingClientRect(),
            x = (event.clientX - box.left) / box.width,
            y = (event.clientY - box.top) / box.height;
          const highlight = comments.highlights.find((item) =>
            item.anchor.pages.some(
              (part) =>
                part.page === Number(element.dataset.pdfPage) &&
                part.rects.some(
                  (rect) =>
                    x >= rect.x &&
                    x <= rect.x + rect.width &&
                    y >= rect.y &&
                    y <= rect.y + rect.height,
                ),
            ),
          );
          if (highlight) comments.onSelect(highlight.id);
        }}
      >
        {error ? (
          <div role="alert" className={styles.state}>
            {error}
          </div>
        ) : !pdf ? (
          <div role="status" className={styles.state}>
            {knowledgeT('readingPdf')}
          </div>
        ) : (
          <div className={styles.pdfPages}>
            {Array.from({ length: pdf.numPages }, (_, index) => index + 1).map((number) => (
              <PdfPageSurface
                key={number}
                pdf={pdf}
                page={number}
                width={width}
                zoom={zoom}
                aspect={aspect}
                root={viewport}
                highlights={comments?.highlights}
                activeThreadId={comments?.activeThreadId}
                onSelect={comments?.onSelect}
              />
            ))}
          </div>
        )}
      </div>
      {selection &&
        comments?.canComment &&
        createPortal(
          <button
            className={styles.pdfSelectionAction}
            aria-label={knowledgeT('commentOnSelectedPdfText')}
            style={selection.button}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              comments.onCompose(selection);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <ChatCircleDots size={14} />
            {knowledgeT('comments')}
          </button>,
          getOverlayRoot() ?? document.body,
        )}
    </div>
  );
}
