export { KnowledgeSharingError, sanitizedSharing, sharingErrorResponse } from './errors';
export type { SharingErrorCode } from './errors';
export {
  authorizeShareLinkPageAccess,
  createAuthorizedShareLink,
  revokeAuthorizedShareLink,
  setAuthorizedShareLinkLevel,
  shareLinkLocator,
  verifyShareLink,
} from './links';
export type { IssuedShareLink, VerifiedShareLink } from './links';
export { createShareLinkService } from './service';
export type { ShareLinkService } from './service';
export { issueShareToken, matchesShareToken, parseShareToken } from './token-format';
export type { ShareTokenProof } from './token-format';
