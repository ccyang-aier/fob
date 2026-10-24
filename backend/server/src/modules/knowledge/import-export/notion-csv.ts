import type { PropertyDefinition, Properties } from '@fob/shared/knowledge/contracts';
import type { NotionImportWarning, NotionParsedDatabase, NotionParsedRow } from './notion-types';

/**
 * Notion 导出的 CSV = 数据库视图(T02 之源)。RFC 4180 解析后按列值域推断
 * T02 属性类型:checkbox/number/url/date/select/multiSelect/text。person 与
 * relation 在导出里只剩显示文本、没有目标身份,按 text 落库并逐列告警——
 * 值不丢失,类型退化显式可见。
 */

/** RFC 4180:引号字段可含逗号、换行与转义引号;分隔符只认逗号。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell !== ''));
}

const checkboxTruthy = new Set(['yes', 'true', '✓', 'checked']);
const checkboxFalsy = new Set(['no', 'false', '✗', 'unchecked', '']);

function checkboxValue(cell: string): boolean | null {
  const normalized = cell.trim().toLowerCase();
  if (checkboxTruthy.has(normalized)) return true;
  if (checkboxFalsy.has(normalized)) return false;
  return null;
}

/** 仅接受无千分位的十进制数,避免与多值逗号语义冲突。 */
function numberValue(cell: string): number | null {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cell.trim())) return null;
  const value = Number(cell.trim());
  return Number.isFinite(value) ? value : null;
}

const urlValue = (cell: string): string | null => /^https?:\/\/\S+\.\S+/i.test(cell.trim()) ? cell.trim() : null;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Notion CSV(en 区域)常见形态:ISO、"November 12, 2024"、"Nov 12, 2024",可带时间。 */
function dateValue(cell: string): string | null {
  const value = cell.trim().replace(/\s+(AM|PM)$/i, (_, meridiem: string) => ` ${meridiem.toUpperCase()}`);
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (match) return match[4] ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` : `${match[1]}-${match[2]}-${match[3]}`;
  match = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/.exec(value);
  if (match) {
    const month = MONTHS.findIndex((name) => name.startsWith(match![1]!.toLowerCase()));
    if (month >= 0) {
      const day = match[2]!.padStart(2, '0');
      const hour = match[4] !== undefined ? Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0) : null;
      const minute = match[5] ?? null;
      const time = hour !== null && minute !== null ? `T${String(hour).padStart(2, '0')}:${minute}` : '';
      return `${match[3]}-${String(month + 1).padStart(2, '0')}-${day}${time}`;
    }
  }
  return null;
}

/** 值域推断:全部可转才定类型;任何空单元格视为该类型下的空值。 */
function inferColumn(cells: readonly string[], id: string, name: string): { column: PropertyDefinition; values: (string | number | boolean | string[] | null)[] } {
  const present = cells.filter((cell) => cell !== '');
  if (present.length) {
    if (present.every((cell) => checkboxValue(cell) !== null)) {
      return { column: { id, name, type: 'checkbox' }, values: cells.map((cell) => cell === '' ? null : checkboxValue(cell)) };
    }
    const numbers = present.map(numberValue);
    if (numbers.every((value) => value !== null)) {
      return { column: { id, name, type: 'number' }, values: cells.map((cell) => cell === '' ? null : numberValue(cell)) };
    }
    if (present.every((cell) => urlValue(cell) !== null)) {
      return { column: { id, name, type: 'url' }, values: cells.map((cell) => cell === '' ? null : urlValue(cell)) };
    }
    const dates = present.map(dateValue);
    if (dates.every((value) => value !== null)) {
      return { column: { id, name, type: 'date' }, values: cells.map((cell) => cell === '' ? null : dateValue(cell)) };
    }
    // Notion 以 ", " 连接多选值:任一单元格可拆出多个非空值即为多选;选项取并集。
    if (present.some((cell) => cell.split(', ').filter((part) => part.trim()).length > 1)) {
      const parts = present.flatMap((cell) => cell.split(', ').map((part) => part.trim()).filter(Boolean));
      const unique = [...new Set(parts)];
      return {
        column: { id, name, type: 'multiSelect', options: unique.map((label, index) => ({ id: `${id}_o${index}`, label, color: 'neutral' })) },
        values: cells.map((cell) => cell === '' ? null : cell.split(', ').map((part) => part.trim()).filter(Boolean)),
      };
    }
    const unique = [...new Set(present.map((cell) => cell.trim()))];
    if (unique.length > 1 && unique.length <= 30) {
      return {
        column: { id, name, type: 'select', options: unique.map((label, index) => ({ id: `${id}_o${index}`, label, color: 'neutral' })) },
        values: cells.map((cell) => cell === '' ? null : cell.trim()),
      };
    }
  }
  return { column: { id, name, type: 'text' }, values: [...cells] };
}

/**
 * 第一列恒为行标题(Notion 导出约定),其余列按值域推断。person/relation 无导出
 * 依据,统一退化为 text 并逐列告警——由调用方把告警并入报告,保证无静默丢失。
 */
export function parseNotionCsv(text: string, source: string): NotionParsedDatabase | null {
  const table = parseCsv(text);
  if (table.length < 2) return null;
  const [header, ...data] = table;
  const width = Math.max(...table.map((row) => row.length));
  const padded = data.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')]);
  const { columns, values, warnings } = inferNotionColumns([...header!, ...Array.from({ length: width - header!.length }, () => '')], padded, source);
  const rows: NotionParsedRow[] = padded.map((row, rowIndex) => {
    const properties: Properties = {};
    columns.forEach((column, columnIndex) => {
      const value = values[columnIndex]![rowIndex];
      if (value !== null) properties[column.id] = value;
    });
    return { title: row[0]?.trim() ?? '', properties, pageKey: null };
  });
  return { columns, rows, warnings };
}

/** person/relation 列在导出里没有可解析的目标身份:类型退化必须显式告警。 */
function pushColumnWarnings(warnings: NotionImportWarning[], source: string, name: string, type: PropertyDefinition['type']): void {
  if (/^(person|owner|assignee|people)$/i.test(name)) {
    warnings.push({ source, code: 'relation_column_as_text', detail: `列 “${name}” 的成员值在导出中只有显示名,按 ${type} 导入` });
  } else if (/^(relation|related to|projects|tasks)$/i.test(name) && type !== 'text') {
    warnings.push({ source, code: 'relation_column_as_text', detail: `列 “${name}” 形似关联,导出不携带目标库,按 ${type} 导入` });
  }
}

/** HTML 数据库表格与 CSV 共用的列推断入口:首列为标题,其余列按值域定类型。 */
export function inferNotionColumns(header: readonly string[], data: readonly (readonly string[])[], source: string, idPrefix = 'csv_p'): {
  columns: PropertyDefinition[];
  values: (string | number | boolean | string[] | null)[][];
  warnings: NotionImportWarning[];
} {
  const columns: PropertyDefinition[] = [];
  const values: (string | number | boolean | string[] | null)[][] = [];
  const warnings: NotionImportWarning[] = [];
  for (let column = 1; column < header.length; column++) {
    const name = header[column]?.trim() || `Column ${column}`;
    const cells = data.map((row) => row[column] ?? '');
    const inferred = inferColumn(cells, `${idPrefix}${column}`, name);
    columns.push(inferred.column);
    values.push(inferred.values);
    pushColumnWarnings(warnings, source, name, inferred.column.type);
  }
  return { columns, values, warnings };
}
