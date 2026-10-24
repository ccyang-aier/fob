import { assetDerivedSchema, assetHashSchema, assetSourceSchema } from '../contracts';
import type { AssetDerived } from '../contracts';
import { AI_DERIVED_DIRECTIVE } from './ai-types';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownNode } from './types';

export function validateDerivedAssets(input?: ReadonlyMap<string, AssetDerived>): ReadonlyMap<string, AssetDerived> {
  const assets = new Map<string, AssetDerived>();
  for (const [key, value] of input ?? []) {
    try { assets.set(assetHashSchema.parse(key), assetDerivedSchema.parse(value)); }
    catch (cause) { throw new KnowledgeMarkdownError('invalid_derived', 'Invalid asset-derived contract or asset hash', undefined, { cause }); }
  }
  return assets;
}

/** Derived Markdown is deliberately literal text, never parsed as source syntax. */
export function derivedNode(blockId: string, source: unknown, assets: ReadonlyMap<string, AssetDerived>): MarkdownNode | null {
  const parsed = assetSourceSchema.safeParse(source);
  if (!parsed.success) return null;
  const derived = assets.get(parsed.data.slice(6));
  if (!derived) return null;
  const children: MarkdownNode[] = [];
  const append = (label: string, value: string) => children.push({
    type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: `[${label}] ${value}` }] }],
  });
  append('派生状态', derived.status);
  if (derived.description !== undefined) append('媒体描述', derived.description);
  if (derived.ocr !== undefined) append('OCR', derived.ocr);
  if (derived.markdown !== undefined) append('文档正文', derived.markdown);
  for (const segment of derived.transcript ?? []) append(`转写 ${segment.start}s–${segment.end}s`, segment.text);
  if (derived.error !== undefined) append('派生错误', derived.error);
  // One quote avoids CommonMark merging adjacent blockquotes with an HTML separator.
  return {
    type: 'containerDirective', name: AI_DERIVED_DIRECTIVE,
    attributes: { for: blockId, source: parsed.data, status: derived.status, readonly: 'true' },
    children: [{ type: 'blockquote', children: children.flatMap((child) => child.children ?? []) }],
  };
}
