import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
  createMcpConsentProof,
  isAcceptableMcpRedirectUri,
  matchMcpRedirectUri,
  mcpClientRegistrationSchema,
  mcpPkceChallenge,
  mcpVerifyPkce,
  verifyMcpConsentProof,
} from './oauth-server';

const verifier = () => randomBytes(32).toString('base64url');

describe('mcp oauth pkce', () => {
  test('S256 round trip matches RFC 7636 appendix B', () => {
    expect(mcpPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('accepts only matching verifiers of the required shape', () => {
    const challenge = mcpPkceChallenge('a'.repeat(43));
    expect(mcpVerifyPkce('a'.repeat(43), challenge)).toBe(true);
    expect(mcpVerifyPkce('b'.repeat(43), challenge)).toBe(false);
    expect(mcpVerifyPkce('short', challenge)).toBe(false);
    expect(mcpVerifyPkce(`${verifier()}\n`, challenge)).toBe(false);
    expect(mcpVerifyPkce(verifier(), 'plain-equivalent-challenge-value-aaaaaaaaaaaaa')).toBe(false);
  });
});

describe('mcp redirect uris', () => {
  test('accepts https anywhere and http only on the loopback interface', () => {
    expect(isAcceptableMcpRedirectUri('https://client.example/callback')).toBe(true);
    expect(isAcceptableMcpRedirectUri('http://localhost:5173/callback')).toBe(true);
    expect(isAcceptableMcpRedirectUri('http://127.0.0.1:5173/callback')).toBe(true);
    expect(isAcceptableMcpRedirectUri('http://[::1]:5173/callback')).toBe(true);
    expect(isAcceptableMcpRedirectUri('http://intranet.example/callback')).toBe(false);
    expect(isAcceptableMcpRedirectUri('https://client.example/callback#fragment')).toBe(false);
    expect(isAcceptableMcpRedirectUri('https://user:pass@client.example/callback')).toBe(false);
    expect(isAcceptableMcpRedirectUri('not a url')).toBe(false);
  });

  test('registered loopback uris match any port, everything else exactly', () => {
    const registered = ['http://localhost:49152/callback', 'https://client.example/cb'];
    expect(matchMcpRedirectUri(registered, 'http://localhost:33117/callback')).toBe(true);
    expect(matchMcpRedirectUri(registered, 'https://client.example/cb')).toBe(true);
    expect(matchMcpRedirectUri(registered, 'https://client.example/other')).toBe(false);
    expect(matchMcpRedirectUri(registered, 'http://127.0.0.1:49152/callback')).toBe(false);
    expect(matchMcpRedirectUri(registered, 'https://evil.example/cb')).toBe(false);
  });
});

describe('mcp client registration schema', () => {
  test('fills defaults for a minimal public client', () => {
    const parsed = mcpClientRegistrationSchema.parse({ redirect_uris: ['http://localhost:8931/callback'] });
    expect(parsed.client_name).toBe('MCP client');
    expect(parsed.grant_types).toEqual(['authorization_code']);
    expect(parsed.response_types).toEqual(['code']);
    expect(parsed.token_endpoint_auth_method).toBe('none');
  });

  test('rejects unsafe or non-code clients', () => {
    expect(mcpClientRegistrationSchema.safeParse({ redirect_uris: [] }).success).toBe(false);
    expect(mcpClientRegistrationSchema.safeParse({ redirect_uris: ['http://remote.example/cb'] }).success).toBe(false);
    expect(mcpClientRegistrationSchema.safeParse({ redirect_uris: ['http://localhost:1/cb'], grant_types: ['password'] }).success).toBe(false);
    expect(mcpClientRegistrationSchema.safeParse({ redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: 'client_secret_basic' }).success).toBe(false);
    expect(mcpClientRegistrationSchema.safeParse({ redirect_uris: ['http://localhost:1/cb'], response_types: ['token'] }).success).toBe(false);
  });
});

describe('mcp consent proof', () => {
  const fields = ['ws', 'client', 'redirect', 'read', '', 'challenge', '', 'user'];
  const proof = createMcpConsentProof('secret-value', fields, 60_000);

  test('verifies the exact bound request and session user', () => {
    expect(verifyMcpConsentProof('secret-value', proof, fields)).toBe(true);
    expect(verifyMcpConsentProof('other-secret', proof, fields)).toBe(false);
    expect(verifyMcpConsentProof('secret-value', proof, [...fields.slice(0, 7), 'someone-else'])).toBe(false);
    expect(verifyMcpConsentProof('secret-value', `${proof.slice(0, -2)}AA`, fields)).toBe(false);
    expect(verifyMcpConsentProof('secret-value', 'garbage', fields)).toBe(false);
  });

  test('expired proofs never verify', () => {
    const expired = createMcpConsentProof('secret-value', fields, -1_000);
    expect(verifyMcpConsentProof('secret-value', expired, fields)).toBe(false);
  });
});
