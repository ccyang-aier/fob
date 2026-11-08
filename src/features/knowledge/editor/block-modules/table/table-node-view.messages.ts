import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  columns: ['列', 'column'],
  rows: ['行', 'row'],
  tableRowAndColumnControls: ['表格行列控制', 'Table row and column controls'],
  selectWholeTable: ['选择整个表格', 'Select whole table'],
  columnValueActions: ['第 {v0} 列操作', 'Column {v0} actions'],
  rowValueActions: ['第 {v0} 行操作', 'Row {v0} actions'],
  insertAtValuePositionValue: ['在第 {v0} {v1}位置插入', 'Insert at {v1} position {v0}'],
  moveToThisValuePosition: ['移动到此{v0}位置', 'Move to this {v0} position'],
  cannotDropHere: ['此处不可放置', 'Cannot drop here'],
  addRow: ['添加行', 'Add rows'],
  addColumn: ['添加列', 'Add columns'],
  addRowHint: ['点击添加一行，拖动可添加更多行', 'Click to add a row, drag to add more rows'],
  addColumnHint: ['点击添加一列，拖动可添加更多列', 'Click to add a column, drag to add more columns'],
  addCount: ['添加 {count} {axis}', 'Add {count} {axis}'],
});
