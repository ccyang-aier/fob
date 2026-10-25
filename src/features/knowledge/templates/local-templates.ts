import { materializeKnowledgeTemplateDocument, type KnowledgeTemplateDetail, type KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import type { LocalDocument } from '../local/local-library';
import { newLocalDocument } from '../local/local-library';

export const localTemplatesKey = 'fob.local-templates';
export type LocalTemplate = KnowledgeTemplateDetail;
export const emptyTemplates: LocalTemplate[] = [];

export function createLocalTemplatesStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let snapshot = JSON.parse(storage.getItem(localTemplatesKey) ?? '[]') as LocalTemplate[];
  if (!Array.isArray(snapshot)) throw new TypeError('Invalid template catalog');
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(change: (templates: LocalTemplate[]) => LocalTemplate[]) {
      const next = change(snapshot);
      storage.setItem(localTemplatesKey, JSON.stringify(next));
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

export function localTemplateSnapshot(document: LocalDocument, name: string, description: string, body = document.body): LocalTemplate {
  if (document.deleted || document.file || body.type !== 'doc' || !name.trim()) throw new TypeError('Template requires a live text document');
  const now = new Date().toISOString();
  const template: KnowledgeTemplateSummary = { id: crypto.randomUUID(), knowledgeBaseId: document.baseId, sourcePageId: document.id, name: name.trim(), description: description.trim(), title: document.title, icon: document.icon ?? null, createdBy: 'local', createdAt: now, updatedAt: now, canManage: true };
  return { template, document: structuredClone(body) };
}

/** Each use owns its own body; no mutable source document or editor state is shared. */
export function localDocumentFromTemplate(detail: LocalTemplate, knowledgeBaseId: string, title: string, folderId?: string): LocalDocument {
  if (detail.template.knowledgeBaseId !== knowledgeBaseId) throw new TypeError('Template belongs to another knowledge base');
  return { ...newLocalDocument(knowledgeBaseId, title || detail.template.title), icon: detail.template.icon, folderId, body: materializeKnowledgeTemplateDocument(detail.document) };
}
