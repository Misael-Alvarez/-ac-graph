import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/editor/templates';
import { createEmptyModel, routeAllConnectors, setRoute } from '@/lib/engine';
import { parseDsl } from '@/lib/dsl';
import {
  MAX_PAYLOAD_LENGTH,
  PayloadTooLargeError,
  decodeDiagram,
  encodeDiagram,
  safeDecodeDiagram,
} from './codec';

const sample = parseDsl(
  'cloud: aws\nnodes:\n  api: apigateway\n  fn: lambda\n  db: dynamodb\nedges:\n  - api -> fn: invoke\n  - fn -> db: R/W\n',
).model!;

describe('encodeDiagram / decodeDiagram', () => {
  it('round-trips a diagram', async () => {
    const restored = await decodeDiagram(await encodeDiagram(sample));
    expect(restored.shapes).toHaveLength(sample.shapes.length);
    expect(restored.connectors).toHaveLength(sample.connectors.length);
    expect(restored.shapes.map((s) => s.title)).toEqual(sample.shapes.map((s) => s.title));
  });

  it('preserves positions, icons and connector labels', async () => {
    const restored = await decodeDiagram(await encodeDiagram(sample));
    expect(restored.shapes.map((s) => [s.x, s.y])).toEqual(sample.shapes.map((s) => [s.x, s.y]));
    expect(restored.shapes.map((s) => s.icon?.key)).toEqual(sample.shapes.map((s) => s.icon?.key));
    expect(restored.connectors.map((c) => c.label)).toEqual(sample.connectors.map((c) => c.label));
  });

  it('produces a payload safe to put in a URL', async () => {
    const payload = await encodeDiagram(sample);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(payload)).toBe(payload);
  });

  it('drops the router\u2019s waypoints, which come back on load, and keeps the author\u2019s', async () => {
    const payload = await encodeDiagram(sample);
    const restored = await decodeDiagram(payload);
    expect(restored.connectors.every((c) => c.waypoints.length === 0)).toBe(true);

    // And they come back the moment the diagram is routed.
    routeAllConnectors(restored);
    expect(restored.connectors.every((c) => c.waypoints.length >= 2)).toBe(true);

    // A route somebody drew travels, rounded to whole pixels.
    const drawn = structuredClone(sample);
    drawn.connectors[0].manual = true;
    drawn.connectors[0].waypoints = [
      { x: 10.4, y: 20.6 },
      { x: 300.2, y: 20.6 },
      { x: 300.2, y: 400 },
    ];
    const back = await decodeDiagram(await encodeDiagram(drawn));
    expect(back.connectors[0].manual).toBe(true);
    expect(back.connectors[0].waypoints).toEqual([
      { x: 10, y: 21 },
      { x: 300, y: 21 },
      { x: 300, y: 400 },
    ]);
  });

  it('compresses well enough for every built-in template to fit', async () => {
    for (const template of TEMPLATES) {
      const payload = await encodeDiagram(template.build('en'));
      expect(payload.length, template.id).toBeLessThan(MAX_PAYLOAD_LENGTH);
    }
  });

  it.each(['rounded', 'orthogonal'] as const)(
    'preserves a manual line and curve %s through viewer rerouting',
    async (curve) => {
      const model = structuredClone(sample);
      const line = model.connectors[0];
      setRoute(model, line, [line.waypoints[0], line.waypoints.at(-1)!]);
      Object.assign(line, { curve, color: '#123456', weight: 'bold', labelAt: 0.2549 });
      const back = await decodeDiagram(await encodeDiagram(model));
      for (let i = 0; i < 3; i++) {
        routeAllConnectors(back);
        expect(back.connectors[0]).toEqual(line);
      }
    },
  );

  it('is a fraction of the raw JSON, and compresses better the larger it gets', async () => {
    const ratio = async (m: Parameters<typeof encodeDiagram>[0]) =>
      (await encodeDiagram(m)).length / JSON.stringify(m).length;

    const small = await ratio(sample);
    const large = await ratio(TEMPLATES[1].build('en'));
    expect(small).toBeLessThan(0.5);
    expect(large).toBeLessThan(small);
  });

  it('handles an empty diagram', async () => {
    const restored = await decodeDiagram(await encodeDiagram(createEmptyModel()));
    expect(restored.shapes).toEqual([]);
  });

  it('refuses a diagram that will not fit in a link', async () => {
    const huge = createEmptyModel();
    for (let i = 0; i < 4000; i++) {
      huge.shapes.push({
        id: `shape-with-a-deliberately-long-identifier-${i}`,
        type: 'item',
        parentId: null,
        x: i * 7,
        y: i * 11,
        w: 320,
        h: 92,
        title: `Service number ${i} with a long descriptive name`,
        subtitle: `A subtitle that also takes up room, number ${i}`,
      });
    }
    await expect(encodeDiagram(huge)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

describe('safeDecodeDiagram', () => {
  it('returns null for junk rather than throwing', async () => {
    expect(await safeDecodeDiagram('not-a-real-payload')).toBeNull();
    expect(await safeDecodeDiagram('')).toBeNull();
  });

  it('returns null when the payload decompresses to something that is not a diagram', async () => {
    const bytes = new TextEncoder().encode('{"nope":true}');
    const deflated = new Uint8Array(
      await new Response(
        new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    let binary = '';
    for (const byte of deflated) binary += String.fromCharCode(byte);
    const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(await safeDecodeDiagram(payload)).toBeNull();
  });

  it('accepts a payload produced by the encoder', async () => {
    expect(await safeDecodeDiagram(await encodeDiagram(sample))).not.toBeNull();
  });
});
