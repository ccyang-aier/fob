import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createKnowledgeTokenInputSchema, KnowledgeAccessError, knowledgeAccessErrorResponse, sanitizedAccess } from './access-policy';
import { issueKnowledgeToken, matchesKnowledgeToken, parseKnowledgeToken } from './token-format';

describe('PAT format and policy', () => {
  test('issues independent 256-bit secrets, canonical locators and only SHA-256 persistence values', () => {
    const knowledgeBaseId = randomUUID();
    const secrets = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const issued = issueKnowledgeToken(knowledgeBaseId);
      const parsed = parseKnowledgeToken(issued.token)!;
      expect(parsed.knowledgeBaseId).toBe(knowledgeBaseId);
      expect(parsed.tokenId).toBe(issued.tokenId);
      expect(issued.tokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
      expect(matchesKnowledgeToken(parsed.hash, issued.tokenHash)).toBe(true);
      expect(matchesKnowledgeToken(parsed.hash, undefined)).toBe(false);
      expect(matchesKnowledgeToken(parsed.hash, 'bad stored hash')).toBe(false);
      expect(matchesKnowledgeToken(parsed.hash, '0'.repeat(64))).toBe(false);
      const secret = issued.token.split('.').at(-1)!;
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
      secrets.add(secret);
    }
    expect(secrets.size).toBe(100);
  });

  test('rejects malformed IDs, encoding aliases, mixed syntax and pasted whitespace', () => {
    const issued = issueKnowledgeToken(randomUUID());
    for (const value of ['', issued.token + ' ', issued.token + '.', ' ' + issued.token,
      issued.token.replace('fob_pat.', 'pat.'), issued.token.replace(issued.tokenId, 'not-an-id'),
      issued.token.slice(0, -1), issued.token + '=', issued.token + '\n']) {
      expect(parseKnowledgeToken(value)).toBeNull();
    }
    const parts = issued.token.split('.');
    parts[3] = 'A'.repeat(42) + 'B'; // Same decoded bytes as ...A, but non-canonical padding bits.
    expect(parseKnowledgeToken(parts.join('.'))).toBeNull();
  });

  test('accepts explicit read/write scopes only and rejects identity or grant overrides', () => {
    const input = { knowledgeBaseId: randomUUID(), name: 'CLI', scopes: ['read'], expiresAt: null };
    expect(createKnowledgeTokenInputSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ scopes: [] }, { scopes: ['read', 'read'] }, { scopes: ['*'] }, { scopes: ['admin'] },
      { userId: randomUUID() }, { actor: { kind: 'agent' } }, { tokenHash: '0'.repeat(64) }, { name: ' ' }]) {
      expect(createKnowledgeTokenInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  test('sanitizes unknown errors and diagnostics without retaining credential-bearing causes', async () => {
    const diagnostic: string[] = [];
    const secret = 'postgres credentials, Authorization, and token parameters must not escape';
    let failure: unknown;
    try { await sanitizedAccess(async () => { throw new Error(secret); }, (event) => diagnostic.push(event)); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(KnowledgeAccessError);
    expect((failure as Error).cause).toBeUndefined();
    expect((failure as Error).stack).not.toContain(secret);
    expect(diagnostic).toEqual(['access_unavailable']);
    const response = knowledgeAccessErrorResponse(failure);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(sanitizedAccess(async () => { throw new Error(secret); }, () => { throw new Error(secret); }))
      .rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' });
  });
});
