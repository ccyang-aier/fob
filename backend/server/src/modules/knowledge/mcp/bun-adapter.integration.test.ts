import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { createPageCollaborationListener } from '../collaboration/page-collaboration-bun';
import { createKnowledgeMcpRequestHandler } from './server';
import { handleKnowledgeMcpOnBun } from './bun-adapter';

const mcpPath = /\/api\/knowledge\/[a-zA-Z0-9-]+\/mcp\/?$/;

/** The Bun-native single-port assembly: the same MCP handler behind the Bun adapter. */
describe('knowledge mcp over the bun adapter', () => {
  let fixture: PermissionsFixture;
  let listener: ReturnType<typeof createPageCollaborationListener>;
  let endpoint: string;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    const handler = createKnowledgeMcpRequestHandler({ authenticator: fixture.authenticator, pool: fixture.pool });
    listener = createPageCollaborationListener({ authenticator: fixture.authenticator, pool: fixture.pool }, {
      persistence: { debounceMs: 120, maxDebounceMs: 400 },
      http: async (request) => {
        if (!mcpPath.test(new URL(request.url).pathname)) return new Response('Not found.', { status: 404 });
        return handleKnowledgeMcpOnBun(handler, request);
      },
    });
    endpoint = `http://127.0.0.1:${listener.port}/api/knowledge/${fixture.alpha.id}/mcp`;
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  test('initialize, tool discovery and a read call round-trip behind the bun listener', async () => {
    const bearer = await fixture.createToken(fixture.reader, ['read']);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: bearer } } });
    const connection = new Client({ name: 'fob-bun-adapter-test', version: '1.0.0' });
    await connection.connect(transport);
    const tools = await connection.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);

    const { pages } = await fixture.tree({ defaultAccess: 'view' });
    await fixture.drain();
    const result = await connection.callTool({ name: 'read_page', arguments: { pageId: pages[0].pageId } });
    expect(result.isError).toBeFalsy();
    await connection.close();
    await transport.close();
  });

  test('unauthenticated initialize is rejected without creating a session', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: 'Bearer fob_pat_invalid' } } });
    const connection = new Client({ name: 'fob-bun-adapter-test', version: '1.0.0' });
    await expect(connection.connect(transport)).rejects.toThrow();
    await transport.close();
  });
});
