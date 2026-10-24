import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { issueShareToken, matchesShareToken, parseShareToken } from './token-format';

describe('share token format', () => {
  test('issues high-entropy single-use tokens with a sha256-hex storage digest', () => {
    const issued = issueShareToken('01991428-716d-7453-8d22-f8dc8e0a9082');
    expect(issued.token).toMatch(/^fob_share\.01991428-716d-7453-8d22-f8dc8e0a9082\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toBe(createHash('sha256').update(issued.token, 'utf8').digest('hex'));
    const other = issueShareToken('01991428-716d-7453-8d22-f8dc8e0a9082');
    expect(other.token).not.toBe(issued.token);
  });

  test('parses only canonical tokens and never trusts a locator as authorization', () => {
    const issued = issueShareToken('01991428-716d-7453-8d22-f8dc8e0a9082');
    const proof = parseShareToken(issued.token)!;
    expect(proof).toEqual({ knowledgeBaseId: '01991428-716d-7453-8d22-f8dc8e0a9082', shareId: issued.shareId, hash: expect.any(Buffer) });
    expect(proof.hash.equals(createHash('sha256').update(issued.token, 'utf8').digest())).toBe(true);
    for (const malformed of [
      '', 'fob_share.x.y.z', issued.token.replace('fob_share', 'fob_pat'),
      issued.token.toUpperCase(), `${issued.token}x`, issued.token.slice(0, -1),
      issued.token.replace(/[A-Za-z0-9_-]{43}$/, 'short'), issued.token.replace(/[A-Za-z0-9_-]{43}$/, `${'a'.repeat(32)}=+`),
    ]) expect(parseShareToken(malformed)).toBeNull();
  });

  test('compares fixed 32-byte digests in constant time, including missing credentials', () => {
    const issued = issueShareToken('01991428-716d-7453-8d22-f8dc8e0a9082');
    const hash = parseShareToken(issued.token)!.hash;
    expect(matchesShareToken(hash, issued.tokenHash)).toBe(true);
    expect(matchesShareToken(hash, '0'.repeat(64))).toBe(false);
    expect(matchesShareToken(hash, undefined)).toBe(false);
    expect(matchesShareToken(hash, 'not-hex')).toBe(false);
    expect(matchesShareToken(hash, 'abc')).toBe(false);
  });
});
