import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/editor/templates';
import { createEmptyModel } from '@/lib/engine';
import { parseDsl } from '@/lib/dsl';
import { renderThumbnail, thumbnailDataUrl } from './thumbnail';

const sample = parseDsl(
  'cloud: aws\nnodes:\n  fn: lambda\n  db: dynamodb\nedges:\n  - fn -> db: R/W\n',
).model!;

describe('renderThumbnail', () => {
  it('produces a self-contained SVG', () => {
    const svg = renderThumbnail(sample);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox=');
  });

  it('draws a block per shape and a line per connector', () => {
    const svg = renderThumbnail(sample);
    // Two groups, two items, one background, plus one connector path.
    expect((svg.match(/<rect/g) ?? []).length).toBe(5);
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  it('skips containers, which are structural and never visible here', () => {
    const svg = renderThumbnail(sample);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('colours items by their provider', () => {
    expect(renderThumbnail(sample)).toContain('#ff9900');
  });

  it('follows the theme', () => {
    expect(renderThumbnail(sample, false)).toContain('#ffffff');
    expect(renderThumbnail(sample, true)).toContain('#0e1526');
  });

  it('handles an empty diagram', () => {
    const svg = renderThumbnail(createEmptyModel());
    expect(svg).toContain('viewBox="0 0 100 64"');
  });

  it('stays small enough to store next to every diagram', () => {
    // The real renderer inlines a 107KB icon sprite; that is why this exists.
    for (const template of TEMPLATES) {
      const svg = renderThumbnail(template.build('en'));
      expect(svg.length, template.id).toBeLessThan(4000);
    }
  });

  it('encodes to a usable data URL', () => {
    const url = thumbnailDataUrl(renderThumbnail(sample));
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('#');
  });
});
