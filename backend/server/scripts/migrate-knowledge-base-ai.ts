import type { PoolClient } from 'pg';
import { modelSettingsSchema, type AssistantConnectionModel } from '@fob/shared/knowledge/contracts';
import { createCredentialCipher } from '../src/modules/knowledge/ai/gateway/credentials';

/** Called inside the schema upgrade transaction. Old account rows remain untouched. */
export async function migrateKnowledgeBaseAI(client: PoolClient, key: Uint8Array) {
  const cipher = createCredentialCipher(key);
  const legacy = (await client.query<{ preferences: string | null; connections: string | null }>("SELECT coalesce(to_regclass('resources.assistant_preference'),to_regclass('fob_archive.assistant_preference'))::text AS preferences, coalesce(to_regclass('resources.assistant_connection'),to_regclass('fob_archive.assistant_connection'))::text AS connections")).rows[0]!;
  if (legacy.preferences && !['resources.assistant_preference', 'fob_archive.assistant_preference'].includes(legacy.preferences) || legacy.connections && !['resources.assistant_connection', 'fob_archive.assistant_connection'].includes(legacy.connections)) throw new Error('Unrecognized legacy AI tables.');
  if (!legacy.preferences && !legacy.connections) return { migrated: 0 };
  const bases = (await client.query<{ id: string }>('SELECT id FROM resources.knowledge_base b WHERE NOT EXISTS (SELECT 1 FROM resources.knowledge_base_ai_settings s WHERE s.knowledge_base_id=b.id) ORDER BY id')).rows;
  let migrated = 0;
  for (const base of bases) {
    // A single deterministic authority wins; never publish an ordinary member's private key.
    const candidates = await client.query<{ user_id: string; settings: unknown }>(`
      SELECT m.user_id, ${legacy.preferences ? "coalesce(p.settings,'{}'::jsonb)" : "'{}'::jsonb"} AS settings
      FROM resources.knowledge_base_member m
      ${legacy.preferences ? `LEFT JOIN ${legacy.preferences} p ON p.knowledge_base_id=m.knowledge_base_id AND p.user_id=m.user_id` : ''}
      WHERE m.knowledge_base_id=$1 AND m.role IN ('owner','admin') AND (
        ${legacy.preferences ? "(p.settings IS NOT NULL AND p.settings <> '{}'::jsonb)" : 'false'}
        OR ${legacy.connections ? `EXISTS (SELECT 1 FROM ${legacy.connections} c WHERE c.knowledge_base_id=m.knowledge_base_id AND c.user_id=m.user_id)` : 'false'})
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,
        ${legacy.preferences ? 'p.updated_at DESC NULLS LAST,' : ''} m.created_at, m.user_id LIMIT 1`, [base.id]);
    const selected = candidates.rows[0];
    const settings = modelSettingsSchema.parse(selected?.settings ?? {});
    const connections = selected && legacy.connections ? (await client.query<{
      id: string; name: string; protocol: string; base_url: string; credential_id: string | null; models: AssistantConnectionModel[]; created_at: Date; updated_at: Date;
    }>(`SELECT id,name,protocol,base_url,credential_id,models,created_at,updated_at FROM ${legacy.connections} WHERE knowledge_base_id=$1 AND user_id=$2 ORDER BY created_at,id`, [base.id, selected.user_id])).rows : [];
    const credentialIds = [...new Set([...connections.flatMap(item => item.credential_id ? [item.credential_id] : []), ...Object.values(settings).flatMap(item => item?.source === 'byok' ? [item.credentialId] : [])])];
    if (selected && credentialIds.length) {
      const credentials = (await client.query<{ id: string; provider: string; endpoint: string | null; encrypted_secret: Buffer; revoked_at: Date | null; created_at: Date; updated_at: Date }>(
        'SELECT id,provider,endpoint,encrypted_secret,revoked_at,created_at,updated_at FROM resources.model_credential WHERE knowledge_base_id=$1 AND user_id=$2 AND id=ANY($3::uuid[])', [base.id, selected.user_id, credentialIds])).rows;
      if (credentials.length !== credentialIds.length) throw new Error('A legacy AI credential is unavailable for its configuration owner.');
      for (const credential of credentials) {
        const identity = { knowledgeBaseId: base.id, userId: selected.user_id, id: credential.id, provider: credential.provider, endpoint: credential.endpoint };
        const encrypted = cipher.encrypt(cipher.decrypt(credential.encrypted_secret, identity), { ...identity, userId: null });
        await client.query('INSERT INTO resources.knowledge_base_ai_credential(knowledge_base_id,id,provider,endpoint,encrypted_secret,revoked_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [base.id, credential.id, credential.provider, credential.endpoint, Buffer.from(encrypted), credential.revoked_at, credential.created_at, credential.updated_at]);
      }
    }
    for (const connection of connections) {
      await client.query('INSERT INTO resources.knowledge_base_ai_connection(knowledge_base_id,id,name,protocol,base_url,credential_id,models,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [base.id, connection.id, connection.name, connection.protocol, connection.base_url, connection.credential_id, JSON.stringify(connection.models), connection.created_at, connection.updated_at]);
    }
    await client.query('INSERT INTO resources.knowledge_base_ai_settings(knowledge_base_id,settings) VALUES ($1,$2)', [base.id, JSON.stringify(settings)]);
    if (selected) migrated++;
  }
  return { migrated };
}
