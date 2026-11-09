import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createResourceTestDatabase, seedResourceTestData, type ResourceTestDatabase } from '../src/platform/database/resources/resource-test-database';
import { createCredentialCipher, createModelCredentialStore } from '../src/modules/knowledge/ai/gateway/credentials';
import { createKnowledgeBaseCredentialStore } from '../src/modules/knowledge/ai/gateway/knowledge-base-credentials';
import { connectionProviderId } from '../src/modules/knowledge/ai/assistant/connection-presets';
import { upgradeAssistant } from './upgrade-assistant';

const key = new Uint8Array(32).fill(9);
let database: ResourceTestDatabase, resources: Awaited<ReturnType<typeof seedResourceTestData>>['resources'];
beforeAll(async () => {
  database = await createResourceTestDatabase(); ({ resources } = await seedResourceTestData(database.admin));
  await database.admin.query(`CREATE TABLE resources.assistant_preference(knowledge_base_id uuid NOT NULL,user_id uuid NOT NULL,settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(knowledge_base_id,user_id));
    CREATE TABLE resources.assistant_connection(knowledge_base_id uuid NOT NULL,user_id uuid NOT NULL,id uuid NOT NULL,name text NOT NULL,protocol text NOT NULL,base_url text NOT NULL,credential_id uuid,models jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(knowledge_base_id,id));`);
}, 30000);
afterAll(async () => { await database?.dispose(); }, 30000);
beforeEach(async () => {
  for (const name of ['assistant_preference', 'assistant_connection']) {
    if ((await database.admin.query('SELECT to_regclass($1) AS relation', [`fob_archive.${name}`])).rows[0].relation) await database.admin.query(`ALTER TABLE fob_archive."${name}" SET SCHEMA resources`);
  }
  await database.admin.query('DELETE FROM resources.knowledge_base_ai_connection; DELETE FROM resources.knowledge_base_ai_settings; DELETE FROM resources.knowledge_base_ai_credential; DELETE FROM resources.assistant_connection; DELETE FROM resources.assistant_preference; DELETE FROM resources.model_credential');
  await database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$2,'admin') ON CONFLICT(knowledge_base_id,user_id) DO UPDATE SET role='admin'", [resources[0].knowledgeBaseId, resources[1].userId]);
});
async function legacy(userId: string, name: string) {
  const knowledgeBaseId = resources[0].knowledgeBaseId, id = randomUUID(), provider = connectionProviderId(id), endpoint = `https://${name}.example/v1`;
  const credential = await createModelCredentialStore(database.pool, key).create({ knowledgeBaseId, userId }, { provider, endpoint, apiKey: `${name}-synthetic-key` });
  const settings = { fast: { source: 'byok', provider, credentialId: credential.id, model: `${name}-model` } };
  await database.admin.query('INSERT INTO resources.assistant_connection(knowledge_base_id,user_id,id,name,protocol,base_url,credential_id,models) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [knowledgeBaseId, userId, id, name, 'openai-compatible', endpoint, credential.id, JSON.stringify([{ id: `${name}-model`, name: '' }])]);
  await database.admin.query('INSERT INTO resources.assistant_preference(knowledge_base_id,user_id,settings) VALUES ($1,$2,$3)', [knowledgeBaseId, userId, JSON.stringify(settings)]);
  return { id, credential, settings, provider, endpoint, knowledgeBaseId };
}

test('upgrade creates current RLS tables, migrates the owner key with knowledge-base encryption, and is idempotent', async () => {
  const owner = await legacy(resources[0].userId, 'owner'), admin = await legacy(resources[1].userId, 'admin');
  const before = (await database.admin.query('SELECT encrypted_secret FROM resources.model_credential WHERE knowledge_base_id=$1 AND id=$2', [owner.knowledgeBaseId, owner.credential.id])).rows[0].encrypted_secret as Buffer;
  await database.admin.query('DROP TABLE resources.knowledge_base_ai_connection; DROP TABLE resources.knowledge_base_ai_settings; DROP TABLE resources.knowledge_base_ai_credential');
  await upgradeAssistant(database.admin, database.pool, key);
  const shared = createKnowledgeBaseCredentialStore(database.pool, key);
  expect((await shared.find({ knowledgeBaseId: owner.knowledgeBaseId }, owner.credential.id, owner.provider))?.apiKey).toBe('owner-synthetic-key');
  expect(await shared.find({ knowledgeBaseId: resources[1].knowledgeBaseId }, owner.credential.id, owner.provider)).toBeNull();
  expect(await shared.find({ knowledgeBaseId: owner.knowledgeBaseId }, admin.credential.id, admin.provider)).toBeNull();
  const after = (await database.admin.query('SELECT encrypted_secret FROM resources.knowledge_base_ai_credential WHERE knowledge_base_id=$1 AND id=$2', [owner.knowledgeBaseId, owner.credential.id])).rows[0].encrypted_secret as Buffer;
  expect(after.equals(before)).toBe(false); expect(after.includes(Buffer.from('owner-synthetic-key'))).toBe(false);
  expect(() => createCredentialCipher(key).decrypt(after, { knowledgeBaseId: owner.knowledgeBaseId, userId: resources[0].userId, id: owner.credential.id, provider: owner.provider, endpoint: owner.endpoint })).toThrow('credential');
  expect((await database.admin.query('SELECT settings FROM resources.knowledge_base_ai_settings WHERE knowledge_base_id=$1', [owner.knowledgeBaseId])).rows[0].settings).toEqual(owner.settings);
  expect((await database.admin.query('SELECT count(*)::int AS count FROM fob_archive.assistant_connection')).rows[0].count).toBe(2);
  await expect(database.pool.query('SELECT * FROM fob_archive.assistant_connection')).rejects.toMatchObject({ code: '42501' });
  expect((await database.admin.query("SELECT count(*)::int AS count FROM pg_class WHERE relname LIKE 'knowledge_base_ai_%' AND relkind='r' AND relrowsecurity AND relforcerowsecurity")).rows[0].count).toBe(3);
  await database.admin.query("UPDATE resources.knowledge_base_ai_settings SET settings='{}' WHERE knowledge_base_id=$1", [owner.knowledgeBaseId]);
  await upgradeAssistant(database.admin, database.pool, key);
  expect((await database.admin.query('SELECT settings FROM resources.knowledge_base_ai_settings WHERE knowledge_base_id=$1', [owner.knowledgeBaseId])).rows[0].settings).toEqual({});
  expect((await database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base_ai_connection')).rows[0].count).toBe(1);
});

test('an administrator configuration is adopted when the owner has no configuration', async () => {
  const admin = await legacy(resources[1].userId, 'admin'); await upgradeAssistant(database.admin, database.pool, key);
  expect((await database.admin.query('SELECT settings FROM resources.knowledge_base_ai_settings WHERE knowledge_base_id=$1', [admin.knowledgeBaseId])).rows[0].settings).toEqual(admin.settings);
});

test('ordinary member account keys stay private in the legacy archive and do not become knowledge-base defaults', async () => {
  const member = await legacy(resources[1].userId, 'member');
  await database.admin.query("UPDATE resources.knowledge_base_member SET role='member' WHERE knowledge_base_id=$1 AND user_id=$2", [member.knowledgeBaseId, resources[1].userId]);
  await upgradeAssistant(database.admin, database.pool, key);
  expect((await database.admin.query('SELECT settings FROM resources.knowledge_base_ai_settings WHERE knowledge_base_id=$1', [member.knowledgeBaseId])).rows[0].settings).toEqual({});
  expect((await database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base_ai_connection')).rows[0].count).toBe(0);
  expect((await createModelCredentialStore(database.pool, key).find({ knowledgeBaseId: member.knowledgeBaseId, userId: resources[1].userId }, member.credential.id, member.provider))?.apiKey).toBe('member-synthetic-key');
});

test('a wrong encryption key rolls back the complete import without modifying account data', async () => {
  await legacy(resources[0].userId, 'owner');
  await expect(upgradeAssistant(database.admin, database.pool, new Uint8Array(32).fill(1))).rejects.toThrow('credential');
  expect((await database.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_base_ai_settings')).rows[0].count).toBe(0);
  expect((await database.admin.query('SELECT count(*)::int AS count FROM resources.assistant_connection')).rows[0].count).toBe(1);
});
