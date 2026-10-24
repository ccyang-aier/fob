import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { parseKnowledgeOrigin } from '@fob/shared/knowledge/collaboration';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { principal } from '@fob/shared/knowledge/contracts';
import { eq } from 'drizzle-orm';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPageCollaborationListener } from '../collaboration/page-collaboration-bun';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { createKnowledgeMcpRequestHandler } from './server';

const TASK_CLIENT = 'fob-mcp-test';

/** A standards-compliant MCP client over Streamable HTTP against the real handler. */
describe('knowledge mcp streamable http service', () => {
  let fixture: PermissionsFixture;
  let httpServer: Server;
  let endpoint: string;
  let listener: ReturnType<typeof createPageCollaborationListener>;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
    );
    const handler = createKnowledgeMcpRequestHandler({ authenticator: fixture.authenticator, pool: fixture.pool, hocuspocus: listener.hocuspocus });
    httpServer = createServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/knowledge/${fixture.alpha.id}/mcp`;
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function client(scopes: 'read' | 'write' = 'write') {
    const bearer = await fixture.createToken(fixture.reader, scopes === 'write' ? ['read', 'write'] : ['read']);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: bearer } },
    });
    const connection = new Client({ name: TASK_CLIENT, version: '1.0.0' });
    await connection.connect(transport);
    return { connection, transport };
  }

  test('initialize, tool discovery and a real read call round-trip', async () => {
    const { connection, transport } = await client();
    const tools = await connection.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'create_page', 'delete', 'get_backlinks', 'insert', 'list_pages', 'query_database', 'read_page', 'replace', 'search', 'update_properties',
    ]);

    const { pages } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const result = await connection.callTool({ name: 'list_pages', arguments: {} });
    expect(result.isError).toBeFalsy();
    const listed = JSON.parse((result.content as { type: string; text: string }[]).find((item) => item.type === 'text')!.text) as { pages: { pageId: string }[] };
    expect(listed.pages.some((entry) => entry.pageId === pages[0].pageId)).toBe(true);
    await connection.close();
    await transport.close();
  });

  test('write calls attribute suggestions with the mcp client name', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, {
      knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId,
      grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }],
    }));
    const { prosemirrorDocToYDoc } = await import('../import-export/y-encoding');
    const { createMarkdownPipeline } = await import('@fob/shared/knowledge/markdown');
    const { repairBlockIds } = await import('@fob/shared/knowledge/schema');
    const parsed = repairBlockIds(createMarkdownPipeline().parse('MCP 建议目标')).doc;
    const blocks: import('@tiptap/pm/model').Node[] = [];
    parsed.forEach((block) => blocks.push(block));
    const encoded = prosemirrorDocToYDoc(parsed.type.schema.topNodeType.createChecked(null, blocks));
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
      await db.insert(docState).values({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) });
    });
    await fixture.drain();

    const { connection, transport } = await client();
    const target = await blockIdAt(pages[1].pageId);
    const result = await connection.callTool({ name: 'delete', arguments: { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId, blockId: target } });
    expect(result.isError).toBeFalsy();

    await until(async () => (await suggestionsOf(pages[1].pageId)).length > 0);
    const suggestion = (await suggestionsOf(pages[1].pageId)).at(-1)!;
    // Attribution follows the shared client/task protocol; authenticated user
    // identity belongs to the authoritative event actor, not this UI label.
    expect(parseKnowledgeOrigin(suggestion.author)).toMatchObject({ kind: 'mcp', clientName: TASK_CLIENT });
    await connection.close();
    await transport.close();
  });

  test('unauthenticated and under-scoped clients are refused', async () => {
    const anonymous = new Client({ name: 'anon', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    await expect(anonymous.connect(transport)).rejects.toThrow();
    await anonymous.close();
    await transport.close().catch(() => undefined);

    const { connection, transport: readTransport } = await client('read');
    const rejected = await connection.callTool({ name: 'delete', arguments: { knowledgeBaseId: fixture.alpha.id, pageId: '00000000-0000-4000-8000-000000000000', blockId: 'b' } });
    expect(rejected.isError).toBe(true);
    await connection.close();
    await readTransport.close();
  });

  async function blockIdAt(pageId: string): Promise<string> {
    const [row] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, pageId)));
    const document = yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema)!;
    let found = '';
    document.descendants((node) => {
      if (!found && node.type.spec.attrs?.blockId) found = node.attrs.blockId as string;
    });
    return found;
  }
  async function suggestionsOf(pageId: string) {
    const [row] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, pageId)));
    if (!row) return [];
    const document = yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema);
    return document ? collectSuggestions(document) : [];
  }
});
