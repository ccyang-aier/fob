import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { authorizationCodeRequest, getOAuth2Tokens } from 'better-auth/oauth2';
import type { BetterAuthPlugin } from 'better-auth';
import { createRemoteJWKSet, customFetch, decodeJwt } from 'jose';
import { z } from 'zod';
import { checkedOAuthUrl } from './oauth-config';
import type { FobOAuthProvider } from './oauth-config';
import { createOAuthHttp, OAuthProviderUnavailable } from './oauth-http';

const profileSchema = z.object({
  sub: z.string().min(1).max(255).optional(), id: z.union([z.string().min(1).max(255), z.number().int().nonnegative()]).optional(),
  email: z.email().max(320), email_verified: z.boolean(), name: z.string().trim().min(1).max(120),
});
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16_384), token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  id_token: z.string().min(1).max(32_768).optional(), expires_in: z.number().int().positive().optional(), scope: z.string().max(2_048).optional(),
});
const discoverySchema = z.object({
  issuer: z.string(), authorization_endpoint: z.string(), token_endpoint: z.string(), jwks_uri: z.string(),
  response_types_supported: z.array(z.string()), id_token_signing_alg_values_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
});
type InitContext = Parameters<NonNullable<BetterAuthPlugin['init']>>[0];

/** The official generic provider owns authorization URLs, PKCE and ID-token verification. */
export async function createConfiguredOAuthProvider(context: InitContext, config: FobOAuthProvider, options: {
  production: boolean; timeoutMs: number; beforeExchange: (providerId: string) => Promise<void>;
}) {
  const origins = config.kind === 'oidc'
    ? [new URL(config.issuer).origin, ...config.endpointOrigins]
    : [config.authorizationUrl, config.tokenUrl, config.userInfoUrl].map((value) => new URL(value).origin);
  const http = createOAuthHttp({ origins, ...options, allowPrivateNetwork: config.allowPrivateNetwork });
  const metadata = config.kind === 'oidc'
    ? discoverySchema.parse(await (await http(`${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)).json())
    : null;
  if (metadata && (config.kind !== 'oidc' || metadata.issuer !== config.issuer
    || !metadata.response_types_supported.includes('code') || !metadata.code_challenge_methods_supported.includes('S256'))) throw new OAuthProviderUnavailable();
  const authorizationUrl = metadata?.authorization_endpoint ?? (config.kind === 'oauth' ? config.authorizationUrl : '');
  const tokenUrl = metadata?.token_endpoint ?? (config.kind === 'oauth' ? config.tokenUrl : '');
  for (const value of [authorizationUrl, tokenUrl, ...(metadata ? [metadata.jwks_uri] : [])]) {
    const endpoint = checkedOAuthUrl(value, options.production);
    if (!origins.includes(endpoint.origin)) throw new OAuthProviderUnavailable();
  }
  const algorithms = metadata?.id_token_signing_alg_values_supported.filter((algorithm) => ['RS256', 'PS256', 'ES256', 'EdDSA'].includes(algorithm));
  if (metadata && !algorithms?.length) throw new OAuthProviderUnavailable();

  const result = await genericOAuth({ config: [{
    providerId: config.id, name: config.name, clientId: config.clientId, clientSecret: config.clientSecret,
    authorizationUrl, tokenUrl, pkce: true, responseType: 'code', responseMode: 'query',
    scopes: config.kind === 'oidc' ? ['openid', 'profile', 'email'] : [...config.scopes],
    requireEmailVerification: true, disableProviderLogout: true, overrideUserInfo: false,
    // Include the issuer in the immutable key without introducing another identity schema.
    accountSubject: ({ profile }) => config.kind === 'oidc'
      ? JSON.stringify([config.issuer, profile.sub]) : JSON.stringify([config.userInfoUrl, String(profile.id)]),
    async getToken({ code, codeVerifier, redirectURI }) {
      await options.beforeExchange(config.id);
      const { body, headers } = await authorizationCodeRequest({
        code, codeVerifier, redirectURI, tokenEndpoint: tokenUrl,
        options: { clientId: config.clientId, clientSecret: config.clientSecret },
        tokenEndpointAuth: { method: config.tokenEndpointAuth },
      });
      const response = tokenSchema.parse(await (await http(tokenUrl, { method: 'POST', body, headers })).json());
      if (config.kind === 'oidc' && !response.id_token) throw new OAuthProviderUnavailable();
      // No refresh/offline grant is requested or retained: this integration is identity-only.
      return getOAuth2Tokens(response);
    },
    async getUserInfo(tokens) {
      try {
        // In OIDC, genericOAuth verifies the JWS and expected nonce before calling this hook.
        const raw = config.kind === 'oidc'
          ? (tokens.idToken ? decodeJwt(tokens.idToken) : null)
          : await (await http(config.userInfoUrl, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).json();
        const parsed = profileSchema.safeParse(raw);
        if (!parsed.success) return null;
        const profile = parsed.data;
        if (config.kind === 'oidc' ? !profile.sub : profile.id === undefined) return null;
        return {
          ...profile, email: profile.email.toLowerCase(), emailVerified: profile.email_verified,
        };
      } catch { return null; }
    },
  }] }).init(context);
  const provider = result.context.socialProviders.find((candidate) => candidate.id === config.id)!;
  if (metadata && config.kind === 'oidc') {
    // Validated metadata is supplied directly to the official verifier. This avoids a
    // second unbounded discovery fetch and a check/use race on issuer or endpoints.
    provider.issuer = config.issuer;
    provider.requiresIdTokenNonce = true;
    provider.idToken = {
      jwks: createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: options.timeoutMs,
        [customFetch]: (url, init) => http(url, { headers: init.headers, signal: init.signal ?? undefined }),
      }),
      issuer: config.issuer, audience: config.clientId, algorithms, maxTokenAge: '10m',
      verifyClaims: (claims) => typeof claims.exp === 'number' && typeof claims.iat === 'number'
        && typeof claims.sub === 'string' && claims.sub.length > 0 && typeof claims.nonce === 'string'
        && (claims.azp === undefined ? !Array.isArray(claims.aud) || claims.aud.length === 1 : claims.azp === config.clientId),
    };
  }
  return provider;
}
