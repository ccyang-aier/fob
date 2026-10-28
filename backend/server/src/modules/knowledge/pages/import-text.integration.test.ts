import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
const owner = () => fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });

test('text and Markdown imports atomically create editable ordinary pages with authoritative Y.Doc bodies', async () => {
  const { teamspace } = await fixture.tree();
  for (const format of ['text', 'markdown'] as const) {
    const input = { knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: teamspace.id, parentId: null, title: `Imported ${format}`, text: '# Hello\n\n内容 **strong**', format };
    const placed = await owner().page.importText.mutate(input);
    expect(placed.pageId).toBe(input.id);
    const metadata = (await owner().page.list.query({ knowledgeBaseId: input.knowledgeBaseId })).find(row => row.id === input.id)!;
    expect(metadata).toMatchObject({ kind: 'doc', title: input.title, properties: {} });
    expect((await owner().page.access.query({ knowledgeBaseId: input.knowledgeBaseId, pageId: input.id, action: 'edit' })).authorized).toBe(true);
    const [saved] = await withKnowledgeBase(fixture.pool, input.knowledgeBaseId, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, input.knowledgeBaseId), eq(docState.pageId, input.id))));
    const body = yStateToProseMirrorDoc(new Uint8Array(saved!.state), knowledgeSchema)!;
    expect(body.firstChild!.type.name).toBe(format === 'text' ? 'paragraph' : 'heading');
    expect(body.textContent).toContain(format === 'text' ? '内容 **strong**' : '内容 strong');
    await owner().page.importText.mutate({ ...input, text: 'A retry must not replace the existing body' });
    const [retried] = await withKnowledgeBase(fixture.pool, input.knowledgeBaseId, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, input.knowledgeBaseId), eq(docState.pageId, input.id))));
    expect(Buffer.from(retried!.state)).toEqual(Buffer.from(saved!.state));
  }
});

test('invalid Markdown and unauthorized imports leave no blank document behind', async () => {
  const { teamspace } = await fixture.tree({ defaultAccess: 'view' });
  const input = { knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: teamspace.id, parentId: null, title: 'Must not appear', text: '::unknown-directive{a="1"}', format: 'markdown' as const };
  await expect(owner().page.importText.mutate(input)).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
  await expect(owner().page.importText.mutate({ ...input, text: `![Hidden](asset:${'a'.repeat(64)})` })).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } });
  const reader = fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin });
  await expect(reader.page.importText.mutate({ ...input, format: 'text' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  const foreign = await fixture.tree({ resource: 'beta' });
  await expect(owner().page.importText.mutate({ ...input, format: 'text', teamspaceId: foreign.teamspace.id })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  const authorization = await fixture.createToken(fixture.owner, ['read']);
  await expect(fixture.apiClient({ authorization }).page.importText.mutate({ ...input, format: 'text' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  expect((await owner().page.list.query({ knowledgeBaseId: input.knowledgeBaseId })).some(row => row.id === input.id)).toBe(false);
});
