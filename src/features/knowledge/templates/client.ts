'use client';

import { knowledgeTemplateDetailSchema, knowledgeTemplateListResultSchema, knowledgeTemplateSummarySchema } from '@fob/shared/knowledge/templates';
import { pagePlacementSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeResourceRequest } from '../data/resource-http';
import type { JSONContent } from '@tiptap/core';

export const templatesApi = {
  list: (base: string, q: string, cursor: string | null, signal?: AbortSignal) => knowledgeResourceRequest(base, `templates?${new URLSearchParams({ q, limit: '40', ...(cursor ? { cursor } : {}) })}`, knowledgeTemplateListResultSchema, { signal }),
  detail: (base: string, id: string, signal?: AbortSignal) => knowledgeResourceRequest(base, `templates/${id}`, knowledgeTemplateDetailSchema, { signal }),
  save: (base: string, input: { sourcePageId: string; name: string; description: string; document?: JSONContent }) => knowledgeResourceRequest(base, 'templates', knowledgeTemplateSummarySchema, { method: 'POST', body: JSON.stringify(input) }),
  update: (base: string, id: string, input: { name: string; description: string }) => knowledgeResourceRequest(base, `templates/${id}`, knowledgeTemplateSummarySchema, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (base: string, id: string) => knowledgeResourceRequest(base, `templates/${id}`, { parse: () => undefined }, { method: 'DELETE', body: '{}' }),
  apply: (base: string, id: string, input: { id: string; teamspaceId: string; title: string }) => knowledgeResourceRequest(base, `templates/${id}/pages`, pagePlacementSchema, { method: 'POST', body: JSON.stringify(input) }),
};
