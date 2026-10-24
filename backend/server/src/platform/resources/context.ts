import { and, eq, gt, sql } from 'drizzle-orm';
import { entityIdSchema } from '@fob/shared/resources';
import type { MemberRole } from '@fob/shared/resources';
import { authSession, authUser } from '../database/identity/schema';
import type { FobIdentityTransaction } from '../database/resources/transaction';
import type { FobIdentity } from '../identity/identity';
import { ResourceRequestError } from './errors';

export async function currentIdentity(db: FobIdentityTransaction, identity: FobIdentity, lock = false) {
  if (!entityIdSchema.safeParse(identity.userId).success || !entityIdSchema.safeParse(identity.sessionId).success) {
    throw new ResourceRequestError('UNAUTHENTICATED', 'A verified active session is required.', 401);
  }
  const selection = db.select({ userId: authUser.id, email: authUser.email, name: authUser.name }).from(authSession)
    .innerJoin(authUser, eq(authUser.id, authSession.userId))
    .where(and(eq(authSession.id, identity.sessionId), eq(authSession.userId, identity.userId), gt(authSession.expiresAt, sql`clock_timestamp()`), eq(authUser.emailVerified, true)));
  // Mutations hold the verified session/user until commit, so committed session
  // revocation cannot overtake a request waiting for its resource lock.
  const [user] = await (lock ? selection.for('share') : selection);
  if (!user) throw new ResourceRequestError('UNAUTHENTICATED', 'A verified active session is required.', 401);
  return user;
}

export function requireManager(role: MemberRole) {
  if (role !== 'owner' && role !== 'admin') throw new ResourceRequestError('FORBIDDEN', 'Resource management permission is required.', 403);
}

export function pageOf<T>(items: T[], limit: number, cursor: (item: T) => string) {
  const more = items.length > limit;
  const visible = more ? items.slice(0, limit) : items;
  return { items: visible, nextCursor: more ? cursor(visible[visible.length - 1]!) : null };
}
