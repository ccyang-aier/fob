import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Pool } from 'pg';
import { entityIdSchema, modelEndpointSchema, modelProviderSchema } from '@fob/shared/knowledge/contracts';
import { knowledgeBaseModelCredential } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase, type ResourceTransaction } from '../../../../platform/database/resources/transaction';
import { createCredentialCipher } from './credentials';
import { ModelGatewayError } from './errors';

type Scope = { knowledgeBaseId: string };
/** Server-only resolution after membership authorization; secrets never enter public DTOs. */
export function createKnowledgeBaseCredentialStore(pool: Pool, key: Uint8Array) {
  const cipher = createCredentialCipher(key);
  const scope = (context: Scope) => { if (!entityIdSchema.safeParse(context.knowledgeBaseId).success) throw new ModelGatewayError('invalid_request'); };
  return {
    async create(context: Scope, input: { provider: string; apiKey: string; endpoint?: string }, transaction?: ResourceTransaction) {
      scope(context);
      const provider = modelProviderSchema.parse(input.provider), endpoint = input.endpoint === undefined ? null : modelEndpointSchema.parse(input.endpoint);
      const identity = { knowledgeBaseId: context.knowledgeBaseId, userId: null, id: randomUUID(), provider, endpoint };
      const save = (db: ResourceTransaction) => db.insert(knowledgeBaseModelCredential).values({ knowledgeBaseId: identity.knowledgeBaseId, id: identity.id, provider, endpoint, encryptedSecret: cipher.encrypt(input.apiKey, identity) });
      if (transaction) await save(transaction); else await withKnowledgeBase(pool, context.knowledgeBaseId, save);
      return { id: identity.id, provider, endpoint };
    },
    async find(context: Scope, id: string, provider: string, transaction?: ResourceTransaction) {
      scope(context);
      if (!entityIdSchema.safeParse(id).success || !modelProviderSchema.safeParse(provider).success) throw new ModelGatewayError('invalid_request');
      const read = async (db: ResourceTransaction) => (await db.select().from(knowledgeBaseModelCredential).where(and(
        eq(knowledgeBaseModelCredential.knowledgeBaseId, context.knowledgeBaseId), eq(knowledgeBaseModelCredential.id, id), eq(knowledgeBaseModelCredential.provider, provider), isNull(knowledgeBaseModelCredential.revokedAt),
      )))[0];
      const row = transaction ? await read(transaction) : await withKnowledgeBase(pool, context.knowledgeBaseId, read);
      if (!row) return null;
      return { id: row.id, knowledgeBaseId: row.knowledgeBaseId, userId: null, provider: row.provider, endpoint: row.endpoint ?? undefined,
        apiKey: cipher.decrypt(row.encryptedSecret, { ...row, userId: null }), revokedAt: null };
    },
    async revoke(context: Scope, id: string, transaction?: ResourceTransaction) {
      scope(context);
      if (!entityIdSchema.safeParse(id).success) throw new ModelGatewayError('invalid_request');
      const remove = async (db: ResourceTransaction) => (await db.update(knowledgeBaseModelCredential).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(knowledgeBaseModelCredential.knowledgeBaseId, context.knowledgeBaseId), eq(knowledgeBaseModelCredential.id, id), isNull(knowledgeBaseModelCredential.revokedAt),
      )).returning({ id: knowledgeBaseModelCredential.id })).length === 1;
      return transaction ? remove(transaction) : withKnowledgeBase(pool, context.knowledgeBaseId, remove);
    },
  };
}
