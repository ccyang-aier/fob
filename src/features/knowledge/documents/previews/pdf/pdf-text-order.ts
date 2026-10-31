import type { PDFPageProxy } from 'pdfjs-dist';

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type TextItem = Extract<TextContent['items'][number], { str: string }>;

/** PDF drawing order can put callouts after the body. Selection follows DOM order. */
export function orderPdfText(content: TextContent, point: (x: number, y: number) => number[]): TextContent {
  const runs = content.items.filter((item): item is TextItem => 'str' in item && item.str.length > 0).map(item => {
    const [x, y] = point(item.transform[4], item.transform[5]);
    const [, bottom] = point(item.transform[4], item.transform[5] + (item.height || Math.hypot(item.transform[2], item.transform[3])));
    return { item, x, y, height: Math.abs(bottom - y) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: typeof runs[] = [];
  for (const run of runs) {
    const row = rows.at(-1);
    const tolerance = row ? Math.min(row[0].height, run.height) * .4 : 0;
    if (row && Math.abs(row[0].y - run.y) <= tolerance) row.push(run);
    else rows.push([run]);
  }
  return { ...content, items: rows.flatMap(row => row.sort((a, b) => a.x - b.x).map(({ item }, index) => ({ ...item, hasEOL: index === row.length - 1 }))) };
}
