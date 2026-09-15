import { describe, expect, it } from 'vitest';
import {
  addConnector,
  addGroup,
  children,
  cloneShapes,
  createEmptyModel,
  getShape,
  resolveView,
  routeAllConnectors,
  setRoute,
} from '@/lib/engine';
import { modelWith } from '@/lib/engine/testUtils';
import { docReducer, initialDocState } from './reducer';
import {
  GHOST_PREFIX,
  normaliseBox,
  previewConnector,
  previewDrag,
  previewDuplicate,
  previewResize,
  resolveDragSet,
  shapesInLasso,
} from './preview';

function twoGroups() {
  const m = createEmptyModel();
  const a = addGroup(m, 0, 0);
  const b = addGroup(m, 900, 0);
  const items = m.shapes.filter((s) => s.type === 'item');
  addConnector(m, items[0].id, items[1].id);
  return { model: m, a, b, items };
}

describe('resolveDragSet', () => {
  it('includes every descendant of the dragged shape', () => {
    const { model, a } = twoGroups();
    expect(resolveDragSet(model, [a.id]).size).toBe(3);
  });

  it('ignores unknown ids', () => {
    const { model } = twoGroups();
    expect(resolveDragSet(model, ['ghost']).size).toBe(0);
  });
});

describe('previewDrag', () => {
  it('translates manual bends with the selection while retaining their appearance', () => {
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
    const before = structuredClone(model);
    const preview = previewDrag(model, new Set(['a', 'b']), 300, 400);
    expect(preview.connectors[0]).toEqual({
      ...line,
      waypoints: line.waypoints.map((p) => ({ x: p.x + 300, y: p.y + 400 })),
    });
    routeAllConnectors(preview);
    expect(preview.connectors[0].waypoints[1]).toEqual({ x: 500, y: 450 });
    expect(model).toEqual(before);
  });

  it('offsets only the affected shapes', () => {
    const { model, a, b } = twoGroups();
    const preview = previewDrag(model, resolveDragSet(model, [a.id]), 50, 25);

    expect(getShape(preview, a.id)!.x).toBe(50);
    expect(getShape(preview, b.id)!.x).toBe(900);
  });

  it('leaves the original model untouched', () => {
    const { model, a } = twoGroups();
    const before = structuredClone(model);
    previewDrag(model, resolveDragSet(model, [a.id]), 100, 100);
    expect(model).toEqual(before);
  });

  it('shares unaffected shapes by reference instead of copying them', () => {
    const { model, a, b } = twoGroups();
    const preview = previewDrag(model, resolveDragSet(model, [a.id]), 10, 0);
    // This is what keeps a drag cheap on a large diagram.
    expect(preview.shapes.find((s) => s.id === b.id)).toBe(model.shapes.find((s) => s.id === b.id));
  });

  it('reroutes the connectors it touches', () => {
    const { model, a } = twoGroups();
    const preview = previewDrag(model, resolveDragSet(model, [a.id]), 0, 400);
    expect(preview.connectors[0].waypoints).not.toEqual(model.connectors[0].waypoints);
  });

  it('returns the same model when nothing moves', () => {
    const { model, a } = twoGroups();
    expect(previewDrag(model, resolveDragSet(model, [a.id]), 0, 0)).toBe(model);
    expect(previewDrag(model, new Set(), 10, 10)).toBe(model);
  });
});

describe('previewConnector', () => {
  it('retains curve, color and weight while previewing a moved label', () => {
    const { model } = twoGroups();
    const line = model.connectors[0];
    Object.assign(line, { curve: 'orthogonal', color: '#123456', weight: 'bold' });
    const preview = previewConnector(model, line.id, { labelAt: 0.2549 });
    expect(preview.connectors[0]).toEqual({ ...line, labelAt: 0.2549 });
    expect(line.labelAt).toBeUndefined();
    expect(previewConnector(model, 'missing', { labelAt: 0 })).toBe(model);
  });
});

describe('previewDuplicate', () => {
  it('appends a moved copy under ghost ids and leaves the originals in place', () => {
    const { model, a, b, items } = twoGroups();
    const clone = cloneShapes(model, new Set([a.id, b.id]));
    const preview = previewDuplicate(model, clone, 100, 50);

    expect(preview.shapes).toHaveLength(model.shapes.length * 2);
    expect(getShape(preview, a.id)).toBe(getShape(model, a.id));
    const ghost = getShape(preview, GHOST_PREFIX + a.id)!;
    expect(ghost).toMatchObject({ x: a.x + 100, y: a.y + 50, type: 'group' });
    // The copy's items hang off the copy's containers, not the originals'.
    const ghostItem = getShape(preview, GHOST_PREFIX + items[0].id)!;
    expect(ghostItem.parentId).toBe(GHOST_PREFIX + items[0].parentId!);
    // The line between the two copies comes along, moved by the same amount.
    expect(preview.connectors).toHaveLength(2);
    expect(preview.connectors[1]).toMatchObject({
      sourceId: GHOST_PREFIX + items[0].id,
      targetId: GHOST_PREFIX + items[1].id,
    });
    expect(preview.connectors[1].waypoints[0]).toEqual({
      x: model.connectors[0].waypoints[0].x + 100,
      y: model.connectors[0].waypoints[0].y + 50,
    });
    expect(model.shapes).toHaveLength(6);
  });

  it('shows nothing until the copy has somewhere to go', () => {
    const { model, a } = twoGroups();
    const clone = cloneShapes(model, new Set([a.id]));
    expect(previewDuplicate(model, clone, 0, 0)).toBe(model);
    expect(previewDuplicate(model, { shapes: [], connectors: [] }, 10, 10)).toBe(model);
  });

  it('draws the ghost of a locked shape unlocked, as the copy will arrive', () => {
    const { model, a } = twoGroups();
    a.locked = true;
    const preview = previewDuplicate(model, cloneShapes(model, new Set([a.id])), 20, 20);
    expect(getShape(preview, GHOST_PREFIX + a.id)!.locked).toBeUndefined();
    expect(getShape(preview, a.id)!.locked).toBe(true);
  });
});

describe('previewResize', () => {
  it('applies the new size and marks it manual', () => {
    const { model, a } = twoGroups();
    const preview = previewResize(model, a.id, 700, 400);
    expect(getShape(preview, a.id)).toMatchObject({ w: 700, h: 400, manualSize: true });
  });

  it('relays out the children of a resized group', () => {
    const { model, a } = twoGroups();
    const container = children(model, a.id)[0];
    const preview = previewResize(model, a.id, 700, 400);
    expect(getShape(preview, container.id)!.w).toBeGreaterThan(container.w);
  });

  it('leaves the original model untouched', () => {
    const { model, a } = twoGroups();
    const before = structuredClone(model);
    previewResize(model, a.id, 900, 600);
    expect(model).toEqual(before);
  });

  it('ignores an unknown id', () => {
    const { model } = twoGroups();
    expect(previewResize(model, 'ghost', 100, 100)).toBe(model);
  });
});

describe('view preview parity', () => {
  it.each(['move', 'resize'] as const)(
    'matches the committed %s after independent view placements',
    (kind) => {
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
        { id: 'main', name: 'Main', kind: 'free' },
        {
          id: 'detail',
          name: 'Detail',
          kind: 'free',
          place: { a: { x: 0, y: 100, w: 100, h: 100 } },
        },
      ];
      const before = structuredClone(model);
      const reading = resolveView(model, 'detail');
      const preview =
        kind === 'move'
          ? previewDrag(reading, new Set(['a', 'b']), 50, 30, model)
          : previewResize(reading, 'a', 160, 140, model);
      const after = docReducer(
        initialDocState(model),
        kind === 'move'
          ? { type: 'moveShapes', ids: ['a', 'b'], dx: 50, dy: 30, viewId: 'detail' }
          : { type: 'resizeShape', id: 'a', w: 160, h: 140, viewId: 'detail' },
      );
      expect(preview.connectors).toEqual(resolveView(after.model, 'detail').connectors);
      expect(model).toEqual(before);
    },
  );
});

describe('lasso helpers', () => {
  it('normalises a box dragged in any direction', () => {
    const expected = { x: 10, y: 10, w: 90, h: 40 };
    expect(normaliseBox({ x: 100, y: 50 }, { x: 10, y: 10 })).toEqual(expected);
    expect(normaliseBox({ x: 10, y: 10 }, { x: 100, y: 50 })).toEqual(expected);
  });

  it('selects the shapes a lasso touches, skipping containers', () => {
    const { model, a } = twoGroups();
    const hits = shapesInLasso(model, { x: -10, y: -10, w: 600, h: 400 });
    expect(hits).toContain(a.id);
    expect(hits.every((id) => getShape(model, id)!.type !== 'container')).toBe(true);
  });

  it('takes a region only when the lasso encloses it', () => {
    const { model } = twoGroups();
    model.shapes.push({
      id: 'rg_1',
      type: 'region',
      parentId: null,
      x: -100,
      y: -100,
      w: 1500,
      h: 600,
    });
    // Across the services on the region: the services, not the zone under them.
    const across = shapesInLasso(model, { x: -10, y: -10, w: 600, h: 400 });
    expect(across).not.toContain('rg_1');
    expect(across.length).toBeGreaterThan(0);
    // Around the whole zone: the zone too.
    expect(shapesInLasso(model, { x: -200, y: -200, w: 2000, h: 1000 })).toContain('rg_1');
  });

  it('selects nothing when the lasso is empty space', () => {
    const { model } = twoGroups();
    expect(shapesInLasso(model, { x: 5000, y: 5000, w: 100, h: 100 })).toEqual([]);
  });
});
