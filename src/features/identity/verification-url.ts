import { FobAuthFlowError } from './auth-errors';

/** Verification returns to this product's Web origin. */
export function resolveVerificationCallback(origin: string): string {
  let target: URL;
  try {
    target = new URL(origin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
    if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && local))
      || target.pathname !== '/' || target.search || target.hash || target.username || target.password) throw new Error();
  } catch { throw new FobAuthFlowError('ENDPOINT'); }
  return `${target.origin}/auth/verify?status=verified`;
}

export function verificationCallbackUrl(): string {
  return resolveVerificationCallback(window.location.origin);
}
