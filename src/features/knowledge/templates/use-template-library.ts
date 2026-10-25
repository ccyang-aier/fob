'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { useLocalLibrary } from '../local/use-local-library';
import { templatesApi } from './client';
import { localDocumentFromTemplate, localTemplateSnapshot } from './local-templates';
import { useLocalTemplates } from './use-local-templates';
import { usePageVisible } from '@/lib/page-visibility';

export function useTemplateLibrary(q = '') {
  const { selectedKnowledgeBase: base, principal } = useKnowledgeBaseResources();
  const local = useLocalTemplates();
  const visible = usePageVisible();
  const library = useLocalLibrary();
  const queryClient = useQueryClient();
  const key = ['knowledge', base?.id, 'templates', principal];
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent).detail === base?.id) { void queryClient.invalidateQueries({ queryKey: ['knowledge', base?.id, 'templates', principal] }); void queryClient.invalidateQueries({ queryKey: ['knowledge', base?.id, 'template-detail'] }); } };
    window.addEventListener('fob:templates-changed', changed);
    return () => window.removeEventListener('fob:templates-changed', changed);
  }, [base?.id, principal, queryClient]);
  const query = useInfiniteQuery({ queryKey: [...key, q], queryFn: ({ pageParam, signal }) => templatesApi.list(base!.id, q, pageParam, signal), initialPageParam: null as string | null, getNextPageParam: page => page.nextCursor, enabled: base?.source === 'server' && visible });
  const items = base?.source === 'local' ? local.templates.filter(item => item.template.knowledgeBaseId === base.id && `${item.template.name} ${item.template.description}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())).map(item => item.template) : query.data?.pages.flatMap(page => page.items) ?? [];
  async function refresh() { window.dispatchEvent(new CustomEvent('fob:templates-changed', { detail: base?.id })); await queryClient.invalidateQueries({ queryKey: key }); }
  async function save(sourcePageId: string, name: string, description: string, body?: JSONContent) {
    if (!base) throw new Error('Knowledge base required');
    if (base.source === 'server') { const result = await templatesApi.save(base.id, { sourcePageId, name, description, document: body }); await refresh(); return result; }
    const document = library.store?.getSnapshot().documents.find(item => item.id === sourcePageId && item.baseId === base.id);
    if (!document || !local.store) throw new Error('Document unavailable');
    const result = localTemplateSnapshot(document, name, description, body);
    local.store.update(current => [result, ...current]);
    return result.template;
  }
  function localDetail(id: string) {
    const detail = local.store?.getSnapshot().find(item => item.template.id === id && item.template.knowledgeBaseId === base?.id);
    if (!detail) throw new Error('Template unavailable');
    return detail;
  }
  async function detail(id: string) { return base?.source === 'server' ? templatesApi.detail(base.id, id) : localDetail(id); }
  async function update(id: string, values: { name: string; description: string }) {
    if (base?.source === 'server') { await templatesApi.update(base.id, id, values); await refresh(); }
    else { localDetail(id); local.store!.update(items => items.map(item => item.template.id === id && item.template.knowledgeBaseId === base?.id ? { ...item, template: { ...item.template, ...values, updatedAt: new Date().toISOString() } } : item)); await refresh(); }
  }
  async function remove(id: string) {
    if (base?.source === 'server') { await templatesApi.remove(base.id, id); await refresh(); }
    else { localDetail(id); local.store!.update(items => items.filter(item => item.template.id !== id || item.template.knowledgeBaseId !== base?.id)); await refresh(); }
  }
  async function apply(template: KnowledgeTemplateSummary, title: string, folderId: string) {
    if (!base || template.knowledgeBaseId !== base.id) throw new Error('Template unavailable');
    if (base.source === 'server') { const result = await templatesApi.apply(base.id, template.id, { id: crypto.randomUUID(), title, teamspaceId: folderId }); return result.pageId; }
    const document = localDocumentFromTemplate(localDetail(template.id), base.id, title, folderId || undefined);
    library.store!.update(current => {
      if (!current.bases.some(item => item.id === base.id) || (folderId && !current.folders.some(folder => folder.id === folderId && folder.knowledgeBaseId === base.id))) throw new Error('Folder unavailable');
      return { ...current, documents: [document, ...current.documents] };
    });
    return document.id;
  }
  return { base, items, query, error: base?.source === 'local' ? local.error || library.error : query.error, loading: base?.source === 'server' && query.isPending, save, detail, update, remove, apply, refresh };
}
