import { expect, test } from 'bun:test';
import { createInvitationClient, knowledgeBaseInvitationLink, type CreatedKnowledgeBaseInvitation } from './invitation-client';
import { allOrganizationPages } from './member-directory';

const base = '10000000-0000-4000-8000-000000000001';
const invitationId = '20000000-0000-4000-8000-000000000002';
const created: CreatedKnowledgeBaseInvitation = { invitation: { knowledgeBaseId: base, id: invitationId, email: 'invitee@example.test', role: 'member', invitedBy: '30000000-0000-4000-8000-000000000003', createdAt: '2026-11-02T00:00:00Z', expiresAt: '2026-11-09T00:00:00Z', acceptedAt: null, acceptedBy: null, revokedAt: null }, token: 'a'.repeat(43) };

function client(status = 200, response: unknown = created) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return { calls, api: createInvitationClient({ origin: async () => 'https://fob.example.test', fetchImpl: (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch }) };
}

test('email invitations always request the ordinary-member default and send authenticated scoped writes', async () => {
  const { calls, api } = client();
  const scope = new AbortController();
  await api.create(base, '  INVITEE@example.test  ', scope.signal);
  expect(calls[0]!.url).toBe(`https://fob.example.test/api/knowledge-bases/${base}/invitations`);
  expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'include', signal: scope.signal });
  expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ email: created.invitation.email, role: 'member' });
});

test('invitation secrets stay in the fragment and acceptance sends them only in the protected request body', async () => {
  const link = new URL(knowledgeBaseInvitationLink('https://fob.example.test/?view=profile', created));
  expect(link.pathname).toBe('/invite');
  expect(link.search).toBe('');
  expect(link.href.split('#')[0]).not.toContain(created.token);
  const params = new URLSearchParams(link.hash.slice(1));
  expect(params.get('kind')).toBe('knowledge-base');
  params.delete('kind');
  const { api, calls } = client(200, { id: base, name: 'Team', role: 'member' });
  await api.accept(Object.fromEntries(params) as { knowledgeBaseId: string; invitationId: string; token: string });
  expect(calls[0]!.url.endsWith(`/invitations/${invitationId}/accept`)).toBe(true);
  expect(calls[0]!.url).not.toContain(created.token);
  expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ token: created.token });
});

test('pending invitation paging and revocation preserve the existing route and JSON contracts', async () => {
  const { api, calls } = client();
  await api.list(base, { cursor: invitationId, limit: 100 });
  expect(new URL(calls[0]!.url).searchParams.get('cursor')).toBe(invitationId);
  await api.revoke(base, invitationId);
  expect(calls[1]!.init?.method).toBe('DELETE');
  expect(calls[1]!.init?.body).toBe('{}');
});

test('invalid targets fail before transmission and denied or expired invitations retain structured errors', async () => {
  const { api, calls } = client();
  expect(() => api.create(base, 'invalid')).toThrow();
  expect(() => api.accept({ knowledgeBaseId: base, invitationId, token: 'short' })).toThrow();
  expect(calls).toHaveLength(0);
  await expect(client(403, { code: 'FORBIDDEN' }).api.create(base, created.invitation.email)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(client(404, { code: 'INVITATION_INVALID' }).api.accept({ knowledgeBaseId: base, invitationId, token: created.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
});

test('member directories read all pages, preserve cancellation and reject repeated cursors', async () => {
  const scope = new AbortController(), seen: unknown[] = [];
  const members = await allOrganizationPages(async options => {
    seen.push(options);
    return options.cursor ? { items: ['second'], nextCursor: null } : { items: ['first'], nextCursor: invitationId };
  }, scope.signal);
  expect(members).toEqual(['first', 'second']);
  expect(seen).toEqual([{ cursor: null, limit: 100, signal: scope.signal }, { cursor: invitationId, limit: 100, signal: scope.signal }]);
  await expect(allOrganizationPages(async () => ({ items: [], nextCursor: invitationId }))).rejects.toMatchObject({ code: 'ORGANIZATION_UNAVAILABLE' });
  scope.abort();
  let called = false;
  await expect(allOrganizationPages(async () => { called = true; return { items: [], nextCursor: null }; }, scope.signal)).rejects.toThrow();
  expect(called).toBe(false);
});
