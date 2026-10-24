import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type { KnowledgeApiInputs, KnowledgeApiOutputs } from './client-types';

// This consumer has no runtime router import. TypeScript checks the real router-inferred contract.
const input: KnowledgeApiInputs['access'] = { knowledgeBaseId: '20000000-0000-4000-8000-000000000000' };
const credential: KnowledgeApiOutputs['access']['credentialKind'] = 'pat';
// @ts-expect-error A knowledgeBase scope cannot be omitted by a typed client.
const missingScope: KnowledgeApiInputs['access'] = {};
// @ts-expect-error The response never returns the secret credential.
type Secret = KnowledgeApiOutputs['access']['token'];
type AssertNoSecret = Secret extends never ? true : false;

test('type-only client entry bundles for browsers without backend, PostgreSQL or auth runtime', async () => {
  expect(input.knowledgeBaseId).toBeString();
  expect(credential).toBe('pat');
  expect(Object.keys(missingScope)).toHaveLength(0);
  const unusedType: AssertNoSecret | null = null;
  expect(unusedType).toBeNull();
  const build = await Bun.build({ entrypoints: [
    fileURLToPath(new URL('./client-types.ts', import.meta.url)),
    fileURLToPath(new URL('../../../../../../src/features/knowledge/data/api-types.ts', import.meta.url)),
  ], target: 'browser' });
  expect(build.success).toBe(true);
  expect(build.outputs).toHaveLength(2);
  for (const output of build.outputs) {
    const code = await output.text();
    expect(code.length).toBeLessThan(100);
    expect(code).not.toContain('pg');
    expect(code).not.toContain('better-auth');
    expect(code).not.toContain('node:');
  }
});
