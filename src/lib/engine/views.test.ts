import { describe, expect, it } from 'vitest';
import type { View } from '@/lib/domain';
import { parseDiagramModel } from '@/lib/domain';
import {
  MAIN_VIEW_ID,
  canDrillInto,
  focusSubtree,
  getView,
  isMainView,
  placementOf,
  projectView,
  resolveView,
  viewsOf,
} from './views';
import { forgetShapeInViews } from './model';
import { addConnector, routeAllConnectors, setRoute } from './routing';
import { modelWith } from './testUtils';
import { contentBBox } from './geometry';
import { exportToMarkdown } from './markdown';
import { diagramToSvgString } from '@/lib/editor/renderSvg';
import { buildShareLinks } from '@/lib/share/links';
import { decodeDiagram } from '@/lib/share/codec';

const three = () =>
  modelWith([
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 200, y: 0 },
    { id: 'c', x: 400, y: 0 },
  ]);

const view = (patch: Partial<View>): View => ({
  id: 'v1',
  name: 'Seguridad',
  kind: 'free',
  ...patch,
});

describe('a model with no views', () => {
  it('reads as one implicit view over everything', () => {
    const m = three();
    expect(viewsOf(m)).toHaveLength(1);
    expect(viewsOf(m)[0].id).toBe(MAIN_VIEW_ID);
  });

  // The whole point of treating absence as the main view: nothing stored before
  // views existed has to be rewritten, and nothing unsplit pays for the feature.
  it('resolves to itself, identically, so React memos still hold', () => {
    const m = three();
    expect(resolveView(m, null)).toBe(m);
    expect(resolveView(m, 'nonexistent')).toBe(m);
  });

  it('parses a stored model that predates views', () => {
    const legacy = {
      canvas: { w: 100, h: 100 },
      shapes: [],
      connectors: [],
    };
    expect(parseDiagramModel(legacy).views).toEqual([]);
  });
});

describe('resolveView', () => {
  it('anchors edits from a displaced reading back to the base model without moving the edited bends', () => {
    const model = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 300, w: 100, h: 100 },
    ]);
    const line = addConnector(model, 'a', 'b');
    setRoute(model, line, [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    model.views = [
      view({
        place: {
          a: { x: 100, y: 0, w: 100, h: 100 },
          b: { x: 500, y: 300, w: 100, h: 100 },
        },
      }),
    ];
    const reading = resolveView(model, 'v1');
    const edited = reading.connectors[0].waypoints.map((p, i) =>
      i === 1 || i === 2 ? { ...p, x: p.x + 20 } : p,
    );
    setRoute(model, line, edited, reading);
    expect(resolveView(model, 'v1').connectors[0].waypoints).toEqual(edited);
    expect(line.waypoints[1]).toEqual({ x: 220, y: 50 });
    expect(line.waypoints.at(-1)).toEqual({ x: 400, y: 350 });
  });

  it('translates a manual route with a view and leaves projection and the source stable', () => {
    const model = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 400, y: 300, w: 100, h: 100 },
    ]);
    const line = addConnector(model, 'a', 'b');
    setRoute(model, line, [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 400, y: 350 },
    ]);
    Object.assign(line, { curve: 'orthogonal', color: '#123456', weight: 'bold', labelAt: 0.2549 });
    model.views = [
      view({
        place: {
          a: { x: 300, y: 400, w: 100, h: 100 },
          b: { x: 700, y: 700, w: 100, h: 100 },
        },
      }),
    ];
    const before = structuredClone(model);
    const reading = resolveView(model, 'v1');
    const expected = line.waypoints.map((p) => ({ x: p.x + 300, y: p.y + 400 }));
    expect(reading.connectors[0]).toEqual({ ...line, waypoints: expected });
    expect(projectView(reading).connectors[0]).toEqual(reading.connectors[0]);
    routeAllConnectors(reading);
    expect(reading.connectors[0].waypoints).toEqual(expected);
    expect(model).toEqual(before);
  });

  it('keeps only what the view includes', () => {
    const m = three();
    m.views = [view({ include: ['a', 'c'] })];
    expect(resolveView(m, 'v1').shapes.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('brings a shape’s descendants along with it', () => {
    const m = modelWith([
      { id: 'grp', type: 'group' },
      { id: 'box', type: 'container', parentId: 'grp' },
      { id: 'svc', type: 'item', parentId: 'box' },
      { id: 'other', type: 'group' },
    ]);
    m.views = [view({ include: ['grp'] })];

    // Ticking a group and getting an empty rectangle would be a bug report, not
    // a feature: the container and item inside it are how a group is drawn.
    expect(resolveView(m, 'v1').shapes.map((s) => s.id)).toEqual(['grp', 'box', 'svc']);
  });

  it('applies a per-view position without touching the model', () => {
    const m = three();
    m.views = [view({ place: { a: { x: 900, y: 800, w: 100, h: 50 } } })];

    const resolved = resolveView(m, 'v1');
    expect(resolved.shapes.find((s) => s.id === 'a')).toMatchObject({ x: 900, y: 800 });
    expect(m.shapes.find((s) => s.id === 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('leaves a shape the view never moved where the model put it', () => {
    const m = three();
    m.views = [view({ place: { a: { x: 900, y: 800, w: 100, h: 50 } } })];
    expect(resolveView(m, 'v1').shapes.find((s) => s.id === 'b')).toMatchObject({ x: 200 });
  });

  it('drops a connector whose other end the view does not show', () => {
    const m = three();
    addConnector(m, 'a', 'b');
    addConnector(m, 'a', 'c');
    m.views = [view({ include: ['a', 'b'] })];

    // An arrow to a service that is not on screen is drawn pointing at nothing.
    const resolved = resolveView(m, 'v1');
    expect(resolved.connectors).toHaveLength(1);
    expect(resolved.connectors[0].targetId).toBe('b');
  });

  it('falls back to the first view when asked for one that is gone', () => {
    const m = three();
    m.views = [view({ include: ['a'] })];
    expect(resolveView(m, 'deleted').shapes.map((s) => s.id)).toEqual(['a']);
  });
});

describe('placementOf', () => {
  it('prefers the override', () => {
    const shape = three().shapes[0];
    const v = view({ place: { a: { x: 5, y: 6, w: 7, h: 8 } } });
    expect(placementOf(v, shape)).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it('falls back to the shape itself', () => {
    const shape = three().shapes[1];
    expect(placementOf(view({}), shape)).toEqual({ x: 200, y: 0, w: 100, h: 50 });
  });
});

describe('isMainView', () => {
  it('is true for the implicit view of an unsplit model', () => {
    expect(isMainView(three(), null)).toBe(true);
  });

  it('is true for the first view and false for the rest', () => {
    const m = three();
    m.views = [view({ id: 'v1' }), view({ id: 'v2' })];
    expect(isMainView(m, 'v1')).toBe(true);
    expect(isMainView(m, 'v2')).toBe(false);
  });
});

describe('getView', () => {
  it('names the implicit view so the interface has something to select', () => {
    expect(getView(three(), null).id).toBe(MAIN_VIEW_ID);
  });
});

describe('forgetShapeInViews', () => {
  it('removes a deleted shape from every view that mentioned it', () => {
    const m = three();
    m.views = [
      view({ id: 'v1', include: ['a', 'b'], place: { a: { x: 1, y: 1, w: 1, h: 1 } } }),
      view({ id: 'v2', include: ['a', 'c'] }),
    ];

    forgetShapeInViews(m, ['a']);

    expect(m.views[0].include).toEqual(['b']);
    expect(m.views[0].place).toEqual({});
    expect(m.views[1].include).toEqual(['c']);
  });

  it('leaves an unnarrowed view unnarrowed rather than listing what is left', () => {
    const m = three();
    m.views = [view({})];
    forgetShapeInViews(m, ['a']);
    expect(m.views[0].include).toBeUndefined();
  });

  it('does nothing when nothing was deleted', () => {
    const m = three();
    m.views = [view({ include: ['a'] })];
    forgetShapeInViews(m, []);
    expect(m.views[0].include).toEqual(['a']);
  });
});

describe('focusSubtree', () => {
  /** A boundary holding two groups, one of which holds two services. */
  const nested = () =>
    modelWith([
      { id: 'cloud', type: 'boundary', x: 0, y: 0, w: 1000, h: 600 },
      { id: 'g1', type: 'group', x: 40, y: 40, w: 300, h: 200 },
      { id: 'c1', type: 'container', parentId: 'g1', x: 50, y: 80, w: 280, h: 150 },
      { id: 'i1', type: 'item', parentId: 'c1', x: 60, y: 90, w: 260, h: 60 },
      { id: 'i2', type: 'item', parentId: 'c1', x: 60, y: 160, w: 260, h: 60 },
      { id: 'g2', type: 'group', x: 500, y: 40, w: 300, h: 200 },
      { id: 'outside', type: 'group', x: 2000, y: 2000, w: 300, h: 200 },
    ]);

  it('shows a boundary’s contents, which are geometric and not its children', () => {
    // A boundary parents nothing: membership is where a shape sits, the same
    // rule the serialiser uses for `in:`.
    const ids = focusSubtree(nested(), ['cloud']).shapes.map((s) => s.id);
    expect(ids).toContain('g1');
    expect(ids).toContain('g2');
    expect(ids).not.toContain('outside');
  });

  it('descends into a group and leaves its siblings behind', () => {
    const ids = focusSubtree(nested(), ['g1']).shapes.map((s) => s.id);
    expect(ids).toEqual(['g1', 'c1', 'i1', 'i2']);
  });

  it('follows the last step of the trail, the rest being the breadcrumb', () => {
    const ids = focusSubtree(nested(), ['cloud', 'g1']).shapes.map((s) => s.id);
    expect(ids).toEqual(['g1', 'c1', 'i1', 'i2']);
  });

  it('drops a connector that leaves the branch', () => {
    const m = nested();
    addConnector(m, 'i1', 'g2');
    addConnector(m, 'i1', 'i2');
    expect(focusSubtree(m, ['g1']).connectors).toHaveLength(1);
  });

  it('is the whole model at the top', () => {
    const m = nested();
    expect(focusSubtree(m, [])).toBe(m);
  });

  it('is the whole model when the trail points at something deleted', () => {
    const m = nested();
    expect(focusSubtree(m, ['gone'])).toBe(m);
  });
});

describe('canDrillInto', () => {
  const nested = () =>
    modelWith([
      { id: 'cloud', type: 'boundary', x: 0, y: 0, w: 1000, h: 600 },
      { id: 'g1', type: 'group', x: 40, y: 40, w: 300, h: 200 },
      { id: 'c1', type: 'container', parentId: 'g1', x: 50, y: 80, w: 280, h: 150 },
      { id: 'i1', type: 'item', parentId: 'c1', x: 60, y: 90, w: 260, h: 60 },
      { id: 'i2', type: 'item', parentId: 'c1', x: 60, y: 160, w: 260, h: 60 },
      { id: 'far', type: 'group', x: 3000, y: 3000, w: 100, h: 100 },
    ]);

  it('offers a boundary that holds something', () => {
    expect(canDrillInto(nested(), 'cloud')).toBe(true);
  });

  it('offers a group holding more than one service', () => {
    expect(canDrillInto(nested(), 'g1')).toBe(true);
  });

  it('refuses a group holding a single service, which has no level below it', () => {
    const m = modelWith([
      { id: 'g', type: 'group' },
      { id: 'c', type: 'container', parentId: 'g' },
      { id: 'i', type: 'item', parentId: 'c' },
      { id: 'other', type: 'group' },
    ]);
    expect(canDrillInto(m, 'g')).toBe(false);
  });

  it('refuses an item, which is the bottom', () => {
    expect(canDrillInto(nested(), 'i1')).toBe(false);
  });

  it('refuses a boundary that already holds everything there is', () => {
    const m = modelWith([
      { id: 'cloud', type: 'boundary', x: 0, y: 0, w: 1000, h: 600 },
      { id: 'g', type: 'group', x: 10, y: 10, w: 100, h: 100 },
      { id: 'c', type: 'container', parentId: 'g', x: 20, y: 20, w: 80, h: 60 },
      { id: 'i', type: 'item', parentId: 'c', x: 30, y: 30, w: 60, h: 30 },
    ]);
    // Drilling into it would change nothing on screen, so the gesture would
    // only leave the reader wondering what happened.
    expect(canDrillInto(m, 'cloud')).toBe(false);
  });
});

describe('projectView', () => {
  function publication() {
    const model = modelWith([
      { id: 'g', type: 'group', title: 'Public group', x: 100, y: 100, w: 470, h: 320 },
      { id: 'box', type: 'container', parentId: 'g', x: 120, y: 140, w: 400, h: 260 },
      {
        id: 'a',
        parentId: 'box',
        title: 'Public API',
        x: 130,
        y: 150,
        order: 0,
        meta: { owner: 'platform' },
      },
      { id: 'b', parentId: 'box', title: 'Public worker', x: 130, y: 250, order: 1 },
      {
        id: 'hidden',
        title: 'EXCLUDED_SERVICE',
        x: 10000,
        y: 10000,
        meta: { owner: 'EXCLUDED_OWNER' },
      },
    ]);
    model.views = [
      view({ id: 'main', name: 'EXCLUDED_VIEW', include: ['hidden'] }),
      view({
        id: 'public',
        include: ['g'],
        place: {
          a: { x: 230, y: 160, w: 240, h: 70 },
          hidden: { x: 30000, y: 30000, w: 100, h: 50 },
        },
      }),
    ];
    model.rules = [
      {
        id: 'EXCLUDED_RULE',
        description: 'Internal standard',
        severity: 'high',
        services: {},
        require: { owner: true },
      },
    ];
    addConnector(model, 'a', 'b').label = 'Public call';
    addConnector(model, 'a', 'hidden').label = 'EXCLUDED_CONNECTION';
    return model;
  }

  it('keeps a route the author drew, re-anchored to where the view puts the shapes', () => {
    const model = publication();
    const line = model.connectors[0];
    line.manual = true;
    line.waypoints = [
      { x: 370, y: 185 },
      { x: 600, y: 185 },
      { x: 600, y: 285 },
      { x: 370, y: 285 },
    ];
    const projected = projectView(resolveView(model, 'public'));
    const kept = projected.connectors.find((c) => c.id === line.id)!;
    expect(kept.manual).toBe(true);
    // The bend the author put at x=600 is still there; the ends sit on the shapes.
    expect(kept.waypoints.some((p) => p.x === 600)).toBe(true);
    expect(kept.waypoints.length).toBeGreaterThanOrEqual(3);
    // The router's line is redrawn from nothing, as before.
    const other = projected.connectors.find((c) => c.id !== line.id);
    expect(other).toBeUndefined();
    expect(model.connectors[0].waypoints).toEqual(line.waypoints);
  });

  it('removes other views, rules, hidden shapes and dangling references without mutating the model', () => {
    const model = publication();
    const snapshot = structuredClone(model);
    const projected = projectView(resolveView(model, 'public'));
    expect(projected.views).toEqual([]);
    expect(projected.rules).toBeUndefined();
    expect(projected.shapes.map((s) => s.id)).toEqual(['g', 'box', 'a', 'b']);
    expect(projected.shapes.find((s) => s.id === 'a')).toMatchObject({
      x: 230,
      y: 160,
      w: 240,
      h: 70,
      parentId: 'box',
      meta: { owner: 'platform' },
    });
    expect(projected.connectors).toHaveLength(1);
    expect(JSON.stringify(projected)).not.toContain('EXCLUDED');
    expect(parseDiagramModel(projected)).toEqual(projected);
    expect(model).toEqual(snapshot);
  });

  it('detaches a visible item from an excluded parent, including during drill', () => {
    const model = publication();
    const reading = focusSubtree(resolveView(model, 'public'), ['a']);
    const projected = projectView(reading);
    expect(projected.shapes).toHaveLength(1);
    expect(projected.shapes[0]).toMatchObject({ id: 'a', parentId: null, x: 230 });
    expect(projected.connectors).toEqual([]);
    expect(projected.views).toEqual([]);
    expect(projected.rules).toBeUndefined();
    expect(contentBBox(projected)).toEqual({ x: 230, y: 160, w: 240, h: 70 });
  });

  it('also filters dangling connectors passed in a reading', () => {
    const model = publication();
    model.shapes = model.shapes.filter((s) => s.id !== 'hidden');
    expect(projectView(model).connectors).toHaveLength(1);
  });

  it('does not broaden an empty view', () => {
    const model = publication();
    model.views[1].include = [];
    const projected = projectView(resolveView(model, 'public'));
    expect(projected.shapes).toEqual([]);
    expect(projected.connectors).toEqual([]);
    expect(projected.views).toEqual([]);
    expect(projected.rules).toBeUndefined();
    expect(contentBBox(projected)).toMatchObject({ w: 600, h: 400 });
  });

  it('exports SVG and Markdown with the same scope and geometry as the canvas', async () => {
    const projected = projectView(resolveView(publication(), 'public'));
    const svg = await diagramToSvgString({ model: projected });
    expect(svg).toContain('Public API');
    const card = svg.match(/<rect[^>]*data-shape-id="a"[^>]*>/)![0];
    expect(card).toContain('x="230" y="160" width="240" height="70"');
    expect(svg).not.toContain('EXCLUDED');
    const markdown = exportToMarkdown(projected);
    expect(markdown).toContain('Public API');
    expect(markdown).toContain('Public call');
    expect(markdown).not.toContain('EXCLUDED');
  });

  it('the actual share and embed payloads contain only the projected reading', async () => {
    const projected = projectView(resolveView(publication(), 'public'));
    const links = await buildShareLinks(projected, 'https://example.test');
    for (const url of [links.view, links.image]) {
      const decoded = await decodeDiagram(new URL(url).searchParams.get('d')!);
      expect(decoded.shapes).toEqual(projected.shapes);
      expect(decoded.views).toEqual([]);
      expect(decoded.rules).toBeUndefined();
      expect(decoded.connectors).toHaveLength(1);
      expect(JSON.stringify(decoded)).not.toContain('EXCLUDED');
    }
    expect(links.readme).toContain('Public API');
    expect(links.readme).not.toContain('EXCLUDED');
  });

  it('full-model links and native JSON retain all views, rules and hidden content', async () => {
    const model = publication();
    const links = await buildShareLinks(model, 'https://example.test');
    const decoded = await decodeDiagram(new URL(links.view).searchParams.get('d')!);
    expect(decoded.shapes).toEqual(model.shapes);
    expect(decoded.views).toEqual(model.views);
    expect(decoded.rules).toEqual(model.rules);
    expect(decoded.connectors).toHaveLength(2);
    expect(parseDiagramModel(JSON.parse(JSON.stringify(model)))).toEqual(model);
  });
});
