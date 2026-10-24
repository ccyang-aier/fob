import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Pool } from 'pg';
import { entityIdSchema, modelEndpointSchema, modelProviderSchema } from '@fob/shared/knowledge/contracts';
import { modelCredential } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { ModelGatewayError } from './errors';
import type { ModelCallContext } from './types';

interface CredentialIdentity extends ModelCallContext { id: string; provider: string; endpoint: string | null }
const aad = (identity: CredentialIdentity) => Buffer.from(JSON.stringify([identity.knowledgeBaseId, identity.userId, identity.id, identity.provider, identity.endpoint]));

/** Single current AES-256-GCM format: nonce(12) | authTag(16) | ciphertext. */
export function createCredentialCipher(key: Uint8Array) {
  if (key.byteLength !== 32) throw new ModelGatewayError('configuration');
  const secret = Buffer.from(key);
  return {
    encrypt(apiKey: string, identity: CredentialIdentity): Uint8Array {
      if (!apiKey.trim() || Buffer.byteLength(apiKey) > 8192 || /[\r\n]/.test(apiKey)) throw new ModelGatewayError('invalid_request');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, nonce);
      cipher.setAAD(aad(identity));
      const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt(value: Uint8Array, identity: CredentialIdentity): string {
      try {
        if (value.byteLength <= 28 || value.byteLength > 8220) throw new Error();
        const bytes = Buffer.from(value);
        const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        decipher.setAAD(aad(identity));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
      } catch { throw new ModelGatewayError('credential_unavailable'); }
    },
  };
}

/** Authorization/membership happens before this server-only store; RLS scopes every query. */
export function createModelCredentialStore(pool: Pool, key: Uint8Array) {
  const cipher = createCredentialCipher(key);
  function scope(context: ModelCallContext) {
    if (!entityIdSchema.safeParse(context.userId).success || !entityIdSchema.safeParse(context.knowledgeBaseId).success) throw new ModelGatewayError('invalid_request');
    return context;
  }
  return {
    async create(context: ModelCallContext, input: { provider: string; apiKey: string; endpoint?: string }) {
      scope(context);
      const provider = modelProviderSchema.safeParse(input.provider);
      const endpoint = input.endpoint === undefined ? null : modelEndpointSchema.safeParse(input.endpoint);
      if (!provider.success || (endpoint !== null && !endpoint.success)) throw new ModelGatewayError('invalid_request');
      const identity = { knowledgeBaseId: context.knowledgeBaseId, userId: context.userId, id: randomUUID(), provider: provider.data, endpoint: endpoint === null ? null : endpoint.data };
      await withKnowledgeBase(pool, context.knowledgeBaseId, async (db) => {
        await db.insert(modelCredential).values({ ...identity, encryptedSecret: cipher.encrypt(input.apiKey, identity) });
      });
      return { id: identity.id, provider: identity.provider, endpoint: identity.endpoint };
    },
    async find(context: ModelCallContext, id: string, provider: string) {
      scope(context);
      if (!entityIdSchema.safeParse(id).success || !modelProviderSchema.safeParse(provider).success) throw new ModelGatewayError('invalid_request');
      const row = await withKnowledgeBase(pool, context.knowledgeBaseId, async (db) => (await db.select().from(modelCredential).where(and(
        eq(modelCredential.knowledgeBaseId, context.knowledgeBaseId), eq(modelCredential.userId, context.userId),
        eq(modelCredential.id, id), eq(modelCredential.provider, provider), isNull(modelCredential.revokedAt),
      )))[0]);
      if (!row) return null;
      return { id: row.id, knowledgeBaseId: row.knowledgeBaseId, userId: row.userId, provider: row.provider,
        endpoint: row.endpoint ?? undefined, apiKey: cipher.decrypt(row.encryptedSecret, row), revokedAt: null };
    },
    async revoke(context: ModelCallContext, id: string) {
      scope(context);
      if (!entityIdSchema.safeParse(id).success) throw new ModelGatewayError('invalid_request');
      return withKnowledgeBase(pool, context.knowledgeBaseId, async (db) => (await db.update(modelCredential).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(modelCredential.knowledgeBaseId, context.knowledgeBaseId), eq(modelCredential.userId, context.userId), eq(modelCredential.id, id), isNull(modelCredential.revokedAt),
      )).returning({ id: modelCredential.id })).length === 1);
    },
  };
}
