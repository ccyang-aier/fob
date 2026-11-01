/** Profile uploads are normalized to small, static WebP portraits by the client. */
export function validProfileImage(image: unknown, origins: ReadonlySet<string>): boolean {
  if (image === null) return true;
  if (typeof image !== 'string') return false;
  if (image.startsWith('data:image/webp;base64,')) {
    const encoded = image.slice(23);
    if (encoded.length > 12_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 30 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return false;
    const chunk = bytes.toString('ascii',12,16);
    let width = 0, height = 0;
    if (chunk === 'VP8X') {
      if (bytes[20]! & 2) return false; // No animated avatar payloads.
      width = bytes.readUIntLE(24,3)+1; height = bytes.readUIntLE(27,3)+1;
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff)+1; height = ((bits >>> 14) & 0x3fff)+1;
    }
    return width > 0 && height > 0 && width <= 256 && height <= 256;
  }
  try {
    const url = new URL(image);
    return origins.has(url.origin) && !url.username && !url.password && !url.search && !url.hash && /^\/avatars\/v1\/(pets|sketches|landscapes)-0[1-8]\.webp$/.test(url.pathname);
  } catch { return false; }
}
