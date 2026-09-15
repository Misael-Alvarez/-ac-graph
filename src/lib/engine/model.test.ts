import { describe, expect, it } from 'vitest';
import { G } from './constants';
import {
  addBoundary,
  addDecoration,
  addGroup,
  carryDecorations,
  DECORATION_SIZE,
  addItemToContainer,
  children,
  collectDescendantIds,
  createEmptyModel,
  deleteShape,
  getShape,
  isAncestor,
  isLocked,
  isRelated,
  relayoutGroup,
  reorderItem,
  shapeIndex,
} from './model';
import { addConnector } from './routing';
import { modelWith } from './testUtils';

describe('shapeIndex', () => {
  it('sees shapes appended to the same array', () => {
    const m = createEmptyModel();
    addGroup(m, 0, 0);
    const first = m.shapes.length;
    expect(shapeIndex(m).size).toBe(first);
    addGroup(m, 500, 0);
    // The old engine required a manual reindex() here and returned stale data without it.
    expect(shapeIndex(m).size).toBe(m.shapes.length);
  });

  it('rebuilds when the shapes array is replaced', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    expect(getShape(m, g.id)).toBeDefined();
    m.shapes = m.shapes.filter((s) => s.id !== g.id);
    expect(getShape(m, g.id)).toBeUndefined();
  });

  it('keeps two models independent', () => {
    const a = createEmptyModel();
    const b = createEmptyModel();
    const ga = addGroup(a, 0, 0);
    const gb = addGroup(b, 0, 0);
    // The module-level index in the old engine made this impossible.
    expect(getShape(a, ga.id)).toBeDefined();
    expect(getShape(a, gb.id)).toBeUndefined();
    expect(getShape(b, gb.id)).toBeDefined();
    expect(getShape(b, ga.id)).toBeUndefined();
  });
});

describe('addGroup', () => {
  it('creates a group, container and one item', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 100, 200);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    const items = children(m, ct.id).filter((s) => s.type === 'item');
    expect(ct).toBeDefined();
    expect(items).toHaveLength(1);
    expect(items[0].order).toBe(0);
  });

  it('lays the container out relative to the group', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 100, 200);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    expect(ct.x).toBe(g.x + G.CONTAINER_DX);
    expect(ct.y).toBe(g.y + G.CONTAINER_DY);
    expect(ct.w).toBe(g.w - G.CONTAINER_MARGIN_R);
  });
});

describe('relayoutGroup', () => {
  it('stacks items at the tight pitch', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    addItemToContainer(m, ct.id);
    addItemToContainer(m, ct.id);
    const items = children(m, ct.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(items).toHaveLength(3);
    expect(items[1].y - items[0].y).toBe(G.PITCH_TIGHT);
    expect(items[2].y - items[1].y).toBe(G.PITCH_TIGHT);
  });

  it('uses the wide pitch when the container asks for it', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    ct.stacked_gap = 'wide';
    addItemToContainer(m, ct.id);
    relayoutGroup(m, g);
    const items = children(m, ct.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(items[1].y - items[0].y).toBe(G.PITCH_WIDE);
  });

  it('grows the group height with the item count unless sized by hand', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    const h1 = g.h;
    addItemToContainer(m, ct.id);
    expect(g.h).toBeGreaterThan(h1);

    g.manualSize = true;
    const fixed = g.h;
    addItemToContainer(m, ct.id);
    expect(g.h).toBe(fixed);
  });
});

describe('deleteShape', () => {
  it('removes descendants and the connectors touching them', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const other = addGroup(m, 900, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    const item = children(m, ct.id)[0];
    const otherCt = children(m, other.id).find((s) => s.type === 'container')!;
    const otherItem = children(m, otherCt.id)[0];
    addConnector(m, item.id, otherItem.id);
    expect(m.connectors).toHaveLength(1);

    deleteShape(m, g.id);
    expect(getShape(m, g.id)).toBeUndefined();
    expect(getShape(m, ct.id)).toBeUndefined();
    expect(getShape(m, item.id)).toBeUndefined();
    expect(m.connectors).toHaveLength(0);
    expect(getShape(m, other.id)).toBeDefined();
  });

  it('re-lays out the parent group when an item is removed', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    addItemToContainer(m, ct.id);
    const tall = g.h;
    const items = children(m, ct.id).filter((s) => s.type === 'item');
    deleteShape(m, items[1].id);
    expect(g.h).toBeLessThan(tall);
  });

  it('ignores an unknown id', () => {
    const m = createEmptyModel();
    addGroup(m, 0, 0);
    const before = m.shapes.length;
    deleteShape(m, 'nope');
    expect(m.shapes).toHaveLength(before);
  });
});

describe('reorderItem', () => {
  it('swaps order with the neighbour and repositions', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    addItemToContainer(m, ct.id);
    const sorted = () =>
      children(m, ct.id)
        .filter((s) => s.type === 'item')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => s.id);
    const [first, second] = sorted();

    reorderItem(m, second, -1);
    expect(sorted()).toEqual([second, first]);
    expect(getShape(m, second)!.y).toBeLessThan(getShape(m, first)!.y);
  });

  it('does nothing at the ends of the stack', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    const item = children(m, ct.id)[0];
    reorderItem(m, item.id, -1);
    expect(item.order).toBe(0);
  });
});

describe('hierarchy helpers', () => {
  it('walks ancestors transitively', () => {
    const m = modelWith([
      { id: 'g', type: 'group' },
      { id: 'c', type: 'container', parentId: 'g' },
      { id: 'i', type: 'item', parentId: 'c' },
      { id: 'x', type: 'group' },
    ]);
    expect(isAncestor(m, 'i', 'g')).toBe(true);
    expect(isAncestor(m, 'i', 'x')).toBe(false);
    expect(isRelated(m, 'g', 'i')).toBe(true);
    expect(isRelated(m, 'x', 'i')).toBe(false);
    expect(isRelated(m, 'x', 'x')).toBe(true);
  });

  it('collects a whole subtree', () => {
    const m = modelWith([
      { id: 'g', type: 'group' },
      { id: 'c', type: 'container', parentId: 'g' },
      { id: 'i1', type: 'item', parentId: 'c' },
      { id: 'i2', type: 'item', parentId: 'c' },
      { id: 'other', type: 'group' },
    ]);
    expect([...collectDescendantIds(m, 'g')].sort()).toEqual(['c', 'g', 'i1', 'i2']);
  });

  it('reads a lock through the ancestors', () => {
    const m = modelWith([
      { id: 'g', type: 'group', locked: true },
      { id: 'c', type: 'container', parentId: 'g' },
      { id: 'i', type: 'item', parentId: 'c' },
      { id: 'x', type: 'group' },
      { id: 'xi', type: 'item', parentId: 'x', locked: true },
    ]);
    expect(isLocked(m, 'g')).toBe(true);
    expect(isLocked(m, 'i')).toBe(true);
    expect(isLocked(m, 'x')).toBe(false);
    expect(isLocked(m, 'xi')).toBe(true);
    expect(isLocked(m, 'ghost')).toBe(false);
  });
});

describe('addBoundary', () => {
  it('sizes outer and sub boundaries differently', () => {
    const m = createEmptyModel();
    const outer = addBoundary(m, 0, 0, 'outer');
    const sub = addBoundary(m, 0, 0, 'sub');
    expect(outer.w).toBeGreaterThan(sub.w);
    expect(outer.variant).toBe('outer');
    expect(sub.variant).toBe('sub');
  });
});

describe('shape creation', () => {
  it('leaves the colour to the theme instead of writing one into the model', () => {
    // Every factory used to stamp a light-theme colour onto the shape, which is
    // why a group drawn in dark mode was a white card.
    const m = createEmptyModel();
    addGroup(m, 0, 0);
    addBoundary(m, 0, 0, 'outer');
    expect(m.shapes.map((s) => s.fill)).toEqual(m.shapes.map(() => undefined));
  });
});

describe('addItemToContainer', () => {
  it('refuses a non-container target', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    expect(addItemToContainer(m, g.id)).toBeNull();
  });
});

describe('a new boundary', () => {
  it('claims no service, being a place rather than a thing', () => {
    // It defaulted to `gcp-cloudrun`, so every zone drawn on the canvas and
    // every namespace an import produced announced itself as Google Cloud Run
    // and took its blue.
    const model = createEmptyModel();
    expect(addBoundary(model, 0, 0, 'outer').icon).toBeUndefined();
    expect(addBoundary(model, 0, 0, 'sub').icon).toBeUndefined();
  });
});

describe('addDecoration', () => {
  it('places each kind with its own size, id prefix and no parent', () => {
    const m = createEmptyModel();
    const region = addDecoration(m, 'region', 10, 20, 'DMZ');
    const note = addDecoration(m, 'note', 30, 40);
    const text = addDecoration(m, 'text', 50, 60, '# Phase 2');
    expect(region).toMatchObject({ type: 'region', x: 10, y: 20, title: 'DMZ', parentId: null });
    expect(region.id.startsWith('rg_')).toBe(true);
    expect([region.w, region.h]).toEqual([DECORATION_SIZE.region.w, DECORATION_SIZE.region.h]);
    expect(note.id.startsWith('nt_')).toBe(true);
    expect(note.title).toBe('');
    expect(text.id.startsWith('tx_')).toBe(true);
    expect(text.title).toBe('# Phase 2');
    expect(m.shapes).toHaveLength(3);
    expect(region.icon).toBeUndefined();
  });

  it('is deleted like any other shape, without touching the rest', () => {
    const m = createEmptyModel();
    addGroup(m, 0, 0);
    const note = addDecoration(m, 'note', 0, 0);
    deleteShape(m, note.id);
    expect(m.shapes.some((s) => s.id === note.id)).toBe(false);
    expect(m.shapes.filter((s) => s.type === 'group')).toHaveLength(1);
  });
});

describe('carryDecorations', () => {
  it('brings the notes of the old model into the new one', () => {
    const before = createEmptyModel();
    addGroup(before, 0, 0);
    const note = addDecoration(before, 'note', 10, 10, 'keep me');
    const region = addDecoration(before, 'region', 0, 0, 'zone');
    const after = createEmptyModel();
    addGroup(after, 100, 100);

    const merged = carryDecorations(before, after);
    expect(merged.shapes.map((s) => s.id)).toEqual([
      ...after.shapes.map((s) => s.id),
      note.id,
      region.id,
    ]);
    // Copies, not the old objects: the previous model may still be read.
    expect(merged.shapes.find((s) => s.id === note.id)).not.toBe(note);
    expect(merged.shapes.find((s) => s.id === note.id)).toEqual(note);
  });

  it('returns the new model untouched when there is nothing to carry, or it is already there', () => {
    const before = createEmptyModel();
    addGroup(before, 0, 0);
    const after = createEmptyModel();
    expect(carryDecorations(before, after)).toBe(after);

    const note = addDecoration(before, 'note', 0, 0);
    const withNote = { ...after, shapes: [structuredClone(note)] };
    expect(carryDecorations(before, withNote)).toBe(withNote);
  });
});
