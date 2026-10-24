export type PageErrorCode =
  | 'INVALID_PAGE_INPUT'
  | 'PAGE_NOT_FOUND'
  | 'INVALID_PAGE_PARENT'
  | 'INVALID_PAGE_PLACEMENT'
  | 'INVALID_PAGE_MOVE';

/** 内部服务错误:HTTP 鉴权/授权与 actor 上下文属于 P03。 */
export class KnowledgePageError extends Error {
  constructor(readonly code: PageErrorCode) {
    super(`Knowledge page-tree operation failed: ${code}`);
    this.name = 'KnowledgePageError';
  }
}
