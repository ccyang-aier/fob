import { z } from 'zod';

export const fobAuthBasePath = '/api/auth';
export const fobAuthClientIpHeader = 'x-fob-auth-client-ip';

export class FobAuthConfigurationError extends Error {
  constructor(fields: string) {
    super(`Invalid Fob authentication configuration: ${fields}`);
    this.name = 'FobAuthConfigurationError';
  }
}

function httpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

const configSchema = z.object({
  baseUrl: z.string().refine(httpOrigin),
  secret: z.string().min(32),
  trustedOrigins: z.array(z.string().refine(httpOrigin)).min(1),
  cookieMode: z.enum(['same-site', 'cross-site']).default('same-site'),
  production: z.boolean().default(false),
}).superRefine((config, context) => {
  if (!httpOrigin(config.baseUrl)) return;
  const url = new URL(config.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && (config.production || config.cookieMode === 'cross-site' || !local)) {
    context.addIssue({ code: 'custom', path: ['baseUrl'], message: 'HTTPS is required outside local same-site development' });
  }
  if (config.production && config.trustedOrigins.some((origin) => !origin.startsWith('https:'))) {
    context.addIssue({ code: 'custom', path: ['trustedOrigins'], message: 'Production Web origins must use HTTPS' });
  }
});

export type FobAuthConfig = Readonly<z.output<typeof configSchema>>;

export function validateFobAuthConfig(input: z.input<typeof configSchema>): FobAuthConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new FobAuthConfigurationError([...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', '));
  return Object.freeze({ ...parsed.data, trustedOrigins: [...new Set([parsed.data.baseUrl, ...parsed.data.trustedOrigins])] });
}

export function readFobAuthConfig(environment: NodeJS.ProcessEnv = process.env): FobAuthConfig {
  const baseUrl = environment.BETTER_AUTH_URL?.replace(/\/$/, '') ?? '';
  return validateFobAuthConfig({
    baseUrl,
    secret: environment.BETTER_AUTH_SECRET ?? '',
    trustedOrigins: (environment.FOB_AUTH_TRUSTED_ORIGINS ?? baseUrl).split(',').map((origin) => origin.trim()),
    cookieMode: (environment.FOB_AUTH_COOKIE_MODE ?? 'same-site') as 'same-site' | 'cross-site',
    production: environment.NODE_ENV === 'production',
  });
}

/** Applies to cookie-authenticated business mutations as well as auth endpoints. */
export function hasTrustedFobOrigin(request: Request, trustedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin && !trustedOrigins.includes(origin)) return false;
  return ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || Boolean(origin);
}
