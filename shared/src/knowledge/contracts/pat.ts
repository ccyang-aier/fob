import { z } from 'zod';
import { entityIdSchema } from './primitives';

/**
 * Personal access token (PAT) contract shared by the backend token service,
 * the MCP authorization server and the management UI. Scopes match credential
 * operations exactly; `write` never implies `read` or administration.
 */
export const knowledgePatScopes = Object.freeze(['read', 'write'] as const);
export type KnowledgePatScope = (typeof knowledgePatScopes)[number];
export const knowledgePatScopeSchema = z.enum(knowledgePatScopes);
export const knowledgePatScopesSchema = z.array(knowledgePatScopeSchema).min(1).max(knowledgePatScopes.length)
  .refine((scopes) => new Set(scopes).size === scopes.length);

/** Plaintext tokens look like `fob_pat.<knowledgeBaseId>.<tokenId>.<secret>`; only this prefix is display-safe. */
export const knowledgePatTokenPrefix = 'fob_pat.';

/** List/create/revoke surface. The plaintext secret is returned exactly once, at creation. */
export interface KnowledgePatSummary {
  readonly knowledgeBaseId: string;
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly KnowledgePatScope[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

export interface KnowledgePatIssued {
  readonly token: string;
  readonly metadata: KnowledgePatSummary;
}

export const createKnowledgePatInputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  name: z.string().trim().min(1).max(120),
  scopes: knowledgePatScopesSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});

export const revokeKnowledgePatInputSchema = z.strictObject({ knowledgeBaseId: entityIdSchema, tokenId: entityIdSchema });
