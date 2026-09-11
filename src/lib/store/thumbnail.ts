import type { DiagramModel } from '@/lib/domain';
import { contentBBox } from '@/lib/engine';
import { canvasTheme, providerColors } from '@/lib/design/tokens';
import { providerOf } from '@/lib/editor/providers';

/**
 * A tiny SVG preview for the library grid.
 *
 * Deliberately not the real renderer: that inlines the whole 107KB icon sprite,
 * which would be stored once per diagram. Coloured blocks read fine at 200px and
 * keep a stored thumbnail in the low kilobytes.
 */
export function renderThumbnail(model: DiagramModel, dark = false): string {
  const theme = canvasTheme(dark);
  if (!model.shapes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 64"><rect width="100" height="64" fill="${theme.sheet}"/></svg>`;
  }

  const box = contentBBox(model);
  const pad = Math.max(box.w, box.h) * 0.05 + 20;
  const viewBox = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`;
  const stroke = (box.w + box.h) / 400;

  const parts: string[] = [
    `<rect x="${box.x - pad}" y="${box.y - pad}" width="${box.w + pad * 2}" height="${box.h + pad * 2}" fill="${theme.sheet}"/>`,
  ];

  // Regions first, so they sit under what they tint; texts not at all, since
  // at this size a line of words is a smudge.
  const shapes = [...model.shapes].sort(
    (a, b) => Number(b.type === 'region') - Number(a.type === 'region'),
  );
  for (const shape of shapes) {
    if (shape.type === 'container' || shape.type === 'text') continue;
    if (shape.type === 'region') {
      parts.push(
        `<rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.w)}" height="${r(shape.h)}" rx="10" fill="${theme.regionTint}" stroke="${theme.regionStroke}" stroke-width="${r(stroke)}" stroke-dasharray="${r(stroke * 6)} ${r(stroke * 4)}"/>`,
      );
      continue;
    }
    if (shape.type === 'note') {
      parts.push(
        `<rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.w)}" height="${r(shape.h)}" rx="3" fill="${theme.notePaper}"/>`,
      );
      continue;
    }
    if (shape.type === 'boundary') {
      parts.push(
        `<rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.w)}" height="${r(shape.h)}" rx="8" fill="none" stroke="${theme.groupStroke}" stroke-width="${r(stroke * 1.5)}"/>`,
      );
      continue;
    }
    if (shape.type === 'group') {
      parts.push(
        `<rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.w)}" height="${r(shape.h)}" rx="6" fill="${theme.groupFill}" stroke="${theme.itemStroke}" stroke-width="${r(stroke)}"/>`,
      );
      continue;
    }
    const colour = providerColors[providerOf(shape.icon?.key) as keyof typeof providerColors];
    parts.push(
      `<rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.w)}" height="${r(shape.h)}" rx="4" fill="${colour}" fill-opacity="0.75"/>`,
    );
  }

  for (const connector of model.connectors) {
    if (connector.waypoints.length < 2) continue;
    const d = connector.waypoints.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)},${r(p.y)}`).join('');
    parts.push(
      `<path d="${d}" fill="none" stroke="${theme.connector}" stroke-width="${r(stroke)}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** Data URL form, ready for an `<img src>`. */
export function thumbnailDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
