import { createMarkdownPipeline } from '../markdown';
import { knowledgeSchema } from '../schema';
import { materializeKnowledgeTemplateDocument } from '../templates/materialize';

export const MAX_TEXT_IMPORT_BYTES = 1024 * 1024;
export type TextDocumentFormat = 'text' | 'markdown';

export function textDocumentFormat(name: string): TextDocumentFormat | null {
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  return /\.(txt|text|log)$/i.test(name) ? 'text' : null;
}

export function textDocumentTitle(name: string) {
  return (name.replace(/\.(txt|text|log|md|markdown)$/i, '').trim() || name).slice(0, 500);
}

/** Imported text uses the same document schema and stable blocks as the editor. */
export function parseTextDocument(source: string, format: TextDocumentFormat) {
  const text = source.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const document = format === 'markdown' ? createMarkdownPipeline().parse(text) : knowledgeSchema.node('doc', null,
    text.split('\n').map(line => knowledgeSchema.node('paragraph', null, line ? [knowledgeSchema.text(line)] : undefined)));
  document.check();
  return knowledgeSchema.nodeFromJSON(materializeKnowledgeTemplateDocument(document.toJSON()));
}
