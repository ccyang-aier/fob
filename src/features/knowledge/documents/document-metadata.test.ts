import { expect, test } from 'bun:test';
import {
  documentIndexStatusLabel,
  documentSourceLabel,
  readDocumentIndexStatus,
  readDocumentSource,
} from './document-metadata';

test('document metadata keeps canonical values and displays language-bound labels', () => {
  expect(readDocumentSource('local-upload', 'knowledge-base')).toBe('local-upload');
  expect(readDocumentIndexStatus('indexing')).toBe('indexing');
  expect(documentSourceLabel('local-upload', 'zh-CN')).toBe('本地上传');
  expect(documentSourceLabel('local-upload', 'en-US')).toBe('Local upload');
  expect(documentSourceLabel('figma', 'en-US')).toBe('Figma');
  expect(documentIndexStatusLabel('indexed', 'en-US')).toBe('Indexed');
  expect(documentIndexStatusLabel('indexing', 'en-US')).toBe('Indexing');
  expect(documentIndexStatusLabel('failed', 'zh-CN')).toBe('索引失败');
});

test('unrecognized properties use the current resource defaults instead of treating display text as a code', () => {
  expect(readDocumentSource(undefined, 'knowledge-base')).toBe('knowledge-base');
  expect(readDocumentSource('本地上传', 'knowledge-base')).toBe('knowledge-base');
  expect(readDocumentIndexStatus('已索引')).toBe('none');
  expect(readDocumentIndexStatus({ value: 'indexing' })).toBe('none');
});
