import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './history-api.messages';

/**
 * History panel API client (V03): the checkpoint surface is a plain session
 * route (`/api/knowledge/:ws/pages/:page/checkpoints`), not tRPC — the same
 * native-fetch seam as the organization client. P03 is enforced per request
 * server-side; the client maps failures to the structured data-layer codes.
 */

import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { KnowledgeDataError } from '../data/errors';

const knowledgeT = createTranslator(knowledgeMessages);

export interface PageCheckpointEntry {
  checkpointId: string;
  pageId: string;
  label: string | null;
  authors: string[];
  createdAt: string;
}

export interface PageCheckpointPreview extends PageCheckpointEntry {
  /** ProseMirror document JSON of the checkpointed body. */
  body: unknown;
}

export type NamedCheckpointResult = { outcome: 'created' | 'labeled'; checkpointId: string };

export type HistoryApiDeps = {
  resolveOrigin: () => Promise<{ origin: string }>;
  fetchImpl: typeof fetch;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Minimal shape check: the panel never renders an unvalidated body. */
export function parseCheckpointList(body: unknown): PageCheckpointEntry[] {
  if (!isRecord(body) || !Array.isArray(body.checkpoints)) return [];
  return body.checkpoints.flatMap((entry): PageCheckpointEntry[] => {
    if (
      !isRecord(entry) ||
      typeof entry.checkpointId !== 'string' ||
      typeof entry.createdAt !== 'string'
    )
      return [];
    if (entry.label !== null && typeof entry.label !== 'string') return [];
    if (!Array.isArray(entry.authors) || entry.authors.some((author) => typeof author !== 'string'))
      return [];
    return [
      {
        checkpointId: entry.checkpointId,
        pageId: String(entry.pageId ?? ''),
        label: entry.label as string | null,
        authors: entry.authors as string[],
        createdAt: entry.createdAt,
      },
    ];
  });
}

export function createHistoryApi(
  deps: HistoryApiDeps = { resolveOrigin: getFobApiOrigin, fetchImpl: authenticatedFetch },
) {
  async function request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const { origin } = await deps.resolveOrigin();
    const response = await deps.fetchImpl(`${origin}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      const code = await response
        .json()
        .then((payload) =>
          isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined,
        )
        .catch(() => undefined);
      throw new KnowledgeDataError(
        response.status === 404
          ? 'NOT_FOUND'
          : response.status === 403
            ? 'FORBIDDEN'
            : 'UNAVAILABLE',
        {
          message: code
            ? knowledgeT('versionHistoryRequestFailedValue', { v0: code })
            : knowledgeT('versionHistoryRequestFailed'),
        },
      );
    }
    return (await response.json()) as T;
  }
  const base = (knowledgeBaseId: string, pageId: string) =>
    `/api/knowledge/${knowledgeBaseId}/pages/${pageId}/checkpoints`;
  return {
    list(knowledgeBaseId: string, pageId: string): Promise<{ checkpoints: PageCheckpointEntry[] }> {
      return request<unknown>(base(knowledgeBaseId, pageId)).then((payload) => ({
        checkpoints: parseCheckpointList(payload),
      }));
    },
    preview(
      knowledgeBaseId: string,
      pageId: string,
      checkpointId: string,
    ): Promise<PageCheckpointPreview> {
      return request<PageCheckpointPreview>(`${base(knowledgeBaseId, pageId)}/${checkpointId}`);
    },
    name(knowledgeBaseId: string, pageId: string, label: string): Promise<NamedCheckpointResult> {
      return request<NamedCheckpointResult>(base(knowledgeBaseId, pageId), {
        method: 'POST',
        body: { label },
      });
    },
  };
}

export type HistoryApi = ReturnType<typeof createHistoryApi>;
