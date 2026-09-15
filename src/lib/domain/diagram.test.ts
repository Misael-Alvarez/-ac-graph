import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  ConnectorSchema,
  isDecorative,
  parseDiagramModel,
  safeParseDiagramModel,
} from './diagram';

const FIXTURES = ['public/aion-agents-arch.json', 'public/aion-agents-aws.json'];

describe('parseDiagramModel', () => {
  it('accepts the diagrams shipped with the app', () => {
    for (const path of FIXTURES) {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const model = parseDiagramModel(raw);
      expect(model.shapes.length).toBeGreaterThan(0);
      expect(model.canvas.w).toBeGreaterThan(0);
    }
  });

  it('stamps a schema version on pre-versioned files', () => {
    const raw = JSON.parse(readFileSync(FIXTURES[0], 'utf8'));
    expect(raw.schemaVersion).toBeUndefined();
    expect(parseDiagramModel(raw).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('re-stamps every earlier version with the current one', () => {
    // The changes so far are additive, so a document from any earlier build is
    // a valid document of this one — and says so once read.
    for (const version of [1, 2, 3, 4]) {
      const model = parseDiagramModel({
        schemaVersion: version,
        canvas: { w: 100, h: 100 },
        shapes: [],
        connectors: [],
      });
      expect(model.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('refuses a document written by a newer build', () => {
    const r = safeParseDiagramModel({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      canvas: { w: 100, h: 100 },
      shapes: [],
      connectors: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/newer version/);
  });

  it('reads the decorative shapes, and knows them from the cloud family', () => {
    const model = parseDiagramModel({
      canvas: { w: 100, h: 100 },
      shapes: [
        { id: 'r', type: 'region', parentId: null, x: 0, y: 0, w: 1, h: 1, title: 'DMZ' },
        { id: 'n', type: 'note', parentId: null, x: 0, y: 0, w: 1, h: 1, title: '**Todo**' },
        { id: 't', type: 'text', parentId: null, x: 0, y: 0, w: 1, h: 1, title: '# Phase 2' },
        { id: 'g', type: 'group', parentId: null, x: 0, y: 0, w: 1, h: 1 },
      ],
      connectors: [],
    });
    expect(model.shapes.map(isDecorative)).toEqual([true, true, true, false]);
  });

  it('fills in connector defaults', () => {
    const model = parseDiagramModel({
      canvas: { w: 100, h: 100 },
      shapes: [],
      connectors: [{ id: 'c', sourceId: 'a', targetId: 'b' }],
    });
    expect(model.connectors[0]).toMatchObject({ label: '', style: 'solid', waypoints: [] });
    expect(model.showFooter).toBe(false);
  });

  it('retains optional connector geometry and rejects unknown curve modes', () => {
    const line = {
      id: 'c',
      sourceId: 'a',
      targetId: 'b',
      manual: true,
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      sourcePort: 'E',
      targetPort: 'N',
      labelAt: 0.2549,
      color: '#123456',
      weight: 'bold',
    };
    for (const curve of ['rounded', 'orthogonal']) {
      expect(ConnectorSchema.parse({ ...line, curve })).toMatchObject({ ...line, curve });
    }
    expect(ConnectorSchema.parse(line).curve).toBeUndefined();
    expect(ConnectorSchema.safeParse({ ...line, curve: 'bezier' }).success).toBe(false);
  });

  it('reads a locked shape, at schema 6, and re-stamps a 5 that never heard of it', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(6);
    const shape = { id: 'b', type: 'boundary', parentId: null, x: 0, y: 0, w: 10, h: 10 };
    const locked = parseDiagramModel({
      schemaVersion: 6,
      canvas: { w: 100, h: 100 },
      shapes: [{ ...shape, locked: true }],
      connectors: [],
    });
    expect(locked.schemaVersion).toBe(6);
    expect(locked.shapes[0].locked).toBe(true);

    // A document from the build before: no `locked` anywhere, read unchanged.
    const older = parseDiagramModel({
      schemaVersion: 5,
      canvas: { w: 100, h: 100 },
      shapes: [shape],
      connectors: [],
    });
    expect(older.schemaVersion).toBe(6);
    expect(older.shapes[0].locked).toBeUndefined();
    expect(
      safeParseDiagramModel({ ...locked, shapes: [{ ...shape, locked: 'yes' }] }).success,
    ).toBe(false);
  });

  it('rejects a shape with a bad type', () => {
    const r = safeParseDiagramModel({
      canvas: { w: 1, h: 1 },
      shapes: [{ id: 'a', type: 'nonsense', parentId: null, x: 0, y: 0, w: 1, h: 1 }],
      connectors: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing canvas', () => {
    expect(safeParseDiagramModel({ shapes: [], connectors: [] }).success).toBe(false);
  });

  it('rejects non-numeric coordinates', () => {
    const r = safeParseDiagramModel({
      canvas: { w: 1, h: 1 },
      shapes: [{ id: 'a', type: 'item', parentId: null, x: '0', y: 0, w: 1, h: 1 }],
      connectors: [],
    });
    expect(r.success).toBe(false);
  });

  it('drops the fills the old engine baked into every shape', () => {
    // Those colours were the light theme's, written into the model at creation,
    // so a stored diagram opened in dark mode came back as white cards.
    const model = parseDiagramModel({
      canvas: { w: 100, h: 100 },
      shapes: [
        { id: 'g', type: 'group', parentId: null, x: 0, y: 0, w: 1, h: 1, fill: '#FAFBFC' },
        { id: 'i', type: 'item', parentId: null, x: 0, y: 0, w: 1, h: 1, fill: '#F1F3F4' },
      ],
      connectors: [],
    });
    expect(model.shapes.map((s) => s.fill)).toEqual([undefined, undefined]);
  });

  it('keeps a fill somebody chose, including the same grey in lower case', () => {
    const model = parseDiagramModel({
      canvas: { w: 100, h: 100 },
      shapes: [
        { id: 'a', type: 'item', parentId: null, x: 0, y: 0, w: 1, h: 1, fill: '#f1f3f4' },
        { id: 'b', type: 'group', parentId: null, x: 0, y: 0, w: 1, h: 1, fill: '#123456' },
        // The old default for an item, on a shape that is not an item.
        { id: 'c', type: 'group', parentId: null, x: 0, y: 0, w: 1, h: 1, fill: '#F1F3F4' },
      ],
      connectors: [],
    });
    expect(model.shapes.map((s) => s.fill)).toEqual(['#f1f3f4', '#123456', '#F1F3F4']);
  });

  it('throws rather than returning junk', () => {
    expect(() => parseDiagramModel(null)).toThrow();
    expect(() => parseDiagramModel('{}')).toThrow();
  });
});
