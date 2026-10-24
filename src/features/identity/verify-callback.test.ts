import { describe, expect, test } from 'bun:test';
import { parseVerifyEmailQuery, verifyEmailErrorCopy } from './verify-callback';

describe('parseVerifyEmailQuery', () => {
  test('success marker (both legacy and exact) yields the verified view', () => {
    expect(parseVerifyEmailQuery('?status=verified')).toEqual({ kind: 'verified' });
    expect(parseVerifyEmailQuery('?status=ok')).toEqual({ kind: 'verified' });
  });

  test('the backend appends error to a URL that already carries the success marker', () => {
    expect(parseVerifyEmailQuery('?status=verified&error=TOKEN_EXPIRED')).toEqual({ kind: 'error', code: 'TOKEN_EXPIRED' });
    expect(parseVerifyEmailQuery('?error=INVALID_TOKEN&status=ok')).toEqual({ kind: 'error', code: 'INVALID_TOKEN' });
  });

  test('contract codes map verbatim; unknown codes degrade to INVALID_TOKEN', () => {
    expect(parseVerifyEmailQuery('?error=USER_NOT_FOUND')).toEqual({ kind: 'error', code: 'USER_NOT_FOUND' });
    expect(parseVerifyEmailQuery('?error=INVALID_USER')).toEqual({ kind: 'error', code: 'INVALID_USER' });
    expect(parseVerifyEmailQuery('?error=surprise')).toEqual({ kind: 'error', code: 'INVALID_TOKEN' });
    expect(parseVerifyEmailQuery('?error=')).toEqual({ kind: 'manual' });
  });

  test('a bare visit is a manual guidance view', () => {
    expect(parseVerifyEmailQuery('')).toEqual({ kind: 'manual' });
    expect(parseVerifyEmailQuery('?utm_source=mail')).toEqual({ kind: 'manual' });
  });
});

describe('verifyEmailErrorCopy', () => {
  test('expired and used links offer a resend; missing/mismatched accounts do not', () => {
    expect(verifyEmailErrorCopy('TOKEN_EXPIRED').resend).toBe(true);
    expect(verifyEmailErrorCopy('INVALID_TOKEN').resend).toBe(true);
    expect(verifyEmailErrorCopy('USER_NOT_FOUND').resend).toBe(false);
    expect(verifyEmailErrorCopy('INVALID_USER').resend).toBe(false);
  });

  test('copy explains the 1-hour validity window', () => {
    expect(verifyEmailErrorCopy('TOKEN_EXPIRED').description).toContain('1 小时');
  });
});
