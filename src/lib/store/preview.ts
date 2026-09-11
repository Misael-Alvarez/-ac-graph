import type { DiagramModel, Shape } from '@/lib/domain';
import { contentBBox } from '@/lib/engine';
import { canvasTheme, isColor, isDarkCanvas, mixHex, readableTextOn } from '@/lib/design/tokens';
import { paletteFor, themedFill } from '@/lib/editor/providers';
import { firstLine } from '@/lib/editor/richText';
import {
  connectorLabel,
  connectorTags,
  itemBadges,
  strokeFor,
  toneColors,
} from '@/lib/editor/meta';

/**
 * A faithful small rendering of a diagram, for the home page.
 *
 * `renderThumbnail` is deliberately crude — coloured blocks, because one is
 * stored per diagram and has to stay in the low kilobytes. The home page is
 * different: it draws six templates and one showcase, none of them stored, and
 * the whole point of showing them is that they look like the product. So this
 * draws what the canvas draws — cards with a tinted icon well, a title and a
 * subtitle, the group's tinted sheet, the chips and the tags — with text in
 * the system typeface and no icon sprite, which keeps each one under 20KB and
 * makes it an honest preview: what you will get is what you see.
 */
export function renderPreview(model: DiagramModel, dark = false): string {
  const theme = canvasTheme(dark);
  const isDark = isDarkCanvas(theme);
  if (!model.shapes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="${theme.sheet}"/></svg>`;
  }

  const box = contentBBox(model);
  const pad = 48;
  const vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const byId = new Map(model.shapes.map((s) => [s.id, s]));
  const parts: string[] = [
    `<rect x="${r(vb.x)}" y="${r(vb.y)}" width="${r(vb.w)}" height="${r(vb.h)}" fill="${theme.sheet}"/>`,
  ];

  // Same order the canvas paints: regions, boundaries, groups, containers,
  // items, then the notes and texts written over them.
  const order: Record<Shape['type'], number> = {
    region: 0,
    boundary: 1,
    group: 2,
    container: 3,
    item: 4,
    note: 5,
    text: 6,
  };
  const shapes = [...model.shapes].sort((a, b) => order[a.type] - order[b.type]);

  for (const shape of shapes) {
    const palette = paletteFor(shape.icon?.key ?? iconOfSubtree(shape, byId));
    if (shape.type === 'region') {
      const tint = isColor(shape.fill) ? shape.fill : theme.regionTint;
      parts.push(
        rect(
          shape,
          16,
          tint,
          theme.regionStroke,
          1.25,
          '7 5',
          isColor(shape.fill) && !isDark ? 0.6 : 1,
        ),
      );
      if (shape.title) {
        parts.push(
          text(shape.x + 16, shape.y + 24, shape.title.toUpperCase(), 12, 600, theme.subtitleText),
        );
      }
      continue;
    }
    if (shape.type === 'note') {
      const paper = isColor(shape.fill) ? shape.fill : theme.notePaper;
      parts.push(rect(shape, 3, paper, mixHex(paper, '#000000', 0.14), 1));
      parts.push(
        text(
          shape.x + 14,
          shape.y + 28,
          firstLine(shape.title ?? ''),
          13,
          500,
          readableTextOn(paper, theme),
        ),
      );
      continue;
    }
    if (shape.type === 'text') {
      const ink = isColor(shape.fill) ? shape.fill : theme.titleText;
      parts.push(text(shape.x + 4, shape.y + 22, firstLine(shape.title ?? ''), 15, 500, ink));
      continue;
    }
    if (shape.type === 'boundary') {
      parts.push(
        rect(shape, 16, 'none', mixHex(theme.groupStroke, palette.border, 0.5), 1.5, '10 6'),
      );
      parts.push(text(shape.x + 18, shape.y + 24, shape.title ?? '', 13, 600, theme.titleText));
      continue;
    }
    if (shape.type === 'group') {
      const fill = themedFill(shape.fill, theme, theme.groupFill) ?? theme.groupFill;
      const stroke = isDark ? mixHex(theme.groupStroke, palette.border, 0.45) : palette.border;
      parts.push(rect(shape, 12, fill, mixHex(stroke, fill, 0.35), 1));
      // The provider mark and the title, as the canvas draws them.
      parts.push(
        `<rect x="${r(shape.x + 16)}" y="${r(shape.y + 12)}" width="3" height="12" rx="1.5" fill="${palette.border}"/>`,
      );
      parts.push(text(shape.x + 27, shape.y + 22, shape.title ?? '', 12, 600, theme.titleText));
      continue;
    }
    if (shape.type === 'container') {
      const stroke = isDark ? mixHex(theme.itemStroke, palette.border, 0.5) : palette.border;
      parts.push(rect(shape, 10, 'none', stroke, 1, '6 4', 0.8));
      continue;
    }
    // A service card.
    const fill = theme.itemFill;
    const stroke = isDark ? mixHex(theme.itemStroke, palette.border, 0.45) : palette.border;
    parts.push(rect(shape, 10, fill, stroke, 1));
    const wellX = shape.x + 10;
    const wellY = shape.y + (shape.h - 38) / 2;
    parts.push(
      `<rect x="${r(wellX)}" y="${r(wellY)}" width="38" height="38" rx="9" fill="${mixHex(fill, palette.border, isDark ? 0.16 : 0.1)}"/>`,
    );
    // The icon itself is a sprite the preview does not carry; its provider's
    // colour in the well is what the eye reads at this size anyway.
    parts.push(
      `<rect x="${r(wellX + 9)}" y="${r(wellY + 9)}" width="20" height="20" rx="5" fill="${palette.border}"/>`,
    );
    const badges = itemBadges(shape).slice(0, 3);
    const textX = shape.x + 58;
    const lines = 1 + (shape.subtitle ? 1 : 0);
    const chipRow = badges.length ? 21 : 0;
    let y = shape.y + (shape.h - chipRow) / 2 - (lines === 2 ? 9 : 0) + 4;
    parts.push(text(textX, y, shape.title ?? '', 11, 600, theme.titleText));
    if (shape.subtitle) {
      y += 14;
      parts.push(text(textX, y, shape.subtitle, 10, 400, theme.subtitleText));
    }
    let chipX = textX;
    const chipY = shape.y + shape.h - 10 - 13;
    for (const badge of badges) {
      const w = Math.ceil(badge.text.length * 8.5 * 0.62) + 12;
      const colors = toneColors(badge.tone, fill, theme);
      parts.push(
        `<rect x="${r(chipX)}" y="${r(chipY)}" width="${w}" height="15" rx="7.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="0.75"/>`,
      );
      parts.push(
        text(
          chipX + w / 2,
          chipY + 10.6,
          badge.text.toUpperCase(),
          8.5,
          600,
          colors.text,
          'middle',
        ),
      );
      chipX += w + 4;
    }
  }

  for (const connector of model.connectors) {
    const points = connector.waypoints;
    if (points.length < 2) continue;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)},${r(p.y)}`).join('');
    const stroke = strokeFor(connector);
    parts.push(
      `<path d="${d}" fill="none" stroke="${theme.connector}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"${stroke.dasharray ? ` stroke-dasharray="${stroke.dasharray}"` : ''}/>`,
    );
    parts.push(arrowhead(points[points.length - 2], points[points.length - 1], theme.connector));

    const label = connectorLabel(connector);
    const tags = connectorTags(connector);
    if (!label && !tags.length) continue;
    const mid = midpoint(points);
    const labelW = label ? label.length * 6.2 + 20 : 0;
    const tagWs = tags.map((tag) => Math.ceil(tag.text.length * 8.5 * 0.62) + 12);
    const total = labelW + tagWs.reduce((sum, w) => sum + w + 4, label ? 0 : -4);
    let x = mid.x - total / 2;
    if (label) {
      parts.push(
        `<rect x="${r(x)}" y="${r(mid.y - 10)}" width="${r(labelW)}" height="20" rx="10" fill="${theme.connectorLabelFill}" stroke="${theme.connectorLabelStroke}"/>`,
      );
      parts.push(
        text(x + labelW / 2, mid.y + 4, label, 11, 500, theme.connectorLabelText, 'middle'),
      );
      x += labelW + 4;
    }
    tags.forEach((tag, i) => {
      const colors = toneColors(tag.tone, theme.connectorLabelFill, theme);
      parts.push(
        `<rect x="${r(x)}" y="${r(mid.y - 7.5)}" width="${tagWs[i]}" height="15" rx="7.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="0.75"/>`,
      );
      parts.push(
        text(
          x + tagWs[i] / 2,
          mid.y + 3.1,
          tag.text.toUpperCase(),
          8.5,
          600,
          colors.text,
          'middle',
        ),
      );
      x += tagWs[i] + 4;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(vb.x)} ${r(vb.y)} ${r(vb.w)} ${r(vb.h)}" preserveAspectRatio="xMidYMid meet" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${parts.join('')}</svg>`;
}

const r = (n: number) => Math.round(n * 10) / 10;

function rect(
  s: Shape,
  rx: number,
  fill: string,
  stroke: string,
  width: number,
  dash?: string,
  opacity?: number,
): string {
  return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`;
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  weight: number,
  fill: string,
  anchor: 'start' | 'middle' = 'start',
): string {
  return `<text x="${r(x)}" y="${r(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escape(value)}</text>`;
}

function arrowhead(from: { x: number; y: number }, to: { x: number; y: number }, fill: string) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 7;
  const p = (a: number, d: number) => `${r(to.x - Math.cos(a) * d)},${r(to.y - Math.sin(a) * d)}`;
  return `<path d="M${r(to.x)},${r(to.y)} L${p(angle - 0.45, size)} L${p(angle + 0.45, size)} Z" fill="${fill}"/>`;
}

function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(l);
    total += l;
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    if (remaining <= lengths[i - 1]) {
      const t = lengths[i - 1] ? remaining / lengths[i - 1] : 0;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    remaining -= lengths[i - 1];
  }
  return points[points.length - 1];
}

/** The first service icon inside a group or container, for its tint. */
function iconOfSubtree(shape: Shape, byId: Map<string, Shape>): string | undefined {
  for (const candidate of byId.values()) {
    if (candidate.type !== 'item' || !candidate.icon) continue;
    const container = candidate.parentId ? byId.get(candidate.parentId) : undefined;
    if (container?.id === shape.id || container?.parentId === shape.id) return candidate.icon.key;
  }
  return undefined;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
