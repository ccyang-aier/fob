import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './document-pdf-export.messages';

import type { Editor } from '@tiptap/core';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { exportDocumentHtml } from './document-html-export';
import { downloadDocumentBlob } from './document-content-actions';

const knowledgeT = createTranslator(knowledgeMessages);

function errors(locale?: Locale): Record<string, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    PDF_BUSY: knowledgeT('exportServiceIsBusyRetryLater'),
    PDF_UNAVAILABLE: knowledgeT('pdfRenderingServiceUnavailableRetryLater'),
    PAYLOAD_TOO_LARGE: knowledgeT('documentAssetsAreTooLargeToExportAs'),
  };
}

/** Native paged PDF, using exactly the same live presentation as the HTML snapshot. */
export async function exportDocumentPdf(editor: Editor, title: string) {
  const html = await exportDocumentHtml(editor, title);
  const { origin } = await getFobApiOrigin();
  let response: Response;
  try {
    response = await fetch(`${origin}/api/knowledge/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html;charset=utf-8' },
      body: html,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? knowledgeT('pdfExportIsTakingTooLongRetryLater')
        : knowledgeT('unableToConnectToPdfExportServiceCheck'),
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(errors()[body?.code ?? ''] ?? knowledgeT('unableToExportPdfRetryLater'));
  }
  if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf')
    throw new Error(knowledgeT('invalidPdfResponsePleaseRetry'));
  const blob = await response.blob();
  if ((await blob.slice(0, 5).text()) !== '%PDF-')
    throw new Error(knowledgeT('unableToGeneratePdfPleaseRetry'));
  downloadDocumentBlob(blob, title, 'pdf');
}
