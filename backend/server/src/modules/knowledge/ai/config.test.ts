import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelSettingsSchema } from '@fob/shared/knowledge/contracts';
import { resolveModel } from './config';
import type { ModelCredential, PlatformModels } from './config';

const knowledgeBaseId = '01991428-716d-7453-8d22-f8dc8e0a9081', userId = '01991428-716d-7453-8d22-f8dc8e0a9082', credentialId = '01991428-716d-7453-8d22-f8dc8e0a9083';
const platform: PlatformModels = { defaults: { fast: { source: 'platform', provider: 'openai', model: 'configured-fast-model' } }, providers: { openai: { apiKey: 'server-only-key' } } };
const credential: ModelCredential = { id: credentialId, knowledgeBaseId, userId, provider: 'anthropic', apiKey: 'user-only-key', revokedAt: null };
const base = { knowledgeBaseId, userId, tier: 'fast' as const, settings: {}, platform, credentials: [credential] };

test('knowledgeBase override, platform defaults and local Ollama resolve without silent model substitution', () => {
  assert.equal(resolveModel(base).apiKey, 'server-only-key');
  assert.equal(resolveModel({ ...base, settings: { fast: { source: 'byok', provider: 'anthropic', model: 'chosen-model', credentialId } } }).apiKey, 'user-only-key');
  const local = resolveModel({ ...base, settings: { fast: { source: 'ollama', model: 'local-model', endpoint: 'http://localhost:11434/' } } });
  assert.equal(local.endpoint, 'http://localhost:11434');
  assert.equal(local.apiKey, undefined);
  assert.throws(() => resolveModel({ ...base, tier: 'smart' }), /No model configured/);
});

test('BYOK is restricted to credential owner, knowledgeBase, provider and non-revoked state', () => {
  const settings = { fast: { source: 'byok' as const, provider: 'anthropic', model: 'chosen-model', credentialId } };
  for (const change of [{ userId: 'another-user' }, { knowledgeBaseId: 'another-knowledgeBase' }, { provider: 'openai' }, { revokedAt: '2026-09-26T00:00:00Z' }]) {
    assert.throws(() => resolveModel({ ...base, settings, credentials: [{ ...credential, ...change }] }), /unavailable/);
  }
});

test('public settings cannot contain secrets, and embedding dimensions cannot leak into another tier', () => {
  assert.equal(modelSettingsSchema.safeParse({ fast: { source: 'platform', provider: 'openai', model: 'fast', apiKey: 'secret' } }).success, false);
  assert.equal(modelSettingsSchema.safeParse({ embed: { source: 'ollama', model: 'embedding', endpoint: 'http://localhost:11434', dimensions: 768 } }).success, true);
  assert.equal(modelSettingsSchema.safeParse({ embed: { source: 'platform', provider: 'openai', model: 'embedding' } }).success, false);
  assert.equal(modelSettingsSchema.safeParse({ fast: { source: 'platform', provider: 'openai', model: 'fast', dimensions: 768 } }).success, false);
  for (const endpoint of ['not a URL', 'file:///etc/passwd', 'https://secret:password@example.com', 'https://example.com?key=secret']) {
    assert.equal(modelSettingsSchema.safeParse({ fast: { source: 'ollama', model: 'local', endpoint } }).success, false);
  }
});
