export type CommentErrorCode =
  | 'INVALID_COMMENT_INPUT'
  | 'COMMENT_ACCESS_DENIED'
  | 'COMMENT_THREAD_NOT_FOUND'
  | 'COMMENT_NOT_FOUND';

/** Internal service errors: HTTP authentication/authorization folding belongs to the API layer. */
export class KnowledgeCommentError extends Error {
  constructor(readonly code: CommentErrorCode) {
    super(`Knowledge comment operation failed: ${code}`);
    this.name = 'KnowledgeCommentError';
  }
}
