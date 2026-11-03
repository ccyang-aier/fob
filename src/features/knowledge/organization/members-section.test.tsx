import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { MemberRole } from './client';

let browser: Window, host: HTMLDivElement, root: Root;
let Members: typeof import('./members-section').MembersSection;
let Provider: typeof import('./hooks').OrganizationQueryProvider;
const base = '10000000-0000-4000-8000-000000000001';
const cursor = '20000000-0000-4000-8000-000000000002';
const calls: (string | null)[] = [];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/?view=members' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) globals[key] = key === 'window' ? browser : (browser as unknown as Record<string, unknown>)[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-context', () => ({ useIdentity: () => ({ session: { status: 'authenticated', user: { id: 'owner' } } }) }));
  const originalClient = await import('./client');
  mock.module('./client', () => ({ ...originalClient, organizationClient: {
    ...originalClient.organizationClient,
    listMembers: async (_id: string, options: { cursor: string | null }) => {
      calls.push(options.cursor);
      return options.cursor === null
        ? { items: [{ knowledgeBaseId: base, userId: 'owner', name: 'Owner', email: 'owner@example.test', image: null, role: 'owner' }], nextCursor: cursor }
        : { items: [{ knowledgeBaseId: base, userId: 'later', name: 'Later member', email: 'later@example.test', image: null, role: 'member' }], nextCursor: null };
    },
  } }));
  Members = (await import('./members-section')).MembersSection;
  Provider = (await import('./hooks')).OrganizationQueryProvider;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30_000);

beforeEach(async () => { await act(async () => root.render(null)); calls.length = 0; });
afterAll(async () => { await act(async () => root?.unmount()); await browser.happyDOM.abort(); mock.restore(); });

async function render(role: MemberRole) {
  await act(async () => root.render(<Provider><Members knowledgeBaseId={base} actorRole={role} notify={() => {}} /></Provider>));
  for (let attempt = 0; attempt < 30 && !host.querySelector('table'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(host.querySelector('table')).not.toBeNull();
}

test('directory counts and name/email search include members beyond the first API page', async () => {
  await render('owner');
  expect(calls).toEqual([null, cursor]);
  expect(host.textContent).toContain('显示 2 / 2 位成员');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索成员"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, 'LATER@');
    input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event);
  });
  expect(host.querySelector('tbody')?.textContent).toContain('Later member');
  expect(host.querySelector('tbody')?.textContent).not.toContain('Owner');
  expect(host.textContent).toContain('显示 1 / 2 位成员');
});

test('read-only members can search the directory without receiving role or removal controls', async () => {
  await render('member');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('input[aria-label="搜索成员"]')).not.toBeNull();
  expect(host.querySelector('tbody button')).toBeNull();
});
