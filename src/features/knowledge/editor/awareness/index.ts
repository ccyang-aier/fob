/**
 * The awareness feature of the page editor (B07): presence publishing and
 * remote caret rendering (`createAwarenessExtension`) plus the header's
 * online-members bar (`AwarenessMembers`). The pure resolution and contract
 * logic lives in `../collaboration/awareness`; wiring into the editor
 * surface and page session is the shell's job.
 */

export { createAwarenessExtension, ensureAwarenessCursorStyles } from './awareness-extension';
export type { AwarenessExtensionOptions } from './awareness-extension';
export { AwarenessMembers, useAwarenessMembers } from './awareness-members';
export type { AwarenessIdentity, AwarenessMember, ResolvedRemoteCursor } from '../../collaboration/awareness';
