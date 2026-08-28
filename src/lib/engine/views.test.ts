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
  resolveView,
  viewsOf,
} from './views';
import { forgetShapeInViews } from './model';
import { addConnector } from './routing';
import { modelWith } from './testUtils';

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
