import { describe, expect, it } from 'vitest';
import { autoLayout, computeAlignGuides, computeResizeGuides } from './layout';
import { addBoundary, addGroup, children, createEmptyModel, getShape } from './model';
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

  it('leaves a locked group and a locked boundary exactly where they are', () => {
    const m = createEmptyModel();
    const pinned = groupWithItem(m, 1500, 1200, 'Pinned');
    pinned.group.locked = true;
    const free = groupWithItem(m, 1400, 900, 'Free');
    const boundary = addBoundary(m, -500, -500, 'outer');
    boundary.locked = true;
    const itemBefore = { x: pinned.item.x, y: pinned.item.y };

    autoLayout(m);

    expect(pinned.group).toMatchObject({ x: 1500, y: 1200 });
    expect(pinned.item).toMatchObject(itemBefore);
    expect(boundary).toMatchObject({ x: -500, y: -500, w: 1000, h: 650 });
    expect(free.group).toMatchObject({ x: 80, y: 80 });
  });
});

describe('computeResizeGuides', () => {
  const neighbour = { id: 'other', x: 400, y: 500, w: 200, h: 100 };

  it('snaps the right edge to a neighbour’s left, centre and right lines', () => {
    const m = modelWith([{ id: 'me', x: 100, y: 100, w: 50, h: 50 }, neighbour]);
    // Right edge at 397 → the neighbour's left edge at 400.
    expect(computeResizeGuides(m, 'me', 100, 100, 297, 50)).toMatchObject({
      snapW: 300,
      snapH: null,
      guides: [{ axis: 'x', pos: 400 }],
    });
    // 503 → the centre at 500; 597 → the right edge at 600.
    expect(computeResizeGuides(m, 'me', 100, 100, 403, 50).snapW).toBe(400);
    expect(computeResizeGuides(m, 'me', 100, 100, 497, 50).snapW).toBe(500);
  });

  it('snaps the bottom edge to a neighbour’s top, centre and bottom lines', () => {
    const m = modelWith([{ id: 'me', x: 100, y: 100, w: 50, h: 50 }, neighbour]);
    expect(computeResizeGuides(m, 'me', 100, 100, 50, 397)).toMatchObject({
      snapW: null,
      snapH: 400,
      guides: [{ axis: 'y', pos: 500 }],
    });
    expect(computeResizeGuides(m, 'me', 100, 100, 50, 453).snapH).toBe(450);
    expect(computeResizeGuides(m, 'me', 100, 100, 50, 503).snapH).toBe(500);
  });

  it('stays null out of range and never aligns a shape with what it holds', () => {
    const m = modelWith([
      { id: 'me', type: 'group', x: 100, y: 100, w: 200, h: 100 },
      { id: 'ct', type: 'container', parentId: 'me', x: 110, y: 110, w: 180, h: 80 },
      { id: 'item', parentId: 'ct', x: 150, y: 125, w: 100, h: 50 },
      neighbour,
    ]);
    // The right edge at 252 is two pixels off the item's right edge (250):
    // the item travels with the group, so it must not attract it.
    const r = computeResizeGuides(m, 'me', 100, 100, 152, 100);
    expect(r.snapW).toBeNull();
    expect(r.snapH).toBeNull();
    expect(r.guides).toHaveLength(0);
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
