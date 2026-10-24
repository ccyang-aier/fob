import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumentAppearanceProvider, useDocumentAppearance } from './document-appearance';

let root: Root;
const browser = new Window({ url: 'http://localhost:3000/' });
beforeAll(() => {
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

function Probe() {
  const { appearance, update } = useDocumentAppearance();
  return <><output>{JSON.stringify(appearance)}</output><button onClick={() => update({ width: 65, font: 'wenkai', lineHeight: 2, paragraphSpacing: 'relaxed' })}>调整当前文档</button></>;
}
async function render(scope: string) {
  await act(async () => root.render(<DocumentAppearanceProvider key={scope} scope={scope}><Probe /></DocumentAppearanceProvider>));
}
function current() { return JSON.parse(document.querySelector('output')!.textContent!); }

test('persists all six personal controls without changing another document', async () => {
  await render('first');
  expect(current()).toEqual({ font: 'default', codeFont: 'default', width: 80, size: 'standard', lineHeight: 1.8, paragraphSpacing: 'standard' });
  await act(async () => document.querySelector('button')!.click());
  expect(current()).toEqual({ width: 65, font: 'wenkai', codeFont: 'default', size: 'standard', lineHeight: 2, paragraphSpacing: 'relaxed' });
  expect(JSON.parse(localStorage.getItem('fob.document.appearance:first')!)).toEqual(current());
  await render('second');
  expect(current()).toEqual({ font: 'default', codeFont: 'default', width: 80, size: 'standard', lineHeight: 1.8, paragraphSpacing: 'standard' });
  await render('first');
  expect(current()).toMatchObject({ width: 65, font: 'wenkai', lineHeight: 2, paragraphSpacing: 'relaxed' });
});
