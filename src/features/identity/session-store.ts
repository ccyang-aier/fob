import { fobAuthApi, type FobAuthApi, type FobAuthUser } from './auth-api';
import { performFobSignOut } from './session';
import { FobAuthFlowError } from './auth-errors';

export type IdentitySession =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'error'; error: unknown }
  | { status: 'authenticated'; user: FobAuthUser; expiresAt: string };

/** One authoritative session per application; stale responses cannot resurrect a signed-out account. */
export function createIdentitySessionStore(api: FobAuthApi = fobAuthApi) {
  let snapshot: IdentitySession = { status: 'checking' };
  let revision = 0;
  let pending: Promise<IdentitySession> | null = null;
  const listeners = new Set<() => void>();
  function publish(value: IdentitySession) {
    snapshot = value;
    for (const listener of listeners) listener();
  }
  function refresh(force = false): Promise<IdentitySession> {
    if (pending && !force) return pending;
    const requestRevision = ++revision;
    const request = api.getSession().then((info): IdentitySession => {
      const valid = info?.session && info.user?.emailVerified && info.session.userId === info.user.id && Date.parse(info.session.expiresAt) > Date.now();
      return valid ? { status: 'authenticated', user: info.user!, expiresAt: info.session!.expiresAt } : { status: 'anonymous' };
    }).catch((error: unknown): IdentitySession => ({ status: 'error', error })).then((value) => {
      if (requestRevision === revision) publish(value);
      return snapshot;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    expire() { ++revision; pending = null; publish({ status: 'anonymous' }); },
    async completeSignIn() {
      const value = await refresh(true);
      if (value.status === 'error') throw value.error;
      if (value.status !== 'authenticated') throw new FobAuthFlowError('SESSION_NOT_PERSISTED');
      return value.user;
    },
    async signOut() {
      const result = await performFobSignOut({ api });
      if (!result.ok) throw result.cause;
      ++revision;
      pending = null;
      publish({ status: 'anonymous' });
    },
  };
}
