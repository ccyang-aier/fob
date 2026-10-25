'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './pages-api.messages';

/**
 * Page-tree client surface (U03) on the U01 tRPC transport.
 *
 * The shared contracts own every input shape (`listPagesInputSchema`,
 * `createPageInputSchema`, …) and every output shape (`pageSchema`,
 * `pagePlacementSchema`, `pageLifecycleStateSchema`). The backend page router
 * serves these procedures through the authenticated knowledgeBase transport.
 *
 * The calls go through the tRPC client's dynamic `query`/`mutate` entry points and every
 * response is re-validated with the shared zod schemas at the boundary: the
 * type safety here comes from the contracts, not from trust in the wire.
 * Tests inject the transport through the same factory seam the organization
 * client uses (origin resolver + fetch implementation).
 */

import {
  createPageInputSchema,
  movePageInputSchema,
  pageLifecycleStateSchema,
  pagePlacementSchema,
  pageSchema,
  recyclePageInputSchema,
  restorePageInputSchema,
  updatePageInputSchema,
  transferPageInputSchema,
} from '@fob/shared/knowledge/contracts';
import type {
  CreatePageInput,
  Page,
  PageLifecycleState,
  PagePlacement,
} from '@fob/shared/knowledge/contracts';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { KnowledgeDataError, normalizeKnowledgeError } from './errors';
import {
  createKnowledgeUntypedClientCache,
  type KnowledgeFetch,
  type KnowledgeUntypedTrpcClient,
} from './trpc-client';

const knowledgeT = createTranslator(knowledgeMessages);

// The shared barrel re-exports the zod schemas as values, so the page surface
// validates at runtime through the very contracts the server enforces —
// without adding zod to the browser bundle as a direct dependency.
const pageListResultSchema = pageSchema.array();

/** A response the shared contracts reject is an unavailable service, never data to render. */
function parsePagePayload<T>(
  schema: { safeParse(payload: unknown): { success: true; data: T } | { success: false } },
  payload: unknown,
  procedure: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new KnowledgeDataError('UNAVAILABLE', {
      message: knowledgeT('invalidResponseFromPageTreeServiceValue', { v0: procedure }),
    });
  }
  return parsed.data;
}

/** The shared input schemas mirror client-side: a programmer error fails fast as INVALID_REQUEST. */
function assertPageInput(
  schema: { safeParse(payload: unknown): { success: true } | { success: false } },
  input: unknown,
  procedure: string,
): void {
  if (!schema.safeParse(input).success) {
    throw new KnowledgeDataError('INVALID_REQUEST', {
      message: knowledgeT('invalidPageTreeInputForValue', { v0: procedure }),
    });
  }
}

export type ListKnowledgePagesInput = { teamspaceId?: string; parentId?: string | null };

export type CreateKnowledgePageInput = CreatePageInput;
/** Mirror of `updatePageInputSchema` (the shared barrel exports no inferred type for it). */
export type UpdateKnowledgePageInput = {
  pageId: string;
  title?: string;
  icon?: string | null;
  cover?: string | null;
  properties?: Page['properties'];
};
export type RecycleKnowledgePageInput = { pageId: string };
export type TransferKnowledgePageInput = { pageId: string; targetTeamspaceId: string };
export type RestoreKnowledgePageInput = { pageId: string };
export type MoveKnowledgePageInput = {
  pageId: string;
  parentId: string | null;
  teamspaceId: string;
  afterPageId: string | null;
  operationId: string;
};

export type KnowledgePagesApi = {
  transferPage(knowledgeBaseId: string, input: TransferKnowledgePageInput, signal?: AbortSignal): Promise<PagePlacement>;
  listPages(
    knowledgeBaseId: string,
    input?: ListKnowledgePagesInput,
    signal?: AbortSignal,
  ): Promise<Page[]>;
  createPage(
    knowledgeBaseId: string,
    input: CreateKnowledgePageInput,
    signal?: AbortSignal,
  ): Promise<PagePlacement>;
  updatePage(
    knowledgeBaseId: string,
    input: UpdateKnowledgePageInput,
    signal?: AbortSignal,
  ): Promise<Page>;
  movePage(
    knowledgeBaseId: string,
    input: MoveKnowledgePageInput,
    signal?: AbortSignal,
  ): Promise<PagePlacement>;
  recyclePage(
    knowledgeBaseId: string,
    input: RecycleKnowledgePageInput,
    signal?: AbortSignal,
  ): Promise<PageLifecycleState>;
  restorePage(
    knowledgeBaseId: string,
    input: RestoreKnowledgePageInput,
    signal?: AbortSignal,
  ): Promise<PageLifecycleState>;
};

/** Builds the page surface over one transport: an origin resolver plus a fetch implementation. */
export function createKnowledgePagesApi(deps: {
  resolveOrigin: () => Promise<string> | string;
  fetchImpl?: KnowledgeFetch;
}): KnowledgePagesApi {
  const cache = createKnowledgeUntypedClientCache(deps.fetchImpl);
  const run = async <T>(
    knowledgeBaseId: string,
    signal: AbortSignal | undefined,
    invoke: (client: KnowledgeUntypedTrpcClient) => Promise<T>,
  ): Promise<T> => {
    try {
      const origin = await deps.resolveOrigin();
      return await invoke(cache.get(origin, knowledgeBaseId));
    } catch (cause) {
      throw normalizeKnowledgeError(cause, signal);
    }
  };

  return {
    async transferPage(knowledgeBaseId, input, signal) {
      assertPageInput(transferPageInputSchema, { ...input, knowledgeBaseId }, 'page.transfer');
      const payload = await run(knowledgeBaseId, signal, client => client.mutation('page.transfer', { knowledgeBaseId, ...input }, { signal }));
      return parsePagePayload(pagePlacementSchema, payload, 'page.transfer');
    },
    async listPages(knowledgeBaseId, input = {}, signal) {
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.query('page.list', { knowledgeBaseId, ...input }, { signal }),
      );
      return parsePagePayload(pageListResultSchema, payload, 'page.list');
    },
    async createPage(knowledgeBaseId, input, signal) {
      assertPageInput(createPageInputSchema, input, 'page.create');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('page.create', input, { signal }),
      );
      return parsePagePayload(pagePlacementSchema, payload, 'page.create');
    },
    async updatePage(knowledgeBaseId, input, signal) {
      assertPageInput(updatePageInputSchema, { ...input, knowledgeBaseId }, 'page.update');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('page.update', { knowledgeBaseId, ...input }, { signal }),
      );
      return parsePagePayload(pageSchema, payload, 'page.update');
    },
    async movePage(knowledgeBaseId, input, signal) {
      assertPageInput(movePageInputSchema, { ...input, knowledgeBaseId }, 'page.move');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('page.move', { knowledgeBaseId, ...input }, { signal }),
      );
      return parsePagePayload(pagePlacementSchema, payload, 'page.move');
    },
    async recyclePage(knowledgeBaseId, input, signal) {
      assertPageInput(recyclePageInputSchema, { ...input, knowledgeBaseId }, 'page.recycle');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('page.recycle', { knowledgeBaseId, ...input }, { signal }),
      );
      return parsePagePayload(pageLifecycleStateSchema, payload, 'page.recycle');
    },
    async restorePage(knowledgeBaseId, input, signal) {
      assertPageInput(restorePageInputSchema, { ...input, knowledgeBaseId }, 'page.restore');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('page.restore', { knowledgeBaseId, ...input }, { signal }),
      );
      return parsePagePayload(pageLifecycleStateSchema, payload, 'page.restore');
    },
  };
}

/** The browser binding: the U01 endpoint resolver plus the global fetch. */
export const knowledgePagesApi = createKnowledgePagesApi({
  resolveOrigin: async () => (await getFobApiOrigin()).origin,
});

// The names the tree operations controller consumes; one module reads as the
// complete page read/write surface.
export const fetchKnowledgePages = knowledgePagesApi.listPages;
export const createKnowledgePage = knowledgePagesApi.createPage;
export const updateKnowledgePage = knowledgePagesApi.updatePage;
export const moveKnowledgePage = knowledgePagesApi.movePage;
export const transferKnowledgePage = knowledgePagesApi.transferPage;
export const recycleKnowledgePage = knowledgePagesApi.recyclePage;
export const restoreKnowledgePage = knowledgePagesApi.restorePage;
