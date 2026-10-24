import { and, asc, desc, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import type { DatabaseFilter, Properties, PropertyDefinition, PropertyValue } from '@fob/shared/knowledge/contracts';
import { page } from '../../../platform/database/resources/schema';
import { FobDatabaseError } from './errors';

export interface RowSortKey { propertyId: string; direction: 'asc' | 'desc' }

const arrayTyped = (type: PropertyDefinition['type']) => type === 'multiSelect' || type === 'person' || type === 'relation';
const byId = (columns: PropertyDefinition[]) => new Map(columns.map((column) => [column.id, column] as const));

/**
 * 行属性按列 schema 逐键验证:未知属性拒绝,类型不符拒绝,null 是所有类型的空值。
 * person/relation 的元素是用户/行页面 UUID,multiSelect 的元素必须是已声明的选项 ID。
 */
export function validateRowProperties(columns: PropertyDefinition[], properties: Properties): void {
  const definitions = byId(columns);
  for (const [propertyId, value] of Object.entries(properties)) {
    const column = definitions.get(propertyId);
    if (!column) throw new FobDatabaseError('INVALID_ROW_PROPERTIES');
    if (value === null) continue;
    if (arrayTyped(column.type)) {
      if (!Array.isArray(value) || new Set(value).size !== value.length
        || !value.every((entry) => (column.type === 'multiSelect'
          ? column.options?.some((option) => option.id === entry)
          : entityIdSchema.safeParse(entry).success))) throw new FobDatabaseError('INVALID_ROW_PROPERTIES');
    } else if (Array.isArray(value) || !validScalar(column, value)) {
      throw new FobDatabaseError('INVALID_ROW_PROPERTIES');
    }
  }
}

function validScalar(column: PropertyDefinition, value: Exclude<PropertyValue, null | string[]>): boolean {
  switch (column.type) {
    case 'text': return typeof value === 'string';
    case 'url': return typeof value === 'string' && z.url().safeParse(value).success;
    case 'number': return typeof value === 'number';
    case 'checkbox': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && (z.iso.date().safeParse(value).success || z.iso.datetime({ offset: true }).safeParse(value).success);
    case 'select': return typeof value === 'string' && (column.options?.some((option) => option.id === value) ?? false);
    default: return false;
  }
}

/** 列定义中 relation 列引用的目标数据库 -> 需要验证存在的目标行 ID。 */
export function relationReferences(columns: PropertyDefinition[], properties: Properties): Map<string, string[]> {
  const references = new Map<string, string[]>();
  for (const column of columns) {
    if (column.type !== 'relation' || column.relationDatabaseId === undefined) continue;
    const value = properties[column.id];
    if (Array.isArray(value) && value.length) {
      references.set(column.relationDatabaseId, [...(references.get(column.relationDatabaseId) ?? []), ...value]);
    }
  }
  return references;
}

const cell = (propertyId: string) => sql`(${page.properties} -> ${propertyId}::text)`;
const textCell = (propertyId: string) => sql`(${page.properties} ->> ${propertyId}::text)`;
// jsonb 类型序中 null 最小:缺失键与显式空值统一为 'null'::jsonb,升序最前、降序最后。
const sortCell = (propertyId: string) => sql`coalesce((${page.properties} -> ${propertyId}::text), 'null'::jsonb)`;
const jsonbValue = (value: PropertyValue) => sql`${JSON.stringify(value ?? null)}::jsonb`;

const comparators = { gt: sql.raw('>'), gte: sql.raw('>='), lt: sql.raw('<'), lte: sql.raw('<=') } as const;
/** ILIKE 默认转义符是反斜杠:用户值中的 \ % _ 一律按字面匹配(pg 的 like_escape 不转义通配符,实测无效)。 */
const escapeLikePattern = (value: string) => value.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
const emptyCell = (propertyId: string) => sql`(coalesce(${cell(propertyId)}, 'null'::jsonb) = 'null'::jsonb
  or (jsonb_typeof(${cell(propertyId)}) = 'array' and jsonb_array_length(${cell(propertyId)}) = 0))`;

/**
 * 筛选编译为单条 jsonb 谓词:eq/neq 按列类型取严格相等(数组列为元素归属,neq 要求
 * 值存在且不等),范围比较仅开放给 text/url/number/date,contains 对文本列是转义后的
 * 子串匹配(通配符字面化)、对数组列是元素归属,isEmpty/isNotEmpty 覆盖全部类型。
 */
export function compileRowFilters(columns: PropertyDefinition[], filters: DatabaseFilter[]): SQL | undefined {
  if (!filters.length) return undefined;
  const definitions = byId(columns);
  const conditions: SQL[] = [];
  for (const filter of filters) {
    const column = definitions.get(filter.propertyId);
    if (!column) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    // isEmpty/isNotEmpty 不取值;契约允许携带的冗余值被忽略。
    if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') {
      conditions.push(filter.operator === 'isEmpty' ? emptyCell(filter.propertyId) : sql`not ${emptyCell(filter.propertyId)}`);
      continue;
    }
    const value = filter.value;
    if (value === undefined) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    if (arrayTyped(column.type)) {
      if (typeof value !== 'string' || (column.type === 'multiSelect' && !column.options?.some((option) => option.id === value))
        || (column.type !== 'multiSelect' && !entityIdSchema.safeParse(value).success)) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    } else if (value === null || Array.isArray(value) || !validScalar(column, value)) {
      throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    }
    switch (filter.operator) {
      case 'eq':
        conditions.push(arrayTyped(column.type) ? sql`${cell(filter.propertyId)} @> ${jsonbValue(value)}` : sql`${cell(filter.propertyId)} = ${jsonbValue(value)}`);
        break;
      case 'neq':
        conditions.push(arrayTyped(column.type)
          ? sql`${cell(filter.propertyId)} is not null and not (${cell(filter.propertyId)} @> ${jsonbValue(value)})`
          : sql`${cell(filter.propertyId)} is not null and ${cell(filter.propertyId)} <> ${jsonbValue(value)}`);
        break;
      case 'gt': case 'gte': case 'lt': case 'lte': {
        if (column.type !== 'text' && column.type !== 'url' && column.type !== 'number' && column.type !== 'date') throw new FobDatabaseError('INVALID_DATABASE_QUERY');
        conditions.push(sql`${cell(filter.propertyId)} ${comparators[filter.operator]} ${jsonbValue(value)}`);
        break;
      }
      case 'contains':
        if (column.type !== 'text' && column.type !== 'url' && !arrayTyped(column.type)) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
        conditions.push(column.type === 'text' || column.type === 'url'
          ? sql`${textCell(filter.propertyId)} ilike concat('%', ${escapeLikePattern(value as string)}::text, '%')`
          : sql`${cell(filter.propertyId)} @> ${jsonbValue(value)}`);
        break;
    }
  }
  return and(...conditions)!;
}

/** 排序键 = coalesce 后的 jsonb 单元格;position 与 pageId 兜底保证全序确定。 */
export function compileRowOrder(columns: PropertyDefinition[], sort: RowSortKey[]): SQL[] {
  if (!sort.length) return [];
  const definitions = byId(columns);
  return sort.map((key) => {
    if (!definitions.has(key.propertyId)) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    return key.direction === 'asc' ? asc(sortCell(key.propertyId)) : desc(sortCell(key.propertyId));
  });
}

/**
 * 游标是行页面 ID,seek 谓词与 ORDER BY (排序列..., position, id) 完全同构:
 * 每个排序列先比方向性不等,再逐级等值下沉,最后以 position/id 收尾。
 */
export function compileRowSeek(columns: PropertyDefinition[], sort: RowSortKey[], cursor: { id: string; position: string; properties: Properties }): SQL {
  const definitions = byId(columns);
  const equalities: SQL[] = [];
  const disjuncts: SQL[] = [];
  for (const key of sort) {
    if (!definitions.has(key.propertyId)) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    const value = jsonbValue(cursor.properties[key.propertyId] ?? null);
    const keyCell = sortCell(key.propertyId);
    disjuncts.push(and(...equalities, key.direction === 'asc' ? sql`${keyCell} > ${value}` : sql`${keyCell} < ${value}`)!);
    equalities.push(sql`${keyCell} = ${value}`);
  }
  disjuncts.push(and(...equalities, sql`${page.position} > ${cursor.position}`)!);
  disjuncts.push(and(...equalities, sql`${page.position} = ${cursor.position}`, sql`${page.id} > ${cursor.id}::uuid`)!);
  return or(...disjuncts)!;
}
