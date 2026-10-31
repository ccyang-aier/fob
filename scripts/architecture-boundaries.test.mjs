import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { dependencyIssues, reviewedSourcePath, sourceDependencies, runtimeCycles } from './architecture-boundaries.mjs';

const sharedExports = { './knowledge/schema': './src/knowledge/schema/index.ts' };
const issues = input => dependencyIssues({ sharedExports, ...input });

test('static, re-exported, lazy and type imports all enter the boundary checks', () => {
  const ast = ts.createSourceFile('fixture.ts', `import type { API } from '@fob/server/knowledge-api';
    export { value } from './implementation'; const lazy = () => import('./lazy');
    type Internal = typeof import('@fob/server/internal'); export { type Shape } from './types';`, ts.ScriptTarget.Latest, true);
  assert.deepEqual(sourceDependencies(ast), [
    { specifier: '@fob/server/knowledge-api', typeOnly: true },
    { specifier: './implementation', typeOnly: false },
    { specifier: './lazy', typeOnly: false, lazy: true },
    { specifier: '@fob/server/internal', typeOnly: true },
    { specifier: './types', typeOnly: true },
  ]);
  assert.equal(issues({ file: 'src/view.tsx', specifier: '../outside', target: '../outside.ts' }).length, 1);
});

test('cycles are detected without rejecting ordinary shared dependencies', () => {
  assert.deepEqual(runtimeCycles(new Map([['provider', ['dialog']], ['dialog', ['context']], ['context', []]])), []);
  assert.deepEqual(runtimeCycles(new Map([['provider', ['dialog']], ['dialog', ['provider']]])), [['dialog', 'provider']]);
  assert.deepEqual(runtimeCycles(new Map([['self', ['self']]])), [['self']]);
});

test('shared semantics stay independent of both application runtimes', () => {
  for (const specifier of ['react', 'react/jsx-runtime', 'next/image', '@tiptap/react', 'node:fs', 'bun'])
    assert.equal(issues({ file: 'shared/src/knowledge/schema/index.ts', specifier }).length, 1);
  assert.equal(issues({ file: 'shared/src/knowledge/schema/index.ts', specifier: '../../../src/view', target: 'src/view.tsx' }).length, 1);
  assert.equal(issues({ file: 'shared/src/knowledge/schema/index.ts', specifier: 'zod' }).length, 0);
});
test('web and service code use public shared entries and only the public server type contract', () => {
  assert.equal(issues({ file: 'src/view.tsx', specifier: '@fob/shared/knowledge/schema' }).length, 0);
  assert.equal(issues({ file: 'backend/server/src/api.ts', specifier: '@fob/shared/internal' }).length, 1);
  assert.equal(issues({ file: 'src/view.tsx', specifier: '@fob/server/knowledge-api', typeOnly: true }).length, 0);
  assert.equal(issues({ file: 'src/view.tsx', specifier: '@fob/server/knowledge-api' }).length, 1);
  assert.equal(issues({ file: 'src/view.tsx', specifier: '@fob/server/internal', typeOnly: true }).length, 1);
  assert.equal(issues({ file: 'src/view.tsx', specifier: '../../shared/src/value', target: 'shared/src/value.ts' }).length, 1);
});
test('generic UI and libraries cannot depend on feature implementations', () => {
  for (const file of ['src/components/ui/panel.tsx', 'src/lib/navigation.ts'])
    assert.equal(issues({ file, specifier: '@/features/knowledge/editor', target: 'src/features/knowledge/editor/index.ts' }).length, 1);
  assert.equal(issues({ file: 'backend/server/src/api.ts', specifier: '../../../../src/view', target: 'src/view.tsx' }).length, 1);
});
test('reviewed moves preserve origin identity and reject invalid or escaping destinations', () => {
  const original = 'src/components/widget.tsx';
  assert.equal(reviewedSourcePath(original), original);
  assert.equal(reviewedSourcePath(original, { relocatedTo: 'src/components/widget/index.tsx' }), 'src/components/widget/index.tsx');
  for (const relocatedTo of [original, '../outside.ts', '/tmp/outside.ts', 'src/../outside.ts', 'src//widget.ts', 'C:\\outside.ts', 'src\\widget.ts'])
    assert.throws(() => reviewedSourcePath(original, { relocatedTo }));
});
