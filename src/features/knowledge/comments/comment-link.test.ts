import { describe, expect, test } from 'bun:test';
import { commentLink, readCommentLink } from './comment-link';

describe('comment links', () => {
  test('preserves the resource isolation boundary and identifies a concrete reply', () => {
    const target = {  knowledgeBaseId: 'base-a', pageId: 'page-a', source: 'server' as const };
    const commentId = '10000000-0000-4000-8000-000000000001';
    const link = commentLink('http://localhost:3000/?view=projects#stale', target, commentId);
    expect(readCommentLink(link)).toEqual({ ...target, commentId });
    expect(new URL(link).hash).toBe('');
    expect(readCommentLink('http://localhost:3000/?comment=' + commentId)).toBeNull();
    expect(readCommentLink(link.replace(commentId, 'invalid'))).toBeNull();
  });
});
