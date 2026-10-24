import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';

const TIMEOUT = 45_000;
const PRINT_CSS = `
@page { size: A4; margin: 18mm 18mm 20mm }
html,body { height:auto!important; min-height:0!important }
body > :first-child { width:100%!important; max-width:none!important; margin:0!important; padding-top:0!important; padding-bottom:0!important }
* { -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important }
h1,h2,h3,h4,h5,h6 { width:auto!important; max-width:100%!important; height:auto!important; break-after:avoid-page!important; break-inside:avoid!important }
p,li { orphans:3!important; widows:3!important }
table { width:100%!important; max-width:100%!important; table-layout:fixed!important; break-inside:auto!important }
thead { display:table-header-group!important; break-inside:avoid!important }
tr { break-inside:avoid!important }
td,th { overflow-wrap:anywhere!important }
pre { white-space:pre-wrap!important; overflow-wrap:anywhere!important; overflow:visible!important; break-inside:avoid!important }
img,svg { max-width:100%!important; break-inside:avoid!important }
img { max-height:850px!important; height:auto!important; object-fit:contain }
[data-pdf-split] { break-inside:auto!important }
`;

export class DocumentPdfError extends Error {
  constructor(readonly code: 'PDF_BUSY' | 'PDF_UNAVAILABLE' | 'PDF_RENDER_FAILED') { super(code); }
}

/** Stateless renderer: no saved documents, cookies, JavaScript or outbound requests. */
export function createDocumentPdfRenderer() {
  let browser: Promise<Browser> | undefined;
  let active = 0;
  const launch = () => browser ??= puppeteer.launch({ headless: true, timeout: 20_000 }).then(instance => {
    instance.once('disconnected', () => { browser = undefined; });
    return instance;
  }).catch(error => {
    browser = undefined;
    throw error;
  });
  return {
    async render(html: string): Promise<Uint8Array> {
      if (active >= 2) throw new DocumentPdfError('PDF_BUSY');
      active++;
      let context: Awaited<ReturnType<Browser['createBrowserContext']>> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        let instance: Browser;
        try { instance = await launch(); } catch { throw new DocumentPdfError('PDF_UNAVAILABLE'); }
        context = await instance.createBrowserContext();
        const isolated = context;
        return await Promise.race([
          (async () => {
            const page = await isolated.newPage();
            page.setDefaultTimeout(TIMEOUT);
            await page.setJavaScriptEnabled(false);
            await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
            await page.setRequestInterception(true);
            let blocked = false;
            page.on('request', request => {
              if (request.url().startsWith('data:')) void request.continue().catch(() => {});
              else { blocked = true; void request.abort().catch(() => {}); }
            });
            await page.setContent(html, { waitUntil: 'load', timeout: TIMEOUT });
            await page.addStyleTag({ content: PRINT_CSS });
            await page.emulateMediaType('print');
            // DevTools evaluation remains available while document scripts are disabled.
            await page.evaluate(`(async () => {
              await document.fonts.ready;
              await Promise.all([...document.images].map(image => image.decode()));
              for (const table of document.querySelectorAll('table')) {
                const first = table.rows[0];
                if (!table.tHead && first && [...first.cells].every(cell => cell.tagName === 'TH' && cell.rowSpan === 1)) table.createTHead().append(first);
                const columns = [...table.querySelectorAll('col')];
                const widths = columns.map(column => parseFloat(column.style.width) || 0);
                const total = widths.reduce((sum, width) => sum + width, 0);
                if (total && widths.every(Boolean)) columns.forEach((column, index) => column.style.width = (widths[index] / total * 100) + '%');
              }
              for (const element of document.querySelectorAll('body *')) {
                if (['hidden','auto','scroll'].includes(getComputedStyle(element).overflow)) element.style.overflow = 'visible';
                if (element.getBoundingClientRect().height > 870) element.setAttribute('data-pdf-split', '');
              }
            })()`);
            if (blocked) throw new Error('Snapshot contains external resources');
            return page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true,
              waitForFonts: true, timeout: TIMEOUT, displayHeaderFooter: true, headerTemplate: '<span></span>',
              footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#7b8190"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
          })(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('PDF render timeout')), TIMEOUT); }),
        ]);
      } catch (error) {
        if (error instanceof DocumentPdfError) throw error;
        throw new DocumentPdfError('PDF_RENDER_FAILED');
      } finally {
        clearTimeout(timeout);
        await context?.close().catch(() => {});
        active--;
      }
    },
    async close() { await (await browser?.catch(() => undefined))?.close(); browser = undefined; },
  };
}
