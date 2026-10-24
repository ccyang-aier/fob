import { describe, expect, test } from 'bun:test';
import type { PropertyDefinition } from '@fob/shared/knowledge/contracts';
import {
  buildFilter,
  defaultOperatorForType,
  filterNeedsValue,
  filterValueEditor,
  filtersKeyPart,
  operatorsForType,
  pruneQueryState,
  setSortDirection,
  sortKeyPart,
  toRowsQuery,
  toggleSort,
} from './query-state';

const column = (overrides: Partial<PropertyDefinition>): PropertyDefinition => ({ id: 'c1', name: '列', type: 'text', ...overrides });
const selectColumn = column({ id: 'c_status', type: 'select', options: [{ id: 'o1', label: '待办', color: 'blue' }] });
const multiColumn = column({ id: 'c_tags', type: 'multiSelect', options: [{ id: 't1', label: '标签', color: 'green' }] });
const personColumn = column({ id: 'c_owner', type: 'person' });
const numberColumn = column({ id: 'c_num', type: 'number' });
const dateColumn = column({ id: 'c_date', type: 'date' });
const checkColumn = column({ id: 'c_done', type: 'checkbox' });
const urlColumn = column({ id: 'c_link', type: 'url' });

describe('query-state · 操作符可用域（镜像服务端编译器）', () => {
  test('每类列允许的操作符', () => {
    expect(operatorsForType('text')).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('number')).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('date')).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('url')).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('checkbox')).toEqual(['eq', 'neq', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('select')).toEqual(['eq', 'neq', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('multiSelect')).toEqual(['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('person')).toEqual(['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty']);
    expect(operatorsForType('relation')).toEqual(['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty']);
  });

  test('默认操作符与取值形态', () => {
    expect(defaultOperatorForType('text')).toBe('contains');
    expect(defaultOperatorForType('multiSelect')).toBe('contains');
    expect(defaultOperatorForType('number')).toBe('eq');
    expect(defaultOperatorForType('checkbox')).toBe('eq');
    expect(filterNeedsValue('isEmpty')).toBe(false);
    expect(filterNeedsValue('isNotEmpty')).toBe(false);
    expect(filterNeedsValue('eq')).toBe(true);
    expect(filterValueEditor(selectColumn, 'eq')).toBe('option');
    expect(filterValueEditor(selectColumn, 'isEmpty')).toBe('none');
    expect(filterValueEditor(checkColumn, 'eq')).toBe('boolean');
    expect(filterValueEditor(personColumn, 'eq')).toBe('person');
    expect(filterValueEditor(dateColumn, 'gt')).toBe('date');
    expect(filterValueEditor(numberColumn, 'lte')).toBe('number');
    expect(filterValueEditor(urlColumn, 'contains')).toBe('text');
  });
});

describe('query-state · buildFilter', () => {
  test('文本 contains 与 isEmpty 通过共享契约', () => {
    const built = buildFilter(column({}), 'contains', '路线');
    expect(built.ok && built.filter).toEqual({ propertyId: 'c1', operator: 'contains', value: '路线' });
    const empty = buildFilter(column({}), 'isEmpty', undefined);
    expect(empty.ok && empty.filter).toEqual({ propertyId: 'c1', operator: 'isEmpty' });
  });

  test('数字列草稿字符串解析为数、非法拒绝、缺值拒绝', () => {
    expect(buildFilter(numberColumn, 'gte', '10')).toEqual({ ok: true, filter: { propertyId: 'c_num', operator: 'gte', value: 10 } });
    expect(buildFilter(numberColumn, 'gte', 'x').ok).toBe(false);
    expect(buildFilter(numberColumn, 'eq', undefined).ok).toBe(false);
  });

  test('日期 / URL / 复选 / 单选按列类型校验值', () => {
    expect(buildFilter(dateColumn, 'gt', '2026-09-26').ok).toBe(true);
    expect(buildFilter(dateColumn, 'gt', '09/26/2026').ok).toBe(false);
    expect(buildFilter(urlColumn, 'eq', 'https://a.b').ok).toBe(true);
    expect(buildFilter(urlColumn, 'eq', 'a.b').ok).toBe(false);
    expect(buildFilter(checkColumn, 'eq', true).ok).toBe(true);
    expect(buildFilter(checkColumn, 'eq', 'true').ok).toBe(false);
    expect(buildFilter(selectColumn, 'eq', 'o1').ok).toBe(true);
    expect(buildFilter(selectColumn, 'eq', 'o9').ok).toBe(false);
  });

  test('数组列的值是元素（选项 ID / UUID）', () => {
    expect(buildFilter(multiColumn, 'contains', 't1').ok).toBe(true);
    expect(buildFilter(multiColumn, 'contains', 't9').ok).toBe(false);
    expect(buildFilter(personColumn, 'eq', '30000000-0000-4000-8000-000000000000').ok).toBe(true);
    expect(buildFilter(personColumn, 'eq', 'member-1').ok).toBe(false);
  });
});

describe('query-state · 排序状态机', () => {
  test('三态循环：无 → 升 → 降 → 无', () => {
    expect(toggleSort([], 'c1')).toEqual([{ propertyId: 'c1', direction: 'asc' }]);
    expect(toggleSort([{ propertyId: 'c1', direction: 'asc' }], 'c1')).toEqual([{ propertyId: 'c1', direction: 'desc' }]);
    expect(toggleSort([{ propertyId: 'c1', direction: 'desc' }], 'c1')).toEqual([]);
  });

  test('多键并存、同列唯一、定向设置', () => {
    expect(toggleSort([{ propertyId: 'c1', direction: 'asc' }], 'c2')).toEqual([
      { propertyId: 'c1', direction: 'asc' },
      { propertyId: 'c2', direction: 'asc' },
    ]);
    expect(setSortDirection([{ propertyId: 'c1', direction: 'asc' }], 'c1', 'desc')).toEqual([{ propertyId: 'c1', direction: 'desc' }]);
    expect(setSortDirection([], 'c2', 'desc')).toEqual([{ propertyId: 'c2', direction: 'desc' }]);
  });
});

describe('query-state · 查询组装与陈旧状态修剪', () => {
  test('键编码稳定且区分筛选排序', () => {
    expect(filtersKeyPart([{ propertyId: 'c1', operator: 'eq', value: 'a' }])).toBe(filtersKeyPart([{ propertyId: 'c1', operator: 'eq', value: 'a' }]));
    expect(filtersKeyPart([{ propertyId: 'c1', operator: 'eq', value: 'a' }])).not.toBe(filtersKeyPart([{ propertyId: 'c1', operator: 'eq', value: 'b' }]));
    expect(sortKeyPart([{ propertyId: 'c1', direction: 'asc' }])).not.toBe(sortKeyPart([{ propertyId: 'c1', direction: 'desc' }]));
  });

  test('toRowsQuery 组装契约输入（含 cursor 与 limit）', () => {
    expect(toRowsQuery('db-1', [{ propertyId: 'c1', operator: 'isEmpty' }], [{ propertyId: 'c1', direction: 'asc' }], 'cursor-1')).toEqual({
      databaseId: 'db-1',
      filters: [{ propertyId: 'c1', operator: 'isEmpty' }],
      sort: [{ propertyId: 'c1', direction: 'asc' }],
      cursor: 'cursor-1',
      limit: 50,
    });
    expect(toRowsQuery('db-1', [], [])).toEqual({ databaseId: 'db-1', filters: [], sort: [], limit: 50 });
  });

  test('pruneQueryState 摘除指向已删列的筛选与排序', () => {
    const columns = [column({})];
    const pruned = pruneQueryState(
      [
        { propertyId: 'c1', operator: 'isEmpty' },
        { propertyId: 'gone', operator: 'isEmpty' },
      ],
      [
        { propertyId: 'c1', direction: 'asc' },
        { propertyId: 'gone', direction: 'desc' },
      ],
      columns,
    );
    expect(pruned).toEqual({ filters: [{ propertyId: 'c1', operator: 'isEmpty' }], sort: [{ propertyId: 'c1', direction: 'asc' }] });
  });
});
