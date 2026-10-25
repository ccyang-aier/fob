import { parse } from 'node-html-parser';
import type { LinkPreview } from '@fob/shared/knowledge/contracts';
import { publicContentUrl } from './public-html';

export function parseLinkPreview(html: string, source: string): LinkPreview {
  const root = parse(html), url = publicContentUrl(source);
  const meta = (name: string) => root.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ?? root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '';
  const clean = (value: string, limit: number) => value.replace(/\s+/g, ' ').trim().slice(0, limit);
  let image = '';
  try { image = publicContentUrl(new URL(meta('og:image') || meta('twitter:image'), url).href).href; } catch { /* A cover is optional. */ }
  // Empty metadata must not turn the current page itself into a cover image.
  if (!meta('og:image') && !meta('twitter:image')) image = '';
  return {
    url: url.href,
    title: clean(meta('og:title') || meta('twitter:title') || root.querySelector('title')?.textContent || url.hostname, 500),
    description: clean(meta('og:description') || meta('description') || meta('twitter:description'), 2000),
    image, siteName: clean(meta('og:site_name') || url.hostname, 200),
  };
}
