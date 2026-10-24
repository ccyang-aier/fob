import { randomUUID } from 'node:crypto';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { isValidBlockId } from '@fob/shared/knowledge/schema';
import type { MarkdownPipeline } from '@fob/shared/knowledge/markdown';
import type { NotionImportWarning } from './notion-types';

/**
 * 导入正文的最终化(在 M01 解析之后、Y 编码之前):
 * 1. 为每个知识块分配 blockId(编辑器新块同源的稳定标识,backlink/索引立即可用);
 * 2. 页面内链接映射:href 命中导出内页面 → wikiLink(显式 pageId);命中附件 →
 *    asset: 引用;跨导出断链保留原 href 并告警(悬链语义,不静默改指);
 * 3. 媒体块 src/url 的附件解析与 asset: 重写。
 */

export interface NotionReferenceTarget {
  readonly pageId: string;
  readonly title: string;
}

export interface NotionReferenceResolver {
  /** 相对 href(带可选 #anchor)→ 导出内页面;不存在返回 null。 */
  readonly resolvePage: (href: string) => NotionReferenceTarget | null;
  /** 相对引用 → 已上传附件的 hash;不存在返回 null。 */
  readonly resolveAttachment: (reference: string) => string | null;
  /** href 是否指向导出内已知但未成功上传的附件(用于断链告警)。 */
  readonly knownAttachment: (reference: string) => boolean;
}

const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file']);
const LINK_MARK = 'link';

export interface NotionFinalizedBody {
  readonly document: ProseMirrorNode;
  readonly warnings: readonly NotionImportWarning[];
}

export function finalizeNotionBody(
  pipeline: MarkdownPipeline,
  document: ProseMirrorNode,
  source: string,
  resolver: NotionReferenceResolver,
): NotionFinalizedBody {
  const warnings: NotionImportWarning[] = [];
  const schema: Schema = pipeline.schema;
  const warn = (code: NotionImportWarning['code'], detail: string) => warnings.push({ source, code, detail });

  const copy = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText) {
      const link = node.marks.find((mark) => mark.type.name === LINK_MARK);
      if (!link) return node;
      const href = String(link.attrs.href ?? '');
      const page = resolver.resolvePage(href);
      if (page) {
        const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : null;
        if (anchor) warn('block_anchor_unmapped', `块锚链接 ${href} 的目标块在导入后是新的 blockId,已降级为页面链接`);
        const wikiLink = schema.nodes.wikiLink.createChecked({ pageId: page.pageId, target: page.title, label: node.textContent, targetBlockId: null }, null, node.marks.filter((mark) => mark.type.name !== LINK_MARK));
        return wikiLink;
      }
      const asset = resolver.resolveAttachment(href);
      if (asset) {
        return schema.text(node.textContent, node.marks.map((mark) => mark.type.name === LINK_MARK
          ? mark.type.create({ ...mark.attrs, href: `asset:${asset}` })
          : mark));
      }
      if (href.startsWith('#')) {
        warn('block_anchor_unmapped', `页内锚链接 ${href} 的目标块在导入后是新的 blockId,已保留原链接`);
        return node;
      }
      if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return node;
      if (resolver.knownAttachment(href)) {
        warn('broken_link', `附件 ${href} 上传失败,链接保留原相对地址`);
        return node;
      }
      warn('broken_link', `链接 ${href} 指向导出外或不存在的目标,已保留原地址`);
      return node;
    }
    const isMedia = MEDIA_BLOCKS.has(node.type.name);
    const isEmbed = node.type.name === 'embed';
    if ((isMedia || isEmbed) && node.isAtom) {
      const reference = isEmbed ? String(node.attrs.url ?? '') : String(node.attrs.src ?? '');
      if (!/^https?:\/\//i.test(reference) && reference) {
        const asset = resolver.resolveAttachment(reference);
        if (asset) {
          const attrs = { ...node.attrs, ...(isEmbed ? { url: `asset:${asset}` } : { src: `asset:${asset}`, mime: node.attrs.mime ?? null }) };
          return node.type.createChecked(attrs);
        }
        if (resolver.knownAttachment(reference)) {
          warn('broken_link', `附件 ${reference} 上传失败,媒体块保留原相对地址`);
          return node;
        }
        if (isMedia || isEmbed) warn('broken_link', `媒体源 ${reference} 在导出内不存在,保留原地址`);
      }
      return node;
    }
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(copy(child)));
    let attrs = node.attrs;
    if (Object.hasOwn(attrs, 'blockId')) {
      const blockId = attrs.blockId;
      if (typeof blockId !== 'string' || !isValidBlockId(blockId)) attrs = { ...attrs, blockId: randomUUID() };
    }
    const rebuilt = node.type.name === 'doc' ? schema.topNodeType.createChecked(null, children) : node.type.createChecked(attrs, children);
    return rebuilt;
  };

  const result = copy(document);
  result.check();
  return { document: result, warnings };
}
