import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import type { Root } from 'mdast';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createMarkdownPipeline, remarkKnowledgeWikiLinks } from '@fob/shared/knowledge/markdown';
import type { WikiLinkNode } from '@fob/shared/knowledge/markdown';
import { isKnowledgeBlock } from '@fob/shared/knowledge/schema';
import { repairBlockIds } from '@fob/shared/knowledge/schema';

/**
 * Obsidian 正文边界(M03 §4.4):wiki/块链接与附件引用在 vault 语义与页面
 * 正文语义之间双向翻译;正文块语义仍由 M01 管线负责,这里只做打包层。
 *
 * - 导入:统一 remark 栈(与管线同一组插件)解析为 mdast,后序遍历把
 *   `![[…]]` 嵌入、vault 相对媒体引用与既有引用指令改写成管线可接受的
 *   构造,交给管线解码;最后按 vault 路径回填 wikiLink 的 pageId 并修复
 *   blockId(与 E02 同一修复规则)。
 * - 导出:把正文文档里的 pageId 引用改写为 vault 笔记路径(wiki 链接的
 *   target、块/页面引用指令的 pageId 属性),`asset:<hash>` 媒体改写为
 *   压缩包内附件路径,交给管线序列化;管线拒绝有损输出,失败按页面逐项上报。
 *
 * 嵌入的块语义:`![[note#^block]]` 独占一段 → 块引用;`![[note]]` 独占一段
 * → 页面链接;`![[media]]` 图片内联/其余独占一段 → 对应媒体块。内联(与其他
 * 文字混排)的页面/块/非图片嵌入不被知识文档模型表达,按页面失败上报。
 */

const markdown = createMarkdownPipeline();

/** 与 M01 管线同一 schema 实例(导入导出全模块共享,保证编解码一致)。 */
export function markdownSchema() {
  return markdown.schema;
}

/** 与管线 parse 侧完全相同的 remark 栈;序列化仍由管线自己的 stringify 完成。 */
const remarkReader = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkMath).use(remarkKnowledgeWikiLinks);

export interface VaultPageAddress { readonly pageId: string }
export interface VaultAssetAddress { readonly hash: string; readonly mime: string }

export interface VaultBodyResolver {
  /** vault 目标(完整路径 / 相对当前笔记目录 / 唯一文件名,可带 `.md`)→ 页面。 */
  resolvePage(target: string, fromNotePath: string): VaultPageAddress | undefined;
  /** vault 附件(完整路径 / 相对路径 / 唯一文件名)→ 已确认资产。 */
  resolveAttachment(target: string, fromNotePath: string): VaultAssetAddress | undefined;
}

export interface VaultExportContext {
  readonly knowledgeBaseId: string;
  /** 导出集内 pageId → vault 笔记路径(不含扩展名)。 */
  readonly vaultPathOf: (pageId: string) => string | undefined;
  /** 资产哈希 → 压缩包内附件路径。 */
  readonly attachmentPathOf: (hash: string, mime: string | null) => string;
  /**
   * 被导出集内 wiki/块链接锚点引用的 blockId 集合。仅这些块在导出时保留
   * blockId(管线以 fob-meta 保真);其余块的 id 由再导入时的 E02 修复
   * 重新分配,不产生整篇 meta 噪音。
   */
  readonly anchoredBlockIds: ReadonlySet<string>;
}

/** 逐页失败的原因码(结构化,UI 按码呈现)。 */
export type VaultBodyFailure =
  | 'markdown_invalid'
  | 'attachment_missing'
  | 'embed_target_missing'
  | 'embed_not_inline'
  | 'media_source_unexportable'
  | 'lossy_serialization';

export class VaultBodyError extends Error {
  constructor(readonly reason: VaultBodyFailure, message?: string, options?: { cause?: unknown }) {
    super(message ?? reason, options);
    this.name = 'VaultBodyError';
  }
}

const ASSET_SOURCE = /^asset:([a-f0-9]{64})$/;
const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file']);

/** 附件扩展名:已知 mime 映射,未知一律 `.bin`(内容寻址文件名保证唯一)。 */
export function attachmentExtension(mime: string): string {
  const normalized = mime.split(';', 1)[0]!.trim().toLowerCase();
  const known: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'application/json': 'json',
  };
  return known[normalized] ?? 'bin';
}

function mediaBlockOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function normalizeVaultTarget(raw: string, fromNotePath: string): string {
  let target = raw;
  const directory = fromNotePath.includes('/') ? fromNotePath.slice(0, fromNotePath.lastIndexOf('/')) : '';
  if (target.startsWith('./') || target.startsWith('../')) {
    const stack = directory ? directory.split('/') : [];
    for (const segment of target.split('/')) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') stack.pop();
      else stack.push(segment);
    }
    target = stack.join('/');
  } else if (directory && !target.startsWith('/')) {
    target = `${directory}/${target}`;
  }
  return target.replace(/^\//, '');
}

/** Obsidian 的目标写法:完整路径、相对路径、全库唯一文件名(歧义则不解析)。 */
export function createVaultResolver(pages: readonly { path: string; pageId: string }[], attachments: readonly { path: string; hash: string; mime: string }[]): VaultBodyResolver {
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  const attachmentByPath = new Map(attachments.map((attachment) => [attachment.path, attachment]));
  const pageBasenames = new Map<string, string[]>();
  for (const page of pages) {
    const base = page.path.split('/').at(-1)!;
    pageBasenames.set(base, [...(pageBasenames.get(base) ?? []), page.path]);
  }
  const attachmentBasenames = new Map<string, string[]>();
  for (const attachment of attachments) {
    const base = attachment.path.split('/').at(-1)!;
    attachmentBasenames.set(base, [...(attachmentBasenames.get(base) ?? []), attachment.path]);
  }
  const uniquePath = (index: Map<string, string[]>, base: string): string | undefined => {
    const matches = index.get(base);
    return matches?.length === 1 ? matches[0] : undefined;
  };
  const findPage = (target: string): VaultPageAddress | undefined => {
    const withoutMd = target.toLowerCase().endsWith('.md') ? target.slice(0, -3) : target;
    return pageByPath.get(withoutMd) ?? pageByPath.get(target);
  };
  const findAttachment = (target: string): VaultAssetAddress | undefined => {
    const found = attachmentByPath.get(target);
    if (found) return found;
    const base = uniquePath(attachmentBasenames, target.split('/').at(-1)!);
    return base ? attachmentByPath.get(base) : undefined;
  };
  return {
    resolvePage(target, fromNotePath) {
      const normalized = normalizeVaultTarget(target, fromNotePath);
      const base = normalized.split('/').at(-1)!;
      const baseWithoutMd = base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
      return findPage(normalized) ?? findPage(uniquePath(pageBasenames, baseWithoutMd) ?? '');
    },
    resolveAttachment(target, fromNotePath) {
      const normalized = normalizeVaultTarget(target, fromNotePath);
      return findAttachment(normalized) ?? findAttachment(uniquePath(attachmentBasenames, normalized.split('/').at(-1)!) ?? '');
    },
  };
}

/** 打包层自己的宽松 mdast 形状:管线在解码边界做严格校验,这里只需可安全改写。 */
interface MdNode {
  type: string;
  name?: string;
  attributes?: Record<string, string>;
  children?: MdNode[];
  url?: string;
  alt?: string | null;
  title?: string | null;
  [key: string]: unknown;
}

function asWiki(node: MdNode): WikiLinkNode | undefined {
  return node.type === 'wikiLink' ? node as unknown as WikiLinkNode : undefined;
}

function directive(name: string, attributes: Record<string, string>): MdNode {
  return { type: 'leafDirective', name, attributes, children: [] };
}

function embedAsBlock(wiki: WikiLinkNode, resolver: VaultBodyResolver, fromNotePath: string): MdNode {
  const attachment = resolver.resolveAttachment(wiki.target, fromNotePath);
  if (attachment) {
    if (mediaBlockOf(attachment.mime) === 'image') {
      return { type: 'paragraph', children: [{ type: 'image', url: `asset:${attachment.hash}`, alt: wiki.label ?? '', title: null }] };
    }
    const attributes: Record<string, string> = { src: `asset:${attachment.hash}` };
    if (wiki.label) attributes.title = wiki.label;
    return directive(mediaBlockOf(attachment.mime), attributes);
  }
  const page = resolver.resolvePage(wiki.target, fromNotePath);
  if (page) {
    return wiki.targetBlockId !== null
      ? directive('block-reference', { pageId: page.pageId, targetBlockId: wiki.targetBlockId })
      : directive('page-link', { pageId: page.pageId });
  }
  throw new VaultBodyError('embed_target_missing', `嵌入目标不在 vault 内: ${wiki.target}`);
}

function embedAsInline(wiki: WikiLinkNode, resolver: VaultBodyResolver, fromNotePath: string): MdNode {
  const attachment = resolver.resolveAttachment(wiki.target, fromNotePath);
  if (attachment && mediaBlockOf(attachment.mime) === 'image') {
    return { type: 'image', url: `asset:${attachment.hash}`, alt: wiki.label ?? '', title: null };
  }
  throw new VaultBodyError('embed_not_inline', `内联嵌入仅支持图片附件: ${wiki.target}`);
}

function resolveImageReference(url: string, fromNotePath: string, resolver: VaultBodyResolver): string {
  if (/^(https?:|asset:|data:|blob:|mailto:)/i.test(url)) return url;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* 保留原样 */ }
  const attachment = resolver.resolveAttachment(decoded, fromNotePath);
  if (!attachment) throw new VaultBodyError('attachment_missing', `正文引用的附件不存在: ${url}`);
  return `asset:${attachment.hash}`;
}

/** 后序遍历:先变换子节点,再按段落位置消费 wiki 嵌入。 */
function visit(node: MdNode, fromNotePath: string, resolver: VaultBodyResolver): MdNode {
  const children = node.children?.map((child) => visit(child, fromNotePath, resolver));

  if (node.type === 'image') {
    return { ...node, url: resolveImageReference(String(node.url ?? ''), fromNotePath, resolver) };
  }
  if (node.type === 'leafDirective' && (node.name === 'block-reference' || node.name === 'page-link')) {
    const attributes = { ...(node.attributes ?? {}) } as Record<string, string>;
    const referenced = attributes.pageId === undefined ? undefined : resolver.resolvePage(attributes.pageId, fromNotePath);
    if (referenced) { attributes.pageId = referenced.pageId; delete attributes.knowledgeBaseId; }
    else if (!attributes.knowledgeBaseId) delete attributes.pageId;
    return { ...node, attributes };
  }
  // 导出端会把视频/音频/文件块的资产源写成压缩包内附件路径,这里改回 asset:hash。
  if (node.type === 'leafDirective' && (node.name === 'video' || node.name === 'audio' || node.name === 'file' || node.name === 'image')) {
    const attributes = { ...(node.attributes ?? {}) } as Record<string, string>;
    if (typeof attributes.src === 'string' && attributes.src !== '') {
      attributes.src = resolveImageReference(attributes.src, fromNotePath, resolver);
    }
    return { ...node, attributes };
  }
  if (node.type === 'paragraph') {
    const mapped = children ?? [];
    const only = mapped.length === 1 ? asWiki(mapped[0]!) : undefined;
    if (only?.embed) return embedAsBlock(only, resolver, fromNotePath);
    return {
      ...node,
      children: mapped.map((child) => {
        const wiki = asWiki(child);
        return wiki?.embed ? embedAsInline(wiki, resolver, fromNotePath) : child;
      }),
    };
  }
  return children ? { ...node, children } : node;
}

/** 通用文档重写:visit 返回替换节点(不返回则递归子节点)。 */
function mapDocument(node: ProseMirrorNode, visit: (node: ProseMirrorNode) => ProseMirrorNode | null): ProseMirrorNode {
  const replacement = visit(node);
  if (replacement) return replacement;
  if (node.isText || !node.childCount) return node;
  let changed = false;
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    const mapped = mapDocument(child, visit);
    changed ||= mapped !== child;
    children.push(mapped);
  });
  // createChecked(而非 copy):后端不依赖 @tiptap/pm 运行时,仅经 schema API 重建。
  return changed ? node.type.createChecked(node.attrs, children, node.marks) : node;
}

function withLine(error: unknown): string {
  const position = (error as { source?: { position?: { start?: { line?: number } } } } | undefined)?.source?.position?.start;
  return position?.line ? ` (行 ${position.line})` : '';
}

/** 导入:一段 vault 正文 → 修复 blockId 的页面正文文档。失败抛 VaultBodyError。 */
export function importVaultBody(markdownSource: string, fromNotePath: string, resolver: VaultBodyResolver): ProseMirrorNode {
  let transformed: Root;
  try {
    transformed = visit(remarkReader.parse(markdownSource) as unknown as MdNode, fromNotePath, resolver) as unknown as Root;
  } catch (error) {
    if (error instanceof VaultBodyError) throw error;
    throw new VaultBodyError('markdown_invalid', `正文无法解析${withLine(error)}`, { cause: error });
  }
  let document: ProseMirrorNode;
  try {
    document = markdown.fromMdast(transformed);
  } catch (cause) {
    throw new VaultBodyError('markdown_invalid', `正文不符合知识文档模型${withLine(cause)}`, { cause });
  }
  const resolved = mapDocument(document, (node) => {
    if (node.type.name !== 'wikiLink') return null;
    const page = resolver.resolvePage(node.attrs.target as string, fromNotePath);
    if (!page && node.attrs.knowledgeBaseId && node.attrs.pageId) return null;
    const pageId = page?.pageId ?? null;
    return pageId === node.attrs.pageId && node.attrs.knowledgeBaseId === null ? null : node.type.create({ ...node.attrs, pageId, knowledgeBaseId: null }, null, node.marks);
  });
  return repairBlockIds(resolved).doc;
}

/** Imported archive targets are resolved inside the destination library. */
export function bindImportedReferenceKnowledgeBase(document: ProseMirrorNode, knowledgeBaseId: string): ProseMirrorNode {
  return mapDocument(document, (node) => {
    if (!['wikiLink', 'blockReference', 'pageLink'].includes(node.type.name) || !node.attrs.pageId || node.attrs.knowledgeBaseId) return null;
    return node.type.createChecked({ ...node.attrs, knowledgeBaseId }, null, node.marks);
  });
}

/** 收集正文引用的资产哈希(去重,文档顺序);导出端先取引用再定附件路径。 */
export function collectAssetReferences(document: ProseMirrorNode): string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  const walk = (node: ProseMirrorNode): void => {
    if (MEDIA_BLOCKS.has(node.type.name)) {
      const asset = ASSET_SOURCE.exec(node.attrs.src as string);
      if (asset && !seen.has(asset[1]!)) {
        seen.add(asset[1]!);
        hashes.push(asset[1]!);
      }
    }
    node.forEach(walk);
  };
  document.forEach(walk);
  return hashes;
}

/** 收集正文里作为链接锚点出现的 blockId(wiki 链接与块引用的 targetBlockId)。 */
export function collectAnchorReferences(document: ProseMirrorNode): string[] {
  const anchors: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value && !seen.has(value)) {
      seen.add(value);
      anchors.push(value);
    }
  };
  const walk = (node: ProseMirrorNode): void => {
    if (node.type.name === 'wikiLink' || node.type.name === 'blockReference') add(node.attrs.targetBlockId);
    node.forEach(walk);
  };
  document.forEach(walk);
  return anchors;
}

/** 导出:页面正文文档 → vault 正文 Markdown(不含 frontmatter)。失败抛 VaultBodyError。 */
export function exportVaultBody(document: ProseMirrorNode, context: VaultExportContext): string {
  const visit = (node: ProseMirrorNode): ProseMirrorNode | null => {
    if (node.type.name === 'wikiLink') {
      if (node.attrs.knowledgeBaseId && node.attrs.knowledgeBaseId !== context.knowledgeBaseId) return null;
      const path = node.attrs.pageId ? context.vaultPathOf(node.attrs.pageId as string) : undefined;
      const target = path ?? (node.attrs.target as string);
      if (target === node.attrs.target && node.attrs.pageId === null) return null;
      return node.type.create({ ...node.attrs, target, pageId: null, knowledgeBaseId: null }, null, node.marks);
    }
    if (node.type.name === 'blockReference' || node.type.name === 'pageLink') {
      if (node.attrs.knowledgeBaseId && node.attrs.knowledgeBaseId !== context.knowledgeBaseId) return null;
      const path = node.attrs.pageId ? context.vaultPathOf(node.attrs.pageId as string) : undefined;
      const pageId = path ?? null;
      if (pageId === node.attrs.pageId) return null;
      return node.type.create({ ...node.attrs, pageId, knowledgeBaseId: null });
    }
    if (MEDIA_BLOCKS.has(node.type.name)) {
      const source = node.attrs.src as string;
      const asset = ASSET_SOURCE.exec(source);
      if (asset) {
        const path = context.attachmentPathOf(asset[1]!, node.attrs.mime as string | null);
        if (path === source) return null;
        return node.type.create({ ...node.attrs, src: path });
      }
      if (/^https?:\/\//i.test(source)) return null;
      throw new VaultBodyError('media_source_unexportable', `媒体源无法导出到 vault: ${source}`);
    }
    if (isKnowledgeBlock(node)) {
      const blockId = context.anchoredBlockIds.has(node.attrs.blockId as string) ? node.attrs.blockId : null;
      // 容器块重建时必须先映射子节点:内联 wiki 链接都藏在段落/标题里。
      let changed = blockId !== node.attrs.blockId || node.attrs.sourceBlockId != null;
      const children: ProseMirrorNode[] = [];
      node.forEach((child) => {
        const mapped = mapDocument(child, visit);
        changed ||= mapped !== child;
        children.push(mapped);
      });
      if (!changed) return null;
      return node.type.createChecked({ ...node.attrs, blockId, sourceBlockId: null }, children, node.marks);
    }
    return null;
  };
  const transformed = mapDocument(document, visit);
  try {
    return markdown.serialize(transformed);
  } catch (cause) {
    throw new VaultBodyError('lossy_serialization', '正文无法无损序列化为 Markdown', { cause });
  }
}
