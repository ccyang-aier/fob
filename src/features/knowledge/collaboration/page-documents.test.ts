import { describe, expect, test } from 'bun:test';
import { pageDocumentName, parsePageDocument } from '@fob/shared/knowledge/collaboration';
import { pageCollaborationUrl } from './page-provider';

// The expected strings below are written out literally from the semantics of
// shared/src/knowledge/collaboration/page-documents.ts (B01's server-side
// gate): `page:<knowledgeBaseId>:<pageId>`, both ids strictly UUIDs. Importing the
// backend module here would invert the frontend/backend boundary, so the
// parity is asserted against these fixed literals; the backend is expected to
// switch to the shared implementation without changing them.
const knowledgeBaseId = '0b0b58ea-42c1-4d17-9d7f-6a1d1a28b19a';
const pageId = '6f2a9884-0fd4-4a52-8db7-3db30f28b9fd';

describe('page document naming (shared source of truth)', () => {
  test('builds the strict page:<knowledgeBaseId>:<pageId> document name', () => {
    expect(pageDocumentName({ knowledgeBaseId, pageId })).toBe(`page:${knowledgeBaseId}:${pageId}`);
  });

  test('parses a valid document name back into the page scope', () => {
    expect(parsePageDocument(`page:${knowledgeBaseId}:${pageId}`)).toEqual({ knowledgeBaseId, pageId });
  });

  test('round-trips every name it builds', () => {
    const scope = { knowledgeBaseId: '11111111-2222-4333-8444-555555555555', pageId: '66666666-7777-4888-9999-aaaaaaaaaaaa' };
    expect(parsePageDocument(pageDocumentName(scope))).toEqual(scope);
  });

  test('rejects foreign namespaces and malformed names', () => {
    expect(parsePageDocument(`ws:${knowledgeBaseId}`)).toBe(undefined);
    expect(parsePageDocument(`page:${knowledgeBaseId}`)).toBe(undefined);
    expect(parsePageDocument('page:')).toBe(undefined);
    expect(parsePageDocument(`page:not-a-uuid:${pageId}`)).toBe(undefined);
    expect(parsePageDocument(`page:${knowledgeBaseId}:not-a-uuid`)).toBe(undefined);
    expect(parsePageDocument(`page:${knowledgeBaseId}:${pageId}:extra`)).toBe(undefined);
    expect(parsePageDocument('')).toBe(undefined);
  });
});

describe('page collaboration URL derivation', () => {
  test('upgrades the knowledge API origin scheme to ws(s)', () => {
    expect(pageCollaborationUrl('http://127.0.0.1:8710')).toBe('ws://127.0.0.1:8710/');
    expect(pageCollaborationUrl('https://knowledge.example.com')).toBe('wss://knowledge.example.com/');
  });
});
