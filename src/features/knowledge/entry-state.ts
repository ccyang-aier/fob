/**
 * Entry state machine of the knowledge workbench (U02).
 *
 * One pure derivation from the four real gates of the app shell — the A04
 * session check, the O01 knowledgeBase list, the A00 knowledgeBase access snapshot and
 * the O03 teamspace directory — onto the phase the page renders. Every phase
 * maps to exactly one honest screen; nothing here fabricates data, and the
 * redirect phases stay effects of the page instead of logic of this module.
 */

/** A04 session gate outcome. */
export type KnowledgeSessionGate =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'error' }
  | { status: 'authenticated' };

/** The slice of a TanStack Query the machine needs. */
export type KnowledgeQuerySlice = {
  status: 'pending' | 'error' | 'success';
  errorCode?: string | null;
  count?: number | null;
};

export type KnowledgeEntryPhase =
  | 'session-checking'
  | 'session-error'
  | 'auth-required'
  | 'knowledge-bases-loading'
  | 'knowledge-bases-error'
  | 'knowledge-bases-empty'
  | 'knowledge-base-loading'
  | 'knowledge-base-error'
  | 'knowledge-base-forbidden'
  | 'tree-loading'
  | 'tree-forbidden'
  | 'tree-error'
  | 'ready';

/** Structural error-code read: works for KnowledgeDataError and OrganizationDataError alike. */
export function knowledgeErrorCodeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

export function deriveKnowledgeEntryPhase(input: {
  session: KnowledgeSessionGate;
  /** KnowledgeBase list query; `null` while the session gate has not passed. */
  knowledgeBases: KnowledgeQuerySlice | null;
  /** KnowledgeBase access snapshot (U01 tRPC); `null` until a knowledgeBase is active. */
  access: KnowledgeQuerySlice | null;
  /** Teamspace directory (O03); `null` until the access snapshot succeeded. */
  teamspaces: KnowledgeQuerySlice | null;
}): KnowledgeEntryPhase {
  const { session } = input;
  if (session.status === 'checking') return 'session-checking';
  if (session.status === 'error') return 'session-error';
  if (session.status === 'anonymous') return 'auth-required';

  const knowledgeBases = input.knowledgeBases;
  if (!knowledgeBases || knowledgeBases.status === 'pending') return 'knowledge-bases-loading';
  if (knowledgeBases.status === 'error') {
    return knowledgeBases.errorCode === 'UNAUTHENTICATED' ? 'auth-required' : 'knowledge-bases-error';
  }
  if ((knowledgeBases.count ?? 0) === 0) return 'knowledge-bases-empty';

  const access = input.access;
  if (!access || access.status === 'pending') return 'knowledge-base-loading';
  if (access.status === 'error') {
    if (access.errorCode === 'UNAUTHENTICATED') return 'auth-required';
    if (access.errorCode === 'FORBIDDEN') return 'knowledge-base-forbidden';
    return 'knowledge-base-error';
  }

  const teamspaces = input.teamspaces;
  if (!teamspaces || teamspaces.status === 'pending') return 'tree-loading';
  if (teamspaces.status === 'error') {
    if (teamspaces.errorCode === 'UNAUTHENTICATED') return 'auth-required';
    if (teamspaces.errorCode === 'FORBIDDEN') return 'tree-forbidden';
    return 'tree-error';
  }
  return 'ready';
}

/** Phases that render the full three-column stage (sidebar + canvas + reserved rail). */
export function entryPhaseShowsStage(phase: KnowledgeEntryPhase): boolean {
  return (
    phase === 'knowledge-base-loading' ||
    phase === 'knowledge-base-error' ||
    phase === 'knowledge-base-forbidden' ||
    phase === 'tree-loading' ||
    phase === 'tree-forbidden' ||
    phase === 'tree-error' ||
    phase === 'ready'
  );
}
