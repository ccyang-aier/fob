import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './query-state.messages';
/**
 * 筛选 / 排序状态机（U06）——把列 schema 与共享契约 `databaseFilterSchema` /
 * `queryDatabaseInputSchema` 之间的映射收拢成纯函数。
 *
 * 操作符可用性逐列镜像服务端 compileRowFilters：范围比较只开放给
 * text/url/number/date；contains 对文本列是子串、对数组列是元素归属；选择列
 * 是标量（无 contains）；isEmpty/isNotEmpty 覆盖全部类型且不取值。构建结果
 * 一律通过共享 zod 契约镜像校验，非法组合在离开 UI 前就被拒绝。
 */

import {
  databaseFilterSchema,
  type DatabaseFilter,
  type DatabaseQuery,
  type PropertyDefinition,
  type PropertyValue,
} from '@fob/shared/knowledge/contracts';
import { isAbsoluteUrl, isIsoDateOrDateTime, isUuid } from './cell-model';

export type FilterOperator = DatabaseFilter['operator'];

const rangeTypes: ReadonlySet<PropertyDefinition['type']> = new Set([
  'text',
  'url',
  'number',
  'date',
]);
const textLikeTypes: ReadonlySet<PropertyDefinition['type']> = new Set(['text', 'url']);
const arrayTypes: ReadonlySet<PropertyDefinition['type']> = new Set([
  'multiSelect',
  'person',
  'relation',
]);

/** 每种列类型允许的操作符（与服务端编译器的接受域一致）。 */
export function operatorsForType(type: PropertyDefinition['type']): FilterOperator[] {
  const base: FilterOperator[] = ['isEmpty', 'isNotEmpty'];
  if (arrayTypes.has(type)) return ['eq', 'neq', 'contains', ...base];
  const operators: FilterOperator[] = ['eq', 'neq'];
  if (rangeTypes.has(type)) operators.push('gt', 'gte', 'lt', 'lte');
  if (textLikeTypes.has(type)) operators.push('contains');
  return [...operators, ...base];
}

export function defaultOperatorForType(type: PropertyDefinition['type']): FilterOperator {
  return type === 'checkbox'
    ? 'eq'
    : textLikeTypes.has(type) || arrayTypes.has(type)
      ? 'contains'
      : 'eq';
}

export function filterNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

export function operatorText(locale?: Locale): Record<FilterOperator, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    eq: knowledgeT('equals'),
    neq: knowledgeT('doesNotEqual'),
    contains: knowledgeT('contains'),
    gt: knowledgeT('greaterThan'),
    gte: knowledgeT('greaterThanOrEqualTo'),
    lt: knowledgeT('lessThan'),
    lte: knowledgeT('lessThanOrEqualTo'),
    isEmpty: knowledgeT('isEmpty'),
    isNotEmpty: knowledgeT('isNotEmpty'),
  };
}

/** 值编辑器的形态：由列类型与操作符共同决定。 */
export type FilterValueEditor =
  'text' | 'number' | 'date' | 'boolean' | 'option' | 'person' | 'none';

export function filterValueEditor(
  column: PropertyDefinition,
  operator: FilterOperator,
): FilterValueEditor {
  if (!filterNeedsValue(operator)) return 'none';
  switch (column.type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'checkbox':
      return 'boolean';
    case 'select':
    case 'multiSelect':
      return 'option';
    case 'person':
      return 'person';
    default:
      return 'text';
  }
}

export type FilterDraftFailure =
  { kind: 'value-required' } | { kind: 'value-invalid'; columnType: PropertyDefinition['type'] };

/**
 * 从 UI 草稿构建契约筛选条件：值必须满足该列类型的标量/元素校验
 * （数字列取有限数、日期列取 ISO、选择列取已声明选项、人员列取 UUID、
 * url 列取绝对链接），构建结果再过一遍共享 `databaseFilterSchema`。
 */
export function buildFilter(
  column: PropertyDefinition,
  operator: FilterOperator,
  draft: PropertyValue | undefined,
): { ok: true; filter: DatabaseFilter } | { ok: false; failure: FilterDraftFailure } {
  let value: PropertyValue | undefined;
  if (filterNeedsValue(operator)) {
    if (draft === undefined || draft === null || draft === '')
      return { ok: false, failure: { kind: 'value-required' } };
    if (arrayTypes.has(column.type)) {
      if (typeof draft !== 'string')
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      if (column.type === 'multiSelect' && !column.options?.some((option) => option.id === draft)) {
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      }
      if (column.type !== 'multiSelect' && !isUuid(draft))
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      value = draft;
    } else if (
      typeof draft !== 'string' &&
      typeof draft !== 'number' &&
      typeof draft !== 'boolean'
    ) {
      return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
    } else if (column.type === 'number') {
      const parsed = typeof draft === 'number' ? draft : Number(String(draft).trim());
      if (!Number.isFinite(parsed))
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      value = parsed;
    } else if (column.type === 'checkbox') {
      if (typeof draft !== 'boolean')
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      value = draft;
    } else if (column.type === 'date') {
      if (typeof draft !== 'string' || !isIsoDateOrDateTime(draft))
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      value = draft;
    } else if (column.type === 'url') {
      if (typeof draft !== 'string' || !isAbsoluteUrl(draft))
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      value = draft;
    } else if (column.type === 'select') {
      if (typeof draft !== 'string' || !column.options?.some((option) => option.id === draft)) {
        return { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
      }
      value = draft;
    } else {
      value = String(draft);
    }
  }
  const filter = { propertyId: column.id, operator, ...(value === undefined ? {} : { value }) };
  const parsed = databaseFilterSchema.safeParse(filter);
  return parsed.success
    ? { ok: true, filter: parsed.data }
    : { ok: false, failure: { kind: 'value-invalid', columnType: column.type } };
}

// ── 排序 ──

export type SortDirection = 'asc' | 'desc';
export interface SortKey {
  propertyId: string;
  direction: SortDirection;
}

/** Notion 式三态循环：无 → 升 → 降 → 无；同一列只保留一个键。 */
export function toggleSort(sort: readonly SortKey[], propertyId: string): SortKey[] {
  const existing = sort.find((key) => key.propertyId === propertyId);
  if (!existing) return [...sort, { propertyId, direction: 'asc' }];
  if (existing.direction === 'asc')
    return sort.map((key) => (key.propertyId === propertyId ? { ...key, direction: 'desc' } : key));
  return sort.filter((key) => key.propertyId !== propertyId);
}

export function setSortDirection(
  sort: readonly SortKey[],
  propertyId: string,
  direction: SortDirection,
): SortKey[] {
  return sort.some((key) => key.propertyId === propertyId)
    ? sort.map((key) => (key.propertyId === propertyId ? { ...key, direction } : key))
    : [...sort, { propertyId, direction }];
}

// ── 查询组装 ──

export function filtersKeyPart(filters: readonly DatabaseFilter[]): string {
  return filters
    .map(
      (filter) => `${filter.propertyId}:${filter.operator}:${JSON.stringify(filter.value ?? null)}`,
    )
    .join('|');
}

export function sortKeyPart(sort: readonly SortKey[]): string {
  return sort.map((key) => `${key.propertyId}:${key.direction}`).join('|');
}

/** 组装 `database.listRows` 的查询输入（契约默认值 limit=50 由服务端定，客户端显式传页大小）。 */
export function toRowsQuery(
  databaseId: string,
  filters: readonly DatabaseFilter[],
  sort: readonly SortKey[],
  cursor?: string,
  limit = 50,
): Omit<DatabaseQuery, 'knowledgeBaseId'> & { cursor?: string } {
  return {
    databaseId,
    filters: [...filters],
    sort: sort.map((key) => ({ propertyId: key.propertyId, direction: key.direction })),
    ...(cursor ? { cursor } : {}),
    limit,
  };
}

/** 筛选涉及的列必须仍存在于当前 schema（列删除后陈旧筛选会被服务端拒绝，先在 UI 摘除）。 */
export function pruneQueryState(
  filters: readonly DatabaseFilter[],
  sort: readonly SortKey[],
  columns: readonly PropertyDefinition[],
): { filters: DatabaseFilter[]; sort: SortKey[] } {
  const ids = new Set(columns.map((column) => column.id));
  return {
    filters: filters.filter((filter) => ids.has(filter.propertyId)),
    sort: sort.filter((key) => ids.has(key.propertyId)),
  };
}
