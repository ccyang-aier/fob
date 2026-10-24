'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './use-page-metadata.messages';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PageScope, Page } from '@fob/shared/knowledge/contracts';
import { updateKnowledgePage } from '../data/pages-api';
import { useKnowledgePagesQuery } from '../data/pages-queries';
import { knowledgeQueryKeys } from '../data/query-keys';

const knowledgeT = createTranslator(knowledgeMessages);

/** The page tree owns metadata; title drafts and icon choices never enter the collaboration document. */
export function usePageMetadata(scope: PageScope) {
  const queryClient = useQueryClient();
  const pages = useKnowledgePagesQuery(scope.knowledgeBaseId);
  const page = pages.data?.find((item) => item.id === scope.pageId);
  const [draft, setDraft] = useState<{ pageId: string; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = draft?.pageId === scope.pageId ? draft.title : (page?.title ?? '');

  const save = async () => {
    if (!page || saving) return;
    const next = title.trim();
    if (next === page.title) {
      setDraft(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateKnowledgePage(scope.knowledgeBaseId, {
        pageId: scope.pageId,
        title: next,
      });
      queryClient.setQueryData<Page[]>(knowledgeQueryKeys.pages(scope.knowledgeBaseId), (current) =>
        current?.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                title: updated.title,
                updatedAt: item.updatedAt > updated.updatedAt ? item.updatedAt : updated.updatedAt,
              }
            : item,
        ),
      );
      setDraft(null);
    } catch {
      setError(knowledgeT('unableToSaveTitlePleaseRetry'));
    } finally {
      setSaving(false);
    }
  };

  return {
    title: page ? title : pages.isPending ? knowledgeT('loadingTitle') : '',
    loaded: Boolean(page),
    fetchError: pages.isError || (pages.isSuccess && !page),
    updatedAt: page?.updatedAt,
    icon: page?.icon,
    saveIcon: async (icon: string | null) => {
      if (!page) throw new Error('Page metadata unavailable');
      const updated = await updateKnowledgePage(scope.knowledgeBaseId, {
        pageId: scope.pageId,
        icon,
      });
      queryClient.setQueryData<Page[]>(knowledgeQueryKeys.pages(scope.knowledgeBaseId), (current) =>
        current?.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                icon: updated.icon,
                updatedAt: item.updatedAt > updated.updatedAt ? item.updatedAt : updated.updatedAt,
              }
            : item,
        ),
      );
    },
    saving,
    error,
    setTitle: (value: string) => setDraft({ pageId: scope.pageId, title: value }),
    save,
  };
}
