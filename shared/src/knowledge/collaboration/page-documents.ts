import { entityIdSchema } from '../contracts/primitives';
import type { PageScope } from '../contracts/primitives';

const prefix = 'page:';

/**
 * Page documents are the only names the collaboration server accepts
 * (B01's upgrade gate); knowledge base event channels and any other namespace are
 * rejected. The single source of this format lives here so the web client
 * (B04) and the server assembly name identical documents.
 */
export function pageDocumentName(scope: PageScope): string {
  return `${prefix}${scope.knowledgeBaseId}:${scope.pageId}`;
}

export function parsePageDocument(documentName: string): PageScope | undefined {
  if (!documentName.startsWith(prefix)) return undefined;
  const separator = documentName.indexOf(':', prefix.length);
  if (separator < 0) return undefined;
  const knowledgeBaseId = documentName.slice(prefix.length, separator);
  const pageId = documentName.slice(separator + 1);
  if (entityIdSchema.safeParse(knowledgeBaseId).success && entityIdSchema.safeParse(pageId).success) {
    return { knowledgeBaseId, pageId };
  }
  return undefined;
}
