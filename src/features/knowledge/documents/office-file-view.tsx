'use client';
import { useUiMessage } from '../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './office-file-view.messages';
import { useEffect, useRef, useState } from 'react';
import type { PptxViewer } from '@aiden0z/pptx-renderer';
import styles from './file-preview.module.css';

const frameHtml =
  '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:system-ui;background:#f5f6f8}#content{min-height:100vh;padding:28px}section.docx{margin:0 auto 24px!important;box-shadow:0 1px 5px #19233416!important;max-width:100%!important}a{pointer-events:none}.docx-wrapper{padding:0!important;background:transparent!important}</style></head><body><main id="content"></main></body></html>';

export function OfficeFileView({
  blob,
  format,
  page,
  zoom,
  onPages,
}: {
  blob: Blob;
  format: 'pptx' | 'docx';
  page: number;
  zoom: number;
  onPages: (pages: number) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const frame = useRef<HTMLIFrameElement>(null);
  const viewer = useRef<PptxViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useUiMessage(knowledgeMessages, '');
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const controller = new AbortController();
    const container = frame.current!.contentDocument!.getElementById('content')!;
    container.replaceChildren();
    void (async () => {
      const bytes = await blob.arrayBuffer();
      if (cancelled) return;
      if (format === 'pptx') {
        container.style.cssText =
          'margin:28px;width:calc(100% - 56px);padding:0;min-height:calc(100vh - 56px)';
        const renderer = await import('@aiden0z/pptx-renderer/browser');
        const instance = await renderer.PptxViewer.open(bytes, container, {
          renderMode: 'slide',
          fitMode: 'contain',
          lazyMedia: true,
          lazySlides: true,
          zipLimits: renderer.RECOMMENDED_ZIP_LIMITS,
          signal: controller.signal,
        });
        if (cancelled) {
          instance.destroy();
          return;
        }
        viewer.current = instance;
        onPages(instance.slideCount);
      } else {
        const renderer = await import('docx-preview');
        await renderer.renderAsync(bytes, container, undefined, {
          useBase64URL: true,
          renderAltChunks: false,
          renderComments: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (cancelled) {
          container.replaceChildren();
          return;
        }
        onPages(container.querySelectorAll('section.docx').length || 1);
      }
      setLoaded(true);
    })().catch(() => {
      if (!cancelled) setError({ key: 'unableToParseDocumentCheckTheOriginalFile' });
    });
    return () => {
      cancelled = true;
      controller.abort();
      viewer.current?.destroy();
      viewer.current = null;
      container.replaceChildren();
    };
    // The owner keeps the same reporting callback for this mounted file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, format, ready]);
  useEffect(() => {
    if (!loaded) return;
    if (viewer.current)
      void viewer.current
        .goToSlide(page - 1)
        .catch(() => setError({ key: 'unableToRenderSlidesOpenTheFileAgain' }));
    else
      frame.current?.contentDocument
        ?.querySelectorAll('section.docx')
        [page - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [page, loaded, setError]);
  useEffect(() => {
    if (!loaded) return;
    if (viewer.current)
      void viewer.current.setZoom(zoom).catch(() => setError({ key: 'unableToChangeZoom' }));
    else {
      const container = frame.current?.contentDocument?.getElementById('content');
      if (container) container.style.zoom = `${zoom}%`;
    }
  }, [zoom, loaded, setError]);
  return (
    <div className={styles.office}>
      {(!loaded || error) && (
        <div className={styles.renderStatus} role={error ? 'alert' : 'status'}>
          {error || knowledgeT('layingOutDocument')}
        </div>
      )}
      <iframe
        ref={frame}
        title={
          format === 'pptx'
            ? knowledgeT('powerpointSlidePreview')
            : knowledgeT('wordDocumentPreview')
        }
        sandbox="allow-same-origin"
        srcDoc={frameHtml}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
