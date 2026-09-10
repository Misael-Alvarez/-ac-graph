import { describe, expect, it } from 'vitest';
import { addBoundary, addConnector, addGroup, children, createEmptyModel } from '@/lib/engine';
import { lightCanvas, readableTextOn } from '@/lib/design/tokens';
import { diagramToSvgString } from './renderSvg';

function sampleModel() {
  const m = createEmptyModel();
  const a = addGroup(m, 0, 0);
  a.title = 'Frontend';
  const b = addGroup(m, 800, 0);
  b.title = 'Backend';
  const items = m.shapes.filter((s) => s.type === 'item');
  items[0].title = 'CloudFront';
  items[0].icon = { kind: 'symbol', key: 'aws-cloudfront' };
  items[1].title = 'Lambda';
  items[1].icon = { kind: 'symbol', key: 'aws-lambda' };
  const c = addConnector(m, items[0].id, items[1].id);
  c.label = 'HTTPS';
  return m;
}

describe('diagramToSvgString', () => {
  it('produces a standalone SVG document', async () => {
    const svg = await diagramToSvgString({ model: sampleModel() });
    expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox=');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('carries no editor chrome', async () => {
    // The old exporter cloned the live DOM, so these came along and rendered as
    // solid black rectangles on top of the diagram.
    const svg = await diagramToSvgString({ model: sampleModel() });
    for (const chrome of [
      'sel-outline',
      'collide-outline',
      'resize-handle',
      'conn-src-highlight',
      'canvas-bg',
    ]) {
      expect(svg, chrome).not.toContain(chrome);
    }
  });

  it('gives every painted rectangle an explicit fill', async () => {
    // A rect with no fill attribute defaults to black in a standalone file, which
    // is exactly how the old export covered the diagram in black boxes.
    // Rects inside a <clipPath> describe geometry and are never painted.
    const svg = await diagramToSvgString({ model: sampleModel() });
    const painted = svg.replace(/<clipPath[\s\S]*?<\/clipPath>/g, '');
    const rects = painted.match(/<rect[^>]*>/g) ?? [];
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect, rect).toMatch(/fill="/);
    }
  });

  it('defines exactly one arrowhead marker', async () => {
    const svg = await diagramToSvgString({ model: sampleModel() });
    const ids = svg.match(/<marker[^>]*id="([^"]+)"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg.match(/id="arrow"/g)).toBeNull();
  });

  it('includes the icon sprite so services are visible offline', async () => {
    const svg = await diagramToSvgString({ model: sampleModel() });
    expect(svg).toContain('id="i-aws-lambda"');
    expect(svg).toContain('href="#i-aws-lambda"');
  });

  it('renders titles and connector labels', async () => {
    const svg = await diagramToSvgString({ model: sampleModel() });
    expect(svg).toContain('CloudFront');
    expect(svg).toContain('Lambda');
    expect(svg).toContain('HTTPS');
  });

  it('embeds the brand logo as a data URL rather than an app path', async () => {
    // `/aion_logo.png` resolves to nothing once the file leaves the app.
    const svg = await diagramToSvgString({ model: sampleModel(), brand: 'aion' });
    expect(svg).not.toContain('/aion_logo.png');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).toContain('AION Cloud');
    expect(svg).not.toContain('Banorte');
  });

  it('omits the footer when no brand is selected', async () => {
    const svg = await diagramToSvgString({ model: sampleModel(), brand: 'none' });
    expect(svg).not.toContain('AION Cloud');
  });

  it('references no external resources at all', async () => {
    const svg = await diagramToSvgString({ model: sampleModel(), brand: 'aion' });
    const externals = svg.match(/(?:href|src)="(?!#|data:)[^"]*"/g) ?? [];
    // Only the two xmlns declarations may point outward, and those are namespaces.
    expect(externals).toEqual([]);
  });

  it('switches the whole document to the dark palette', async () => {
    const light = await diagramToSvgString({ model: sampleModel(), dark: false });
    const dark = await diagramToSvgString({ model: sampleModel(), dark: true });
    expect(light).toContain('#ffffff');
    expect(dark).toContain('#0e1526');
    expect(dark).not.toBe(light);
  });

  it('scales pixel dimensions without changing the viewBox', async () => {
    const model = sampleModel();
    const at1 = await diagramToSvgString({ model, scale: 1 });
    const at2 = await diagramToSvgString({ model, scale: 2 });
    const viewBox = (s: string) => s.match(/viewBox="([^"]+)"/)![1];
    const width = (s: string) => Number(s.match(/width="(\d+)"/)![1]);

    expect(viewBox(at1)).toBe(viewBox(at2));
    expect(width(at2)).toBe(width(at1) * 2);
  });

  it('handles an empty diagram without producing a degenerate viewBox', async () => {
    const svg = await diagramToSvgString({ model: createEmptyModel() });
    const [, , w, h] = svg
      .match(/viewBox="([^"]+)"/)![1]
      .split(' ')
      .map(Number);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('paints a shape with the colour the reader chose for it', async () => {
    // The inspector has always offered a fill for items and boundaries; until
    // now neither shape read it, so the picker did nothing at all.
    const model = sampleModel();
    const item = model.shapes.find((s) => s.type === 'item')!;
    const boundary = addBoundary(model, 0, 0, 'outer');
    item.fill = '#123456';
    boundary.fill = '#654321';
    const svg = await diagramToSvgString({ model });
    expect(svg).toContain('#123456');
    expect(svg).toContain('#654321');
  });

  it('falls back to the theme for a fill it cannot paint', async () => {
    // A fill is free text: it arrives from a template, from generated code, or
    // from a field someone typed "rojo" into. An unrecognised fill in a
    // standalone SVG is painted black.
    const model = sampleModel();
    const item = model.shapes.find((s) => s.type === 'item')!;
    item.fill = 'rojo';
    const svg = await diagramToSvgString({ model });
    expect(svg).not.toContain('rojo');
    const rect = svg.match(new RegExp(`<rect[^>]*data-shape-id="${item.id}"[^>]*>`))![0];
    expect(rect).toContain(`fill="${lightCanvas.itemFill}"`);
  });

  it('keeps the title legible on a dark custom fill', async () => {
    const model = sampleModel();
    const item = model.shapes.find((s) => s.type === 'item')!;
    item.fill = '#101820';
    const svg = await diagramToSvgString({ model });
    // The card the reader darkened gets light text; the untouched card beside
    // it keeps the theme's own.
    const legible = readableTextOn('#101820', lightCanvas);
    expect(legible).not.toBe(lightCanvas.titleText);
    // The card's own markup, up to the next shape: the title text sits after
    // the icon well, which closes a group of its own before the text begins.
    const start = svg.indexOf(`clip-text-${item.id}`);
    const next = svg.indexOf('data-shape-id="', svg.indexOf('data-shape-id="', start) + 1);
    const card = svg.slice(start, next === -1 ? undefined : next);
    expect(card).toContain(`fill="${legible}"`);
    expect(svg).toContain(`fill="${lightCanvas.titleText}"`);
  });

  it('clips item text instead of guessing a character count', async () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const item = children(m, children(m, g.id)[0].id)[0];
    item.title = 'An extremely long service name that will not fit inside the card';
    const svg = await diagramToSvgString({ model: m });
    // The full string is present; overflow is handled geometrically by a clip.
    expect(svg).toContain('An extremely long service name that will not fit inside the card');
    expect(svg).toContain('clipPath');
  });
});
