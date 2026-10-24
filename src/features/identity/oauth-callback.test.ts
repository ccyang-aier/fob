import { describe, expect, test } from 'bun:test';
import { oauthCallbackErrorCopy, parseOAuthCallbackQuery } from './oauth-callback';

describe('parseOAuthCallbackQuery', () => {
  test('error param produces an error view with a known code', () => {
    expect(parseOAuthCallbackQuery('?error=access_denied')).toEqual({ kind: 'error', code: 'access_denied' });
    expect(parseOAuthCallbackQuery('?error=oauth_provider_error')).toEqual({ kind: 'error', code: 'oauth_provider_error' });
    expect(parseOAuthCallbackQuery('?error=state_mismatch')).toEqual({ kind: 'error', code: 'state_mismatch' });
    expect(parseOAuthCallbackQuery('?error=oauth_identity_rejected')).toEqual({ kind: 'error', code: 'oauth_identity_rejected' });
  });

  test('unknown codes degrade to oauth_provider_error, never echoed verbatim', () => {
    expect(parseOAuthCallbackQuery('?error=exotic_new_failure')).toEqual({ kind: 'error', code: 'oauth_provider_error' });
  });

  test('error_description is accepted and dropped (copy is code-keyed only)', () => {
    const view = parseOAuthCallbackQuery('?error=access_denied&error_description=external%20secret%20text');
    expect(view).toEqual({ kind: 'error', code: 'access_denied' });
    const copy = view.kind === 'error' ? oauthCallbackErrorCopy(view.code) : null;
    expect(copy === null || (copy.title + copy.description).includes('external secret text')).toBe(false);
  });

  test('status=ok marks a completed round-trip even alongside other params', () => {
    expect(parseOAuthCallbackQuery('?status=ok')).toEqual({ kind: 'completed' });
    expect(parseOAuthCallbackQuery('?foo=1&status=ok&bar=2')).toEqual({ kind: 'completed' });
  });

  test('the error param outranks status=ok (the backend appends error to our URL)', () => {
    expect(parseOAuthCallbackQuery('?status=ok&error=TOKEN_EXPIRED')).toEqual({ kind: 'error', code: 'oauth_provider_error' });
  });

  test('bare and unrelated URLs are manual visits', () => {
    expect(parseOAuthCallbackQuery('')).toEqual({ kind: 'manual' });
    expect(parseOAuthCallbackQuery('?code=abc&state=xyz')).toEqual({ kind: 'manual' });
    expect(new URLSearchParams('')).toEqual(new URLSearchParams(''));
    expect(parseOAuthCallbackQuery(new URLSearchParams(''))).toEqual({ kind: 'manual' });
  });
});

describe('oauthCallbackErrorCopy — every contract code has fixed Chinese copy', () => {
  const contractCodes = [
    'access_denied', 'oauth_provider_error', 'invalid_callback_request', 'state_not_found', 'state_mismatch',
    'state_invalid', 'state_security_mismatch', 'no_code', 'oauth_provider_not_found', 'issuer_mismatch',
    'nonce_binding_missing', 'invalid_code', 'unable_to_get_user_info', 'no_callback_url', 'unable_to_link_account',
    'email_does_not_match', 'account_already_linked_to_different_user', 'email_not_found', 'email_not_verified',
    'oauth_identity_rejected', 'oauth_session_changed', 'internal_server_error',
  ];

  test('known codes map to dedicated copy', () => {
    for (const code of contractCodes) {
      const copy = oauthCallbackErrorCopy(code);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(['retry', 'switch-way', 'support']).toContain(copy.recoverable);
    }
  });

  test('user denial and provider failure are distinguishable and recoverable', () => {
    expect(oauthCallbackErrorCopy('access_denied')).toMatchObject({ title: '已取消企业登录', recoverable: 'retry' });
    expect(oauthCallbackErrorCopy('oauth_provider_error').recoverable).toBe('retry');
  });

  test('state-family failures explain the 10-minute window', () => {
    for (const code of ['state_not_found', 'state_mismatch', 'state_invalid', 'state_security_mismatch']) {
      expect(oauthCallbackErrorCopy(code).recoverable).toBe('retry');
    }
  });

  test('identity and linking rejections point at another sign-in way or support', () => {
    expect(oauthCallbackErrorCopy('oauth_identity_rejected').recoverable).toBe('support');
    expect(oauthCallbackErrorCopy('account_already_linked_to_different_user').recoverable).toBe('switch-way');
    expect(oauthCallbackErrorCopy('email_does_not_match').recoverable).toBe('switch-way');
    expect(oauthCallbackErrorCopy('email_not_verified').recoverable).toBe('switch-way');
  });

  test('unknown codes fall back to generic recoverable copy', () => {
    const copy = oauthCallbackErrorCopy('never_seen_before');
    expect(copy.recoverable).toBe('retry');
    expect(copy.title).toBe('登录未能完成');
  });
});
