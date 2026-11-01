import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { KnowledgeBaseInvitation } from '@fob/shared/knowledge/contracts';

let browser: Window, host: HTMLDivElement, root: Root;
let Menu: typeof import('./knowledge-members-menu').KnowledgeMembersButton;
const alpha = '10000000-0000-4000-8000-000000000001', beta = '20000000-0000-4000-8000-000000000002';
let selected = { id: alpha, name: 'Alpha', source: 'server' };
let role = 'owner';
const requests: string[] = [];
let invitations: KnowledgeBaseInvitation[] = [];
const createdFor: string[] = [];

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','MutationObserver','getComputedStyle']) globals[key] = key === 'window' ? browser : (browser as unknown as Record<string,unknown>)[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('../data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => ({ selectedKnowledgeBase: selected, scopeKey: `account:${selected.id}`, principal: 'account' }) }));
  mock.module('@/features/identity/identity-context', () => ({ useIdentity: () => ({ session: { status: 'authenticated', user: { id: 'account' } }, presence: 'online' }) }));
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: () => {} }) }));
  mock.module('@/components/ui/tooltip', () => Object.fromEntries(['Tooltip','TooltipTrigger','TooltipContent'].map(name => [name, ({ children }: { children: ReactNode }) => name === 'TooltipContent' ? null : children])));
  mock.module('@/components/ui/anchored-popover', () => ({ AnchoredPopover: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
  mock.module('./member-directory', () => ({ knowledgeBaseMemberDirectory: async (id: string) => {
    requests.push(id);
    return { role, members: [{ knowledgeBaseId: id, userId: 'account', role, name: `${id === alpha ? 'alpha' : 'beta'} member`, email: 'member@example.test', image: null }] };
  }, allOrganizationPages: async () => [...invitations] }));
  mock.module('./invitation-client', () => ({
    invitationClient: {
      create: async (id: string, email: string) => {
        createdFor.push(email);
        const invitation: KnowledgeBaseInvitation = { knowledgeBaseId: id, id: 'invitation', email, role: 'member', invitedBy: 'account', createdAt: '2026-11-02T00:00:00Z', expiresAt: '2099-11-09T00:00:00Z', acceptedAt: null, acceptedBy: null, revokedAt: null };
        invitations = [invitation];
        return { invitation, token: 'a'.repeat(43) };
      },
      revoke: async () => { invitations = []; return { revoked: true }; },
    },
    knowledgeBaseInvitationLink: () => 'http://localhost:3001/invite#kind=knowledge-base',
  }));
  Menu = (await import('./knowledge-members-menu')).KnowledgeMembersButton;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30_000);
beforeEach(async () => { await act(async () => root.render(null)); selected = { id: alpha, name: 'Alpha', source: 'server' }; role = 'owner'; requests.length = 0; invitations = []; createdFor.length = 0; });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
const render = () => act(async () => root.render(<Menu onManage={() => {}} />));
async function open() {
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="知识库成员"]')!.click(); await Bun.sleep(30); });
  await act(async () => { await Bun.sleep(30); });
}

test('only the verified owner response exposes the invitation form; ordinary members see the directory', async () => {
  role = 'member'; await render(); await open();
  expect(host.textContent).toContain('alpha member');
  expect(host.querySelector('input[type=email]')).toBeNull();
  await act(async () => root.render(null)); role = 'owner'; await render(); await open();
  expect(host.querySelector('input[type=email]')).not.toBeNull();
});

test('switching knowledge bases closes the previous panel and never renders the previous member list', async () => {
  await render(); await open();
  expect(host.textContent).toContain('alpha member');
  selected = { id: beta, name: 'Beta', source: 'server' }; await render();
  expect(host.querySelector('[role=dialog]')).toBeNull();
  await open();
  expect(host.textContent).toContain('beta member');
  expect(host.textContent).not.toContain('alpha member');
  expect(requests).toEqual([alpha,beta]);
});

test('local knowledge bases never request a server member directory or show an invitation form', async () => {
  selected = { id: 'local', name: 'Local', source: 'local' }; await render(); await open();
  expect(host.textContent).toContain('仅供当前浏览器使用');
  expect(host.querySelector('input[type=email]')).toBeNull();
  expect(requests).toEqual([]);
});

test('double submission creates one invitation, shows the real result and keeps pending people out of joined members', async () => {
  await render(); await open();
  const input = host.querySelector<HTMLInputElement>('input[type=email]')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, 'invitee@example.test');
    input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event);
    input.dispatchEvent(new browser.KeyboardEvent('keyup', { key: 't', bubbles: true }) as unknown as Event);
  });
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
    form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
    await Bun.sleep(30);
  });
  await act(async () => { await Bun.sleep(30); });
  expect(createdFor).toEqual(['invitee@example.test']);
  expect(host.textContent).toContain('邀请链接已生成');
  expect(host.querySelectorAll('ul[aria-label="已加入"] li')).toHaveLength(1);
  expect(host.textContent).toContain('邀请中');
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '重新邀请')!.click(); });
  expect(input.value).toBe('invitee@example.test');
  expect(host.textContent).toContain('旧邀请链接将失效');
  await act(async () => {
    [...host.querySelectorAll('button')].find(button => button.textContent === '撤销')!.click();
    await Bun.sleep(30);
  });
  await act(async () => { await Bun.sleep(30); });
  expect(host.textContent).not.toContain('邀请链接已生成');
  expect(host.textContent).not.toContain('invitee@example.test');
});
