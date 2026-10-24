import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AvatarGroup as AvatarGroupComponent } from './avatar-group';
import type { TooltipProvider as TooltipProviderComponent } from './ui/tooltip';
import type { setLocale as setLocaleFunction } from '@/lib/i18n';

let browser: Window;
let root: Root;
let host: HTMLDivElement;
let AvatarGroup: typeof AvatarGroupComponent;
let TooltipProvider: typeof TooltipProviderComponent;
let setLocale: typeof setLocaleFunction;
const previous = new Map<string, unknown>();
const members = [
  { id: 'ada', name: 'Ada Lovelace', image: '/avatars/ada.png' },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'margaret', name: 'Margaret Hamilton' },
  { id: 'katherine', name: 'Katherine Johnson' },
  { id: 'mary', name: 'Mary Jackson' },
] as const;

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(key, globals[key]);
    globals[key] = key === 'window' ? browser : key === 'IS_REACT_ACT_ENVIRONMENT' ? true : (browser as unknown as Record<string, unknown>)[key];
  }
  AvatarGroup = (await import('./avatar-group')).AvatarGroup;
  TooltipProvider = (await import('./ui/tooltip')).TooltipProvider;
  setLocale = (await import('@/lib/i18n')).setLocale;
});

beforeEach(() => {
  setLocale('zh-CN');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

afterAll(async () => {
  await browser.happyDOM.abort();
  const globals = globalThis as Record<string, unknown>;
  for (const [key, value] of previous) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
});

async function render(children: ReactNode) {
  await act(async () => root.render(<TooltipProvider delayDuration={0}>{children}</TooltipProvider>));
}

async function hover(target: Element) {
  await act(async () => target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })));
  for (let turn = 0; turn < 30 && !document.querySelector('[role="tooltip"]'); turn++) {
    await act(async () => { await Bun.sleep(0); });
  }
}

test('no members renders no avatar or placeholder', async () => {
  await render(<AvatarGroup members={[]} />);
  expect(host.childElementCount).toBe(0);
});

test('default group shows three real members and only the remaining count', async () => {
  await render(<AvatarGroup members={members} />);
  const group = host.querySelector<HTMLElement>('[role="group"]')!;
  const portraits = group.querySelectorAll('[role="img"]');
  expect(group.getAttribute('aria-label')).toBe('5 位成员');
  expect(portraits.length).toBe(4);
  expect([...portraits].slice(0, 3).map(portrait => portrait.getAttribute('aria-label'))).toEqual(members.slice(0, 3).map(member => member.name));
  expect(portraits[0].querySelector('img')?.getAttribute('src')).toBe('/avatars/ada.png');
  expect(portraits[1].textContent).toBe('G');
  expect(portraits[3].textContent).toBe('+2');
  expect(portraits[3].getAttribute('aria-label')).toContain('Katherine Johnson');
  expect(portraits[3].getAttribute('aria-label')).toContain('Mary Jackson');
  expect(portraits[3].getAttribute('aria-label')).not.toContain('Ada Lovelace');
});

test('header size, maximum and caller button are preserved without nested controls', async () => {
  let clicks = 0;
  await render(<button type="button" aria-label="打开成员" onClick={() => { clicks++; }}><AvatarGroup members={members.slice(0, 2)} maxVisible={4} size={28} className="header-group" /></button>);
  const group = host.querySelector<HTMLElement>('[role="group"]')!;
  expect(group.style.getPropertyValue('--avatar-group-size')).toBe('28px');
  expect(group.classList.contains('header-group')).toBe(true);
  expect(group.querySelectorAll('[role="img"]').length).toBe(2);
  expect(group.textContent).not.toContain('+');
  expect(host.querySelectorAll('button').length).toBe(1);
  expect(group.querySelector('[tabindex]')).toBeNull();
  await act(async () => group.querySelector<HTMLElement>('[role="img"]')!.click());
  expect(clicks).toBe(1);
});

test('shared tooltips expose individual names and only the hidden members', async () => {
  await render(<AvatarGroup members={members} maxVisible={1} />);
  await hover(host.querySelector('[role="img"]')!);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Ada Lovelace');
  await act(async () => host.querySelector('[role="img"]')!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' })));
  await render(<AvatarGroup key="remaining" members={members} maxVisible={1} />);
  await hover(host.querySelectorAll('[role="img"]')[1]);
  const text = document.querySelector('[role="tooltip"]')?.textContent;
  expect(text).toContain('其余 4 位成员');
  expect(text).toContain('Grace Hopper');
  expect(text).toContain('Mary Jackson');
  expect(text).not.toContain('Ada Lovelace');
});

test('accessible member and overflow labels update with the current language', async () => {
  await render(<AvatarGroup members={members} />);
  await act(async () => setLocale('en-US'));
  expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Members: 5');
  const overflow = host.querySelectorAll('[role="img"]')[3];
  expect(overflow.getAttribute('aria-label')).toBe('More members (2): Katherine Johnson and Mary Jackson');
});
