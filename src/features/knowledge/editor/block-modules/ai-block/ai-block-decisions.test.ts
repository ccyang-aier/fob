import { Window } from 'happy-dom';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { collectSuggestions, newSuggestion } from '@fob/shared/knowledge/schema/suggestions';
import { acceptAiBlock, aiDraftMarkdown, findAiBlock, selectAiDraft, undoAiBlock } from './ai-block-decisions';

let browser: Window;
const editors: Editor[] = [];
beforeAll(() => {
  browser = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser;
});
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(editable = true) {
  const editor = new Editor({ extensions: createKnowledgeExtensions(), editable });
  editors.push(editor);
  const schema = editor.schema;
  const proposal = (id: string, text: string) => {
    const metadata = newSuggestion('agent:generated-task', { suggestionId: id });
    return schema.nodes.paragraph.create({ annotations: [{ type: 'suggestion_insert', attrs: metadata }] }, schema.text(text, [schema.marks.suggestion_insert.create(metadata)]));
  };
  editor.commands.setContent(schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text('原有正文')),
    schema.nodes.aiBlock.create({ blockId: 'draft', taskId: 'generation' }, [
      schema.nodes.paragraph.create(null, schema.text('手动补充')),
      proposal('draft-proposal', '生成草稿'),
    ]),
    proposal('other-proposal', '其它建议'),
  ]).toJSON());
  return editor;
}

describe('AI draft decisions', () => {
  test('completion selects the actual draft text without changing its proposal or neighbouring content', () => {
    const editor = mount(), before = editor.state.doc;
    expect(selectAiDraft(editor, 'draft')).toBe(true);
    expect(editor.state.doc).toBe(before);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')).toBe('手动补充\n生成草稿');
    expect(selectAiDraft(editor, 'missing')).toBe(false);
    editor.setEditable(false);
    expect(selectAiDraft(editor, 'draft')).toBe(false);
  });
  test('revision context preserves real Mermaid source instead of reducing rich blocks to empty text', () => {
    const editor = mount(), schema = editor.schema;
    const draft = schema.nodes.aiBlock.create(null, [schema.nodes.mermaid.create({ source: 'flowchart LR\nA --> B' })]);
    expect(aiDraftMarkdown(draft)).toContain('```mermaid\nflowchart LR\nA --> B\n```');
  });
  test('accept resolves only this draft and unwraps it into ordinary blocks in one transaction', () => {
    const editor = mount();
    let documentTransactions = 0;
    editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) documentTransactions++; });
    expect(acceptAiBlock(editor, 'draft')).toBe(true);
    expect(documentTransactions).toBe(1);
    expect(findAiBlock(editor.state.doc, 'draft')).toBeNull();
    expect(editor.state.doc.textContent).toBe('原有正文手动补充生成草稿其它建议');
    expect(collectSuggestions(editor.state.doc).map(item => item.suggestionId)).toEqual(['other-proposal']);
    editor.state.doc.check();
  });
  test('undo rejects only generated content in the draft and clears its stale task', () => {
    const editor = mount();
    expect(undoAiBlock(editor, 'draft')).toBe(true);
    const draft = findAiBlock(editor.state.doc, 'draft')!.node;
    expect(draft.textContent).toBe('手动补充');
    expect(draft.attrs.taskId).toBeNull();
    expect(editor.state.doc.textContent).toBe('原有正文手动补充其它建议');
    expect(collectSuggestions(editor.state.doc).map(item => item.suggestionId)).toEqual(['other-proposal']);
    expect(undoAiBlock(editor, 'draft')).toBe(false);
    editor.state.doc.check();
  });
  test('read-only and missing drafts cannot change the document', () => {
    const editor = mount(false), original = editor.state.doc;
    expect(acceptAiBlock(editor, 'draft')).toBe(false);
    expect(undoAiBlock(editor, 'draft')).toBe(false);
    expect(editor.state.doc).toBe(original);
    editor.setEditable(true);
    expect(acceptAiBlock(editor, 'missing')).toBe(false);
    expect(undoAiBlock(editor, 'missing')).toBe(false);
    expect(editor.state.doc).toBe(original);
  });
});
