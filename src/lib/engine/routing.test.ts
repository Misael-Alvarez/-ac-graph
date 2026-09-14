import { describe, expect, it } from 'vitest';
import {
  addConnector,
  bendsOf,
  deleteConnector,
  connectorsTouching,
  insertBend,
  moveSegment,
  nearestOnPolyline,
  portTowards,
  reanchorRoute,
  resetRoute,
  routeAllConnectors,
  routeConnector,
  routeConnectorsFor,
  routeThrough,
  setRoute,
} from './routing';
import { addGroup, addItemToContainer, children, createEmptyModel } from './model';
import { modelWith } from './testUtils';
import { ports } from './geometry';
import type { Point, Port } from '@/lib/domain';

const isOrthogonal = (pts: { x: number; y: number }[]) =>
  pts.every(
    (p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1e-6 || Math.abs(p.y - pts[i - 1].y) < 1e-6,
  );

describe('routeConnector', () => {
  it('produces an orthogonal path anchored on both shapes', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 0, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(c.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(c.waypoints)).toBe(true);
    // Side-by-side shapes leave the east face and arrive on the west face.
    expect(c.waypoints[0]).toEqual({ x: 100, y: 50 });
    expect(c.waypoints.at(-1)).toEqual({ x: 400, y: 50 });
  });

  it('picks vertical ports for stacked shapes', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 0, y: 400, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(c.waypoints[0]).toEqual({ x: 50, y: 100 });
    expect(c.waypoints.at(-1)).toEqual({ x: 50, y: 400 });
  });

  it('reverses ports when the target is to the west', () => {
    const m = modelWith([
      { id: 'a', x: 400, y: 0, w: 100, h: 100 },
      { id: 'b', x: 0, y: 0, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(c.waypoints[0]).toEqual({ x: 400, y: 50 });
    expect(c.waypoints.at(-1)).toEqual({ x: 100, y: 50 });
  });

  it('routes adjacent stacked items as a straight drop', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    addItemToContainer(m, ct.id);
    const items = children(m, ct.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const c = addConnector(m, items[0].id, items[1].id);
    expect(c.waypoints).toHaveLength(2);
    expect(c.waypoints[0].x).toBe(c.waypoints[1].x);
    expect(c.waypoints[0].y).toBeLessThan(c.waypoints[1].y);
  });

  it('orders the straight drop by geometry, not by connector direction', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    addItemToContainer(m, ct.id);
    const items = children(m, ct.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const c = addConnector(m, items[1].id, items[0].id);
    // Drawn bottom-to-top, so the first waypoint is the lower item's top edge.
    expect(c.waypoints[0].y).toBeGreaterThan(c.waypoints[1].y);
  });

  it('picks the elbow that clears an obstacle', () => {
    const m = modelWith([
      { id: 'a', type: 'item', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', type: 'item', x: 600, y: 300, w: 100, h: 100 },
      // Blocks the preferred "across then down" elbow but not "down then across".
      { id: 'wall', type: 'item', x: 200, y: 20, w: 300, h: 60 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(isOrthogonal(c.waypoints)).toBe(true);
    expect(c.waypoints).toEqual([
      { x: 100, y: 50 },
      { x: 100, y: 350 },
      { x: 600, y: 350 },
    ]);
  });

  it('falls back to a dogleg when every candidate is blocked', () => {
    // Known limitation: the router only tries four fixed elbow shapes. When a wall
    // spans all of them it emits the mid-X dogleg, which still crosses the wall.
    // Documented here so the routing rework has a baseline to improve on.
    const m = modelWith([
      { id: 'a', type: 'item', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', type: 'item', x: 600, y: 300, w: 100, h: 100 },
      { id: 'wall', type: 'item', x: 300, y: -200, w: 60, h: 700 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(isOrthogonal(c.waypoints)).toBe(true);
    expect(c.waypoints).toEqual([
      { x: 100, y: 50 },
      { x: 350, y: 50 },
      { x: 350, y: 350 },
      { x: 600, y: 350 },
    ]);
  });

  it('cannot avoid an obstacle between perfectly aligned shapes', () => {
    // Aligned centres collapse every candidate to the same straight line.
    const m = modelWith([
      { id: 'a', type: 'item', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', type: 'item', x: 600, y: 0, w: 100, h: 100 },
      { id: 'wall', type: 'item', x: 300, y: -200, w: 60, h: 500 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(c.waypoints).toHaveLength(2);
  });

  it('leaves waypoints untouched when an endpoint is missing', () => {
    const m = modelWith([{ id: 'a' }]);
    const c = {
      id: 'c',
      sourceId: 'a',
      targetId: 'ghost',
      label: '',
      style: 'solid' as const,
      waypoints: [],
    };
    m.connectors = [c];
    routeConnector(m, c);
    expect(c.waypoints).toEqual([]);
  });

  it('collapses collinear points', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 0, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    // Perfectly aligned centres need no intermediate bend.
    expect(c.waypoints).toHaveLength(2);
  });
});

describe('connector collection helpers', () => {
  it('re-routes only the connectors touching the moved shapes', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 0, w: 100, h: 100 },
      { id: 'c', x: 0, y: 600, w: 100, h: 100 },
      { id: 'd', x: 400, y: 600, w: 100, h: 100 },
    ]);
    const ab = addConnector(m, 'a', 'b');
    const cd = addConnector(m, 'c', 'd');
    const cdBefore = structuredClone(cd.waypoints);

    m.shapes[0].y = 200;
    routeConnectorsFor(m, new Set(['a']));

    expect(ab.waypoints[0].y).toBe(250);
    expect(cd.waypoints).toEqual(cdBefore);
  });

  it('lists connectors attached to a set of shapes', () => {
    const m = modelWith([{ id: 'a' }, { id: 'b', x: 400 }, { id: 'c', x: 800 }]);
    addConnector(m, 'a', 'b');
    addConnector(m, 'b', 'c');
    expect(connectorsTouching(m, new Set(['a']))).toHaveLength(1);
    expect(connectorsTouching(m, new Set(['b']))).toHaveLength(2);
    expect(connectorsTouching(m, new Set(['zzz']))).toHaveLength(0);
  });

  it('deletes by id', () => {
    const m = modelWith([{ id: 'a' }, { id: 'b', x: 400 }]);
    const c = addConnector(m, 'a', 'b');
    deleteConnector(m, c.id);
    expect(m.connectors).toHaveLength(0);
  });

  it('routes every connector at once', () => {
    const m = modelWith([{ id: 'a' }, { id: 'b', x: 400 }]);
    m.connectors = [
      { id: 'c', sourceId: 'a', targetId: 'b', label: '', style: 'solid', waypoints: [] },
    ];
    routeAllConnectors(m);
    expect(m.connectors[0].waypoints.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fixed ports', () => {
  it.each([
    { x: 400, y: 0 },
    { x: 0, y: 400 },
    { x: 400, y: 300 },
    { x: -400, y: -300 },
    { x: 106, y: 0 },
  ])('approaches every pair of faces from outside the endpoint shapes at %j', (position) => {
    const normals: Record<Port, Point> = {
      N: { x: 0, y: -1 },
      S: { x: 0, y: 1 },
      E: { x: 1, y: 0 },
      W: { x: -1, y: 0 },
    };
    for (const sourcePort of Object.keys(normals) as Port[]) {
      for (const targetPort of Object.keys(normals) as Port[]) {
        const model = modelWith([
          { id: 'a', x: 0, y: 0, w: 100, h: 100 },
          { id: 'b', ...position, w: 100, h: 100 },
        ]);
        const line = addConnector(model, 'a', 'b');
        Object.assign(line, { sourcePort, targetPort });
        routeConnector(model, line);
        const points = line.waypoints;
        expect(isOrthogonal(points)).toBe(true);
        expect(points[0]).toEqual(ports(model.shapes[0])[sourcePort]);
        expect(points.at(-1)).toEqual(ports(model.shapes[1])[targetPort]);
        const departure = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
        const arrival = {
          x: points.at(-2)!.x - points.at(-1)!.x,
          y: points.at(-2)!.y - points.at(-1)!.y,
        };
        for (const [delta, normal] of [
          [departure, normals[sourcePort]],
          [arrival, normals[targetPort]],
        ]) {
          expect(delta.x * normal.y - delta.y * normal.x).toBe(0);
          expect(delta.x * normal.x + delta.y * normal.y).toBeGreaterThan(0);
        }
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const b = points[i];
          for (const shape of model.shapes) {
            const crosses =
              a.x === b.x
                ? a.x > shape.x &&
                  a.x < shape.x + shape.w &&
                  Math.max(a.y, b.y) > shape.y &&
                  Math.min(a.y, b.y) < shape.y + shape.h
                : a.y > shape.y &&
                  a.y < shape.y + shape.h &&
                  Math.max(a.x, b.x) > shape.x &&
                  Math.min(a.x, b.x) < shape.x + shape.w;
            expect(crosses, `${sourcePort}/${targetPort}: ${JSON.stringify(points)}`).toBe(false);
          }
        }
      }
    }
  });

  it('takes an outer detour around an unrelated obstacle with fixed faces', () => {
    const model = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 600, y: 0, w: 100, h: 100 },
      { id: 'wall', x: 250, y: -200, w: 100, h: 500 },
      { id: 'far', x: 2000, y: -10000, w: 100, h: 100 },
    ]);
    const line = addConnector(model, 'a', 'b');
    line.sourcePort = 'E';
    line.targetPort = 'W';
    routeConnector(model, line);
    expect(isOrthogonal(line.waypoints)).toBe(true);
    expect(line.waypoints.some((p) => p.y < -200 || p.y > 300)).toBe(true);
    expect(line.waypoints.every((p) => Math.abs(p.y) < 1000)).toBe(true);
  });

  it('leaves and arrives by the faces the author fixed, whatever the geometry says', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 0, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    expect(c.waypoints[0]).toEqual({ x: 100, y: 50 });
    c.sourcePort = 'N';
    c.targetPort = 'S';
    routeConnector(m, c);
    expect(c.waypoints[0]).toEqual({ x: 50, y: 0 });
    expect(c.waypoints[c.waypoints.length - 1]).toEqual({ x: 450, y: 100 });
    expect(isOrthogonal(c.waypoints)).toBe(true);
    // One face fixed: the other end is still the router's guess.
    c.sourcePort = undefined;
    routeConnector(m, c);
    expect(c.waypoints[0]).toEqual({ x: 100, y: 50 });
    expect(c.waypoints[c.waypoints.length - 1]).toEqual({ x: 450, y: 100 });
  });

  it('overrides the straight drop between stacked items when a face is fixed', () => {
    const m = createEmptyModel();
    const group = addGroup(m, 0, 0);
    const container = children(m, group.id)[0];
    addItemToContainer(m, container.id);
    const [top, bottom] = children(m, container.id);
    const c = addConnector(m, top.id, bottom.id);
    expect(c.waypoints).toHaveLength(2);
    c.sourcePort = 'E';
    routeConnector(m, c);
    expect(c.waypoints[0]).toEqual({ x: top.x + top.w, y: top.y + top.h / 2 });
  });

  it('names the face a line towards a point would leave by', () => {
    const shape = { id: 's', type: 'item' as const, parentId: null, x: 0, y: 0, w: 200, h: 100 };
    expect(portTowards(shape, { x: 500, y: 50 })).toBe('E');
    expect(portTowards(shape, { x: -300, y: 50 })).toBe('W');
    expect(portTowards(shape, { x: 100, y: 400 })).toBe('S');
    expect(portTowards(shape, { x: 100, y: -200 })).toBe('N');
    // Beside a wide card and a little above: still the side.
    expect(portTowards(shape, { x: 500, y: -60 })).toBe('E');
  });
});

describe('routes of the author\u2019s', () => {
  function pair() {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 300, w: 100, h: 100 },
    ]);
    const c = addConnector(m, 'a', 'b');
    return { m, c };
  }

  it('are taken as given, ends put back on their faces, and kept when re-routed', () => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    expect(c.manual).toBe(true);
    expect(c.waypoints).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    const before = structuredClone(c.waypoints);
    routeAllConnectors(m);
    expect(c.waypoints).toEqual(before);
    // A bend on a straight line survives: it is there to be dragged.
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 250, y: 50 },
      { x: 400, y: 50 },
    ]);
    expect(c.waypoints).toHaveLength(3);
  });

  it('slide with both shapes, and follow one shape by its own axis', () => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    // Both moved by the same delta: every bend moves with them.
    for (const s of m.shapes) {
      s.x += 30;
      s.y += 20;
    }
    routeAllConnectors(m);
    expect(c.waypoints).toEqual([
      { x: 130, y: 70 },
      { x: 230, y: 70 },
      { x: 230, y: 370 },
      { x: 430, y: 370 },
    ]);
    // Only the source moved down: its horizontal first segment moves with it,
    // the vertical middle segment stays where the author put it.
    m.shapes[0].y += 40;
    routeAllConnectors(m);
    expect(c.waypoints).toEqual([
      { x: 130, y: 110 },
      { x: 230, y: 110 },
      { x: 230, y: 370 },
      { x: 430, y: 370 },
    ]);
    expect(isOrthogonal(c.waypoints)).toBe(true);
    expect(c.manual).toBe(true);
  });

  it.each([
    { x: 300, y: 400 },
    { x: 100, y: 0 },
    { x: -700, y: -500 },
  ])('keeps every bend in a shared translation %j using the pre-move geometry', (delta) => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    const before = structuredClone(m);
    for (const shape of m.shapes) {
      shape.x += delta.x;
      shape.y += delta.y;
    }
    routeAllConnectors(m, before);
    expect(c.waypoints).toEqual(
      before.connectors[0].waypoints.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
    );
    const kept = c.waypoints;
    routeAllConnectors(m);
    expect(c.waypoints).toBe(kept);
  });

  it('retains a diagonal manual route on repeated routing', () => {
    const model = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 400, w: 100, h: 100 },
    ]);
    const line = addConnector(model, 'a', 'b');
    const points = [
      { x: 100, y: 50 },
      { x: 400, y: 450 },
    ];
    setRoute(model, line, points);
    for (let i = 0; i < 5; i++) {
      routeAllConnectors(model);
      expect(line.waypoints).toEqual(points);
    }
  });

  it('retains implicit faces when a diagonal manual route moves across its old endpoints', () => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 400, y: 350 },
    ]);
    const before = structuredClone(m);
    m.shapes[0].x += 100;
    m.shapes[1].x += 100;
    routeAllConnectors(m, before);
    expect(c.waypoints).toEqual([
      { x: 200, y: 50 },
      { x: 500, y: 350 },
    ]);
  });

  it('does not translate the bends when only the selected faces change', () => {
    const { m, c } = pair();
    c.sourcePort = 'E';
    c.targetPort = 'E';
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 600, y: 50 },
      { x: 600, y: 350 },
      { x: 500, y: 350 },
    ]);
    const before = structuredClone(m);
    c.sourcePort = 'W';
    c.targetPort = 'W';
    routeConnector(m, c, before);
    expect(bendsOf(c)).toEqual(bendsOf(before.connectors[0]));
    expect(c.waypoints[0]).toEqual({ x: 0, y: 50 });
    expect(c.waypoints.at(-1)).toEqual({ x: 400, y: 350 });
  });

  it('ignores empty and single-point route edits', () => {
    const { m, c } = pair();
    const before = structuredClone(c);
    setRoute(m, c, []);
    setRoute(m, c, [{ x: 0, y: 0 }]);
    expect(c).toEqual(before);
  });

  it('re-anchor a straight line by both ends, and go back to the router when reset', () => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 400, y: 350 },
    ]);
    m.shapes[1].x = 800;
    routeAllConnectors(m);
    expect(c.waypoints).toEqual([
      { x: 100, y: 50 },
      { x: 800, y: 350 },
    ]);
    resetRoute(m, c);
    expect(c.manual).toBeUndefined();
    expect(c.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(c.waypoints)).toBe(true);
  });

  it('honour a fixed face when re-anchoring', () => {
    const { m, c } = pair();
    c.sourcePort = 'S';
    setRoute(m, c, [
      { x: 50, y: 100 },
      { x: 50, y: 350 },
      { x: 400, y: 350 },
    ]);
    m.shapes[0].x += 10;
    routeAllConnectors(m);
    expect(c.waypoints[0]).toEqual({ x: 60, y: 100 });
    expect(c.waypoints[1]).toEqual({ x: 60, y: 350 });
  });

  it('are drawn through given bends from the nearest faces', () => {
    const { m, c } = pair();
    routeThrough(m, c, [
      { x: 50, y: 200 },
      { x: 450, y: 200 },
    ]);
    expect(c.manual).toBe(true);
    expect(c.waypoints).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
      { x: 450, y: 200 },
      { x: 450, y: 300 },
    ]);
    expect(bendsOf(c)).toHaveLength(2);
    routeThrough(m, c, []);
    expect(c.manual).toBeUndefined();
  });

  it('reanchorRoute leaves an already anchored route alone', () => {
    const { m, c } = pair();
    setRoute(m, c, [
      { x: 100, y: 50 },
      { x: 400, y: 350 },
    ]);
    const before = c.waypoints;
    reanchorRoute(c, m.shapes[0], m.shapes[1]);
    expect(c.waypoints).toBe(before);
  });
});

describe('editing a route', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ];

  it('finds the nearest point on the line and its segment', () => {
    expect(nearestOnPolyline(line, { x: 50, y: 20 })).toEqual({
      point: { x: 50, y: 0 },
      segment: 0,
      distance: 20,
    });
    expect(nearestOnPolyline(line, { x: 200, y: 130 })?.segment).toBe(2);
    expect(nearestOnPolyline([{ x: 0, y: 0 }], { x: 1, y: 1 })).toBeNull();
  });

  it('inserts a bend on the nearest segment, at the foot of the pointer', () => {
    const { waypoints, index } = insertBend(line, { x: 200, y: 120 });
    expect(index).toBe(3);
    expect(waypoints).toHaveLength(5);
    expect(waypoints[3]).toEqual({ x: 200, y: 100 });
  });

  it('slides a segment across its axis and drags its two bends along', () => {
    // The vertical middle segment moves sideways; the horizontal ones stretch.
    expect(moveSegment(line, 1, 40, 999)).toEqual([
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 100 },
      { x: 300, y: 100 },
    ]);
    // A horizontal segment moves up and down only.
    expect(moveSegment(line, 2, 999, -30)[2]).toEqual({ x: 100, y: 70 });
    expect(moveSegment(line, 2, 999, -30)[3]).toEqual({ x: 300, y: 70 });
    expect(moveSegment(line, 7, 1, 1)).toBe(line);
  });
});
