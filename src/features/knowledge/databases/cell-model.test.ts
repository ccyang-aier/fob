import { describe, expect, test } from 'bun:test';
import type { PropertyDefinition } from '@fob/shared/knowledge/contracts';
import {
  appendColumn,
  cellDraftOf,
  cellDisplayText,
  cellEditFailureText as failureText,
  columnIsEditable,
  columnsEditFailureText,
  commitCellEdit,
  isAbsoluteUrl,
  isCellEmpty,
  isIsoDateOrDateTime,
  isUuid,
  newPropertyId,
  optionColorClass,
  removeColumn,
  renameColumn,
  setColumnOptions,
  toggleArrayValue,
  validateColumnsReplacement,
} from './cell-model';

const column = (overrides: Partial<PropertyDefinition>): PropertyDefinition => ({
  id: 'col_text',
  name: '文本',
  type: 'text',
  ...overrides,
});

const selectColumn = column({
  id: 'col_status',
  name: '状态',
  type: 'select',
  options: [
    { id: 'opt_todo', label: '待办', color: 'blue' },
    { id: 'opt_done', label: '完成', color: 'green' },
  ],
});

const multiColumn = column({
  id: 'col_tags',
  name: '标签',
  type: 'multiSelect',
  options: [{ id: 'opt_a', label: 'A', color: 'amber' }],
});
const personColumn = column({ id: 'col_owner', name: '负责人', type: 'person' });

describe('cell-model · 本地校验镜像', () => {
  test('isUuid / isIsoDateOrDateTime / isAbsoluteUrl 与契约同结论', () => {
    expect(isUuid('20000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isIsoDateOrDateTime('2026-09-26')).toBe(true);
    expect(isIsoDateOrDateTime('2026-09-26T10:30:00Z')).toBe(true);
    expect(isIsoDateOrDateTime('2026-09-26T10:30:00+08:00')).toBe(true);
    expect(isIsoDateOrDateTime('2026-13-01')).toBe(false);
    expect(isIsoDateOrDateTime('2026-9-6')).toBe(false);
    expect(isIsoDateOrDateTime('2026-09-26 10:30')).toBe(false);
    expect(isAbsoluteUrl('https://fob.example/page')).toBe(true);
    expect(isAbsoluteUrl('http://localhost:8710/x')).toBe(true);
    expect(isAbsoluteUrl('fob.example/page')).toBe(false);
    expect(isAbsoluteUrl('mailto:a@b.c')).toBe(false);
  });

  test('newPropertyId 落在契约字符集内且不撞保留字', () => {
    const id = newPropertyId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(['__proto__', 'prototype', 'constructor']).not.toContain(id);
  });
});

describe('cell-model · commitCellEdit', () => {
  test('文本列：字符串直存，null 清空', () => {
    expect(commitCellEdit(column({}), 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(commitCellEdit(column({}), null)).toEqual({ ok: true, value: null });
  });

  test('数字列：字符串草稿解析有限数，空串清空，非法拒绝', () => {
    expect(commitCellEdit(column({ type: 'number' }), ' 42.5 ')).toEqual({ ok: true, value: 42.5 });
    expect(commitCellEdit(column({ type: 'number' }), 7)).toEqual({ ok: true, value: 7 });
    expect(commitCellEdit(column({ type: 'number' }), '')).toEqual({ ok: true, value: null });
    const bad = commitCellEdit(column({ type: 'number' }), 'abc');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(failureText()[bad.failure.kind]).toBe('请输入有效数字');
  });

  test('日期列：归一斜杠、接受完整时间、拒绝非法', () => {
    expect(commitCellEdit(column({ type: 'date' }), '2026/09/26')).toEqual({
      ok: true,
      value: '2026-09-26',
    });
    expect(commitCellEdit(column({ type: 'date' }), '2026-09-26T09:00:00+08:00')).toEqual({
      ok: true,
      value: '2026-09-26T09:00:00+08:00',
    });
    expect(commitCellEdit(column({ type: 'date' }), '')).toEqual({ ok: true, value: null });
    expect(commitCellEdit(column({ type: 'date' }), '明天').ok).toBe(false);
  });

  test('URL 列：仅接受绝对 http(s)，空串清空', () => {
    expect(commitCellEdit(column({ type: 'url' }), 'https://a.b/c')).toEqual({
      ok: true,
      value: 'https://a.b/c',
    });
    expect(commitCellEdit(column({ type: 'url' }), '')).toEqual({ ok: true, value: null });
    expect(commitCellEdit(column({ type: 'url' }), 'a.b/c').ok).toBe(false);
  });

  test('复选框：布尔直存', () => {
    expect(commitCellEdit(column({ type: 'checkbox' }), true)).toEqual({ ok: true, value: true });
    expect(commitCellEdit(column({ type: 'checkbox' }), false)).toEqual({ ok: true, value: false });
  });

  test('单选：仅接受已声明选项，空串清空', () => {
    expect(commitCellEdit(selectColumn, 'opt_done')).toEqual({ ok: true, value: 'opt_done' });
    expect(commitCellEdit(selectColumn, '')).toEqual({ ok: true, value: null });
    expect(commitCellEdit(selectColumn, 'opt_missing').ok).toBe(false);
  });

  test('多选：元素须是声明选项且去重', () => {
    expect(commitCellEdit(multiColumn, ['opt_a', 'opt_a'])).toEqual({ ok: true, value: ['opt_a'] });
    expect(commitCellEdit(multiColumn, ['opt_missing']).ok).toBe(false);
    expect(commitCellEdit(multiColumn, []).ok).toBe(true);
  });

  test('人员：元素须是 UUID 且去重', () => {
    const uuid = '30000000-0000-4000-8000-000000000000';
    expect(commitCellEdit(personColumn, [uuid, uuid])).toEqual({ ok: true, value: [uuid] });
    expect(commitCellEdit(personColumn, ['y00013075']).ok).toBe(false);
  });

  test('关联列：编辑入口如实拒绝（uneditable）', () => {
    const relation = column({
      id: 'col_rel',
      type: 'relation',
      relationDatabaseId: '40000000-0000-4000-8000-000000000000',
    });
    const result = commitCellEdit(relation, ['x']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('uneditable');
    expect(columnIsEditable('relation')).toBe(false);
    expect(columnIsEditable('person')).toBe(true);
  });

  test('toggleArrayValue 在位移除、不在追加', () => {
    expect(toggleArrayValue(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleArrayValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleArrayValue(null, 'a')).toEqual(['a']);
  });
});

describe('cell-model · 展示', () => {
  const personNameOf = (id: string) =>
    id === '30000000-0000-4000-8000-000000000000' ? '林澜' : null;

  test('isCellEmpty：缺失/null/空串/空数组同为空', () => {
    expect(isCellEmpty(undefined)).toBe(true);
    expect(isCellEmpty(null)).toBe(true);
    expect(isCellEmpty('')).toBe(true);
    expect(isCellEmpty([])).toBe(true);
    expect(isCellEmpty(0)).toBe(false);
    expect(isCellEmpty(false)).toBe(false);
  });

  test('cellDisplayText 按类型格式化（选项走 label、人员走目录、日期去时间尾巴）', () => {
    expect(cellDisplayText(selectColumn, 'opt_todo', personNameOf)).toBe('待办');
    expect(cellDisplayText(multiColumn, ['opt_a'], personNameOf)).toBe('A');
    expect(
      cellDisplayText(personColumn, ['30000000-0000-4000-8000-000000000000'], personNameOf),
    ).toBe('林澜');
    expect(
      cellDisplayText(personColumn, ['50000000-0000-4000-8000-000000000000'], personNameOf),
    ).toBe('50000000');
    expect(cellDisplayText(column({ type: 'date' }), '2026-09-26T09:00:00Z', personNameOf)).toBe(
      '2026-09-26 09:00:00',
    );
    expect(cellDisplayText(column({ type: 'checkbox' }), true, personNameOf)).toBe('是');
    expect(
      cellDisplayText(
        column({ type: 'relation', relationDatabaseId: '40000000-0000-4000-8000-000000000000' }),
        ['a', 'b'],
        personNameOf,
      ),
    ).toBe('2 个关联');
  });

  test('cellDraftOf：数字回填字符串形式，其余文本原样', () => {
    expect(cellDraftOf(column({ type: 'number' }), 42.5)).toBe('42.5');
    expect(cellDraftOf(column({}), 'hello')).toBe('hello');
    expect(cellDraftOf(selectColumn, null)).toBe('');
  });

  test('optionColorClass：声明色优先，未声明按 ID 稳定散列', () => {
    expect(optionColorClass('blue', 'any')).toContain('var(--accent)');
    expect(optionColorClass(undefined, 'opt_a')).toBe(optionColorClass(undefined, 'opt_a'));
    expect(optionColorClass('unknown-color', 'x')).toBe(optionColorClass(undefined, 'x'));
  });
});

describe('cell-model · 列集合编辑', () => {
  const base = [column({}), selectColumn];

  test('改名 / 删除 / 追加 / 选项编辑', () => {
    expect(renameColumn(base, 'col_text', '摘要')[0]!.name).toBe('摘要');
    expect(removeColumn(base, 'col_text')).toHaveLength(1);
    const appended = appendColumn(base, { name: '截止', type: 'date' });
    expect(appended).toHaveLength(3);
    expect(appended[2]!.type).toBe('date');
    expect(appended[2]!.options).toBeUndefined();
    const withOptions = appendColumn([], { name: '状态', type: 'select' });
    expect(withOptions[0]!.options).toEqual([]);
    expect(setColumnOptions(base, 'col_status', [])[1]!.options).toEqual([]);
  });

  test('validateColumnsReplacement：改类型拒绝、重复 ID 拒绝、空名拒绝、选项缺失拒绝', () => {
    expect(validateColumnsReplacement(base, renameColumn(base, 'col_text', '摘要'))).toEqual({
      ok: true,
    });
    const typeChanged = base.map((entry) =>
      entry.id === 'col_text' ? { ...entry, type: 'number' as const } : entry,
    );
    const failure = validateColumnsReplacement(base, typeChanged);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.failure.kind).toBe('type-change');
      expect(columnsEditFailureText()[failure.failure.kind]).toBe('列类型创建后不可更改');
    }
    const duplicated = [...base, { ...base[0]! }];
    expect(validateColumnsReplacement(base, duplicated).ok).toBe(false);
    expect(validateColumnsReplacement(base, [column({ name: '  ' })]).ok).toBe(false);
    const noOptions = base.map((entry) =>
      entry.id === 'col_status' ? { ...entry, options: undefined } : entry,
    );
    const optionsFailure = validateColumnsReplacement(base, noOptions);
    expect(optionsFailure.ok).toBe(false);
    if (!optionsFailure.ok) {
      expect(optionsFailure.failure.kind).toBe('invalid-options');
      expect(columnsEditFailureText()[optionsFailure.failure.kind]).toBe(
        '选择列必须声明不重复的选项',
      );
    }
  });
});
