'use client';
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { createHistoryApi, type HistoryApi } from './history-api';
import { checkpointBodyToNode } from './restore';

const defaultApi = createHistoryApi();
export function useDocumentVersion(scope: PageScope, api: HistoryApi = defaultApi) {
  const scopeKey = `${scope.knowledgeBaseId}:${scope.pageId}`;
  const [selection, setSelection] = useState<{ scopeKey: string; id: string } | null>(null);
  const [mounted, setMounted] = useState<{ id: string; editor: Editor } | null>(null);
  const selectedId = selection?.scopeKey === scopeKey ? selection.id : null;
  const select = useCallback((id: string | null) => setSelection(id ? { scopeKey, id } : null), [scopeKey]);
  const bindEditor = useCallback((id: string, editor: Editor | null) => {
    setMounted(previous => editor ? { id, editor } : previous?.id === id ? null : previous);
  }, []);
  const preview = useQuery({ queryKey: [scope.knowledgeBaseId, 'history', scope.pageId, 'document', selectedId], enabled: !!selectedId,
    queryFn: async ({ signal }) => {
      const result = await api.preview(scope.knowledgeBaseId, scope.pageId, selectedId!, signal);
      const body = checkpointBodyToNode(result.body, knowledgeSchema);
      if (!body || result.checkpointId !== selectedId || result.pageId !== scope.pageId) throw new Error('Version unavailable');
      body.check();
      return { ...result, body: body.toJSON() };
    },
  });
  return { selectedId, select, bindEditor, preview, editor: mounted?.id === selectedId ? mounted.editor : null };
}
