import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { propertiesSchema } from '@fob/shared/knowledge/contracts';
import type { Properties } from '@fob/shared/knowledge/contracts';

/**
 * Obsidian frontmatter ⇄ 页面属性(M03 §4.4:「frontmatter=页面属性」)。
 *
 * 子集约定(与页面属性契约严格对齐,超出即报错,不做静默降级):
 * - 顶层必须是映射;键须满足 propertyIdSchema(`icon` 保留为页面图标)。
 * - 值只接受 string / 有限 number / boolean / null / string[]。
 * - 导出按键排序、YAML 默认风格,保证同属性恒产生同文本。
 */

const ICON_KEY = 'icon';
export const ICON_MAX_LENGTH = 200;

export interface VaultFrontmatter {
  readonly properties: Properties;
  readonly icon: string | null;
}

export class VaultFrontmatterError extends Error {
  constructor(readonly reason: 'syntax' | 'shape' | 'value_type' | 'icon' | 'property_id', message?: string) {
    super(message ?? reason);
    this.name = 'VaultFrontmatterError';
  }
}

/** `---` 围栏必须位于文件首行;缺失围栏返回 null 正文原样。 */
export function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
  if (!source.startsWith('---\n') && source !== '---') return { frontmatter: null, body: source };
  const lines = source.split('\n');
  let closed = -1;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === '---' || line === '...') { closed = index; break; }
    if (line.trim() === '') continue;
  }
  if (closed < 0) return { frontmatter: null, body: source };
  return { frontmatter: lines.slice(1, closed).join('\n'), body: lines.slice(closed + 1).join('\n') };
}

function coerceValue(key: string, value: unknown): string | number | boolean | null | string[] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new VaultFrontmatterError('value_type', `${key} 的数值不是有限数`);
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string')) throw new VaultFrontmatterError('value_type', `${key} 的列表项不全是字符串`);
    return value as string[];
  }
  throw new VaultFrontmatterError('value_type', `${key} 的值类型不受支持(嵌套结构/日期对象等)`);
}

export function decodeFrontmatter(text: string): VaultFrontmatter {
  let parsed: unknown;
  try {
    parsed = parseYaml(text, { strict: false });
  } catch {
    throw new VaultFrontmatterError('syntax', 'frontmatter 不是合法 YAML');
  }
  if (parsed === null || parsed === undefined) return { properties: {}, icon: null };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new VaultFrontmatterError('shape', 'frontmatter 顶层必须是映射');

  const properties: Record<string, string | number | boolean | string[] | null> = {};
  let icon: string | null = null;
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const value = coerceValue(key, raw);
    if (key === ICON_KEY) {
      if (value !== null && typeof value !== 'string') throw new VaultFrontmatterError('icon', 'icon 必须是字符串或空');
      if (typeof value === 'string' && (value.length === 0 || value.length > ICON_MAX_LENGTH)) throw new VaultFrontmatterError('icon', 'icon 长度必须在 1..200');
      icon = value;
      continue;
    }
    properties[key] = value;
  }
  const validated = propertiesSchema.safeParse(properties);
  if (!validated.success) throw new VaultFrontmatterError('property_id', '属性键不符合页面属性契约');
  return { properties: validated.data, icon };
}

/** 空属性且无 icon 时不产生围栏,保持纯正文文件;键排序保证确定性。 */
export function encodeFrontmatter(frontmatter: VaultFrontmatter): string | null {
  const ordered: Record<string, string | number | boolean | string[] | null> = {};
  if (frontmatter.icon !== null) ordered[ICON_KEY] = frontmatter.icon;
  for (const key of Object.keys(frontmatter.properties).sort()) ordered[key] = frontmatter.properties[key]!;
  if (Object.keys(ordered).length === 0) return null;
  return `---\n${stringifyYaml(ordered)}---\n`;
}
