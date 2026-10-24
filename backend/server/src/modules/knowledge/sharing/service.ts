import {
  createShareLinkInputSchema,
  revokeShareLinkInputSchema,
  setShareLinkLevelInputSchema,
  shareLinkAccessInputSchema,
} from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { verifiedRequestSession, activeSessionMember } from '../access/session-access';
import type { KnowledgeAccessDependencies } from '../access/session-access';
import { sanitizedSharing } from './errors';
import { KnowledgeSharingError } from './errors';
import { authorizeShareLinkPageAccess, createAuthorizedShareLink, revokeAuthorizedShareLink, setAuthorizedShareLinkLevel, shareLinkLocator, verifyShareLink } from './links';

export function createShareLinkService(dependencies: KnowledgeAccessDependencies) {
  const run = <T>(operation: () => Promise<T>) => sanitizedSharing(operation);
  return {
    /** Management is session-only and re-checked in the resource; links themselves are never credentials for it. */
    create(request: Request, input: unknown) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request, true);
        const parsed = createShareLinkInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
        const { knowledgeBaseId } = parsed.data;
        return withKnowledgeBase(dependencies.pool, knowledgeBaseId, async (db) => {
          await activeSessionMember(db, knowledgeBaseId, identity, true);
          return createAuthorizedShareLink(db, identity.userId, parsed.data);
        });
      });
    },
    revoke(request: Request, input: unknown) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request, true);
        const parsed = revokeShareLinkInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
        const { knowledgeBaseId } = parsed.data;
        return withKnowledgeBase(dependencies.pool, knowledgeBaseId, async (db) => {
          await activeSessionMember(db, knowledgeBaseId, identity, true);
          return revokeAuthorizedShareLink(db, identity.userId, parsed.data);
        });
      });
    },
    setLevel(request: Request, input: unknown) {
      return run(async () => {
        const identity = await verifiedRequestSession(dependencies.auth, request, true);
        const parsed = setShareLinkLevelInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
        const { knowledgeBaseId } = parsed.data;
        return withKnowledgeBase(dependencies.pool, knowledgeBaseId, async (db) => {
          await activeSessionMember(db, knowledgeBaseId, identity, true);
          return setAuthorizedShareLinkLevel(db, identity.userId, parsed.data);
        });
      });
    },
    /**
     * Link-holder resolution: no session exists, the token is the credential and
     * its locator decides the resource. Replies carry no member, page-list or
     * principal information beyond the caller's own page decision.
     */
    access(input: unknown) {
      return run(async () => {
        const parsed = shareLinkAccessInputSchema.safeParse(input);
        if (!parsed.success) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
        const { pageId, action } = parsed.data;
        const locator = shareLinkLocator(parsed.data.token);
        if (!locator) throw new KnowledgeSharingError('INVALID_SHARING_INPUT');
        return withKnowledgeBase(dependencies.pool, locator.knowledgeBaseId, async (db) => {
          const denied = { knowledgeBaseId: locator.knowledgeBaseId, pageId, authorized: false as const, level: null };
          const link = await verifyShareLink(db, locator);
          if (!link) return denied;
          const decision = await authorizeShareLinkPageAccess(db, { link, pageId, required: action });
          if (decision.decision !== 'allow') return denied;
          return { knowledgeBaseId: locator.knowledgeBaseId, pageId, authorized: true as const, level: decision.level };
        });
      });
    },
  };
}

export type ShareLinkService = ReturnType<typeof createShareLinkService>;
