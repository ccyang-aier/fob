import { z } from 'zod';
import { FobAuthConfigurationError } from './config';

const common = {
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).refine((id) => id !== 'credential'),
  name: z.string().trim().min(1).max(80),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(4_096),
  tokenEndpointAuth: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
  allowedEmailDomains: z.array(z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/)).max(32).default([]),
  /** Only deployment administrators may opt their configured IdP into private network access. */
  allowPrivateNetwork: z.boolean().default(false),
};
const providerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('oidc'), issuer: z.string(), endpointOrigins: z.array(z.string()).max(8).default([]) }),
  z.strictObject({ ...common, kind: z.literal('oauth'), authorizationUrl: z.string(), tokenUrl: z.string(), userInfoUrl: z.string(), scopes: z.array(z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/)).min(1).max(16) }),
]);
const optionsSchema = z.strictObject({ providers: z.array(providerSchema).max(16), timeoutMs: z.number().int().min(100).max(15_000).default(8_000) });

export type FobOAuthProvider = z.output<typeof providerSchema>;
export type FobOAuthOptions = z.input<typeof optionsSchema>;
export type ValidatedFobOAuthOptions = z.output<typeof optionsSchema>;

export function isLoopbackHost(host: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
}

export function checkedOAuthUrl(value: string, production: boolean, originOnly = false): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search || /[\\\s]/.test(value)
    || !['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && (production || !isLoopbackHost(url.hostname)))
    || (originOnly && value !== url.origin)) throw new Error('Invalid OAuth endpoint');
  return url;
}

export function validateFobOAuthOptions(input: FobOAuthOptions, production = false): ValidatedFobOAuthOptions {
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) throw new FobAuthConfigurationError(`oauth.${parsed.error.issues.map((issue) => issue.path.join('.')).join(', oauth.')}`);
  const ids = new Set<string>();
  for (const provider of parsed.data.providers) {
    try {
      if (ids.has(provider.id)) throw new Error('Duplicate provider');
      ids.add(provider.id);
      if (provider.kind === 'oidc') {
        checkedOAuthUrl(provider.issuer, production);
        for (const origin of provider.endpointOrigins) checkedOAuthUrl(origin, production, true);
      } else {
        for (const endpoint of [provider.authorizationUrl, provider.tokenUrl, provider.userInfoUrl]) checkedOAuthUrl(endpoint, production);
        if (provider.scopes.includes('openid') || provider.scopes.includes('offline_access')) throw new Error('OIDC requires discovery');
      }
    } catch { throw new FobAuthConfigurationError('oauth.providers'); }
  }
  return parsed.data;
}

/** Provider configuration and client secrets are server-owned; never accept this JSON from HTTP. */
export function readFobOAuthOptions(environment: NodeJS.ProcessEnv = process.env): FobOAuthOptions {
  if (!environment.FOB_AUTH_PROVIDERS) return { providers: [] };
  try {
    return validateFobOAuthOptions({ providers: JSON.parse(environment.FOB_AUTH_PROVIDERS) }, environment.NODE_ENV === 'production');
  } catch { throw new FobAuthConfigurationError('FOB_AUTH_PROVIDERS'); }
}
