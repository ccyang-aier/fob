import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createKnowledgeAssetStorage } from '../assets/storage';
import { bindKnowledgeAssetStorage } from '../assets/runtime';

describe('asset routes', () => {
  let fixture: PermissionsFixture;
  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    bindKnowledgeAssetStorage(createKnowledgeAssetStorage({
      endpoint: 'http://127.0.0.1:59000/', region: 'us-east-1', bucket: 'fob-knowledge',
      accessKeyId: 'test-key', secretAccessKey: 'test-secret',
    }));
  });
  afterAll(async () => { bindKnowledgeAssetStorage(undefined); await fixture.close(); });

  test('prepares a knowledgeBase-scoped upload and rejects a download before confirmation', async () => {
    const client = fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
    const input = { knowledgeBaseId: fixture.alpha.id, hash: 'a'.repeat(64), mime: 'text/plain', size: 5, name: 'a.txt' };
    const prepared = await client.asset.prepare.mutate(input);
    expect(prepared.action).toBe('upload');
    if (prepared.action === 'upload') {
      expect(new URL(prepared.url).pathname).toContain(`${fixture.alpha.id}/${input.hash}`);
      expect(prepared.headers).toEqual({ 'content-type': 'text/plain' });
    }
    await expect(client.asset.download.query({ knowledgeBaseId: input.knowledgeBaseId, hash: input.hash }))
      .rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
  });
});
