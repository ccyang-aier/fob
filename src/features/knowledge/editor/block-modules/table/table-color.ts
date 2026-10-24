export interface TableColor { h: number; s: number; v: number; a: number }
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function parseTableColor(hex: string): TableColor | null {
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
  let value = hex.slice(1);
  if (value.length < 5) value = Array.from(value, digit => digit + digit).join('');
  const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels;
  const v = Math.max(...channels), min = Math.min(...channels), delta = v - min;
  const h = delta === 0 ? 0 : ((v === r ? (g - b) / delta : v === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return { h, s: v === 0 ? 0 : delta / v, v, a: value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1 };
}

export function formatTableColor({ h, s, v, a }: TableColor): string {
  const hue = ((h % 360) + 360) % 360 / 60;
  const chroma = clamp(v) * clamp(s), x = chroma * (1 - Math.abs(hue % 2 - 1)), m = clamp(v) - chroma;
  const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const byte = (value: number) => Math.round(clamp(value) * 255).toString(16).padStart(2, '0');
  return '#' + rgb.map(channel => byte(channel + m)).join('') + (a < 1 ? byte(a) : '');
}
