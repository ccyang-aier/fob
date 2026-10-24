import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './document-content-actions.messages';

import type { Editor } from '@tiptap/core';
import { exportDocumentHtml } from './document-html-export';

const knowledgeT = createTranslator(knowledgeMessages);

export type ContentFormat = 'text' | 'markdown' | 'html';

/** Reads the live editor on demand; it never writes a second copy of the body. */
export async function documentContent(
  editor: Editor,
  title: string,
  format: ContentFormat,
): Promise<string> {
  const name = title.trim() || knowledgeT('untitledDocument');
  if (format === 'text') return `${name}\n\n${editor.getText({ blockSeparator: '\n' })}`;
  if (format === 'markdown') {
    const { exportDocumentMarkdown } = await import('./document-markdown-export');
    return exportDocumentMarkdown(editor.state.doc, name);
  }
  return exportDocumentHtml(editor, name);
}

export function downloadDocument(content: string, title: string, format: 'markdown' | 'html') {
  downloadDocumentBlob(
    new Blob([content], {
      type: format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8',
    }),
    title,
    format === 'html' ? 'html' : 'md',
  );
}

export function downloadDocumentBlob(blob: Blob, title: string, extension: 'md' | 'html' | 'pdf') {
  const filename =
    (title.trim() || knowledgeT('untitledDocument'))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 120) || knowledgeT('document');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Isolated, script-free snapshot: the knowledgeBase chrome and editing controls are excluded. */
export function printDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.title = knowledgeT('printDocument');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:830px;height:1000px;border:0';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    const timeout = setTimeout(() => {
      frame.remove();
      reject(new Error('print-timeout'));
    }, 15000);
    frame.onload = async () => {
      try {
        await frame.contentDocument?.fonts.ready;
        const target = frame.contentWindow;
        if (!target) throw new Error('print-unavailable');
        clearTimeout(timeout);
        target.addEventListener('afterprint', () => frame.remove(), { once: true });
        target.focus();
        target.print();
        resolve();
      } catch (error) {
        clearTimeout(timeout);
        frame.remove();
        reject(error);
      }
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}
