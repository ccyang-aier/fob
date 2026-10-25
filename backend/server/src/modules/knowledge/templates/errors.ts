export class KnowledgeTemplateError extends Error {
  constructor(readonly code: 'TEMPLATE_NOT_FOUND' | 'TEMPLATE_ASSET_UNAVAILABLE' | 'TEMPLATE_REQUIRES_DOCUMENT' | 'PAGE_ALREADY_EXISTS', message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = 'KnowledgeTemplateError';
  }
}
