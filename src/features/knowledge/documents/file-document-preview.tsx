'use client';
import { useTranslation } from '@/lib/i18n';
import { useUiMessage } from '../ui-message';
import { knowledgeMessages } from './file-document-preview.messages';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  ArrowsOut,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  FileText,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react';
import type { PdfComments } from './pdf-file-view';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { documentFileFormat, decodeDocumentText, type DocumentFile } from './file-format';
import { readDocumentFile } from './file-source';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TextFileView } from './text-file-view';
import styles from './file-preview.module.css';

const PdfFileView = dynamic(() => import('./pdf-file-view').then((module) => module.PdfFileView), {
  ssr: false,
});
const OfficeFileView = dynamic(
  () => import('./office-file-view').then((module) => module.OfficeFileView),
  { ssr: false },
);

type PreviewProps = {
  knowledgeBaseId: string;
  source: 'local' | 'server';
  file?: DocumentFile;
  name: string;
  attach?: React.ReactNode;
  pdfComments?: PdfComments;
  commentTrigger?: React.ReactNode;
  thumbnails: boolean;
  thumbnailsId: string;
  onThumbnailsChange: (open: boolean) => void;
};
export function FileDocumentPreview(props: PreviewProps) {
  return (
    <FilePreviewSession
      key={`${props.knowledgeBaseId}:${props.source}:${props.file?.source ?? props.name}`}
      {...props}
    />
  );
}
function FilePreviewSession({
  knowledgeBaseId,
  source,
  file,
  name,
  attach,
  pdfComments,
  commentTrigger,
  thumbnails,
  thumbnailsId,
  onThumbnailsChange,
}: PreviewProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const format = documentFileFormat(file?.name ?? name);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [converted, setConverted] = useState<Blob | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useUiMessage(knowledgeMessages, '');
  const [busy, setBusy] = useState(Boolean(file));
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(100);
  const host = useRef<HTMLElement>(null);
  const conversion = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    let objectUrl = '';
    void readDocumentFile(knowledgeBaseId, source, file, controller.signal)
      .then(async (data) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
        setBlob(data);
        if (['text', 'json', 'csv', 'markdown'].includes(format ?? '')) {
          if (data.size > 10 * 1024 * 1024) {
            setError({ key: 'textStructurePreviewsSupportFilesUpTo10' });
            return;
          }
          const content = await decodeDocumentText(data);
          if (!controller.signal.aborted) setText(content);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : { key: 'unableToReadOriginalFile' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      controller.abort();
      conversion.current?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [knowledgeBaseId, source, file, format, retry, setError]);
  async function convertDoc() {
    if (!blob) return;
    conversion.current?.abort();
    const controller = new AbortController();
    conversion.current = controller;
    setBusy(true);
    setError('');
    try {
      const { origin } = await getFobApiOrigin();
      const response = await fetch(`${origin}/api/knowledge/preview/doc`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'application/msword' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(75_000)]),
      });
      if (!response.ok) {
        setError({
          key:
            response.status === 429
              ? 'conversionServiceIsBusyRetryLater'
              : response.status === 413
                ? 'docConversionSupportsFilesUpTo32Mb'
                : 'docConversionFailedCheckTheFileOrDownload',
        });
        return;
      }
      const pdf = await response.blob();
      if ((await pdf.slice(0, 5).text()) !== '%PDF-') {
        setError({ key: 'invalidPreviewResponse' });
        return;
      }
      if (!controller.signal.aborted) setConverted(pdf);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : { key: 'documentConversionFailed' });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const paged = ['pdf', 'pptx', 'docx'].includes(format ?? '') || Boolean(converted);
  const isPdf = format === 'pdf' || Boolean(converted);
  return (
    <section
      ref={host}
      className={styles.viewer}
      aria-label={knowledgeT('filePreview')}
      onKeyDown={(event) => {
        if (!paged || (event.target as HTMLElement).matches('input,textarea')) return;
        if (event.key === 'ArrowRight') setPage((value) => Math.min(pages, value + 1));
        if (event.key === 'ArrowLeft') setPage((value) => Math.max(1, value - 1));
      }}
    >
      <header className={styles.toolbar}>
        <span className={styles.format}>
          {format === 'text' ? 'TXT' : (format ?? knowledgeT('file')).toUpperCase()}
        </span>
        <span className={styles.filename} title={file?.name ?? name}>
          {file?.name ?? name}
        </span>
        {paged && (
          <div className={styles.paging}>
            <button
              aria-label={knowledgeT('previousPage')}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <CaretLeft size={16} />
            </button>
            <input
              aria-label={knowledgeT('previewPageNumber')}
              type="number"
              min={1}
              max={pages}
              value={page}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) setPage(Math.min(pages, Math.max(1, value)));
              }}
            />
            <span>/ {pages}</span>
            <button
              aria-label={knowledgeT('nextPage')}
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <CaretRight size={16} />
            </button>
          </div>
        )}
        {paged && (
          <div className={styles.zoom}>
            <button
              aria-label={knowledgeT('zoomOut')}
              disabled={zoom <= 50}
              onClick={() => setZoom((value) => Math.max(50, value - 10))}
            >
              <MagnifyingGlassMinus size={16} />
            </button>
            <button title={knowledgeT('resetZoom')} onClick={() => setZoom(100)}>
              {zoom}%
            </button>
            <button
              aria-label={knowledgeT('zoomIn')}
              disabled={zoom >= (isPdf ? 300 : 200)}
              onClick={() => setZoom((value) => Math.min(isPdf ? 300 : 200, value + 10))}
            >
              <MagnifyingGlassPlus size={16} />
            </button>
          </div>
        )}
        {commentTrigger}
        <button
          aria-label={knowledgeT('fullScreenPreview')}
          title={knowledgeT('fullScreenPreview')}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else {
              const target = pdfComments
                ? host.current?.closest('[data-knowledge-editor]')
                : host.current;
              void target?.requestFullscreen();
            }
          }}
        >
          <ArrowsOut size={17} />
        </button>
        {url && (
          <a
            href={url}
            download={file?.name ?? name}
            aria-label={knowledgeT('downloadOriginalFile')}
            title={knowledgeT('downloadOriginalFile')}
          >
            <DownloadSimple size={18} />
          </a>
        )}
      </header>
      {!file ? (
        <div className={styles.state}>
          <FileText size={34} weight="duotone" />
          <strong>{knowledgeT('attachAnOriginalFileToPreview')}</strong>
          <p>{knowledgeT('thisRecordOnlyContainsDocumentInformationItsOriginal')}</p>
          {attach}
        </div>
      ) : error ? (
        <div role="alert" className={styles.state}>
          <strong>{knowledgeT('unableToCompletePreview')}</strong>
          <p>{error}</p>
          <button
            onClick={() => {
              setBusy(true);
              setError('');
              setConverted(null);
              setPage(1);
              setPages(1);
              setRetry((value) => value + 1);
            }}
          >
            {knowledgeT('readAgain')}
          </button>
          {attach}
        </div>
      ) : busy ? (
        <div role="status" className={styles.state}>
          {knowledgeT('readingAndLayingOut')}
        </div>
      ) : (
        blob && (
          <div className={styles.content}>
            {isPdf ? (
              <PdfFileView
                blob={converted ?? blob}
                page={page}
                zoom={zoom}
                onPages={setPages}
                onPageChange={setPage}
                onZoomChange={setZoom}
                thumbnails={thumbnails}
                thumbnailsId={thumbnailsId}
                onThumbnailsChange={onThumbnailsChange}
                comments={format === 'pdf' ? pdfComments : undefined}
              />
            ) : format === 'pptx' || format === 'docx' ? (
              <OfficeFileView
                blob={blob}
                format={format}
                page={page}
                zoom={zoom}
                onPages={setPages}
              />
            ) : format === 'markdown' ? (
              <article className={styles.markdown}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </article>
            ) : format === 'csv' || format === 'json' || format === 'text' ? (
              <TextFileView text={text} format={format} />
            ) : format === 'image' ? (
              <div className={styles.image}>
                <Image src={url} alt={file?.name ?? name} width={1600} height={1200} unoptimized />
              </div>
            ) : format === 'doc' ? (
              <div className={styles.state}>
                <FileText size={34} weight="duotone" />
                <strong>{knowledgeT('wordDocument')}</strong>
                <p>
                  {source === 'local'
                    ? knowledgeT('generatingAPreviewSendsThisDocFileTo')
                    : knowledgeT('generateAPaginatedViewPreservingTheOriginalLayout')}
                </p>
                <button onClick={() => void convertDoc()}>{knowledgeT('generatePreview')}</button>
              </div>
            ) : (
              <div className={styles.state}>
                {knowledgeT('previewUnavailableForThisFormatDownloadTheOriginal')}
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
