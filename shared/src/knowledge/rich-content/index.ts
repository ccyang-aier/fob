/** Portable rich-content semantics. No browser, network or renderer dependencies. */
export function richContentUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export interface EmbedTarget { url: string; provider: 'bilibili' | 'youtube' | 'vimeo' | 'web' }
const positive = (value: string | null, fallback: number) => value && /^\d+$/.test(value) ? Math.min(Number(value), 2_147_483_647) : fallback;

function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.floor(Number(value));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
}

export function resolveEmbedTarget(value: unknown): EmbedTarget | null {
  const safe = richContentUrl(value);
  if (!safe) return null;
  const url = new URL(safe), host = url.hostname.replace(/^www\./, '');
  if (host === 'bilibili.com' || host === 'm.bilibili.com' || host === 'player.bilibili.com') {
    const bvid = url.pathname.match(/\/video\/(BV[\da-zA-Z]{10})(?:\/|$)/)?.[1] ?? url.searchParams.get('bvid');
    const aid = url.pathname.match(/\/video\/av(\d+)(?:\/|$)/)?.[1] ?? url.searchParams.get('aid');
    if ((bvid && /^BV[\da-zA-Z]{10}$/.test(bvid)) || (aid && /^\d+$/.test(aid))) {
      const target = new URL('https://player.bilibili.com/player.html');
      if (bvid && /^BV[\da-zA-Z]{10}$/.test(bvid)) target.searchParams.set('bvid', bvid);
      else target.searchParams.set('aid', aid!);
      target.searchParams.set('p', String(Math.max(1, positive(url.searchParams.get('p') ?? url.searchParams.get('page'), 1))));
      target.searchParams.set('t', String(seconds(url.searchParams.get('t') ?? url.searchParams.get('start_progress'))));
      target.searchParams.set('autoplay', '0');
      target.searchParams.set('danmaku', '0');
      return { url: target.href, provider: 'bilibili' };
    }
  }
  if (['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1] ?? url.searchParams.get('v');
    if (id && /^[\w-]{11}$/.test(id)) {
      const target = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
      const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
      if (start) target.searchParams.set('start', String(start));
      return { url: target.href, provider: 'youtube' };
    }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
    if (id) return { url: `https://player.vimeo.com/video/${id}`, provider: 'vimeo' };
  }
  return { url: safe, provider: 'web' };
}

export function isPdfSource(source: string, mime?: string | null, name?: string | null): boolean {
  return mime?.split(';')[0].toLowerCase() === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(name || '') || /\.pdf(?:$|[?#])/i.test(source);
}

export const MAX_WHITEBOARD_BYTES = 4 * 1024 * 1024;
export interface WhiteboardScene {
  elements: Record<string, unknown>[];
  appState: { viewBackgroundColor?: string };
  files: Record<string, { id: string; mimeType: string; dataURL: string; created: number }>;
}

/** Scene bytes live with the page and inherit its ACL; never persist runtime/editor state. */
export function parseWhiteboardScene(value: string): WhiteboardScene | null {
  if (!value) return null;
  if (value.length > MAX_WHITEBOARD_BYTES || new TextEncoder().encode(value).byteLength > MAX_WHITEBOARD_BYTES) throw new RangeError('Whiteboard exceeds 4 MiB');
  const scene: unknown = JSON.parse(value);
  if (!scene || typeof scene !== 'object') throw new TypeError('Invalid whiteboard scene');
  const record = scene as Record<string, unknown>;
  if (!Array.isArray(record.elements) || record.elements.length > 2000 || !record.appState || typeof record.appState !== 'object' || !record.files || typeof record.files !== 'object' || Array.isArray(record.files)) throw new TypeError('Invalid whiteboard scene');
  const ids = new Set<string>();
  for (const element of record.elements) {
    if (!element || typeof element !== 'object' || typeof element.id !== 'string' || ids.has(element.id) || typeof element.type !== 'string'
      || !['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'magicframe', 'embeddable', 'iframe'].includes(element.type)
      || ['x', 'y', 'width', 'height'].some(key => typeof element[key] !== 'number' || !Number.isFinite(element[key]) || Math.abs(element[key]) > 1_000_000)) throw new TypeError('Invalid whiteboard element');
    // External live web frames are represented by Fob's embed block instead.
    if (element.type === 'iframe' || element.type === 'embeddable') throw new TypeError('External whiteboard frames are unsupported');
    ids.add(element.id);
  }
  for (const [key, file] of Object.entries(record.files)) {
    if (!file || typeof file !== 'object') throw new TypeError('Invalid whiteboard file');
    const entry = file as Record<string, unknown>;
    if (key !== entry.id || typeof entry.dataURL !== 'string' || !/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(entry.dataURL)
      || typeof entry.created !== 'number' || !Number.isFinite(entry.created) || typeof entry.mimeType !== 'string' || !/^image\/(?:png|jpeg|jpg|gif|webp)$/.test(entry.mimeType)) throw new TypeError('Invalid whiteboard file');
  }
  const background = (record.appState as Record<string, unknown>).viewBackgroundColor;
  if (background !== undefined && (typeof background !== 'string' || !/^(?:#[\da-f]{3,8}|transparent)$/i.test(background))) throw new TypeError('Invalid whiteboard background');
  return { elements: record.elements, appState: { ...(background ? { viewBackgroundColor: background as string } : {}) }, files: record.files as WhiteboardScene['files'] };
}
