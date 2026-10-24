import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './table-csv.messages';

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';

const knowledgeT = createTranslator(knowledgeMessages);

/** Covered slots stay empty so merged cells retain the table's rectangular shape. */
export function tableToCsv(table: ProseMirrorNode): string {
  const map = TableMap.get(table);
  const escape = (text: string) =>
    /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  return (
    Array.from({ length: map.height }, (_, row) =>
      Array.from({ length: map.width }, (_, column) => {
        const pos = map.map[row * map.width + column];
        const rect = map.findCell(pos);
        if (rect.top !== row || rect.left !== column) return '';
        const cell = table.nodeAt(pos)!;
        return escape(
          cell.textBetween(0, cell.content.size, '\n', (leaf) =>
            leaf.type.name === 'hardBreak' ? '\n' : (leaf.attrs.alt ?? leaf.attrs.title ?? ''),
          ),
        );
      }).join(','),
    ).join('\r\n') + '\r\n'
  );
}

export function downloadTableCsv(table: ProseMirrorNode, ownerDocument: Document): void {
  const url = URL.createObjectURL(
    new Blob(['\ufeff', tableToCsv(table)], { type: 'text/csv;charset=utf-8' }),
  );
  const link = ownerDocument.createElement('a');
  link.href = url;
  link.download = knowledgeT('tableCsv');
  ownerDocument.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
