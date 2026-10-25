/**
 * Tests of the slash menu item model (E06): the list is generated from the
 * shared E01 registry's `slash` metadata, every item's insert command succeeds
 * on a real Tiptap Editor over the shared schema (producing a node of its own
 * type — atom blocks included, with E02 blockIds minted by the blockId
 * plugin), `registerSlashInsert` extends/overrides the command map, and the
 * query filter ranks prefix > substring > keyword while keeping menu order
 * otherwise.
 */

import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { setLocale } from '@/lib/i18n';
import {
  createKnowledgeExtensions,
  createKnowledgeRegistry,
  defineBlock,
  KNOWLEDGE_BLOCKS,
} from '@fob/shared/knowledge/schema';
import type { BlockDefinition } from '@fob/shared/knowledge/schema';
import { setBlockFormat } from '../extensions/format/block-format';
import { buildSlashItems, filterSlashItems, registerSlashInsert } from './slash-items';
import type { SlashMenuItem } from './slash-items';

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of [
    'document',
    'DOMParser',
    'MutationObserver',
    'Range',
    'getSelection',
    'HTMLElement',
    'Element',
    'Node',
    'Text',
    'Comment',
    'customElements',
    'requestAnimationFrame',
  ]) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

function mountEditor(): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const editor = new Editor({
    element: host as unknown as HTMLElement,
    extensions: [...createKnowledgeExtensions()],
  });
  editor.commands.focus('end');
  return editor;
}

/** Every node type name present in the document, depth-first. */
function nodeNames(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.descendants((node) => {
    names.push(node.type.name);
    return true;
  });
  return names;
}

describe('slash menu items', () => {
  test('the menu is generated from the registry slash metadata', () => {
    const items = buildSlashItems();
    const expected = KNOWLEDGE_BLOCKS.filter((definition) => definition.slash);
    expect(new Set(items.map((item) => item.name === 'bilibili' ? 'embed' : item.name.replace(/^heading[134]$/, 'heading')))).toEqual(
      new Set(expected.map((definition) => definition.name)),
    );
    expect(items.slice(0, 4).map((item) => item.marker)).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect(
      items.filter((item) => item.name.startsWith('heading')).map((item) => item.group),
    ).toEqual(['text', 'text', 'text', 'text']);
    // No structural child (listItem, tableRow, column…) ever shows in the menu.
    for (const hidden of [
      'listItem',
      'taskItem',
      'tableRow',
      'tableCell',
      'tableHeader',
      'column',
    ]) {
      expect(items.some((item) => item.name === hidden)).toBe(false);
    }
  });

  test('non-picker items insert their own valid node type into a real editor', () => {
    const items = buildSlashItems();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items.filter((item) => !['image', 'video', 'audio'].includes(item.name))) {
      const editor = mountEditor(); // one empty paragraph, caret at its end
      expect(item.run(editor)).toBe(true);
      const names = nodeNames(editor);
      expect(names).toContain(item.name.startsWith('heading') ? 'heading' : item.name === 'bilibili' ? 'embed' : item.name);
      editor.state.doc.check(); // every insertion leaves a valid document
      editor.destroy();
    }
  });

  test('converters restyle the trigger block instead of appending (paragraph/heading/lists)', () => {
    const items = new Map(buildSlashItems().map((item) => [item.name, item]));
    const editor = mountEditor();
    items.get('heading')!.run(editor);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.state.doc.childCount).toBe(1);
    items.get('paragraph')!.run(editor);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.doc.childCount).toBe(1);
    editor.destroy();
  });

  test('heading choices apply all four real heading levels', () => {
    const items = buildSlashItems().filter((item) => item.name.startsWith('heading'));
    for (const [index, item] of items.entries()) {
      const editor = mountEditor();
      expect(item.run(editor)).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.level).toBe(index + 1);
      editor.destroy();
    }
  });

  test('table insertion starts with a three-by-three grid and a header row', () => {
    const editor = mountEditor();
    expect(
      buildSlashItems()
        .find((item) => item.name === 'table')!
        .run(editor),
    ).toBe(true);
    const table = editor.state.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.firstChild?.childCount).toBe(3);
    expect(table.lastChild?.childCount).toBe(3);
    expect(table.firstChild?.firstChild?.type.name).toBe('tableHeader');
    editor.destroy();
  });

  test('registerSlashInsert overrides built-ins and adds future entries', () => {
    const items = buildSlashItems();
    const builtIn = items.find((item) => item.name === 'heading')!;
    let overrideCalls = 0;
    registerSlashInsert('heading', (editor) => {
      overrideCalls += 1;
      return builtIn.run(editor);
    });
    try {
      const editor = mountEditor();
      const overridden = buildSlashItems().find((item) => item.name === 'heading')!;
      overridden.run(editor);
      expect(overrideCalls).toBe(1);
      expect(editor.state.doc.firstChild?.type.name).toBe('heading');
      editor.destroy();

      // A registry block with slash metadata but no built-in command stays
      // listed and fails honestly until one is registered.
      const extension: BlockDefinition = defineBlock({
        name: 'spacerBlock',
        schema: { content: 'inline*', toDOM: () => ['div', { 'data-spacer': '' }, 0] },
        markdown: { fromMd: { type: 'paragraph' } },
        index: { mode: 'skip' },
        slash: { title: '占位块', keywords: ['spacer'], group: 'layout' },
      });
      const registry = createKnowledgeRegistry({ blocks: [extension] });
      const custom = buildSlashItems(registry);
      expect(custom.map((item) => item.name)).toContain('spacerBlock');
      const unregistered = mountEditor();
      expect(custom.find((item) => item.name === 'spacerBlock')!.run(unregistered)).toBe(false);
      unregistered.destroy();
      registerSlashInsert('spacerBlock', (editor) =>
        editor
          .chain()
          .focus()
          .command(setBlockFormat({ kind: 'heading', level: 3 }))
          .run(),
      );
      const registered = mountEditor();
      expect(
        buildSlashItems(registry)
          .find((item) => item.name === 'spacerBlock')!
          .run(registered),
      ).toBe(true);
      expect(registered.state.doc.firstChild?.type.name).toBe('heading');
      registered.destroy();
    } finally {
      registerSlashInsert('heading', (editor) => builtIn.run(editor));
    }
  });
});

describe('filterSlashItems', () => {
  const items: SlashMenuItem[] = buildSlashItems();

  test('an empty query returns every item in menu order', () => {
    expect(filterSlashItems(items, '')).toEqual(items);
    expect(filterSlashItems(items, '   ')).toEqual(items);
  });

  test('title prefixes outrank substrings, which outrank keyword hits', () => {
    // '表格' is the table title itself; no other title or keyword contains it.
    expect(filterSlashItems(items, '表格').map((item) => item.name)).toEqual(['table']);
    // '列' hits three list titles — all substring rank, registry order kept.
    const lists = filterSlashItems(items, '列');
    expect(lists.map((item) => item.name)).toEqual(['taskList', 'bulletList', 'orderedList']);
    expect(lists.every((item) => item.title.includes('列'))).toBe(true);
    // 'code' is a keyword of 代码 (no title matches it).
    expect(filterSlashItems(items, 'code').map((item) => item.name)).toEqual(['codeBlock']);
    // Prefix tier first: '表' prefixes 表格 even though nothing else matches.
    expect(filterSlashItems(items, '表')[0]?.name).toBe('table');
  });

  test('matching is case-insensitive and misses are empty', () => {
    expect(filterSlashItems(items, 'TODO').map((item) => item.name)).toEqual(['taskList']);
    expect(filterSlashItems(items, 'zzz')).toEqual([]);
  });

  test('an existing menu updates its product titles and filtering without replacing commands', () => {
    const existing = buildSlashItems();
    const table = existing.find((item) => item.name === 'table')!;
    const command = table.run;
    try {
      setLocale('en-US');
      expect(table.title).toBe('Table');
      expect(filterSlashItems(existing, 'table', 'en-US')[0]).toBe(table);
      expect(table.run).toBe(command);
      setLocale('zh-CN');
      expect(table.title).toBe('表格');
      expect(filterSlashItems(existing, '表格', 'zh-CN')[0]).toBe(table);
    } finally {
      setLocale('zh-CN');
    }
  });
});
