import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { documentCoffeeInputSchema, documentLikeInputSchema, type DocumentInteractions, type PageScope } from '@fob/shared/knowledge/contracts';
import { authUser } from '../../../platform/database/identity/schema';
import { coffeeTransfer, documentLike } from '../../../platform/database/resources/schema';
import { withFobAccount, type ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { FobIdentity } from '../../../platform/identity/identity';
import { currentIdentity } from '../../../platform/resources/context';
import { ResourceRequestError } from '../../../platform/resources/errors';
import { activeSessionMember } from '../access/session-access';
import { lockPermissionKnowledgeBase } from '../permissions';
import { readCoffeeBalance } from '../../rewards';
import { DocumentServiceError, requireDocument } from './service';

export async function readDocumentInteractions(db: ResourceTransaction, scope: PageScope, userId: string): Promise<DocumentInteractions> {
  const { record } = await requireDocument(db, scope, userId);
  const [recipient] = await db.select({ id: authUser.id, name: authUser.name, image: authUser.image }).from(authUser).where(eq(authUser.id, record.createdBy));
  const [likes] = await db.select({ count: sql<number>`count(*)::int`, liked: sql<boolean>`coalesce(bool_or(${documentLike.userId}=${userId}::uuid),false)` }).from(documentLike)
    .where(and(eq(documentLike.knowledgeBaseId, scope.knowledgeBaseId), eq(documentLike.pageId, scope.pageId)));
  const [coffee] = await db.select({ total: sql<number>`coalesce(sum(${coffeeTransfer.amount}),0)::int` }).from(coffeeTransfer)
    .where(and(eq(coffeeTransfer.knowledgeBaseId, scope.knowledgeBaseId), eq(coffeeTransfer.pageId, scope.pageId)));
  return { liked: likes?.liked ?? false, likes: likes?.count ?? 0, coffeeTotal: coffee?.total ?? 0, recipient: recipient!, canGift: record.createdBy !== userId };
}

export async function changeDocumentLike(db: ResourceTransaction, scope: PageScope, userId: string, input: unknown) {
  const parsed = documentLikeInputSchema.safeParse(input);
  if (!parsed.success) throw new ResourceRequestError('INVALID_INPUT', 'Invalid document like.', 400);
  await requireDocument(db, scope, userId);
  if (parsed.data.liked) await db.insert(documentLike).values({ ...scope, userId }).onConflictDoNothing();
  else await db.delete(documentLike).where(and(eq(documentLike.knowledgeBaseId, scope.knowledgeBaseId), eq(documentLike.pageId, scope.pageId), eq(documentLike.userId, userId)));
  return readDocumentInteractions(db, scope, userId);
}

export async function giftDocumentCoffee(pool: Pool, scope: PageScope, identity: FobIdentity, input: unknown) {
  const parsed = documentCoffeeInputSchema.safeParse(input);
  if (!parsed.success) throw new ResourceRequestError('INVALID_INPUT', 'Invalid coffee gift.', 400);
  const { requestId, amount } = parsed.data;
  return withFobAccount(pool, identity.sessionId, async db => {
    const actor = await currentIdentity(db, identity, true);
    if (actor.userId !== parsed.data.accountId) throw new ResourceRequestError('CONFLICT', 'Account changed.', 409);
    await db.execute(sql`SELECT set_config('app.knowledge_base_id', ${scope.knowledgeBaseId}, true)`);
    await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
    await activeSessionMember(db, scope.knowledgeBaseId, identity);
    const { record } = await requireDocument(db, scope, actor.userId);
    if (record.createdBy === actor.userId) throw new ResourceRequestError('INVALID_INPUT', 'Cannot gift coffee to yourself.', 400);
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('fob:coffee:' || ${actor.userId}::uuid::text,0))`);
    const [existing] = await db.select().from(coffeeTransfer).where(and(eq(coffeeTransfer.senderId, actor.userId), eq(coffeeTransfer.requestId, requestId)));
    if (existing) {
      if (existing.knowledgeBaseId !== scope.knowledgeBaseId || existing.pageId !== scope.pageId || existing.amount !== amount || existing.recipientId !== record.createdBy) throw new ResourceRequestError('INVALID_INPUT', 'Gift request conflict.', 409);
      return { requestId, amount, balance: await readCoffeeBalance(db, actor.userId) };
    }
    const balance = await readCoffeeBalance(db, actor.userId);
    if (balance < amount) throw new DocumentServiceError(409, 'INSUFFICIENT_COFFEE');
    await db.insert(coffeeTransfer).values({ id: randomUUID(), requestId, ...scope, senderId: actor.userId, recipientId: record.createdBy, amount });
    return { requestId, amount, balance: balance - amount };
  });
}
