import * as Y from 'yjs';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { PAGE_BODY_FRAGMENT } from '../search/backlinks';

/**
 * ProseMirror 文档 → Y.Doc 正文碎片,即 y-prosemirror 的存储编码(indexer/backlinks
 * 读取的同一约定):块 = Y.XmlElement(nodeName=类型名、attributes=非默认属性),文本
 * = 连续同 mark 文本运行合并为一个 Y.XmlText(delta insert 属性即 mark 名 → mark
 * 属性),行内原子 = Y.XmlElement。导入由此获得与真实编辑会话完全同构的 B02 权威
 * 状态,不引入编辑器依赖。与 M03 的 y-encoding.ts 逐条同约定;此处保留独立实现以
 * 隔离并行改动——导入路径不可能产生自重叠 mark(M01 解码端 withMark 显式拒绝),
 * 因此无需 y-encoding 的重叠后缀。
 */

type YParent = Y.XmlFragment | Y.XmlElement;

function attributeValues(node: ProseMirrorNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    const spec = node.type.spec.attrs?.[key];
    if (!spec || (Object.hasOwn(spec, 'default') && spec.default === value)) continue;
    attrs[key] = value;
  }
  return attrs;
}

function markAttributes(marks: readonly Mark[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const mark of marks) attrs[mark.type.name] = mark.attrs;
  return attrs;
}

function appendInline(children: readonly ProseMirrorNode[], parent: YParent): void {
  let run: Y.XmlText | null = null;
  let runMarks = '';
  const flush = () => { run = null; runMarks = ''; };
  for (const node of children) {
    if (node.isText) {
      const signature = JSON.stringify(node.marks.map((mark) => [mark.type.name, mark.attrs]));
      if (!run || signature !== runMarks) {
        run = new Y.XmlText();
        runMarks = signature;
        parent.insert(parent.length, [run]);
      }
      run.insert(run.length, node.text ?? '', markAttributes(node.marks));
    } else {
      flush();
      appendBlock(node, parent);
    }
  }
}

/** yjs 的 XmlElement 属性本质是任意 JSON 值(indexer 按 unknown 读回);最小接口避免泛型纠缠。 */
interface YAttributeSink {
  setAttribute(name: string, value: unknown): void;
}

function appendBlock(node: ProseMirrorNode, parent: YParent): void {
  if (node.isText) {
    appendInline([node], parent);
    return;
  }
  const element = new Y.XmlElement(node.type.name);
  const sink = element as unknown as YAttributeSink;
  for (const [key, value] of Object.entries(attributeValues(node))) {
    if (value !== null && value !== undefined) sink.setAttribute(key, value);
  }
  parent.insert(parent.length, [element]);
  if (node.isLeaf || node.childCount === 0) return;
  if (node.content.size > 0 && node.firstChild?.isInline) appendInline(childList(node), element);
  else for (const child of childList(node)) appendBlock(child, element);
}

function childList(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

/** 导入路径的 B02 落库载荷:state 与 stateVector 同源同事务写入 doc_state。 */
export function encodeNotionPageState(document: ProseMirrorNode): { state: Uint8Array; stateVector: Uint8Array } {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(PAGE_BODY_FRAGMENT);
  ydoc.transact(() => {
    for (const child of childList(document)) appendBlock(child, fragment);
  });
  return { state: Y.encodeStateAsUpdate(ydoc), stateVector: Y.encodeStateVector(ydoc) };
}
