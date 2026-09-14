import { describe, expect, it } from 'vitest';
import { addConnector, createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { modelWith } from '@/lib/engine/testUtils';
import { canvasTheme } from '@/lib/design/tokens';
import { waypointsToPath } from '@/lib/editor/connectorPath';
import { renderPreview } from './preview';

describe('renderPreview', () => {
  const microservices = TEMPLATES.find((t) => t.id === 'microservices')!.build('es');

  it('draws every service by name, with what it says about itself', () => {
    const svg = renderPreview(microservices);
    expect(svg).toContain('>API Service<');
    expect(svg).toContain('>PROD<');
    expect(svg).toContain('>PII<');
    expect(svg).toContain('stroke-dasharray="8 6"');
  });

  it('stays small enough to inline on the home page', () => {
    expect(renderPreview(microservices).length).toBeLessThan(24_000);
    expect(renderPreview(microservices, true).length).toBeLessThan(24_000);
  });

  it('escapes what a title could smuggle in', () => {
    const model = TEMPLATES[0].build('es');
    model.shapes.find((s) => s.type === 'item')!.title = '<img src=x onerror=alert(1)>';
    const svg = renderPreview(model);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });

  it('renders an empty sheet for an empty model', () => {
    expect(renderPreview(createEmptyModel())).toContain('<rect width="160" height="90"');
  });

  function drawn() {
    const model = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 10100, y: 200, w: 100, h: 100 },
    ]);
    const line = addConnector(model, 'a', 'b');
    line.label = 'Call';
    line.manual = true;
    line.waypoints = [
      { x: 100, y: 50 },
      { x: 10100, y: 50 },
      { x: 10100, y: 250 },
    ];
    return { model, line };
  }

  it.each([
    ['rounded', 'thin', 1.3],
    ['orthogonal', 'bold', 2.9],
    [undefined, 'regular', 1.8],
  ] as const)(
    'renders curve %s and weight %s with the shared path and stroke rules',
    (curve, weight, width) => {
      const { model, line } = drawn();
      Object.assign(line, { curve, weight, style: 'dashed' });
      const svg = renderPreview(model);
      const path = svg.match(/<path[^>]*>/g)![0];
      expect(path).toContain(
        `d="${waypointsToPath(line.waypoints, curve === 'orthogonal' ? 0 : undefined)}"`,
      );
      expect(path).toContain(`stroke-width="${width}"`);
      expect(path).toContain('stroke-dasharray="7 5"');
      expect(path.includes('Q')).toBe(curve !== 'orthogonal');
    },
  );

  it.each(['#abc', '#A1B2C3'])('uses custom color %s for both line and arrowhead', (color) => {
    const { model, line } = drawn();
    line.color = color;
    const paths = renderPreview(model).match(/<path[^>]*>/g)!;
    expect(paths[0]).toContain(`stroke="${color}"`);
    expect(paths[1]).toContain(`fill="${color}"`);
  });

  it.each([false, true])(
    'falls back to the theme for absent or invalid colors (dark: %s)',
    (dark) => {
      const { model, line } = drawn();
      for (const color of [undefined, 'invalid', 'url(https://example.com/image.svg)']) {
        line.color = color;
        const svg = renderPreview(model, dark);
        const paths = svg.match(/<path[^>]*>/g)!;
        expect(paths[0]).toContain(`stroke="${canvasTheme(dark).connector}"`);
        expect(paths[1]).toContain(`fill="${canvasTheme(dark).connector}"`);
        if (color) expect(svg).not.toContain(color);
      }
    },
  );

  it.each([
    [0, 100, 54],
    [0.2549, 2700, 54],
    [1, 10100, 254],
    [undefined, 5100, 54],
  ] as const)('places the label at %s without rounding its fraction', (labelAt, x, y) => {
    const { model, line } = drawn();
    line.labelAt = labelAt;
    const svg = renderPreview(model);
    expect(svg).toMatch(new RegExp(`<text x="${x}" y="${y}"[^>]*>Call</text>`));
    expect(line.labelAt).toBe(labelAt);
  });
});
