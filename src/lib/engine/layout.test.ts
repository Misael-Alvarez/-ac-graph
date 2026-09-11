import { describe, expect, it } from 'vitest';
import { autoLayout, computeAlignGuides } from './layout';
import { addGroup, children, createEmptyModel, getShape } from './model';
import { addConnector } from './routing';
import { modelWith } from './testUtils';

/** Builds a group whose single item is returned alongside it. */
function groupWithItem(
  m: ReturnType<typeof createEmptyModel>,
  x: number,
  y: number,
  title: string,
) {
  const g = addGroup(m, x, y);
  g.title = title;
  const ct = children(m, g.id).find((s) => s.type === 'container')!;
  const item = children(m, ct.id).find((s) => s.type === 'item')!;
  return { group: g, item };
}

describe('autoLayout', () => {
  it('orders groups into layers following the connectors', () => {
    const m = createEmptyModel();
    const a = groupWithItem(m, 700, 700, 'A');
    const b = groupWithItem(m, 0, 0, 'B');
    const c = groupWithItem(m, 300, 900, 'C');
    addConnector(m, a.item.id, b.item.id);
    addConnector(m, b.item.id, c.item.id);

    autoLayout(m);

    expect(a.group.y).toBeLessThan(b.group.y);
    expect(b.group.y).toBeLessThan(c.group.y);
  });

  it('places unconnected groups side by side in the first layer', () => {
    const m = createEmptyModel();
    const a = groupWithItem(m, 0, 0, 'A');
    const b = groupWithItem(m, 0, 0, 'B');

    autoLayout(m);

    expect(a.group.y).toBe(b.group.y);
    expect(a.group.x).not.toBe(b.group.x);
  });

  it('drags descendants along with their group', () => {
    const m = createEmptyModel();
    const { group, item } = groupWithItem(m, 1500, 1200, 'A');
    const offsetX = item.x - group.x;
    const offsetY = item.y - group.y;

    autoLayout(m);

    expect(item.x - group.x).toBeCloseTo(offsetX);
    expect(item.y - group.y).toBeCloseTo(offsetY);
  });

  it('still places groups caught in a connector cycle', () => {
    const m = createEmptyModel();
    const a = groupWithItem(m, 0, 0, 'A');
    const b = groupWithItem(m, 0, 0, 'B');
    addConnector(m, a.item.id, b.item.id);
    addConnector(m, b.item.id, a.item.id);

    autoLayout(m);

    // Neither reaches in-degree zero, so both land in the trailing row.
    expect(a.group.y).toBe(b.group.y);
    expect(Number.isFinite(a.group.x)).toBe(true);
  });

  it('wraps boundaries around the laid-out content', () => {
    const m = createEmptyModel();
    const { group } = groupWithItem(m, 0, 0, 'A');
    const bd =
      m.shapes[
        m.shapes.push({
          id: 'bd',
          type: 'boundary',
          parentId: null,
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          variant: 'outer',
        }) - 1
      ];

    autoLayout(m);

    expect(bd.x).toBeLessThan(group.x);
    expect(bd.y).toBeLessThan(group.y);
    expect(bd.w).toBeGreaterThan(group.w);
  });

  it('fits boundaries around the architecture, not around the notes', () => {
    const m = createEmptyModel();
    const { group } = groupWithItem(m, 0, 0, 'A');
    m.shapes.push({
      id: 'bd',
      type: 'boundary',
      parentId: null,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      variant: 'outer',
    });
    m.shapes.push({ id: 'nt', type: 'note', parentId: null, x: 4000, y: 4000, w: 220, h: 160 });

    autoLayout(m);

    const bd = m.shapes.find((s) => s.id === 'bd')!;
    const note = m.shapes.find((s) => s.id === 'nt')!;
    expect(bd.x + bd.w).toBeLessThan(note.x);
    expect(bd.x + bd.w).toBeGreaterThan(group.x + group.w);
    // And the note stayed where it was put: layout is for the cloud family.
    expect([note.x, note.y]).toEqual([4000, 4000]);
  });

  it('reroutes connectors after moving everything', () => {
    const m = createEmptyModel();
    const a = groupWithItem(m, 0, 0, 'A');
    const b = groupWithItem(m, 0, 0, 'B');
    const conn = addConnector(m, a.item.id, b.item.id);

    autoLayout(m);

    const src = getShape(m, conn.sourceId)!;
    // The first waypoint must still sit on the source's outline.
    const onEdge =
      Math.abs(conn.waypoints[0].x - (src.x + src.w)) < 1e-6 ||
      Math.abs(conn.waypoints[0].x - src.x) < 1e-6 ||
      Math.abs(conn.waypoints[0].y - (src.y + src.h)) < 1e-6 ||
      Math.abs(conn.waypoints[0].y - src.y) < 1e-6;
    expect(onEdge).toBe(true);
  });

  it('does nothing harmful on an empty diagram', () => {
    const m = createEmptyModel();
    expect(() => autoLayout(m)).not.toThrow();
  });
});

describe('computeAlignGuides', () => {
  it('snaps a left edge to a neighbour and reports the guide', () => {
    const m = modelWith([{ id: 'other', x: 100, y: 500, w: 200, h: 100 }]);
    const r = computeAlignGuides(m, 'drag', 103, 900, 50, 50);
    expect(r.snapX).toBe(100);
    expect(r.guides).toContainEqual({ axis: 'x', pos: 100 });
  });

  it('snaps right edges together', () => {
    const m = modelWith([{ id: 'other', x: 100, y: 500, w: 200, h: 100 }]);
    const r = computeAlignGuides(m, 'drag', 248, 900, 50, 50);
    expect(r.snapX).toBe(250);
  });

  it('snaps horizontal centres', () => {
    const m = modelWith([{ id: 'other', x: 100, y: 500, w: 200, h: 100 }]);
    const r = computeAlignGuides(m, 'drag', 173, 900, 50, 50);
    expect(r.snapX).toBe(175);
  });

  it('snaps top and bottom edges', () => {
    const m = modelWith([{ id: 'other', x: 100, y: 500, w: 200, h: 100 }]);
    expect(computeAlignGuides(m, 'drag', 900, 502, 50, 50).snapY).toBe(500);
    expect(computeAlignGuides(m, 'drag', 900, 553, 50, 50).snapY).toBe(550);
  });

  it('stays null when nothing is within range', () => {
    const m = modelWith([{ id: 'other', x: 100, y: 500, w: 200, h: 100 }]);
    const r = computeAlignGuides(m, 'drag', 900, 900, 50, 50);
    expect(r.snapX).toBeNull();
    expect(r.snapY).toBeNull();
    expect(r.guides).toHaveLength(0);
  });

  it('ignores the dragged shape, its children and containers', () => {
    const m = modelWith([
      { id: 'drag', x: 100, y: 100, w: 50, h: 50 },
      { id: 'child', parentId: 'drag', x: 100, y: 100, w: 50, h: 50 },
      { id: 'ct', type: 'container', x: 100, y: 100, w: 50, h: 50 },
    ]);
    const r = computeAlignGuides(m, 'drag', 100, 100, 50, 50);
    expect(r.snapX).toBeNull();
    expect(r.snapY).toBeNull();
  });

  it('ignores a grandchild, which travels with the shape just as a child does', () => {
    // A group's items hang off its container, so they are grandchildren. The
    // item is centred in the group, so the group snapped to its own contents
    // and could not be moved by less than the snap distance.
    const m = modelWith([
      { id: 'drag', type: 'group', x: 100, y: 100, w: 200, h: 100 },
      { id: 'ct', type: 'container', parentId: 'drag', x: 110, y: 110, w: 180, h: 80 },
      { id: 'item', parentId: 'ct', x: 150, y: 125, w: 100, h: 50 },
    ]);
    const r = computeAlignGuides(m, 'drag', 102, 102, 200, 100);
    expect(r.snapX).toBeNull();
    expect(r.snapY).toBeNull();
    expect(r.guides).toHaveLength(0);
  });

  it('still snaps to a shape that is not travelling with it', () => {
    const m = modelWith([
      { id: 'drag', type: 'group', x: 100, y: 100, w: 200, h: 100 },
      { id: 'ct', type: 'container', parentId: 'drag', x: 110, y: 110, w: 180, h: 80 },
      { id: 'item', parentId: 'ct', x: 150, y: 125, w: 100, h: 50 },
      { id: 'elsewhere', type: 'group', x: 600, y: 98, w: 200, h: 100 },
    ]);
    expect(computeAlignGuides(m, 'drag', 100, 100, 200, 100).snapY).toBe(98);
  });
});
