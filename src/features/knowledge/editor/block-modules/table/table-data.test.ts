import { describe, expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { formatTableColor, parseTableColor } from './table-color';
import { tableToCsv } from './table-csv';

describe('table color values', () => {
  test('round-trips RGB and RGBA including neutral colors and fully transparent colors', () => {
    for (const color of ['#7e3d3db3', '#000000', '#ffffff', '#aabbcc00', '#e3dceb', '#ff0000', '#00ff00', '#0000ff', '#abcdef80']) {
      expect(formatTableColor(parseTableColor(color)!)).toBe(color);
    }
    expect(formatTableColor(parseTableColor('#abc')!)).toBe('#aabbcc');
    expect(formatTableColor(parseTableColor('#abcd')!)).toBe('#aabbccdd');
  });
  test('rejects malformed colors and clamps saturation, brightness, and opacity', () => {
    for (const invalid of ['red', '#gg0000', '#12', '#12345', '#123456789', 'url(x)']) expect(parseTableColor(invalid)).toBeNull();
    expect(formatTableColor({ h: 360, s: 2, v: 2, a: -.2 })).toBe('#ff000000');
  });
});

describe('table CSV', () => {
  const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
  const cell = (text: string, attrs = {}) => schema.nodes.tableCell.create(attrs, paragraph(text));
  const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow.create(null, cells);
  test('exports Chinese headers, commas, quotes, empty cells, and line breaks with CSV escaping', () => {
    const table = schema.nodes.table.create(null, [
      row(schema.nodes.tableHeader.create(null, paragraph('标题')), cell('备注')),
      row(cell('a,b'), cell('说"你好"')),
      row(cell('第一行\n第二行'), cell('')),
    ]);
    expect(tableToCsv(table)).toBe('标题,备注\r\n"a,b","说""你好"""\r\n"第一行\n第二行",\r\n');
  });
  test('exports merged values once and keeps covered rows and columns rectangular', () => {
    const table = schema.nodes.table.create(null, [row(cell('合并', { colspan: 2, rowspan: 2 }), cell('A')), row(cell('B'))]);
    table.check();
    expect(tableToCsv(table)).toBe('合并,,A\r\n,,B\r\n');
  });
  test('preserves paragraph and explicit line break boundaries', () => {
    const content = [schema.nodes.paragraph.create(null, [schema.text('A'), schema.nodes.hardBreak.create(), schema.text('B')]), paragraph('C')];
    expect(tableToCsv(schema.nodes.table.create(null, row(schema.nodes.tableCell.create(null, content))))).toBe('"A\nB\nC"\r\n');
  });
});
