import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defineMessages, setLocale } from '@/lib/i18n';
import { useUiMessage } from './ui-message';

const messages = defineMessages({ required: ['请填写{name}', 'Enter {name}'] });
let browser: Window;
let root: Root;
let showError: (value: { key: 'required'; values: { name: string } } | string) => void;
let updateDraft: (value: string) => void;

function Harness() {
  const [draft, setDraft] = useState('未提交的正文');
  const [error, setError] = useUiMessage(messages, '');
  useEffect(() => {
    showError = setError;
    updateDraft = setDraft;
  }, [setError, setDraft]);
  return (
    <>
      <input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
      <p role="alert">{error}</p>
    </>
  );
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('zh-CN');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterAll(async () => {
  await act(async () => root.unmount());
  setLocale('zh-CN');
  await browser.happyDOM.abort();
});

test('a visible keyed error changes language while its input and draft stay mounted', async () => {
  const input = document.querySelector('input')!;
  await act(async () => {
    updateDraft('项目 Alpha 原始名称');
    showError({ key: 'required', values: { name: '项目 Alpha' } });
  });
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('请填写项目 Alpha');
  await act(async () => {
    setLocale('en-US');
  });
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('Enter 项目 Alpha');
  expect(document.querySelector('input')).toBe(input);
  expect(input.value).toBe('项目 Alpha 原始名称');
  await act(async () => {
    setLocale('zh-CN');
  });
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('请填写项目 Alpha');
});

test('an external service message stays verbatim across language changes', async () => {
  await act(async () => {
    showError('Service returned: 原始文本 42');
    setLocale('en-US');
  });
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(
    'Service returned: 原始文本 42',
  );
  await act(async () => {
    setLocale('zh-CN');
  });
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(
    'Service returned: 原始文本 42',
  );
});
