import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { decodePageIcon, encodePageIcon, PageIcon } from './page-icon';
import type { PageIconPicker as Picker } from './page-icon-picker';
import type { DocumentOutline as Outline } from '../editor/components/document-outline';

let browser: Window;
let root: Root;
let PageIconPicker: typeof Picker;
let DocumentOutline: typeof Outline;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ])
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  PageIconPicker = (await import('./page-icon-picker')).PageIconPicker;
  DocumentOutline = (await import('../editor/components/document-outline')).DocumentOutline;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterAll(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
});
async function click(selector: string) {
  const button = document.querySelector<HTMLElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
}
async function openPicker() {
  await act(async () => {
    document
      .querySelector<HTMLElement>('[aria-label="添加文档图标"], [aria-label="更改文档图标"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
  });
}
test('named icons retain literal colors; unknown glyphs and injected styles are rejected', () => {
  const encoded = encodePageIcon('graduation-cap', '#9955E8');
  expect(encoded).toBe('glyph:graduation-cap:#9955e8');
  expect(decodePageIcon(encoded)?.id).toBe('graduation-cap');
  expect(decodePageIcon(encoded)?.color).toBe('#9955e8');
  expect(decodePageIcon('🎓')).toBeNull();
  expect(decodePageIcon('glyph:missing:#526175')).toBeNull();
  expect(decodePageIcon('glyph:star:url(https://example.com)')).toBeNull();
  expect(() => encodePageIcon('star', 'red;background:black')).toThrow();
});
test('icon selection, recoloring, emoji and removal update the same rendered metadata', async () => {
  function Harness() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <>
        <PageIconPicker value={value} onChange={async (next) => setValue(next)} />
        <div data-navigation>
          <PageIcon value={value} />
        </div>
      </>
    );
  }
  await act(async () => root.render(<Harness />));
  await openPicker();
  await click('[aria-label="图标颜色 #9955e8"]');
  await click('[aria-label="学士帽"]');
  expect(
    document.querySelector('[data-navigation] [data-page-icon]')?.getAttribute('data-page-icon'),
  ).toBe('glyph:graduation-cap:#9955e8');
  await openPicker();
  await click('[aria-label="图标颜色 #0863d1"]');
  expect(
    document.querySelector('[data-navigation] [data-page-icon]')?.getAttribute('data-page-icon'),
  ).toBe('glyph:graduation-cap:#0863d1');
  await click('[role="tab"][aria-selected="false"]');
  await click('[aria-label="火箭"]');
  expect(document.querySelector('[data-navigation] [data-page-icon]')?.textContent).toBe('🚀');
  await openPicker();
  await act(async () => {
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === '移除')!
      .click();
  });
  expect(document.querySelector('[data-navigation] [data-page-icon]')).toBeNull();
});
test('failed persistence keeps the picker available, read-only metadata has no editing entry', async () => {
  await act(async () =>
    root.render(
      <PageIconPicker
        key="fail"
        value={null}
        onChange={async () => {
          throw new Error('denied');
        }}
      />,
    ),
  );
  await openPicker();
  await click('[aria-label="学士帽"]');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('图标保存失败，请重试');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    root.render(
      <PageIconPicker
        editable={false}
        value="🎓"
        onChange={async () => {
          throw new Error('unexpected');
        }}
      />,
    ),
  );
  expect(document.querySelector('[aria-label="更改文档图标"]')).toBeNull();
  expect(document.querySelector('[data-page-icon]')?.textContent).toBe('🎓');
});
test('collapse hides the real descendants, survives changed positions, and leaf navigation stays independent', async () => {
  let navigation = -1;
  const headings = [
    { id: 'a', pos: 0, level: 1, title: 'A' },
    { id: 'b', pos: 5, level: 3, title: 'B' },
    { id: 'c', pos: 9, level: 4, title: 'C' },
    { id: 'd', pos: 14, level: 1, title: 'D' },
  ];
  const render = async (items: typeof headings) => {
    await act(async () =>
      root.render(
        <DocumentOutline
          id="outline"
          headings={items}
          activeHeading={2}
          onClose={() => {}}
          onNavigate={(index) => {
            navigation = index;
          }}
        />,
      ),
    );
  };
  await render(headings);
  await click('[title="A"]');
  expect(document.querySelector('[title="B"]')).toBeNull();
  expect(document.querySelector('[title="C"]')).toBeNull();
  expect(document.querySelector('[title="D"]')).not.toBeNull();
  expect(navigation).toBe(-1);
  await render(headings.map((heading) => ({ ...heading, pos: heading.pos + 10 })));
  expect(document.querySelector('[title="B"]')).toBeNull();
  await click('[title="A"]');
  await click('[title="C"]');
  expect(navigation).toBe(2);
  expect(document.querySelector('[aria-current="location"]')?.textContent).toBe('C');
});
