export type KnowledgeUrlPurpose = 'link' | 'media';

function safeHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}

/**
 * Return an inert null for unsupported URLs. Original document attributes remain
 * intact for review/export; NodeViews must use this same policy when resolving URLs.
 * Asset identifiers are knowledge-base-scoped hashes; their access-controlled resolution
 * belongs to the resource client, not this schema.
 */
export function safeKnowledgeUrl(value: unknown, purpose: KnowledgeUrlPurpose): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const url = value.trim();
  if (!url) return null;
  if (/^asset:[a-f0-9]{64}$/.test(url)) return url;
  if (safeHttpUrl(url)) return url;

  if (purpose === 'media') {
    // A blob URL is syntactically checked, never dereferenced or required to exist.
    if (!/^blob:/i.test(url)) return null;
    const reference = url.slice(5);
    const boundary = reference.lastIndexOf('/');
    if (boundary < 0 || !/^[A-Za-z0-9._~-]+$/.test(reference.slice(boundary + 1))) return null;
    const origin = reference.slice(0, boundary);
    if (origin === 'null') return url;
    if (!safeHttpUrl(origin)) return null;
    const parsed = new URL(origin);
    return parsed.pathname === '/' && !parsed.search && !parsed.hash ? url : null;
  }

  if (/^mailto:[^/?#\s][^#]*$/i.test(url)) return url;
  // Protocol-relative and backslash addresses are not same-origin relative links.
  if (url.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return null;
  return url;
}
