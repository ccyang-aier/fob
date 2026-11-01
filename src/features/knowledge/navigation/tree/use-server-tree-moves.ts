'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Page } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { knowledgeCatalogClient } from '../../data/knowledge-catalog-client';
import { moveKnowledgePage, transferKnowledgePage } from '../../data/pages-api';
import { knowledgeQueryKeys } from '../../data/query-keys';
import { isKnowledgeDataError, KnowledgeDataError } from '../../data/errors';
import { organizationQueryKeys } from '../../organization/keys';
import { isOrganizationDataError, organizationErrorTextOf } from '../../organization/errors';
import type { TreeMove } from './tree-drop-policy';
import { messages } from './tree-drag.messages';

export function useServerTreeMoves(knowledgeBaseId: string, pages: readonly Page[]) {
  const client = useQueryClient(), { t } = useTranslation(messages);
  const move = useCallback(async (placement: TreeMove) => {
    if (placement.kind === 'folder') await knowledgeCatalogClient.moveTeamspace(knowledgeBaseId, placement.id, placement.parentId);
    else {
      const page = pages.find(page => page.id === placement.id && page.deletedAt === null);
      if (!page) throw new KnowledgeDataError('NOT_FOUND');
      if (page.teamspaceId === placement.folderId) await moveKnowledgePage(knowledgeBaseId, { pageId: page.id, teamspaceId: placement.folderId, parentId: null, afterPageId: null, operationId: crypto.randomUUID() });
      else await transferKnowledgePage(knowledgeBaseId, { pageId: page.id, targetTeamspaceId: placement.folderId });
    }
    await Promise.all([
      client.invalidateQueries({ queryKey: organizationQueryKeys.teamspaces(knowledgeBaseId) }),
      client.invalidateQueries({ queryKey: knowledgeQueryKeys.pages(knowledgeBaseId) }),
    ]);
  }, [client, knowledgeBaseId, pages]);
  const errorText = (error: unknown) => {
    if (isOrganizationDataError(error)) return organizationErrorTextOf(error);
    if (isKnowledgeDataError(error) && error.code === 'FORBIDDEN') return t('permission');
    if (isKnowledgeDataError(error) && error.code === 'NOT_FOUND') return t('missing');
    return t('failed');
  };
  return { move, errorText };
}
