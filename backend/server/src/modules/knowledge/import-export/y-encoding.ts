import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

/**
 * 页面正文 ⇄ Y.Doc 的导入导出编码(M03,依托 B02 的 doc_state 权威)。
 *
 * 与 y-prosemirror 存储约定逐条对齐(后端不引入编辑器绑定依赖,这与
 * search/indexer.ts 的只读解码是同一约定):
 * - 块节点 → `Y.XmlElement`,nodeName 即节点类型;非 null 属性逐个 setAttribute。
 * - 文本 → 连续同 mark 的文本运行合并为一个 `Y.XmlText`,delta attributes
 *   即 mark:键为 mark 名;可自重叠的 mark(`excludes: ''`,如 link)追加
 *   `--XXXXXXXX`(8 字符 base64),解码端取 `--` 前的名字。
 * - 正文挂载在 `default` XmlFragment(PAGE_BODY_FRAGMENT 三方约定)。
 *
 * 重叠后缀仅用于区分同类型自重叠 mark 的不同属性,不参与任何比较;解码端
 * (indexer/编辑器)只剥前缀,因此导入侧的自定哈希是安全的。
 */

export const PAGE_BODY_FRAGMENT = 'default';

const hashedMarkName = /^(.*)--[a-zA-Z0-9+/=]{8}$/;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function overlapSuffix(mark: Mark): string {
  const digest = createHash('sha256').update(JSON.stringify(mark.toJSON()), 'utf8').digest();
  let value = 0n;
  for (const byte of digest.subarray(0, 6)) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  for (let index = 0; index < 8; index++) {
    encoded = BASE64[Number(value & 63n)] + encoded;
    value >>= 6n;
  }
  return `--${encoded}`;
}

/** y-prosemirror 的 isOMark 判定:mark 不排除自身即可自重叠。 */
function overlappingMarkNames(schema: Schema): ReadonlySet<string> {
  const names = new Set<string>();
  for (const name of Object.keys(schema.marks)) {
    const type = schema.marks[name]!;
    if (!type.excludes(type)) names.add(name);
  }
  return names;
}

function markAttributes(marks: readonly Mark[], overlapping: ReadonlySet<string>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const mark of marks) {
    const name = overlapping.has(mark.type.name) ? `${mark.type.name}${overlapSuffix(mark)}` : mark.type.name;
    attributes[name] = mark.attrs;
  }
  return attributes;
}

function buildYChildren(node: ProseMirrorNode, overlapping: ReadonlySet<string>): (Y.XmlElement | Y.XmlText)[] {
  const children: (Y.XmlElement | Y.XmlText)[] = [];
  let pending: { text: Y.XmlText; attributes: string } | null = null;
  const flush = () => {
    if (!pending) return;
    children.push(pending.text);
    pending = null;
  };
  node.forEach((child) => {
    const text = child.isText ? child.text ?? '' : null;
    if (text) {
      const attributes = markAttributes(child.marks, overlapping);
      const serialized = JSON.stringify(attributes);
      if (pending && pending.attributes === serialized) {
        pending.text.insert(pending.text.length, text, attributes);
      } else {
        flush();
        const created = new Y.XmlText();
        created.insert(0, text, attributes);
        pending = { text: created, attributes: serialized };
      }
    } else {
      flush();
      const element = new Y.XmlElement(child.type.name);
      for (const [key, value] of Object.entries(child.attrs)) {
        if (value !== null && key !== 'ychange') element.setAttribute(key, value);
      }
      encodeChildren(child, element, overlapping);
      children.push(element);
    }
  });
  flush();
  return children;
}

function encodeChildren(node: ProseMirrorNode, parent: Y.XmlElement | Y.XmlFragment, overlapping: ReadonlySet<string>): void {
  const children = buildYChildren(node, overlapping);
  if (children.length) parent.insert(0, children);
}

/** 正文文档 → 全新 Y.Doc(导入初始状态)。文档必须已通过 schema 校验。 */
export function prosemirrorDocToYDoc(document: ProseMirrorNode): { ydoc: Y.Doc; state: Uint8Array; stateVector: Uint8Array } {
  const overlapping = overlappingMarkNames(document.type.schema);
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    encodeChildren(document, ydoc.getXmlFragment(PAGE_BODY_FRAGMENT), overlapping);
  });
  return { ydoc, state: Y.encodeStateAsUpdate(ydoc), stateVector: Y.encodeStateVector(ydoc) };
}

/**
 * Build Y children from ProseMirror nodes and insert them at `index` of an
 * existing fragment or element (J03 suggestion writes share the encoder's
 * storage conventions, marks and attributes included).
 */
export function insertProseMirrorBlocks(target: Y.XmlFragment | Y.XmlElement, index: number, nodes: readonly ProseMirrorNode[]): void {
  if (!nodes.length) return;
  const schema = nodes[0]!.type.schema;
  const holder = schema.topNodeType.createChecked(null, [...nodes]);
  const children = buildYChildren(holder, overlappingMarkNames(schema));
  target.insert(Math.max(0, Math.min(index, target.length)), children);
}

function textNodes(text: Y.XmlText, schema: Schema): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  for (const run of text.toDelta()) {
    if (typeof run.insert !== 'string' || !run.insert) continue;
    const attributes = (run as { attributes?: Record<string, unknown> }).attributes;
    const marks: Mark[] = [];
    for (const [name, value] of Object.entries(attributes ?? {})) {
      if (name === 'ychange') continue;
      marks.push(schema.mark(hashedMarkName.exec(name)?.[1] ?? name, value as Record<string, unknown> | null));
    }
    nodes.push(schema.text(run.insert, marks));
  }
  return nodes;
}

function toNode(element: Y.XmlElement | Y.XmlText, schema: Schema): ProseMirrorNode {
  if (element instanceof Y.XmlText) throw new TypeError('A text fragment cannot appear at the document top level');
  const type = schema.nodes[element.nodeName];
  if (!type) throw new TypeError(`Page body contains an unregistered node type: ${element.nodeName}`);
  const children: ProseMirrorNode[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) children.push(toNode(child, schema));
    else if (child instanceof Y.XmlText) children.push(...textNodes(child, schema));
    else throw new TypeError('Page body contains an unsupported Yjs hook');
  }
  return type.createChecked(element.getAttributes() as Record<string, unknown>, children);
}

/** doc_state 字节 → 正文文档(导出读取端)。空正文返回 null。 */
export function yStateToProseMirrorDoc(state: Uint8Array, schema: Schema): ProseMirrorNode | null {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const fragment = ydoc.getXmlFragment(PAGE_BODY_FRAGMENT);
  const children: ProseMirrorNode[] = [];
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) children.push(toNode(child, schema));
    else if (child instanceof Y.XmlText) children.push(...textNodes(child, schema));
    else throw new TypeError('Page body contains an unsupported Yjs hook');
  }
  if (!children.length) return null;
  return schema.topNodeType.createChecked(null, children);
}
