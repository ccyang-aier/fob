// Deliberately type-only: U01 may import this file without bundling backend/auth/PostgreSQL code.
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { KnowledgeApiRouter } from './router';

export type { KnowledgeApiRouter };
export type KnowledgeApiInputs = inferRouterInputs<KnowledgeApiRouter>;
export type KnowledgeApiOutputs = inferRouterOutputs<KnowledgeApiRouter>;
