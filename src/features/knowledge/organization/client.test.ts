import { describe, expect, test } from 'bun:test';
import { createOrganizationClient } from '@/features/knowledge/organization/client';
import { createKnowledgeCatalogClient } from '../data/knowledge-catalog-client';
import type { OrganizationClientDeps } from '@/features/knowledge/organization/client';
import {
  isOrganizationDataError,
  organizationErrorText,
} from '@/features/knowledge/organization/errors';

/**
 * Route-contract tests (O02): every client operation must hit exactly the
 * method/path/body the backend route table defines (http.ts), including the
 * `{}` body on DELETE requests; input validation fails fast client-side and
 * every failure shape normalizes to one domain error.
 */

const ORIGIN = 'http://127.0.0.1:8710';
const BASE = `${ORIGIN}/api/knowledge-bases`;
const ws = '10000000-0000-4000-8000-000000000001';
const otherUser = '20000000-0000-4000-8000-000000000002';
const groupId = '30000000-0000-4000-8000-000000000003';
const teamspaceId = '40000000-0000-4000-8000-000000000004';
const cursor = '50000000-0000-4000-8000-000000000005';

type Recorded = {
  url: string;
  method: string;
  body?: string;
  contentType?: string;
  credentials?: RequestInit['credentials'];
};

function recordingFetch(status: number, body: unknown) {
  const calls: Recorded[] = [];
  const impl = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : String(init.body),
      contentType: (init?.headers as Record<string, string> | undefined)?.['Content-Type'],
      credentials: init?.credentials,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, impl };
}

function clientWith(impl: typeof fetch) {
  const deps: OrganizationClientDeps = {
    origin: async () => ORIGIN,
    fetchImpl: impl as typeof fetch,
  };
  return { ...createOrganizationClient(deps), ...createKnowledgeCatalogClient(deps) };
}

function lastCall(calls: Recorded[]): Recorded {
  return calls[calls.length - 1]!;
}

async function expectInvalidInput(call: () => unknown) {
  let error: unknown;
  try {
    await call();
  } catch (cause) {
    error = cause;
  }
  expect(isOrganizationDataError(error)).toBe(true);
  expect((error as { code: string }).code).toBe('INVALID_INPUT');
}

describe('route contract', () => {
  test('list endpoints GET their collection path with cursor and limit in the query', async () => {
    const { calls, impl } = recordingFetch(200, { items: [], nextCursor: null });
    const client = clientWith(impl as unknown as typeof fetch);
    await client.listKnowledgeBases({ cursor, limit: 25 });
    expect(lastCall(calls).url).toBe(`${BASE}?cursor=${cursor}&limit=25`);
    expect(lastCall(calls).method).toBe('GET');
    expect(lastCall(calls).body).toBe(undefined);
    expect(lastCall(calls).contentType).toBe(undefined);

    await client.listMembers(ws, {});
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/members`);
    await client.listGroups(ws, {});
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups`);
    await client.listGroupMembers(ws, groupId, {});
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups/${groupId}/members`);
    await client.listTeamspaces(ws, {});
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/teamspaces`);
  });

  test('knowledge base creation POSTs only its name to the collection', async () => {
    const { calls, impl } = recordingFetch(201, { id: ws, name: '团队' });
    await clientWith(impl as unknown as typeof fetch).createKnowledgeBase({ name: ' 团队 ' });
    const call = lastCall(calls);
    expect(call.method).toBe('POST');
    expect(call.url).toBe(BASE);
    expect(call.body).toBe(JSON.stringify({ name: '团队' }));
    expect(call.contentType).toBe('application/json');
    expect(call.credentials).toBe('include');
  });

  test('knowledge workspaces expose direct detail, rename and deletion without another scope', async () => {
    const { calls, impl } = recordingFetch(200, { id: ws, name: '团队', role: 'owner' });
    const client = clientWith(impl as unknown as typeof fetch);
    await client.getKnowledgeBase(ws);
    expect(lastCall(calls).url).toBe(BASE + '/' + ws);
    expect(lastCall(calls).method).toBe('GET');
    await client.updateKnowledgeBase(ws, { name: ' 新名称 ' });
    expect(lastCall(calls).method).toBe('PATCH');
    expect(lastCall(calls).body).toBe(JSON.stringify({ name: '新名称' }));
    await client.removeKnowledgeBase(ws);
    expect(lastCall(calls).method).toBe('DELETE');
    expect(lastCall(calls).body).toBe('{}');
    await expectInvalidInput(() => client.getKnowledgeBase('invented-space'));
    await expectInvalidInput(() => client.updateKnowledgeBase(ws, { name: ' ' }));
  });

  test('member role change PATCHes the member path with the role body', async () => {
    const { calls, impl } = recordingFetch(200, {
      knowledgeBaseId: ws,
      userId: otherUser,
      role: 'admin',
    });
    await clientWith(impl as unknown as typeof fetch).changeMemberRole(ws, {
      userId: otherUser,
      role: 'admin',
    });
    const call = lastCall(calls);
    expect(call.method).toBe('PATCH');
    expect(call.url).toBe(`${BASE}/${ws}/members/${otherUser}`);
    expect(call.body).toBe(JSON.stringify({ role: 'admin' }));
  });

  test('DELETE requests carry an empty JSON body — the middleware rejects bodyless writes', async () => {
    const { calls, impl } = recordingFetch(200, { removed: true });
    const client = clientWith(impl as unknown as typeof fetch);
    await client.removeMember(ws, otherUser);
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/members/${otherUser}`);
    await client.removeGroup(ws, groupId);
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups/${groupId}`);
    await client.removeGroupMember(ws, groupId, otherUser);
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups/${groupId}/members/${otherUser}`);
    await client.removeTeamspace(ws, teamspaceId);
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/teamspaces/${teamspaceId}`);
    for (const call of calls) {
      expect(call.method).toBe('DELETE');
      expect(call.body).toBe('{}');
      expect(call.contentType).toBe('application/json');
    }
  });

  test('group writes: create POSTs name, rename PATCHes, membership POSTs the userId', async () => {
    const { calls, impl } = recordingFetch(201, {
      knowledgeBaseId: ws,
      id: groupId,
      name: '设计组',
    });
    const client = clientWith(impl as unknown as typeof fetch);
    await client.createGroup(ws, { name: '设计组' });
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups`);
    expect(lastCall(calls).body).toBe(JSON.stringify({ name: '设计组' }));
    await client.renameGroup(ws, { id: groupId, name: '产品组' });
    expect(lastCall(calls).method).toBe('PATCH');
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups/${groupId}`);
    expect(lastCall(calls).body).toBe(JSON.stringify({ name: '产品组' }));
    await client.addGroupMember(ws, groupId, otherUser);
    expect(lastCall(calls).method).toBe('POST');
    expect(lastCall(calls).url).toBe(`${BASE}/${ws}/groups/${groupId}/members`);
    expect(lastCall(calls).body).toBe(JSON.stringify({ userId: otherUser }));
  });

  test('teamspace creation sends defaultAccess including null; updates send only provided fields', async () => {
    const { calls, impl } = recordingFetch(201, {
      knowledgeBaseId: ws,
      id: teamspaceId,
      name: '文档',
      defaultAccess: null,
    });
    const client = clientWith(impl as unknown as typeof fetch);
    await client.createTeamspace(ws, { name: '文档', defaultAccess: null });
    expect(lastCall(calls).body).toBe(JSON.stringify({ name: '文档', defaultAccess: null }));
    await client.updateTeamspace(ws, teamspaceId, { defaultAccess: 'edit' });
    expect(lastCall(calls).body).toBe(JSON.stringify({ defaultAccess: 'edit' }));
    await client.updateTeamspace(ws, teamspaceId, { name: '文档库' });
    expect(lastCall(calls).body).toBe(JSON.stringify({ name: '文档库' }));
  });
});

describe('input validation fails before any request', () => {
  test('names must trim to 1..120 characters', async () => {
    const { calls, impl } = recordingFetch(201, {});
    const client = clientWith(impl as unknown as typeof fetch);
    await expectInvalidInput(() => client.createKnowledgeBase({ name: '   ' }));
    await expectInvalidInput(() => client.createGroup(ws, { name: 'x'.repeat(121) }));
    await expectInvalidInput(() => client.renameGroup(ws, { id: groupId, name: '' }));
    await expectInvalidInput(() => client.createTeamspace(ws, { name: '  ', defaultAccess: null }));
    expect(calls).toHaveLength(0);
  });

  test('scope ids must be UUIDs', async () => {
    const { calls, impl } = recordingFetch(200, {});
    const client = clientWith(impl as unknown as typeof fetch);
    await expectInvalidInput(() => client.listMembers('not-a-uuid', {}));
    await expectInvalidInput(() => client.changeMemberRole(ws, { userId: 'nope', role: 'member' }));
    await expectInvalidInput(() => client.removeTeamspace(ws, 'nope'));
    expect(calls).toHaveLength(0);
  });

  test('pagination params are bounded', async () => {
    const { calls, impl } = recordingFetch(200, {});
    const client = clientWith(impl as unknown as typeof fetch);
    await expectInvalidInput(() => client.listKnowledgeBases({ cursor: 'garbage' }));
    await expectInvalidInput(() => client.listKnowledgeBases({ limit: 0 }));
    await expectInvalidInput(() => client.listKnowledgeBases({ limit: 101 }));
    expect(calls).toHaveLength(0);
  });

  test('teamspace patches need at least one field and known values', async () => {
    const { calls, impl } = recordingFetch(200, {});
    const client = clientWith(impl as unknown as typeof fetch);
    await expectInvalidInput(() => client.updateTeamspace(ws, teamspaceId, {}));
    await expectInvalidInput(() =>
      client.createTeamspace(ws, { name: 'x', defaultAccess: 'root' as never }),
    );
    await expectInvalidInput(() =>
      client.changeMemberRole(ws, { userId: otherUser, role: 'superuser' as never }),
    );
    expect(calls).toHaveLength(0);
  });
});

describe('error normalization', () => {
  async function errorOf(status: number, body: unknown) {
    const { impl } = recordingFetch(status, body);
    return clientWith(impl as unknown as typeof fetch)
      .listKnowledgeBases()
      .catch((cause) => cause);
  }

  test('known server codes map to the domain error with Chinese copy', async () => {
    const forbidden = await errorOf(403, { code: 'FORBIDDEN', message: 'denied' });
    expect(isOrganizationDataError(forbidden)).toBe(true);
    expect((forbidden as { code: string }).code).toBe('FORBIDDEN');
    expect((forbidden as Error).message).toBe(organizationErrorText().FORBIDDEN);

    const unauthenticated = await errorOf(401, { code: 'UNAUTHENTICATED', message: 'no session' });
    expect((unauthenticated as { code: string }).code).toBe('UNAUTHENTICATED');
    expect((unauthenticated as Error).message).toBe(organizationErrorText().UNAUTHENTICATED);

    const notEmpty = await errorOf(409, { code: 'TEAMSPACE_NOT_EMPTY', message: 'pages remain' });
    expect((notEmpty as { code: string }).code).toBe('TEAMSPACE_NOT_EMPTY');

    const lastOwner = await errorOf(409, { code: 'LAST_OWNER', message: 'last owner' });
    expect((lastOwner as { code: string }).code).toBe('LAST_OWNER');
  });

  test('unknown codes and unparseable bodies degrade to ORGANIZATION_UNAVAILABLE', async () => {
    const unknownCode = await errorOf(500, { code: 'SOMETHING_ELSE' });
    expect((unknownCode as { code: string }).code).toBe('ORGANIZATION_UNAVAILABLE');

    const notJson = createKnowledgeCatalogClient({
      origin: async () => ORIGIN,
      fetchImpl: (async () =>
        new Response('<html>gateway error</html>', { status: 502 })) as unknown as typeof fetch,
    });
    const degraded = await notJson.listKnowledgeBases().catch((cause) => cause);
    expect((degraded as { code: string }).code).toBe('ORGANIZATION_UNAVAILABLE');
  });

  test('a success body that is not JSON is an availability error', async () => {
    const client = createKnowledgeCatalogClient({
      origin: async () => ORIGIN,
      fetchImpl: (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
    });
    const error = await client.listKnowledgeBases().catch((cause) => cause);
    expect((error as { code: string }).code).toBe('ORGANIZATION_UNAVAILABLE');
  });

  test('transport failures normalize to NETWORK; endpoint resolution failures keep ENDPOINT', async () => {
    const network = createKnowledgeCatalogClient({
      origin: async () => ORIGIN,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const networkError = await network.listKnowledgeBases().catch((cause) => cause);
    expect((networkError as { code: string }).code).toBe('NETWORK');

    const offline = createKnowledgeCatalogClient({
      origin: async () => {
        throw Object.assign(new Error('no endpoint'), { code: 'ENDPOINT' });
      },
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    const endpointError = await offline.listKnowledgeBases().catch((cause) => cause);
    expect((endpointError as { code: string }).code).toBe('ENDPOINT');
  });
});
