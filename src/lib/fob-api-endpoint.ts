class ApiEndpointError extends Error { readonly code = 'ENDPOINT'; }

/** Independent Web account and knowledge service, configured at build time. */

export const fobApiUrlEnvName = 'NEXT_PUBLIC_FOB_API_URL';
export const fobApiDevOrigin = 'http://127.0.0.1:8721';

/** Accepts an http(s) origin (optional trailing slash) and returns it in normalized origin form. */
export function parseFobApiOrigin(raw: string): string {
  const invalid = (reason: string) =>
    new ApiEndpointError(`Invalid Fob API origin: ${reason} (got "${raw}")`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('only http(s) origins are supported');
  if (url.username || url.password) throw invalid('credentials are not part of the origin');
  if (url.pathname !== '/' || url.search || url.hash) throw invalid('origin only, without path, query or fragment');
  return url.origin;
}

export type FobApiOrigin = { origin: string; source: 'configured' | 'dev' };

/** Injectable environment of the resolver; the browser binding is at the bottom of this module. */
export type FobEndpointDeps = {
  runtime: () => 'server' | 'web';
  environmentUrl: () => string | undefined;
  isProduction: () => boolean;
  browserOrigin?: () => string;
};

export async function resolveFobApiOrigin(deps: FobEndpointDeps): Promise<FobApiOrigin> {
  const runtime = deps.runtime();
  if (runtime === 'server') {
    throw new ApiEndpointError('The Fob API endpoint is only resolved in the browser.');
  }
  const configured = deps.environmentUrl();
  if (configured !== undefined && configured !== '') {
    try {
      return { origin: sameSiteDevelopmentOrigin(parseFobApiOrigin(configured), deps), source: 'configured' };
    } catch {
      throw new ApiEndpointError(`${fobApiUrlEnvName} is not a valid API origin: "${configured}"`);
    }
  }
  if (deps.isProduction()) {
    throw new ApiEndpointError(`Set ${fobApiUrlEnvName} to the Fob API origin of this deployment.`);
  }
  return { origin: sameSiteDevelopmentOrigin(fobApiDevOrigin, deps), source: 'dev' };
}

/** Memoizes resolution: the endpoint is fixed for the lifetime of the document. */
export function createFobOriginProvider(deps: FobEndpointDeps): () => Promise<FobApiOrigin> {
  let resolved: Promise<FobApiOrigin> | null = null;
  return () => (resolved ??= resolveFobApiOrigin(deps));
}

/** Loopback names are different cookie sites. All modules must share the browser's site in development. */
export function sameSiteDevelopmentOrigin(origin: string, deps: Pick<FobEndpointDeps, 'isProduction' | 'browserOrigin'>): string {
  if (deps.isProduction() || !deps.browserOrigin) return origin;
  const api = new URL(origin);
  const browser = new URL(deps.browserOrigin());
  const loopback = new Set(['localhost', '127.0.0.1']);
  if (api.protocol === browser.protocol && loopback.has(api.hostname) && loopback.has(browser.hostname)) api.hostname = browser.hostname;
  return api.origin;
}

const browserDeps: FobEndpointDeps = {
  runtime: () => typeof window === 'undefined' ? 'server' : 'web',
  environmentUrl: () => process.env.NEXT_PUBLIC_FOB_API_URL,
  browserOrigin: () => window.location.origin,
  isProduction: () => process.env.NODE_ENV === 'production',
};

export const getFobApiOrigin = createFobOriginProvider(browserDeps);
