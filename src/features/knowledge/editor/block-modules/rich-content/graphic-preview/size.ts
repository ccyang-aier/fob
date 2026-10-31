import { parseWhiteboardScene } from '@fob/shared/knowledge/rich-content';

export type GraphicSize = { width: number; height: number };

/** SVG geometry, rather than the placeholder dimensions of the image element. */
export function svgGraphicSize(svg: string): GraphicSize | undefined {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const box = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
  const width = box?.[2] ?? Number.parseFloat(root.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1] ?? '');
  const height = box?.[3] ?? Number.parseFloat(root.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1] ?? '');
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

/** A thumbnail may be exported at 1024px even for a tiny sketch. Use scene units. */
export function whiteboardGraphicSize(scene: string): GraphicSize | undefined {
  if (!scene) return;
  try {
    const data = parseWhiteboardScene(scene);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const element of data?.elements ?? []) {
      if (element.isDeleted) continue;
      const { x, y, width, height } = element;
      if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' || ![x, y, width, height].every(Number.isFinite)) continue;
      const angle = typeof element.angle === 'number' ? element.angle : 0;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      if (element.type === 'ellipse') {
        const halfWidth = Math.hypot(width * cosine, height * sine) / 2, halfHeight = Math.hypot(width * sine, height * cosine) / 2;
        left = Math.min(left, x + width / 2 - halfWidth); right = Math.max(right, x + width / 2 + halfWidth);
        top = Math.min(top, y + height / 2 - halfHeight); bottom = Math.max(bottom, y + height / 2 + halfHeight);
        continue;
      }
      const points: number[][] = Array.isArray(element.points) ? element.points.filter((point): point is number[] => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number') : [];
      if (!points.length) points.push(...(element.type === 'diamond' ? [[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]] : [[0, 0], [width, 0], [width, height], [0, height]]));
      let localLeft = Infinity, localTop = Infinity, localRight = -Infinity, localBottom = -Infinity;
      for (const point of points) { localLeft = Math.min(localLeft, point[0]); localRight = Math.max(localRight, point[0]); localTop = Math.min(localTop, point[1]); localBottom = Math.max(localBottom, point[1]); }
      const centerX = (localLeft + localRight) / 2, centerY = (localTop + localBottom) / 2;
      for (const point of points) {
        const pointX = x + centerX + (point[0] - centerX) * cosine - (point[1] - centerY) * sine;
        const pointY = y + centerY + (point[0] - centerX) * sine + (point[1] - centerY) * cosine;
        left = Math.min(left, pointX); right = Math.max(right, pointX); top = Math.min(top, pointY); bottom = Math.max(bottom, pointY);
      }
    }
    if (Number.isFinite(left) && right >= left && bottom >= top) return { width: Math.max(1, right - left) + 16, height: Math.max(1, bottom - top) + 16 };
  } catch { /* Invalid scenes retain their existing error presentation. */ }
}
