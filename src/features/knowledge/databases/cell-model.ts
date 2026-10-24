import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './cell-model.messages';

/**
 * 类型化单元格视图模型（U06）——列与单元格的纯逻辑层。
 *
 * 语义逐条镜像 T02 服务端验证（backend/server/src/modules/knowledge/databases/properties.ts）：
 * 属性值按列 schema 逐键验证，null 是所有类型的空值；person/relation 是用户/行
 * 页面 UUID 数组，multiSelect 的元素必须是已声明选项，date 接受 ISO 日期或带
 * 时差的完整时间，url 必须是绝对 URL。客户端先验到同一结论，服务端仍是权威。
 *
 * 不直接 import zod：与 data/pages-api.ts 相同的取舍，契约经共享 barrel 以值
 * 形式使用，本地校验用等价的小函数表达，不给浏览器包新增直接依赖。
 */

import type { PropertyDefinition, PropertyValue } from '@fob/shared/knowledge/contracts';

const knowledgeT = createTranslator(knowledgeMessages);

export type PropertyType = PropertyDefinition['type'];

/** 契约的属性 ID 字符集：A-Za-z0-9_- 且避开保留字；随机 ID 取 UUID 去连字符。 */
export function newPropertyId(): string {
  return (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  ).replaceAll('-', '');
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

/** 与服务端 `z.iso.date()` / `z.iso.datetime({ offset: true })` 等价的本地判定。 */
export function isIsoDateOrDateTime(value: string): boolean {
  if (isoDatePattern.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }
  if (isoDateTimePattern.test(value)) return !Number.isNaN(new Date(value).getTime());
  return false;
}

/** 与服务端 `z.url()` 等价的本地判定：绝对 http(s) URL。 */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const arrayTyped = (type: PropertyType) =>
  type === 'multiSelect' || type === 'person' || type === 'relation';

/** 空单元格：缺失键、null、空字符串与空数组在展示上同为「空」。 */
export function isCellEmpty(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

export type CellEditFailure =
  | { kind: 'not-number' }
  | { kind: 'not-date' }
  | { kind: 'not-url' }
  | { kind: 'not-option' }
  | { kind: 'not-person' }
  | { kind: 'uneditable' };

/** 单元格编辑的产出：null 统一表示「清空」（所有类型的空值）。 */
export type CellEditResult =
  { ok: true; value: PropertyValue } | { ok: false; failure: CellEditFailure };

export function cellEditFailureText(locale?: Locale): Record<CellEditFailure['kind'], string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    'not-number': knowledgeT('enterAValidNumber'),
    'not-date': knowledgeT('enterYyyyMmDdOrACompleteDate'),
    'not-url': knowledgeT('enterACompleteHttpSUrl'),
    'not-option': knowledgeT('chooseAnOptionDefinedForThisColumn'),
    'not-person': knowledgeT('peopleValuesMustBeMemberIds'),
    uneditable: knowledgeT('thisColumnTypeCannotBeEditedHere'),
  };
}

/**
 * 把一次单元格编辑提交为属性值：文本/URL/日期列空串即清空；数字列解析有限数；
 * 选择列/人员列按列声明校验；复选框接受布尔。类型对不上时如实拒绝，绝不静默改值。
 */
export function commitCellEdit(column: PropertyDefinition, draft: PropertyValue): CellEditResult {
  if (draft === null) return { ok: true, value: null };
  if (column.type === 'text')
    return { ok: true, value: typeof draft === 'string' ? draft : String(draft) };
  if (column.type === 'url') {
    if (typeof draft !== 'string') return { ok: false, failure: { kind: 'not-url' } };
    if (draft === '') return { ok: true, value: null };
    return isAbsoluteUrl(draft)
      ? { ok: true, value: draft }
      : { ok: false, failure: { kind: 'not-url' } };
  }
  if (column.type === 'number') {
    if (typeof draft === 'number')
      return Number.isFinite(draft)
        ? { ok: true, value: draft }
        : { ok: false, failure: { kind: 'not-number' } };
    if (typeof draft === 'string') {
      if (draft.trim() === '') return { ok: true, value: null };
      const parsed = Number(draft.trim());
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, failure: { kind: 'not-number' } };
    }
    return { ok: false, failure: { kind: 'not-number' } };
  }
  if (column.type === 'date') {
    if (typeof draft !== 'string') return { ok: false, failure: { kind: 'not-date' } };
    if (draft.trim() === '') return { ok: true, value: null };
    const trimmed = draft.trim();
    // 输入纯日期时归一为 ISO 日期形式，与服务端存储一致。
    const normalized = isoDatePattern.test(trimmed) ? trimmed : trimmed.replaceAll('/', '-');
    return isIsoDateOrDateTime(normalized)
      ? { ok: true, value: normalized }
      : { ok: false, failure: { kind: 'not-date' } };
  }
  if (column.type === 'checkbox') {
    if (typeof draft === 'boolean') return { ok: true, value: draft };
    return { ok: true, value: draft === 'true' };
  }
  if (column.type === 'select') {
    if (typeof draft !== 'string') return { ok: false, failure: { kind: 'not-option' } };
    if (draft === '') return { ok: true, value: null };
    return column.options?.some((option) => option.id === draft)
      ? { ok: true, value: draft }
      : { ok: false, failure: { kind: 'not-option' } };
  }
  if (column.type === 'multiSelect') {
    if (!Array.isArray(draft)) return { ok: false, failure: { kind: 'not-option' } };
    const unique = [...new Set(draft)];
    if (
      !unique.every(
        (entry) =>
          typeof entry === 'string' && column.options?.some((option) => option.id === entry),
      )
    ) {
      return { ok: false, failure: { kind: 'not-option' } };
    }
    return { ok: true, value: unique };
  }
  if (column.type === 'person') {
    if (!Array.isArray(draft)) return { ok: false, failure: { kind: 'not-person' } };
    const unique = [...new Set(draft)];
    if (!unique.every((entry) => typeof entry === 'string' && isUuid(entry)))
      return { ok: false, failure: { kind: 'not-person' } };
    return { ok: true, value: unique };
  }
  // relation 的值必须解析为目标数据库的现存行页面，编辑入口留给关联视图任务。
  return { ok: false, failure: { kind: 'uneditable' } };
}

/** multiSelect / person 的选项切换：在位则移除，不在则追加，保持唯一。 */
export function toggleArrayValue(value: PropertyValue, entry: string): PropertyValue {
  const list = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  return list.includes(entry) ? list.filter((item) => item !== entry) : [...list, entry];
}

// ── 列集合编辑（整体替换语义与 T02 updateAuthorizedDatabaseColumns 一致） ──

export type ColumnsEditFailure =
  | { kind: 'duplicate-id' }
  | { kind: 'type-change'; columnId: string }
  | { kind: 'invalid-options'; columnId: string }
  | { kind: 'empty-name'; columnId: string };

export function columnsEditFailureText(
  locale?: Locale,
): Record<ColumnsEditFailure['kind'], string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    'duplicate-id': knowledgeT('columnIdsMustBeUnique'),
    'type-change': knowledgeT('columnTypeCannotBeChangedAfterCreation'),
    'invalid-options': knowledgeT('selectionColumnsRequireUniqueOptions'),
    'empty-name': knowledgeT('columnNameIsRequired'),
  };
}

/** 客户端镜像服务端的列替换校验：改名/调选项同类型允许，改类型拒绝。 */
export function validateColumnsReplacement(
  previous: readonly PropertyDefinition[],
  next: readonly PropertyDefinition[],
): { ok: true } | { ok: false; failure: ColumnsEditFailure } {
  if (new Set(next.map((column) => column.id)).size !== next.length)
    return { ok: false, failure: { kind: 'duplicate-id' } };
  for (const column of next) {
    if (typeof column.name !== 'string' || column.name.trim() === '')
      return { ok: false, failure: { kind: 'empty-name', columnId: column.id } };
    if (
      (column.type === 'select' || column.type === 'multiSelect') &&
      (!column.options ||
        new Set(column.options.map((option) => option.id)).size !== column.options.length)
    ) {
      return { ok: false, failure: { kind: 'invalid-options', columnId: column.id } };
    }
  }
  const before = new Map(previous.map((column) => [column.id, column] as const));
  for (const column of next) {
    const old = before.get(column.id);
    if (old && old.type !== column.type)
      return { ok: false, failure: { kind: 'type-change', columnId: column.id } };
  }
  return { ok: true };
}

/** 追加新列（默认带一个空选项骨架的选择列可直接补齐选项）。 */
export function appendColumn(
  columns: readonly PropertyDefinition[],
  draft: {
    name: string;
    type: PropertyType;
    options?: { id: string; label: string; color: string }[];
  },
): PropertyDefinition[] {
  const definition: PropertyDefinition =
    draft.type === 'select' || draft.type === 'multiSelect'
      ? { id: newPropertyId(), name: draft.name, type: draft.type, options: draft.options ?? [] }
      : { id: newPropertyId(), name: draft.name, type: draft.type };
  return [...columns, definition];
}

export function renameColumn(
  columns: readonly PropertyDefinition[],
  columnId: string,
  name: string,
): PropertyDefinition[] {
  return columns.map((column) => (column.id === columnId ? { ...column, name } : column));
}

export function removeColumn(
  columns: readonly PropertyDefinition[],
  columnId: string,
): PropertyDefinition[] {
  return columns.filter((column) => column.id !== columnId);
}

export function setColumnOptions(
  columns: readonly PropertyDefinition[],
  columnId: string,
  options: { id: string; label: string; color: string }[],
): PropertyDefinition[] {
  return columns.map((column) => (column.id === columnId ? { ...column, options } : column));
}

export function newOptionId(): string {
  return `o${newPropertyId().slice(0, 10)}`;
}

/** 选项展示色：定义带色则用之，否则按选项 ID 稳定散列到一组克制的中性强调色。 */
const fallbackPalette = ['blue', 'green', 'amber', 'rose', 'violet', 'cyan'] as const;
export type OptionColor = (typeof fallbackPalette)[number];

export function optionColorClass(color: string | undefined, optionId: string): string {
  if (color && fallbackPalette.includes(color as OptionColor))
    return optionColorClasses[color as OptionColor];
  let hash = 0;
  for (const character of optionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return optionColorClasses[fallbackPalette[hash % fallbackPalette.length]!];
}

export const optionColorClasses: Record<OptionColor, string> = {
  blue: 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]',
  green: 'bg-[color-mix(in_srgb,var(--ok-ink)_10%,transparent)] text-[var(--ok-ink)]',
  amber: 'bg-[var(--warn-soft)] text-[var(--warn-ink)]',
  rose: 'bg-[color-mix(in_srgb,var(--err-ink)_9%,transparent)] text-[var(--err-ink)]',
  violet: 'bg-[color-mix(in_srgb,#766a9c_12%,transparent)] text-[#5d5480]',
  cyan: 'bg-[color-mix(in_srgb,#2f7f9e_10%,transparent)] text-[#2b6c86]',
};

// ── 展示格式化 ──

/** 单元格展示文本（aria/复制友好）；空值统一为空串。 */
export function cellDisplayText(
  column: PropertyDefinition,
  value: PropertyValue | undefined,
  personNameOf: (userId: string) => string | null,
): string {
  if (isCellEmpty(value)) return '';
  switch (column.type) {
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'checkbox':
      return value === true ? knowledgeT('yes') : knowledgeT('no');
    case 'multiSelect':
    case 'person': {
      const list = Array.isArray(value) ? value : [];
      return list
        .map((entry) =>
          column.type === 'person'
            ? (personNameOf(entry) ?? entry.slice(0, 8))
            : (column.options?.find((option) => option.id === entry)?.label ?? entry),
        )
        .join('、');
    }
    case 'relation': {
      const list = Array.isArray(value) ? value : [];
      return list.length ? knowledgeT('valueRelations', { v0: list.length }) : '';
    }
    case 'select':
      return typeof value === 'string'
        ? (column.options?.find((option) => option.id === value)?.label ?? value)
        : '';
    case 'date':
      return typeof value === 'string'
        ? value.replaceAll('T', ' ').replace(/(\.\d+|Z|\+00:00)$/u, '')
        : '';
    default:
      return typeof value === 'string' ? value : '';
  }
}

/** 编辑器初始草稿：文本类直接回填原文，数字回填字符串形式，其余类型结构化编辑。 */
export function cellDraftOf(column: PropertyDefinition, value: PropertyValue | undefined): string {
  if (isCellEmpty(value)) return '';
  if (column.type === 'number' && typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

/** 该列是否支持就地编辑（relation 留给关联视图）。 */
export function columnIsEditable(type: PropertyType): boolean {
  return type !== 'relation';
}

export { arrayTyped };
