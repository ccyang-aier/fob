import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Actor } from '@fob/shared/knowledge/contracts';
import type { MemberRole } from '@fob/shared/resources';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { KnowledgeAccessError, knowledgeAccessErrorResponse, knowledgeTokenScopes, sanitizedAccess, tokenKnowledgeBaseSchema } from './access-policy';
import type { KnowledgeTokenScope } from './access-policy';
import { activeSessionMember, verifiedRequestSession } from './session-access';
import type { KnowledgeAccessDependencies } from './session-access';
import { verifyKnowledgeToken, verifyKnowledgeTokenProof } from './tokens';
import type { KnowledgeTokenProof } from './token-format';

const issuedContexts = new WeakSet<object>();
declare const contextBrand: unique symbol;
export interface KnowledgeRequestContext {
  readonly [contextBrand]: true;
  readonly knowledgeBaseId: string;
  readonly userId: string;
  readonly role: MemberRole;
  readonly actor: Readonly<Extract<Actor, { kind: 'human' }>>;
  readonly credential: Readonly<{ kind: 'session'; sessionId: string } | { kind: 'pat'; tokenId: string }>;
  readonly scopes: readonly KnowledgeTokenScope[];
}

/** Only contexts issued by this module are accepted; scopes never imply page ACL. */
export function requireKnowledgeScopes(context: KnowledgeRequestContext, scopes: readonly KnowledgeTokenScope[]): void {
  if (!issuedContexts.has(context)) throw new KnowledgeAccessError('UNAUTHENTICATED');
  if (scopes.some((scope) => !knowledgeTokenScopes.includes(scope) || !context.scopes.includes(scope))) {
    throw new KnowledgeAccessError('INSUFFICIENT_SCOPE');
  }
}

export function createKnowledgeRequestAuthenticator(dependencies: KnowledgeAccessDependencies) {
  type Identity = Pick<KnowledgeRequestContext, 'userId' | 'role' | 'credential' | 'scopes'>;
  type Proof = { kind: 'session'; userId: string; sessionId: string } | { kind: 'pat'; token: KnowledgeTokenProof };
  const proofs = new WeakMap<KnowledgeRequestContext, Proof>();
  function issue(knowledgeBaseId: string, identity: Identity, proof: Proof, scopes: readonly KnowledgeTokenScope[]) {
    const context = Object.freeze({
      knowledgeBaseId, ...identity, scopes: Object.freeze([...identity.scopes]),
      credential: Object.freeze(identity.credential), actor: Object.freeze({ kind: 'human' as const, userId: identity.userId }),
    }) as KnowledgeRequestContext;
    issuedContexts.add(context);
    proofs.set(context, proof);
    requireKnowledgeScopes(context, scopes);
    return context;
  }
  return {
    authenticate(request: Request, knowledgeBaseId: string, requiredScopes: readonly KnowledgeTokenScope[] = []): Promise<KnowledgeRequestContext> {
      return sanitizedAccess(async () => {
        const target = tokenKnowledgeBaseSchema.safeParse(knowledgeBaseId);
        if (!target.success) throw new KnowledgeAccessError('UNAUTHENTICATED');
        let identity: Identity;
        let proof: Proof;
        if (request.headers.has('authorization')) {
          const authorization = request.headers.get('authorization')!;
          const match = /^Bearer +([^\s,]+)$/i.exec(authorization);
          if (!match) throw new KnowledgeAccessError('UNAUTHENTICATED');
          const origin = request.headers.get('origin');
          if (origin && !(dependencies.auth.options.trustedOrigins as string[]).includes(origin)) throw new KnowledgeAccessError('INVALID_ORIGIN');
          const pat = await verifyKnowledgeToken(dependencies, match[1]!, target.data);
          identity = { userId: pat.userId, role: pat.role, scopes: pat.scopes, credential: { kind: 'pat', tokenId: pat.tokenId } };
          proof = { kind: 'pat', token: pat.proof };
        } else {
          const session = await verifiedRequestSession(dependencies.auth, request);
          const role = await withKnowledgeBase(dependencies.pool, target.data, (db) => activeSessionMember(db, target.data, session));
          identity = { userId: session.userId, role, scopes: knowledgeTokenScopes, credential: { kind: 'session', sessionId: session.sessionId } };
          proof = { kind: 'session', userId: session.userId, sessionId: session.sessionId };
        }
        return issue(target.data, identity, proof, requiredScopes);
      }, dependencies.onDiagnostic);
    },
    /** Long-lived transports must refresh at each operation; an old scope snapshot is not live authority. */
    refresh(context: KnowledgeRequestContext, requiredScopes: readonly KnowledgeTokenScope[] = []): Promise<KnowledgeRequestContext> {
      return sanitizedAccess(async () => {
        const proof = proofs.get(context);
        if (!proof) throw new KnowledgeAccessError('UNAUTHENTICATED');
        let identity: Identity;
        if (proof.kind === 'pat') {
          const pat = await verifyKnowledgeTokenProof(dependencies, proof.token);
          // Ownership must not be reassigned underneath a previously issued context.
          if (pat.userId !== context.userId) throw new KnowledgeAccessError('UNAUTHENTICATED');
          identity = { userId: pat.userId, role: pat.role, scopes: pat.scopes, credential: { kind: 'pat', tokenId: pat.tokenId } };
        } else {
          const role = await withKnowledgeBase(dependencies.pool, context.knowledgeBaseId, (db) => activeSessionMember(db, context.knowledgeBaseId, proof));
          identity = { userId: proof.userId, role, scopes: knowledgeTokenScopes, credential: { kind: 'session', sessionId: proof.sessionId } };
        }
        return issue(context.knowledgeBaseId, identity, proof, requiredScopes);
      }, dependencies.onDiagnostic);
    },
  };
}
export type KnowledgeRequestAuthenticator = ReturnType<typeof createKnowledgeRequestAuthenticator>;

/** Route wiring chooses the target and required scopes, never identity fields in JSON. */
export function requireKnowledgeRequest(authenticator: KnowledgeRequestAuthenticator, knowledgeBaseId: (context: Context) => string, scopes: readonly KnowledgeTokenScope[]) {
  return createMiddleware<{ Variables: { knowledge: KnowledgeRequestContext } }>(async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    try { context.set('knowledge', await authenticator.authenticate(context.req.raw, knowledgeBaseId(context), scopes)); }
    catch (error) { return knowledgeAccessErrorResponse(error); }
    await next();
  });
}
