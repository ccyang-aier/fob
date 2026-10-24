import { describe, expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import type { Schema } from '@tiptap/pm/model';
import { Schema as PmSchema } from '@tiptap/pm/model';
import { KnowledgeDataError } from '../data/errors';
import { buildRestoreTransaction, checkpointBodyToNode } from './restore';
import { createHistoryApi, parseCheckpointList } from './history-api';

/** A minimal editor-shaped schema with real toDOM specs, like TipTap builds. */
const schema = new PmSchema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
}) as Schema;
const doc = (...texts: string[]) => schema.node('doc', null, texts.map((text) => schema.node('paragraph', null, [schema.text(text)])));

describe('checkpoint body decoding (V03)', () => {
  test('valid doc JSON decodes; anything else is null, never a half-parse', () => {
    expect(checkpointBodyToNode(doc('A').toJSON(), schema)?.textContent).toBe('A');
    expect(checkpointBodyToNode({ type: 'paragraph' }, schema)).toBeNull();
    expect(checkpointBodyToNode('nope', schema)).toBeNull();
    expect(checkpointBodyToNode({ type: 'doc', content: [{ type: 'nonexistent' }] }, schema)).toBeNull();
  });

  test('restore is one replaceWith step onto the given editor state', () => {
    const state = EditorState.create({ doc: doc('Version A', 'Version B') });
    const transaction = buildRestoreTransaction(state, doc('Restored only').toJSON())!;
    expect(transaction).not.toBeNull();
    expect(transaction.steps).toHaveLength(1);
    const applied = state.apply(transaction).doc;
    expect(applied.textContent).toBe('Restored only');
    // The restoring user's history sees one undoable step, not per-block churn.
    expect(applied.childCount).toBe(1);
  });

  test('an undecodable checkpoint never produces a transaction', () => {
    const state = EditorState.create({ doc: doc('Current') });
    expect(buildRestoreTransaction(state, { type: 'bogus' })).toBeNull();
  });
});

describe('history api client', () => {
  const deps = (status: number, payload: unknown) => ({
    resolveOrigin: async () => ({ origin: 'http://api.test' }),
    fetchImpl: (async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  });

  test('list parses only well-formed entries and drops the rest', () => {
    const payload = { checkpoints: [
      { checkpointId: 'a', pageId: 'p', label: '基线', authors: ['u1'], createdAt: '2026-09-26T10:00:00Z' },
      { checkpointId: 42 }, { checkpointId: 'b', label: null, authors: [], createdAt: '2026-09-26T11:00:00Z' }, 'junk',
    ] };
    expect(parseCheckpointList(payload)).toHaveLength(2);
    expect(parseCheckpointList({})).toEqual([]);
  });

  test('http failures surface as structured data errors', async () => {
    const api = createHistoryApi(deps(403, { code: 'FORBIDDEN' }));
    await expect(api.list('ws', 'p1')).rejects.toMatchObject({ code: 'FORBIDDEN' } satisfies Partial<KnowledgeDataError>);
    const missing = createHistoryApi(deps(404, { code: 'CHECKPOINT_NOT_FOUND' }));
    await expect(missing.preview('ws', 'p1', 'gone')).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<KnowledgeDataError>);
  });

  test('name posts the label as JSON', async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = createHistoryApi({
      resolveOrigin: async () => ({ origin: 'http://api.test' }),
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ path: String(_url), init: init ?? {} });
        return new Response(JSON.stringify({ outcome: 'created', checkpointId: 'c1' }), { status: 201 });
      }) as typeof fetch,
    });
    const result = await api.name('ws', 'p1', '评审基线');
    expect(result.outcome).toBe('created');
    expect(calls[0]!.path).toBe('http://api.test/api/knowledge/ws/pages/p1/checkpoints');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe(JSON.stringify({ label: '评审基线' }));
  });
});
