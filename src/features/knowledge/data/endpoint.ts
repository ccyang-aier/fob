import { KnowledgeDataError } from './errors';
import { parseFobApiOrigin } from '@/lib/fob-api-endpoint';
export const knowledgeApiPathPrefix = '/api/knowledge';
const knowledgeBaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tRPC transport URL for one knowledgeBase: `<origin>/api/knowledge/<knowledgeBaseId>/trpc` (A00 contract). */
export function knowledgeTrpcUrl(origin: string, knowledgeBaseId: string): string {
  if (!knowledgeBaseIdPattern.test(knowledgeBaseId)) {
    throw new KnowledgeDataError('INVALID_REQUEST', { message: 'knowledgeBaseId must be a UUID.' });
  }
  return `${parseFobApiOrigin(origin)}${knowledgeApiPathPrefix}/${knowledgeBaseId}/trpc`;
}
