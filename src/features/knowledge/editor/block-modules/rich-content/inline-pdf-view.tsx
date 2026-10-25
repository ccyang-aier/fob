'use client';

import dynamic from 'next/dynamic';
import { useEffect, useId, useRef, useState } from 'react';
import { CaretLeft, CaretRight, ArrowsOut, DownloadSimple } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import { RichContentLoading } from './loading-state';
import styles from './rich-content.module.css';

const Reader = dynamic(() => import('../../../documents/pdf-file-view').then(module => module.PdfFileView), { ssr: false, loading: RichContentLoading });

export function InlinePdfView({ url, title, height = 520 }: { url: string; title: string; height?: number }) {
  const { t } = useTranslation(richMessages);
  const [loaded, setLoaded] = useState<{ url: string; blob: Blob | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0), [page, setPage] = useState(1), [pages, setPages] = useState(0), [zoom, setZoom] = useState(100), [fullscreenError, setFullscreenError] = useState(false);
  const root = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error('PDF_UNAVAILABLE');
      const blob = await response.blob();
      if (!controller.signal.aborted) setLoaded({ url, blob, failed: false });
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ url, blob: null, failed: true }); });
    return () => controller.abort();
  }, [url, attempt]);
  const result = loaded?.url === url ? loaded : null;
  return <div ref={root} className={styles.pdf} style={{ height }} contentEditable={false}>
    <div className={styles.pdfTools} data-document-export-omit role="toolbar" aria-label={t('pdf')}>
      <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t('previous')} disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><CaretLeft size={16} aria-hidden /></button>
      <input className={styles.pageInput} type="number" min={1} max={pages || 1} aria-label={t('page')} value={page} onChange={event => setPage(Math.max(1, Math.min(pages || 1, Number(event.target.value) || 1)))} />
      <span aria-label={`${page} / ${pages}`}>/ {pages || '…'}</span>
      <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t('next')} disabled={!pages || page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}><CaretRight size={16} aria-hidden /></button>
      <select aria-label={t('zoom')} value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[50, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select>
      <a className={`fob-action ${styles.iconButton}`} data-surface="plain" href={url} download={title} aria-label={t('download')} title={t('download')}><DownloadSimple size={16} aria-hidden /></a>
      <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t('fullscreen')} title={t('fullscreen')} onClick={() => { void root.current?.requestFullscreen().catch(() => setFullscreenError(true)); }}><ArrowsOut size={16} aria-hidden /></button>
    </div>
    {fullscreenError && <div className={styles.error} role="alert" data-document-export-omit>{t('fullscreenError')}</div>}
    <div className={styles.pdfReader}>
      {result?.failed ? <div className={styles.state} role="alert">{t('pdfError')}<button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button><a href={url} target="_blank" rel="noopener noreferrer">{t('open')}</a></div>
        : !result?.blob ? <div className={styles.state} role="status">{t('loading')}</div>
        : <Reader blob={result.blob} page={page} zoom={zoom} thumbnails={false} thumbnailsId={id} onThumbnailsChange={() => undefined} onPages={setPages} onPageChange={setPage} onZoomChange={setZoom} />}
    </div>
    <a href={url} download={title} className={styles.footer}>{title || 'PDF'}</a>
  </div>;
}
