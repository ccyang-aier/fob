import type { AttributeSpec, MarkType, NodeType } from '@tiptap/pm/model';

import { KnowledgeMarkdownError } from './errors';
import type { MarkdownNode } from './types';

export const TYPED_ATTRIBUTES = 'fob-attrs';

export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key)
    && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export function parseObject(value: string, source: MarkdownNode): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Expected an object');
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw new KnowledgeMarkdownError('invalid_attribute', 'Expected a JSON attribute object', source, { cause });
  }
}

export function assertKnownAttributes(type: NodeType | MarkType, attrs: Record<string, unknown>, source?: MarkdownNode): void {
  for (const key of Object.keys(attrs)) {
    if (!Object.hasOwn(type.spec.attrs ?? {}, key)) {
      throw new KnowledgeMarkdownError('invalid_attribute', `Unknown ${type.name} attribute: ${key}`, source);
    }
  }
}

function accepts(spec: AttributeSpec, value: unknown): boolean {
  if (typeof spec.validate === 'function') {
    try { spec.validate(value); return true; } catch { return false; }
  }
  if (typeof spec.validate === 'string') {
    return spec.validate.split('|').includes(value === null ? 'null' : typeof value);
  }
  return spec.default === undefined || spec.default === null || typeof spec.default === typeof value;
}

/** Strings stay human-editable; non-string values carry explicit JSON typing. */
export function encodeAttributes(attrs: Readonly<Record<string, unknown>>, specs: Readonly<Record<string, AttributeSpec>> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  const typed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (Object.hasOwn(specs[key] ?? {}, 'default') && sameValue(value, specs[key].default)) continue;
    if (typeof value === 'string' && key !== TYPED_ATTRIBUTES && !/[\u0000-\u001f\u007f]/.test(value)) result[key] = value;
    else typed[key] = value;
  }
  if (Object.keys(typed).length) result[TYPED_ATTRIBUTES] = JSON.stringify(typed);
  return result;
}

export function decodeAttributes(node: MarkdownNode, type: NodeType | MarkType, reserved: readonly string[] = []): Record<string, unknown> {
  const raw = node.attributes ?? {};
  const attrs = Object.hasOwn(raw, TYPED_ATTRIBUTES) ? parseObject(raw[TYPED_ATTRIBUTES] ?? '', node) : {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === TYPED_ATTRIBUTES || reserved.includes(key)) continue;
    if (Object.hasOwn(attrs, key)) throw new KnowledgeMarkdownError('invalid_attribute', `Duplicate attribute: ${key}`, node);
    const spec = type.spec.attrs?.[key];
    if (!spec) throw new KnowledgeMarkdownError('invalid_attribute', `Unknown ${type.name} attribute: ${key}`, node);
    const text = value ?? '';
    if (accepts(spec, text)) attrs[key] = text;
    else {
      try { attrs[key] = JSON.parse(text); } catch { attrs[key] = text; }
    }
  }
  assertKnownAttributes(type, attrs, node);
  return attrs;
}
