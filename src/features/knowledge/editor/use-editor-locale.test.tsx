import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { TextSelection } from '@tiptap/pm/state';
import { history, undoDepth } from '@tiptap/pm/history';
import { useTranslation, defineMessages, setLocale } from '@/lib/i18n';
import { editorLocaleMeta, useEditorLocale } from './use-editor-locale';

const messages = defineMessages({ ready: ['就绪', 'Ready'] });
let browser: Window;
let root: Root;
let editor: Editor;
const metas: unknown[] = [];

function Harness() {
  const { locale, t } = useTranslation(messages);
  useEditorLocale(editor, locale, t('ready'), t('ready'));
  return <span>{t('ready')}</span>;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Text',
    'DOMParser',
    'MutationObserver',
    'getSelection',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ])
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  const host = document.createElement('div');
  document.body.append(host);
  editor = new Editor({
    element: host,
    extensions: createKnowledgeExtensions(),
    content: '<p>原始内容 Alpha</p>',
    editorProps: { attributes: { role: 'textbox', class: 'existing-editor' } },
  });
  editor.registerPlugin(history());
  editor.on('transaction', ({ transaction }) => {
    if (transaction.getMeta(editorLocaleMeta)) metas.push(transaction.getMeta(editorLocaleMeta));
  });
  const controls = document.createElement('div');
  document.body.append(controls);
  root = createRoot(controls);
  await act(async () => root.render(<Harness />));
});

afterAll(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  setLocale('zh-CN');
  await browser.happyDOM.abort();
});

test('language refreshes editor presentation without replacing its document, selection or undo history', async () => {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)).insertText('草稿'),
  );
  const doc = editor.state.doc;
  const selection = editor.state.selection;
  const historySize = undoDepth(editor.state);
  const surface = editor.view.dom;
  surface.focus();
  expect(document.activeElement).toBe(surface);
  await act(async () => {
    setLocale('en-US');
  });
  expect(metas.at(-1)).toBe('en-US');
  expect(editor.state.doc).toBe(doc);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(undoDepth(editor.state)).toBe(historySize);
  expect(document.body.textContent).toContain('Ready');
  expect(editor.view.dom).toBe(surface);
  expect(surface.getAttribute('aria-label')).toBe('Ready');
  expect(surface.getAttribute('data-placeholder')).toBe('Ready');
  expect(surface.getAttribute('role')).toBe('textbox');
  expect(surface.classList.contains('existing-editor')).toBe(true);
  expect(document.activeElement).toBe(surface);
  await act(async () => {
    setLocale('zh-CN');
  });
  expect(metas.at(-1)).toBe('zh-CN');
  expect(editor.state.doc).toBe(doc);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(undoDepth(editor.state)).toBe(historySize);
  expect(surface.getAttribute('aria-label')).toBe('就绪');
  expect(surface.getAttribute('data-placeholder')).toBe('就绪');
  expect(document.activeElement).toBe(surface);
});
