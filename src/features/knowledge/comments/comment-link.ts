import { documentLink, readDocumentLink, type DocumentLinkTarget } from '../editor/document-link';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';

export function commentLink(location: string, target: DocumentLinkTarget, commentId: string): string {
  const url = new URL(documentLink(location, target));
  url.searchParams.set('comment', commentId);
  return url.href;
}

export function readCommentLink(location: string) {
  const target = readDocumentLink(location);
  const comment = entityIdSchema.safeParse(new URL(location).searchParams.get('comment'));
  return target && comment.success ? { ...target, commentId: comment.data } : null;
}
